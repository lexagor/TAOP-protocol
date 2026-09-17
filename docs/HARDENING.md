# Hardening controls

A single index of the security controls in this repo and the few that must be
toggled in GitHub settings. See also [`SELF-AUDIT.md`](SELF-AUDIT.md),
[`THREAT_MODEL.md`](THREAT_MODEL.md), [`EMERGENCY.md`](EMERGENCY.md).

## Secrets

- **`.gitignore`** excludes `.env*` (except `.env.example`), `deployments.json`,
  `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `secrets.json`, `*.db`.
- **Key material never enters an artifact.** The deploy scripts
  (`scripts/lib/security.ts`) refuse to write `.env`/`deployments.json` when the
  path is inside the repo but not gitignored, and refuse to write any file that
  contains a key-shaped `0x…64hex` value. The key is written only to `.env`
  (`chmod 600`) and is never printed.
- **No accidental clobbering.** `deploy:local` refuses to overwrite an existing
  non-local `deployments.json` (chainId ≠ 31337) unless `DEPLOYMENTS_PATH` or
  `ALLOW_OVERWRITE_DEPLOYMENTS=true` is set — so a local run can't wipe the live
  addresses.
- **Content-level scanner.** `npm run scan:secrets` scans every tracked file for
  private keys, JWTs, and provider tokens (Hardhat's public test keys are
  allowlisted). It runs in CI and blocks on any hit — so a key pasted into *any*
  file fails the build, not just the known filenames.
- **GitHub secret scanning + push protection** are enabled (blocks pushing
  secrets). A past incident is documented in [`../SECURITY.md`](../SECURITY.md).
- **CI token is least-privilege**: `permissions: contents: read`.

## Supply chain

- Dependabot (npm, pip, github-actions, docker) + Dependabot security updates.
- All GitHub Actions are **pinned to commit SHAs**.
- Nightly `npm audit` + `pip-audit` report (`.github/workflows/nightly.yml`).
- Lockfiles committed; `npm ci` used everywhere.

## Contracts

- Slither (blocking), Aderyn, and Mythril (symbolic) clean on our contracts.
- Foundry fuzz + invariants (ETH conservation, receipt/dispute consistency,
  score bounds, index integrity).
- Mutation spot-check (12/12 critical mutants caught).
- Zero-address guards; indexed address events; no protocol token.

## Runtime / operations

- Backend: loopback by default, `X-TAOP-Key` write gate (constant-time), rate
  limits, `DEMO_READ_ONLY`, refuses a public bind without a key; structured logs
  with secret redaction; enriched `/api/healthz` + `/api/alerts`.
- Indexer: confirmation depth + reorg rebuild.
- Key management + emergency playbooks in [`EMERGENCY.md`](EMERGENCY.md).

## Owner-only GitHub settings (cannot be set from CI)

These require repo **Settings** (the API token used in this repo lacks the
fine-grained "Actions policies"/rulesets write permission):

- [ ] **Settings → Actions → General → "Require actions to be pinned to a full-length commit SHA"** (we already pin; enable enforcement).
- [ ] **Settings → Rules → `main-protection`**: add **"Require status checks to pass"** with contexts `test`, `security`, `coverage`, `foundry`, `mutation`, `e2e`, `docker` (a ruleset already blocks deletion + force-push; admin bypass can be added so maintainers can still push).
- [x] Secret scanning + push protection (done).
- [x] Dependabot alerts + security updates (done).
