# Integrating a marketplace escrow with RulingOracle

The oracle is **advisory and non-custodial**. The marketplace keeps case funds
in its own escrow, sends the case to the operator for a ruling, and only settles
when `outcome(caseId)` is final. The oracle never moves the case value.

## The only read that matters

```solidity
(uint8 ruling, uint8 status, uint64 finalizedAt, bytes32 evidenceHash) =
    oracle.outcome(caseId);
require(status == 3 || status == 4, "ruling not final"); // FINALIZED or OVERTURNED
require(ruling == 1 || ruling == 2, "no ruling");        // PAY or REFUND
```

`ruling` is already the **final direction**. For `OVERTURNED` it is the opposite
of the original ruling, so the escrow does not need to flip it again.

| Constant | Value | Meaning |
|---|---|---|
| `ruling` | `1` | `PAY`: pay the provider |
| `ruling` | `2` | `REFUND`: refund the payer |
| `status` | `1` | `RULED`: provisional, do not settle |
| `status` | `2` | `CHALLENGED`: appeal in progress, do not settle |
| `status` | `3` | `FINALIZED`: settle using `ruling` |
| `status` | `4` | `OVERTURNED`: settle using the flipped `ruling` |

A 20-line escrow example is in `examples/RulingEscrowExample.sol`; a TypeScript
read example is in `examples/ruling-escrow-read.ts`.

## Publication flow

1. The marketplace assigns a unique `caseId` (`bytes32`) and keeps the case
   value in its own escrow.
2. The marketplace gives the operator: provider, payer, fee payer, ERC-8004
   `agentId` (or `0`), value (≤ `CASE_CAP`), `specHash`, public `evidenceHash`,
   and an `evidenceURI`.
3. The fee payer approves `FEE` (25 USDC) to the oracle. The operator calls
   `publishRuling`.
4. The ruling is provisional for 48h. The wronged party may challenge for free;
   anyone else posts 10% of the value (minimum 25 USDC).
5. If challenged, the operator has 72h to escalate to the reviewer panel. Two
   of three named reviewers sign the outcome with EIP-712. If no quorum arrives
   within 24h, anyone can time the appeal out and the challenge succeeds.
6. The marketplace reads `outcome(caseId)` and settles its own escrow.

## Integration checklist

- [ ] Never settle on `RULED` or `CHALLENGED`.
- [ ] Use the deployment artifact address, not a hard-coded old address.
- [ ] Bind `evidenceHash` to the evidence bundle the escrow stores.
- [ ] Treat `agentId` as attested by the operator; verify ERC-8004 ownership if
      your marketplace relies on it.
- [ ] Decide who pays the 25 USDC fee and approve the oracle before publishing.
- [ ] Wait for enough confirmations before releasing funds.
- [ ] Do not ask the oracle to custody case funds.
- [ ] Handle the case where the operator never publishes: your escrow should
      have its own timeout/refund path.

## Signing a reviewer decision (panel only)

Reviewers sign the EIP-712 `Review` typed data. The marketplace does not need to
do this, but operators/integrators can use the SDK:

```ts
const digest = await panel.reviewDigest(requestId, upheld);
// sign with the reviewer wallet over the same domain:
// name: "RulingOracleReviewerPanel", version: "1",
// chainId, verifyingContract: panelAddress
// type Review(bytes32 requestId,bytes32 caseId,bytes32 evidenceHash,bool upheld)
const signatures = [sigA, sigB];
await panel.resolve(requestId, upheld, signatures);
```

## What is deliberately not here

- No UMA OOv3 adapter at the $300 tier. The Phase-0 panel is the appeal layer.
- No token voting.
- No on-chain reviewer bond. The reviewers are named; the operator's USDC bond
  is the economic backstop. Reviewer bonds/slashing are a Phase-1 upgrade.
- No custody of case funds by the oracle.
