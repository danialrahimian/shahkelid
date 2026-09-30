# Shah Kelid — web client

React and TypeScript front end for the Shah Kelid store, structured after
[bulletproof-react](https://github.com/alan2207/bulletproof-react).

## Getting started

```bash
cp .env.example .env
npm install
npm run dev
```

The API has to be running for anything beyond the landing page to work. Start
it from `../back-end` with `npm run dev`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload. |
| `npm run build` | Type-checks, then builds for production. |
| `npm run preview` | Serves the production build locally. |
| `npm run lint` | ESLint, including the architecture rules below. |
| `npm test` | Integration tests against a running API. |

## Layout

```
src/
  app/                     the application layer
    routes/                one file per screen, lazily loaded
    app.tsx                providers wrapped around the router
    provider.tsx           every global provider, in one place
    router.tsx             the route table, code split per route
  api/                     request declarations, one file per domain
  components/              shared components used across features
    charts/                the chart primitives and the validated palette
    errors/                error boundaries and their fallback
    layouts/               the navigation bar and its parts
    ui/                    design-system primitives (shadcn) and the form kit
  config/
    env.ts                 every environment variable, validated at startup
    paths.ts               every route, declared once
  features/                one folder per business area
    account/ journal/ marketing/ shop/ staff/ support/
      components/          UI scoped to that feature
  hooks/                   shared hooks
  lib/                     the API client, i18n, formatting, error sentences
  locales/                 fa (the source of every key) and en
  stores/                  the Redux store and the small slice of client state
  testing/                 test helpers
  types/                   i18next's typing of the locale keys
  utils/                   shared helpers
```

### The layering rule

Code flows one way: **shared → features → app**. Shared modules never import a
feature, one feature never imports another, and nothing imports back into
`app`. Two features that need the same request share it through `src/api`
rather than reaching into each other.

This is enforced, not just documented. `import/no-restricted-paths` in
`eslint.config.mjs` fails the lint run on a violation, so the structure cannot
quietly erode.

File and folder names are kebab-case, enforced by `check-file`.

## Data

Two kinds of state, deliberately kept apart.

**Server cache.** Everything fetched from the API lives in RTK Query, declared
in `src/api`. Each declaration owns its request, its response type, its cache
tags and its invalidation. Components read it through generated hooks and get
loading, error and refetch handling for free. There are no hand-written
`status: "loading" | "succeeded" | "failed"` fields anywhere.

**Client state.** What the browser itself owns lives in `src/stores/ui-store.ts`
and is deliberately tiny. Anything only one component cares about stays in that
component, and filters live in the URL so a filtered view can be shared and
reloaded.

The signed-in account is not stored at all. `GET /api/v1/auth/session` is the
source of truth, cached like any other query, so a reload restores the session
and a role changed by an owner is picked up on the next fetch.

## Forms

Every form is `Form` from `src/components/ui/form/form.tsx`, wrapping
react-hook-form with a zod schema. The schemas live beside the requests they
feed in `@shah-kelid/contracts`, the same ones the server validates with, so
what the user sees while typing is exactly what the server enforces.

## Errors

`src/lib/api-client.ts` is the single configured client. It sets the base URL
and credentials and turns every failure into one predictable shape. The API
answers with a stable code, never a sentence for the reader; `errorText` shows
the reader's own sentence for it (`errors.codes.*` in the locales).

Error boundaries are placed per area rather than once around the app, so a
failure in the pricing table costs the pricing table and leaves the rest of the
page usable.

## Charts

`src/components/charts/` holds the primitives — a line chart with a crosshair,
horizontal bars, and the frame they sit in. They take data and colours and know
nothing about sales or customers, so the reports page and anything after it
can use them.

Four rules are built into them rather than left to whoever draws the next
chart.

**A table view is not optional.** `ChartFrame` takes `table` as a required
prop. One of the series hues sits below 3:1 against the light surface, so
colour alone cannot carry the chart; making the table required is the only
version of that rule which cannot be forgotten next time.

**The hover layer ships by default.** A chart in a browser is interactive
whether or not anyone builds the interaction. Without exact values on hover it
is a picture of some data rather than a report of it.

**Never two y-axes.** Where two measures have different scales — revenue and
order count — they go behind a toggle, not onto a second axis. A dual-axis
chart lets whoever drew it decide where the lines cross by choosing the scales.

**Colour follows the entity, not its rank.** `colorForKey` assigns from a fixed
order keyed on the entity, so a plan keeps its colour when a filter drops
another one. Series hues live in `index.css` as `--chart-1` … `--chart-5`,
stepped separately for the light and dark surfaces rather than flipped, and
validated for colour-vision separation against both. Customer stages use a
separate status palette so a stage can never be mistaken for a plan.

## Routing and access

Routes are declared in `src/app/router.tsx` and every screen is loaded lazily,
so a first-time visitor downloads the landing page and nothing else.

There is one kind of account (`/api/v1/auth`) and one session. Pages that
need it ask `useAccountSessionQuery` and send a signed-out visitor to
`/account/sign-in`, remembering where they were.

The staff screens live under `/staff`, in their own frame: a sidebar instead
of the public navigation bar. The layout lets in only a finished sign-in by
staff; the sidebar (`features/staff/staff-links.ts`) lists only the pages the
person's permissions open (the same permissions the API checks), and `/staff`
itself leads to the first of them. The old addresses (`/dashboard`, `/admin`,
`/mod`, `/crm`, `/auth`, `/profile`, `/invoices`, `/cart`) redirect to where
the same thing lives now (`LEGACY_REDIRECTS` in `config/paths.ts`).

## Tests

```bash
npm test
npm run typecheck   # tsc -b, the same check `npm run build` runs first
```

Unit tests for what can go wrong without a browser: formatting, the calendar
arithmetic of the reports, error sentences, the staff area's landing page,
share links, every locale having every key. The account endpoints are also
driven against a running backend (`src/api/account.test.ts`); start the API
first, or that file skips. The API's own behaviour is tested in `back-end`.

## Environment

Only variables prefixed `VITE_APP_` reach the client, and all of them are
validated once at startup in `src/config/env.ts`. Nothing else in the codebase
reads `import.meta.env`, and the API address appears in exactly one place.
