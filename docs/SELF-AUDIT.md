# Self-audit report — TAOP contracts

**Type:** internal self-audit (not an external audit) · **Commit:** `main` @ time of
run · **Scope:** `contracts/ReputationOracleNetwork.sol`,
`contracts/CapabilityRegistry.sol` (v0.2), plus a light pass over the backend,
indexer, and SDKs.

> **Disclaimer.** This is a self-assessment produced by the project with free
> tooling. It is *not* a substitute for an independent professional audit. Absence
> of findings is not proof of absence of bugs. Treat the contracts as
> unaudited until a third party reviews them.

## 1. Methodology

| Layer | Tool | Result |
|---|---|---|
| Static (symbolic exec) | **Mythril v0.24.8** (runtime bytecode, `--bin-runtime`, depth 14) | No issues detected (both contracts) |
| Static (data-flow) | **Slither 0.11.5** (`--fail-medium`, deps excluded) | 0 High / 0 Medium in our code |
| Static (rules) | **Aderyn 0.6.8** | 0 High, 6 Low (accepted) |
| Lint | Solhint (recommended), ESLint | clean |
| Dynamic (fuzz) | **Foundry 1.5.1** — 2000 runs × each fuzz test | pass |
| Dynamic (invariants) | Foundry — 256 runs × depth 64 (16,384 calls/invariant) | pass, 0 reverts |
| Dynamic (unit/E2E) | Hardhat 70 · backend 31 · MCP 1 · live 4 · Python 6 | pass |
| Test-strength | **Mutation spot-check** — 12 critical lines broken | 12/12 caught |
| Manual | Privileged-path + trust-boundary review (this doc, `THREAT_MODEL.md`) | see findings |

Reproduce: `npm run slither`, `npm run contracts:test:foundry`,
`npm run mutation:spotcheck`, `npm test`, plus the Mythril command in §6.

## 2. Findings register

| ID | Title | Severity | Location | Status |
|---|---|---|---|---|
| F-01 | Missing zero-address checks (`setCertifier`, constructor, both `withdrawEthPool`) | Low | Registry/RON | **Fixed** (`ZeroAddress`) |
| F-02 | Address event params unindexed → can't filter logs by topic | Informational | Registry/RON events | **Fixed** (added `indexed`) |
| F-03 | Magic number `10000` for basis points | Informational | RON `_decayedScore` | **Fixed** (`BPS_DENOMINATOR`) |
| F-04 | `setCertifier` changed state without an event | Low | Registry | **Fixed** (`CertifierChanged`) |
| F-05 | `nonReentrant` not the first modifier | Low | RON/Registry owner fns | **Fixed** (reordered) |
| F-06 | No test that a *disputed* completion can't be re-receipted | Medium (test gap; code correct) | RON `attestReceipt` | **Fixed** (test added; found by mutation) |
| I-01 | Centralization: owner = Timelock at **0-delay, single-EOA** | High if value at risk | Timelock | **Accepted** — mitigate with multisig + non-zero delay (`hardened-timelock.md`) |
| I-02 | No pause / circuit breaker | Medium | both | **Accepted** — rotate+migrate playbook (`EMERGENCY.md`); decide before real mainnet value |
| I-03 | Sybil/collusion on self-attest + bilateral receipts | Medium | RON scoring | **Accepted** — v0.3 proposal (`anti-sybil-proposal.md`) |
| I-04 | `block.timestamp` used for decay + challenge windows | Low | RON | **Accepted** — validator drift immaterial; cannot move funds |
| I-05 | Low-level `.call{value}` for refunds/withdrawals | Info | Registry/RON | **Accepted** — success checked, `nonReentrant` |
| I-06 | PUSH0 opcode (evm `cancun`) | Info | both | **Accepted** — Base supports PUSH0 |
| I-07 | Wide pragma `^0.8.28` | Info | both | **Accepted** — solc pinned in hardhat/foundry config |
| I-08 | "Unused" `TimelockController` import | Info | both | **Accepted** — intentional, forces artifact emission for tests/deploy |

No Critical/High code findings were identified by any tool or manual pass. The
High-severity item is the **operational** 0-delay single-key governance, which is a
deployment decision, not a code defect.

## 3. Invariants verified

- **ETH conservation** — RON balance `== pendingChallenges × CHALLENGE_BOND + slashedEthPool`; Registry balance `== live bonds + slashedEthPool`.
- A disputed completion never remains receipt-confirmed.
- Scores never exceed their counts (two-sided and self-attest).
- Registry type index contains only live ids; page equals the full array slice.
- Challenge requires exactly `CHALLENGE_BOND`; no self-receipt; decay monotonic.

## 4. Residual risk (accepted / tracked)

1. Not externally audited; no bug bounty yet.
2. Governance is one key at 0-delay until the Safe + delay are deployed.
3. Economically sybil-able signal (documented; v0.3 proposal exists).
4. No emergency pause.
5. Off-chain trust: the write-enabled backend holds hot keys; the indexer is a
   rebuildable cache (reorg-aware, with on-chain fallback).

## 5. Recommended next steps (self-audit budget ≈ 0)

- [ ] Two-person review of the v0.2 diff by a second developer (four-eyes).
- [ ] Publish this report with the release; invite community review.
- [ ] Small (or reputation-based) bug bounty once funded.
- [ ] A paid external audit before meaningful mainnet TVL.
- [ ] Implement the anti-sybil + optional pause decisions (v0.3).

## 7. v0.3 addendum (pending redeploy)

New surface added after the review above — to be re-reviewed when deployed:

- `Pausable` on both contracts (owner/Timelock). Trust note: pausing is a
  privileged action and could be abused to halt protocol actions; exits
  (`revokeReceipt`, `withdrawBond`, `withdrawEthPool`) and `resolveChallenge`
  remain available while paused.
- Per-address attestation cooldown (default off; owner-settable).
- Diversity-adjusted `getCreditScore` + `distinctCounterparties` /
  `counterpartyConfirmations` tracking, with a new Foundry invariant
  (`distinct ≤ confirmed`) and contract tests (`test/V03Hardening.test.ts`).

Re-run on the v0.3 tree: **Slither clean** (`--fail-medium` exit 0; 9 low/info),
**Mythril v0.24.8 clean** on both runtime bytecodes, and the **mutation spot-check
16/16** (the four new mutants cover pause, cooldown, and diversity accounting).
The Foundry invariant now also asserts `distinctCounterparties ≤ confirmedCount`.
Re-run all tools again on the redeploy commit.

## 6. Reproduction

```bash
npm run slither                                   # --fail-medium, deps excluded
npm run contracts:test:foundry                    # fuzz + invariants
FOUNDRY_FUZZ_RUNS=2000 FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64 npm run contracts:test:foundry
npm run mutation:spotcheck                        # 12/12 critical mutants
npm test && npm run backend:test && npm run mcp:test && npm run test:live

# Mythril (symbolic execution over compiled runtime bytecode)
python3.11 -m venv /tmp/myth && /tmp/myth/bin/pip install mythril
node -e "const fs=require('fs');for(const n of ['ReputationOracleNetwork','CapabilityRegistry']){const a=require('./artifacts/contracts/'+n+'.sol/'+n+'.json');fs.writeFileSync('/tmp/'+n+'.hex',a.deployedBytecode.slice(2))}"
/tmp/myth/bin/myth analyze -f /tmp/ReputationOracleNetwork.hex --bin-runtime --execution-timeout 240
/tmp/myth/bin/myth analyze -f /tmp/CapabilityRegistry.hex --bin-runtime --execution-timeout 150
```
