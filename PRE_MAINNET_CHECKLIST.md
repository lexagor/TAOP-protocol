# TAOP Pre-Mainnet Readiness Checklist

**Goal:** move from the Sepolia pilot (0-delay, single key) to a credible mainnet
deployment. Run this before `npm run deploy:mainnet`.

Companion docs: [`redeploy-v0.2.md`](redeploy-v0.2.md),
[`hardened-timelock.md`](hardened-timelock.md),
[`SECURITY-REVIEW.md`](SECURITY-REVIEW.md), [`OPERATIONS.md`](OPERATIONS.md),
[`EMERGENCY.md`](EMERGENCY.md).

## 1. Governance (must unfreeze 0-delay)

- [x] Deploy scripts support `MULTISIG_ADDRESS` / `PROPOSERS` / `EXECUTORS` / `TIMELOCK_DELAY`.
- [x] `test/TimelockDelay.test.ts` proves schedule → wait → execute, the non-proposer guard, and the 0-delay contrast.
- [ ] **Decision: unfreeze the 0-delay freeze** for mainnet (the pilot freeze was deliberate and is *not* the mainnet plan).
- [ ] Create a Safe (or multisig) on Base; set it as proposer/executor.
- [ ] Rehearse on Sepolia: `MULTISIG_ADDRESS=0xSafe TIMELOCK_DELAY=86400 npm run deploy:sepolia`, then schedule + execute an admin action.
- [ ] Set `certifier` to the multisig (or a dedicated operator), not an EOA you keep hot.

## 2. Security & audit

- [x] Slither triage: **0 High/Medium** in our contracts; gated in CI (`--fail-medium`).
- [x] Aderyn second opinion: 0 High, low/style only (see `SECURITY-REVIEW.md`).
- [x] Foundry fuzz + invariants: ETH conservation, receipt/dispute consistency, score bounds, index integrity (CI).
- [x] Zero-address guards; indexed address events.
- [x] Reorg-safe indexer (confirmation depth + rebuild).
- [x] Manual review of every privileged path (`SECURITY-REVIEW.md`).
- [ ] Decide paid audit vs. free-only for mainnet value; fund if chosen.
- [ ] Decide the **anti-sybil policy** (minimum attest bond, per-address rate limits, identity anchors). This is the credibility gap, not a code bug.
- [ ] Decide whether to add a **pause / circuit breaker** (there is none today).

## 3. Infrastructure & funding

- [ ] Production Base RPC (dedicated provider, not the public endpoint); set `BASE_MAINNET_RPC_URL`.
- [ ] Fund the deployer with real Base ETH (≥ 0.05–0.1 ETH for deploy + bonds + gas).
- [ ] `BASESCAN_API_KEY` for verification.
- [ ] Test the deploy path on a fork / dry-run before broadcasting.
- [ ] Key management per [`EMERGENCY.md`](EMERGENCY.md): owner/deployer in a hardware wallet or KMS; mainnet keys never hot; no key sharing with tooling.

## 4. Deployment & verification

- [ ] Redeploy **v0.2** (two-sided receipts, paged discovery) — addresses + `deployedBlock` land in `deployments.json`.
- [ ] Verify all 3 contracts on Basescan.
- [ ] Update `deployments.json.example`, README contract table, `CHANGELOG.md`, SDK examples.
- [ ] Point the read-only demo (`apps/static-demo`) and the SDK/MCP at mainnet addresses.
- [ ] Record a full mainnet E2E with small real value: register capability → attest → receipt → challenge → contest → resolve/finalize → discover (tx hashes as evidence).

## 5. Operations & monitoring

- [x] Structured logs (pino), `/api/healthz` (RPC latency, indexer lag), `/api/alerts`.
- [x] `docs/OPERATIONS.md` runbook + `docs/EMERGENCY.md`.
- [ ] Wire `/api/healthz` + `/api/alerts` into alerting; alert on any `EthPoolWithdrawn` / `CertifierChanged`.
- [ ] Backups: `deployments.json` + `.env` (offline); SQLite index is rebuildable.
- [ ] Confirm the public instance is **read-only** (`DEMO_READ_ONLY=true`); write path stays private.

## 6. Distribution

- [ ] Publish `@taopp/sdk`, `@taopp/mcp-server`, and `taop` (PyPI) with mainnet addresses.
- [ ] Announcement / demo URL ready.
- [ ] `twine check` green (already verified locally).

## Notes

- Fee switch stays **dormant** (`FEE_MODEL.md`); `slashedEthPool` is owner-withdrawable only. Revisit only with real usage.
- No protocol token exists in the bytecode (v2 token design is comments only) — no token/security surface to unwind today.
- The 0-delay freeze no longer applies to mainnet: unfreeze deliberately (section 1).
