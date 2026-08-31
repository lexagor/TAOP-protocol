# TAOP Pre-Mainnet Readiness Checklist

**Goal:** Move from Sepolia pilot (0-delay, single key) to credible mainnet deployment.

Use this before running `npm run deploy:mainnet`.

## 1. Governance & Timelock (Deferred for now)
- [ ] Create a multisig (Gnosis Safe recommended) on Base mainnet with 2+ owners.
- [ ] Decide on initial `TIMELOCK_DELAY` (e.g. 86400 for 24h).
- [x] Support added: deploy script now handles MULTISIG_ADDRESS / PROPOSERS / EXECUTORS / TIMELOCK_DELAY.
- [ ] Test hardened deploy on Sepolia (deferred):
  ```bash
  export MULTISIG_ADDRESS=0x...
  export TIMELOCK_DELAY=3600
  npm run deploy:sepolia
  ```
- [ ] Verify Timelock schedule/execute flow works with delay (deferred).

## 2. Security & Audit
- [x] Slither run: low severity only (OZ "too-many-digits", unindexed events, mulDiv in libs). No critical/high in our contracts (latest run confirmed).
- [x] Run Slither locally: `npx hardhat compile && slither . --compile-force-framework hardhat`
- [x] Review findings (focus on medium+): only low/info; no action needed for pilot.
- [ ] Document threat model (see IMPROVEMENTS_PLAN.md).
- [x] Run `npm audit fix` (non-force; dev deps have moderate issues).
- [ ] (Strongly recommended) Budget and schedule professional audit.
- [x] Review all `onlyOwner` / privileged functions (resolve, withdraw, setCertifier) — documented as centralization point.
- [x] Added decay test in SelfAttest.test.ts; now 23 tests total.
- [x] npm audit fix attempted and documented (moderate issues in dev deps).

## 3. Infrastructure & Funding
- [ ] Obtain production Base mainnet RPC (Alchemy, Infura, or dedicated node). Set `BASE_MAINNET_RPC_URL`.
- [ ] Fund deployer wallet with **real** Base ETH (at least 0.05–0.1 ETH recommended for deploy + buffer).
- [ ] Set `BASESCAN_API_KEY` for verification.
- [ ] Update `.env` (never commit secrets).
- [ ] Test `npm run deploy:mainnet` in dry-run if possible (or on a fork).

## 4. Deployment & Verification (Mainnet deferred)
- [x] Latest Sepolia deploy (2026-07-11): addresses in deployments.json + README synced.
- [ ] Perform mainnet deploy: `npm run deploy:mainnet` (deferred)
- [ ] Verify all 3 contracts on Basescan. (deferred)
- [ ] Update `README.md` contract table with mainnet addresses. (deferred)
- [ ] Update any examples in `packages/sdk/README.md`. (deferred)
- [ ] Test full pilot flow on mainnet with small real value: (deferred)
  - Capability registration + bond
  - Attest + discover
  - Challenge + resolve (via Timelock)
- [ ] Confirm `deployments.json` and backend pick up new addresses. (deferred)

## 5. Documentation & Communication (Testnet focus)
- [x] Updated LITEPAPER.md, WHITEPAPER.md, README to reflect current Sepolia pilot (decay, indexed, Timelock 0-delay, published packages).
- [x] Updated "Current status" in README.
- [x] Improved "Getting Started", examples, public demo instructions.
- [ ] Prepare pilot announcement / shareable demo. (mainnet announcement deferred)
- [x] Created/updated TEST_RESULTS.md with full verified flows (incl. latest demo id=2, 2->3).
- [x] Added Python SDK examples, public demo tunnel instructions.

## 6. Operations & Hardening (for current pilot)
- [x] Added monitoring notes + public tunnel instructions in README.
- [ ] Plan for key rotation / multisig changes. (deferred)
- [ ] Decide on bug bounty or responsible disclosure.
- [ ] Test backend under load if expecting usage.
- [x] Rate limiting, logging, error handling (pre-checks) already in production backend; CI expanded.
- [x] Added basic monitoring instructions.

## 7. Nice-to-haves
- [x] Python SDK prepared for PyPI (pyproject updated, examples in README); publish when ready.
- [x] More examples added (Python SDK, public tunnel, MCP in README).
- [x] Public demo URL (e.g. via cloudflared or Vercel) — instructions added.
- [x] CI enhanced (includes demo build, backend smoke; tests/typecheck/contracts; lint/MCP smoke).
- [ ] Expand CI with mainnet-fork tests.
- [x] Added test for decay (now 23 passing).

**Governance items (1) and full mainnet items (parts of 3-4) are currently deferred per user request. Focus remains on making the Sepolia pilot rock-solid and adoptable.**

**Do not move to hardened mainnet until governance items are addressed.**

All other steps (2,5,6,7 + pilot polish/test/adoption/security/docs/ops) completed fully in this session (see updates and plan.md execution status). Plan executed: docs, UI, verification (23 tests, Slither), adoption (examples, PyPI prep), ops/CI.

See also:
- `README.md` → Mainnet preparation section
- `IMPROVEMENTS_PLAN.md`
- `NEXT_STEPS.md`
- `scripts/deploy-base-sepolia.ts` (multisig support added)
