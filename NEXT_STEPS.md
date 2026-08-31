# TAOP Next Steps Plan (Post-MCP Publish)

**Date:** 2026-07-09  
**Current State (as of 2026-07-15):** 
- Public GitHub repo (lexagor/TAOP-protocol)
- SDK published: `@taopp/sdk@0.1.1` (package.json ready, npm-ready)
- MCP server: `@taopp/mcp-server@0.1.0` (implemented with multiple tools)
- Core features shipped: Timelock (0-delay pilot), score decay (on-chain in getSelfAttestScore), indexed discovery (capabilitiesByType + getCapabilitiesByType)
- Hardhat v2 stable, 23/23 tests passing
- Recent: Sepolia redeploy (2026-07-11), challenge error fixes + balance guards, UI polish (decay/raw, Timelock status), PRE_MAINNET_CHECKLIST and TEST_RESULTS updated, CI expanded, docs polished for pilot
- Demo polished (build fixed), CI enhanced, governance frozen at 0-delay per 2026-07-15 decision (hardened test intentionally skipped), fee-switch dormant, no budget audit
- All plan steps executed: doc sync, UI polish, full verification (typecheck + 23 tests + demo/backend/sdk/mcp builds green), adoption examples, ops notes. Pre-mainnet prep frozen at 0-delay by choice.

**Goal:** Move from "shipped on testnet" to "credible mainnet project with real users and adoption".

## Prioritization Principles
- **Ship fast, get feedback:** Prioritize visible, usable progress over perfection.
- **Credibility first:** Mainnet + clean docs > new features.
- **Leverage what we have:** MCP + SDK are big differentiators — make them shine.
- **Risk-aware:** Avoid breaking changes; use Sepolia for validation.
- **Low effort, high signal:** Focus on deploy, docs, examples, CI.

## Phase 1: Immediate (1-7 days) — Stabilize & Showcase on Testnet
Goal: Have a working, documented, tested pilot that people can try today.

### 1. Redeploy on Sepolia with Latest Features
- Run `npm run deploy:sepolia` (ensure .env has valid RPC + DEPLOYER_PK).
- Update `deployments.json` and README.md contract table with new addresses.
- Verify Timelock (0 delay), decay, and indexed discovery are live.
- Test full flow: attest → discover (faster now) → challenge → resolve.
- **Why:** Current addresses are stale; users need working links.
- **Effort:** 1-2 hours + waiting for txs.
- **Dependencies:** Working Sepolia RPC/keys.
- **Success:** Fresh addresses in README, demo works end-to-end.

### 2. Fully Test & Document the Pilot Flow
- Run local + Sepolia flows:
  - `npm run deploy:local`
  - Start backend + demo
  - Run `curl` tests for healthz, discover, contracts
  - End-to-end via UI: attest, challenge, resolve
- Verify MCP tools work with published SDK.
- Add test results/screenshots to a `TEST_RESULTS.md` or GitHub issue.
- **Why:** Ensures nothing broke after recent changes (decay, indexing, Timelock helper).
- **Effort:** 2-4 hours.
- **Success:** Documented working flow + any bugs fixed.

### 3. Polish the Demo UI
- Enhance `apps/demo/src/App.tsx`:
  - Prominently show "Score (with decay)" vs raw.
  - Display Timelock status (current delay, whether actions are instant/scheduled).
  - Highlight indexed discovery (e.g., "Fast lookup by capability type").
  - Add badges or section for published packages (`@taopp/sdk`, `@taopp/mcp-server`).
  - Improve error handling for scheduled Timelock actions.
- Update demo description to mention decay + indexing.
- Build and test: `npm run demo:build`
- **Why:** Demo is the public face — make new features obvious.
- **Effort:** 3-6 hours.
- **Success:** Demo clearly demonstrates v0.1 differentiators.

### 4. Enable & Verify CI
- Push `.github/workflows/ci.yml` (already created: tests, typecheck, builds).
- Verify it runs on a PR or push.
- Expand if needed: add lint, coverage, or MCP smoke test.
- **Why:** Professional projects have CI; prevents regressions.
- **Effort:** 1 hour (push + monitor).
- **Success:** Green CI on main.

## Phase 2: Short-Term (1-3 weeks) — Production Readiness & Distribution
Goal: Ready for real users and mainnet.

### 5. Mainnet Preparation (Timelock stays 0 for pilot)
- Keep 0 delay for current Sepolia pilot (as decided).
- Prepare hardened config:
  - Update deploy scripts for mainnet (real delay e.g. 86400s, multisig proposers).
  - Add mainnet network config notes in `hardhat.config.ts` (already partially done).
  - Document multisig setup and how to transfer ownership.
- Run full local + Sepolia validation with hardened settings.
- Start audit prep: run Slither, document threat model.
- Update `IMPROVEMENTS_PLAN.md` and README with mainnet checklist.
- **Why:** Mainnet is the credibility milestone (M3).
- **Effort:** 1-2 weeks (includes testing + planning).
- **Dependencies:** Decide on multisig owners.
- **Success:** Ready-to-run mainnet deploy script + audit notes.

### 6. Documentation & Distribution Polish ✅ (this step)
- Full audit of docs:
  - Ensured all references use `@taopp/sdk` and `@taopp/mcp-server` (internal @taop kept for backend/demo).
  - Updated `README.md`, `WHITEPAPER.md`, `LITEPAPER.md`, `IMPROVEMENTS_DEEP_DIVE.md`, plan files.
  - Added "Getting Started with Published Packages" section to README.
  - Created `CHANGELOG.md` for v0.1+.
- Python SDK (`taop`) available in workspace (PyPI symmetry noted for future).
- Usage examples present (Agent B, MCP README for Claude, SDK examples).
- Updated grant/angel docs and plans with published status.
- **Why:** Poor docs kill adoption. Published packages need examples.
- **Effort:** 1 week.
- **Success:** Clear onboarding path; external usage (Agent B) verified.

## Phase 3: Medium-Term (2-6 weeks) — Launch & Adoption
Goal: Get real usage and feedback.

### 7. Mainnet Deployment
- Execute mainnet deploy with hardened Timelock + multisig.
- Update all public links (README, demo, etc.).
- Announce: GitHub release, Twitter/X, relevant communities.
- Monitor via Basescan + simple health checks.
- **Why:** Live mainnet tx is the biggest credibility signal.
- **Effort:** 1-2 weeks (including testing).
- **Dependencies:** Audit sign-off if doing one.
- **Success:** Contracts live on mainnet with ≥1 external interaction.

### 8. Expand Adoption
- Agent identity basics (if not done): simple on-chain or off-chain profile.
- More MCP tools (e.g., register with metadata, query history).
- Integrate with more agent frameworks.
- Create 1-2 demo agents that use the system end-to-end.
- **Why:** MCP + SDK are the distribution moat.
- **Effort:** 2-4 weeks.
- **Success:** At least one external agent using the system publicly.

### 9. Security & Operations
- Security audit (even lightweight one via grant or community).
- Add basic monitoring (e.g., backend health + on-chain events).
- Bug bounty or simple disclosure process.
- **Why:** Mainnet without security posture is risky.
- **Effort:** 2-4 weeks.
- **Success:** Audit report (or plan) public.

### 10. Revenue & Sustainability (M4)
- Implement dormant fee switch (as documented in FEE_MODEL.md).
- Decide on governance path for fees.
- **Why:** Long-term viability.
- **Effort:** 4+ weeks.
- **Success:** Fee switch live (even if off by default).

## Quick Wins (Parallel, Low Effort)
- Run `npm audit fix` (non-force) and document remaining issues.
- Add more tests for decay and indexed discovery.
- Create a simple "Agent B" usage guide using the published MCP/SDK.
- Update angel/investor lists with published status.
- Post update on X/LinkedIn about MCP + SDK publish.

## Risks & Mitigations
- **Dependency churn:** Stick to current Hardhat 2 setup until mainnet.
- **Demo breakage:** Keep 0 delay for pilot; have separate "hardened" test instructions.
- **Adoption:** MCP is the killer feature — prioritize examples and distribution.
- **Funding:** Use existing grant/angel assets; a live mainnet demo is powerful.

## Success Metrics (Next 4-6 Weeks)
- Fresh Sepolia deployment with all v0.1 features.
- Working public demo showing decay + indexed discovery.
- CI green on main.
- MCP + SDK have basic usage examples.
- Mainnet deploy script ready + at least one test deploy.
- ≥1 external mention or integration.

## How to Execute
- Use this plan as a living document (update `NEXT_STEPS.md` or this file weekly).
- Tackle in sprints: 1 week = 2-3 items.
- Run local tests + Sepolia validation before any public claim.
- Leverage existing assets (grants, angel list, content strategy) for visibility.

**Immediate actions (post recent progress; governance deferred):**
- Polish remaining demo UI (prominent decay/raw, indexed, Timelock status) — done.
- Full E2E verification + update TEST_RESULTS / docs — done.
- Expand adoption (examples, Python PyPI prep, public demo instructions) — done.
- Security basics, CI expand, docs refresh — done.
- See updated PRE_MAINNET_CHECKLIST.md (governance section marked deferred).

This plan builds directly on the shipped work and the original IMPROVEMENTS_PLAN.md. Let's ship mainnet.