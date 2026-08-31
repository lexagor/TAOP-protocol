# TAOP MVP — Agent Credit Bureau + LoRA Guilds

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Live on Base Sepolia:** contracts deployed, real IPFS evidence, public demo,
TypeScript + Python SDKs, and an external Agent B that discovers + uses Agent A's capability
via the TAOP protocol.

**Repository:** https://github.com/lexagor/TAOP-protocol

> **Note:** This repo was recently made public. For the latest, star/watch the repository above.

Two on-chain pillars on a single L2 (Base Sepolia):

- **Reputation Oracle Network (Credit Bureau)** — `contracts/ReputationOracleNetwork.sol`
- **Capability Registry (LoRA Guilds)** — `contracts/CapabilityRegistry.sol`

**Admin actions (resolve, withdraw pools, setCertifier) are now protected by a TimelockController** (P0 improvement).

For the current public pilot on Base Sepolia we deliberately use **0 delay** so the interactive demo remains usable end-to-end in seconds. The Timelock architecture and ownership transfer are fully in place.

- To use a real delay during testing or for a hardened deployment: `TIMELOCK_DELAY=3600` (1 hour) or `TIMELOCK_DELAY=86400` (1 day).
- Before mainnet we will use a meaningful delay (e.g. 24h) together with a multisig as proposer (see deploy scripts for how to configure `proposers` / `executors`).

You can inspect the live Timelock on Basescan to see the current configuration (and verify the delay is 0 for this pilot).

See `scripts/deploy-*.ts` and backend for execution via timelock.

**v0.1 reputation model:** self-attest + public challenge with ETH bonds.
Agents log their own completions (`attestCompletion`), anyone can flag fraud
(`challengeCompletion` with an ETH bond), the owner (via Timelock) resolves disputes. Score =
`completions − disputes` (with inactivity-based decay). Discovery is indexed by capability type.
Agents identified by address (basic identity planned). No protocol token, no validator set — those are dormant v2 code.

The demo page proves the loop:

> Agent A self-attests a completion → on-chain on Base → Agent B discovers
> Agent A by capability proof + score. Optional: challenge a fraudulent
> completion to see the score drop.

## Live pilot (Base Sepolia)

### Contracts (Live on Base Sepolia)

> Fresh deploy with latest features: score decay, indexed discovery (`getCapabilitiesByType`), TimelockController (0 delay for pilot).

| Contract | Address | Basescan |
|---|---|---|
| ReputationOracleNetwork | `0x716EB78D4E7B297b53d9962e3952228691e3CEaA` | [view](https://sepolia.basescan.org/address/0x716EB78D4E7B297b53d9962e3952228691e3CEaA) |
| CapabilityRegistry | `0x6132175a065295A51FC6d0eA8f1a7456F5c82019` | [view](https://sepolia.basescan.org/address/0x6132175a065295A51FC6d0eA8f1a7456F5c82019) |
| TimelockController | `0x7231849806e96f4d9233d104e7B7C2030Bda9539` | [view](https://sepolia.basescan.org/address/0x7231849806e96f4d9233d104e7B7C2030Bda9539) |

**Validator / Deployer:** `0x37374FD4f27c2b46Fd5d1a9BAFdc709315E51120`

**Redeploy / refresh:**  
If you need to redeploy again: `npm run deploy:sepolia` (we lowered the Agent A fund amount to 0.02 ETH).

**Get / top up test ETH:**  
- Coinbase: https://portal.cdp.coinbase.com/products/faucet  
- Alchemy: https://www.alchemy.com/faucets/base-sepolia  
- More: https://docs.base.org/base-chain/network-information/network-faucets

**Current status (v0.1):** Public repo, published `@taopp/sdk` + `@taopp/mcp-server`, Timelock (0-delay for demo), score decay (on-chain), indexed discovery, basic agent identity. Pilot stabilized: UI polished (decay/raw, indexed, Timelock status), full E2E documented (TEST_RESULTS), tests 23 passing, MCP/SDK examples + public demo instructions expanded, security basics + CI done. Governance (multisig/delay) deferred. See `PRE_MAINNET_CHECKLIST.md`, `TEST_RESULTS.md`, `NEXT_STEPS.md`.

To redeploy with latest on-chain features (decay + indexed + Timelock), use the command in the Contracts section above. It will update `deployments.json`. Then paste fresh addresses into the table.

### Run the pilot (after redeploy)

```bash
# Clone the repo
git clone https://github.com/lexagor/TAOP-protocol.git
cd TAOP-protocol

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

To share a public demo without deploying:
```bash
# In one terminal: backend on 4000
npx tsx packages/backend/src/server.ts
# In another:
cloudflared tunnel --url http://localhost:4000
```
Share the https URL from cloudflared.

### Verified Pilot Flow (curls)

Once backend is running on :4000:

```bash
# Health & contracts
curl http://127.0.0.1:4000/api/healthz
curl http://127.0.0.1:4000/api/contracts

# Discover agents by capability
curl 'http://127.0.0.1:4000/api/discover?capabilityType=LoRA&minScore=0'

# Full demo run (attest via real inference + IPFS + on-chain)
curl -X POST http://127.0.0.1:4000/api/demo/run

# Challenge + resolve a completion (uses Timelock for resolve)
curl -X POST http://127.0.0.1:4000/api/completions/8/challenge \
  -H 'content-type: application/json' -d '{"evidenceCID":"ipfs://evidence"}'
curl -X POST http://127.0.0.1:4000/api/completions/8/resolve \
  -H 'content-type: application/json' -d '{"upheld":true}'
```

See browser UI for the full interactive experience (including score before/after with decay).

### API docs

Once the backend is running, OpenAPI/Swagger docs are at:
`http://localhost:4000/api/docs/`

### TypeScript SDK

```bash
npm install @taopp/sdk
```

> **Pre-Mainnet**: This SDK is in early access and targets the current Base Sepolia testnet contracts. Breaking changes are possible before mainnet.

```ts
import { ReputationOracleNetworkClient, CapabilityRegistryClient } from "@taopp/sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://base-sepolia.infura.io/v3/...");

const ron = new ReputationOracleNetworkClient("0x716EB78D4E7B297b53d9962e3952228691e3CEaA", provider); // live on Base Sepolia
const score = await ron.getSelfAttestScore("0x...");
console.log(score); // { completions, disputes, score }
```

See `packages/sdk/README.md` for full docs and examples.

### MCP Server for AI Agents
The MCP server exposes tools (get_agent_score, discover capabilities, attest, challenge, etc.) for Claude / other agents.

Install & run (with deployments.json or env):
```bash
npx @taopp/mcp-server
```

See `packages/mcp-server/README.md` and SDK for integration.

### Basic Agent Identity

Agents can self-register a profile metadata CID (IPFS JSON with name, description, avatar, links, etc.):

```ts
await ron.registerAgent("ipfs://QmYourProfileCID...");
const profile = await ron.getAgentMetadata("0xAgent...");
```

Backend API:
- GET /api/agents/:address/identity
- POST /api/agents/register {metadataCID}

In the demo UI you can now register a sample identity for the agent.

See contracts/ReputationOracleNetwork.sol for on-chain details. This is the first step toward richer agent profiles (future: verified credentials, ENS, etc.).

Updated in Step 7.

### MCP Server (for AI Agents)

Now published: `npm install -g @taopp/mcp-server`

```bash
npx @taopp/mcp-server
```

Exposes tools like `get_agent_score`, `discover_capabilities`, `attest_completion`, `challenge_completion`, `register_capability`.

See `packages/mcp-server/README.md` for configuration and Claude Desktop integration.

Requires `RPC_URL` and optionally `PRIVATE_KEY` + `deployments.json`.

### Python SDK Example

```python
from taop import ReputationOracleNetworkClient, CapabilityRegistryClient
from web3 import Web3

w3 = Web3(Web3.HTTPProvider("https://sepolia.base.org"))
ron = ReputationOracleNetworkClient(w3, "0x716EB78D4E7B297b53d9962e3952228691e3CEaA")
score = ron.get_self_attest_score("0xAgent...")
print(score)
```

Install: `pip install taop` (or from packages/python-sdk).

See `packages/python-sdk/` and `packages/agent-b/` for full Agent B example that discovers + uses capabilities.

### LangChain Integration (Python, minimal)

```python
from taop import connect, CapabilityRegistryClient, ReputationOracleNetworkClient
from taop.integrations.langchain import TaopDiscoverTool

w3 = connect("https://sepolia.base.org", 84532)
ron = ReputationOracleNetworkClient("0x716EB78D4E7B297b53d9962e3952228691e3CEaA", w3)
reg = CapabilityRegistryClient("0x6132175a065295A51FC6d0eA8f1a7456F5c82019", w3)
tool = TaopDiscoverTool(reg, ron)
print(tool._run(capabilityType="LoRA", minScore=1))  # best LoRA agents

# With an LLM agent:
# from langchain.agents import create_agent
# agent = create_agent(model, tools=[tool])
# agent.invoke({"messages": [{"role": "user", "content": "find best LoRA summarizer"}]})
```

Requires `pip install langchain-core` (optional). Also available: `TaopScoreTool` + `load_taop_tools(reg, ron)`. TS parity: `import { discover } from "@taopp/sdk"` — `await discover(registry, ron, "LoRA", 1)`.

### Published Packages — Getting Started

Both the TypeScript SDK and MCP server are published and ready for use:

- **TypeScript SDK**: `npm install @taopp/sdk`
- **MCP Server**: `npm install -g @taopp/mcp-server` or `npx @taopp/mcp-server`

See the sections above and the individual package READMEs (`packages/sdk/README.md`, `packages/mcp-server/README.md`) for examples, including Claude Desktop integration for the MCP server.

Python SDK (`taop`) is available locally via the workspace but not yet on PyPI (symmetry planned).

## Quick start (local hardhat)

```bash
git clone https://github.com/lexagor/TAOP-protocol.git
cd TAOP-protocol
npm install
npm run contracts:build          # hardhat compile
npx hardhat node                 # terminal 1 — local node on :8545
npm run deploy:local             # terminal 2 — deploys + writes deployments.json
npm run backend:dev              # terminal 3 — API on :4000
npm run demo:dev                 # terminal 4 — demo page on :5173
```

Open http://localhost:5173 and click **Run the live demo**.

See `IMPROVEMENTS_PLAN.md` for the current prioritized roadmap.
See `PRE_MAINNET_CHECKLIST.md` for a detailed pre-mainnet readiness checklist.

## Mainnet preparation (Step 5)

**Pilot decision: keep Timelock delay=0 on mainnet for now** (for usability, same as Sepolia pilot). Increase only after audit + multisig.

### Hardened Sepolia Test (recommended before mainnet)
Test with real delay + multisig-like setup **without spending real ETH**:

```bash
# 1. Set up a test multisig (or use a Safe you control on Sepolia)
export MULTISIG_ADDRESS=0xYourSepoliaSafeOrEOA
export TIMELOCK_DELAY=3600   # 1 hour for test (or 86400)

# 2. Ensure deployer has Sepolia ETH
# 3. Deploy hardened version
npm run deploy:sepolia

# 4. Update .env and restart backend with the new deployments.json
# 5. Test full flow (challenge will now be scheduled + executable after delay)
```

See `PRE_MAINNET_CHECKLIST.md` for the full pre-mainnet readiness list.
See `TEST_RESULTS.md` for latest verified E2E pilot flows (cURL + UI + on-chain).

### Quick mainnet deploy checklist
1. Get a mainnet RPC and set `BASE_MAINNET_RPC_URL` in `.env`.
2. Fund a deployer wallet with real Base ETH.
3. Decide on multisig (e.g. Gnosis Safe on Base) and set `proposers`/`executors` in deploy script (see comments).
4. (Optional but recommended for hardened) `TIMELOCK_DELAY=86400` (24h) in env before deploy.
5. `npm run deploy:mainnet`
6. Update README table + deployments.json (auto), verify on Basescan.
7. **Strongly recommended**: professional audit (or at least Slither + manual review) before public mainnet usage with real value.

See:
- `scripts/deploy-base-sepolia.ts` (detailed comments on multisig + delay + mainnet)
- `hardhat.config.ts` (base network)
- `IMPROVEMENTS_PLAN.md` and `NEXT_STEPS.md` for full roadmap.

See:
- `scripts/deploy-base-sepolia.ts` (comments on multisig + delay)
- `hardhat.config.ts` ("base" network + etherscan)
- `package.json` (deploy:mainnet script)
- This keeps the pilot experience identical to Sepolia while hardening ownership.

Current pilot (Sepolia + planned mainnet) stays at 0 delay.


## Layout

```
contracts/              Solidity (full TRD signatures)
test/                   Hardhat + ethers v6 tests (22 passing)
scripts/                deploy-local.ts, deploy-base-sepolia.ts
packages/sdk/           @taopp/sdk — TypeScript SDK (published to npm)
packages/backend/       @taop/backend — REST API + demo orchestrator + IPFS pinning
packages/python-sdk/    taop — Python SDK (web3.py, mirrors @taopp/sdk)
packages/agent-b/       taop-agent-b — external agent that discovers + uses Agent A
apps/demo/              @taop/demo — React + Vite + Tailwind demo page
packages/mcp-server/    @taopp/mcp-server — MCP server for AI agents (Claude etc.) (published)
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

## Operations for the live pilot

- Health: `curl /api/healthz`
- Basic monitoring: watch contract events on Basescan or use a simple script polling `/api/contracts` + `/api/discover`.
- Public shareable demo: use `cloudflared tunnel --url http://localhost:4000` (see Run the pilot section).
- Rate limiting enabled in backend. For higher load, add external reverse proxy.

## Out of scope (see TRD.md Part 6)

A2A Hiring Exchange, cross-chain interoperability, arbitrator desk, plugin
store, analytics dashboards. The validator-ratings + protocol-token code is
dormant v2 — see TRD.md Appendix.
