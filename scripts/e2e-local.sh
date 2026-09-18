#!/usr/bin/env bash
#
# End-to-end local run: boot a Hardhat node, deploy the contracts, start the
# backend against it, then drive the full v0.2 HTTP flow. No credentials or funds
# are needed — IPFS/IP inference fall back to mock/local when no API tokens are set.
#
#   npm run e2e:local
#
set -euo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
HH_PORT="${E2E_HH_PORT:-8545}"
APP_PORT="${E2E_APP_PORT:-4100}"
WEBHOOK_PORT="${E2E_WEBHOOK_PORT:-4199}"
WEBHOOK_OUT="$TMP/webhooks.jsonl"
WEBHOOK_SECRET="e2e-webhook-secret"

# Ignore the repo .env for this run: its DEPLOYER_PK (a real testnet key with no
# local balance) would otherwise be used for local signers. Everything the run
# needs is exported below, and the agent uses Hardhat's funded account #1.
: >"$TMP/empty.env"
export DOTENV_CONFIG_PATH="$TMP/empty.env"

export DEPLOYMENTS_PATH="$TMP/deployments.json"
export DB_PATH="$TMP/taop.db"
export RPC_URL="http://127.0.0.1:${HH_PORT}"
export HOST=127.0.0.1
export PORT="$APP_PORT"
# Hardhat account #1 (well-known public test key) acts as the demo agent; it is
# funded by the local node, so no faucet/keys are involved.
export AGENT_A_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
# Hardhat account #0 is the local oracle/deployer (pays for Timelock actions).
# Explicit because write mode no longer falls back to a well-known mnemonic.
export ORACLE_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export INDEXER_ENABLED=true
export INDEXER_START_BLOCK=0
export INDEXER_POLL_MS=1000
export LOG_LEVEL=warn
# v0.4: signed outbound webhooks, drained fast for the test.
export TAOP_WEBHOOK_URL="http://127.0.0.1:${WEBHOOK_PORT}/hook"
export TAOP_WEBHOOK_SECRET="$WEBHOOK_SECRET"
export TAOP_WEBHOOK_POLL_MS=300
export TAOP_WEBHOOK_TIMEOUT_MS=5000

NODE_PID=""
APP_PID=""
WEBHOOK_PID=""
cleanup() {
  for pid in "$WEBHOOK_PID" "$APP_PID" "$NODE_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

wait_for() { # url, label
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "$1" 2>/dev/null && return 0
    sleep 1
  done
  echo "ERROR: timed out waiting for $2 ($1)" >&2
  return 1
}

echo "== starting hardhat node on :$HH_PORT =="
npx hardhat node --port "$HH_PORT" >"$TMP/node.log" 2>&1 &
NODE_PID=$!
for _ in $(seq 1 60); do
  curl -sf -X POST "$RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1 && break
  sleep 1
done

echo "== deploying contracts =="
npx hardhat run scripts/deploy-local.ts --network localhost >"$TMP/deploy.log" 2>&1 || {
  cat "$TMP/deploy.log" >&2
  exit 1
}

echo "== starting webhook receiver on :$WEBHOOK_PORT =="
E2E_WEBHOOK_PORT="$WEBHOOK_PORT" E2E_WEBHOOK_OUT="$WEBHOOK_OUT" E2E_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  node scripts/e2e-webhook-receiver.mjs >"$TMP/webhook-receiver.log" 2>&1 &
WEBHOOK_PID=$!
wait_for "http://127.0.0.1:${WEBHOOK_PORT}/healthz" "webhook receiver"

echo "== starting backend on :$APP_PORT =="
npx tsx packages/backend/src/server.ts >"$TMP/app.log" 2>&1 &
APP_PID=$!
wait_for "http://${HOST}:${APP_PORT}/api/healthz" "backend" || {
  cat "$TMP/app.log" >&2
  exit 1
}

echo "== driving the v0.2 flow =="
E2E_BASE="http://${HOST}:${APP_PORT}" \
E2E_WEBHOOK_OUT="$WEBHOOK_OUT" \
E2E_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  node scripts/e2e-local-assert.mjs

echo "E2E OK"
