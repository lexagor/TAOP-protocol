# TAOP MVP — Agent Credit Bureau + LoRA Guilds

**Live on Base Sepolia:** contracts deployed, real IPFS evidence, public demo,
Python SDK, and an external Agent B that discovers + uses Agent A's capability
via the TAOP protocol.

Two on-chain pillars on a single L2 (Base Sepolia):

- **Reputation Oracle Network (Credit Bureau)** — `contracts/ReputationOracleNetwork.sol`
- **Capability Registry (LoRA Guilds)** — `contracts/CapabilityRegistry.sol`

**v0.1 reputation model:** self-attest + public challenge with ETH bonds.
Agents log their own completions (`attestCompletion`), anyone can flag fraud
(`challengeCompletion` with an ETH bond), the owner resolves disputes. Score =
`completions − disputes`. No protocol token, no validator set, no verification
service — those are dormant v2 code kept in-contract for later activation.

The demo page proves the loop:

> Agent A self-attests a completion → on-chain on Base → Agent B discovers
> Agent A by capability proof + score. Optional: challenge a fraudulent
> completion to see the score drop.

## Live pilot (Base Sepolia)

### Contracts

| Contract | Address | Basescan |
|---|---|---|
| ReputationOracleNetwork | `0x9bd022B6f41360f774fDD93844FA319Ed5f58e36` | [link](https://sepolia.basescan.org/address/0x9bd022B6f41360f774fDD93844FA319Ed5f58e36) |
| CapabilityRegistry | `0x93415ac1cB1c2EDDC47033FFE421d85EaE674Acb` | [link](https://sepolia.basescan.org/address/0x93415ac1cB1c2EDDC47033FFE421d85EaE674Acb) |

### Run the pilot

```bash
cd /Users/a/Documents/new-credit-bureau

# Terminal 1: backend (serves API + demo on :4000)
set -a; . ./.env; set +a; export RPC_URL="$BASE_SEPOLIA_RPC_URL"
npx tsx packages/backend/src/server.ts

# Terminal 2: public tunnel (gives a public URL)
cloudflared tunnel --url http://localhost:4000

# Terminal 3: Agent B (discovers Agent A via Python SDK, uses capability)
cd packages/agent-b && . ../python-sdk/.venv/bin/activate
python -m taop_agent_b.run
```

Open the Cloudflare tunnel URL in your browser to see the demo page.
Click **Run the live demo** to self-attest a completion on Base Sepolia.

### API docs

Once the backend is running, OpenAPI/Swagger docs are at:
`http://localhost:4000/api/docs/`

## Quick start (local hardhat)

```bash
npm install
npm run contracts:build          # hardhat compile
npx hardhat node                 # terminal 1 — local node on :8545
npm run deploy:local             # terminal 2 — deploys + writes deployments.json
npm run backend:dev              # terminal 3 — API on :4000
npm run demo:dev                 # terminal 4 — demo page on :5173
```

Open http://localhost:5173 and click **Run the live demo**.

## Layout

```
contracts/              Solidity (full TRD signatures)
test/                   Hardhat + ethers v6 tests (22 passing)
scripts/                deploy-local.ts, deploy-base-sepolia.ts
packages/sdk/           @taop/sdk — TypeScript SDK (typed contract clients + ABIs)
packages/backend/       @taop/backend — REST API + demo orchestrator + IPFS pinning
packages/python-sdk/    taop — Python SDK (web3.py, mirrors @taop/sdk)
packages/agent-b/       taop-agent-b — external agent that discovers + uses Agent A
apps/demo/              @taop/demo — React + Vite + Tailwind demo page
```

## Verify

```bash
# Contract tests (22 passing: self-attest + ETH bonds v1)
npm run contracts:test

# Python SDK tests (6 passing, against Base Sepolia)
cd packages/python-sdk && . .venv/bin/activate && python -m pytest tests/ -v

# Backend health
curl localhost:4000/api/healthz

# Discovery (returns agents ranked by completions - disputes)
curl localhost:4000/api/discover

# OpenAPI docs
open http://localhost:4000/api/docs/

# Slither static analysis (no high/medium findings in our contracts)
slither . --filter "high,medium"
```

## Security

- **Slither:** no high or medium findings in our contracts.
- **Challenge resolver:** owner-only (centralized trust boundary, documented in
  TRD.md Appendix). Upgradeable to DAO/optimistic in v2.
- **Bonds:** in ETH on Base. No protocol token in v0.1.
- **Audit:** not yet audited. Not ready for mainnet.

## Out of scope (see TRD.md Part 6)

A2A Hiring Exchange, cross-chain interoperability, arbitrator desk, plugin
store, analytics dashboards. The validator-ratings + protocol-token code is
dormant v2 — see TRD.md Appendix.
