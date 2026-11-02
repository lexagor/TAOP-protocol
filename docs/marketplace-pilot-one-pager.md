# RulingOracle — marketplace pilot one-pager

## What it is

A non-custodial, USDC-bonded adjudication oracle for public-evidence agent work.
Your marketplace keeps the case funds in its own escrow. The oracle publishes a
provisional `PAY`/`REFUND` ruling, allows a 48h challenge, and resolves appeals
through a 2-of-3 named reviewer panel. Your escrow reads `outcome(caseId)` once
and settles.

No token. No custody. No UMA at this tier.

## Pilot terms

| Item | Value |
|---|---|
| Case cap | $50 for the first 10 mainnet cases, then up to $300 |
| Operator bond | $3,000 USDC |
| Challenge window | 48 hours |
| Escalation window | 72 hours |
| Reviewer resolution | 48 hours, 2-of-3 named reviewers |
| Case fee | $25 USDC, paid by the named fee payer |
| Challenge bond | 10% of value, minimum $25; wronged party free |
| Loss records | final `REFUND` only; non-transferable |

## Integration effort

1. Keep the case value in your escrow.
2. Send `caseId`, provider, payer, fee payer, value, `specHash`, public
   `evidenceHash`, and `evidenceURI` to the operator.
3. Operator calls `publishRuling`; your fee payer approves $25 and calls
   `payFee`. The challenge clock starts.
4. Read `outcome(caseId)`. It returns `NONE` until the case is final; settle only
   when `status` is `FINALIZED` (3) or `OVERTURNED` (4). `ruling` is already the
   final direction.
5. `status == PENDING_FEE` (5), `RULED` (1), or `CHALLENGED` (2) means do not
   settle yet.

A 20-line Solidity example is in `examples/RulingEscrowExample.sol`; the full
integration note is `docs/ruling-oracle-integration.md`.

## What we need from the pilot partner

- One written yes to call `outcome(caseId)` on Base Sepolia this month.
- Two or three representative case types and their evidence format.
- A named fee payer and a feedback contact.
- Agreement that the oracle is advisory: your escrow remains the custodian.

## What the partner gets

- A bounded, auditable dispute path without building an arbitration team.
- Public evidence hashes and a portable loss record for the provider.
- Input into the reviewer panel, dispute categories, and the Phase-1 cap raise.
- No protocol token exposure and no custody risk.

## Status

- Contracts, panel, SDK, local E2E, and a Base Sepolia mock-USDC E2E are complete.
- Mainnet is gated on a short paid review, entity/banking, and the first
  marketplace commitment.
- Phase-1 UMA OOv3 is reserved for $2K+ cases with a ≥$20K bond.
