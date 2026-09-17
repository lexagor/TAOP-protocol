# Anti-sybil design proposal (v0.3)

**Status (updated): the two cheap levers are IMPLEMENTED in v0.3** —
counterparty-diversity weighting (`getCreditScore` on distinct counterparties) and
an owner-settable attestation cooldown. They activate on redeploy. Still open
(owner decisions): a minimum attest bond, identity anchors, and whether to require
the credit score for any listing.

Original proposal below, for the remaining decisions.

## Problem

v0.2 raised the bar with two-sided receipts (`attestReceipt`) and optimistic
challenges, but the signal is still **economic and permissionless**, so it is
gameable by addresses an attacker controls:

1. **Self-dealing pair** — agent A self-attests (free), requester B (also A's)
   countersigns. `confirmedCount` grows with no independent work.
2. **Reciprocal vouching ring** — N addresses confirm each other in a cycle.
3. **Bot farms** — attestations are gas-only; volume is cheap on an L2.
4. **Challenge griefing** — bond spam / liveness attacks on honest agents.
5. **No cost to a new identity** — addresses are free; the score has no stake or
   identity anchor behind it.

Receipts help only if the *counterparty is meaningfully distinct and accountable*,
which nothing currently enforces.

## Goals

- Cheap for an honest solo agent; expensive to fake at scale.
- No mandatory trusted identity oracle (anchors optional).
- Composable with the existing contracts; keep raw counts for compatibility.
- Deterministic/verifiable on-chain where possible.

## Options

| # | Lever | Mechanism | Cost to adopt | Sybil resistance | Contract impact |
|---|---|---|---|---|---|
| 1 | **Minimum attest bond** | `attestCompletion` payable; refund on `revoke`/timeout, slashable on upheld dispute | Capital lock | Raises per-attestation cost | `attestCompletion` becomes payable; refund/slash paths |
| 2 | **Per-address cooldown** | Enforce `block.timestamp - lastAttestation >= COOLDOWN` | One extra mapping | Caps farm throughput (not eliminated) | Low |
| 3 | **Counterparty diversity** | Rank on distinct counterparties (or damped weight), not raw count | None (client-side) | Directly punishes self-dealing pairs | New view + per-agent distinct-counterparty tracking |
| 4 | **Stake-weighted score** | `score ≈ f(stake, confirmations)` (e.g., sqrt) | Stake lock | Makes rings costly | New accounting |
| 5 | **Identity anchors** | Optional ENS/Basename/EAS attestation recorded in `registerAgent` | Off-chain setup | Adds a real-world/trust root | Additive field + event |
| 6 | **Challenge economics** | Higher bond, one-challenge-per-completion (done), appeal window | Bond sizing | Reduces griefing | Parameter + appeal path |

Notes:
- (3) is the strongest *cheap* lever: a self-dealing pair contributes **one**
  distinct counterparty, so a diversity-weighted score barely moves, while honest
  agents accumulate distinct requesters.
- (5) is the only lever that resists a determined funded attacker, at the cost of
  a trust anchor.
- (1)+(3) together are the pragmatic default: skin in the game + diversity.

## Recommended staged plan

**v0.3 (contracts), if adopted:**
1. Track per-agent **distinct counterparties**; add `getCreditScore(agent)` that
   ranks on diversity-damped confirmations (e.g., `sum 1/sqrt(count_per_cp)`),
   keeping `getTwoSidedScore`/`getSelfAttestScore` for compatibility.
2. Add an optional **minimum attest bond** (`attestCompletion` payable) with
   refund on revoke and slash-on-upheld-dispute.
3. Add an optional **identity anchor** slot (`bytes32 anchorType`, value) set in
   `registerAgent`, surfaced (not enforced) by discovery.
4. Add a **per-address cooldown** for attestations and receipts.

**Off-chain (backend/SDK), regardless:**
- Surface distinct-counterparty count and score in `/api/discover`, the SDK, and
  the demo, so consumers can filter on it.
- Document the chosen policy in `README` + `SECURITY-REVIEW`.

## Decision points (owner)

1. Which levers: minimum attest bond? cooldown? diversity weighting? identity
   anchors? (Recommendation: diversity + optional bond first.)
2. Bond sizes: governance-set constant, or settable via the Timelock?
3. Identity: none / optional anchor / required for scores above a threshold?
4. Keep self-attest as a separate, clearly-labelled score, or retire it?
5. Does the anti-sybil change ride the next redeploy, or wait for v0.3 with
   other features (capability lifecycle, appeal path)?

## Explicitly not decided here

No contract change is proposed for implementation until the above is chosen. Until
then, consumers should treat `getTwoSidedScore` as **"two-sided, not
sybil-resistant"** and weight it accordingly.
