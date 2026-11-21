package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/danialrahimian/shahkelid/panel/internal/usage"
)

// Misaligned lists live subscriptions whose panel users' groups differ from
// what their groups now give: a panel group taken into or out of one of
// their groups, or a panel newly taken from. One query for the whole fleet.
//
// A subscription that carries no group (made before groups) is left out:
// it is left as it is rather than emptied.
func (s *Store) Misaligned(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		with grouped as (
			select distinct sg.subscription_id
			from subscription_groups sg
			join subscriptions s on s.id = sg.subscription_id and s.status::text = any($1)
		),
		desired as (
			select sg.subscription_id, gs.panel_id,
				array_agg(distinct gs.panel_group_id order by gs.panel_group_id) as ids
			from subscription_groups sg
			join grouped g on g.subscription_id = sg.subscription_id
			join group_sources gs on gs.group_id = sg.group_id
			join panels p on p.id = gs.panel_id and p.is_active
			group by sg.subscription_id, gs.panel_id
		),
		current as (
			select m.subscription_id, m.panel_id,
				coalesce((select array_agg(x order by x) from unnest(m.group_ids) x), '{}') as ids
			from subscription_panels m
			join grouped g on g.subscription_id = m.subscription_id
			join panels p on p.id = m.panel_id and p.is_active
		)
		select distinct coalesce(d.subscription_id, c.subscription_id)::text
		from desired d
		full join current c on c.subscription_id = d.subscription_id and c.panel_id = d.panel_id
		where c.subscription_id is null or coalesce(d.ids, '{}') <> c.ids`, usage.Synced)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// DesiredGroups gives, for each subscription, the panel groups its groups
// take on each active panel: subscription id → panel id → panel group ids
// (sorted). A subscription that carries no group is absent.
func (s *Store) DesiredGroups(ctx context.Context, subscriptionIDs []string) (map[string]map[string][]int64, error) {
	rows, err := s.Pool.Query(ctx, `
		select sg.subscription_id::text, gs.panel_id::text,
			array_agg(distinct gs.panel_group_id::bigint order by gs.panel_group_id::bigint)
		from subscription_groups sg
		join group_sources gs on gs.group_id = sg.group_id
		join panels p on p.id = gs.panel_id and p.is_active
		where sg.subscription_id = any($1::uuid[])
		group by sg.subscription_id, gs.panel_id`, subscriptionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string][]int64{}
	for rows.Next() {
		var subscription, panel string
		var ids []int64
		if err := rows.Scan(&subscription, &panel, &ids); err != nil {
			return nil, err
		}
		if out[subscription] == nil {
			out[subscription] = map[string][]int64{}
		}
		out[subscription][panel] = ids
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Carrying groups that take nothing on any active panel: present, empty.
	carried, err := s.Pool.Query(ctx, `
		select distinct subscription_id::text from subscription_groups where subscription_id = any($1::uuid[])`, subscriptionIDs)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(carried, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if out[id] == nil {
			out[id] = map[string][]int64{}
		}
	}
	return out, nil
}

// Pending is a panel copy of a live subscription whose user is not on that
// panel yet (the panel was down at purchase, or a group took a new panel),
// with what making it needs.
type Pending struct {
	usage.Member
	Username        string
	DataLimit       *int64
	DeviceLimit     *int64
	DurationSeconds int64
	TrafficReset    string
	// UsedElsewhere is what its other panels have counted: a panel joining
	// late gets what is left, not the whole volume again.
	UsedElsewhere int64
}

// PendingMembers lists the copies to make on active panels, for the given
// subscriptions (all live ones when ids is nil).
func (s *Store) PendingMembers(ctx context.Context, ids []string) ([]Pending, error) {
	rows, err := s.Pool.Query(ctx, `
		select `+memberColumns+`, s.panel_username, s.data_limit_bytes, s.device_limit::bigint,
			(pl.duration_days * 86400)::bigint, pl.traffic_reset::text,
			coalesce((select sum(o.used_bytes) from subscription_panels o
				where o.subscription_id = m.subscription_id and o.panel_user_id is not null), 0)::bigint
		from subscription_panels m
		join subscriptions s on s.id = m.subscription_id
		join plans pl on pl.id = s.plan_id
		join panels p on p.id = m.panel_id and p.is_active
		where m.panel_user_id is null and s.status::text = any($1)
			and ($2::uuid[] is null or m.subscription_id = any($2::uuid[]))
		order by m.created_at`, usage.Synced, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Pending
	for rows.Next() {
		var p Pending
		m, err := scanMember(rows, &p.Username, &p.DataLimit, &p.DeviceLimit, &p.DurationSeconds, &p.TrafficReset, &p.UsedElsewhere)
		if err != nil {
			return nil, err
		}
		p.Member = m
		out = append(out, p)
	}
	return out, rows.Err()
}
