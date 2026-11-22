package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/danialrahimian/shahkelid/panel/internal/configs"
)

// LinkSubscription is what the customer's link needs of a subscription.
type LinkSubscription struct {
	ID                    string
	MainPanelID           string
	Username              string
	Status                string
	UsedBytes             int64
	DataLimitBytes        *int64
	ExpiresAt             *time.Time
	OnHoldDurationSeconds *int64
	// The main panel's own subscription domain, if it names one.
	SubscriptionBaseURL *string
	// Its panels' subscription links, the main panel first.
	Panels []LinkPanel
}

// LinkPanel is one of a subscription's panels, for its link.
type LinkPanel struct {
	PanelID string
	URL     string
}

// gone are the statuses whose link is not served.
var gone = []string{"deleted", "provisioning", "provisioning_failed"}

// SubscriptionByToken reads the subscription a link's token opens, or
// ErrNotFound. Two queries, by the token's unique index and the copies'
// primary key.
func (s *Store) SubscriptionByToken(ctx context.Context, token string) (LinkSubscription, error) {
	var x LinkSubscription
	err := s.Pool.QueryRow(ctx, `
		select s.id::text, s.panel_id::text, s.panel_username, s.status::text, s.used_bytes, s.data_limit_bytes,
			s.expires_at, s.on_hold_duration_seconds::bigint, p.subscription_base_url
		from subscriptions s
		join panels p on p.id = s.panel_id
		where s.access_token = $1 and not (s.status::text = any($2))`, token, gone).Scan(
		&x.ID, &x.MainPanelID, &x.Username, &x.Status, &x.UsedBytes, &x.DataLimitBytes,
		&x.ExpiresAt, &x.OnHoldDurationSeconds, &x.SubscriptionBaseURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return x, ErrNotFound
	}
	if err != nil {
		return x, err
	}
	rows, err := s.Pool.Query(ctx, `
		select panel_id::text, panel_subscription_url
		from subscription_panels
		where subscription_id = $1 and panel_subscription_url is not null
		order by (panel_id = $2::uuid) desc, created_at, panel_id`, x.ID, x.MainPanelID)
	if err != nil {
		return x, err
	}
	x.Panels, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (LinkPanel, error) {
		var p LinkPanel
		return p, row.Scan(&p.PanelID, &p.URL)
	})
	return x, err
}

// GroupSource is a panel group one of the customer's groups takes.
type GroupSource struct {
	GroupID      string
	PanelID      string
	PanelGroupID int64
	AllHosts     bool
}

// GroupHost is what a group says about one host: picked, named, placed,
// and what the host was when last seen (to find it again when the panel
// renames it). A group keeps a row for every host it has seen.
type GroupHost struct {
	GroupID     string
	PanelID     string
	HostID      string
	Selected    bool
	Name        *string
	SortOrder   *int64
	Fingerprint configs.Fingerprint
}

// Saved is the row as configs.Settle reads it.
func (h GroupHost) Saved() configs.Saved {
	return configs.Saved{HostID: h.HostID, Fingerprint: h.Fingerprint}
}

const groupHostColumns = `group_id::text, panel_id::text, host_id, selected, name, sort_order::bigint,
	fp_name, fp_protocol, fp_network, fp_server, fp_port::bigint, fp_path, fp_sni`

func scanGroupHost(row pgx.CollectableRow) (GroupHost, error) {
	var x GroupHost
	var name *string
	f := &x.Fingerprint
	err := row.Scan(&x.GroupID, &x.PanelID, &x.HostID, &x.Selected, &x.Name, &x.SortOrder,
		&name, &f.Protocol, &f.Network, &f.Server, &f.Port, &f.Path, &f.SNI)
	if name != nil {
		f.Name = *name
	}
	return x, err
}

// LinkGroups is a subscription's groups, in their order, with their
// sources (in theirs) and what each says about its hosts.
type LinkGroups struct {
	GroupIDs []string
	Sources  []GroupSource
	Hosts    []GroupHost
}

// GroupsOfSubscription reads a subscription's groups for its link.
func (s *Store) GroupsOfSubscription(ctx context.Context, subscriptionID string) (LinkGroups, error) {
	var out LinkGroups
	rows, err := s.Pool.Query(ctx, `
		select g.id::text
		from subscription_groups sg
		join groups g on g.id = sg.group_id
		where sg.subscription_id = $1
		order by g.sort_order, g.name`, subscriptionID)
	if err != nil {
		return out, err
	}
	if out.GroupIDs, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil || len(out.GroupIDs) == 0 {
		return out, err
	}
	rows, err = s.Pool.Query(ctx, `
		select gs.group_id::text, gs.panel_id::text, gs.panel_group_id::bigint, gs.all_hosts
		from group_sources gs
		join panels p on p.id = gs.panel_id
		where gs.group_id = any($1::uuid[])
		order by gs.sort_order, p.name, gs.panel_group_id`, out.GroupIDs)
	if err != nil {
		return out, err
	}
	out.Sources, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (GroupSource, error) {
		var x GroupSource
		return x, row.Scan(&x.GroupID, &x.PanelID, &x.PanelGroupID, &x.AllHosts)
	})
	if err != nil {
		return out, err
	}
	rows, err = s.Pool.Query(ctx, `select `+groupHostColumns+` from group_hosts where group_id = any($1::uuid[])`, out.GroupIDs)
	if err != nil {
		return out, err
	}
	out.Hosts, err = pgx.CollectRows(rows, scanGroupHost)
	return out, err
}
