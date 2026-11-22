package syncer_test

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/fakepanel"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
	"github.com/danialrahimian/shahkelid/panel/internal/testdb"
)

// cost is what one sync cost the database.
type cost struct {
	took      time.Duration
	rows      int64 // rows updated in subscriptions and subscription_panels
	commits   int64 // transactions: about one per statement sent
	walBytes  int64
	reconcile int
}

func measure(t *testing.T, s *store.Store, run func()) cost {
	t.Helper()
	ctx := context.Background()
	read := func() (rows, commits int64, wal string) {
		_, _ = s.Pool.Exec(ctx, `select pg_stat_force_next_flush()`)
		time.Sleep(600 * time.Millisecond)
		conn, err := s.Pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Release()
		_, _ = conn.Exec(ctx, `select pg_stat_clear_snapshot()`)
		if err := conn.QueryRow(ctx, `select coalesce(sum(n_tup_upd), 0)::bigint from pg_stat_user_tables where relname in ('subscriptions', 'subscription_panels')`).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		if err := conn.QueryRow(ctx, `select xact_commit from pg_stat_database where datname = current_database()`).Scan(&commits); err != nil {
			t.Fatal(err)
		}
		if err := conn.QueryRow(ctx, `select pg_current_wal_lsn()::text`).Scan(&wal); err != nil {
			t.Fatal(err)
		}
		return
	}
	rows0, commits0, wal0 := read()
	started := time.Now()
	run()
	took := time.Since(started)
	rows1, commits1, wal1 := read()
	var walBytes int64
	if err := s.Pool.QueryRow(ctx, `select pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::bigint`, wal1, wal0).Scan(&walBytes); err != nil {
		t.Fatal(err)
	}
	// Reading the counters takes a few transactions of its own.
	return cost{took: took, rows: rows1 - rows0, commits: commits1 - commits0 - 3, walBytes: walBytes}
}

// TestSyncCost measures a sync of many subscriptions: the first (everyone
// used something), one with nothing new, and one where a tenth did. Run it
// with PANEL_BENCH_USERS=5000 (it is skipped otherwise).
func TestSyncCost(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("PANEL_BENCH_USERS"))
	if n == 0 {
		t.Skip("set PANEL_BENCH_USERS to measure")
	}
	s := testdb.Open(t)
	p := fakepanel.New()
	defer p.Close()
	panelID := testdb.Panel(t, s, "Bench", p.URL())
	plan := testdb.Plan(t, s)
	expires := time.Now().Add(240 * time.Hour).Truncate(time.Second)
	usernames := make([]string, n)
	for i := range n {
		_, username := testdb.Subscription(t, s, testdb.Sub{PlanID: plan, Limit: ptr(50 * gb), Copies: []testdb.Copy{
			{PanelID: panelID, PanelUserID: ptr(int64(i + 1)), Status: "active", Limit: ptr(50 * gb), ExpiresAt: &expires},
		}})
		onPanel(p, username, "active", 50*gb, 0, &expires)
		usernames[i] = username
	}
	sync := newSyncer(s)

	for i, step := range []struct {
		name string
		use  func()
	}{
		{"everyone used 1 GB", func() {
			for _, u := range usernames {
				p.Use(u, gb)
			}
		}},
		{"nothing new", func() {}},
		{"a tenth used 1 GB more", func() {
			for _, u := range usernames[:n/10] {
				p.Use(u, gb)
			}
		}},
	} {
		step.use()
		c := measure(t, s, func() {
			result, err := sync.Run(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if i == 0 && result.Written != n {
				t.Fatalf("written %d of %d", result.Written, n)
			}
		})
		fmt.Printf("go   %-24s %6d subs  %8.2fs  rows updated %7d  transactions %7d  WAL %8.1f KB\n",
			step.name, n, c.took.Seconds(), c.rows, c.commits, float64(c.walBytes)/1024)
	}
}
