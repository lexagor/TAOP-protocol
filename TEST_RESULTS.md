# TAOP Pilot E2E Test Results (2026-09-15, v0.1.2)

## Environment
- Sepolia deploy: 2026-09-15 (RON `0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356`,
  registry `0x2E72Ada571df608AC1C811174A1921CAaDE46362`,
  timelock `0xA5d5eb6964568eD1157F985EE08ab42B56e1307B`, 0-delay)
- Previous deployment (2026-07-11: RON 0x716E…, registry 0x6132…, timelock 0x7231…)
  is superseded.
- Backend: write routes gated by `X-TAOP-Key`; read-only mode verified.
- Tests: 32/32 contract tests passing; typecheck real and green (sdk/demo/backend/mcp);
  Python SDK 7/7 passing.

## Verified v0.1.2 pilot flow (2026-09-15, tx hashes below)

## Verified Flows
1. Attest + discover (score before → after, within the decay grace)
   - `POST /api/demo/run` → completionId **1**, score **0 → 1**; tx
     `0x0bcb6cef167488437650faa626c518a4777b85e316f492aa69f75d72c4219adc`
   - `GET /api/discover?minScore=1` → Agent A `0xB924e0…`, capabilityId 1,
     score 1, certified, bond 0.01 ETH (the flagship query works again)
   - `GET /api/agents/…/score` → new v0.1.2 fields `lastActivity`, `decayBps: 10000`
2. Challenge + resolve (owner action executed through the 0-delay Timelock)
   - `POST /api/completions/1/challenge` → tx
     `0xa82ec61f57e38459b6b9e5b172cd8f363b9511c27831d71eb69c87b2f7c22af7`
   - `POST /api/completions/1/resolve {upheld:true}` →
     `{executed:true, scheduled:false, delay:"0"}`, tx
     `0xf30ceb187ef56b0ead5c5154809fafee264b3729cc5f0fb2ca54e6a93c26df1c`
   - Score after upheld dispute: completions 1, disputes 1, score 0 (net logic verified live)
3. Write gating (spend-free probes against a nonexistent completion → 400/401/503)
   - no key → `401` (key set) / allowed-on-loopback (no key); wrong key → `401`;
     `DEMO_READ_ONLY=true` → `503` on POST with reads still `200`;
     `HOST=0.0.0.0` without key → process refuses to start (exit 1)
4. Python SDK: `discover()` returns the agent; `get_capabilities_by_type` matches the
   full scan; `test_self_attest_score` is decay-aware (all 7 passing)
5. MCP server verifies round-trips from npm with env-only config (initialize +
   tools/list + get_deployment_info)

### Notes (v0.1.2)
- Boot race found and fixed: `ensureCapability` could certify against an L2 replica
  that hadn't indexed the just-mined registration (`NoSuchCapability` at
  estimateGas). It now waits for read-back visibility before certifying.
- Previous flows (2026-07-15) are archived below and refer to the superseded deployment.

## Legacy flows (2026-07-15, superseded deployment)

2. Discover
   - `curl /api/discover?minScore=0` → returns agents with scores (using on-chain getCapabilitiesByType + getSelfAttestScore)

3. Demo run (attest)
   - `POST /api/demo/run` → returns completionId (fresh e.g. 1), before/after scores (decay applied), attestTx, summary from LoRA+IPFS

4. Challenge + Resolve
   - `POST /api/completions/{id}/challenge` (with evidence)
   - `POST /api/completions/{id}/resolve` (upheld: true) → returns tx, scheduled/executed status
   - On-chain: getCompletion shows challenged=true, disputed=true (or scheduled if delay)

5. UI Flow
   - Run demo → new completion
   - Challenge button appears (hidden after resolve via lastResolve)
   - Score before → after (with decay note)
   - Timelock info in Hero + outcome box after resolve

## Notes
- Pre-checks in challenge handler prevent "missing revert data" (existence + balance guards).
- DB marks updated on success.
- After redeploy: DB cleared, fresh cap/completions.
- Balance note: agentA/validator need ~0.01+ ETH for bonds (faucet as needed).
- Slither (latest run): Clean on project contracts. Only low/info findings from OZ libs (e.g. mulDiv in Math.sol, unindexed events, arbitrary-send-eth in withdraw). No high/medium issues in our code.
- MCP tools verified basic usage with SDK.
- Indexed discovery confirmed via getCapabilitiesByType (O(1)).
- Decay: getSelfAttestScore applies halving for inactivity >30d.
- npm audit: 35 vulns (mostly dev deps like undici/uuid from hardhat); no direct prod high-risk. `npm audit fix` recommended for non-breaking.

All core pilot flows pass on current Sepolia + local. Ready for public trial.

## Latest Verification (2026-07-15, post-plan execution)
- Demo run: completionId 2, score 2 -> 3, successful attest on current Sepolia.
- Full flows verified via curls and UI simulation.
