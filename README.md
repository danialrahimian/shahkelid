# Shah Kelid

VPN subscription platform: the storefront and customer panel, the staff dashboard and CRM, and (later) the Telegram bot. Being rebuilt in phases; see [docs/03-roadmap.md](docs/03-roadmap.md).

## Setting up a development machine

You need **Node.js 24** and **Docker Desktop** (running).

```bash
npm install                      # every package, from the root
npm run services:up              # PostgreSQL 18 and Redis 7, waits until healthy
npm run db:migrate -w back-end   # creates the tables
```

Copy `back-end/.env.example` to `back-end/.env` and `front-end/.env.example` to `front-end/.env`. The defaults work as they are for development. PostgreSQL and Redis need no settings, because the defaults match `compose.yaml`.

The existing modules still use **MongoDB** until each moves to PostgreSQL (roadmap M2 to M9), so a local `mongod` on port 27017 is also needed for now.

## Running it

Each in its own terminal:

```bash
npm run dev -w back-end          # the API, on :5000
npm run dev:worker -w back-end   # the worker: outbox relay, queues
npm run dev -w front-end         # the web app, on :5173
```

## Checking it

```bash
npm run check
```

Runs lint, typecheck and every test of every package. The back-end tests use their own database (`shah_kelid_test`) and Redis database (1), so they never touch development data, and they refuse to reset any database whose name does not end in `_test`.

## Layout

```
back-end/            the API and the worker (Node, Express, TypeScript arriving gradually)
  src/modules/       new code, one folder per module, each owning its tables
  src/components/    existing modules, moving into src/modules one by one
  src/platform/      database, queues, outbox
  drizzle/           migrations
front-end/           the web app (React, Vite)
packages/contracts/  what the apps must agree on: units, conversions, shared schemas
docs/                the approved design: architecture, database, roadmap
compose.yaml         local PostgreSQL and Redis
```

## Services

| Command | What it does |
|---|---|
| `npm run services:up` | Start PostgreSQL and Redis |
| `npm run services:down` | Stop them, keeping the data |
| `npm run services:reset` | Stop them and **delete** the data |
