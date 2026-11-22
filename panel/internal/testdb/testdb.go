// Package testdb gives tests the shop's test database (migrated by the Node
// app: npm test in back-end does it) and seeds what the panel service reads.
//
// It uses PANEL_TEST_DATABASE_URL, or the Node test database's default. Tests
// that need it are skipped when it cannot be reached. Packages share the
// database: run them one at a time (go test -p 1 ./...).
package testdb

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/secretbox"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
)

// Key seals the test panels' credentials.
var Key = make([]byte, 32)

const defaultURL = "postgres://shah_kelid:dev-only-password@127.0.0.1:5432/shah_kelid_test"

var counter atomic.Int64

// Open connects to the test database and empties what the panel service
// touches, or skips the test.
func Open(t testing.TB) *store.Store {
	t.Helper()
	url := os.Getenv("PANEL_TEST_DATABASE_URL")
	if url == "" {
		url = defaultURL
	}
	if !strings.Contains(url, "_test") {
		t.Fatalf("refusing to use %q: only a database named *_test is emptied by tests", url)
	}
	ctx := context.Background()
	s, err := store.Open(ctx, url)
	if err != nil {
		t.Skipf("no test database (%v); start PostgreSQL and run the back-end's migrations", err)
	}
	t.Cleanup(s.Close)
	var ready bool
	if err := s.Pool.QueryRow(ctx, `select to_regclass('public.subscription_panels') is not null`).Scan(&ready); err != nil || !ready {
		t.Skip("the test database has no schema; run the back-end's migrations (npm test in back-end)")
	}
	_, err = s.Pool.Exec(ctx, `truncate subscription_events, subscription_groups, subscription_panels, subscriptions,
		plan_groups, group_hosts, group_sources, groups, plans, panels cascade`)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func unique(prefix string) string {
	return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano()%1_000_000, counter.Add(1))
}

// Panel adds a panel at url signed in to with an API key.
func Panel(t testing.TB, s *store.Store, name, url string) string {
	t.Helper()
	sealed, err := secretbox.Seal([]byte(`{"kind":"password","username":"operator","password":"right"}`), Key)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	err = s.Pool.QueryRow(context.Background(),
		`insert into panels (name, driver, base_url, credentials_enc) values ($1, 'pasarguard', $2, $3) returning id::text`,
		name, url, sealed).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// Plan adds a 30-day plan.
func Plan(t testing.TB, s *store.Store) string {
	t.Helper()
	var id string
	slug := unique("plan")
	err := s.Pool.QueryRow(context.Background(),
		`insert into plans (slug, name, duration_days, price_toman) values ($1, $1, 30, 1000) returning id::text`, slug).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// Source is a panel group a group takes.
type Source struct {
	PanelID      string
	PanelGroupID int64
	AllHosts     bool
}

// Group adds one of our groups.
func Group(t testing.TB, s *store.Store, name string, sources ...Source) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := s.Pool.QueryRow(ctx, `insert into groups (name) values ($1) returning id::text`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	SetSources(t, s, id, sources...)
	return id
}

// SetSources replaces a group's sources.
func SetSources(t testing.TB, s *store.Store, groupID string, sources ...Source) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `delete from group_sources where group_id = $1`, groupID); err != nil {
		t.Fatal(err)
	}
	for i, source := range sources {
		_, err := s.Pool.Exec(ctx, `insert into group_sources (group_id, panel_id, panel_group_id, all_hosts, sort_order)
			values ($1, $2, $3, $4, $5)`, groupID, source.PanelID, source.PanelGroupID, source.AllHosts, i)
		if err != nil {
			t.Fatal(err)
		}
	}
}

// Copy is a subscription's copy on a panel.
type Copy struct {
	PanelID     string
	PanelUserID *int64
	Status      string
	Limit       *int64
	Used        int64
	ExpiresAt   *time.Time
	OnHold      *int64
	GroupIDs    []int64
	URL         string
}

// Sub describes a subscription to add.
type Sub struct {
	PlanID string
	Status string
	Limit  *int64
	// The main panel is the first copy's.
	Copies []Copy
	Groups []string
}

// Subscription adds a customer and a subscription with its copies, and
// returns its id and panel username.
func Subscription(t testing.TB, s *store.Store, sub Sub) (id, username string) {
	t.Helper()
	ctx := context.Background()
	email := unique("buyer") + "@example.com"
	var userID string
	err := s.Pool.QueryRow(ctx, `insert into users (email, email_normalized, referral_code) values ($1, $2, $3) returning id::text`,
		email, email, strings.ToUpper(unique("R"))).Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	username = "sk_" + strings.ReplaceAll(unique("t"), "-", "_")
	status := sub.Status
	if status == "" {
		status = "active"
	}
	err = s.Pool.QueryRow(ctx, `insert into subscriptions (user_id, plan_id, panel_id, panel_username, status, data_limit_bytes, access_token)
		values ($1, $2, $3, $4, $5, $6, $7) returning id::text`,
		userID, sub.PlanID, sub.Copies[0].PanelID, username, status, sub.Limit, unique("token-0123456789abcdef")).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range sub.Copies {
		groups := c.GroupIDs
		if groups == nil {
			groups = []int64{2}
		}
		var url *string
		if c.URL != "" {
			url = &c.URL
		}
		var panelStatus *string
		if c.Status != "" {
			panelStatus = &c.Status
		}
		_, err := s.Pool.Exec(ctx, `insert into subscription_panels (subscription_id, panel_id, panel_user_id, panel_status,
			data_limit_bytes, used_bytes, lifetime_used_bytes, expires_at, on_hold_duration_seconds, group_ids, panel_subscription_url)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::integer[], $11)`,
			id, c.PanelID, c.PanelUserID, panelStatus, c.Limit, c.Used, c.Used, c.ExpiresAt, c.OnHold, groups, url)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, group := range sub.Groups {
		if _, err := s.Pool.Exec(ctx, `insert into subscription_groups (subscription_id, group_id) values ($1, $2)`, id, group); err != nil {
			t.Fatal(err)
		}
	}
	return id, username
}

// Row reads one row of a query as a map, for assertions.
func Row(t testing.TB, s *store.Store, query string, args ...any) map[string]any {
	t.Helper()
	var raw []byte
	if err := s.Pool.QueryRow(context.Background(), `select to_jsonb(x) from (`+query+`) x`, args...).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// Count runs a count query.
func Count(t testing.TB, s *store.Store, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.Pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
