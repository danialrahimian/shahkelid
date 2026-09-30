# syntax=docker/dockerfile:1

# Two images from one file:
#
#   app  the API and the worker (one image, two commands), plus the one-off
#        jobs: migrations and create-owner.
#   web  Caddy, with the built web app inside it. It serves the site, takes
#        TLS certificates, and passes /api and /s to the app.
#
#   docker build --target app -t shah-kelid-app .
#   docker build --target web -t shah-kelid-web .

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
RUN mkdir -p back-end/files && chown -R node:node back-end/files
USER node
WORKDIR /app/back-end
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health > /dev/null || exit 1
CMD ["npx", "tsx", "index.js"]
