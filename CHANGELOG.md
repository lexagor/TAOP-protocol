# Changelog

All notable changes to TAOP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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