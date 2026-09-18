# TAOP benchmark sensitivity

Assumptions are varied one at a time around the seed-42 defaults. Amounts are in ETH;
the reference capital threshold for the Sybil capital component is 0.01 ETH.

### Seed-42 reference

| Mechanism | Sybil | Slow burn | Collusion | Composite |
|---|---:|---:|---:|---:|
| `base_taop_v03` | 7.5 | 0.2 | 0.0 | 2.6 |
| `base_taop_self_attest` | 3.8 | 0.2 | 100.0 | 34.7 |

### Sybil resistance vs watcher challenge probability

| Challenge probability | Self-attest | v0.3 credit score |
|---:|---:|---:|
| 0.00 | 0.0 | 0.0 |
| 0.01 | 0.5 | 1.0 |
| 0.05 | 2.2 | 4.5 |
| 0.10 | 3.8 | 7.5 |
| 0.30 | 14.0 | 28.0 |
| 0.50 | 22.0 | 41.5 |

### Slow-burn coverage vs capability bond (harvest = 5 ETH)

| Capability bond | USD (at $3k/ETH) | Slash coverage | Resistance |
|---:|---:|---:|---:|
| 0.001 ETH | $3 | 0.02% | 0.0 |
| 0.01 ETH | $30 | 0.20% | 0.2 |
| 0.1 ETH | $300 | 2.00% | 2.0 |
| 1 ETH | $3,000 | 20.00% | 20.0 |
| 5 ETH | $15,000 | 100.00% | 100.0 |


Notes:

- The Sybil capital component is zero for both TAOP mechanisms when attackers lock no
  capital; the difference between them is the cost of the counterparty receipts a
  diversity-adjusted score requires.
- Slow-burn resistance is linear in the capability bond because the bond is the only
  slashable capital: coverage of a 5 ETH harvest needs a 5 ETH bond.
