# Shah Kelid API

Node.js, Express and TypeScript backend for the Shah Kelid store, on
PostgreSQL (Drizzle) with Redis (sessions, queues, rate limits). Structured
after [nodebestpractices](https://github.com/goldbergyoni/nodebestpractices)
and tested after
[nodejs-testing-best-practices](https://github.com/goldbergyoni/nodejs-testing-best-practices).

## Getting started

```bash
cp .env.example .env              # the defaults work for development
npm install
npm run db:migrate                # tables, built-in roles, first ticket categories
npm run create-owner -- you@example.com
npm run dev                       # the API, on :5000
npm run dev:worker                # the worker: outbox relay and queues
```

PostgreSQL and Redis come from `npm run services:up` at the repository root.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Runs the API. |
| `npm run dev` | Runs it, restarting on change. |
| `npm run worker` | Runs the worker: the outbox relay, the queue consumers and the schedules. |
| `npm run dev:worker` | The same, restarting on change. |
| `npm test` | Runs every suite against the test database (`shah_kelid_test`) and Redis database 1. |
| `npm run test:watch` | Reruns the suites on change. |
| `npm run test:contract` | The PasarGuard driver, the Zarinpal gateway (sandbox) and the M3, M4 and M5 acceptance tests, against the real services. Creates and deletes test users on the panel in `.env`; M5 sends test USDT on the Nile testnet. |
| `npm run create-owner -- <email>` | Makes the first owner. Refuses when one exists; `--another` adds one on purpose. |
| `npm run db:migrate` | Applies pending migrations, syncs the built-in roles, seeds ticket categories into an empty table. |
| `npm run db:generate` | Writes a new migration from changes to the module schemas. |
| `npm run typecheck` | Checks the TypeScript code. |
| `npm run audit` | Audits the production dependencies. |

There is deliberately no script that fabricates sales. A dashboard filled
with invented orders looks exactly like a real one and every figure on it is
wrong.

## Layout

The tree is organised by business module, each owning its tables, so
everything one feature needs sits in one folder.

```
index.js                 process entry point: the only file that listens
src/
  app.js                 builds the express app, never listens
  server.js              start / stop / graceful shutdown
  config/                every process.env read, validated once at boot
  http/v1.ts             mounts every module's routes under /api/v1
  entrypoints/worker.ts  the worker process
  libraries/             logger, SMTP mailer
  platform/              database, Redis, queues, outbox, HTTP guards, errors
  modules/
    access/ identity/ catalog/ infrastructure/ provisioning/ subscriptions/
    billing/ ledger/ files/ notifications/ support/ content/ crm/ reports/
        schema.ts         the module's tables
        service.ts        the rules; never sees req or res
        routes.ts         HTTP in, HTTP out
drizzle/                 migrations, applied in order
scripts/                 create-owner
test/
  helpers/               test server, HTTP client, accounts, fakes for the panel and gateways
  *.test.ts              one suite per business area; *.contract.test.ts against real services
```

## Errors

Every error the API answers with on purpose is an `ApiError` carrying a
status and a stable code (`{ "error": { "code": "ACCOUNT_LOCKED", ... } }`);
clients show their own words for each code. Anything else is a bug: it is
logged with its stack and answered as `INTERNAL` without internals. An error
that escapes every request shuts the process down cleanly, for the process
manager to restart.

## Security

- Sessions live in Redis, in `httpOnly`, `sameSite` and (in production)
  `secure` cookies; the id is replaced at sign-in.
- Every staff route checks a permission; every staff role requires two-step
  sign-in.
- Browsers may only change things from `CLIENT_ORIGIN`; Helmet sets the
  headers; bodies are size-capped; uploads are checked by their first bytes
  and stored under random names outside any public folder.
- Amounts are always the server's own: a gateway is asked to verify the
  stored price, never one a client sent.
- No credential lives in source. Everything is read in `src/config`, which
  refuses to start in production when a required value is missing.

## Accounts and access (/api/v1)

The new accounts live in PostgreSQL, with sessions in Redis (cookie `sk.sid`).

- **Signing in**: a six-digit code by email, which also creates the account,
  or a password once one is set. Codes are stored as HMACs in Redis for ten
  minutes, allow five tries, and at most five are sent per address per hour.
- **Passwords**: scrypt; an unknown address costs the same time as a known
  one. Five wrong passwords close password sign-in for fifteen minutes; the
  emailed code still works, so a stranger cannot lock the owner out.
- **Two-step sign-in**: TOTP (RFC 6238), each code usable once; ten recovery
  codes stored as hashes. Every staff role requires it: until it is set up the
  session can do nothing but set it up.
- **Roles**: permissions are defined in code (`src/modules/access/permissions.ts`)
  and the built-in roles are synced on every migration. Nobody grants a role
  with permissions they lack, only an owner touches the owner role, and the
  last owner cannot be removed. Every change is written to the audit log in
  the same transaction.
- **Errors** carry a stable code (`{ "error": { "code": "ACCOUNT_LOCKED", ... } }`);
  the web app shows its own Persian sentence for each.
- Requests that change something from a browser must come from `CLIENT_ORIGIN`.

## Panels and subscriptions (/api/v1/staff, /s/:token)

- **`PanelDriver`** (`src/modules/provisioning/driver.ts`) is what the system
  needs from a VPN panel; `PasarGuardDriver` implements it (checked against
  v5.4.1 by `npm run test:contract`). Panel credentials are stored encrypted
  and never returned or logged.
- **Making a subscription** is one transaction: a server is chosen (a panel
  that sells the plan, taking customers, with room; highest priority, then
  emptiest; the candidates are locked so two sales cannot take the last
  place), the row, its history and an outbox event. The worker then puts it
  on the panel. The panel username comes from the subscription id, so a
  retry finds the user a lost attempt made. A panel that is down is retried
  with backoff; a panel that refuses is not. Either way the subscription then
  waits for staff (`retry`).
- **Usage** is read from every active panel every 5 minutes (a BullMQ job
  scheduler; no separate process). Status changes (on hold to active, active
  to limited) go into the subscription's history.
- **`/s/:token`** is the customer's link. It passes the VPN app's request
  (User-Agent and the device headers the panel's device limit reads) to the
  panel's own link and returns the body and the headers apps read, never the
  panel's address. Revoking the link changes the token.

## Buying and paying (/api/v1/shop)

- **The rule**: once money is confirmed it is recorded, whatever else fails.
  Settling a payment is one transaction (payment, double-entry ledger, order,
  invoice), and the subscription is made inside it on its own savepoint. No
  room on any server: the order stays paid, staff are alerted, and they make
  it later (`POST /staff/orders/:id/fulfil`).
- **Zarinpal** (v4 REST, `src/modules/billing/zarinpal.ts`): the amount
  verified is always the stored one. Settling is idempotent: a second
  callback finds the payment settled (row lock, a ledger idempotency key,
  and a unique index on one successful payment per order). Payments whose
  callback never came are asked about every two minutes and settled if paid.
- **Card to card**: the receipt image's type is read from its bytes; images
  go to `files/` and are served only to `payments:review`. Repeated images or
  tracking numbers and differing amounts are flagged, not refused.
- **Renewal** (`src/modules/subscriptions/renewal.ts`) is an order of kind
  `renewal` on an existing subscription, paid like any other. It applies at
  once and loses nothing: the plan's days go on the current expiry, its
  volume on what is left; an expired subscription starts again from today.
  The worker applies it to the same panel user (the link never changes); the
  new expiry and limit are worked out once and recorded, so a retry sets the
  same values instead of adding them again.
- **Customer emails** (`src/modules/notifications`): the built-in Persian
  templates live in `templates.ts`; a row in `notification_templates`
  overrides one. A template may only use the variables it lists (checked on
  save). Each email is recorded as queued inside the transaction that caused
  it, with an outbox event; the worker renders it, sends it as text and
  right-to-left HTML, and records sent, failed or skipped (switched off,
  account suspended). Reminders are scanned every 15 minutes; "once per
  cycle" is the primary key of `subscription_alerts_sent`, whose cycle is the
  expiry (and, for volume, the limit), so a renewal starts a new one.
- **Crypto**: the USDT rate comes from Nobitex (`bestBuy`, every minute);
  a rate older than ten minutes hides crypto at checkout. Direct USDT on
  TRON is matched by exact amount (the price rounded up to the cent, plus a
  tail no other open quote has; a unique index enforces it). Every confirmed
  transfer of the official USDT contract to our address is recorded first,
  then matched by the block's time against the quote's expiry; a token
  merely named USDT is never recorded. NOWPayments IPNs are checked by
  signature and then read back from its API before anything is settled.
- **Alerts** (`src/modules/notifications/alerts.ts`) are outbox events,
  delivered by the worker to owners and admins by email and to Telegram.
  Provisioning alerts once after about a minute of failures, and again if it
  gives up.

## Support tickets (/api/v1/support, /api/v1/staff/tickets)

`src/modules/support`. A ticket's status says who it waits on:
`awaiting_staff`, `awaiting_customer`, `resolved`, `closed`.

- **Internal notes** are messages with `is_internal`. The customer's queries
  leave them out in SQL, and an attachment on one is refused to the
  customer, so no screen can show them by mistake. A database check allows
  internal messages only from staff.
- **A staff reply** sets `awaiting_customer`, gives an unassigned ticket to
  whoever answered, and queues the `ticket_reply` email in the same
  transaction. **A customer's message** sets `awaiting_staff` (reopening a
  resolved ticket; a closed one answers `TICKET_CLOSED`).
- **Agents** are active users whose roles grant `tickets:reply`. A new
  ticket, or a customer's reply, records a `support.ticket_alert` outbox
  event; the worker emails the ticket's assignee, or every agent when there
  is none.
- **Attachments** are images only (checked by their first bytes), three per
  message, stored with the receipts in the private files folder and served
  by `GET /support/files/:id` to the ticket's owner or an agent.
- **Quiet tickets**: every hour the worker marks resolved any ticket waiting
  on the customer for 7 days, with a system message in the thread.
- **Categories**: `npm run db:migrate` gives an empty installation four
  defaults (`src/modules/support/defaults.ts`); after that they are staff's.

## The journal (/api/v1/posts, /api/v1/staff/posts)

`src/modules/content`. Staff with `content:manage` write posts; everyone
reads the published ones.

- **Addresses** are made from the title and keep Persian letters. A draft's
  address follows its title; from the first publication it is fixed.
- **Covers** are pictures stored like the private files but marked
  `is_public`, and only those are served (`GET /posts/covers/:fileId`).
- **Likes** are a toggle; **comments** wait for approval (`pending`), and
  only their author sees them until staff approve. Both counts on a post are
  recounted from their tables whenever they change.

## Customers, reports and the team (/api/v1/staff)

- **Customers** (`src/modules/crm`): what they paid, their live services and
  their stage are computed on every read, never stored. The stage: a live
  service is `active` (`at-risk` when it ends within 7 days or has run out of
  volume); without one, never paid is a `lead` and paid before is `churned`.
  A stage set by hand (`vip`, `blocked` only ever are) wins, and the computed
  one is shown beside it. Notes and tags are what staff record.
- **Reports** (`src/modules/reports`): paid orders are revenue, dated by
  `paid_at`, renewals included and wallet top-ups not (a top-up spent on a
  plan would count twice). Days are Tehran's; every day in a range is a
  point, zero or not. Each headline figure comes with the same figure for the
  range just before.
- **The team** (`src/modules/access/team.ts`): everyone holding a role;
  adding someone by email makes their account if needed and emails them
  where to sign in. The audit log names who did what.
- **Deleting an account** (`src/modules/identity/delete-account.ts`), by its
  owner or by staff: the email, name, password, authenticator, recovery
  codes, notes and tags go; orders, payments and invoices stay with the now
  anonymous account. Services not yet on a panel are marked deleted; the
  rest are removed from their panel by the worker. A member of staff is
  removed from the team first. Staff may also suspend a customer, who is then
  signed out on their next request.

## Tests

```bash
npm test
```

The suites are component tests: they start the real server in the test
process on a random port and drive it over plain HTTP with cookies, against
a real PostgreSQL (the `shah_kelid_test` database, reset and migrated at the
start of each file) and Redis database 1. Only the outside services are
faked: the VPN panel, the payment gateways, TronGrid, Nobitex and SMTP. The
fakes behave as the real ones were seen to, and `npm run test:contract`
checks that against the real services.
