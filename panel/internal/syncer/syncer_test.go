package syncer_test

import (
	"context"
	"testing"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/fakepanel"
	"github.com/danialrahimian/shahkelid/panel/internal/panels"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
	"github.com/danialrahimian/shahkelid/panel/internal/syncer"
	"github.com/danialrahimian/shahkelid/panel/internal/testdb"
)

const gb = int64(1 << 30)

var ctx = context.Background()

func ptr[T any](v T) *T { return &v }

func newSyncer(s *store.Store) *syncer.Syncer {
	clients := panels.New(testdb.Key)
	return &syncer.Syncer{
		Store:  s,
		Panels: func(p store.Panel) (syncer.Panel, error) { return clients.For(p) },
	}
}

// onPanel puts a user on the fake panel as the shop would have made it.
func onPanel(p *fakepanel.Panel, username, status string, limit, used int64, expires *time.Time, groups ...int64) *fakepanel.User {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	if len(groups) == 0 {
		groups = []int64{2}
	}
	user := &fakepanel.User{ID: int64(len(p.Users) + 100), Username: username, Status: status, DataLimit: limit, Used: used, Lifetime: used, Expire: expires, GroupIDs: groups, Token: "tok-" + username}
	if status == "on_hold" {
		user.OnHoldDuration = ptr(int64(30 * 86400))
	}
	p.Users[username] = user
	return user
}

type world struct {
	s      *store.Store
	a, b   *fakepanel.Panel
	panelA string
	panelB string
	plan   string
}

func twoPanels(t *testing.T) world {
	t.Helper()
	s := testdb.Open(t)
	a, b := fakepanel.New(), fakepanel.New()
	t.Cleanup(a.Close)
	t.Cleanup(b.Close)
	return world{s: s, a: a, b: b, panelA: testdb.Panel(t, s, "A", a.URL()), panelB: testdb.Panel(t, s, "B", b.URL()), plan: testdb.Plan(t, s)}
}

// aSubscription is a 50 GB subscription on both panels, with users made there.
func (w world) aSubscription(t *testing.T, usedA, usedB int64) (string, string) {
	t.Helper()
	id, username := testdb.Subscription(t, w.s, testdb.Sub{PlanID: w.plan, Limit: ptr(50 * gb), Status: "on_hold", Copies: []testdb.Copy{
		{PanelID: w.panelA, PanelUserID: ptr(int64(1)), Status: "on_hold", Limit: ptr(50 * gb)},
		{PanelID: w.panelB, PanelUserID: ptr(int64(1)), Status: "on_hold", Limit: ptr(50 * gb)},
	}})
	onPanel(w.a, username, "on_hold", 50*gb, 0, nil)
	onPanel(w.b, username, "on_hold", 50*gb, 0, nil)
	if usedA > 0 {
		w.a.Use(username, usedA)
	}
	if usedB > 0 {
		w.b.Use(username, usedB)
	}
	return id, username
}

func TestUsageOnTwoPanelsAddsUpAndEachPanelGetsItsShare(t *testing.T) {
	w := twoPanels(t)
	id, username := w.aSubscription(t, 10*gb, 20*gb)

	result, err := newSyncer(w.s).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}

	row := testdb.Row(t, w.s, `select status::text, used_bytes from subscriptions where id = $1`, id)
	if row["status"] != "active" || int64(row["used_bytes"].(float64)) != 30*gb {
		t.Fatalf("subscription %v; want active with 30 GB used", row)
	}
	if got := w.a.User(username).DataLimit; got != 10*gb+20*gb {
		t.Fatalf("panel A's limit %d; want its 10 GB + the 20 GB left", got)
	}
	if got := w.b.User(username).DataLimit; got != 20*gb+20*gb {
		t.Fatalf("panel B's limit %d; want its 20 GB + the 20 GB left", got)
	}
	if !w.a.User(username).Expire.Equal(*w.b.User(username).Expire) {
		t.Fatal("one clock: both panels end at the first one's expiry")
	}
	if result.Panels[w.panelA].Seen != 1 || result.Written != 1 {
		t.Fatalf("result %+v", result)
	}
	events := testdb.Count(t, w.s, `select count(*) from subscription_events where subscription_id = $1 and kind = 'status_changed'`, id)
	if events != 1 {
		t.Fatalf("on hold → active said %d times; want once", events)
	}
}

func TestNothingChangedMeansNothingWritten(t *testing.T) {
	w := twoPanels(t)
	id, _ := w.aSubscription(t, gb, 0)
	sync := newSyncer(w.s)
	if _, err := sync.Run(ctx); err != nil {
		t.Fatal(err)
	}
	before := testdb.Row(t, w.s, `select updated_at, last_synced_at from subscriptions where id = $1`, id)
	copies := testdb.Row(t, w.s, `select max(updated_at) as at from subscription_panels where subscription_id = $1`, id)

	result, err := sync.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if result.Written != 0 || result.Changes != 0 || result.Panels[w.panelA].Updated != 0 || result.Panels[w.panelB].Updated != 0 {
		t.Fatalf("a second sync with nothing new wrote something: %+v", result)
	}
	after := testdb.Row(t, w.s, `select updated_at, last_synced_at from subscriptions where id = $1`, id)
	if before["updated_at"] != after["updated_at"] {
		t.Fatal("the subscription row was rewritten")
	}
	if testdb.Row(t, w.s, `select max(updated_at) as at from subscription_panels where subscription_id = $1`, id)["at"] != copies["at"] {
		t.Fatal("a panel copy was rewritten")
	}
	if testdb.Count(t, w.s, `select count(*) from panels where last_ok_at is null`) != 0 {
		t.Fatal("each panel says when it was last read")
	}
}

func TestTheWholeVolumeUsedAcrossPanelsIsLimited(t *testing.T) {
	w := twoPanels(t)
	id, _ := w.aSubscription(t, 30*gb, 20*gb)

	if _, err := newSyncer(w.s).Run(ctx); err != nil {
		t.Fatal(err)
	}

	if status := testdb.Row(t, w.s, `select status::text from subscriptions where id = $1`, id)["status"]; status != "limited" {
		t.Fatalf("status %v; want limited though neither panel stopped it", status)
	}
}

func TestAPanelStillOnHoldStartsWithTheOther(t *testing.T) {
	w := twoPanels(t)
	_, username := w.aSubscription(t, gb, 0)

	if _, err := newSyncer(w.s).Run(ctx); err != nil {
		t.Fatal(err)
	}

	b := w.b.User(username)
	if b.Status != "active" || b.Expire == nil || !b.Expire.Equal(*w.a.User(username).Expire) {
		t.Fatalf("panel B %+v; want started with A's expiry", b)
	}
}

func TestAUserGoneFromAPanelIsSaidOnce(t *testing.T) {
	w := twoPanels(t)
	id, username := w.aSubscription(t, gb, 0)
	sync := newSyncer(w.s)
	if _, err := sync.Run(ctx); err != nil {
		t.Fatal(err)
	}
	w.b.Mu.Lock()
	delete(w.b.Users, username)
	w.b.Mu.Unlock()

	for range 3 {
		if _, err := sync.Run(ctx); err != nil {
			t.Fatal(err)
		}
	}

	if got := testdb.Row(t, w.s, `select last_error from subscriptions where id = $1`, id)["last_error"]; got != "Not found on the panel" {
		t.Fatalf("last error %v", got)
	}
	if n := testdb.Count(t, w.s, `select count(*) from subscription_events where subscription_id = $1 and kind = 'missing_on_panel'`, id); n != 1 {
		t.Fatalf("said %d times; want once", n)
	}
}

func TestOnePanelDownDoesNotStopTheOthers(t *testing.T) {
	w := twoPanels(t)
	id, _ := w.aSubscription(t, 5*gb, 0)
	w.b.Mu.Lock()
	w.b.Down = true
	w.b.Mu.Unlock()

	result, err := newSyncer(w.s).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if result.Panels[w.panelB].Error == "" || result.Panels[w.panelA].Seen != 1 {
		t.Fatalf("result %+v", result)
	}
	if used := testdb.Row(t, w.s, `select used_bytes from subscriptions where id = $1`, id)["used_bytes"].(float64); int64(used) != 5*gb {
		t.Fatalf("used %v; want panel A's 5 GB", used)
	}
	if testdb.Row(t, w.s, `select last_error from panels where id = $1`, w.panelB)["last_error"] == nil {
		t.Fatal("the down panel says why")
	}
}

func TestADeletedSubscriptionIsNotBroughtBack(t *testing.T) {
	w := twoPanels(t)
	id, _ := w.aSubscription(t, 5*gb, 0)
	if _, err := w.s.Pool.Exec(ctx, `update subscriptions set status = 'deleted' where id = $1`, id); err != nil {
		t.Fatal(err)
	}

	if _, err := newSyncer(w.s).Run(ctx); err != nil {
		t.Fatal(err)
	}

	if status := testdb.Row(t, w.s, `select status::text from subscriptions where id = $1`, id)["status"]; status != "deleted" {
		t.Fatalf("status %v", status)
	}
	written, err := w.s.SaveSubscriptions(ctx, []store.SubscriptionUpdate{{ID: id, Was: "active"}})
	if err != nil || len(written) != 0 {
		t.Fatalf("written %v, %v; a deleted subscription is never written", written, err)
	}
}

func TestACopyNotMadeYetIsMadeWithWhatIsLeft(t *testing.T) {
	w := twoPanels(t)
	id, username := testdb.Subscription(t, w.s, testdb.Sub{PlanID: w.plan, Limit: ptr(50 * gb), Copies: []testdb.Copy{
		{PanelID: w.panelA, PanelUserID: ptr(int64(1)), Status: "active", Limit: ptr(50 * gb), Used: 10 * gb},
		{PanelID: w.panelB, GroupIDs: []int64{7}},
	}})
	onPanel(w.a, username, "active", 50*gb, 10*gb, ptr(time.Now().Add(240*time.Hour)))

	result, err := newSyncer(w.s).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}

	made := w.b.User(username)
	if made == nil || made.DataLimit != 40*gb || made.GroupIDs[0] != 7 {
		t.Fatalf("made %+v; want 40 GB (what is left) in group 7", made)
	}
	if made.Status != "active" {
		t.Fatalf("status %s; want started with the other panel's clock", made.Status)
	}
	if result.Made != 1 || testdb.Count(t, w.s, `select count(*) from subscription_panels where subscription_id = $1 and panel_user_id is null`, id) != 0 {
		t.Fatalf("result %+v", result)
	}
}

func TestAGroupChangeReachesExistingCustomers(t *testing.T) {
	w := twoPanels(t)
	group := testdb.Group(t, w.s, "Germany", testdb.Source{PanelID: w.panelA, PanelGroupID: 2, AllHosts: true})
	id, username := testdb.Subscription(t, w.s, testdb.Sub{PlanID: w.plan, Limit: ptr(50 * gb), Groups: []string{group}, Copies: []testdb.Copy{
		{PanelID: w.panelA, PanelUserID: ptr(int64(1)), Status: "active", Limit: ptr(50 * gb), GroupIDs: []int64{2}},
	}})
	onPanel(w.a, username, "active", 50*gb, 0, ptr(time.Now().Add(240*time.Hour)))
	sync := newSyncer(w.s)

	testdb.SetSources(t, w.s, group, testdb.Source{PanelID: w.panelA, PanelGroupID: 2, AllHosts: true}, testdb.Source{PanelID: w.panelA, PanelGroupID: 7, AllHosts: true})
	if _, err := sync.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if got := w.a.User(username).GroupIDs; len(got) != 2 {
		t.Fatalf("groups %v; want 2 and 7", got)
	}

	testdb.SetSources(t, w.s, group, testdb.Source{PanelID: w.panelA, PanelGroupID: 7, AllHosts: true}, testdb.Source{PanelID: w.panelB, PanelGroupID: 2, AllHosts: true})
	result, err := sync.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got := w.a.User(username).GroupIDs; len(got) != 1 || got[0] != 7 {
		t.Fatalf("groups on A %v; want only 7", got)
	}
	if made := w.b.User(username); made == nil || made.GroupIDs[0] != 2 {
		t.Fatalf("on B %+v; want made with group 2", made)
	}
	if result.Made != 1 || testdb.Count(t, w.s, `select count(*) from subscription_panels where subscription_id = $1`, id) != 2 {
		t.Fatalf("result %+v", result)
	}

	again, err := sync.Run(ctx)
	if err != nil || again.Aligned != 0 || again.Made != 0 {
		t.Fatalf("a sync after that finds nothing to align: %+v, %v", again, err)
	}
}

func TestPanelUsersNotOursAreLeftAlone(t *testing.T) {
	w := twoPanels(t)
	w.aSubscription(t, gb, 0)
	onPanel(w.a, "skprobe_g2", "active", 0, 0, nil)
	onPanel(w.a, "someone_else", "active", gb, gb, nil)

	result, err := newSyncer(w.s).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Panels[w.panelA].Seen != 1 {
		t.Fatalf("seen %d; want only the shop's own customer", result.Panels[w.panelA].Seen)
	}
	if w.a.CallCount("PUT /api/user/by-username/someone_else") != 0 || w.a.CallCount("PUT /api/user/by-username/skprobe_g2") != 0 {
		t.Fatal("touched a user that is not a customer's")
	}
}

func TestReadsManyUsersPageByPage(t *testing.T) {
	w := twoPanels(t)
	w.a.PageSize = 7
	var ids []string
	for range 20 {
		id, username := testdb.Subscription(t, w.s, testdb.Sub{PlanID: w.plan, Limit: ptr(50 * gb), Copies: []testdb.Copy{
			{PanelID: w.panelA, PanelUserID: ptr(int64(1)), Status: "active", Limit: ptr(50 * gb)},
		}})
		onPanel(w.a, username, "active", 50*gb, gb, ptr(time.Now().Add(240*time.Hour)))
		ids = append(ids, id)
	}
	sync := newSyncer(w.s)
	sync.PageSize = 7

	result, err := sync.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Panels[w.panelA].Seen != 20 || result.Written != 20 {
		t.Fatalf("result %+v", result)
	}
	if w.a.CallCount("GET /api/users") != 3 {
		t.Fatalf("asked %d pages; want 3 of 7", w.a.CallCount("GET /api/users"))
	}
}

func TestTwoSyncsDoNotRunAtOnce(t *testing.T) {
	w := twoPanels(t)
	conn, err := w.s.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `select pg_advisory_lock($1)`, int64(0x534b53594e43)); err != nil {
		t.Fatal(err)
	}
	if _, err := newSyncer(w.s).RunLocked(ctx); err != syncer.ErrBusy {
		t.Fatalf("got %v; want ErrBusy while another holds the lock", err)
	}
	if _, err := conn.Exec(ctx, `select pg_advisory_unlock($1)`, int64(0x534b53594e43)); err != nil {
		t.Fatal(err)
	}
	if _, err := newSyncer(w.s).RunLocked(ctx); err != nil {
		t.Fatal(err)
	}
}
