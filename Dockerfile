# TAOP backend + demo (single container, serves /api and the demo UI).
#
# SECURITY: the image defaults to HOST=0.0.0.0 (the container interface), so the
# backend's startup guard requires either
#   - TAOP_API_KEY  -> write-enabled demo behind an API key, or
#   - DEMO_READ_ONLY=true -> public read-only demo (writes return 503)
# Provide secrets at runtime (fly secrets / docker -e), never in the image.

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
# Native modules (e.g. better-sqlite3) compile with node-gyp when no prebuilt
# binary exists for the platform; the build stage is discarded from the runtime
# image, so the toolchain costs build time only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.json tsconfig.base.json tsconfig.hardhat.json hardhat.config.ts ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/backend/package.json packages/backend/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY apps/demo/package.json apps/demo/
COPY apps/static-demo/package.json apps/static-demo/
RUN npm ci

COPY contracts ./contracts
COPY test ./test
COPY scripts ./scripts
COPY packages ./packages
COPY apps/demo ./apps/demo

# Clean any stale generated SDK sources so esbuild bundles the TS sources.
RUN rm -f packages/sdk/src/*.js packages/sdk/src/*.js.map packages/sdk/src/*.d.ts packages/sdk/src/*.d.ts.map \
 && npm run sdk:build \
 && npm run contracts:build \
 && npm run demo:build \
 && npm run backend:build

# The runtime stage copies node_modules, so strip devDependencies here: the
# production tree ships zero known advisories and the image stays small. The
# backend bundle marks packages external, and its prod deps (express,
# better-sqlite3, @taopp/sdk, ...) are unaffected.
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS run
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DB_PATH=/app/data/taop.db
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/demo/dist ./apps/demo/dist
# Runtime deployment descriptor (addresses only — never keys).
COPY deployments.json.example ./deployments.json
# Run as the unprivileged `node` user; only the SQLite data dir is writable.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 4000
CMD ["node", "packages/backend/dist/server.cjs"]
