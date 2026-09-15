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
`completions − disputes`, decayed linearly to zero over 150 days after a 30-day inactivity grace. Discovery is indexed by capability type.
Agents identified by address (basic identity planned). No protocol token, no validator set — those are dormant v2 code.

**v0.2 two-sided trust (in the contract + SDKs, pending redeploy):** a completion
only counts toward the *ranking* score once an independent requester countersigns
it (`attestReceipt`); the requester can `revokeReceipt`. Challenges now open a
3-day `CHALLENGE_WINDOW`: the agent can `contestChallenge` with a rebuttal, and an
uncontested challenge is finalized optimistically by anyone after the window
(`finalizeChallenge`); contested challenges fall back to the owner
(`resolveChallenge`). `getTwoSidedScore` is the score to rank on; `getSelfAttestScore`
remains for backwards compatibility. See `CHANGELOG.md` [Unreleased].

The demo page proves the loop:

> Agent A self-attests a completion → on-chain on Base → Agent B discovers
> Agent A by capability proof + score. Optional: challenge a fraudulent
> completion to see the score drop.

## Live pilot (Base Sepolia)

### Contracts (Live on Base Sepolia)

> v0.1.2 redeploy (2026-09-15): stale-index + id-derivation fixes, linear decay (30-day grace, 150-day horizon), indexed discovery (`getCapabilitiesByType`), TimelockController (0 delay for pilot).

| Contract | Address | Basescan |
|---|---|---|
| ReputationOracleNetwork | `0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356` | [view](https://sepolia.basescan.org/address/0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356) |
| CapabilityRegistry | `0x2E72Ada571df608AC1C811174A1921CAaDE46362` | [view](https://sepolia.basescan.org/address/0x2E72Ada571df608AC1C811174A1921CAaDE46362) |
| TimelockController | `0xA5d5eb6964568eD1157F985EE08ab42B56e1307B` | [view](https://sepolia.basescan.org/address/0xA5d5eb6964568eD1157F985EE08ab42B56e1307B) |

**Validator / Deployer:** `0x37374FD4f27c2b46Fd5d1a9BAFdc709315E51120`

**Agent A:** `0xB924e022441596e6007fa5db1966B08066cCEBa4` (fresh key, v0.1.2 redeploy 2026-09-15 — the previously published agent key is retired)

**Redeploy / refresh:**  
If you need to redeploy again: `npm run deploy:sepolia` (we lowered the Agent A fund amount to 0.02 ETH).

**Get / top up test ETH:**  
- Coinbase: https://portal.cdp.coinbase.com/products/faucet  
- Alchemy: https://www.alchemy.com/faucets/base-sepolia  
- More: https://docs.base.org/base-chain/network-information/network-faucets

**Current status (v0.1.2, live 2026-09-15):** Public repo, `@taopp/sdk@0.1.2` + `@taopp/mcp-server@0.1.1` (pending publish), Timelock (0-delay — policy frozen by decision), linear decay (30-day grace + 150-day horizon) with `getScoreDetails`, indexed discovery, basic agent identity, gated writes (`X-TAOP-Key`, `DEMO_READ_ONLY`), secrets purged from history (see `SECURITY.md`). 32 contract tests passing, real typecheck green, Python SDK 7/7. Verified pilot: attest (0→1) → discover (minScore=1 works) → challenge → resolve via Timelock (TEST_RESULTS.md). Governance (multisig/delay) deferred; free-only security (Slither + manual + community).

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

> ⚠️ **Do not tunnel the write-enabled backend.** It holds keys and can spend
> bonds and execute owner-only Timelock actions. Tunnels are for read-only
> instances: start the server with `DEMO_READ_ONLY=true`, or set
> `TAOP_API_KEY` and build the UI with the same `VITE_TAOP_API_KEY`. See
> [`SECURITY.md`](SECURITY.md) §4.

Open the tunnel URL in your browser to see the demo page (read-only instance).
Click **Run the live demo** to self-attest a completion on Base Sepolia.

To share a public read-only demo without deploying:
```bash
# In one terminal: backend on 4000, writes disabled
DEMO_READ_ONLY=true npx tsx packages/backend/src/server.ts
# In another:
cloudflared tunnel --url http://localhost:4000
```
Share the https URL from cloudflared. Write routes intentionally return `503`.

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

const ron = new ReputationOracleNetworkClient("0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356", provider); // live on Base Sepolia
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
ron = ReputationOracleNetworkClient(w3, "0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356")
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
ron = ReputationOracleNetworkClient("0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356", w3)
reg = CapabilityRegistryClient("0x2E72Ada571df608AC1C811174A1921CAaDE46362", w3)
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
- [`docs/redeploy-v0.2.md`](docs/redeploy-v0.2.md) (redeploy runbook, locally rehearsed)
- [`docs/hardened-timelock.md`](docs/hardened-timelock.md) (multisig + non-zero delay rehearsal)
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
test/                   Hardhat + ethers v6 tests (32 passing)
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
# Contract tests (32 passing: self-attest + ETH bonds + v0.1.2 regressions)
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

- **Secrets:** keys live only in `.env` (gitignored, `chmod 600`).
  `deployments.json` is publishable and holds **addresses only**. Never put a
  private key in a tracked file. See [`SECURITY.md`](SECURITY.md) — including the
  disclosure of three published testnet agent keys (2026-09) and their retirement.
- **Write routes are gated:** all non-`GET` `/api` routes require
  `X-TAOP-Key: <TAOP_API_KEY>` whenever `TAOP_API_KEY` is set, and the server
  **refuses to start** on a non-loopback `HOST` without one.
- **Rate limiting:** 240 req/min overall, 20 writes / 5 min (`express-rate-limit`).
- **Slither:** no high or medium findings in our contracts.
- **Challenge resolver:** owner-only (centralized trust boundary, documented in
  TRD.md Appendix). Upgradeable to DAO/optimistic in v2.
- **Bonds:** in ETH on Base. No protocol token in v0.1.
- **Audit:** not yet audited. Not ready for mainnet.

## Operations for the live pilot

- Health: `curl /api/healthz` → `{"ok":true}`
- Security banner: the startup log prints `bind=… | writes=… | write auth=…` —
  check it before sharing any URL.
- Basic monitoring: watch contract events on Basescan or poll `/api/contracts` + `/api/discover`.
- **Discovery index (F10):** `/api/discover` is served from a SQLite `eth_getLogs`
  indexer with `?limit=`/`?offset=` paging, an `X-Total-Count` header and `ETag`/`304`
  caching (falls back to a direct on-chain scan until the index is warm). Check
  `GET /api/indexer` for lag. Tune with `INDEXER_ENABLED`, `INDEXER_POLL_MS`,
  `INDEXER_CHUNK_SIZE`, `INDEXER_START_BLOCK`, `INDEXER_LOOKBACK_BLOCKS`.
- **Observability (F12):** structured JSON logs (`LOG_LEVEL`, secrets redacted),
  an enriched `GET /api/healthz` (RPC latency, block, indexer lag, write mode)
  and a `GET /api/alerts` stream (challenges, slashing, pool withdrawals). See
  [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
- **Sharing a demo publicly: read-only only.** Run a second instance with
  `DEMO_READ_ONLY=true` and share that URL; write routes return `503`.
  If you must expose writes, set `TAOP_API_KEY=$(openssl rand -hex 32)`, build the
  UI with `VITE_TAOP_API_KEY=<same>`, and set `TRUST_PROXY=1` when behind a tunnel
  or reverse proxy. Never expose the write-enabled server without a key — it can
  spend bonds and execute owner-only Timelock actions.
- Rate limiting is built in; for higher load add an external reverse proxy.

## Out of scope (see TRD.md Part 6)

A2A Hiring Exchange, cross-chain interoperability, arbitrator desk, plugin
store, analytics dashboards. The validator-ratings + protocol-token code is
dormant v2 — see TRD.md Appendix.
