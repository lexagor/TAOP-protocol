# TAOP backend + demo (single container, serves /api and the demo UI).
#
# SECURITY: the image defaults to HOST=0.0.0.0 (the container interface), so the
# backend's startup guard requires either
#   - TAOP_API_KEY  -> write-enabled demo behind an API key, or
#   - DEMO_READ_ONLY=true -> public read-only demo (writes return 503)
# Provide secrets at runtime (fly secrets / docker -e), never in the image.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json tsconfig.hardhat.json hardhat.config.ts ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/backend/package.json packages/backend/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY apps/demo/package.json apps/demo/
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

FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/demo/dist ./apps/demo/dist
# Runtime deployment descriptor (addresses only — never keys).
COPY deployments.json.example ./deployments.json
EXPOSE 4000
CMD ["node", "packages/backend/dist/server.cjs"]
