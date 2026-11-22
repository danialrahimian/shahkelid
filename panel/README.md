# Panel service

The shop's VPN-panel side, in Go. It does two things, on the same database
as the Node app:

- **Customers' subscription links** (`/s/{token}`). Every panel the
  subscription is on is asked at once, and the answers come back as one,
  shaped by the customer's groups: hosts picked, renamed (PasarGuard's
  variables filled in from the whole subscription) and ordered, in the
  format the app reads. Apps built on Xray-core (v2rayNG, v2rayN,
  Streisand, Happ, v2RayTun…) get full Xray configs where their version
  reads them, so fragment, noise, mux and xhttp settings reach them. The
  link's page, `/info` and `/apps` are passed to the Node app.
- **The usage sync**, every few minutes. Every active panel's users are
  read in parallel; volume, time and status are worked out in memory (one
  volume and one clock across a subscription's panels); limit changes go
  to the panels in parallel; and only what changed is written, in a few
  batched statements. Along the way it makes users on panels a
  subscription is not on yet, and sets panel users' groups after staff
  change a group.

Panel accounts of a reseller cannot read the panel's hosts: each panel
group's hosts are read from a panel user the shop keeps in it,
`skprobe_g<id>`.

## Layout

| Package | What it is |
|---|---|
| `cmd/panel` | the service: HTTP server, sync loop, housekeeping, `-health` |
| `internal/config` | settings from the environment (the same `.env` as the Node app) |
| `internal/secretbox` | opens the panel credentials the Node app sealed |
| `internal/pasarguard` | the PasarGuard API client |
| `internal/panels` | one kept client per panel row |
| `internal/usage` | volume, time and status of a subscription from its panels (pure) |
| `internal/syncer` | the fleet sync |
| `internal/configs` | matching configs to hosts, PasarGuard's variables, shaping each format |
| `internal/link` | `/s/{token}`: apps, the hosts catalog, plans, the handler |
| `internal/store` | the database queries |
| `internal/fakepanel`, `internal/testdb` | for tests: a PasarGuard panel over HTTP, the test database |

## Settings

| Variable | Default | |
|---|---|---|
| `POSTGRES_URL` | (required) | the shop's database |
| `APP_ENCRYPTION_KEY` | (required) | the Node app's, to open panel credentials |
| `PUBLIC_API_URL` | `http://localhost:5000` | makes `{PUBLIC_API_URL}/s/{token}` |
| `PANEL_APP_URL` | `http://localhost:5000` | the Node app, for a link's page, `/info`, `/apps` |
| `PANEL_LISTEN` | `:7000` | |
| `USAGE_SYNC_EVERY_MS` | `300000` | `0` turns the sync off |
| `PANEL_SYNC_PANELS_AT_ONCE` | `8` | panels read in parallel |
| `PANEL_SYNC_CHANGES_AT_ONCE` | `16` | limit changes sent to one panel in parallel |
| `FIRST_USE_DEADLINE_DAYS` | `30` | |

## Tests

They use the Node app's test database (`shah_kelid_test`, migrated by
`npm test -w back-end`) and are skipped without it. Packages share it, so
one at a time:

```bash
go vet ./... && go test -p 1 -race ./...
PANEL_BENCH_USERS=5000 go test -p 1 -run TestSyncCost -v ./internal/syncer/   # what a sync costs
```

On 5,000 subscriptions, against the Node sync it replaced (same scenario):

| | Node (before) | Go |
|---|---|---|
| everyone used 1 GB | 11.35 s, 20,031 transactions, 10.6 MB WAL | 0.32 s, 21 transactions, 7.2 MB WAL |
| nothing new | 10,000 rows rewritten, 6.7 MB WAL | 0 rows, 19 KB WAL |
| a tenth used more | 1.46 s, 2,007 transactions, 7.0 MB WAL | 0.12 s, 10 transactions, 0.5 MB WAL |
