# TAOP documentation

Index of the project's docs. Start with the root [`README.md`](../README.md).

## Orientation
- [`README.md`](../README.md) — what TAOP is, live addresses, quickstart.
- [`architecture.md`](architecture.md) — system, lifecycle, and state-machine diagrams.
- [`LITEPAPER.md`](../LITEPAPER.md) — short-form overview.
- [`WHITEPAPER.md`](../WHITEPAPER.md) — long-form design.
- [`CHANGELOG.md`](../CHANGELOG.md) — release history.

## Architecture & model
- [`TRD.md`](../TRD.md) — technical requirements/design (contracts, scores, trust assumptions).
- [`FEE_MODEL.md`](../FEE_MODEL.md) — (dormant) protocol fee design.

## Security
- [`../SECURITY.md`](../SECURITY.md) — disclosure policy, secrets policy, incident history.
- [`THREAT_MODEL.md`](THREAT_MODEL.md) — assets, actors, trust boundaries, threat table.
- [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md) — Slither + Aderyn results and manual review of privileged paths.
- [`anti-sybil-proposal.md`](anti-sybil-proposal.md) — v0.3 sybil-resistance options (proposal).
- [`EMERGENCY.md`](EMERGENCY.md) — key management + emergency playbooks (no pause).
- [`../PHASE0_OWNER_ACTIONS.md`](../PHASE0_OWNER_ACTIONS.md) — Phase 0 incident runbook (closed).

## Operations & deploy
- [`OPERATIONS.md`](OPERATIONS.md) — runbook: health, logs, indexer, alerts, incidents.
- [`redeploy-v0.2.md`](redeploy-v0.2.md) — redeploy runbook (locally rehearsed).
- [`hardened-timelock.md`](hardened-timelock.md) — multisig + non-zero delay rehearsal.
- [`../DEPLOY_DEMO.md`](../DEPLOY_DEMO.md) — hosting the (write-enabled) demo.
- [`../PRE_MAINNET_CHECKLIST.md`](../PRE_MAINNET_CHECKLIST.md) — pre-mainnet readiness.

## Roadmap & history
- [`../NEXT_BEST_STEPS_2026-09.md`](../NEXT_BEST_STEPS_2026-09.md) — **current** research + plan (supersedes `NEXT_STEPS.md`).
- [`../IMPROVEMENTS_PLAN.md`](../IMPROVEMENTS_PLAN.md), [`../IMPROVEMENTS_DEEP_DIVE.md`](../IMPROVEMENTS_DEEP_DIVE.md) — historical (M0–M2 done).
- [`../NEXT_STEPS.md`](../NEXT_STEPS.md) — historical (July 2026).
- [`../TEST_RESULTS.md`](../TEST_RESULTS.md) — recorded pilot verification runs.
- [`../archive/`](../archive/) — superseded designs/research.

## SDKs & packages
- [`../packages/sdk/README.md`](../packages/sdk/README.md) — `@taopp/sdk` (TypeScript).
- [`../packages/mcp-server/README.md`](../packages/mcp-server/README.md) — `@taopp/mcp-server`.
- [`../packages/python-sdk/README.md`](../packages/python-sdk/README.md) — `taop` (Python).
- Generated API reference: `npm run docs:api` → `docs/api/` (TypeDoc).

## Live demo
- Read-only, backend-free: https://lexagor.github.io/TAOP-protocol/ (source: `apps/static-demo/`).
