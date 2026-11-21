// Package syncer keeps the shop's copy of usage, time and status in step
// with the panels, for every subscription at once.
//
// The panel is the source of truth: it counts the bytes and starts and ends
// the clock. Every few minutes each active panel's users are read in pages
// (panels read in parallel); then, in memory, each changed copy is updated
// and every subscription that changed is reconciled: its usage added up and
// each panel's limit set to what that panel counted plus what is left
// overall (see package usage). Limit changes go to the panels in parallel,
// a few at a time per panel.
//
// What reaches the database is only what changed, in a few batched
// statements: no row is rewritten to say "checked just now" (the panel's
// last_ok_at says when it was read). A sync of tens of thousands of
// subscriptions is a handful of round trips.
//
// Along the way it also:
//   - makes the users of copies not made yet (a panel down at purchase, or
//     a panel newly taken by one of the subscription's groups);
//   - sets panel users' groups to what the subscription's groups give,
//     after staff changed a group.
package syncer

import (
	"context"
	"errors"
	"fmt"

	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/pasarguard"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
	"github.com/danialrahimian/shahkelid/panel/internal/usage"
)

// ours marks the panel users the shop made; the panel's others are not read.
const ours = "sk_"

// Panel is what the sync asks of a panel.
type Panel interface {
	ListUsers(ctx context.Context, offset, limit int) ([]pasarguard.User, int, error)
	FindUser(ctx context.Context, username string) (*pasarguard.User, error)
	CreateUser(ctx context.Context, user pasarguard.NewUser) (pasarguard.User, error)
	UpdateLimits(ctx context.Context, username string, change pasarguard.Change) (pasarguard.User, error)
}

// Syncer runs syncs. Its zero values fall back to sensible defaults.
type Syncer struct {
	Store *store.Store
	// Panels gives the client of a panel row.
	Panels func(store.Panel) (Panel, error)
	// PanelsAtOnce is how many panels are read in parallel.
	PanelsAtOnce int
	// ChangesAtOnce is how many limit changes go to one panel in parallel.
	ChangesAtOnce int
	// PageSize is how many users one list request asks for.
	PageSize int
	// FirstUseDeadline: a user made late starts its clock by then at the latest.
	FirstUseDeadline time.Duration
	Now              func() time.Time
	Log              *slog.Logger
}

// PanelResult is what one panel's read found.
type PanelResult struct {
	Seen    int    `json:"seen"`
	Updated int    `json:"updated"`
	Missing int    `json:"missing"`
	Error   string `json:"error,omitempty"`
}

// Result is what a sync did.
type Result struct {
	Panels     map[string]PanelResult `json:"panels"`
	Made       int                    `json:"made"`
	Aligned    int                    `json:"aligned"`
	Reconciled int                    `json:"reconciled"`
	Changes    int                    `json:"changes"`
	Written    int                    `json:"written"`
	Took       time.Duration          `json:"took"`
}

func (s *Syncer) defaults() {
	if s.PanelsAtOnce < 1 {
		s.PanelsAtOnce = 8
	}
	if s.ChangesAtOnce < 1 {
		s.ChangesAtOnce = 16
	}
	if s.PageSize < 1 {
		s.PageSize = 500
	}
	if s.FirstUseDeadline == 0 {
		s.FirstUseDeadline = 30 * 24 * time.Hour
	}
	if s.Now == nil {
		s.Now = time.Now
	}
	if s.Log == nil {
		s.Log = slog.Default()
	}
}

// Run syncs every active panel once.
func (s *Syncer) Run(ctx context.Context) (Result, error) {
	s.defaults()
	started := s.Now()
	result := Result{Panels: map[string]PanelResult{}}

	panels, err := s.Store.ActivePanels(ctx)
	if err != nil {
		return result, fmt.Errorf("%s: %w", "reading the active panels", err)
	}
	ids := make([]string, len(panels))
	for i, p := range panels {
		ids[i] = p.ID
	}
	owned, err := s.Store.LiveMembers(ctx, ids)
	if err != nil {
		return result, fmt.Errorf("%s: %w", "reading the panel copies", err)
	}

	// Every panel read in parallel; nothing is written until all are read.
	reads := make([]panelRead, len(panels))
	var wg sync.WaitGroup
	slots := make(chan struct{}, s.PanelsAtOnce)
	for i, p := range panels {
		wg.Add(1)
		go func() {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			reads[i] = s.readPanel(ctx, p, owned[p.ID])
		}()
	}
	wg.Wait()

	touched := map[string]bool{}
	pending := map[string]bool{}
	// Panels that just failed are not asked for anything else this time.
	reachable := []store.Panel{}
	var changed []usage.Member
	for i, p := range panels {
		read := reads[i]
		if err := s.Store.MarkPanel(ctx, p.ID, read.err); err != nil {
			return result, fmt.Errorf("%s: %w", "marking a panel", err)
		}
		if read.err != nil {
			result.Panels[p.ID] = PanelResult{Error: read.err.Error()}
			s.Log.Warn("a panel could not be read; the others are still synced", "panel", p.Name, "err", read.err)
			continue
		}
		result.Panels[p.ID] = read.result
		reachable = append(reachable, p)
		changed = append(changed, read.changed...)
		for _, m := range read.changed {
			touched[m.SubscriptionID] = true
		}
		for _, id := range read.pending {
			pending[id] = true
		}
	}
	if err := s.Store.SaveMembers(ctx, changed); err != nil {
		return result, fmt.Errorf("%s: %w", "saving what the panels said", err)
	}

	// Groups staff changed since: panel users given what their groups now give.
	aligned, added, err := s.align(ctx, reachable)
	if err != nil {
		return result, fmt.Errorf("%s: %w", "aligning groups", err)
	}
	result.Aligned = len(aligned)
	for _, id := range aligned {
		touched[id] = true
	}
	for _, id := range added {
		pending[id] = true
	}

	// Copies not made yet: made now.
	made, err := s.makePending(ctx, reachable, keys(pending))
	if err != nil {
		return result, fmt.Errorf("%s: %w", "making users not made yet", err)
	}
	result.Made = len(made)
	for _, id := range made {
		touched[id] = true
	}

	reconciled, err := s.reconcile(ctx, reachable, keys(touched))
	if err != nil {
		return result, fmt.Errorf("%s: %w", "reconciling", err)
	}
	result.Reconciled = reconciled.subscriptions
	result.Changes = reconciled.changes
	result.Written = reconciled.written
	result.Took = s.Now().Sub(started)
	return result, nil
}

func keys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------- reading

type panelRead struct {
	result  PanelResult
	changed []usage.Member
	pending []string
	err     error
}

// fromPanel is a copy as the panel's user makes it.
func fromPanel(m usage.Member, user pasarguard.User) usage.Member {
	m.PanelUserID = &user.ID
	url := user.SubscriptionURL
	m.PanelSubscriptionURL = &url
	status := user.Status
	m.PanelStatus = &status
	m.DataLimitBytes = user.DataLimitBytes
	m.UsedBytes = user.UsedBytes
	m.LifetimeUsedBytes = max(user.LifetimeUsedBytes, user.UsedBytes)
	m.ExpiresAt = user.ExpiresAt
	m.OnHoldDurationSeconds = user.OnHoldDurationSeconds
	m.OnlineAt = user.OnlineAt
	m.LastError = nil
	return m
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Truncate(time.Millisecond).Equal(b.Truncate(time.Millisecond))
}

func sameInt(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func sameString(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// differs reports whether anything kept differs, so unchanged rows are not rewritten.
func differs(current, next usage.Member) bool {
	return !sameString(current.PanelStatus, next.PanelStatus) ||
		current.UsedBytes != next.UsedBytes ||
		current.LifetimeUsedBytes != next.LifetimeUsedBytes ||
		!sameInt(current.DataLimitBytes, next.DataLimitBytes) ||
		!sameTime(current.ExpiresAt, next.ExpiresAt) ||
		!sameTime(current.OnlineAt, next.OnlineAt) ||
		!sameString(current.PanelSubscriptionURL, next.PanelSubscriptionURL) ||
		!sameInt(current.PanelUserID, next.PanelUserID) ||
		!sameInt(current.OnHoldDurationSeconds, next.OnHoldDurationSeconds) ||
		current.LastError != nil
}

// readPanel reads one panel's users into its copies, in memory.
func (s *Syncer) readPanel(ctx context.Context, p store.Panel, owned map[string]Owned) panelRead {
	var read panelRead
	client, err := s.Panels(p)
	if err != nil {
		read.err = err
		return read
	}
	unseen := map[string]Owned{}
	for username, o := range owned {
		if o.Made() {
			unseen[username] = o
		} else {
			read.pending = append(read.pending, o.SubscriptionID)
		}
	}
	for offset := 0; ; offset += s.PageSize {
		users, total, err := client.ListUsers(ctx, offset, s.PageSize)
		if err != nil {
			read.err = err
			return read
		}
		for _, user := range users {
			if !strings.HasPrefix(user.Username, ours) {
				continue
			}
			current, ok := unseen[user.Username]
			if !ok {
				continue
			}
			delete(unseen, user.Username)
			read.result.Seen++
			next := fromPanel(current.Member, user)
			if differs(current.Member, next) {
				read.changed = append(read.changed, next)
				read.result.Updated++
			}
		}
		if len(users) < s.PageSize || offset+s.PageSize >= total {
			break
		}
	}
	// Ours, made here, and not in the panel's list any more: said once.
	for _, o := range unseen {
		read.result.Missing++
		if o.IsMissing() {
			continue
		}
		next := o.Member
		missing := usage.Missing
		next.LastError = &missing
		read.changed = append(read.changed, next)
	}
	return read
}

// Owned is store.Owned, named here for brevity.
type Owned = store.Owned

// --------------------------------------------------------------- groups

// align sets each misaligned subscription's panel users to its groups. It
// returns the subscriptions whose users were changed, and those given a
// panel they were not on (to be made).
func (s *Syncer) align(ctx context.Context, panels []store.Panel) (changed, added []string, err error) {
	ids, err := s.Store.Misaligned(ctx)
	if err != nil || len(ids) == 0 {
		return nil, nil, err
	}
	desired, err := s.Store.DesiredGroups(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	members, err := s.Store.MembersOf(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	subscriptions, err := s.Store.Subscriptions(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	byID := map[string]store.Subscription{}
	for _, x := range subscriptions {
		byID[x.ID] = x
	}
	active := map[string]store.Panel{}
	for _, p := range panels {
		active[p.ID] = p
	}

	var newCopies, saved []usage.Member
	for _, id := range ids {
		want, carries := desired[id]
		sub, live := byID[id]
		if !carries || !live || !usage.IsSynced(sub.Status) {
			continue
		}
		on := map[string]bool{}
		for _, m := range members[id] {
			on[m.PanelID] = true
		}
		for panelID, groups := range want {
			if !on[panelID] {
				newCopies = append(newCopies, usage.Member{SubscriptionID: id, PanelID: panelID, DataLimitBytes: sub.DataLimit, GroupIDs: groups})
				added = append(added, id)
			}
		}
		touchedThis := false
		for _, m := range members[id] {
			p, isActive := active[m.PanelID]
			if !isActive {
				continue
			}
			wanted := want[m.PanelID]
			if wanted == nil {
				wanted = []int64{}
			}
			if sameGroups(wanted, m.GroupIDs) {
				continue
			}
			next := m
			next.GroupIDs = wanted
			// Not made yet: it is made with these groups.
			if !m.Made() || m.IsMissing() {
				saved = append(saved, next)
				continue
			}
			client, err := s.Panels(p)
			if err == nil {
				_, err = client.UpdateLimits(ctx, sub.Username, pasarguard.Change{GroupIDs: wanted})
			}
			if err != nil {
				s.Log.Warn("a panel user's groups could not be set; the next sync tries again", "subscription", id, "panel", p.Name, "err", err)
				message := truncate(err.Error(), 500)
				next = m
				next.LastError = &message
			} else {
				touchedThis = true
			}
			saved = append(saved, next)
		}
		if touchedThis {
			changed = append(changed, id)
		}
	}
	if err := s.Store.AddMembers(ctx, newCopies); err != nil {
		return nil, nil, err
	}
	if err := s.Store.SaveMembers(ctx, saved); err != nil {
		return nil, nil, err
	}
	return changed, added, nil
}

func sameGroups(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	x := append([]int64(nil), a...)
	y := append([]int64(nil), b...)
	sort.Slice(x, func(i, j int) bool { return x[i] < x[j] })
	sort.Slice(y, func(i, j int) bool { return y[i] < y[j] })
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

func truncate(text string, n int) string {
	if len(text) <= n {
		return text
	}
	return text[:n]
}

// --------------------------------------------------------------- making

// makePending makes the users of copies not made yet. A panel that fails
// keeps the error on its copy and is tried at the next sync. It returns the
// subscriptions given a new panel user.
func (s *Syncer) makePending(ctx context.Context, panels []store.Panel, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	pending, err := s.Store.PendingMembers(ctx, ids)
	if err != nil {
		return nil, err
	}
	active := map[string]store.Panel{}
	for _, p := range panels {
		active[p.ID] = p
	}
	var saved []usage.Member
	madeFor := map[string]bool{}
	for _, item := range pending {
		p, ok := active[item.PanelID]
		if !ok {
			continue
		}
		client, err := s.Panels(p)
		var user pasarguard.User
		if err == nil {
			user, err = s.make(ctx, client, item)
		}
		if err != nil {
			message := truncate(err.Error(), 500)
			next := item.Member
			next.LastError = &message
			saved = append(saved, next)
			continue
		}
		saved = append(saved, fromPanel(item.Member, user))
		madeFor[item.SubscriptionID] = true
	}
	if err := s.Store.SaveMembers(ctx, saved); err != nil {
		return nil, err
	}
	return keys(madeFor), nil
}

// make makes (or finds, after a lost answer) one panel user: on hold until
// the first connection, with what is left of the volume.
func (s *Syncer) make(ctx context.Context, client Panel, item store.Pending) (pasarguard.User, error) {
	if existing, err := client.FindUser(ctx, item.Username); err != nil {
		return pasarguard.User{}, err
	} else if existing != nil {
		return *existing, nil
	}
	var limit *int64
	if item.DataLimit != nil {
		left := max(1, *item.DataLimit-item.UsedElsewhere)
		limit = &left
	}
	return client.CreateUser(ctx, pasarguard.NewUser{
		Username:         item.Username,
		GroupIDs:         item.GroupIDs,
		DataLimitBytes:   limit,
		DeviceLimit:      item.DeviceLimit,
		TrafficReset:     item.TrafficReset,
		Note:             "shah-kelid " + item.SubscriptionID,
		StartsOnFirstUse: true,
		DurationSeconds:  item.DurationSeconds,
		StartsAtLatest:   s.Now().Add(s.FirstUseDeadline),
	})
}

// ------------------------------------------------------------ reconciling

type reconciled struct {
	subscriptions int
	changes       int
	written       int
}

type change struct {
	subscription store.Subscription
	member       usage.Member
	change       usage.Change
}

// reconcile brings the given subscriptions and their panels into agreement:
// limit and expiry changes sent to the panels (in parallel, a few at a time
// per panel), then each subscription's totals written where they changed.
func (s *Syncer) reconcile(ctx context.Context, panels []store.Panel, ids []string) (reconciled, error) {
	var out reconciled
	if len(ids) == 0 {
		return out, nil
	}
	subscriptions, err := s.Store.Subscriptions(ctx, ids)
	if err != nil {
		return out, err
	}
	members, err := s.Store.MembersOf(ctx, ids)
	if err != nil {
		return out, err
	}
	active := map[string]store.Panel{}
	for _, p := range panels {
		active[p.ID] = p
	}
	now := s.Now()

	// What each panel must be told.
	byPanel := map[string][]change{}
	for _, sub := range subscriptions {
		if !usage.IsSynced(sub.Status) {
			continue
		}
		list := members[sub.ID]
		if !anyMade(list) {
			continue
		}
		totals := usage.TotalsOf(sub.DataLimit, list, now)
		for _, m := range list {
			if !m.Made() || m.IsMissing() {
				continue
			}
			if _, ok := active[m.PanelID]; !ok {
				continue
			}
			c := usage.ChangeFor(sub.DataLimit, m, totals)
			if !c.Empty() {
				byPanel[m.PanelID] = append(byPanel[m.PanelID], change{sub, m, c})
			}
		}
	}

	// Sent in parallel: every panel at once, a few changes at a time on each.
	answers := map[string]usage.Member{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for panelID, list := range byPanel {
		client, err := s.Panels(active[panelID])
		if err != nil {
			s.Log.Warn("no client for a panel", "panel", active[panelID].Name, "err", err)
			continue
		}
		slots := make(chan struct{}, s.ChangesAtOnce)
		for _, item := range list {
			wg.Add(1)
			go func() {
				defer wg.Done()
				slots <- struct{}{}
				defer func() { <-slots }()
				user, err := client.UpdateLimits(ctx, item.subscription.Username, toPanelChange(item.change))
				next := item.member
				if err != nil {
					s.Log.Warn("a panel's limits could not be set; the next sync tries again",
						"subscription", item.subscription.ID, "panel", active[panelID].Name, "err", err)
					message := truncate(err.Error(), 500)
					next.LastError = &message
				} else {
					next = fromPanel(item.member, user)
				}
				mu.Lock()
				answers[item.member.SubscriptionID+"|"+item.member.PanelID] = next
				out.changes++
				mu.Unlock()
			}()
		}
	}
	wg.Wait()

	var saved []usage.Member
	for _, m := range answers {
		saved = append(saved, m)
	}
	if err := s.Store.SaveMembers(ctx, saved); err != nil {
		return out, err
	}

	// Each subscription's totals, from its panels as they are now.
	var updates []store.SubscriptionUpdate
	for _, sub := range subscriptions {
		if !usage.IsSynced(sub.Status) {
			continue
		}
		list := members[sub.ID]
		if !anyMade(list) {
			continue
		}
		for i, m := range list {
			if answer, ok := answers[m.SubscriptionID+"|"+m.PanelID]; ok {
				list[i] = answer
			}
		}
		out.subscriptions++
		next := usage.SubscriptionFrom(sub.DataLimit, sub.MainPanelID, list, now)
		if sameSubscription(sub.Subscription, next) && sub.Status == next.Status {
			continue
		}
		updates = append(updates, store.SubscriptionUpdate{ID: sub.ID, Was: sub.Status, WasError: sub.LastError, Subscription: next})
	}
	written, err := s.Store.SaveSubscriptions(ctx, updates)
	if err != nil {
		return out, err
	}
	out.written = len(written)
	return out, nil
}

func anyMade(list []usage.Member) bool {
	for _, m := range list {
		if m.Made() {
			return true
		}
	}
	return false
}

func sameSubscription(a, b usage.Subscription) bool {
	return a.Status == b.Status && a.UsedBytes == b.UsedBytes && a.LifetimeUsedBytes == b.LifetimeUsedBytes &&
		sameTime(a.OnlineAt, b.OnlineAt) && sameTime(a.ExpiresAt, b.ExpiresAt) &&
		sameInt(a.OnHoldDurationSeconds, b.OnHoldDurationSeconds) && sameInt(a.PanelUserID, b.PanelUserID) &&
		sameString(a.PanelSubscriptionURL, b.PanelSubscriptionURL) && sameString(a.LastError, b.LastError)
}

func toPanelChange(c usage.Change) pasarguard.Change {
	return pasarguard.Change{DataLimitBytes: c.DataLimitBytes, ExpiresAt: c.ExpiresAt, Activate: c.Activate}
}

// ErrBusy is returned when another sync holds the lock.
var ErrBusy = errors.New("another sync is running")

// lockKey is the advisory lock that keeps two syncs (two instances, or a
// slow one and the next) from running at once.
const lockKey = 0x534b53594e43 // "SKSYNC"

// RunLocked runs a sync unless another is running.
func (s *Syncer) RunLocked(ctx context.Context) (Result, error) {
	conn, err := s.Store.Pool.Acquire(ctx)
	if err != nil {
		return Result{}, err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock($1)`, int64(lockKey)).Scan(&locked); err != nil {
		return Result{}, err
	}
	if !locked {
		return Result{}, ErrBusy
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `select pg_advisory_unlock($1)`, int64(lockKey))
	}()
	return s.Run(ctx)
}

// Every runs a sync now and then every interval, until ctx ends.
func (s *Syncer) Every(ctx context.Context, interval time.Duration) {
	s.defaults()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		result, err := s.RunLocked(ctx)
		switch {
		case errors.Is(err, ErrBusy):
			s.Log.Info("sync skipped: another is running")
		case err != nil:
			s.Log.Error("sync failed", "err", err)
		default:
			s.Log.Info("synced", "reconciled", result.Reconciled, "changes", result.Changes,
				"written", result.Written, "made", result.Made, "aligned", result.Aligned, "took", result.Took.String())
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
