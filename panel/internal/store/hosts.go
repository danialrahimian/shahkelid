package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/danialrahimian/shahkelid/panel/internal/configs"
)

// SettleHosts settles what a group has saved about one panel's hosts
// against what that panel gives now (configs.Settle): records the hosts it
// has not seen, moves settings to a renamed host or off an id earlier
// releases gave, and keeps each host's fingerprint. It holds a lock on the
// group meanwhile, so the Node app (which settles the same way on the
// staff pages) and other links agree, and gives the group's rows for that
// panel after.
func (s *Store) SettleHosts(ctx context.Context, groupID, panelID string, hosts []configs.Host) ([]GroupHost, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	if _, err := tx.Exec(ctx, `select 1 from groups where id = $1 for update`, groupID); err != nil {
		return nil, err
	}
	read := func() ([]GroupHost, error) {
		rows, err := tx.Query(ctx, `select `+groupHostColumns+` from group_hosts where group_id = $1 and panel_id = $2`, groupID, panelID)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, scanGroupHost)
	}
	rows, err := read()
	if err != nil {
		return nil, err
	}
	saved := make([]configs.Saved, len(rows))
	for i, row := range rows {
		saved[i] = row.Saved()
	}
	settlement := configs.Settle(saved, hosts)
	if settlement.Settled() {
		return rows, tx.Commit(ctx)
	}

	byID := map[string]configs.Host{}
	for _, host := range hosts {
		byID[host.ID] = host
	}
	fp := func(host configs.Host) []any {
		f := host.Fingerprint
		return []any{f.Name, f.Protocol, f.Network, f.Server, f.Port, f.Path, f.SNI}
	}
	const set = `fp_name = $4, fp_protocol = $5, fp_network = $6, fp_server = $7, fp_port = $8, fp_path = $9, fp_sni = $10`
	batch := &pgx.Batch{}
	for from, to := range settlement.Moves {
		batch.Queue(`update group_hosts set host_id = $11, `+set+` where group_id = $1 and panel_id = $2 and host_id = $3`,
			append(append([]any{groupID, panelID, from}, fp(byID[to])...), to)...)
	}
	for _, id := range settlement.Fill {
		batch.Queue(`update group_hosts set `+set+` where group_id = $1 and panel_id = $2 and host_id = $3`,
			append([]any{groupID, panelID, id}, fp(byID[id])...)...)
	}
	for _, host := range settlement.Fresh {
		batch.Queue(`insert into group_hosts (group_id, panel_id, host_id, fp_name, fp_protocol, fp_network, fp_server, fp_port, fp_path, fp_sni)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing`,
			append([]any{groupID, panelID, host.ID}, fp(host)...)...)
	}
	if err := tx.SendBatch(ctx, batch).Close(); err != nil {
		return nil, err
	}
	if rows, err = read(); err != nil {
		return nil, err
	}
	return rows, tx.Commit(ctx)
}
