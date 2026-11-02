# RulingOracle — independent review (2 Nov 2026)

> **Response:** see `docs/RULING-ORACLE-REVIEW-RESPONSE.md` for the accepted,
> partially accepted, and rejected findings, plus corrected coverage numbers.

Reviewed at commit `54716d5` (working tree, 17 dirty files). `npx hardhat test` → **151 passing**. Contract read line-by-line (437 lines). Verdict: **implementation is real and deployable-in-shape; four economic defects must be fixed before any mainnet USDC is at risk.**

## Must-fix (in order)

### 1. Double payment when the wronged party challenges (RulingOracle.sol:381–413)
`_overturn` pays `c.value` to `wronged`, then pays `challengeBondFor(c.value)` as a bounty to `c.challenger`. When the wronged party is the challenger (free challenge, line 271–273), they receive both: **value + 10%**. Test coverage only exercises the watcher path (test/RulingOracle.test.ts:616), so this passes today.

Fix: `if (c.challenger != wronged)` around the bounty block. Add a test for "wronged party challenges and wins → value only".

### 2. The fee refund is paid out of the operator bond, not the fee (RulingOracle.sol:242 vs 392–397)
`publishRuling` sends FEE straight to `treasury`. `_overturn` then transfers FEE to `feePayer` and subtracts it from `operatorBond`. Net effect: treasury keeps the fee, the operator funds the refund. The docs claim the fee is refunded; economically it is refunded *by the operator*.

Fix: hold fees in a `feePool` inside the contract; refund from `feePool`; let treasury withdraw accrued fees. Then the invariant "operator loses at most `value + bounty`" is true.

### 3. Failed-challenge bond goes to the wronged party, not the operator (RulingOracle.sol:364–371)
The operator bears every escalation cost (adapter gas, UMA bond if used, time) and receives nothing when a challenge fails. With a $25–30 challenge bond and a 24h escalation SLA, forcing escalations is cheap. At a $300 cap the damage is bounded, but the incentive is backwards and it gets worse the moment the cap rises.

Fix (pick one, document it): (a) split the failed bond 50/50 operator/wronged party; (b) send it to the operator's arbitration-cost pool; or (c) leave it, but raise `MIN_CHALLENGE_BOND` to 100 USDC and `ESCALATION_WINDOW` to 72h so griefing is expensive and the operator is not on a one-day clock.

Recommendation for the pilot: (c) + (a) later. It preserves the "operator never keeps challenge bonds" line in the pitch, which is worth more than $30.

### 4. The escalation interface cannot fund a real UMA assertion (IEscalationOracle.sol:11–14)
`escalate()` is non-payable and passes only `(caseId, ruling, evidenceHash)`. UMA OOv3 requires an assertion bond in a whitelisted currency (verify USDC vs WETH on Base via `@uma/contracts-node` `getAddress("OptimisticOracleV3", 8453)`), plus a public claim string. Today the adapter must be pre-funded and must read the case back from the oracle to build a claim.

Decide now, because changing this later means redeploying: either make `escalate` payable and forward the bond, or formally adopt a pre-funded adapter contract with its own accounting. Document which.

## Also worth fixing (cheap)

- `withdrawBond` reverts with `LiveCasesExceeded` when cases are live (line 188) — wrong error, will confuse integrators. Add `CasesLive()`.
- `defaultOverturn` after escalation adds 30 days (line 304–306). If the adapter resolves after that, `resolveEscalation` reverts `CaseNotPending` and the adapter's callback fails silently — its bond may be stranded. Emit/log a distinct `TooLateToResolve` path or let late resolutions be no-ops rather than reverts.
- `evidenceURI` is capped at 200 chars (line 37). Fine for IPFS CIDs, too short for an https bundle path. 512 is safer.
- Loss records exist only for final REFUND; "clean" history is events-only. An indexer can reconstruct it, but the underwriting feed will need a `CleanRecorded` event or an off-chain join. Document the indexer contract.

## Strategic call: do not build the UMA adapter next

At a **$300 case cap**, UMA is the wrong court. The assertion bond alone (typically ≥0.1 ETH-equivalent) exceeds the value in dispute, and DVM escalation costs more than the case. You would be paying $200+ to defend a $300 ruling, which makes the oracle uneconomic at exactly the size your pilot runs.

Build instead, in this order:
1. **`ReviewerPanelAdapter`** — 2-of-3 named bonded reviewers, EIP-712 signed `(requestId, upheld)` statements, 24h resolution, no token voting. ~150 lines + tests. This is the Phase-0 appeal layer and it costs nothing per case.
2. Keep `IEscalationOracle` unchanged for now; add the payable/funding decision when the cap moves to $2–5K.
3. **UMA OOv3 belongs to the $2K+ tier** (Phase 1, bond ≥ $20K). Write that down in `docs/ruling-oracle.md` so nobody builds it early.

## The actual blocker is not code

The oracle has no cases until a marketplace calls `outcome(caseId)`. The next deliverable is not an adapter — it is:

1. A one-page integration spec + a 20-line example escrow (`require(oracle.outcome(id).status == FINALIZED)`).
2. One marketplace agreeing, in writing, to integrate that read on testnet this month (Mandala → AgentsBay → Virtuals ACP → a niche x402 marketplace).
3. One real case end-to-end on Base Sepolia with mock USDC and the reviewer adapter.
4. Then Base mainnet with a **$50 cap for the first 10 cases**, raised to $300 only after 10 clean rulings. Publishing a low cap that grows is a trust asset, not a weakness.

Do not buy a $30K audit before the raise. Get a paid one-day review from a known Solidity reviewer ($1–3K) and put the audit in the raise budget. A 437-line non-custodial contract with 151 tests and 100% line/branch/function coverage does not need a full audit to run a $50-capped pilot.

## Repo hygiene (blocking for any external review)

There are at least four checkouts of this project on disk (`~/Documents/new-credit-bureau`, `~/Documents/cline-desktop/credit-bureau/new-credit-bureau`, `~/Documents/GitHub/new-credit-bureau`, `~/Documents/15-07-grok/...`). This review is against the cline-desktop tree; earlier reviews were against `~/Documents/new-credit-bureau` at `e877d21`, which does not contain `MIN_BOND` or this contract. That mismatch produced a false "invented constant" finding. Pick one canonical tree, push to GitHub, archive the rest, and pin the commit hash in every review request.
