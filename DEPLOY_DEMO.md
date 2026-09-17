# Deploying the public demo

Two supported modes. **The hosted demo is write-enabled behind an API key** (per
the 2026-09-15 decision); a read-only mirror is also documented because it is the
only mode that is safe to share without any key handling.

| Mode | Env | Who can do what |
|---|---|---|
| **Write-enabled + API key** (the hosted demo) | `TAOP_API_KEY=<hex>`, `VITE_TAOP_API_KEY=<same>` at build time | Anyone with the URL can *view*; the UI (and API clients) can attest/challenge/register only with the key |
| Read-only | `DEMO_READ_ONLY=true` | Anyone can view; all writes return `503` |

Both modes are enforced by `packages/backend/src/server.ts` (constant-time key
compare, 240 req/min, 20 writes/5 min, refuses to bind a public interface without
a key).

## 1. Build the demo with the API key baked in

> **Warning:** baking `VITE_TAOP_API_KEY` embeds the key in the **public JS
> bundle** — anyone who views the page source can extract it and call write
> endpoints. Only do this for a **private / access-controlled** instance. For any
> publicly reachable demo, run `DEMO_READ_ONLY=true` and do **not** bake a key.

```bash
cd /Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau
# .env already contains TAOP_API_KEY + VITE_TAOP_API_KEY (generated 2026-09-15)
set -a; . ./.env; set +a
VITE_TAOP_API_KEY="$VITE_TAOP_API_KEY" npm run demo:build
```

## 2. Fly.io (recommended: one small VM, always-on)

```bash
brew install flyctl && flyctl auth login
flyctl launch --no-deploy --name taop-demo --org personal \
  --image-deploy Dockerfile --internal-port 4000
# Secrets (never in the image):
flyctl secrets set \
  TAOP_API_KEY="$TAOP_API_KEY" \
  AGENT_A_PK="$AGENT_A_PK" \
  DEPLOYER_PK="$DEPLOYER_PK" \
  PINATA_JWT="$PINATA_JWT" \
  REPLICATE_API_TOKEN="$REPLICATE_API_TOKEN" \
  BASE_SEPOLIA_RPC_URL="https://sepolia.base.org" \
  DEMO_READ_ONLY=false
# deployments.json (addresses only) is baked from deployments.json.example —
# update it after every redeploy and `flyctl deploy`.
flyctl deploy
flyctl status && curl -s https://taop-demo.fly.dev/api/healthz
```

Verify before sharing: `curl -s -X POST https://taop-demo.fly.dev/api/demo/run`
must return **401** (no key), and `curl -s https://taop-demo.fly.dev/api/discover`
must return **200**.

## 3. Read-only mirror (safe to share anywhere)

```bash
docker build -t taop-demo .
docker run --rm -p 8080:4000 \
  -e DEMO_READ_ONLY=true \
  -e BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
  -v "$PWD/deployments.json:/app/deployments.json:ro" \
  taop-demo
curl -s localhost:8080/api/healthz                     # {"ok":true}
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  localhost:8080/api/demo/run                          # 503 (writes disabled)
```

## 4. Ops notes

- The container holds **testnet keys only**. Never put a mainnet key in a demo VM.
- Logs: `flyctl logs`. The startup banner prints
  `bind=… | writes=… | write auth=…` — check it after every deploy.
- Backups/updates: re-run `npm run deploy:sepolia`, copy the new addresses into
  `deployments.json.example`, then `flyctl deploy`.
- If you ever rotate `TAOP_API_KEY`, rebuild the demo image too (the UI bakes it in
  at build time).
