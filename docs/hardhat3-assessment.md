# Hardhat 3 migration assessment

**Assessed:** 2026-09-18 · **Decision: deferred** until the coverage plugin ships
Hardhat 3 support. **Stage 0 is already applied** (dropped the unused
TypeChain/Ignition meta-toolbox) — see below. **Tracking: [#33](https://github.com/lexagor/TAOP-protocol/issues/33).**

Scope: `hardhat.config.ts`, 13 TypeScript test files (~93 tests), 2 deploy
scripts, the coverage/mutation/gas CI gates, and the dev-dependency advisory
surface. The Solidity contracts themselves are unaffected.

## TL;DR

- Hardhat 3 **compiles and tests this repo** (spike below), but two dev-tooling
  gaps block a clean migration:
  - `solidity-coverage` (0.8.17) peers `hardhat ^2.11.0` and has **no v3 release
    or beta/next tag** — the coverage gate (floors + `coverage-baseline.json`
    ratchet, a required CI check) has no Hardhat 3 path today.
  - `hardhat-gas-reporter` (2.3.0) peers `hardhat ^2.16.0` — no Hardhat 3
    release.
- Migrating now would require a permanent Hardhat 2 sidecar just for coverage,
  keeping the very advisories the migration is meant to remove.
- All remaining advisories are **dev-only**; production is
  `npm audit --omit=dev` = 0 and the repo ships a pruned runtime image. There is
  no user-facing pressure, so the recommendation is to wait for coverage support
  and follow the staged plan.

## Current state

| Item | Version / count |
|---|---|
| hardhat | 2.29.1 |
| `@nomicfoundation/hardhat-toolbox` | 6.1.2 (replaced at Stage 0) |
| Plugins actually used | hardhat-ethers, hardhat-chai-matchers, hardhat-network-helpers, hardhat-verify, hardhat-gas-reporter, solidity-coverage |
| Unused but installed via toolbox | TypeChain (9.1.0), Ignition (0.15.x) |
| Tests | 13 TS files, ~93 passing; 13 Foundry tests |
| Scripts | `deploy-local.ts`, `deploy-base-sepolia.ts` (`{ ethers } from "hardhat"`, `network`) |
| CI jobs touching hardhat | test, security, coverage, mutation, e2e, fork-rehearsal, docker |

## What Hardhat 3 changes for us

- Config: `defineConfig({ plugins: [...] })` instead of side-effect imports; TS
  config becomes ESM-friendly; secrets move to `configVariable(...)`/keystore
  instead of raw private-key arrays in `networks.*.accounts`.
- Networks are typed (`type: "edr-simulated"` / `"http"`); the in-process fork
  setup (`FORK_BASE_MAINNET`) needs rework.
- Connection API: `const { ethers, networkHelpers } = await hre.network.create()`
  (the spike shows `connect()` works but is deprecated in favour of
  `create()`/`getOrCreate()`); ethers v6 is supported via
  `@nomicfoundation/hardhat-ethers` v4.
- Test tooling: `@nomicfoundation/hardhat-mocha` (Mocha 11), chai v5 via
  `@nomicfoundation/hardhat-ethers-chai-matchers`.
- TypeChain is replaced by `@nomicfoundation/hardhat-typechain`; Ignition is v3.
- Commands (`compile`, `test`, `run`, `node`, `verify`) are unchanged in name.

## Spike (executed)

`/tmp/hh3-spike`: `hardhat@3.17.0` + `@nomicfoundation/hardhat-toolbox-mocha-ethers@3.0.7`
+ `@openzeppelin/contracts@5.6.1`, with our two contracts copied verbatim.

```text
npx hardhat compile   → Compiled 2 Solidity files with solc 0.8.28 (evm target: cancun)
npx hardhat test      → HH3 migration smoke … 1 passing
```

The smoke test exercised our real patterns: deploy, `ethers.getSigners`,
`expect(...).to.emit(...)`, `.to.be.revertedWithCustomError(...).withArgs(...)`,
`networkHelpers.time.setNextBlockTimestamp(...)`, and a 200-byte URI revert.
Mechanical deltas only: `import hre from "hardhat"` plus
`const { ethers, networkHelpers } = await hre.network.create()` in test setup,
instead of module-level `import { ethers } from "hardhat"`.

## Advisory impact (measured)

| Tree | Total | High | Moderate | Low |
|---|---:|---:|---:|---:|
| Current HH2 + our `overrides` | 27 | 0 | 6 | 21 |
| Stage 0 (no toolbox/typechain/ignition), HH2 | 23 | 0 | 5 | 18 |
| HH3 spike + our `overrides` | 13 | 0 | **0** | 13 |

Hardhat 3 removes the `web3-utils`/`bn.js`/`ethjs-unit`/`number-to-bn` and
`solidity-coverage` moderates and the old mocha/serialize-javascript/uuid chain
(with `overrides`). Residual lows are `@ethersproject/*` + `elliptic` (pulled by
`hardhat-verify`), `mocha`/`diff`, and Ignition if the toolbox is used. Note the
advisories are all dev-only: they never ship in the runtime image
(`npm prune --omit=dev`) and `npm audit --omit=dev` is 0.

## Blockers

1. **Coverage.** `solidity-coverage@0.8.17` is Hardhat 2 only; no v3 release,
   beta, or next tag exists. The CI `coverage` job and `coverage:check` ratchet
   would need a Hardhat 2 sidecar or a temporary waiver.
2. **Gas reporter.** `hardhat-gas-reporter@2.3.0` is Hardhat 2 only. Used
   optionally (`REPORT_GAS=true`); not in CI, so this is an acceptable loss if
   the rest migrates.
3. **Broad mechanical churn.** 13 test files and 2 scripts move to the
   connection API; `mutation:spotcheck` runs the suite 21 times and needs the
   same config; `e2e:local`/docker jobs start the node and deploy.
4. **Network/account config.** Typed networks + `configVariable`/keystore replace
   the raw `accounts: [DEPLOYER_PK]` arrays; fork rehearsal needs re-verification.

## Stage 0 (applied)

Replaced `@nomicfoundation/hardhat-toolbox` with explicit plugin imports and
removed the unused `@typechain/*`, `typechain`, and `@nomicfoundation/ignition*`
dev-dependencies. Tests stay at 93 passing; coverage needed an explicit
`import "solidity-coverage"` (toolbox had pulled it in as a peer). Advisories
27 → 23 (0 high). This is a pure win regardless of the Hardhat 3 decision.

## Staged plan (when coverage ships Hardhat 3 support)

1. **Stage 1 — branch spike.** Config to `defineConfig`, add a tiny `connect()`
   test helper, migrate the 13 test files, deploy scripts, and `hardhat node`
   call sites. Keep `solidity-coverage` out; run the coverage gate from a
   pinned Hardhat 2 job during the transition.
2. **Stage 2 — CI cut-over.** test/mutation/e2e/fork-rehearsal/docker jobs move
   to `hardhat@3`; foundry/live jobs unchanged. Update `contracts:*` npm scripts.
3. **Stage 3 — remove Hardhat 2.** Drop the sidecar job and the HH2
   dependencies; refresh `coverage-baseline.json` under the new tooling.
4. **Re-check upstream** every ~month (`npm view solidity-coverage dist-tags`,
   `npm view hardhat-gas-reporter peerDependencies`).

## Effort and risk

- Effort: **2–4 engineer-days** plus CI iteration (mostly mechanical; the spike
  shows no contract or matcher incompatibility).
- Risk: **medium** — CI-only, no deployed bytecode changes; the main risk is
  churn in 13 test files and the mutation script.
- Decision criteria to start: `solidity-coverage` publishes Hardhat 3 support,
  or the coverage gate is replaced by an equivalent (e.g. a maintained HH3
  coverage reporter).

## References

- Spike: `/tmp/hh3-spike` (`hardhat@3.17.0`,
  `@nomicfoundation/hardhat-toolbox-mocha-ethers@3.0.7`), commands in this doc.
- Upstream data: `npm view solidity-coverage dist-tags` (latest 0.8.17, no
  next), `npm view hardhat-gas-reporter peerDependencies` (`hardhat ^2.16.0`),
  `npm view @nomicfoundation/hardhat-ethers peerDependencies` (`hardhat ^3.17.0`).
- Applied Stage 0: `hardhat.config.ts`, `package.json` (this commit).
- Related controls: [`HARDENING.md`](HARDENING.md) supply chain section,
  [`SELF-AUDIT.md`](SELF-AUDIT.md).
