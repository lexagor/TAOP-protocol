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
  vulnerabilities. Residual `npm audit` advisories (Oct 2026: 17 low / 7
  moderate / 8 high / 0 critical) are dev-only, in the Hardhat 2 coverage chain
  and Spectral's glob/micromatch chain — both have no non-breaking fix (coverage
  needs HH3; Spectral parses only our own spec). Patched transitive lines are
  forced via `overrides` in `package.json` (adm-zip, axios, handlebars,
  http-cache-semantics, lodash, pbkdf2, proxy-addr, serialize-javascript,
  source-map-js, tmp, undici, uuid), and the Docker runtime stage runs
  `npm prune --omit=dev` so the shipped image contains no dev toolchain.
- **Never blind-run `npm audit fix`**: in Oct 2026 it satisfied new advisories by
  *downgrading* `sc-istanbul`'s nested `js-yaml`/`argparse` (3.15.2→3.2.6,
  1.0.10→0.1.16) into newly published critical ranges. Apply targeted overrides
  and re-audit with `--omit=dev` as the production gate.
- **Publishability is CI-checked**: `npm pack --dry-run` must ship `dist`, and the
  Python wheel must contain the bundled ABIs and exclude tests (`check_wheel.py`).
- **Python deps are hash-pinned** (`packages/python-sdk/requirements-dev.txt`,
  `pip-compile --generate-hashes`); CI installs with `--require-hashes`.
  Regenerate with `cd packages/python-sdk && pip-compile --generate-hashes --extra dev --output-file requirements-dev.txt pyproject.toml`.

## Runtime / operations

- Backend: loopback by default, `X-TAOP-Key` write gate (constant-time), rate
  limits, `DEMO_READ_ONLY`, refuses a public bind without a key; structured logs
  with secret redaction; enriched `/api/healthz` + `/api/alerts`.
- **Demo stake bootstrap**: `ensureAgentStake` deposits `AGENT_STAKE_ETH`
  (default 0.01) for Agent A in write mode so the demo has a non-zero ranking
  score; `AGENT_STAKE_ETH=0` disables.
- **Read-only instances never write** and need **no keys**: `DEMO_READ_ONLY=true`
  skips the startup Agent A capability bootstrap, reads through the provider,
  and takes addresses from the deployment descriptor. Write mode fails fast
  without `ORACLE_PK`/`AGENT_A_PK` — there is no well-known-mnemonic fallback.
- **Signed outbound webhooks** (opt-in via `TAOP_WEBHOOK_URL`): HMAC-SHA256
  `x-taop-signature` over the raw body, ordered at-least-once delivery with an
  `x-taop-delivery` de-dupe id, per-delivery timeout, and exponential backoff.
  `/api/healthz` exposes counters only (never the subscriber URL).
- **Webhook target validation (SSRF hygiene)**: http(s) only, no embedded
  credentials, public hosts must use https, and loopback/private/link-local
  targets are refused unless `TAOP_WEBHOOK_ALLOW_PRIVATE=true`. Invalid configs
  are reported (not thrown) through `/api/healthz` `webhooks.configError`.
- **Prometheus metrics** at `/api/metrics`: indexer lag/reorgs/retention,
  webhook backlog/failures, alert/capability gauges, and bounded-label HTTP
  counters (`taop_http_requests_total{method,status}`).
- **JSON-only error surface**: unknown `/api` paths return a JSON 404 and
  body-parser failures return JSON 400/413 — never Express's HTML error page or
  a stack trace. Shutdown (`SIGINT`/`SIGTERM`) stops the indexer and the webhook
  dispatcher before closing the server.
- **Async route rejections are forwarded** to the JSON error handler
  (`express-async-errors`), so an RPC/DB failure can't become an unhandled
  rejection and take the process down.
- **Bounded observability labels**: unknown HTTP methods are bucketed as `OTHER`,
  and numeric query params (`limit`/`offset`/`minScore`) fall back to defaults
  instead of producing NaN or SQL errors. Invalid `INDEXER_*` env values are
  clamped (a NaN interval would otherwise become a 1 ms hot loop).
- **Reorg-safe alerts**: on a reorg the indexer deletes alerts from the orphaned
  fork (`block >= fork block`), and `recordAlert` is idempotent per
  `(tx, kind, block)` so a retried event application cannot duplicate alerts.
- **Webhook delivery**: redirects are never followed (`redirect: "manual"`),
  preventing redirect-based SSRF; Pinata calls have a 15s timeout and errors
  don't echo response bodies. Malformed `:id`/`:address` path params are
  rejected with 400 before reaching ethers.
- **Container runs unprivileged**: the runtime image uses the `node` user
  (uid 1000) with only `/app/data` (SQLite) writable; CI asserts the uid and
  boots the image read-only. A second smoke test runs it on a **read-only
  rootfs** (tmpfs data) with `--cap-drop=ALL` and `no-new-privileges`.
- **OpenAPI spec gate**: `npm run openapi:lint` (Spectral, `--fail-severity=warn`)
  runs in CI against the generated document, so structural regressions fail the
  build.
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
- **Bounded SQLite growth**: the alerts table keeps its newest
  `DB_RETENTION_ALERTS` (default 5000) rows — never pruning alerts the webhook
  dispatcher has not delivered — and idempotency markers can be trimmed with
  `DB_RETENTION_LOG_MARKERS_BLOCKS` (default off).
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
- Mutation spot-check (29/29 critical mutants caught, including v0.4 cancel/
  refund/URI caps and v0.5 eligibility/stake-cap/slash/min-bond mutations).
- Zero-address guards; indexed address events; no protocol token.
- **Pull-payment refunds**: challenge refunds are credited and claimed explicitly
  (`withdrawRefund`), so a reverting challenger receiver can't block resolution.
  Foundry ETH conservation: `balance == pending bonds + slashed pool + credited
  refunds + agent stake`.
- **v0.5 stake economics**: ranking scores are stake-capped; stake withdrawal is
  gated by the 7-day challenge eligibility window and pending challenges;
  upheld disputes slash 0.05 ETH to the challenger; Registry `MIN_BOND = 0.05 ETH`.
  Coverage 100% statements/functions/lines (branches 76.79).
- **O(1) capability index removal**: a position map replaces the unbounded linear
  scan in `withdrawBond`, so gas does not grow with the number of capabilities of
  a type.
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
