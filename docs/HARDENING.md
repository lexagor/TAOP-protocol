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
- **Full git-history scan** (`secrets-history` CI job) with pinned,
  checksum-verified gitleaks; `.gitleaks.toml` allowlists only documented
  placeholders and Hardhat's public dev keys.
- **CI token is least-privilege**: `permissions: contents: read`.

## Supply chain

- Dependabot (npm, pip, github-actions, docker) + Dependabot security updates,
  with a **7-day release cooldown** (30 for majors) so brand-new versions aren't
  adopted immediately.
- All GitHub Actions are **pinned to commit SHAs**, and GitHub now **enforces**
  full-length SHA pinning (`sha_pinning_required: true`).
- Nightly `npm audit` + `pip-audit` report (`.github/workflows/nightly.yml`);
  `dependency-review-action` fails a PR that adds a high-severity dependency.
- Analysis tool versions are pinned (Slither 0.11.5) and the Aderyn download is
  **checksum-verified** in CI.
- **CodeQL** code scanning (default setup) on JS/TS + Python.
- **OpenSSF Scorecard** (weekly + on push to main) with SARIF upload; the root
  `security-insights.yml` documents the project's security posture for reviewers.
- **SBOM** (CycloneDX) generated in CI and uploaded as an artifact.
- Lockfiles committed; `npm ci` used everywhere.
- **Production dependency tree is audit-clean**: `npm audit --omit=dev` = 0
  vulnerabilities. Residual `npm audit` advisories (24 low / 5 moderate, 0 high)
  are dev-only in the Hardhat 2 toolchain (fixing them needs the Hardhat 3
  migration). Patched transitive lines are forced via `overrides` in
  `package.json` (adm-zip, lodash, serialize-javascript, tmp, undici, uuid), and
  the Docker runtime stage runs `npm prune --omit=dev` so the shipped image
  contains no dev toolchain at all.
- **Publishability is CI-checked**: `npm pack --dry-run` must ship `dist`, and the
  Python wheel must contain the bundled ABIs and exclude tests (`check_wheel.py`).
- **Python deps are hash-pinned** (`packages/python-sdk/requirements-dev.txt`,
  `pip-compile --generate-hashes`); CI installs with `--require-hashes`.
  Regenerate with `cd packages/python-sdk && pip-compile --generate-hashes --extra dev --output-file requirements-dev.txt pyproject.toml`.

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
- SPA fallback (serves `index.html`) is rate-limited like the API; **`/api/admin/*`
  writes have a tighter limit (10 / 5 min) and `Cache-Control: no-store`**, and the
  security headers (CSP, nosniff, HSTS) are asserted by tests.
- Indexer: confirmation depth + reorg rebuild; `ChallengeCancelled` surfaces in
  the alert stream (no dispute recorded — there was no ruling).
- **Scheduled deployment healthcheck**: every 6 hours, retried read-only
  `verify:deployment` against the live Base Sepolia addresses.
- Key management + emergency playbooks in [`EMERGENCY.md`](EMERGENCY.md).

## Contracts

- Slither (blocking) clean; Aderyn 0.6.8: 0 high / 6 low (accepted, see
  `SELF-AUDIT.md`); Mythril: `CapabilityRegistry` clean and one
  compiler-generated Yul SWC-101 false positive on `ReputationOracleNetwork`,
  triaged non-exploitable (see `SELF-AUDIT.md`). Re-runnable via
  `scripts/mythril-scan.sh` and the weekly `Mythril (symbolic)` workflow
  (digest-pinned image, report artifact).
- **Coverage ratchet**: `npm run coverage:check` enforces floors (stmts/lines 95,
  funcs 90, branches 70) *and* the recorded `coverage-baseline.json` — coverage can
  only go up. Current: stmts 97.9, funcs 95.0, lines 97.6, branches 74.75.
- Foundry fuzz + invariants (ETH conservation — including cancelled challenges —
  receipt/dispute consistency, score bounds, index integrity). 13 tests.
- Mutation spot-check (21/21 critical mutants caught, including the v0.4
  cancel-timeout, refund and URI-cap mutations).
- Zero-address guards; indexed address events; no protocol token.
- **v0.3 (code, pending redeploy):** `Pausable` circuit breaker on both contracts
  (exits stay open), settable attestation cooldown, and a diversity-adjusted
  credit score (distinct counterparties) so self-dealing can't inflate ranking.
- **v0.4 (code, pending redeploy):** challenge liveness (`cancelChallenge` after
  `CHALLENGE_TIMEOUT` — challenger-only, never pausable, so no bond is locked
  forever), two-step ownership (`Ownable2Step`), and `MAX_URI_LEN = 200` caps on
  every on-chain URI field.
- **Gaming-resistance benchmark** with a committed seed-42 baseline; CI fails if
  the published numbers drift (`packages/benchmark`, `npm run benchmark:test`).

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
