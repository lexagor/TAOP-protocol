# Trustless Agent Orchestration Protocol (TAOP) — MVP Technical Requirements Document

## Overview

The Trustless Agent Orchestration Protocol (TAOP) is a decentralized infrastructure layer that lets AI agents **discover, verify, and pay other agents without relying on a centralized platform**. This MVP Technical Requirements Document narrows the TAOP vision to two pillars that are ready to ship:

1. **Agent Credit Bureau** — a trustless, portable reputation layer that records verifiable on-chain attestations of agent behavior.
2. **LoRA Guilds** — a capability registry where tokenized LoRA models (and other agent capabilities) are registered, bonded, and verified, so other agents can discover them by **cryptographic capability proof**.

The broader TAOP vision — including an A2A Hiring Exchange (task marketplace), cross-chain interoperability, an arbitrator desk, a plugin store, and analytics dashboards — is intentionally **out of scope for this MVP**. Those are catalogued in [Part 6 — Out of MVP / Future Work](#part-6--out-of-mvp--future-work). The MVP's job is to prove the hardest, most novel part first: **that agent reputation and capability can be made trustless, on-chain, and consumable by any existing AI framework.**

The MVP is protocol-neutral and composable. Reputation and capability are implemented as separate smart contracts with open APIs, deployed on a single L2 (Base), exposed via REST, GraphQL, gRPC, and WebSocket, and shipped with TypeScript and Python SDKs. Existing agents (LangChain, AutoGPT, LlamaIndex) can query credit scores and capability proofs without migrating their logic.

A single demo page — described in [Part 5](#part-5--demo-page-specification) — proves the end-to-end loop: **Agent A completes a task → a reputation attestation is written on Base → Agent B discovers Agent A by capability proof + score.**

---

## Part 1 — Competitor landscape

### Top decentralized AI/agent platforms and SWOT

The table below compares three leading decentralized AI/agent platforms — Fetch.ai, SingularityNET, and Olas/Autonolas — and identifies the **reputation and capability gap** that the TAOP MVP addresses. Each row lists strengths, weaknesses, opportunities, threats (SWOT) and the specific gap the MVP closes.

| Platform | Strengths | Weaknesses | Opportunities | Threats | Gap the TAOP MVP closes |
|---|---|---|---|---|---|
| **Fetch.ai** | Decentralized agent architecture with verifiable identity, discovery, and micro-transactions via the Almanac registry and Agent Name Service. Event-driven `uAgent` Python framework supports async messaging and periodic actions. FET token enables micro-payments and Sybil resistance. | AI computation runs off-chain; the chain coordinates identity/payment only. Reliance on external servers raises trust and verification challenges. Throughput limited by L1; payment channels needed to bundle service calls. | Cross-chain expansion via the ASI merger; integration with LLM-agent frameworks; open agent registry fosters network effects; micro-transaction economy. | Centralized AI competition; developer fragmentation; token inflation; regulatory uncertainty. | **No trustless, portable cross-protocol reputation layer.** Fetch.ai identity is tied to the FET network and its ratings aren't easily consumed by other agent frameworks. The TAOP Credit Bureau is a neutral, on-chain attestation layer any framework can read. |
| **SingularityNET** | Decentralized AI service marketplace. Developers list AI services on-chain; payments flow through a multi-party escrow system. AGIX token enables payments, staking, and governance. Supports agent-to-agent service calls and payments. Multi-chain strategy (Ethereum, Cardano) reduces fees. | AI models are hosted off-chain; the chain is mostly a coordination/payment layer. Verification of AI outputs relies on off-chain mechanisms, raising trust and quality concerns. Network growth has been slow despite years of development. | Open multi-chain architecture; cross-protocol agent interactions; LLM-agent integration; machine-to-machine economy; ASI-merger synergies. | Competition from newer agent networks; governance centralized in the SNET Foundation; multi-chain fragmentation; token demand coupled to usage. | **No economic bonding for capability quality.** SingularityNET's escrow handles payments but offers no reputational stake or slashing to deter low-quality or fraudulent models. The TAOP LoRA Guilds require creators to bond tokens and slash them when models underperform. |
| **Olas / Autonolas** | Pioneered on-chain agent registries and multi-agent coordination. Agents, components, and services are minted as ERC-721 NFTs in the Agent Registry and Service Registry. IPFS hashes of code/dependencies support composability and versioning. Services use multisig wallets and slashable deposits for honest operation. Cross-chain on Ethereum, Gnosis, Solana; open-source autonomy framework. | Complex dependency trees make gas-inefficient updates; updating one component hash can require updating the whole tree. Consuming components directly from on-chain registries is hard because hashes go stale. No native reputation scoring and no LoRA-specific capability layer. | Growing demand for autonomous DAO services; DeFi + AI-agent composable use cases; early cross-chain deployment. | Developer adoption limited by gas cost and complexity; competition from protocols that integrate AI inference; regulatory risk for autonomous financial operations. | **No capability marketplace and no reputation scores.** Olas registers agents but provides no marketplace for specialized AI capabilities (e.g., LoRA models) and no reputation scores that other agents can use to evaluate quality. TAOP ships both. |

**Key insight:** all three platforms rely on off-chain computation and none ships a **trustless, cross-protocol reputation layer paired with a bonded capability registry**. The TAOP MVP is the first to combine a neutral Credit Bureau (reputation attestations) with LoRA Guilds (capability registry + economic bonding) so that any agent framework can discover agents by **cryptographic capability proof backed by on-chain reputation**.

---

## Part 2 — MVP architecture

The MVP combines two pillars — **Concept 3: Agent Credit Bureau** and **Concept 2: LoRA Guilds** — into a unified, layered protocol. The on-chain smart contracts enforce state transitions (registration, bonding, attestation, slashing). Off-chain services handle AI inference, capability verification, and indexing. All reputation state is recorded on Base for auditability; large data (LoRA weights, model metadata, verification evidence) is stored off-chain on IPFS and referenced by CID.

The Hiring Exchange (task marketplace) from the original TAOP vision is **not** part of the MVP. The MVP's "task" is the demo's verification event — an agent performs a verifiable off-chain task, the result is attested on-chain, and the reputation score updates. No escrow, no bidding, no milestone payments in the MVP.

### High-level architecture

1. **Reputation Oracle Network (Credit Bureau)** — a decentralized set of validators that produce verifiable agent credit scores based on historical task outcomes, slashing events, and stake. Scores are stored on-chain in the RON contract and are readable via view calls, REST/GraphQL, and the SDKs.
2. **Capability Registry (LoRA Guilds)** — a registry for tokenized LoRA models and other agent capabilities. Each capability is registered with an on-chain record pointing to IPFS metadata (model card, weights CID, benchmark results). Creators bond protocol tokens at registration; bonds are slashable if the model is fraudulent or underperforms. Certification (peer review or off-chain verification) is recorded on-chain.

### End-to-end data flow (the MVP loop)

The following steps illustrate the single loop the MVP ships — from an agent doing verifiable work, to that work becoming a discoverable reputation signal:

1. **Capability registration (LoRA Guilds).** A capability creator registers a LoRA model with the Capability Registry contract: `registerCapability(capabilityType="LoRA", metadataCID, bond)`. The metadata CID points to an IPFS document containing the model card, weights, and a baseline benchmark. The creator's bond is locked.
2. **Verification (off-chain).** A TAOP Verification Service (or a peer validator) runs the model against the published benchmark, optionally using the creator's own inputs, and posts a verification result. If the model passes, the capability is marked `certified` on-chain via `certifyCapability`. If the model is fraudulent or materially underperforms, the bond is slashed via `slashCapability`.
3. **Task execution (off-chain, by Agent A).** An agent (Agent A) that owns or has loaded a registered capability performs a verifiable off-chain task — e.g., summarization of a known corpus, classification of a labeled set, or any task whose output can be checked. The task result and evidence are pinned to IPFS.
4. **Reputation attestation (on-chain, on Base).** A Reputation Oracle validator submits a `ScoreSubmission` to the RON contract: `submitScores([{ agent: AgentA, taskId, rating, evidenceCID }])`. Aggregation runs (`aggregate(AgentA)`) and writes a new on-chain credit score for Agent A. The attestation is now on Base, publicly readable, and linkable to the capability that produced it.
5. **Discovery (by Agent B).** A second agent (Agent B) queries the Capability Registry + RON — via REST/GraphQL/SDK — for agents that hold a given capability proof **and** have a credit score above a threshold. Agent B receives a ranked list: `(AgentA, capabilityId, certified=true, score=…, evidenceCID=…)`. Agent B can verify the capability proof and the reputation attestation independently on-chain, with no trust in any platform.

This loop is what the demo page (Part 5) renders end-to-end.

### Design principles (MVP-scoped)

- **Protocol neutrality.** The Credit Bureau and Capability Registry are separate contracts with open APIs. Any agent framework (LangChain, AutoGPT, LlamaIndex) can read reputation and capability data without migrating logic. No lock-in.
- **Single-chain MVP on Base.** The MVP deploys on Base only. This keeps fees low, finality fast, and the surface area small. Cross-chain is explicitly deferred (see Part 6).
- **Trustless economic bonding.** Capability creators bond tokens at registration; bonds are slashed when models are fraudulent or underperform. Skin in the game, on-chain enforceable.
- **On-chain attestations as the source of truth.** Reputation is not a database row a platform can edit. It is a Base transaction. Any consumer can re-derive the score from events.
- **Modular orchestration.** The registry, the credit bureau, and the off-chain verification service are independent modules. The verification service can be swapped (different prover, different benchmark) without touching the contracts.
- **Interoperability via familiar interfaces.** EVM + ERC-721/ERC-1155 + EIP-4361 (SIWE) + EIP-712 signatures. REST + GraphQL + gRPC + WebSocket. TypeScript and Python SDKs. OpenAPI/Swagger docs.

---

## Part 3 — Technology stack

The MVP stack is intentionally small: one L2, one storage layer, one indexing layer, one frontend framework. Technologies required only for the deferred features (cross-chain bridges, DAO arbitration, The Graph, Kafka, Kubernetes) are listed in Part 6, not here.

| Layer / Component | Recommended technology | Rationale |
|---|---|---|
| **Blockchain layer** | Base (single L2) | Low fees, fast finality, high throughput for reputation writes. EVM-native, so existing Solidity tooling and EIP-712/SIWE patterns work unchanged. |
| **Smart-contract language** | Solidity (primary); Vyper (optional for the slashing paths in RON) | Solidity has the tooling and audit ecosystem. Vyper's simplicity suits the slashing math in the Credit Bureau. |
| **AI / agent frameworks** | LangChain, LlamaIndex, or AutoGPT (Python) for orchestration; PEFT / Hugging Face for LoRA fine-tuning; PyTorch for training; FastAPI or gRPC for off-chain API endpoints | LangChain/AutoGPT provide modular building blocks for LLM-powered agents. PEFT + PyTorch support LoRA training and inference. FastAPI/gRPC give async, high-performance communication between agents and the verification/indexing services. |
| **Storage** | IPFS for LoRA weights, model metadata, and verification evidence | Decentralized, content-addressed storage ensures model availability and tamper-resistance. The MVP needs one storage layer; Filecoin/Arweave are deferred (Part 6). |
| **Identity & naming** | EIP-4361 (Sign-In with Ethereum) for agent auth; EAS (Ethereum Attestation Service) for capability certifications and reputation attestations | SIWE gives decentralized agent auth. EAS gives a standard, schema'd attestation format on Base — so capability certifications and score updates are attestations any consumer can render. |
| **Messaging / streaming** | NATS or Temporal for async event handling between the verification service, the oracle, and the SDKs | Lightweight, reliable async eventing for the MVP's single loop. Libp2p/Kafka are deferred. |
| **Verification** | Custom TAOP verification subnet (off-chain prover that re-runs LoRA benchmarks and posts on-chain attestations) | The MVP needs only capability verification — re-run the model against the published benchmark, post the result. Chainlink Functions / UMA / DAO arbitration are for the future dispute-heavy A2A flow and are deferred. |
| **Indexing** | Postgres for off-chain indexes of on-chain events (tasks, capabilities, scores) | A single Postgres instance is enough for the MVP's query load and lets the REST/GraphQL layer serve the SDK and demo page. The Graph/TimescaleDB are deferred. |
| **Frontend** | React + TypeScript; TailwindCSS for UI | Renders the developer dashboard and the one demo page (Part 5). |
| **DevOps / testing** | Hardhat and Foundry for contract development and testing; Grafana/Prometheus for monitoring | Hardhat + Foundry give local EVM simulation and security testing. The MVP runs on a single host; Kubernetes/Nomad are deferred. |

### Integration for AI developers (the SDK/API layer)

The MVP exposes multiple interfaces so existing AI developers can adopt TAOP without rewriting their agents:

- **REST API + GraphQL** for simple programmatic access: register a capability, query an agent's credit score, list capabilities by type, fetch certification attestations.
- **Typed SDKs in TypeScript and Python.** The SDKs wrap contract calls, handle SIWE auth and EIP-712 signing, and integrate with LangChain/AutoGPT as first-class components (`TAOPReputationReader`, `TAOPCapabilityRegistry`).
- **OpenAPI/Swagger docs** describing every endpoint and data model.
- **gRPC / WebSocket API** for real-time streaming of reputation updates, capability certifications, and slashing events — so agents can react to score changes the moment they land on Base.

---

## Part 4 — Smart-contract & backend specifications

The MVP's on-chain layer is **two contracts**: the Reputation Oracle Network (Credit Bureau) and the Capability Registry (LoRA Guilds). The Task Escrow Contract from the original TAOP design is deferred (Part 6) because the MVP has no A2A hiring flow. Names below are illustrative; gas optimizations and a full security audit are assumed before mainnet.

### 4.1 Reputation Oracle Network (RON) Contract

**Purpose:** manage validator staking, score submissions, aggregation, and slashing. Validators stake tokens to participate and are slashable for dishonest behavior.

```solidity
struct ScoreSubmission {
    address agent;          // address of agent being rated
    uint64 taskId;          // corresponding task/verification ID
    uint8 rating;           // rating (0–255) mapped to e.g. 1–5 stars
    bytes evidenceCID;      // IPFS CID with evidence (logs, results)
}

struct AgentScore {
    uint128 totalScore;     // accumulated weighted ratings
    uint64 count;           // number of ratings
    uint64 lastUpdated;     // timestamp of last update
}

event ValidatorStaked(address validator, uint256 amount);
event ScoreSubmitted(address validator, address agent, uint8 rating);
event ScoreAggregated(address agent, uint64 newScore);
event ValidatorSlashed(address validator, uint256 amount);

function stake(uint256 amount) external returns (bool);
function submitScores(ScoreSubmission[] calldata submissions) external returns (bool);
function aggregate(address agent) external returns (uint64 aggregatedScore);
function slash(address validator, uint256 penalty) external returns (bool);
function getAgentScore(address agent) external view returns (AgentScore memory);
```

Validators call `submitScores` to post ratings. `aggregate` averages weighted scores and writes the new credit score on-chain. Misbehaving validators can be slashed by governance or via a challenge period. Credit scores are readable off-chain via view calls or the indexing service. The contract must include Sybil-resistance (minimum stake) and rating-weighting by validator reputation.

### 4.2 Capability Registry Contract

**Purpose:** register LoRA models and other capabilities, manage creator bonds and metadata, and slash bonds when models underperform.

```solidity
struct Capability {
    address creator;
    uint256 bond;           // tokens locked by creator
    bytes32 capabilityType; // e.g., "LoRA", "APIConnector"
    string metadataCID;     // IPFS CID pointing to model metadata
    bool certified;         // certification status
    bool slashed;
}

event CapabilityRegistered(uint256 capabilityId, address creator);
event CapabilityCertified(uint256 capabilityId, address certifier);
event CapabilitySlashed(uint256 capabilityId, uint256 penalty);

function registerCapability(bytes32 capabilityType, string calldata metadataCID, uint256 bond)
    external returns (uint256 capabilityId);
function certifyCapability(uint256 capabilityId) external returns (bool);
function slashCapability(uint256 capabilityId, uint256 penalty) external returns (bool);
function getCapability(uint256 capabilityId) external view returns (Capability memory);
```

Creators lock a bond at registration. Certification is performed by recognized validators (reputation oracle nodes) or via off-chain peer review that posts an EAS attestation. If a capability is fraudulent or low-quality, the bond is slashed. A mapping from capability IDs to metadata CIDs lets off-chain consumers retrieve model weights via IPFS. Capabilities are queryable by type or creator through the indexing service.

### 4.3 Backend services (off-chain, MVP-scoped)

The MVP needs three off-chain services:

- **Reputation Oracle Service** — runs score aggregation, handles `submitScores` batching, and enforces slashing logic; interacts with the RON contract.
- **Verification Service** — executes LoRA benchmarks, compares results against the published metadata, and posts capability certifications (or slash requests) on-chain. This is the MVP's substitute for a full dispute-resolution layer.
- **Indexing Service** — indexes on-chain events (registrations, certifications, score updates, slashes) into Postgres and exposes them via REST/GraphQL for the SDKs and the demo page.

The **Dispute Resolution Service** and the **Notification Service** from the original TRD are deferred to Part 6 — disputes need the Task Escrow Contract (A2A), and notifications can be replaced by the gRPC/WebSocket stream for the MVP.

All three MVP services are packaged as small services and deployed on a single host. They interact with the contracts via wallets and EIP-712 signatures. All services are open-source to preserve protocol neutrality and invite community auditing.

---

## Part 5 — Demo page specification

The MVP ships **one beautiful demo page** that proves the whole loop in a single screen. It is the artifact the rest of the MVP exists to support.

### User story

> Agent A is a summarization agent that has registered a LoRA summarization capability in the LoRA Guilds registry and bonded tokens to it. Agent A runs a verifiable summarization task on a known corpus. A TAOP Reputation Oracle validator observes the task, posts a `ScoreSubmission` to the RON contract on Base, and Agent A's on-chain credit score updates. Agent B — a research agent — needs a summarization capability it can trust. Agent B queries the Capability Registry + RON, finds Agent A, and verifies both the capability proof (certified LoRA, bond intact) and the reputation attestation (on-chain score, linkable to evidence) — with no platform in the middle.

### Screen layout (single page, four panels)

```
┌─────────────────────────────────────────────────────────────┐
│  HERO                                                        │
│  "Trustless reputation for AI agents. On Base."              │
│  Subhead: capability proof + on-chain score = no platform.   │
│  [ Run the live demo ]  [ Read the contracts ]               │
├──────────────────────────┬──────────────────────────────────┤
│  PANEL A — Agent A        │  PANEL B — Watch on Base         │
│  "Run Agent A's task"     │  "Reputation attestation"        │
│  • capability card        │  • tx hash (live)                │
│  • Run button             │  • EAS attestation render        │
│  • task status            │  • new score, before → after     │
├──────────────────────────┴──────────────────────────────────┤
│  PANEL C — Agent B discovers Agent A                         │
│  "Search by capability proof"                                │
│  • capability query input                                    │
│  • ranked results: Agent A row with proof chips              │
│  • on-chain verification panel (expandable)                  │
├─────────────────────────────────────────────────────────────┤
│  FOOTER  •  contracts on Base  •  SDK  •  docs  •  GitHub    │
└─────────────────────────────────────────────────────────────┘
```

### Panel-by-panel spec

#### Hero

- **Headline:** "Trustless reputation for AI agents. On Base."
- **Subhead:** "Capability proof + on-chain score. No platform in the middle."
- **CTAs:** `[ Run the live demo ]` (scrolls to Panel A and auto-runs), `[ Read the contracts ]` (links to Basescan).
- **Background:** subtle animated grid of agent nodes; one node pulses when a real attestation lands.

#### Panel A — Agent A runs the task

- **Capability card:** shows Agent A's registered LoRA — `capabilityId`, `capabilityType=LoRA`, `metadataCID` (link to IPFS), `certified=true`, `bond` (in protocol tokens, with a small lock icon), `creator=AgentA`.
- **Run button:** `[ Run Agent A's summarization task ]`.
- **Contract calls on click:**
  - Off-chain: the demo backend invokes Agent A's loaded LoRA on a fixed corpus and pins the output + evidence to IPFS.
  - On-chain (write): a TAOP Reputation Oracle validator submits `RON.submitScores([{ agent: AgentA, taskId, rating, evidenceCID }])`, then `RON.aggregate(AgentA)`.
- **Status states (copy):**
  - Idle: "Agent A is ready. Capability proof verified."
  - Running: "Agent A is summarizing the corpus…"
  - Submitted: "Reputation oracle submitting score to Base…"
  - Done: "Attestation mined. Agent A's score updated." → bridges to Panel B.

#### Panel B — Watch on Base

- **Tx hash:** live, hyperlinked to Basescan, appears the moment the `submitScores` tx is broadcast; turns green on confirmation.
- **EAS attestation render:** the attestation schema (rating, taskId, evidenceCID, validator) rendered as a clean card, with each field clickable to verify on-chain.
- **Score before → after:** `AgentA.score` read from `RON.getAgentScore(AgentA)` before and after the tx, displayed as `4.6 → 4.8` with a small upward delta chip.
- **Contract call (read):** `RON.getAgentScore(AgentA)` polled via WebSocket until the `ScoreAggregated` event lands.

#### Panel C — Agent B discovers Agent A

- **Query input:** prefilled with `capabilityType=LoRA` + a minimum score slider (default 4.0).
- **Contract calls (read):**
  - `CapabilityRegistry.getCapability(capabilityId)` for each candidate.
  - `RON.getAgentScore(candidate)` for each candidate.
  - Filter to `certified=true && !slashed && score >= threshold`, sort by score descending.
- **Results row for Agent A:** shows Agent A's address (truncated, copyable), capability chip "LoRA · certified", bond chip "bonded 250 ◆", score chip "★ 4.8", evidence chip "view evidence" (opens the IPFS CID from the attestation).
- **On-chain verification panel (expandable):** when the user clicks Agent A's row, an inline panel shows the raw call + response for `getCapability` and `getAgentScore`, plus the Basescan link to the `ScoreAggregated` tx. The copy emphasizes: "You just verified this yourself. No platform vouched for Agent A."

#### Footer

- Links: contracts on Basescan, TypeScript SDK, Python SDK, OpenAPI docs, GitHub.
- Tagline: "TAOP — the invisible reputation layer for the agent economy."

### Non-functional requirements for the demo

- **Single screen** on desktop (≥1280px); stacks vertically on mobile.
- **Real transactions** on Base (testnet for dev, mainnet for the shipped demo) — no mocks. The demo backend funds the oracle validator wallet and Agent A from a single hot wallet with a capped daily spend.
- **Latency budget:** from clicking "Run" to the score chip updating in Panel C, ≤ 30 s end-to-end (L2 finality + indexing).
- **Accessibility:** keyboard-navigable, AA contrast, semantic headings.
- **i18n:** English only for the MVP.

---

## Part 6 — Out of MVP / Future Work

The following items are part of the broader TAOP vision but are **deliberately out of scope for this MVP**. Each is listed with a one-line rationale so investors and contributors can see the full roadmap without confusing it with what ships first.

| Deferred item | One-line rationale |
|---|---|
| **A2A Hiring Exchange (Task Escrow Contract + bid/select/release UX)** | The marketplace is the biggest surface area and depends on the reputation layer proving itself first. The MVP's demo loop is the prerequisite proof. |
| **Cross-chain interoperability** | Nice-to-have that adds bridge risk, audit cost, and months of complexity. Base-only MVP keeps the trust model simple. |
| **Arbitrator desk / Dispute Resolution Service** | Disputes only make sense once there is an escrow to dispute. Deferred with the A2A Hiring Exchange. |
| **Plugin store** | A distribution channel for capabilities — valuable, but only after the capability registry has real adoption. |
| **Analytics dashboards** | Useful for protocol health, not for proving the trustless loop. The MVP ships a single demo page instead. |
| **Filecoin / Arweave (cold storage, immutable audit logs)** | IPFS is enough for the MVP's weights and evidence. Cold-storage tiers come when usage justifies them. |
| **The Graph / TimescaleDB (decentralized indexing + time-series analytics)** | A Postgres indexer covers the MVP's query load. Decentralized indexing matters at scale, not at MVP. |
| **Kafka / Libp2p (high-throughput messaging, peer-to-peer agent comms)** | NATS/Temporal handle the MVP's single loop. Heavyweight messaging is for the A2A-era traffic. |
| **UMA optimistic oracle / DAO arbitration** | Subjective dispute resolution is for the A2A Hiring Exchange. The MVP uses objective LoRA benchmark verification only. |
| **Kubernetes / Nomad deployment** | The MVP runs on a single host. Orchestrated deployment comes when the service count grows. |
| **Optimism / Arbitrum One as alternative L2s** | Base-only for the MVP. Multi-L2 deployment is a scaling decision, not a launch decision. |
| **Vyper rewrites of non-slashing contracts** | Vyper is optional for the slashing paths in RON. The rest of the MVP is fine in Solidity. |

---

## Conclusion

The TAOP MVP is the **invisible reputation layer for the agent economy**: a Credit Bureau that writes trustless on-chain attestations, paired with LoRA Guilds that bond and certify agent capabilities. It deliberately defers the A2A Hiring Exchange, cross-chain bridges, arbitration, plugin stores, and dashboards so that the hardest and most novel part — **making agent reputation and capability trustless, on-chain, and consumable by any framework** — ships first and proves itself on a single beautiful demo page.

Senior blockchain and backend developers can break this TRD into actionable work: implement the RON and Capability Registry contracts, build the verification and indexing services, ship the TypeScript and Python SDKs, and build the single demo page described in Part 5. With a clear two-pillar blueprint, a trimmed stack, and a crisp demo target, the MVP can land on Base and give the agent economy its first neutral, portable trust layer.

---

## Appendix — MVP v0.1 Implementation Note

The shipped MVP (v0.1) implements a **self-attest + public challenge** reputation model rather than the validator-ratings model described in Part 4.1. This section documents what changed and why, so the TRD and the code stay honest with each other.

### What shipped (v0.1)

| Component | TRD Part 4.1 spec | v0.1 implementation | Why |
|---|---|---|---|
| **Reputation model** | Validator staking + `submitScores` + `aggregate` (weighted average) | `attestCompletion` (self-attest) + `challengeCompletion` (public challenge with ETH bond) + `resolveChallenge` (owner-resolved) | A validator set with zero users, zero token value, and zero fees is borrowed trouble. Self-attest + challenge is trustless by construction: no trusted party needed in the default case. |
| **Score formula** | Stake-weighted average of validator ratings (0–255) | `completions − disputes` (two integers) | "Aggregation runs" without a concrete formula means you haven't decided. `completions − disputes` is decidable, explainable, and ships now. |
| **Bonding currency** | Protocol tokens (TaopToken) | ETH on Base | A token with zero market cap gives zero deterrent. ETH has real value, `payable`/`msg.value` is simpler than ERC20 approvals, and no central party can freeze it. |
| **Challenge resolution** | Not in the original TRD (disputes were deferred to A2A escrow) | Owner-only `resolveChallenge(upheld)` | The one trusted role that remains. Upgradeable to DAO/optimistic in v2. The trustless claim: "anyone can challenge, resolver is upgradeable." |

### What's dormant (kept in-contract for v2)

The validator-ratings + protocol-token code was **removed** from v1 to reduce
audit surface. Removing it shrank the contracts by ~40% and eliminated the
non-functional `stakeToken` dependency (deployed as `address(0)`, it could
never run). All 13 validator-path tests were deleted; 22 self-attest + ETH-bond
tests remain.

A future v2 that adds validator ratings would be an **ETH-native rewrite**, not
a reactivation of the old token-based code. The v2 design (stake → submit
ratings → aggregate → governance slash) is documented in Part 4.1 above and
remains the roadmap, but it is not in v1 bytecode. This keeps v1 honest: it
ships what it tests, and tests what it ships.

### The v0.1 demo loop (what the demo page shows)

1. **Register** — Agent A registers a LoRA capability with a 0.01 ETH bond via `registerCapabilityEth`. Owner certifies it via `certifyCapability`.
2. **Self-attest** — Agent A calls `attestCompletion(taskType, resultCID)`. A unique `completionId` is minted on-chain. `completionCount[agentA]` increments.
3. **Challenge (optional)** — Anyone calls `challengeCompletion(completionId, evidenceCID)` with a 0.01 ETH bond. Owner resolves via `resolveChallenge(completionId, upheld)`. Upheld → `disputeCount[agentA]++`, challenger refunded. Rejected → challenger forfeits bond.
4. **Discover** — Agent B queries `/api/discover` → gets ranked list of certified agents with `score = completions − disputes`, capability proof, and ETH bond status. No platform in the middle.

### Contract calls wired to the demo

| Panel | Contract call | |
|---|---|---|
| Panel A (run) | `RON.attestCompletion(keccak256("LoRA"), resultCID)` | called by Agent A's signer |
| Panel A (challenge) | `RON.challengeCompletion(id, evidenceCID, {value: 0.01 ETH})` + `RON.resolveChallenge(id, true)` | called by backend (simulated) |
| Panel B (watch) | `RON.getCompletion(id)` + `RON.getSelfAttestScore(agentA)` | read-only |
| Panel C (discover) | `CapabilityRegistry.getCapability(id)` + `RON.getSelfAttestScore(creator)` | read-only, filtered by `certified && !slashed && score >= minScore` |
