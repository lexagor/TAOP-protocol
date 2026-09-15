# Security review — TAOP contracts

Manual + automated review of `contracts/ReputationOracleNetwork.sol` and
`contracts/CapabilityRegistry.sol` before mainnet. Companion to
[`../SECURITY.md`](../SECURITY.md), [`hardened-timelock.md`](hardened-timelock.md)
and [`redeploy-v0.2.md`](redeploy-v0.2.md).

> This is an internal review, **not** an external audit. It reduces risk but does
> not replace one. See "Remaining risk" for what to do before mainnet value.

## Scope

| | |
|---|---|
| Contracts | `ReputationOracleNetwork`, `CapabilityRegistry` (391 nSLOC, Solidity 0.8.28, optimizer 200, evm `cancun`) |
| Tools | Slither `0.11.5`, Cyfrin Aderyn `0.6.8` |
| Dynamic tests | 68 Hardhat tests, 11 Foundry fuzz/invariant tests, 19 backend tests |
| Commit | `af3a661` (no High/Medium findings at time of writing) |

## Automated results

- **Slither** (`npm run slither`, `--fail-medium`, dependencies excluded): **no
  High/Medium** in our contracts. Remaining low/info are `block.timestamp`
  comparisons (intended — decay + challenge windows), `low-level-calls` (checked
  `.call{value}` refunds/withdrawals), and OZ pragma noise.
- **Aderyn**: **0 High, 6 Low** (style/design, all accepted below).
- **Foundry invariants** (64 runs × 32 depth) hold against randomized action
  sequences:
  - ETH conservation — RON balance `== pendingChallenges * CHALLENGE_BOND + slashedEthPool`; Registry balance `== live bonds + slashedEthPool`.
  - A disputed completion never remains receipt-confirmed.
  - Scores never exceed their counts (two-sided and self-attest).
  - Registry type index contains only live ids.

## Privileged paths (manual)

| Function | Gate | Notes |
|---|---|---|
| `resolveChallenge` | `owner` (Timelock) | Owner-only adjudication of **contested** challenges. Sets `disputed`, invalidates any receipt, refunds the challenger on uphold. Non-reentrant; state set before the ETH send. |
| `withdrawEthPool` (both) | `owner` (Timelock) | Bounded by `slashedEthPool`; rejects zero recipient; non-reentrant. |
| `setCertifier` | `owner` (Timelock) | Now emits `CertifierChanged`; rejects zero. |
| `certifyCapability` / `slashCapability` | `certifier` or `owner` | Certification + bond slashing. `slashCapability` is bounded by the remaining bond; `slashed` is write-once. |
| `attestReceipt` / `revokeReceipt` | permissionless / counterparty | Rejects agent self-receipt and double receipts; a receipt is invalidated on an upheld dispute. |
| `contestChallenge` | agent only | Within `CHALLENGE_WINDOW`; blocks optimistic finalize. |
| `finalizeChallenge` | **permissionless** | Only for uncontested challenges **after** the window; always upholds. No privileged input. |
| `attestCompletion`, `challengeCompletion`, `registerCapabilityEth`, `registerAgent` | permissionless | Gas/bond-priced; bonds go to the contract, not an EOA. |

Trust boundary: the **owner is the `TimelockController`**. At the pilot it is a
0-delay, single-EOA proposer/executor (effectively one key). See
`hardened-timelock.md` — a multisig proposer + non-zero delay is the mainnet
prerequisite.

## Accepted low findings

| Finding | Decision |
|---|---|
| Centralization risk (Aderyn L-1) | Documented and intended; mitigated by Timelock → multisig + delay. |
| Costly op inside loop (Aderyn L-2) | `_removeFromTypeIndex` swap-and-pop; one SSTORE at the match, bounded by live capability count. |
| PUSH0 opcode / EVM version (L) | We pin `cancun`; Base supports PUSH0. |
| Unspecific pragma `^0.8.28` (L) | Standard practice; `solc` is pinned in `hardhat.config.ts` + `foundry.toml`. |
| Unused `TimelockController` import (L) | **Load-bearing**: it forces Hardhat/Foundry to emit the artifact used by tests/deploy (`getContractFactory("TimelockController")`). Kept deliberately. |
| `block.timestamp` comparisons (Slither) | Decay + challenge windows only; ~seconds of validator drift is immaterial and cannot move ETH. |

## Remaining risk (must address before mainnet value)

1. **Sybil / collusion.** Self-attest plus bilateral receipts are gameable by two
   colluding addresses. Before mainnet: a minimum bond to attest, per-address
   rate limits, and identity anchors (ENS/Basename/EAS). This is the product's
   credibility gap, not a code bug.
2. **No pause / circuit breaker.** If a bug is found post-deploy there is no
   emergency stop. Decide whether to add one or accept and rely on a fast patch +
   Timelock.
3. **Governance.** Until the multisig + non-zero delay are live, admin is one key.
4. **Off-chain surface.** The backend holds hot keys and the indexer is a
   rebuildable cache; publish only the read-only instance, keep the write path
   loopback/API-keyed. The indexer now confirms depth + rebuilds on reorg.
5. **External audit.** Not yet performed. Recommended before meaningful TVL.

## Release gate (suggested)

- [ ] v0.2 deployed to Sepolia and the full E2E run with recorded tx hashes.
- [ ] Safe multisig + non-zero Timelock delay rehearsed on Sepolia.
- [ ] Sybil/anti-abuse policy decided (even if "accept for pilot").
- [ ] Slither + Aderyn clean (High/Medium) on the release commit (CI enforces Slither).
- [ ] External audit or a funded review, per budget.
