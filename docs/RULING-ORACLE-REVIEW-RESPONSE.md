# Response to the RulingOracle independent review

Reviewed baseline: `54716d5` (working tree). This response records what was
accepted, changed, or deliberately rejected. It is not a rewrite of the
reviewer's findings; see `docs/RULING-ORACLE-REVIEW.md` for the original.

## Accepted and fixed

### 1. Double payment when the wronged party challenges

Fixed in `_overturn`: the watcher bounty is paid only when
`c.challenger != wronged`. A winning wronged party receives the case value (and
the fee refund when it is the fee payer) but no bounty. Added tests for both
`PAY` (payer challenges) and `REFUND` (provider challenges), plus the existing
third-party watcher test.

### 4. Escalation interface cannot fund UMA

Decision: **Phase 0 keeps `IEscalationOracle` non-payable**. The Phase-0 adapter
is `ReviewerPanelAdapter`; it needs no per-case bond and reads the case from the
oracle. UMA OOv3 is deferred to Phase 1 ($2K+ cases, ≥$20K bond) and will use a
pre-funded adapter or a future oracle version. This is documented in
`docs/ruling-oracle.md` and `docs/ruling-oracle-integration.md`.

## Fixed in round 2

### A. `outcome()` failed open

Fixed: `outcome()` returns `Ruling.NONE` unless the case is `FINALIZED` or
`OVERTURNED`. `provisionalRuling()` is the explicit UI-only view. An escrow can
no longer settle on a provisional ruling by forgetting the status check.

### B. `PENDING_FEE` bricked caseIds

Fixed: `cancelUnpaid` lets the fee payer cancel immediately and the operator
cancel after `PENDING_FEE_TTL` (7 days). Cancelling deletes the case, so a
deterministic marketplace caseId can be republished.

### C. Fee refund is funded by the operator, not the fee

Fixed with an in-contract fee reserve: `payFee` holds the fee, `_finalize`
accrues it to `feePool`, and `_overturn` refunds it from the reserve (not the
operator bond). `withdrawFees` lets the treasury collect finalized fees. The
operator's overturn loss is now `value + bounty`.

### D. Panel liveness and ignored resolutions

The reviewer window is now 48h. The docs require published reviewer names, one
marketplace-nominated reviewer, and a written on-call commitment. The panel now
checks the oracle before resolving/timing out: if the oracle is already final,
the panel emits `ResolutionIgnored`, marks the request resolved, and does not
call the oracle, so the two contracts cannot disagree in public.

## Partially accepted

### 3. Failed-challenge bond goes to the wronged party

Kept 100% to the wronged party, preserving “the operator never keeps challenge
bonds”. `ESCALATION_WINDOW` is 72h and the reviewer panel window is 48h so the
operator has breathing room.

Rejected the $100 minimum challenge bond: at a $300 case cap, a third party
would risk $100 to win a $30 bounty, which is negative EV even for a correct
challenge. It also does not address the free wronged-party path. The $25 fee is
the operator's arbitration compensation; the panel makes the per-case cost
small. Revisit after 10 live cases.

## Cheap fixes accepted

- `outcome()` now fails closed (`Ruling.NONE` until `FINALIZED`/`OVERTURNED`);
  `provisionalRuling()` is the UI-only view.
- Added `cancelUnpaid` and a 7-day `PENDING_FEE_TTL`; cancelled caseIds are
  reusable.
- Added `CasesLive()` for `withdrawBond`.
- Late resolutions after finalization are now no-ops with
  `LateResolutionIgnored(requestId, rulingUpheld)` instead of reverting, so an
  adapter cannot be left with a stranded callback.
- Raised `MAX_URI_LEN` to 512.
- Documented the indexer path for clean (final `PAY`) history: `RulingFinalized`
  carries the ruling; no separate `CleanRecorded` event is required.
- Slither high/medium gate: publication is now an offer and the named fee payer
  calls `payFee`, eliminating the arbitrary `transferFrom` (the fee is always
  pulled from `msg.sender`). Enum comparisons and the `nonReentrant` escalation
  callback are annotated; no high/medium findings should remain.

## Strategic call

Agreed: no UMA adapter at $300. Implemented the 2-of-3 named
`ReviewerPanelAdapter` with EIP-712 signatures and a 48h timeout to an overturn.
No on-chain reviewer bond in Phase 0; the operator bond is the backstop. The
pilot docs require published reviewer names, one marketplace-nominated reviewer,
and a written on-call commitment. This is documented as a named/trusted panel,
not a trustless court.

## Correction to the review

The review's audit paragraph says “100% line/branch/function coverage.” The
actual numbers at the reviewed baseline were 100% statements/functions/lines and
**90% branches** for `RulingOracle` (82.28% overall). After the fixes and panel
tests, the working-tree numbers are 100% statements/functions/lines and
**83.77% branches overall** (83.772% exact; baseline 83.77%). Use those corrected
numbers in the audit packet.

## Verification

- `npx hardhat test`: 175 passing.
- `npm run contracts:coverage` + `node scripts/check-coverage.mjs`: 100%
  statements/functions/lines; 83.77% branches (baseline 83.77).
- `npm run lint`, `npm run lint:sol`, `npm run typecheck`, `npm run sdk:build`:
  green.
- Slither `--fail-medium`: 0 high/medium findings (the arbitrary `transferFrom`
  was removed by the two-step `publishRuling` → `payFee` flow).
- Mutation spot-check: 48/48 caught (0 survived).
- `npm audit --omit=dev`: 0 production advisories. The remaining 49 are dev-only
  low/moderate findings in the lint/docs toolchain.

## Base Sepolia end-to-end proof

On 2026-11-02 the full mock-USDC flow was run on Base Sepolia (chain 84532):

- MockUSDC: `0x80af126f21A55a9928f428C173f025022275B533`
- ReviewerPanelAdapter: `0x971012917845D865428168729e3814EBD27B34A5`
- RulingOracle: `0x3e4E03214cAdBBf36980C7E60856BA412e31Ad8D`

The run exercised a free wronged-party challenge upheld by two reviewers
(`FINALIZED` / `PAY`) and a third-party challenge overturned to `REFUND`, with
the payer made whole and one loss recorded. The reviewer keys were throwaway
test wallets; the operator was the funded deployer. This proves the mechanics,
not a production deployment.

## Release

Final release tag: `v0.6.2-ruling-oracle` (round-2 fixes). The earlier tags are
`v0.6.0-ruling-oracle` (initial checkpoint) and `v0.6.1-ruling-oracle` (CI/Slither
cleanup).

## Repo hygiene

Canonical tree is
`/Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau`.
The three stale checkouts are archived (see `docs/CANONICAL.md`) so external
reviews pin one tree and one commit.
