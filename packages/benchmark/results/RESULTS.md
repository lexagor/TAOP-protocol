# TAOP gaming-resistance benchmark

Deterministic, seed-reproducible scores (0-100, higher is better) for the TAOP Base mechanisms and four baselines across three attack classes. See `README.md` for the rubric and its limitations.

- Generated: 2026-09-18T09:38:59.710Z
- Seed: 42
- Scenarios: sybil, slow-burn, collusion
- Harness version: 0.1.0

## Configuration

- Sybil: 20 identities x 10 attestations, challenge probability 0.1, upheld probability 0.9
- Slow burn: target score 50, harvest 5 ETH, 2 attestations/day, 64 accomplices
- Collusion: ring of 10, 1 ratings per pair, 30 honest agents x 2 ratings, reciprocity threshold 0.8, k-core threshold 4
- Economics: 0.01 ETH challenge bond, 0.01 ETH capability bond, 30-day grace + 150-day linear decay
- Gas: measured from gas-snapshot.json; 0.03 gwei base fee + 0.01 gwei priority fee + 0.000003 ETH L1 data per tx

## Summary

| Mechanism | Sybil | Slow burn | Collusion | Composite |
|---|---:|---:|---:|---:|
| `base_taop_v03` | 7.5 | 0.2 | 0.0 | 2.6 |
| `base_taop_twosided` | 7.5 | 0.2 | 0.0 | 2.6 |
| `base_taop_self_attest` | 3.8 | 0.2 | 100.0 | 34.7 |
| `naive_count` | 0.0 | 0.2 | 100.0 | 33.4 |
| `completions_minus_disputes` | 3.8 | 0.2 | 100.0 | 34.7 |
| `peer_ratings` | 100.0 | 100.0 | 0.0 | 66.7 |
| `stake_gated` | 53.8 | 10.0 | 100.0 | 54.6 |

Composite is the equal-weight mean of the three class scores. Note that collusion "immunity by omission" (a mechanism that ignores peer feedback cannot be inflated by a ring, so it scores 100) is not the same as detection: per-mechanism detector precision/recall are reported with each mechanism below.

## `base_taop_v03`

RON getCreditScore: distinct counterparties that confirmed at least one completion, score = max(0, distinct counterparties - disputes) with inactivity decay.

Weak spots:

- A funded ring can manufacture counterparties faster than watchers challenge them
- Bonded capital does not cover a high-value harvest
- Fabricated peer receipts are accepted at face value

**Sybil farming** — score 7.5/100

Attacker commits 0.000024226 ETH per effective reputation point (0.000000000 ETH of it locked capital) versus 0.000020592 ETH for honest work (efficiency 0.85x). 15/16 challenges were upheld; 200 ring-internal receipts were funded. Self-attested work is indistinguishable from honest work at this challenge rate.

**Slow burn then harvest** — score 0.2/100

Reached score 50 in 25 days for 0.001044809 ETH. Bonded capital (0.010000000 ETH) covers 0.2% of the 5.000000000 ETH harvest. Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.

**Collusive ring** — score 0.0/100

A ring of 10 accounts manufactures 9 points per member at 0.000020592 ETH per point, versus 0.000020592 ETH for a genuine rating. Best detector: reciprocity (precision 1.00, recall 1.00, F1 1.00) over a mixed graph of 40 accounts.

| Detector | Flagged | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| reciprocity | 10 | 1.00 | 1.00 | 1.00 |
| mutual_degree | 10 | 1.00 | 1.00 | 1.00 |
| k_core | 10 | 1.00 | 1.00 | 1.00 |
| ensemble | 10 | 1.00 | 1.00 | 1.00 |

## `base_taop_twosided`

RON getTwoSidedScore: receipt-confirmed completions, score = max(0, confirmations - disputes) with inactivity decay.

Weak spots:

- A funded ring can manufacture counterparties faster than watchers challenge them
- Bonded capital does not cover a high-value harvest
- Fabricated peer receipts are accepted at face value

**Sybil farming** — score 7.5/100

Attacker commits 0.000024226 ETH per effective reputation point (0.000000000 ETH of it locked capital) versus 0.000020592 ETH for honest work (efficiency 0.85x). 15/16 challenges were upheld; 200 ring-internal receipts were funded. Self-attested work is indistinguishable from honest work at this challenge rate.

**Slow burn then harvest** — score 0.2/100

Reached score 50 in 25 days for 0.001044809 ETH. Bonded capital (0.010000000 ETH) covers 0.2% of the 5.000000000 ETH harvest. Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.

**Collusive ring** — score 0.0/100

A ring of 10 accounts manufactures 9 points per member at 0.000020592 ETH per point, versus 0.000020592 ETH for a genuine rating. Best detector: reciprocity (precision 1.00, recall 1.00, F1 1.00) over a mixed graph of 40 accounts.

| Detector | Flagged | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| reciprocity | 10 | 1.00 | 1.00 | 1.00 |
| mutual_degree | 10 | 1.00 | 1.00 | 1.00 |
| k_core | 10 | 1.00 | 1.00 | 1.00 |
| ensemble | 10 | 1.00 | 1.00 | 1.00 |

## `base_taop_self_attest`

RON getSelfAttestScore: self-attested completions, ETH challenge bonds, optimistic resolution, score = max(0, completions - disputes) with inactivity decay.

Weak spots:

- Self-attested completions have no verifier and can be manufactured cheaply
- Bonded capital does not cover a high-value harvest

**Sybil farming** — score 3.8/100

Attacker commits 0.000012419 ETH per effective reputation point (0.000000000 ETH of it locked capital) versus 0.000011487 ETH for honest work (efficiency 0.92x). 15/16 challenges were upheld. Self-attested work is indistinguishable from honest work at this challenge rate.

**Slow burn then harvest** — score 0.2/100

Reached score 50 in 25 days for 0.000589597 ETH. Bonded capital (0.010000000 ETH) covers 0.2% of the 5.000000000 ETH harvest. Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.

**Collusive ring** — score 100.0/100

Peer feedback does not contribute to the score, so the ring manufactures nothing and there is no recorded rating graph to inspect. This is immunity by omission, not detection.

## `naive_count`

Baseline: score = completions, no bonds, no disputes, no decay.

Weak spots:

- Self-attested completions have no verifier and can be manufactured cheaply
- Bonded capital does not cover a high-value harvest

**Sybil farming** — score 0.0/100

Attacker commits 0.000011487 ETH per effective reputation point (0.000000000 ETH of it locked capital) versus 0.000011487 ETH for honest work (efficiency 1.00x). 15/16 challenges were upheld. Self-attested work is indistinguishable from honest work at this challenge rate.

**Slow burn then harvest** — score 0.2/100

Reached score 50 in 25 days for 0.000589597 ETH. Bonded capital (0.010000000 ETH) covers 0.2% of the 5.000000000 ETH harvest. Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.

**Collusive ring** — score 100.0/100

Peer feedback does not contribute to the score, so the ring manufactures nothing and there is no recorded rating graph to inspect. This is immunity by omission, not detection.

## `completions_minus_disputes`

Baseline: score = max(0, completions - disputes), no inactivity decay.

Weak spots:

- Self-attested completions have no verifier and can be manufactured cheaply
- Bonded capital does not cover a high-value harvest

**Sybil farming** — score 3.8/100

Attacker commits 0.000012419 ETH per effective reputation point (0.000000000 ETH of it locked capital) versus 0.000011487 ETH for honest work (efficiency 0.92x). 15/16 challenges were upheld. Self-attested work is indistinguishable from honest work at this challenge rate.

**Slow burn then harvest** — score 0.2/100

Reached score 50 in 25 days for 0.000589597 ETH. Bonded capital (0.010000000 ETH) covers 0.2% of the 5.000000000 ETH harvest. Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.

**Collusive ring** — score 100.0/100

Peer feedback does not contribute to the score, so the ring manufactures nothing and there is no recorded rating graph to inspect. This is immunity by omission, not detection.

## `peer_ratings`

Baseline: score = distinct agents that rated you minus disputes (ERC-8004-style feedback).

Weak spots:

- Fabricated peer receipts are accepted at face value

**Sybil farming** — score 100.0/100

No effective score could be manufactured for this configuration.

**Slow burn then harvest** — score 100.0/100

Unreachable: score 50 was not reached at 2 attestations/day.

**Collusive ring** — score 0.0/100

A ring of 10 accounts manufactures 9 points per member at 0.000009104 ETH per point, versus 0.000009104 ETH for a genuine rating. Best detector: reciprocity (precision 1.00, recall 1.00, F1 1.00) over a mixed graph of 40 accounts.

| Detector | Flagged | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| reciprocity | 10 | 1.00 | 1.00 | 1.00 |
| mutual_degree | 10 | 1.00 | 1.00 | 1.00 |
| k_core | 10 | 1.00 | 1.00 | 1.00 |
| ensemble | 10 | 1.00 | 1.00 | 1.00 |

## `stake_gated`

Baseline: score = min(completions - disputes, floor(stake / 0.01 ETH)), stake fully slashable.

Weak spots:

- Bonded capital does not cover a high-value harvest

**Sybil farming** — score 53.8/100

Attacker commits 0.010823788 ETH per effective reputation point (2.000000000 ETH of it locked capital) versus 0.010012004 ETH for honest work (efficiency 0.93x). 15/16 challenges were upheld. Self-attested work is indistinguishable from honest work at this challenge rate.

**Slow burn then harvest** — score 10.0/100

Reached score 50 in 25 days for 0.000579541 ETH. Bonded capital (0.500000000 ETH) covers 10.0% of the 5.000000000 ETH harvest. Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.

**Collusive ring** — score 100.0/100

Peer feedback does not contribute to the score, so the ring manufactures nothing and there is no recorded rating graph to inspect. This is immunity by omission, not detection.

## Limitations

- Simulation, not execution: costs mirror the bytecode via the gas snapshot and the score rules mirror the contracts, but transactions are not executed.
- Locked capital is counted at face value; it is recoverable unless slashed. Treat it as capital-at-risk, not spend.
- Challenge and upheld probabilities are assumptions; watcher incentives are not modeled.
- Detectors are simple structural baselines (reciprocity, mutual degree, k-core); a planted ideal clique is easy, adaptive rings are not.
- L1 data fees, priority-fee spikes, MEV, and reputation laundering across identities are not modeled.
