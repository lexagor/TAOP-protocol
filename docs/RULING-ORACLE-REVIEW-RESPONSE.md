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

## Accepted as a policy decision, not a code change

### 2. Fee refund is funded by the operator, not the fee

This is now an explicit, documented penalty: the treasury keeps the original
$25 fee, and an overturned ruling costs the operator `value + fee + bounty`.
That is stronger accountability than making the treasury refund the fee. If the
operator and treasury become separate entities and the protocol should subsidise
overturns, a per-case fee escrow can replace this later.

## Partially accepted

### 3. Failed-challenge bond goes to the wronged party

Kept 100% to the wronged party, preserving “the operator never keeps challenge
bonds”. Extended `ESCALATION_WINDOW` from 24h to 72h so the operator has
breathing room.

Rejected the $100 minimum challenge bond: at a $300 case cap, a third party
would risk $100 to win a $30 bounty, which is negative EV even for a correct
challenge. It also does not address the free wronged-party path. The $25 fee is
the operator's arbitration compensation; the panel makes the per-case cost
small. Revisit after 10 live cases.

## Cheap fixes accepted

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
`ReviewerPanelAdapter` with EIP-712 signatures and a 24h timeout to an overturn.
No on-chain reviewer bond in Phase 0; the operator bond is the backstop. This is
documented as a named/trusted panel, not a trustless court.

## Correction to the review

The review's audit paragraph says “100% line/branch/function coverage.” The
actual numbers at the reviewed baseline were 100% statements/functions/lines and
**90% branches** for `RulingOracle` (82.28% overall). After the fixes and panel
tests, the working-tree numbers are 100% statements/functions/lines and
**83.80% branches overall** (83.796% exact; baseline 83.79%). Use those corrected
numbers in the audit packet.

## Verification

- `npx hardhat test`: 168 passing.
- `npm run contracts:coverage` + `node scripts/check-coverage.mjs`: 100%
  statements/functions/lines; 83.80% branches (baseline raised to 83.80).
- `npm run lint`, `npm run lint:sol`, `npm run typecheck`, `npm run sdk:build`:
  green.
- Slither `--fail-medium`: 0 high/medium findings (the arbitrary `transferFrom`
  was removed by the two-step `publishRuling` → `payFee` flow).
- Mutation spot-check: 42/42 caught (0 survived).

## Base Sepolia end-to-end proof

On 2026-11-02 the full mock-USDC flow was run on Base Sepolia (chain 84532):

- MockUSDC: `0xf9dcB4E6e714884D0389d7679bb5fE987001756b`
- ReviewerPanelAdapter: `0xEE828092175e3bd03fDC9f6F273593eB9fe4e72B`
- RulingOracle: `0x220ED653dFF33b82eF5B6e5672914F706Eb3c024`

The run exercised a free wronged-party challenge upheld by two reviewers
(`FINALIZED` / `PAY`) and a third-party challenge overturned to `REFUND`, with
the payer made whole and one loss recorded. The reviewer keys were throwaway
test wallets; the operator was the funded deployer. This proves the mechanics,
not a production deployment.

## Release

Final release tag: `v0.6.1-ruling-oracle` (the earlier `v0.6.0-ruling-oracle`
was the initial checkpoint before the CI/Slither fixes).

## Repo hygiene

Canonical tree is
`/Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau`.
The three stale checkouts are archived (see `docs/CANONICAL.md`) so external
reviews pin one tree and one commit.
