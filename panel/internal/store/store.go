// Package store reads and writes the shop's database (shared with the Node
// app, whose migrations own the schema) for the panel service.
//
// Writes that touch many rows go in one statement per batch: the rows are
// sent as one JSON array and read with jsonb_to_recordset, so a sync of tens
// of thousands of subscriptions is a handful of round trips, not one per row.
// Only rows whose values changed are written.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/danialrahimian/shahkelid/panel/internal/usage"
)

// Store is the database. It is safe for concurrent use.
type Store struct {
	Pool *pgxpool.Pool
}

// Open connects to PostgreSQL.
func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("could not reach the database: %w", err)
	}
	return &Store{Pool: pool}, nil
}

// Close closes the pool.
func (s *Store) Close() { s.Pool.Close() }

// batchSize bounds one statement's rows.
const batchSize = 5000

// ------------------------------------------------------------------ panels

// Panel is a panels row, as far as the service needs it.
type Panel struct {
	ID                  string
	Name                string
	Driver              string
	BaseURL             string
	CredentialsSealed   []byte
	SubscriptionBaseURL *string
}

const panelColumns = `id::text, name, driver::text, base_url, credentials_enc, subscription_base_url`

func scanPanel(row pgx.Row) (Panel, error) {
	var p Panel
	err := row.Scan(&p.ID, &p.Name, &p.Driver, &p.BaseURL, &p.CredentialsSealed, &p.SubscriptionBaseURL)
	return p, err
}

// ActivePanels lists the panels switched on.
func (s *Store) ActivePanels(ctx context.Context) ([]Panel, error) {
	rows, err := s.Pool.Query(ctx, `select `+panelColumns+` from panels where is_active order by name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Panel, error) { return scanPanel(row) })
}

// FindPanel reads one panel.
func (s *Store) FindPanel(ctx context.Context, id string) (Panel, error) {
	return scanPanel(s.Pool.QueryRow(ctx, `select `+panelColumns+` from panels where id = $1`, id))
}

// MarkPanel records the outcome of reading a panel: when it last answered,
// or why it did not.
func (s *Store) MarkPanel(ctx context.Context, id string, failure error) error {
	if failure == nil {
		_, err := s.Pool.Exec(ctx, `update panels set last_ok_at = now(), last_error = null where id = $1`, id)
		return err
	}
	_, err := s.Pool.Exec(ctx, `update panels set last_error = left($2, 500) where id = $1`, id, failure.Error())
	return err
}

// ----------------------------------------------------------------- members

// Owned is a panel's copy of a live subscription, with the panel username
// its user goes by.
type Owned struct {
	usage.Member
	Username string
}

const memberColumns = `m.subscription_id::text, m.panel_id::text, m.panel_user_id::bigint, m.panel_subscription_url,
	m.panel_status, m.data_limit_bytes, m.used_bytes, m.lifetime_used_bytes, m.expires_at,
	m.on_hold_duration_seconds::bigint, m.online_at, m.last_error, m.group_ids::bigint[]`

func scanMember(row pgx.Row, extra ...any) (usage.Member, error) {
	var m usage.Member
	dest := append([]any{&m.SubscriptionID, &m.PanelID, &m.PanelUserID, &m.PanelSubscriptionURL,
		&m.PanelStatus, &m.DataLimitBytes, &m.UsedBytes, &m.LifetimeUsedBytes, &m.ExpiresAt,
		&m.OnHoldDurationSeconds, &m.OnlineAt, &m.LastError, &m.GroupIDs}, extra...)
	err := row.Scan(dest...)
	return m, err
}

// LiveMembers reads every live subscription's copy on the given panels, by
// panel id then by panel username: one query for the whole sync.
func (s *Store) LiveMembers(ctx context.Context, panelIDs []string) (map[string]map[string]Owned, error) {
	rows, err := s.Pool.Query(ctx, `
		select `+memberColumns+`, s.panel_username
		from subscription_panels m
		join subscriptions s on s.id = m.subscription_id
		where m.panel_id = any($1::uuid[]) and s.status::text = any($2)`, panelIDs, usage.Synced)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]Owned{}
	for rows.Next() {
		var owned Owned
		m, err := scanMember(rows, &owned.Username)
		if err != nil {
			return nil, err
		}
		owned.Member = m
		if out[m.PanelID] == nil {
			out[m.PanelID] = map[string]Owned{}
		}
		out[m.PanelID][owned.Username] = owned
	}
	return out, rows.Err()
}

// MembersOf reads the copies of the given subscriptions, by subscription,
// each list in the order the panels were added.
func (s *Store) MembersOf(ctx context.Context, subscriptionIDs []string) (map[string][]usage.Member, error) {
	rows, err := s.Pool.Query(ctx, `
		select `+memberColumns+`
		from subscription_panels m
		where m.subscription_id = any($1::uuid[])
		order by m.created_at, m.panel_id`, subscriptionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]usage.Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out[m.SubscriptionID] = append(out[m.SubscriptionID], m)
	}
	return out, rows.Err()
}

type memberRow struct {
	SubscriptionID        string     `json:"sid"`
	PanelID               string     `json:"pid"`
	PanelUserID           *int64     `json:"panel_user_id"`
	PanelSubscriptionURL  *string    `json:"panel_subscription_url"`
	PanelStatus           *string    `json:"panel_status"`
	DataLimitBytes        *int64     `json:"data_limit_bytes"`
	UsedBytes             int64      `json:"used_bytes"`
	LifetimeUsedBytes     int64      `json:"lifetime_used_bytes"`
	ExpiresAt             *time.Time `json:"expires_at"`
	OnHoldDurationSeconds *int64     `json:"on_hold_duration_seconds"`
	OnlineAt              *time.Time `json:"online_at"`
	LastError             *string    `json:"last_error"`
	GroupIDs              []int64    `json:"group_ids"`
}

// SaveMembers writes panel copies, in batches: every column the panel
// decides, the last error and the groups.
func (s *Store) SaveMembers(ctx context.Context, members []usage.Member) error {
	for start := 0; start < len(members); start += batchSize {
		end := min(start+batchSize, len(members))
		rows := make([]memberRow, 0, end-start)
		for _, m := range members[start:end] {
			groups := m.GroupIDs
			if groups == nil {
				groups = []int64{}
			}
			rows = append(rows, memberRow{m.SubscriptionID, m.PanelID, m.PanelUserID, m.PanelSubscriptionURL,
				m.PanelStatus, m.DataLimitBytes, m.UsedBytes, m.LifetimeUsedBytes, m.ExpiresAt,
				m.OnHoldDurationSeconds, m.OnlineAt, m.LastError, groups})
		}
		payload, err := json.Marshal(rows)
		if err != nil {
			return err
		}
		_, err = s.Pool.Exec(ctx, `
			update subscription_panels m set
				panel_user_id = v.panel_user_id,
				panel_subscription_url = v.panel_subscription_url,
				panel_status = v.panel_status,
				data_limit_bytes = v.data_limit_bytes,
				used_bytes = v.used_bytes,
				lifetime_used_bytes = v.lifetime_used_bytes,
				expires_at = v.expires_at,
				on_hold_duration_seconds = v.on_hold_duration_seconds,
				online_at = v.online_at,
				last_error = v.last_error,
				group_ids = v.group_ids::integer[],
				last_synced_at = now(),
				updated_at = now()
			from jsonb_to_recordset($1::jsonb) as v(
				sid uuid, pid uuid, panel_user_id integer, panel_subscription_url text, panel_status text,
				data_limit_bytes bigint, used_bytes bigint, lifetime_used_bytes bigint, expires_at timestamptz,
				on_hold_duration_seconds integer, online_at timestamptz, last_error text, group_ids bigint[])
			where m.subscription_id = v.sid and m.panel_id = v.pid`, payload)
		if err != nil {
			return fmt.Errorf("saving panel copies: %w", err)
		}
	}
	return nil
}

// AddMembers adds panel copies not made yet (a group took a new panel).
// A copy already there is left as it is.
func (s *Store) AddMembers(ctx context.Context, members []usage.Member) error {
	if len(members) == 0 {
		return nil
	}
	type row struct {
		SubscriptionID string  `json:"sid"`
		PanelID        string  `json:"pid"`
		DataLimitBytes *int64  `json:"data_limit_bytes"`
		GroupIDs       []int64 `json:"group_ids"`
	}
	rows := make([]row, len(members))
	for i, m := range members {
		rows[i] = row{m.SubscriptionID, m.PanelID, m.DataLimitBytes, m.GroupIDs}
	}
	payload, err := json.Marshal(rows)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		insert into subscription_panels (subscription_id, panel_id, data_limit_bytes, group_ids)
		select sid, pid, data_limit_bytes, group_ids::integer[]
		from jsonb_to_recordset($1::jsonb) as v(sid uuid, pid uuid, data_limit_bytes bigint, group_ids bigint[])
		on conflict do nothing`, payload)
	return err
}

// ----------------------------------------------------------- subscriptions

// Subscription is what reconciling needs of a subscription row.
type Subscription struct {
	ID          string
	MainPanelID string
	Username    string
	Status      string
	PlanID      string
	DataLimit   *int64
	DeviceLimit *int64
	usage.Subscription
}

const subscriptionColumns = `s.id::text, s.panel_id::text, s.panel_username, s.status::text, s.plan_id::text,
	s.data_limit_bytes, s.device_limit::bigint, s.used_bytes, s.lifetime_used_bytes, s.online_at, s.expires_at,
	s.on_hold_duration_seconds::bigint, s.panel_user_id::bigint, s.panel_subscription_url, s.last_error`

func scanSubscription(row pgx.Row) (Subscription, error) {
	var x Subscription
	err := row.Scan(&x.ID, &x.MainPanelID, &x.Username, &x.Status, &x.PlanID, &x.DataLimit, &x.DeviceLimit,
		&x.UsedBytes, &x.LifetimeUsedBytes, &x.OnlineAt, &x.ExpiresAt, &x.OnHoldDurationSeconds,
		&x.PanelUserID, &x.PanelSubscriptionURL, &x.LastError)
	return x, err
}

// Subscriptions reads subscriptions by id.
func (s *Store) Subscriptions(ctx context.Context, ids []string) ([]Subscription, error) {
	rows, err := s.Pool.Query(ctx, `select `+subscriptionColumns+` from subscriptions s where s.id = any($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Subscription, error) { return scanSubscription(row) })
}

// SubscriptionUpdate is a subscription's new columns, and its status before.
type SubscriptionUpdate struct {
	ID       string
	Was      string
	WasError *string
	usage.Subscription
}

// SaveSubscriptions writes subscriptions' columns, only while the panels
// still decide them (staff, or an account being deleted, may have deleted
// one meanwhile; that must not be undone), and records in their history a
// change of status and, once, a user gone from a panel. It returns the ids
// written.
func (s *Store) SaveSubscriptions(ctx context.Context, updates []SubscriptionUpdate) ([]string, error) {
	type row struct {
		ID                    string     `json:"id"`
		Status                string     `json:"status"`
		UsedBytes             int64      `json:"used_bytes"`
		LifetimeUsedBytes     int64      `json:"lifetime_used_bytes"`
		OnlineAt              *time.Time `json:"online_at"`
		ExpiresAt             *time.Time `json:"expires_at"`
		OnHoldDurationSeconds *int64     `json:"on_hold_duration_seconds"`
		PanelUserID           *int64     `json:"panel_user_id"`
		PanelSubscriptionURL  *string    `json:"panel_subscription_url"`
		LastError             *string    `json:"last_error"`
		Was                   string     `json:"was"`
		NewlyMissing          bool       `json:"newly_missing"`
	}
	var written []string
	for start := 0; start < len(updates); start += batchSize {
		end := min(start+batchSize, len(updates))
		values := make([]row, 0, end-start)
		for _, u := range updates[start:end] {
			newlyMissing := u.LastError != nil && *u.LastError == usage.Missing && (u.WasError == nil || *u.WasError != usage.Missing)
			values = append(values, row{u.ID, u.Status, u.UsedBytes, u.LifetimeUsedBytes, u.OnlineAt, u.ExpiresAt,
				u.OnHoldDurationSeconds, u.PanelUserID, u.PanelSubscriptionURL, u.LastError, u.Was, newlyMissing})
		}
		payload, err := json.Marshal(values)
		if err != nil {
			return nil, err
		}
		rows, err := s.Pool.Query(ctx, `
			with v as (
				select * from jsonb_to_recordset($1::jsonb) as v(
					id uuid, status text, used_bytes bigint, lifetime_used_bytes bigint, online_at timestamptz,
					expires_at timestamptz, on_hold_duration_seconds integer, panel_user_id integer,
					panel_subscription_url text, last_error text, was text, newly_missing boolean)
			),
			written as (
				update subscriptions s set
					status = v.status::subscription_status,
					used_bytes = v.used_bytes,
					lifetime_used_bytes = v.lifetime_used_bytes,
					online_at = v.online_at,
					expires_at = v.expires_at,
					on_hold_duration_seconds = v.on_hold_duration_seconds,
					panel_user_id = v.panel_user_id,
					panel_subscription_url = v.panel_subscription_url,
					last_error = v.last_error,
					last_synced_at = now(),
					updated_at = now()
				from v
				where s.id = v.id and s.status::text = any($2)
				returning s.id
			),
			changed as (
				insert into subscription_events (subscription_id, kind, actor_kind, details)
				select v.id, 'status_changed', 'system', jsonb_build_object('from', v.was, 'to', v.status)
				from v join written w on w.id = v.id
				where v.was <> v.status
			),
			missing as (
				insert into subscription_events (subscription_id, kind, actor_kind, details)
				select v.id, 'missing_on_panel', 'system', '{}'::jsonb
				from v join written w on w.id = v.id
				where v.newly_missing
			)
			select id::text from written`, payload, usage.Synced)
		if err != nil {
			return nil, fmt.Errorf("saving subscriptions: %w", err)
		}
		batch, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return nil, fmt.Errorf("saving subscriptions: %w", err)
		}
		written = append(written, batch...)
	}
	return written, nil
}

// ErrNotFound is returned when a row asked for is not there.
var ErrNotFound = errors.New("not found")

// PruneDeleted removes the panel copies and group links of subscriptions
// deleted more than keep ago. The subscription row stays (orders and
// tickets point at it, and it keeps its last totals); its copies only
// matter while it is live.
func (s *Store) PruneDeleted(ctx context.Context, keep time.Duration) (int64, error) {
	cutoff := time.Now().Add(-keep)
	copies, err := s.Pool.Exec(ctx, `
		delete from subscription_panels m using subscriptions s
		where s.id = m.subscription_id and s.status = 'deleted' and s.updated_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	groups, err := s.Pool.Exec(ctx, `
		delete from subscription_groups g using subscriptions s
		where s.id = g.subscription_id and s.status = 'deleted' and s.updated_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return copies.RowsAffected() + groups.RowsAffected(), nil
}
