package link

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/configs"
	"github.com/danialrahimian/shahkelid/panel/internal/pasarguard"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
)

// ProbePanel is what reading a panel group's configs asks of its panel.
type ProbePanel interface {
	FindUser(ctx context.Context, username string) (*pasarguard.User, error)
	CreateUser(ctx context.Context, user pasarguard.NewUser) (pasarguard.User, error)
	UpdateLimits(ctx context.Context, username string, change pasarguard.Change) (pasarguard.User, error)
	SetEnabled(ctx context.Context, username string, enabled bool) (pasarguard.User, error)
	ReadConfigs(ctx context.Context, subscriptionURL string) (string, error)
}

// Catalog reads which hosts each panel group gives (the Node app's
// groups/catalog.ts). A reseller's panel account cannot read the panel's
// hosts, so the shop keeps a panel user of its own in each panel group it
// uses, named skprobe_g<id>, and reads that user's subscription: what it
// gives is what the group gives.
//
// Every panel group in use is read in the background (Keep), so a link
// finds its hosts known; one read more than a minute ago is given and read
// again meanwhile; a panel that cannot be read keeps its last answer for up
// to an hour, so a blip does not change what customers get.
type Catalog struct {
	Panels func(store.Panel) (ProbePanel, error)
	Fresh  time.Duration
	Stale  time.Duration
	Now    func() time.Time
	Log    *slog.Logger

	// Wait bounds how long a link waits for a panel group nothing is known
	// of yet (0: eight seconds); past it, the link is given unshaped.
	Wait time.Duration

	mu         sync.Mutex
	cache      map[string]probe
	refreshing map[string]bool
}

type probe struct {
	hosts []configs.Host
	at    time.Time
}

// ProbeUsername is the shop's own panel user in a panel group.
func ProbeUsername(panelGroupID int64) string { return fmt.Sprintf("skprobe_g%d", panelGroupID) }

const (
	gb        = int64(1 << 30)
	probeNote = "shah-kelid: reads the configs of this group for the shop. Do not delete."
)

func (c *Catalog) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// ensureProbe makes the probe user, or puts it right: active, in its group
// only. Unlimited and without expiry where the account may (its config
// names then never change), else the least the account may make.
func ensureProbe(ctx context.Context, panel ProbePanel, panelGroupID int64, now time.Time) (pasarguard.User, error) {
	username := ProbeUsername(panelGroupID)
	existing, err := panel.FindUser(ctx, username)
	if err != nil {
		return pasarguard.User{}, err
	}
	month := now.Add(30 * 24 * time.Hour)
	if existing == nil {
		user, err := panel.CreateUser(ctx, pasarguard.NewUser{Username: username, GroupIDs: []int64{panelGroupID}, Note: probeNote})
		if status, rejected := pasarguard.IsRejected(err); rejected && status != 409 {
			// The account's limits: the least it may make.
			least := gb
			one := int64(1)
			return panel.CreateUser(ctx, pasarguard.NewUser{Username: username, GroupIDs: []int64{panelGroupID}, Note: probeNote,
				DataLimitBytes: &least, DeviceLimit: &one, ExpiresAt: &month})
		}
		return user, err
	}
	if existing.Status == "disabled" {
		if _, err := panel.SetEnabled(ctx, username, true); err != nil {
			return pasarguard.User{}, err
		}
	}
	wrongGroups := len(existing.GroupIDs) != 1 || existing.GroupIDs[0] != panelGroupID
	stopped := existing.Status == "expired" || existing.Status == "limited" || existing.Status == "disabled"
	if !wrongGroups && !stopped {
		return *existing, nil
	}
	var unlimited *int64
	var never *time.Time
	user, err := panel.UpdateLimits(ctx, username, pasarguard.Change{GroupIDs: []int64{panelGroupID}, DataLimitBytes: &unlimited, ExpiresAt: &never, Activate: true})
	if err == nil {
		return user, nil
	}
	more := existing.UsedBytes + gb
	limit := &more
	until := &month
	return panel.UpdateLimits(ctx, username, pasarguard.Change{GroupIDs: []int64{panelGroupID}, DataLimitBytes: &limit, ExpiresAt: &until, Activate: true})
}

// Read reads a panel group's hosts now, through its probe user.
func (c *Catalog) Read(ctx context.Context, p store.Panel, panelGroupID int64) ([]configs.Host, error) {
	panel, err := c.Panels(p)
	if err != nil {
		return nil, err
	}
	user, err := ensureProbe(ctx, panel, panelGroupID, c.now())
	if err != nil {
		return nil, err
	}
	body, err := panel.ReadConfigs(ctx, user.SubscriptionURL)
	if err != nil {
		return nil, err
	}
	hosts := configs.ProbeHosts(body)
	if hosts == nil {
		hosts = []configs.Host{}
	}
	c.mu.Lock()
	if c.cache == nil {
		c.cache = map[string]probe{}
	}
	c.cache[fmt.Sprintf("%s:%d", p.ID, panelGroupID)] = probe{hosts, c.now()}
	c.mu.Unlock()
	return hosts, nil
}

// Cached gives a panel group's hosts: what is known when it is at most
// Fresh old; when older (up to Stale), still what is known, and it is read
// again meanwhile, so no link waits on a panel; when nothing is known yet,
// it is read now, waiting at most Wait. ok is false when there is nothing
// to give.
func (c *Catalog) Cached(ctx context.Context, p store.Panel, panelGroupID int64) (hosts []configs.Host, ok bool) {
	fresh, stale, wait := c.Fresh, c.Stale, c.Wait
	if fresh == 0 {
		fresh = time.Minute
	}
	if stale == 0 {
		stale = time.Hour
	}
	if wait == 0 {
		wait = 8 * time.Second
	}
	key := fmt.Sprintf("%s:%d", p.ID, panelGroupID)
	c.mu.Lock()
	known, cached := c.cache[key]
	c.mu.Unlock()
	age := c.now().Sub(known.at)
	if cached && age < fresh {
		return known.hosts, true
	}
	if cached && age < stale {
		c.refresh(p, panelGroupID, key)
		return known.hosts, true
	}
	readCtx, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	hosts, err := c.Read(readCtx, p, panelGroupID)
	if err == nil {
		return hosts, true
	}
	if c.Log != nil {
		c.Log.Warn("a panel group's configs could not be read", "panel", p.Name, "group", panelGroupID, "err", err)
	}
	return nil, false
}

// refresh reads a panel group again in the background, once at a time.
func (c *Catalog) refresh(p store.Panel, panelGroupID int64, key string) {
	c.mu.Lock()
	if c.refreshing == nil {
		c.refreshing = map[string]bool{}
	}
	if c.refreshing[key] {
		c.mu.Unlock()
		return
	}
	c.refreshing[key] = true
	c.mu.Unlock()
	go func() {
		defer func() {
			c.mu.Lock()
			delete(c.refreshing, key)
			c.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if _, err := c.Read(ctx, p, panelGroupID); err != nil && c.Log != nil {
			c.Log.Warn("a panel group's configs could not be read", "panel", p.Name, "group", panelGroupID, "err", err)
		}
	}()
}

// Keep reads every panel group in use now and then (every, or half of
// Fresh), so customers' links find their hosts known and never wait on a
// panel. It returns when ctx ends.
func (c *Catalog) Keep(ctx context.Context, used func(context.Context) ([]store.UsedPanelGroup, error), every time.Duration) {
	if every <= 0 {
		every = 45 * time.Second
	}
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		groups, err := used(ctx)
		if err != nil && c.Log != nil {
			c.Log.Warn("listing the panel groups in use", "err", err)
		}
		var wg sync.WaitGroup
		for _, g := range groups {
			wg.Add(1)
			go func() {
				defer wg.Done()
				readCtx, cancel := context.WithTimeout(ctx, time.Minute)
				defer cancel()
				if _, err := c.Read(readCtx, g.Panel, g.PanelGroupID); err != nil && c.Log != nil && ctx.Err() == nil {
					c.Log.Warn("a panel group's configs could not be read", "panel", g.Panel.Name, "group", g.PanelGroupID, "err", err)
				}
			}()
		}
		wg.Wait()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Forget drops what is known (in tests).
func (c *Catalog) Forget() {
	c.mu.Lock()
	c.cache = nil
	c.mu.Unlock()
}
