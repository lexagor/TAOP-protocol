# TAOP Pilot E2E Test Results (2026-07-15)

## Environment
- Sepolia deploy: 2026-07-11 (RON 0x716E..., registry 0x6132..., timelock 0x7231...)
- Backend: running on :4000 with new deployments
- UI: http://127.0.0.1:4000 (or 5173 dev)
- Tests: 23/23 passing, typecheck clean

## Verified Flows
1. Health & contracts
   - `curl /api/healthz` → {"ok":true}
   - `curl /api/contracts` → correct addresses, timelockDelay: "0", capabilityId present

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
