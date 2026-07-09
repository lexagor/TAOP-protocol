# Base Batches Application — TAOP

> **Project:** TAOP — Trustless Agent Orchestration Protocol
> **Apply at:** https://base.org/ecosystem-fund → "01 Idea Base Batches" → Apply
> **Form type:** Google Forms (requires Google account)

---

## How to submit

1. Go to https://base.org/ecosystem-fund
2. Click "Get Started" or scroll to the "Opportunities" section
3. Click "01 Idea Base Batches" → the link opens a Google Form
4. Sign in with your Google account
5. Copy-paste the answers below into each field

---

## Form Answers

### 1. Project Name

**Answer:**
```
TAOP — Trustless Agent Orchestration Protocol
```

### 2. One-line description (140 chars max)

**Answer:**
```
On-chain credit bureau for AI agents — verifiable reputation, capability NFTs, ETH bonds, no token. Live on Base Sepolia.
```

### 3. Project category

Select: **AI / Agents / Infrastructure**

### 4. Elevator pitch (why now, why you, why Base)

**Answer (copy-paste):**

> AI agents are becoming autonomous economic actors — the market is projected at $5-10B by 2027 (Gartner). But agents have no way to trust each other. When Agent A hires Agent B, there's no credit bureau to check B's track record or verify their claimed capabilities.
>
> TAOP solves this. We're an on-chain protocol on Base that combines:
> - **Reputation Oracle Network** — agents build verifiable scores through self-attestation + ETH bonds + public challenge
> - **Capability Registry** — agents register NFTs proving what they can do, backed by real ETH
> - **Discovery API** — any agent framework queries "find me a summarization agent with 4+ score"
>
> We're live on Base Sepolia TODAY. Every layer is real:
> - Real GPT-4.1-nano AI inference via Replicate
> - Real IPFS evidence via Pinata
> - Real on-chain attestations on Base Sepolia (viewable on Basescan)
> - Clean Slither audit (no high/medium findings)
> - 37 contract tests passing
> - External Agent B proving the loop end-to-end
> - Working Python SDK + OpenAPI docs (14 endpoints)
> - Live demo via Cloudflare Tunnel
>
> We're two former Big4 product builders (EY/PwC) building full-time. TAOP is ETH-only protocol — no token, no SEC question, no validator set. We monetize through protocol fees when the network reaches scale (AWS free-tier strategy with a dormant fee switch).
>
> Base is the right home because:
> - $8B+ TVL with Base MCP support for agents
> - Coinbase Ventures distribution path
> - Growing AI/agent ecosystem (A0X, AI Arena, AgentiPy all on Base)
> - ETH-native L2 — aligned with our ETH-only model
>
> We're applying to Base Batches for the $25-75K non-dilutive funding and mentorship to take TAOP from Sepolia proof-of-concept to mainnet launch in 30 days.

### 5. What stage is your project?

**Answer:** Prototype / MVP (live on testnet, real AI + IPFS + on-chain, demo available)

### 6. Team background

**Answer (copy-paste):**

> **Founder 1: [Your Name]** — Former Senior Product Owner at EY, building crypto products for 2+ years. Deep expertise in Solidity (OpenZeppelin, Hardhat), TypeScript/Node.js SDK architecture, and multi-agent system design. Led product strategy for enterprise blockchain solutions.
>
> **Founder 2: [CTO Name]** — [Brief description focusing on Solidity/contracts or AI experience]
>
> Together we've built:
> - 3 Solidity contracts (RON, CapabilityRegistry) — ~244 lines, Slither-clean
> - TypeScript SDK (@taop/sdk) + Python SDK (taop) + REST API (14 endpoints)
> - External agent demo (Agent B) proving the protocol loop
> - Full test coverage (37 passing, self-attest + challenge flows)
> - Deployed and operated on Base Sepolia since June 2026

### 7. What problem are you solving? (500 words max)

**Answer (copy-paste):**

> AI agents are being deployed in increasing numbers — LangChain, CrewAI, ElizaOS, Claude Code, OpenAI Agents SDK — but they operate in isolated trust bubbles. There is no standard way for one agent to verify another agent's track record, capabilities, or reliability.
>
> Current "solutions" are terrible:
> - **Platform gatekeepers** (Relevance AI, Fixie) — centralized, vendor lock-in, don't operate across frameworks
> - **Community reputation** (GitHub stars, forum rep) — easily gamed, no economic consequence for fraud
> - **Wallet identity** (DIDs) — knowing *who* someone is doesn't tell you if they're *good*
> - **No verification** — every interaction is an unverified bet
>
> Concretely: If Agent A wants to hire Agent B to execute a complex smart contract deployment, A has no way to:
> 1. Verify B has done this before
> 2. Check B hasn't been slashed for fraud
> 3. Know B's claimed composability score is real
> 4. Recover if B turns out to be malicious
>
> This is exactly the problem credit bureaus solved for human lending. Equifax, Experian, and TransUnion are worth $5B+ each because they aggregate trust signals. TAOP is the Equifax for the agent economy — but on-chain, trust-minimized, and stack-agnostic.

### 8. How does your solution work? (500 words max)

**Answer (copy-paste):**

> TAOP is an ETH-only protocol on Base with two core contracts:
>
> **1. ReputationOracleNetwork (RON):** Agents self-attest completion records with ETH bonds. Anyone can challenge a fraudulent attestation by posting a 0.01 ETH bond. The owner resolves disputes. Score = completions − disputes. This gives every agent a verifiable on-chain credit score.
>
> **2. CapabilityRegistry:** Agents register what they can do as on-chain records — capability type (e.g., "summarization"), minimum bond, and evidence CID. Other agents query by (capabilityType, minScore) to find verified partners.
>
> **The end-to-end loop (live on Base Sepolia right now):**
> ```
> Agent B queries CapabilityRegistry → finds Agent A (score=8, certified, 0.01 ETH bond)
> Agent B requests a task → Agent A runs real GPT-4.1-nano inference
> Agent A pins output to IPFS → self-attests completion on-chain
> Agent B verifies attestation → Agent A's score updates (9/0)
> ```
>
> **Key design decisions:**
> - **ETH-only, no token** — simpler legal, no SEC question, lower developer friction
> - **Dormant fee switch** — $0.25 registration (anti-Sybil), free discovery. Governance-switchable query fee later (Uniswap/Lido pattern)
> - **Framework-agnostic** — REST + OpenAPI. Any agent framework (LangChain, ElizaOS, Claude, Codex) can integrate
> - **No validator set** — v0.1 uses self-attest + challenge. Validator code is dormant in-contract for future activation when TAOP reaches sufficient scale

### 9. What is your go-to-market strategy?

**Answer (copy-paste):**

> **Phase 1 (Weeks 1-4): Developer-first adoption**
> - Publish public npm package (@taop/sdk) and PyPI package (taop)
> - Open-source contracts on GitHub
> - Build MCP server so any MCP-compatible agent (Claude, Codex) can query discovery natively
> - Ship ElizaOS plugin and LangChain tool adapter — the two largest agent frameworks
> - Deploy on Base mainnet
>
> **Phase 2 (Weeks 5-12): Framework integrations**
> - Direct outreach to CrewAI, AutoGPT, and custom agent builders
> - "Integrate in 5 lines of code" quickstart guide
> - Blog posts: "How to add reputation to your AI agent" (technical, cross-posted to Dev.to, Hacker News, crypto Twitter)
> - Office hours for 5 pioneer agent teams (we help them integrate → they become case studies)
>
> **Phase 3 (Months 4-6): Organic network effects**
> - Each new agent with a reputation score makes the network more valuable
> - Discovery API becomes the default query for agent hiring
> - Fee switch conversations start when monthly queries hit 100K
>
> **Distribution wedge:** Free discovery queries. Zero friction drives API adoption and integration deals. We monetize later — the Uniswap playbook.

### 10. What would you use the Batch funding for?

**Answer (copy-paste):**

> **$25K minimum / $75K ideal:**
>
> | Use | Amount | Purpose |
> |-----|--------|---------|
> | Smart contract audit | $15K | Mandatory security audit of RON + CapabilityRegistry before mainnet |
> | Mainnet deployment + gas | $5K | Base mainnet deploy, seed registrations, initial challenge bonds |
> | SDK + MCP server | $5K | Public npm/PyPI, MCP server for Claude/Codex, ElizaOS plugin |
> | Developer docs + tutorials | $5K | Quickstart guide, integration examples, API playground |
> | Operations (2 founders, 3 months) | $45K | Extends runway while we build to mainnet launch |
>
> **Why Base Batches specifically:** We're at the exact stage Batches was designed for — working prototype on Base Sepolia, verified technical execution, need to launch on mainnet with proper security. The mentorship on fundraising and go-to-market is as valuable as the capital.

---

## Screenshots to include

Attach these alongside the form:

1. **Basescan attestation tx** — screenshot of `0xd112f265...` on sepolia.basescan.org
2. **Demo page** — screenshot showing the full stack table (contracts, AI, IPFS, attestations)
3. **Agent B terminal output** — screenshot of the Agent B run showing discover → use → verify
4. **Test results** — `npm run contracts:test` showing 37 passing
5. **Contracts diagram** — simple architecture diagram showing the loop

---

## Follow-up

After submitting:
1. Check your email for confirmation from Base
2. Batches runs quarterly — expect 2-4 weeks for review
3. In parallel, DM 15 crypto-native angels with the X thread + demo video
4. Apply to a16z Crypto Startup Accelerator (CSX) at https://a16zcrypto.com/accelerator/ — provides capital + mentorship + network. Applications open on a rolling basis. Note: a16z Crypto Startup School was rebranded/replaced by CSX (the full accelerator, not a free school).
