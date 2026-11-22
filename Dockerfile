# syntax=docker/dockerfile:1

# Three images from one file:
#
#   app  the API and the worker (one image, two commands), plus the one-off
#        jobs: migrations and create-owner.
#   web  Caddy, with the built web app inside it. It serves the site, takes
#        TLS certificates, passes /api to the app and /s to the panel service.
#   panel  the panel service (panel/, Go): customers' subscription links and
#        the usage sync with the VPN panels.
#
#   docker build --target app -t shah-kelid-app .
#   docker build --target web -t shah-kelid-web .
#   docker build --target panel -t shah-kelid-panel .

ARG NODE_VERSION=24

# ------------------------------------------------------------ dependencies
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY back-end/package.json back-end/
COPY front-end/package.json front-end/
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------- web: build
FROM deps AS web-build
COPY packages/contracts packages/contracts
COPY front-end front-end
# Empty: the API is on the same domain, under /api, and links use whatever
# address the page was opened on. One build serves every domain.
ENV VITE_APP_API_URL= \
    VITE_APP_APP_URL=
RUN npm run build -w front-end

# ------------------------------------------------------------------- web
FROM caddy:2-alpine AS web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /repo/front-end/dist /srv/www

# ------------------------------------------------------------------- app
FROM node:${NODE_VERSION}-alpine AS app
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts packages/contracts
COPY back-end/package.json back-end/
COPY front-end/package.json front-end/
# Production dependencies of the API and the contracts only.
RUN npm ci --omit=dev --no-audit --no-fund -w back-end -w packages/contracts \
 && npm cache clean --force
COPY back-end back-end
# Private files (receipts, ticket screenshots, covers) live on a volume here.
# /control: the backup service's mailbox (a volume), writable by the app.
RUN mkdir -p back-end/files /control && chown -R node:node back-end/files /control
USER node
WORKDIR /app/back-end
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health > /dev/null || exit 1
CMD ["npx", "tsx", "index.js"]

# ----------------------------------------------------------- panel: build
FROM golang:1.24-alpine AS panel-build
WORKDIR /src
COPY panel/go.mod panel/go.sum ./
RUN go mod download
COPY panel ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/panel ./cmd/panel

# ----------------------------------------------------------------- panel
# Distroless: the binary, CA certificates (to reach the panels over TLS) and
# time zones (for the Persian date), as a user that is not root. No shell.
FROM gcr.io/distroless/static-debian12:nonroot AS panel
COPY --from=panel-build /out/panel /panel
EXPOSE 7000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["/panel", "-health"]
ENTRYPOINT ["/panel"]
