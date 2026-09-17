# TAOP — Operations Runbook

Operator guide for running the TAOP backend (Base Sepolia pilot). Pairs with
[`SECURITY.md`](../SECURITY.md), [`DEPLOY_DEMO.md`](../DEPLOY_DEMO.md) and
[`PHASE0_OWNER_ACTIONS.md`](../PHASE0_OWNER_ACTIONS.md).

> Threat model reminder: the write-enabled backend holds signing keys and can
> spend ETH and execute owner-only Timelock actions. Never expose it beyond
> loopback without `TAOP_API_KEY`, and prefer a read-only instance
> (`DEMO_READ_ONLY=true`) for anything public.

## 1. Health and readiness

`GET /api/healthz` (no auth, safe for load balancers) returns liveness **and**
readiness detail:

```json
{
  "ok": true,
  "service": "taop-backend",
  "chainId": 84532,
  "uptimeSec": 1234,
  "writes": "keyed",
  "rpc":     { "ok": true, "latencyMs": 42, "blockNumber": 46860318, "error": null },
  "indexer": { "enabled": true, "ready": true, "lag": 0,
               "lastBlock": 46860318, "headBlock": 46860318,
               "twoSided": false, "lastError": null }
}
```

`ok` is process liveness (true whenever the process is up). `contracts.ronPaused`
/ `contracts.registryPaused` expose the on-chain pause state. Use the nested
fields for readiness alerts:

| Signal | Healthy | Investigate |
|---|---|---|
| `rpc.ok` | `true` | RPC endpoint down / rate-limited (`rpc.error`) |
| `rpc.latencyMs` | < ~1500 | RPC degraded; consider a dedicated provider |
| `indexer.lag` | 0–2 blocks steady | stuck indexer (see §3) |
| `indexer.ready` | `true` | backfill still running, or disabled |

## 2. Structured logs

All runtime logs are JSON via [pino](../packages/backend/src/logger.ts):

- `LOG_LEVEL` (default `info`) — `debug | info | warn | error`.
- Every line includes `service: "taop-backend"`, ISO `time`, and `level`.
- Secret-shaped fields (`privateKey`, `agentAPk`, `DEPLOYER_PK`, `AGENT_A_PK`,
  `PINATA_JWT`, `REPLICATE_API_TOKEN`) are **redacted** before they can be logged.

Ship stdout to your collector (Fly logs, journald, Loki, …). Suggested alert
rules: any `level >= 40` (warn) repeatedly, and `"fatal"` messages.

## 3. Off-chain indexer (F10)

The indexer (`packages/backend/src/indexer.ts`) polls `eth_getLogs` for both
contracts into SQLite and serves `/api/discover` from that index.

- Status: `GET /api/indexer` → `{ enabled, ready, lag, lastBlock, headBlock, twoSided, lastError }`.
- Config: `INDEXER_ENABLED` (`true`), `INDEXER_POLL_MS` (`15000`),
  `INDEXER_CHUNK_SIZE` (`2000` — public RPCs cap `eth_getLogs` near 10k blocks),
  `INDEXER_CONFIRMATIONS` (`5` — only index up to `head - N`),
  `INDEXER_MAX_CHUNKS_PER_TICK` (`20`), `INDEXER_START_BLOCK` (defaults to
  `deployments.json` `deployedBlock`, else `head - INDEXER_LOOKBACK_BLOCKS`),
  `INDEXER_LOOKBACK_BLOCKS` (`50000`).
- **Reorg safety:** the indexer only advances to `head - INDEXER_CONFIRMATIONS`,
  and stores the hash of the last indexed block. If that hash changes (a reorg
  deeper than the confirmation depth), it logs a warning, rebuilds the derived
  state from logs, and increments `indexer.reorgsDetected` in `/api/healthz`.
- **Failure mode:** a public RPC that rejects `eth_getLogs` leaves `lastError`
  set and `lag` growing; `/api/discover` still works via the direct on-chain
  fallback (`X-Indexer: off`). Fix by pointing at a log-capable RPC or setting
  `INDEXER_ENABLED=false`.
- **Re-index:** the cursor lives in the `meta` table (`indexer_last_block`) and
  processed logs are de-duplicated in `indexed_logs`. Delete the SQLite file (or
  set `INDEXER_START_BLOCK`) to rebuild from scratch.

## 4. Alerts

`GET /api/alerts?limit=50` returns protocol events indexed from logs (newest
first). Kinds and suggested responses:

| Kind | Meaning | Response |
|---|---|---|
| `ChallengeSubmitted` | Someone posted a 0.01 ETH bond alleging fraud | Informational; watch for spam (rate-limit writes) |
| `ChallengeResolved` | Owner/Timelock resolved a challenge (`upheld` flag) | If unexpected, check who holds the proposer/executor role |
| `CapabilitySlashed` | A capability bond was slashed | Confirm the certifier acted intentionally |
| `BondWithdrawn` | A creator reclaimed a bond (NFT burned) | Expected churn; confirm it isn't a rug |
| `EthPoolWithdrawn` | Owner withdrew protocol fees/slashed bonds | Investigate immediately — owners only move funds deliberately |
| `CertifierChanged` | Certifier role changed | Verify it was intended (owner action) |
| `Paused` / `Unpaused` | Protocol actions were paused/resumed | Confirm it was intentional; a pause blocks attestations/challenges |

## 4a. Admin actions when owner = Safe + Timelock

With a **Safe** as Timelock proposer/executor, admin actions are no longer
possible from the backend: `/api/completions/:id/resolve`, `/api/admin/pause`,
`/api/admin/unpause`, `/api/admin/attest-cooldown` will revert (`AccessControl`),
because the backend key isn't a proposer. Use the Safe UI instead:

```bash
npm run timelock:tx -- --action pause --delay 3600
# load timelock-batch-schedule.json in Safe → Apps → Transaction Builder, sign
# after the delay, load timelock-batch-execute.json and sign
```

The admin audit log (§4b) still records backend attempts, which will show as
failures — that is expected. Front-run by pausing via the Safe for emergencies.

## 4b. Admin audit log

Every privileged backend action (pause, unpause, attest-cooldown, resolveChallenge)
is recorded in SQLite with the actor address, tx hash, and whether it was executed
or only scheduled on the Timelock. Review it with:

```bash
curl -s 'localhost:4000/api/admin/audit?limit=20' | jq
```

Treat an unexpected entry as an incident (see [`EMERGENCY.md`](EMERGENCY.md)).

## 5. Key rotation

- `DEPLOYER_PK` (owner/proposer ⇒ full control): rotate only via a controlled
  redeploy + Timelock `proposer`/`executor` update. Treat as a privileged change.
- `AGENT_A_PK` (demo agent): rotate by redeploying
  (`npm run deploy:sepolia`, which writes a fresh key to `.env`) or by funding a
  new agent and re-registering its capability.
- `TAOP_API_KEY`: `openssl rand -hex 32`; set it on the server **and** rebuild
  the demo UI with the same `VITE_TAOP_API_KEY` (the write-gate compares it).
- `PINATA_JWT` / `REPLICATE_API_TOKEN`: rotate in the provider console, then
  update `.env` and restart.

Never put keys in `deployments.json` (publishable) or in logs. See
[`SECURITY.md`](../SECURITY.md).

## 6. Incident response (leaked key)

1. Assume the key is public forever.
2. If it is `AGENT_A_PK`: drain/retire the agent, redeploy with a fresh key, and
   note the retirement in `SECURITY.md` §3.
3. If it is `DEPLOYER_PK` (a Timelock proposer): use the other proposer (or the
   Timelock admin path) to rotate proposers/executors, then move funds.
4. If key material ever reached Git: rewrite history + force-push, then ask
   GitHub Support for a cache/GC pass (dangling blobs survive a force-push).

## 7. Routine operations

- **Restart:** the process is stateless except SQLite (`DB_PATH`, default
  `taop.db`) and `.env`. Restart with the same env and it resumes the index.
- **Backups:** back up `taop.db` (index/cache — rebuildable) and, more
  importantly, `deployments.json` (addresses) and `.env` (secrets, offline).
- **Redeploy contracts:** `npm run deploy:sepolia`, then copy the new addresses
  into `deployments.json.example` + README, and restart the backend (the
  `last_registry` cache is invalidated automatically).
- **Rate limits:** 240 req/min overall, 20 writes / 5 min (see `server.ts`).
- **Security banner:** every boot prints
  `Security: bind=… | writes=… | write auth=…` and an `Indexer:` line — check
  them before sharing any URL.

## 8. Suggested synthetic checks

- `GET /api/healthz` every 60s; alert if `rpc.ok=false` or `indexer.lag>50`.
- `GET /api/discover?capabilityType=LoRA&limit=1` every 5 min; alert on non-200.
- `GET /api/alerts?limit=1` poll; alert on any new `EthPoolWithdrawn`.
