# Shah Kelid API

Node.js and Express backend for the Shah Kelid store, structured after
[nodebestpractices](https://github.com/goldbergyoni/nodebestpractices) and tested
after [nodejs-testing-best-practices](https://github.com/goldbergyoni/nodejs-testing-best-practices).

## Getting started

```bash
cp .env.example .env     # then fill in the blanks
npm install
npm run seed:admin       # creates the first privileged account
npm run dev
```

`npm run seed:admin` matters on an existing database too. Every `/admin` and
`/mod` endpoint now requires a role, and accounts created before roles existed
are all plain users, so without a seeded admin or owner nobody can open the
panels.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Runs the API. |
| `npm run dev` | Runs it with Node's own watcher, restarting on change. |
| `npm test` | Runs every suite against a real MongoDB. |
| `npm run test:watch` | Reruns the suites on change. |
| `npm run seed:admin` | Creates or promotes a privileged account (old MongoDB accounts). |
| `npm run create-owner -- <email>` | Makes the first owner of the new PostgreSQL accounts. Refuses when one exists; `--another` adds one on purpose. |
| `npm run seed:posts` | Fills the journal with ten sample articles. |
| `npm run seed:plans` | Fills the catalogue with the three plans. |
| `npm run migrate:periods` | Normalises legacy billing terms on products. |
| `npm run prune:products` | Removes products whose data no longer validates. |
| `npm run prune:test-orders` | Lists orders that only name withdrawn plans. |
| `npm run purge:generated` | Removes every generated or hand-made test record. |
| `npm run audit` | Audits the production dependencies. |
| `npm run worker` | Runs the worker: the outbox relay, and the queue consumers as they arrive. |
| `npm run dev:worker` | The same, restarting on change. |
| `npm run db:migrate` | Applies pending PostgreSQL migrations. |
| `npm run db:generate` | Writes a new migration from changes to the module schemas. |
| `npm run typecheck` | Checks the TypeScript code. |

Every `seed:`, `prune:` and `purge:` script is a dry run by default and prints
what it would do. Pass `-- --write` to apply it.

There is deliberately no script that fabricates sales. One existed and was
removed: a dashboard filled with invented orders looks exactly like a real one
and every figure on it is wrong, and there is no way to tell the difference by
looking at a chart. `purge:generated` exists to undo the damage that one did,
and it backs up everything it removes to `backups/` first. The catalogue and
the journal are still seeded, because those are the site's own content rather
than a record of something that happened.

## Layout

The tree is organised by business component rather than by technical role, so
everything one feature needs sits in one folder and features stay decoupled.

```
index.js                 process entry point: the only file that listens
src/
  app.js                 builds the express app, never listens
  server.js              start / stop / graceful shutdown
  config/                every process.env read, validated once at boot
  libraries/             cross-cutting code shared by components
    errors/              AppError and the centralized error handler
    logger/              structured logging
    mailer/              SMTP adapter, with a test seam
    payment/             payment provider adapter, with a test seam
    storage/             upload directory handling
  middlewares/           auth guards, validation, async wrapper, multer
  components/
    auth/ users/ products/ orders/ posts/ admin/ moderator/
    analytics/ crm/
        <name>.routes.js       the web layer: HTTP in, HTTP out
        <name>.service.js      the domain layer: all the rules
        <name>.model.js        the data layer
scripts/                 seeds and maintenance, dry-run by default
test/
  helpers/               test server, HTTP client, record builders, fakes
  *.test.js              one suite per business area
```

Three layers per component, and they only ever call downward. A route never
touches a model directly and a service never sees `req` or `res`, which is what
lets the services be reasoned about and reused without an HTTP request.

## Reporting

`analytics/` answers the sales dashboard and `crm/` the customer book. Three
decisions run through both, and they are what make the numbers mean anything.

**Only paid orders are revenue.** A pending order is an intention and a failed
one is nothing at all. Counting either inflates every figure on the page, and
the error grows with every abandoned checkout.

**Revenue is dated by `paidAt`, not `createdAt`.** An order opened on the 31st
and paid on the 1st belongs to the new month. Reporting on the creation date
would move money between periods depending on how long somebody sat on the
payment page.

**Recurring revenue is normalised per month.** A two-year plan sold for $96 is
$4 a month, not $96. Orders written before the billing term was recorded on the
line carry no term, and those are *excluded* rather than assumed to be monthly
— assuming would count a two-year sale twenty-four times over. How much of the
history the figure actually covers travels with it as `mrrCoverage`, so a
partial answer is never presented as a whole one.

Ranges are half-open and cut in UTC: `to` is the last day you want and the
server pushes it to the following midnight, so a range never half-includes a
day. Time series are gap-filled — a day with no sales is a zero, not a missing
row, because a series that skips its quiet days draws a straight line across
them and reads as steady trade rather than none.

The CRM keeps a `CustomerRecord` per account for the things a person sets:
lifecycle stage, tags, owner and notes. Nothing measurable is stored on it.
Lifetime value, order counts and the derived stage are computed from the orders
on every read, because a stored total starts drifting the moment anything
happens elsewhere and nothing about looking at it says whether it is still
true. A stage set by hand wins, and the computed one stays visible beside it.

## Writing posts

`/staff/posts` lets any admin, moderator or owner publish to the journal and
edit what they wrote; editing someone else's post is a 403. Ownership is
decided on the stored author id, never the name, and a post with no recorded
author belongs to nobody. The role guard runs before the upload, so a refused
request writes nothing to disk, and if a later check refuses it the error
handler removes the file it uploaded.

The address (slug) and the reading time are worked out by the server, not
taken from the form. The slug keeps letters in any script, so a Persian title
gets a Persian address rather than an empty one, and it is fixed at
publication: editing the title never changes it, because the old address has
already been shared.

## Error handling

Every handler is wrapped so a rejected promise reaches one central error
middleware instead of hanging the request. Errors that the app raises on purpose
are `AppError` instances carrying a status and a code, and they are marked
operational; anything else is treated as a programmer error, logged with its
stack, and answered as a 500 without leaking internals. Uncaught exceptions and
unhandled rejections shut the process down cleanly rather than leaving it in an
unknown state.

## Security

- Sessions are server-side, with `httpOnly`, `sameSite` and (in production)
  `secure` cookies, and the session id is regenerated on login.
- Roles are enforced in middleware on every admin and moderator route.
- Passwords are hashed with bcrypt and the hash is never selected by default,
  let alone serialized; responses go through an allow-list serializer.
- Login and password-reset routes are rate limited, and a wrong password and an
  unknown account give byte-identical answers so accounts cannot be enumerated.
- Orders are built from the server's own copy of the cart, and the amount sent
  for verification comes from the stored order. The client cannot name a price.
- Helmet sets the security headers, CORS allows one configured origin, request
  bodies are size-capped, and uploads are limited by size, count and MIME type
  with random file names.
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

## Tests

```bash
npm test
```

The suites are component tests: they start the real server in the test process
on a random port, drive it over plain HTTP with cookies, and assert against a
real MongoDB. Only the two genuinely external services, SMTP and the payment
gateway, are faked, and the fakes record their calls so a test can assert on
what the app tried to send.

The tests use whichever MongoDB they can find: a `mongod` already listening on
`127.0.0.1:27017` if there is one, and `mongodb-memory-server` otherwise. Either
way each run gets its own throwaway database, which is dropped at the end, and
every test creates the records it acts on, so suites do not depend on each other
or on leftover data. Point them elsewhere with `MONGO_TEST_HOST` and
`MONGO_TEST_PORT`.
