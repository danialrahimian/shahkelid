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
`skprobe_g<id>` (in PasarGuard's Xray format, which carries every host,
else as links).

**When the panel's hosts change.** A host's id is made from its protocol,
transport and name only: PasarGuard picks addresses, ports, server names
and paths at random from a host's lists on every request, so those would
not stay put. A group keeps a row for every host it has seen, with what
the host was (`group_hosts.fp_*`); each read settles those rows against
what the panel gives now (`configs.Settle`, the same in the Node app): a
new host is recorded (picked only if its panel group takes all hosts); a
host renamed on the panel gets the settings saved for the old name when it
is plainly the same host (same protocol and transport, and a name much
alike or the same address or server name); a host deleted on the panel
leaves its settings in place for if it comes back and never hands them to
a sibling. Settings saved under the id earlier releases gave are moved.
Changes are written under a lock on the group, only when there are any.

**Subscription domains.** Staff add the shop's own domains for links in
the Node app (Panels page; `subscription_domains`). Links are made on the
primary one (a panel's own subscription domain still wins for its
customers). Caddy takes a certificate for such a name on its first visit,
after asking `GET /internal/tls-ask?domain=` here (200 only for a
subscription domain or a panel's own), and serves only `/s/…` on it.
`/s/_check` answers a fixed text, for the staff page's check.

Every app is served what it reads: base64 or plain links (with the header
lines PasarGuard may write into the body kept, and the panel's address in
them swapped for the shop's), Xray JSON, sing-box (outbounds and
endpoints), Clash/Mihomo, Outline. Customers whose service has stopped
still get the notice configs the panel gives them. `HEAD` is answered
from a `GET` to the panel (PasarGuard answers `GET` only). Requests are
limited per address and link (120 a minute), and ten times that per
address across links, as mobile carriers put many customers behind one
address.

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
