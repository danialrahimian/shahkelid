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

## Signing in (the new accounts)

The new database starts empty. Make the first owner once:

```bash
npm run create-owner -w back-end -- you@example.com
```

Then open http://localhost:5173/account/sign-in and sign in with that address. Without SMTP settings (`SMTP_USER` empty), emails are not sent: the **worker** writes them to its log, so the worker must be running to see the code. An owner is asked to set up an authenticator app (Google Authenticator, 2FAS, …) before anything else, and is shown ten recovery codes once.

| Page | What it is |
|---|---|
| `/account/sign-in` | Email code (also creates the account), or password; then the authenticator code |
| `/account/forgot-password` | A code by email, then a new password |
| `/account` | The customer panel: their services (volume and days left, the link and QR code, renew), orders and invoices, name, password, two-step sign-in |

The old `/auth` page and `/dashboard` still use the old accounts (MongoDB) until the dashboard's sections move over, milestone by milestone.

## The staff area and the VPN panel

`/staff` is the new staff area (sign in on `/account/sign-in` first). In order:

1. **Panels**: add the PasarGuard panel (its address and a panel account or API key). It is checked before it is saved.
2. **Servers and locations**: add a location, then a server on that panel, choosing the panel group that gives access to it.
3. **Plans**: volume, days, devices, price, and the panels it is sold on. Time starts at the customer's first connection (or after 30 days regardless).
4. **Customers**: open a customer and make a subscription. The **worker** must be running: it puts the subscription on the panel and copies usage back every 5 minutes.

The customer's link is `{PUBLIC_API_URL}/s/{token}` (default `http://localhost:5000`). To try it from a phone on the same network, set `PUBLIC_API_URL` in `back-end/.env` to this computer's address, for example `http://192.168.1.10:5000`.

## Buying

`/pricing` lists the plans on sale; buying one is `/buy/{planId}`: the buyer signs in there with an emailed code if needed, chooses online payment (Zarinpal) or card to card, and pays. `/orders/{id}` then shows the link and QR code as soon as the service is ready. The old cart and checkout pages are gone; their addresses lead to `/pricing`.

- **Zarinpal** runs on its sandbox until `ZARINPAL_SANDBOX=false` and `ZARINPAL_MERCHANT_ID` are set in `back-end/.env`. In the sandbox the payment page has a "پرداخت" button that pays without a card.
- **Card to card**: add the cards to show buyers in `/staff/payments` (owners and admins). Receipts wait there for review; suspicious ones (a repeated image or tracking number, a different amount) are flagged. Receipt images are stored in `back-end/files/`, which is never committed and never served publicly.
- **Alerts** to owners and admins go by email, and to Telegram when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_IDS` are set. Telegram is filtered in Iran, so from a machine there only the emails arrive; on the server abroad both do.

- **Crypto** appears at checkout only once it is set up and the USDT rate (read from Nobitex every minute) is fresh:
  - **USDT on TRON**: set `TRON_RECEIVE_ADDRESS` (the address only; the server never holds a wallet key). Each order is quoted an exact amount (for example 1.500347 USDT) and is paid when that amount arrives. Transfers that match no quote wait in `/staff/payments` for a decision. For the Nile testnet, also set `TRONGRID_URL=https://nile.trongrid.io` and `TRON_USDT_CONTRACT=TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`.
  - **NOWPayments**: set `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` (and `NOWPAYMENTS_SANDBOX=true` for its sandbox).

The **worker** does the rest: it puts paid subscriptions on the panel, asks Zarinpal about payments whose customers never came back, reads the USDT rate and new USDT transfers, and lapses unpaid orders and quotes.

To check the panel driver and Zarinpal against the real things (Zarinpal's sandbox, and your test panel, where test users named `sk-contract-...` and `sk_...` are created and deleted), fill the `PASARGUARD_TEST_*` values in `back-end/.env` and run:

```bash
npm run test:contract -w back-end
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
