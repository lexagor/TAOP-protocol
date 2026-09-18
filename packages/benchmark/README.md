# TAOP gaming-resistance benchmark

Deterministic, seed-reproducible scores (0–100, higher is better) for the TAOP
Base credit bureau and four baselines across three attack classes:

1. **Sybil farming** — many cheap identities manufacture reputation without
   performing valuable work.
2. **Slow burn then harvest** — one identity accrues trust slowly, then extracts
   value in a single action.
3. **Collusive ring** — a closed group mutually inflates its members' scores.

This is a *mechanism* benchmark: it evaluates the rules, not the quality of an
implementation. It is a port of the Solana harness at
[`arlechins/sol-ai`](https://github.com/arlechins/sol-ai) (MIT) re-parameterized
for Base/ETH with the TAOP Base mechanisms added.

## Mechanisms

| Mechanism | Score rule | Bonds |
|---|---|---|
| `base_taop_v03` | distinct counterparties − disputes, linear decay | challenge bond, capability bond |
| `base_taop_twosided` | receipt confirmations − disputes, linear decay | challenge bond, capability bond |
| `base_taop_self_attest` | self-attested completions − disputes, linear decay | challenge bond, capability bond |
| `naive_count` | completions | none |
| `completions_minus_disputes` | completions − disputes, no decay | none |
| `peer_ratings` | distinct raters − disputes (ERC-8004-style) | none |
| `stake_gated` | min(completions − disputes, floor(stake / 0.01 ETH)) | stake fully slashable |

`linearDecayScore` mirrors `ReputationOracleNetwork._decayedScore` exactly
(30-day grace, 150-day linear horizon, integer division).

## Economics

Costs are modeled in wei from measured gas (`gas-snapshot.json`) plus published
price assumptions: 0.03 gwei base fee, 0.01 gwei priority fee, and 0.000003 ETH
L1 data per transaction. Bonds: 0.01 ETH challenge bond, 0.01 ETH capability
bond. The Sybil capital component is normalized to 0.01 ETH locked per point —
a stated policy choice, not a measurement.

## Run

```bash
npm run benchmark:run                 # all mechanisms, all scenarios, seed 42
npm run benchmark:run -- --seed 7
npm run benchmark:run -- --scenario sybil --mechanism base_taop_v03
npm run benchmark --workspace @taopp/benchmark run -- sensitivity
npm run benchmark:test
```

Outputs: `results/run-<timestamp>.json` (full metrics), `results/RESULTS.md`
(rendered tables), `results/SENSITIVITY.md`.

`results/baseline-seed42.json` is committed and a test fails if the harness
stops reproducing it. Regenerate intentionally with
`npm run benchmark:baseline` and copy the newest `run-*.json` over it.

## Limitations

- Simulation, not execution: costs mirror the bytecode and score rules mirror
  the contracts, but transactions are not executed. Foundry/Hardhat tests cover
  on-chain behavior.
- Locked capital is counted at face value and is recoverable unless slashed;
  treat it as capital-at-risk, not spend.
- Challenge/upheld probabilities are assumptions; watcher incentives are not
  modeled.
- Detectors (reciprocity, mutual degree, k-core) are simple baselines and do
  not model adaptive rings.
- The Sybil scenario models a ring that supplies its own counterparties for
  receipt-based mechanisms; it measures the cost of that ring, not identity
  creation cost, which is exogenous.
- Priority-fee spikes, MEV, and reputation laundering across identities are not
  modeled.
