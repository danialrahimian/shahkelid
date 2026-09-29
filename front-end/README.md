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
    admin/ auth/ cart/ crm/ dashboard/ marketing/ moderator/ orders/
    posts/ pricing/ profile/
      components/          UI scoped to that feature
      hooks/               hooks scoped to that feature
  hooks/                   shared hooks
  lib/                     preconfigured libraries: api client, auth, guards
  stores/                  the Redux store and the small slice of client state
  testing/                 test helpers
  types/                   shared types, including the API's own shapes
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

The signed-in user is not stored at all. `GET /login-status` is the source of
truth, cached like any other query, so a reload restores the session and a role
changed by a moderator is picked up on the next fetch.

## Forms

Every form is `Form` from `src/components/ui/form/form.tsx`, wrapping
react-hook-form with a zod schema. The schemas live beside the requests they
feed in `src/api`, so what the user sees while typing is exactly what the server
enforces rather than a second copy that can drift.

## Errors

`src/lib/api-client.ts` is the single configured client. It sets the base URL
and credentials, turns every failure into one predictable shape, and sends a
visitor whose session expired back to sign in with a return address.

Error boundaries are placed per area rather than once around the app, so a
failure in the pricing table costs the pricing table and leaves the rest of the
page usable.

## Charts

`src/components/charts/` holds the primitives — a line chart with a crosshair,
horizontal bars, and the frame they sit in. They take data and colours and know
nothing about sales or customers, which is why both the dashboard and the CRM
can use them without importing each other.

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
validated for colour-vision separation against both. Lifecycle stages use a
separate status palette so a stage can never be mistaken for a plan.

## Routing and access

Routes are declared in `src/app/router.tsx` and every screen is loaded lazily,
so a first-time visitor downloads the landing page and nothing else.

The staff screens — sales, customers, products, posts and users — live together
under `/dashboard`, in their own frame: the shadcn sidebar from
`components/ui/sidebar.tsx` instead of the public navigation bar. It sits beside
the public shell in the route table rather than inside it, because a sidebar
fixed to the full height of the window and a floating bar on top of it would
fight for the same edge. The sidebar collapses to icons, becomes a sheet on a
phone, remembers its state and toggles with Ctrl/Cmd+B. It lists only the
screens the signed-in role may open, from `DASHBOARD_LINKS` in
`components/layouts/nav-links.ts`. The old addresses (`/admin`, `/mod`, `/crm`)
redirect to their new homes, parameters included.

Any member of staff may publish to the journal from **Posts**, and each may
edit only their own. The list shows everyone's posts, with **Details** opening
the whole post in a dialog. The server enforces the ownership rule; the screen
only reflects it, hiding Edit where it would fail.

`ProtectedRoute` requires a session; `RoleRoute` requires a role. Both wait for
the session check before deciding, so reloading a private page does not bounce a
signed-in visitor. The roles they accept mirror the server's own checks exactly,
and a signed-in visitor without the right role is told so rather than being sent
to a login form they do not need.

## Tests

```bash
npm test
npm run typecheck   # tsc -b, the same check `npm run build` runs first
```

Integration tests that drive the real API layer against a running backend. They
check what mocks cannot: that the request declarations, the error handling and
the server's actual responses still agree. Start the API first; if nothing is
listening the suite skips rather than reporting a wall of failures.

The reporting and CRM endpoints are staff-only, so those cases need an account
that can reach them. They skip unless one is supplied:

```bash
VITE_APP_TEST_STAFF_IDENTIFIER=owner VITE_APP_TEST_STAFF_PASSWORD=... npm test
```

Anything they write is written to an account the test registered a moment
earlier, so a run never edits a real customer's record.

## Environment

Only variables prefixed `VITE_APP_` reach the client, and all of them are
validated once at startup in `src/config/env.ts`. Nothing else in the codebase
reads `import.meta.env`, and the API address appears in exactly one place.
