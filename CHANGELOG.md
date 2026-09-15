# Changelog

All notable changes to TAOP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v0.2 two-sided trust (Phase 3)

### Added
- **Two-sided attestation (F11).** `attestReceipt(completionId, receiptCID)` lets an
  independent requester countersign a completion; `revokeReceipt` withdraws the
  endorsement. `confirmedCount` + `getTwoSidedScore` expose the receipt-confirmed
  score, so an agent can no longer "grade its own homework" for ranking purposes.
- **Optimistic challenge resolution (F11).** A challenge now opens a
  `CHALLENGE_WINDOW` (3 days). The agent rebuts within it via `contestChallenge`;
  an uncontested challenge can be finalized by anyone after the window
  (`finalizeChallenge`) and is upheld optimistically. Contested challenges fall
  back to the owner (`resolveChallenge`, via Timelock).
- Two-sided flow wired through both SDKs, the MCP server, the backend API
  (`POST /completions/:id/{receipt,revoke-receipt,contest,finalize}`) and the demo UI.
- 20 new contract tests (32 → 52).

### Changed
- Discovery now ranks on the two-sided score where the contract supports it and
  falls back to the self-attest score on older deployments (`scoreType` in payloads).
- An upheld dispute invalidates the completion's receipt (and decrements the count).
- Demo UI: "Requester confirms completion" action; real repository links.

### Notes
- The contract change requires a redeploy. The live Base Sepolia pilot is still
  v0.1.2, so the SDKs/MCP/backend detect the old bytecode and fall back to
  `getSelfAttestScore`. Package versions stay `@taopp/sdk@0.1.2` /
  `@taopp/mcp-server@0.1.1` until the next redeploy + republish.

## [0.1.2] - 2026-09-15

**Live on Base Sepolia:**
RON `0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356`,
Registry `0x2E72Ada571df608AC1C811174A1921CAaDE46362`,
Timelock `0xA5d5eb6964568eD1157F985EE08ab42B56e1307B` (0-delay pilot, policy frozen).
Agent A `0xB924e022441596e6007fa5db1966B08066cCEBa4` (fresh non-leaked key).

### Security
- A private agent key was found committed in `deployments.json` (public repo) and
  purged from history; fresh non-leaked keys in use (see `SECURITY.md`).
- Backend write routes are gated: constant-time `X-TAOP-Key`, rate limits
  (240 req/min, 20 writes/5 min), `DEMO_READ_ONLY` kill-switch, loopback binding
  by default, and the server refuses a public bind without a key.
- Deploy script never writes or prints key material (writes `AGENT_A_PK` to
  `.env`, chmod 600; `deployments.json` holds addresses only).

### Fixed
- `withdrawBond` left a stale id in `capabilitiesByType`, breaking every
  discovery implementation — index entries are now removed on burn (swap-and-pop),
  and all discovery loops skip unreadable ids instead of throwing (F4).
- Capability/completion ids were derived from `totalSupply()`/`nextCompletionId()`
  — wrong after any burn; all SDKs now read ids from the emitted events (F5).
- Decay was integer halving per 30 days (destroyed small scores — live agent went
  3 → 0); now: 30-day grace, then linear decay to zero over 150 days, plus a
  `getScoreDetails` view exposing `lastActivity` + `decayBps` (F6).
- `npm run typecheck` compiled nothing (root `files: []`); it is now a real script
  across sdk/demo/backend/mcp and passes. The 4 real type errors were fixed;
  CI no longer has `|| true` steps and guards against tracked secrets (F7).
- Python SDK: `README.md` still missing (PyPI blocker) — **deferred to 0.1.3**;
  fixed `discover()` (indexed + resilient), id derivation, `_load_deployment`
  strictness, and removed the broken v2 `getAgentScore`; new `sync_abis.py`
  regenerates bundled ABIs from Hardhat artifacts.
- SDK CJS bundle was built from stale generated `src/*.js` files; build script
  now cleans before bundling (this had shipped the old buggy `index.cjs`).

### Changed
- `@taopp/sdk@0.1.2`, `@taopp/mcp-server@0.1.1` (MCP default RPC is now the
  public `https://sepolia.base.org`; server version string corrected to 0.1.1).
- Deploy script: `REUSE_AGENT_A` keeps the agent identity across redeploys,
  funds only the shortfall, pre-flights deployer balance, fixes mainnet chainId.
- Demo UI: shows v0.1.2 linear-decay semantics and sends `VITE_TAOP_API_KEY`.
- README/SDK security + operations sections, tunnel guidance (read-only only).

### Added
- `SECURITY.md` (policy + incident disclosure), `PHASE0_OWNER_ACTIONS.md`
  (owner runbook + auth matrix evidence), `NEXT_BEST_STEPS_2026-09.md` (research +
  plan), `DEPLOY_DEMO.md` + `Dockerfile` (hosted demo behind an API key),
  `scripts/purge-secrets-from-history.sh` (tested history-rewrite tooling).
- 32 contract tests (was 23): v0.1.2 regression suite for F4/F5/F6.

## [0.1.0] - 2026-07-10

### Added
- Score decay via `lastActivity` mapping in `ReputationOracleNetwork` (halves every 30 days of inactivity).
- Indexed capability discovery via `capabilitiesByType` mapping and `getCapabilitiesByType` in `CapabilityRegistry` (O(1) lookups).
- `TimelockController` for admin actions (resolve, etc.) with 0-delay default for pilot/demo usability. Backend helper `executeViaTimelock` returns scheduled/executed status.
- Polished demo frontend to surface decay, indexed discovery, and Timelock status (badges, outcome boxes, updated copy).
- Full end-to-end pilot testing: attest, discover (indexed), challenge, resolve via Timelock (including upheld=false), external Python Agent B.
- MCP server and TS SDK published to npm under `@taopp` scope.
- CI workflow, docs updates, mainnet prep notes (keep 0 delay for pilot).

### Changed
- Deploy script now explicitly notes 0 delay for pilot/mainnet prep.
- README and plan docs updated for published packages and Step 5/6 progress.
- Various cleanups: removed old project bloat, synced lockfiles for CI.

### Fixed
- Hardhat config syntax and dep issues for stable builds.
- RPC timeouts noted (recommend good provider for production tests).

## [0.0.1] - 2026-07 (pre-steps)

Initial MVP:
- On-chain self-attest + challenge with ETH bonds.
- Capability registry with bonds.
- Backend, demo, SDKs, Agent B example.
- Deployed on Base Sepolia.