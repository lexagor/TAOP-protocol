# Redeploy v0.2 to Base Sepolia

Everything in this runbook is **prepared and locally rehearsed**; the only steps
that need you are the ones touching your deployer key and funds (marked
**[you]**). Nothing here requires sharing a private key with anyone.

## Why redeploy

The live pilot is v0.1.2. The current `main` ships contract changes that only take
effect after a redeploy:

- **v0.2 two-sided trust (F11):** `attestReceipt`/`revokeReceipt`,
  `contestChallenge`/`finalizeChallenge`, `getTwoSidedScore`, `confirmedCount`.
- **Paginated discovery (F10):** `countCapabilitiesByType`,
  `getCapabilitiesByTypePaged`.
- A `deployedBlock` field in `deployments.json` so the indexer backfills cleanly.

Until then the SDKs/MCP/backend detect the old bytecode and fall back to
`getSelfAttestScore`; after a redeploy they use the two-sided score.

## Preconditions (pilot, 0-delay)

- [ ] **[you]** `.env` has a funded `DEPLOYER_PK` (≥ 0.08 ETH; faucets in
      `deploy-base-sepolia.ts` output / `README.md`).
- [ ] **[you]** Decide Agent A identity: reuse (`REUSE_AGENT_A=true`, keeps the
      current address and 3 attestations) or fresh (omit it for a clean break).
- [ ] No secrets in tracked files (`npm run contracts:test` and CI already guard).

## Option A — pilot redeploy (0-delay), recommended now

```bash
cd /path/to/TAOP-protocol
git pull                       # get the v0.2 contracts + scripts

# Optional: stage the output first (never clobber the live file):
DEPLOYMENTS_PATH=/tmp/taop-v0.2.json npm run deploy:sepolia

# Inspect, then publish it into place:
cat /tmp/taop-v0.2.json
cp /tmp/taop-v0.2.json deployments.json       # deployments.json is gitignored
```

`deploy-sepolia` prints the new RON / Registry / Timelock / Agent A addresses and
writes `AGENT_A_PK` to `.env` (chmod 600) — **never** to `deployments.json`.

Expected JSON shape (addresses only):

```json
{
  "chainId": 84532, "network": "base-sepolia",
  "ron": "0x…", "registry": "0x…", "timelock": "0x…",
  "validator": "0x…", "agentA": "0x…",
  "deployedAt": "2026-…", "deployedBlock": 46860000
}
```

## Option B — hardened (multisig + non-zero delay)

Use this once you have a Safe on Base Sepolia and want to rehearse the mainnet
shape. See [`hardened-timelock.md`](hardened-timelock.md). Short version:

```bash
MULTISIG_ADDRESS=0xYourSafe TIMELOCK_DELAY=3600 npm run deploy:sepolia
```

The deployer remains `validator`/certifier unless you reconfigure it, but admin
actions (`resolveChallenge`, `withdrawEthPool`, `setCertifier`) are then proposed
by the Safe and only take effect after the delay.

## Mainnet notes

- The deploy script **does not auto-fund a freshly generated Agent A on `base`**
  (that would send real ETH). Fund it yourself, or opt in with
  `FUND_AGENT_A=true`. On testnet it still tops up automatically.
- The script **refuses to write `.env` or `deployments.json` if they are not
  gitignored** (it runs `git check-ignore`), so a misconfiguration can't commit a
  key. `.env` is chmod 600, and no private key is ever written to
  `deployments.json` or printed.
- The Basescan link printed at the end is derived from the network (mainnet vs
  Sepolia).

## Post-deploy (any option)

1. **Update the publishable artifacts:**
   - `deployments.json.example` (addresses + `deployedBlock`).
   - `README.md` contract table + "Current status" line (bump to v0.2).
   - `CHANGELOG.md`: move `[Unreleased]` → `[0.2.0]` with the new addresses.
   - `deployments.json` (local, gitignored) — already updated by the deploy.
2. **Verify on-chain** (Basescan) that owners are the Timelock and
   `getMinDelay()` matches your intent.
3. **Restart the backend.** The `last_registry` cache invalidates automatically;
   the indexer backfills from `deployedBlock`.
   ```bash
   curl -s localhost:4000/api/healthz | jq '.indexer'   # lag → 0, twoSided=true
   curl -s 'localhost:4000/api/discover?capabilityType=LoRA&limit=5' -D - -o /dev/null | grep -i x-indexer
   ```
4. **Run the v0.2 flow** and record tx hashes:
   ```bash
   curl -s -X POST localhost:4000/api/demo/run | jq        # attest
   curl -s -X POST localhost:4000/api/completions/<id>/receipt | jq   # two-sided
   curl -s 'localhost:4000/api/agents/<agentA>/score' | jq      # rankingScoreType: two-sided
   ```
5. **Republish packages** (when you want npm/PyPI live):
   `npm run sdk:build && (cd packages/sdk && npm publish --access public)`,
   `npm run mcp:publish`, Python `python -m build && twine upload`.

## Local rehearsal (already verified, no keys needed)

Proves the deploy path end to end without spending anything:

```bash
# in-process hardhat network — no node, no funds, no keys
DEPLOYMENTS_PATH=/tmp/taop-local.json npx hardhat run scripts/deploy-local.ts
cat /tmp/taop-local.json          # addresses + deployedAt + deployedBlock

# Timelock hardening rehearsal (non-zero delay + multisig proposer):
TIMELOCK_DELAY=3600 MULTISIG_ADDRESS=0x0000000000000000000000000000000000000001 \
  npx hardhat run scripts/deploy-local.ts

# Contract-level proof of both modes:
npx hardhat test test/TimelockDelay.test.ts
```

Last verified: **56 contract tests + 4 Timelock-delay tests pass**; the deploy
script writes the expected addresses-only JSON with `deployedBlock`.

## Rollback

- `deployments.json` and `.env` are the only deploy outputs (both gitignored).
  To revert to the v0.1.2 pilot, restore your previous `deployments.json` (and
  `AGENT_A_PK`) and restart the backend — the old contracts are untouched.
- Contract redeploys are additive; nothing on-chain is destroyed.
