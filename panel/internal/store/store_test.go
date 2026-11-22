package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/testdb"
)

func ptr[T any](v T) *T { return &v }

func TestPruneDeletedKeepsTheRecentAndTheLive(t *testing.T) {
	s := testdb.Open(t)
	ctx := context.Background()
	panel := testdb.Panel(t, s, "A", "https://a.test")
	plan := testdb.Plan(t, s)
	group := testdb.Group(t, s, "G", testdb.Source{PanelID: panel, PanelGroupID: 2, AllHosts: true})
	sub := func(status string, age time.Duration) string {
		id, _ := testdb.Subscription(t, s, testdb.Sub{PlanID: plan, Status: status, Groups: []string{group}, Copies: []testdb.Copy{{PanelID: panel, PanelUserID: ptr(int64(1))}}})
		if _, err := s.Pool.Exec(ctx, `update subscriptions set updated_at = now() - $2::interval where id = $1`, id, age.String()); err != nil {
			t.Fatal(err)
		}
		return id
	}
	old := sub("deleted", 40*24*time.Hour)
	recent := sub("deleted", 2*24*time.Hour)
	live := sub("active", 400*24*time.Hour)

	removed, err := s.PruneDeleted(ctx, 30*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	if removed != 2 {
		t.Fatalf("removed %d rows; want the old one's copy and group link", removed)
	}
	for id, want := range map[string]int{old: 0, recent: 1, live: 1} {
		if got := testdb.Count(t, s, `select count(*) from subscription_panels where subscription_id = $1`, id); got != want {
			t.Errorf("%s: %d copies; want %d", id, got, want)
		}
	}
	if testdb.Count(t, s, `select count(*) from subscriptions where id = $1`, old) != 1 {
		t.Fatal("the subscription row itself is kept")
	}
}
