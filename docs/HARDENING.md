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
- All GitHub Actions are **pinned to commit SHAs**, and GitHub now **enforces**
  full-length SHA pinning (`sha_pinning_required: true`).
- Nightly `npm audit` + `pip-audit` report (`.github/workflows/nightly.yml`).
- **CodeQL** code scanning (default setup) on JS/TS + Python.
- **SBOM** (CycloneDX) generated in CI and uploaded as an artifact.
- Lockfiles committed; `npm ci` used everywhere.

## Runtime / operations

- Backend: loopback by default, `X-TAOP-Key` write gate (constant-time), rate
  limits, `DEMO_READ_ONLY`, refuses a public bind without a key; structured logs
  with secret redaction; enriched `/api/healthz` + `/api/alerts`.
- **Security headers**: helmet with a Content-Security-Policy (external scripts,
  framing, and objects blocked; `unsafe-inline` only for Swagger UI's bootstrap
  and injected styles), plus `frame-ancestors 'none'`.
- **Server timeouts** (`headersTimeout` 20s, `requestTimeout` 30s) against
  slowloris/resource exhaustion.
- **API key is memory-only** in the demo UI (never in localStorage/sessionStorage);
  a public demo must run read-only, since a build-time `VITE_TAOP_API_KEY` is
  embedded in the JS bundle.
- SPA fallback (serves `index.html`) is rate-limited like the API.
- Indexer: confirmation depth + reorg rebuild.
- Key management + emergency playbooks in [`EMERGENCY.md`](EMERGENCY.md).

## Contracts

- Slither (blocking), Aderyn, and Mythril (symbolic) clean on our contracts.
- Foundry fuzz + invariants (ETH conservation, receipt/dispute consistency,
  score bounds, index integrity).
- Mutation spot-check (12/12 critical mutants caught).
- Zero-address guards; indexed address events; no protocol token.
- **v0.3 (code, pending redeploy):** `Pausable` circuit breaker on both contracts
  (exits stay open), settable attestation cooldown, and a diversity-adjusted
  credit score (distinct counterparties) so self-dealing can't inflate ranking.

## GitHub settings (applied)

- [x] **Actions → require full-length SHA pinning** (`sha_pinning_required: true`).
- [x] **Rules → `main-protection`**: requires status checks `test`, `security`,
  `coverage`, `foundry`, `mutation`, `e2e`, `docker`; blocks deletion + force-push;
  admins can bypass to push directly.
- [x] **Rules → `tag-protection`**: release tags cannot be deleted or force-pushed.
- [x] **CodeQL default setup** enabled (JS/TS + Python).
- [x] Secret scanning + push protection.
- [x] Dependabot alerts + security updates.
- [x] PR template with a security checklist + `CODEOWNERS` for sensitive paths.
