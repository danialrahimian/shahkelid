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
	ReadLinks(ctx context.Context, subscriptionURL string) (string, error)
}

// Catalog reads which hosts each panel group gives (the Node app's
// groups/catalog.ts). A reseller's panel account cannot read the panel's
// hosts, so the shop keeps a panel user of its own in each panel group it
// uses, named skprobe_g<id>, and reads that user's subscription: what it
// gives is what the group gives.
//
// The customer's link reads a group at most once a minute; a panel that
// cannot be read keeps its last answer for up to an hour, so a blip does
// not change what customers get.
type Catalog struct {
	Panels func(store.Panel) (ProbePanel, error)
	Fresh  time.Duration
	Stale  time.Duration
	Now    func() time.Time
	Log    *slog.Logger

	mu    sync.Mutex
	cache map[string]probe
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
	links, err := panel.ReadLinks(ctx, user.SubscriptionURL)
	if err != nil {
		return nil, err
	}
	hosts := configs.ProbeHosts(links)
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

// Cached gives a panel group's hosts at most Fresh old, or up to Stale old
// when the panel cannot be read. ok is false when there is nothing to give.
func (c *Catalog) Cached(ctx context.Context, p store.Panel, panelGroupID int64) (hosts []configs.Host, ok bool) {
	fresh, stale := c.Fresh, c.Stale
	if fresh == 0 {
		fresh = time.Minute
	}
	if stale == 0 {
		stale = time.Hour
	}
	key := fmt.Sprintf("%s:%d", p.ID, panelGroupID)
	c.mu.Lock()
	known, cached := c.cache[key]
	c.mu.Unlock()
	if cached && c.now().Sub(known.at) < fresh {
		return known.hosts, true
	}
	hosts, err := c.Read(ctx, p, panelGroupID)
	if err == nil {
		return hosts, true
	}
	if c.Log != nil {
		c.Log.Warn("a panel group's configs could not be read", "panel", p.Name, "group", panelGroupID, "err", err)
	}
	if cached && c.now().Sub(known.at) < stale {
		return known.hosts, true
	}
	return nil, false
}

// Forget drops what is known (in tests).
func (c *Catalog) Forget() {
	c.mu.Lock()
	c.cache = nil
	c.mu.Unlock()
}
