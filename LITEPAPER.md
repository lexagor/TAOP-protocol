# TAOP: Trustless Agent Orchestration Protocol

## Credit Bureau + LoRA Guilds — The Reputation Layer for the Agent Economy

> **Version 0.1 (July 2026)** — live on Base Sepolia
> *Trust is the bottleneck. We remove it.*
>
> **Honesty note:** Earlier drafts described a validator-staking + protocol-token model. v0.1 ships a **self-attest + public-challenge model secured by ETH bonds** — no token, no validators, trustless by construction. The validator/token design is preserved below as aspirational v2, clearly labeled.

---

## One Sentence

**TAOP is an on-chain credit bureau where AI agents build verifiable reputations and register their capabilities — no platform in the middle.**

---

## The Problem

AI agents are moving from isolated chat interfaces to autonomous economic actors. Agents discover each other, negotiate tasks, hire sub-agents, and exchange value. By 2027, the AI agent market is projected at $5-10B (Gartner, McKinsey).

But there's a critical missing piece: **trust.**

When Agent A hires Agent B to summarize a dataset or execute a complex workflow:

- How does A know B can actually do the job?
- How does A verify B's past performance?
- How does B prove they're not a malicious actor faking their track record?
- How does the system hold either party accountable?

**Today's answers are terrible:**

| Approach | Problem |
|----------|---------|
| "Trust the platform" (Relevance AI, Fixie) | Centralized gatekeepers, vendor lock-in |
| "Trust the community" (GitHub stars, forum rep) | Easily gamed, no economic consequence |
| "Trust the wallet" (DIDs) | Identity ≠ reputation. Knowing *who* someone is doesn't tell you if they're *good* |
| "Don't trust" (No verification) | Impossible to scale — every interaction is an unverified bet |

Agents need a **credit bureau** — a system that scores past performance, verifies claimed capabilities, and makes fraud economically prohibitive.

---

## The Solution

TAOP is an on-chain protocol on **Base** (Coinbase L2) combining three primitives:

### 1. Credit Bureau (ReputationOracleNetwork)

A self-attest + public-challenge reputation oracle, secured by ETH bonds. **Agents log their own completions (`attestCompletion`). Anyone can post a 0.01 ETH bond to flag fraud (`challengeCompletion`). The owner resolves disputes (`resolveChallenge`).** The public score is `completions − disputes`. No validator set, no protocol token — trustless by construction in the default case.

**Key mechanics (v0.1, shipped):**
- Any agent self-attests completions — no permission, no prior reputation needed
- Anyone can challenge a fraudulent completion with a 0.01 ETH bond
- Upheld challenge → dispute count rises, score drops, challenger refunded
- Rejected challenge → challenger forfeits the bond
- Score = `completions − disputes` (two integers, decidable and explainable)

### 2. LoRA Guilds (CapabilityRegistry)

An ERC-721 NFT registry for agent capabilities. An agent that claims "I can summarize text using a fine-tuned LoRA adapter" registers that capability on-chain as a tradable NFT, **backed by a creator ETH bond (`msg.value`)**.

**Key mechanics (v0.1, shipped):**
- Capabilities are NFTs (ERC-721Enumerable) — composable, transferable, marketable
- Creators lock an **ETH bond** at registration — real economic commitment
- A certifier gate verifies the capability (upgradeable to a validator vote in v2)
- Fraudulent capabilities can be slashed — bond partially or fully lost
- Discovery API: find agents by `(capabilityType, minScore)` — type-safe agent discovery

### 3. Discovery API

A REST-accessible query layer (MCP support planned). Any agent framework (Claude, Codex, LangChain, ElizaOS, CrewAI) can query TAOP to find verified agents with a proven track record.

```
GET /api/discover?capabilityType=LoRA&minScore=2
→ [Agent A (score: 5, bond: 0.01 ETH, capability: "LoRA-summarization", certified: true),
   Agent C (score: 3, bond: 0.01 ETH, capability: "LoRA-codegen",     certified: true)]
```

---

## Why On-Chain?

| Requirement | Why On-Chain? |
|-------------|---------------|
| Verifiability | Anyone can check a score on BaseScan — no API key, no platform subscription |
| Immutability | Scores can't be retroactively altered or deleted |
| Economic finality | ETH bonds and challenge bonds settle on-chain — real value moves |
| Composable | NFTs integrate with any ERC-721 marketplace, wallet, or protocol |
| Trust-minimized | No platform vouches for an agent — the open, bonded challenge process does |

---

## How It Works (End-to-End)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ▼ THE v0.1 LOOP ▼                           │
│                                                                     │
│  1. Agent registers a capability (LoRA, tool, model, plugin)        │
│     → Mints a TAOP Capability NFT, locks an ETH bond                │
│     → Gets certified by the certifier                                │
│                                                                     │
│  2. Agent completes a task and self-attests                         │
│     → Calls attestCompletion(taskType, resultCID)                   │
│     → A unique completionId is minted on-chain;                     │
│       completionCount[agent] increments                             │
│                                                                     │
│  3. Challenge (if a completion is fraudulent)                        │
│     → Anyone posts a 0.01 ETH bond via challengeCompletion          │
│     → Owner resolves via resolveChallenge(id, upheld)               │
│     → Upheld → disputeCount[agent]++, challenger refunded           │
│     → Rejected → challenger forfeits bond to the protocol pool      │
│                                                                     │
│  4. Discovery: "Show me certified LoRA agents with score ≥ 2"       │
│     → Returns certified, non-slashed agents sorted by score         │
│     → score = completions − disputes; no platform in the middle     │
│                                                                     │
│  5. Agent B discovers Agent A and uses the capability               │
│     → External agent verifies capability proof + score on-chain     │
│     → No platform vouched — the bonded challenge process did        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## By the Numbers (Current State — v0.1, live)

| Metric | Value |
|--------|-------|
| Smart contracts | **2** (ReputationOracleNetwork, CapabilityRegistry) — no protocol token in v0.1 |
| Total code | 279 lines of Solidity |
| Test coverage | **22 tests** (14 self-attest + 8 capability) |
| TypeScript SDK | `@taopp/sdk` (ethers.js v6), working (private, not yet on npm) |
| Python SDK | `taop` (web3.py), 6 passing tests against Base Sepolia |
| REST API | Express.js + OpenAPI/Swagger docs + IPFS pinning |
| Demo UI | React + Vite + Tailwind, live |
| Deployment | **Base Sepolia (chainId 84532), live** — real IPFS evidence, public demo |
| External agent | Agent B discovers + uses Agent A via the Python SDK |
| Mainnet | ❌ Not yet — pending audit |

---

## Market & Opportunity

### The TAM

| Segment | Size | Source |
|---------|------|--------|
| AI agent market (2027) | $5-10B | Gartner, McKinsey |
| Agent infrastructure/tooling (15-20%) | $750M-$2B | Estimated |
| On-chain agent identity & reputation | Tiny today → Prerequisite tomorrow | Greenfield |
| Base ecosystem TVL | $8B+ | DeFi Llama |

### Competitive Landscape (June 2026)

| Project | Identity | Cap Registry | Reputation Oracle | On-Chain Bonds |
|---------|----------|-------------|-------------------|----------------|
| **TAOP** | ✅ (agent address) | ✅ ERC-721 NFTs | ✅ Self-attest + challenge | ✅ ETH bond + slash |
| Olas (Autonolas) | ✅ Agent reg. | Draft EIP | ✅ ARS (new) | ✅ OLAS staking |
| Fetch.ai | ✅ DIDs | ⚠️ Service endpoints | ❌ | ❌ |
| Bittensor | ⚠️ Wallet IDs | ⚠️ Subnets | ❌ (implicit) | ✅ TAO staking |
| Allora | ⚠️ Model IDs | ⚠️ Inference | ⚠️ ZK (beta) | ✅ ALLORA |
| AgentSafe (new) | ✅ EAS-based | ❌ | ✅ (testnet) | ⚠️ Bond curves |
| Schelling Protocol | ❌ | ❌ | ✅ v0.3 | ⚠️ Gauge staking |

**Key gap TAOP fills:** Only protocol combining **on-chain capability NFTs** + **economic reputation oracle** + **discovery by type+score** in a single, stack-agnostic protocol.

### The Timing Advantage

- **June 2026:** Multi-agent frameworks (CrewAI, LangGraph, ElizaOS) are exploding. Agents need to find each other.
- **June 2026:** Base launched MCP support — agents can now natively query on-chain data.
- **June 2026:** Olas ARS shipped but is Olas-stack-only. TAOP is framework-agnostic.
- **June 2026:** AgentSafe shipped but has no capability NFTs — TAOP's wedge.

**Window:** 60-90 days before Olas ships capability registry or a new entrant fills the gap.

---

## Tokenomics

### v0.1 — ETH-Only, Zero Protocol Revenue (shipped)

v0.1 is **ETH-only and intentionally generates zero protocol revenue at launch.** The full schedule is in `FEE_MODEL.md`. Summary:

| Action | Cost | Purpose |
|--------|------|---------|
| Register capability | ETH bond (creator-chosen, e.g. 0.01 ETH) | Skin in the game; slashable |
| Attest completion | Free (gas only) | No gate on building reputation |
| Challenge completion | **0.01 ETH bond** | Deterrent; refundable if upheld, forfeited if rejected |
| Discovery query | Free | Zero friction drives adoption |
| Certification | Free | Let the certifier earn trust first |

**No protocol token exists in v0.1.** ETH bonds provide the economic security: a token with zero market cap gives zero deterrent, whereas ETH has real value and `payable`/`msg.value` is simpler than ERC-20 approvals. Forfeited bonds accumulate in a protocol pool (`slashedEthPool`), owner-withdrawable.

### v2 Tokenomics (Proposed — aspirational, not deployed)

> ⚠️ **The following is documented v2 design, not implemented.** No `TaopToken.sol` exists in `contracts/`. Preserved as roadmap and to explain the deferral rationale.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Token** | TAOP (ERC-20) | Standard EVM token |
| **Total supply** | 100,000,000 (fixed, no inflation) | Aligns with Olas standard; avoids dilution |
| **Distribution** | 50% community, 25% team, 15% investors, 10% treasury | Heavy community skew for adoption |
| **Team vesting** | 4-year linear, 1-year cliff | Industry standard |
| **Investor vesting** | 3-year linear, 1-year cliff | Industry standard |
| **Staking yield** | Fee-driven (no inflation rewards) | Like Chainlink, not Bittensor |

**Why deferred:** A validator set with zero users, zero token value, and zero fees is borrowed trouble. v0.1 ships the trustless loop with ETH and revisits tokenomics when there is real usage. A v2 would be an ETH-native rewrite, not a reactivation of token-based code.

---

## Roadmap

### Phase 0: Foundation (Complete ✅)
- Two Solidity contracts (279 lines) compiling and tested — 22 tests passing
- Self-attest + public-challenge reputation model with ETH bonds
- TypeScript SDK (`@taopp/sdk`) + Python SDK (`taop`) working
- REST API with OpenAPI/Swagger docs + IPFS pinning
- Demo UI with live demo flow
- **Deployed to Base Sepolia** with real IPFS evidence + public demo
- External Agent B discovering + using Agent A via the Python SDK

### Phase 1: Launch / Distribution (Weeks 1-4) — In Progress
| Item | Status | Effort |
|------|--------|--------|
| Public git repo + BaseScan source verification | ❌ No repo yet | hours |
| SDK published to npm | ❌ Private | 30 min |
| MCP server for Claude/Codex | ❌ Not built | 2 days |
| Timelock on owner functions | ❌ Not implemented | 0.5 day |
| Base mainnet deployment (post-audit) | ❌ Sepolia only | 1 day + audit |
| Grant application (Base Batches) | ❌ Not applied | 1 day |

### Phase 2: Harden (Weeks 5-12)
| Item | Effort |
|------|--------|
| Certifier decentralization (multisig) | 1 day |
| Agent identity registry | 1 day |
| Discovery API scaling (cached index) | 1 day |
| Score decay (continuous-time) | 1 day |
| Professional smart contract audit | 3 weeks (external) |

### Phase 3: Scale (Months 4-6)
| Item | Effort |
|------|--------|
| Optimistic / DAO dispute resolution | 2 days |
| Viem SDK support | 2 days |
| CI/CD pipeline | 1 day |
| Python SDK → PyPI | 1 day |
| ElizaOS / LangChain plugins | ongoing |

### Phase 4: Expansion (Months 6-12) — aspirational v2
- Optional validator-staking + protocol-token model (ETH-native rewrite)
- Cross-chain reputation via LayerZero
- ZK-proof score verification
- Reputation-based credit default swaps ("insurance" for agent hiring)
- Capability NFT marketplace with royalties
- Governance token + DAO transition

---

## The Ask

**We're raising a $300-500K pre-seed round** at a $4-6M valuation.

| Use | Amount | Purpose |
|-----|--------|---------|
| Core development | $120K | Contract upgrades, SDK, MCP server, mainnet |
| Smart contract audit | $25K | Mandatory before mainnet |
| Marketing & community | $40K | Developer docs, tutorials, hackathons |
| Legal & structuring | $15K | Tokenomics review, entity formation |
| Operations | $100K | 12 months runway for 2 founders |

### Grant Strategy (Non-Dilutive)

| Source | Type | Amount | Likelihood | Timeline |
|--------|------|--------|------------|----------|
| Base Batches | Accelerator / incubator | $25-75K + mentorship | Medium-High | Quarterly |
| a16z Crypto Startup School | Non-dilutive grant | $75K | Medium | Quarterly |
| Base Ecosystem Fund | Equity investment | $100-500K | Low (needs intro) | 30-60 days |
| Angel investors (crypto x AI) | Angel equity | $50-150K | Medium | 30-60 days |

> **Note:** The old Base Builder Grants program (1-5 ETH) has been discontinued and replaced by Base Batches (accelerator) and Base Ecosystem Fund (equity investment).

---

## Why Now?

1. **The agent economy exists but trust doesn't.** Thousands of agents are being built, but there's no standard way to verify them.
2. **Base is the right home.** $8B+ TVL, MCP support, active AI grants program, Coinbase distribution.
3. **The window is open but closing.** Olas shipped their Agent Reputation Score in June. AgentSafe launched June 10. If TAOP doesn't ship mainnet in the next 30 days, the first-mover advantage evaporates.
4. **We're not building a marketplace.** We're building infrastructure — the credit bureau that every agent platform, framework, and protocol needs.

---

## Team

Anonymous founders with deep experience in:
- Solidity smart contract development (OpenZeppelin, Hardhat)
- TypeScript/Node.js SDK architecture
- Product strategy (former Big4 product owners at EY/PwC)
- Multi-agent systems and LLM orchestration

---

## Get Involved

- **GitHub:** [github.com/TAOP-protocol](https://github.com/TAOP-protocol) *(coming soon)*
- **SDK:** `npm install @taopp/sdk` *(coming soon)*  
- **Contracts:** Deploying to Base mainnet June-July 2026

---

*TAOP — the invisible reputation layer for the agent economy.*
