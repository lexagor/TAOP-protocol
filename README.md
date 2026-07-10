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
| ReputationOracleNetwork | `0xc0ee3c29147bc68d320b7Ac6cC5234ee79Bc4F1d` | [view](https://sepolia.basescan.org/address/0xc0ee3c29147bc68d320b7Ac6cC5234ee79Bc4F1d) |
| CapabilityRegistry | `0xdeed09CAD527851e926b8387A0F710498AdECe3e` | [view](https://sepolia.basescan.org/address/0xdeed09CAD527851e926b8387A0F710498AdECe3e) |
| TimelockController | `0x6904A455f53728d1BcE2F6827750d6e9F7132A4D` | [view](https://sepolia.basescan.org/address/0x6904A455f53728d1BcE2F6827750d6e9F7132A4D) |

**Validator / Deployer:** `0x37374FD4f27c2b46Fd5d1a9BAFdc709315E51120`

**Redeploy / refresh:**  
If you need to redeploy again: `npm run deploy:sepolia` (we lowered the Agent A fund amount to 0.02 ETH).

**Get / top up test ETH:**  
- Coinbase: https://portal.cdp.coinbase.com/products/faucet  
- Alchemy: https://www.alchemy.com/faucets/base-sepolia  
- More: https://docs.base.org/base-chain/network-information/network-faucets

**Current status (v0.1):** Public repo, published `@taopp/sdk` + `@taopp/mcp-server`, Timelock (0-delay for demo), score decay, indexed discovery. See `IMPROVEMENTS_PLAN.md`.

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

const ron = new ReputationOracleNetworkClient("0xc0ee3c29147bc68d320b7Ac6cC5234ee79Bc4F1d", provider); // live on Base Sepolia
const score = await ron.getSelfAttestScore("0x...");
console.log(score); // { completions, disputes, score }
```

See `packages/sdk/README.md` for full docs and examples.

### MCP Server (for AI Agents)

Now published: `npm install -g @taopp/mcp-server`

```bash
npx @taopp/mcp-server
```

Exposes tools like `get_agent_score`, `discover_capabilities`, `attest_completion`, `challenge_completion`, `register_capability`.

See `packages/mcp-server/README.md` for configuration and Claude Desktop integration.

Requires `RPC_URL` and optionally `PRIVATE_KEY` + `deployments.json`.

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

## Mainnet preparation

1. Get a mainnet RPC and set BASE_MAINNET_RPC_URL in .env.
2. Use a wallet with real Base ETH.
3. For mainnet, keep 0 delay for now (as per pilot decision) or set via TIMELOCK_DELAY. Use multisig for proposers.
4. Update hardhat.config for "base" network and run appropriate deploy.
5. Security audit recommended before mainnet.

See deploy scripts for multisig setup. Current pilot stays at 0 delay for usability.


## Layout

```
contracts/              Solidity (full TRD signatures)
test/                   Hardhat + ethers v6 tests (22 passing)
scripts/                deploy-local.ts, deploy-base-sepolia.ts
packages/sdk/           @taopp/sdk — TypeScript SDK (published to npm, early access)
packages/backend/       @taop/backend — REST API + demo orchestrator + IPFS pinning
packages/python-sdk/    taop — Python SDK (web3.py, mirrors @taopp/sdk)
packages/agent-b/       taop-agent-b — external agent that discovers + uses Agent A
apps/demo/              @taop/demo — React + Vite + Tailwind demo page
packages/mcp-server/    @taopp/mcp-server — MCP server for AI agents (Claude etc.)
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
