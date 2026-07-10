# TAOP: Trustless Agent Orchestration Protocol

## Technical Whitepaper v0.1

### On-Chain Credit Bureau & Capability Registry for AI Agents

> **Author:** TAOP Protocol Contributors
> **Version:** 0.1
> **Date:** July 2026
> **Network:** Base Sepolia (chainId 84532) — live; Base mainnet pending audit
> **Repository:** [github.com/TAOP-protocol](https://github.com/TAOP-protocol) *(coming soon)*
>
> **Abstract:** We present TAOP, a decentralized protocol for AI agent reputation management and capability verification. TAOP combines an on-chain reputation oracle (the "Credit Bureau") with an NFT-based capability registry ("LoRA Guilds") to enable trust-minimized agent-to-agent discovery and verification. **v0.1 ships a self-attest + public-challenge reputation model secured by ETH bonds** — no protocol token, no validator set, no trusted party in the default case. The protocol is framework-agnostic, deployed on Base for low transaction costs, and accessible via REST and Python/TypeScript SDKs (an MCP server is planned). This whitepaper documents what v0.1 actually ships, followed by the aspirational v2 design (validator staking + protocol token) that is explicitly **not** in the deployed bytecode.
>
> **Honesty note:** Earlier drafts of this document described a validator-staking + protocol-token model. That model was **removed** from the v0.1 contracts to reduce audit surface and ship a trustless-by-construction loop. It is preserved below, clearly labeled, as the documented v2 roadmap. The deployed contracts ship what this document describes as v0.1.

---

## Contents

1. [Introduction & Vision](#1-introduction--vision)
2. [Problem Analysis](#2-problem-analysis)
3. [System Architecture](#3-system-architecture)
4. [Smart Contract Specifications (v0.1 — shipped)](#4-smart-contract-specifications-v01--shipped)
   - 4.1 ReputationOracleNetwork (Credit Bureau)
   - 4.2 CapabilityRegistry (LoRA Guilds)
   - 4.3 Aspirational v2: Validator Staking + Protocol Token (not deployeded)
5. [Protocol Flows (v0.1 — shipped)](#5-protocol-flows-v01--shipped)
6. [Cryptoeconomics (v0.1 ETH-only) & v2 Tokenomics (aspirational)](#6-cryptoeconomics)
7. [Security Model](#7-security-model)
8. [SDK & Developer Surface](#8-sdk--developer-surface)
9. [MCP Server & AI Integration (planned)](#9-mcp-server--ai-integration-planned)
10. [Governance & Decentralization Roadmap](#10-governance--decentralization-roadmap)
11. [Discussion & Limitations](#11-discussion--limitations)
12. [Competitive Analysis](#12-competitive-analysis)
13. [Roadmap & Milestones](#13-roadmap--milestones)
14. [Appendices](#14-appendices)

---

## 1. Introduction & Vision

### 1.1 The Agent Economy

We are witnessing the emergence of a new digital economy: autonomous AI agents that discover, negotiate, hire, and pay each other to execute tasks. The infrastructure for this economy is being built today — agent orchestration frameworks (CrewAI, LangGraph, ElizaOS, AutoGPT), communication protocols (Google Agent2Agent, MCP), and payment rails (crypto rails for microtransactions).

**But one critical piece is missing: trust.**

An agent that claims "I can summarize 10,000 PDFs using a fine-tuned LoRA adapter" has no way to prove this claim. An agent that needs summarization work done has no way to verify a service provider's past performance. This trust gap is the single largest friction point in the autonomous agent economy.

### 1.2 The TAOP Thesis

**Reputation is the currency of the agent economy.**

Just as the financial system relies on credit bureaus (Experian, Equifax) to score borrowing risk, the agent economy needs a decentralized credit bureau to score agent reliability. And just as professional certifications verify skills, the agent economy needs an on-chain capability registry where agents cryptographically commit to their claimed abilities.

TAOP provides both — in a single, open, framework-agnostic protocol.

### 1.3 Design Principles

1. **Trust-minimized:** No central authority controls agent reputations in the default case. Economic incentives (ETH bonds) align honest behavior.
2. **Composable:** Capabilities are ERC-721 NFTs — they can be traded, auctioned, used as collateral, or integrated into any ERC-721 compatible protocol.
3. **Framework-agnostic:** TAOP does not require agents to run on a specific stack. Any agent, from any framework, can register capabilities and self-attest completions.
4. **Ship the trustless loop first:** v0.1 deliberately defers validators, tokens, and fees. Self-attest + public challenge is trustless *by construction* — no trusted party is needed in the default case.
5. **Progressive decentralization:** The protocol starts with a single certifier and an owner-resolved dispute path, gains decentralization over time via timelock → multisig → DAO, and may introduce a validator set in v2.

---

## 2. Problem Analysis

### 2.1 The Trust Gap in Agent Interactions

Consider a typical agent-to-agent interaction:

```
Agent A (orchestrator) needs: "Summarize these 1000 documents"
Agent B (worker) claims: "I can do this — I use a fine-tuned LoRA model"
```

**Without a trust system, Agent A faces:**

- **Adverse selection:** Bad agents are indistinguishable from good ones
- **Moral hazard:** Agent B has no incentive to perform well (no reputation to lose)
- **Verification cost:** Agent A must manually verify every claim
- **Cold-start problem:** New agents cannot prove their reliability

**The existing solutions are inadequate:**

| Approach | Weakness |
|----------|----------|
| Platform-based reputation (Relevance AI, Fixie) | Vendor lock-in, centralized data control, not portable |
| Community reputation (GitHub stars, forum) | Easily gamed, no economic consequence for fraud |
| Verifiable credentials (DIDs, VCs) | Prove identity, not quality. Knowing who someone is ≠ knowing if they're good |
| Reputation tokens (soulbound) | No economic security — nothing at stake for dishonest ratings |

### 2.2 Why On-Chain?

On-chain reputation solves three problems that off-chain systems cannot:

1. **Verifiability without permission:** Any agent can verify any score on a block explorer. No API key, no platform subscription, no trust in a third party.

2. **Economic finality:** ETH bonds represent real value. When a creator registers a fake capability, their bond can be slashed. When someone challenges a fraudulent self-attestation, they post a 0.01 ETH bond that they forfeit if the challenge is rejected. This economic commitment is impossible to replicate off-chain.

3. **Composability:** On-chain reputation data composes with NFTs (capability marketplaces), DAOs (governance weight), and identity protocols (EAS attestations).

### 2.3 The Chicken-and-Egg Problem

Any reputation system faces a cold-start problem: without agents, there are no scores; without scores, there are no agents using the system.

TAOP addresses this through:

- **Self-attestation:** Any agent can log its own completions via `attestCompletion`. No prior reputation, no validator, and no permission required to start building a track record.
- **Public challenge as the truth mechanism:** Anyone can post an ETH bond to flag a fraudulent completion. The reputation is only as good as the open, economically-secured challenge process.
- **Discovery by type + minimum score:** Even with few agents, the API returns meaningful results — type-filtering prevents "needle in haystack" discovery.

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI AGENT LAYER                            │
│   Claude   │   Codex   │   ElizaOS   │   CrewAI   │   ...   │
│    │           │            │             │                  │
│    └───────────┴────────────┴─────────────┘                  │
│                        │ REST / Python SDK                   │
├────────────────────────┼─────────────────────────────────────┤
│                ▼        ▼                                     │
│          ┌─────────────────────────┐                          │
│          │   TAOP Backend           │      DISCOVERY LAYER     │
│          │   REST API + Demo + IPFS │   (Express.js)          │
│          └──────────┬──────────────┘                          │
│                     │ ethers.js v6                            │
├─────────────────────┼───────────────────────────────────────┤
│         ▼           ▼                                         │
│  ┌──────────────┐ ┌──────────────────┐                       │
│  │Reputation    │ │Capability        │   CONTRACT LAYER      │
│  │Oracle Network│ │Registry          │   (v0.1, ETH-only)    │
│  │(self-attest +│ │(ERC-721          │                       │
│  │ challenge)   │ │ Enumerable)      │                       │
│  └──────┬───────┘ └────────┬─────────┘                       │
│         │                  │                                  │
│    ┌────┴────┐        ┌────┴────┐                             │
│    │  IPFS   │        │  Base   │   EXTERNAL                 │
│    │Evidence │        │ Sepolia │                             │
│    └─────────┘        └─────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

> **Note:** v0.1 has **no TaopToken contract**. The earlier 3-contract diagram (with an ERC-20 box) described the aspirational v2 design. v0.1 is ETH-only.

### 3.2 Layer Responsibilities

**Contract Layer:** Two Solidity smart contracts deployed on Base Sepolia. Handle state transitions, ETH bonding, challenge resolution, and NFT minting. No protocol token.

**Discovery Layer:** A REST API (Express.js) that reads on-chain state, pins evidence to IPFS, orchestrates the demo loop, and serves OpenAPI/Swagger docs. The `/discover` endpoint returns certified agents ranked by score.

**Agent Layer:** Any AI agent framework can integrate via:
1. Direct contract calls (ethers.js v6 or web3.py)
2. REST API calls
3. MCP server tools (planned, for Claude/Codex agents)

### 3.3 Contract Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| OpenZeppelin ERC-721 | ^5.6.1 | Capability NFT standard (CapabilityRegistry) |
| OpenZeppelin ERC-721Enumerable | ^5.6.1 | Token enumeration for discovery |
| OpenZeppelin Ownable | ^5.6.1 | Access control (owner resolves challenges, withdraws pools) |
| OpenZeppelin ReentrancyGuard | ^5.6.1 | Reentrancy protection on all mutating functions |
| Solidity | 0.8.28 | Compiler with built-in overflow checks |

> **Note:** OpenZeppelin ERC-20 is **not** a dependency in v0.1 — there is no protocol token. It would be reintroduced in the aspirational v2 design (§4.3).

### 3.4 Storage Strategy

**On-chain:** Minimal — only essential state (completion records, challenge records, completion/dispute counts, capability structs, bond amounts) is stored on-chain. IPFS CIDs reference evidence and metadata.

**Off-chain:** Evidence files, capability model files, and detailed logs are stored on IPFS. The on-chain CID provides a content-addressed reference. The backend pins evidence to IPFS during the demo loop.

---

## 4. Smart Contract Specifications (v0.1 — shipped)

> **This section documents the contracts that are actually deployed on Base Sepolia.** The two contracts below are the complete v0.1 contract layer. There is no third contract (no token) in v0.1.

### 4.1 ReputationOracleNetwork (Credit Bureau)

**File:** `contracts/ReputationOracleNetwork.sol`
**Network:** Base Sepolia (chainId 84532)
**Address:** `0x9bd022B6f41360f774fDD93844FA319Ed5f58e36`
**Lines:** 145
**Inheritance:** `ReentrancyGuard`, `Ownable`

#### 4.1.1 Purpose

The Credit Bureau contract is the core reputation primitive. **Agents self-attest completions via `attestCompletion`. Anyone can post a 0.01 ETH bond to flag fraud via `challengeCompletion`. The owner resolves disputes via `resolveChallenge`.** The public score is `completions − disputes`. No trusted validator set, no protocol token — the model is trustless by construction in the default case.

#### 4.1.2 State Variables

```solidity
uint256 public constant CHALLENGE_BOND = 0.01 ether;  // ETH bond to challenge

mapping(uint256 => Completion) public completions;    // completionId => Completion
mapping(uint256 => Challenge) public challenges;       // completionId => Challenge
uint256 public nextCompletionId;                        // first id is 1
mapping(address => uint64) public completionCount;     // agent => # self-attested
mapping(address => uint64) public disputeCount;        // agent => # upheld challenges
uint256 public slashedEthPool;                          // forfeited bonds, owner-withdrawable
```

#### 4.1.3 Structs

```solidity
struct Completion {
    address agent;
    bytes32 taskType;        // e.g., keccak256("LoRA")
    string resultCID;        // IPFS CID of the task result/evidence
    uint64 timestamp;
    bool challenged;
    bool disputed;           // true if a challenge was upheld
}

struct Challenge {
    address challenger;
    string evidenceCID;      // IPFS CID of challenge evidence
    uint64 timestamp;
    bool resolved;
}
```

#### 4.1.4 Functions

##### `attestCompletion(bytes32 taskType, string calldata resultCID) external nonReentrant → uint256 completionId`

An agent self-attests a completed task. Mints a unique `completionId` (incrementing from 1), stores the `Completion` record, increments `completionCount[msg.sender]`, and emits `SelfAttested`.

**Postconditions:**
- `nextCompletionId` incremented; new `Completion` stored
- `completionCount[msg.sender]` incremented
- `SelfAttested` event emitted
- Returns the new `completionId`

Each attestation gets a unique ID so each can be challenged independently.

##### `challengeCompletion(uint256 completionId, string calldata evidenceCID) external payable nonReentrant`

Anyone can challenge a completion by posting exactly `CHALLENGE_BOND` (0.01 ETH) in `msg.value`.

**Preconditions:**
- Completion exists (`agent != address(0)`)
- Not already challenged
- `msg.value == CHALLENGE_BOND` (else reverts `WrongChallengeBond`)

**Postconditions:**
- `completions[completionId].challenged = true`
- `challenges[completionId]` populated with challenger + evidence
- `ChallengeSubmitted` event emitted

##### `resolveChallenge(uint256 completionId, bool upheld) external onlyOwner nonReentrant`

Owner resolves a pending challenge. This is the **one trusted role** that remains in v0.1, upgradeable to DAO/optimistic in v2.

- `upheld = true` → the completion was fraudulent: `disputed = true`, `disputeCount[agent]++`, and the challenger's bond is **refunded**.
- `upheld = false` → the challenge was rejected: the challenger's bond is **forfeited** to `slashedEthPool`.

**Preconditions:**
- Completion exists
- Challenged and not yet resolved (else reverts `ChallengeNotPending`)

**Postconditions:**
- `challenges[completionId].resolved = true`
- ETH moved (refund or pool) and `ChallengeResolved` emitted

##### `withdrawEthPool(address payable to, uint256 amount) external onlyOwner nonReentrant`

Owner withdraws forfeited challenger bonds from `slashedEthPool`.

##### `getSelfAttestScore(address agent) external view → (uint64 completionCount_, uint64 disputeCount_, uint64 score)`

Returns the agent's v1 score components. **Score = `completions − disputes`** (saturating at 0).

##### `getCompletion(uint256 completionId) external view → Completion`

Returns a completion record (reverts `NoSuchCompletion` if absent).

#### 4.1.5 Events

| Event | Parameters | Purpose |
|-------|------------|---------|
| `SelfAttested` | `uint256 completionId, address agent, bytes32 taskType` | Agent self-attested a completion |
| `ChallengeSubmitted` | `uint256 completionId, address challenger` | A completion was challenged |
| `ChallengeResolved` | `uint256 completionId, bool upheld` | Owner resolved a challenge |
| `EthPoolWithdrawn` | `address to, uint256 amount` | Owner withdrew forfeited bonds |

#### 4.1.6 v0.1 → v2 Upgrade Path (not in v0.1 bytecode)

The validator-ratings + protocol-token model (stake → submit ratings → aggregate → governance slash) is the documented v2 aspiration. See **§4.3**. It is explicitly **not** in the v0.1 bytecode — the validator-path code was removed to reduce audit surface. A v2 that adds validators would be an **ETH-native rewrite**, not a reactivation of token-based code.

---

### 4.2 CapabilityRegistry (LoRA Guilds)

**File:** `contracts/CapabilityRegistry.sol`
**Network:** Base Sepolia (chainId 84532)
**Address:** `0x93415ac1cB1c2EDDC47033FFE421d85EaE674Acb`
**Lines:** 134
**Inheritance:** `ERC721Enumerable`, `Ownable`, `ReentrancyGuard`

#### 4.2.1 Purpose

The CapabilityRegistry is an on-chain registry where agents register their claimed capabilities as ERC-721 NFTs. **Each capability is backed by a creator ETH bond (`msg.value`)** that can be slashed if the capability is fraudulent. Certification is recorded on-chain by a designated `certifier`. No protocol token in v0.1.

#### 4.2.2 Inheritance

```
ERC721Enumerable
    ├── Ownable
    └── ReentrancyGuard
CapabilityRegistry   ("TAOP Capability", "TAOP-CAP")
```

#### 4.2.3 State Variables

```solidity
address public certifier;                              // Designated capability verifier
mapping(uint256 => Capability) private _capabilities;  // tokenId => Capability
uint256 private _nextTokenId;                          // Sequential minting (starts at 1)
uint256 public slashedEthPool;                         // Slashed ETH bonds, owner-withdrawable
```

#### 4.2.4 Structs

```solidity
struct Capability {
    address creator;          // Agent who registered this capability
    uint256 bond;             // ETH locked by creator at registration (wei)
    bytes32 capabilityType;   // keccak256 of type string (e.g., "LoRA")
    string metadataCID;       // IPFS CID pointing to full metadata
    bool certified;           // Verification status
    bool slashed;             // Whether bond was slashed
}
```

#### 4.2.5 Functions

##### `registerCapabilityEth(bytes32 capabilityType, string calldata metadataCID) external payable nonReentrant → uint256 capabilityId`

Registers a new capability and mints the corresponding NFT to the caller. **The ETH bond is `msg.value`** (not an ERC-20 transfer). The `capabilityId` returned is the NFT `tokenId`.

**Preconditions:**
- `msg.value > 0` (else reverts `ZeroBond`)

**Postconditions:**
- New NFT minted with `_nextTokenId` as `tokenId`
- Capability struct stored with `certified = false`, `slashed = false`, `bond = msg.value`
- `CapabilityRegistered` event emitted
- Returns `capabilityId` (the new `tokenId`)

**Metadata CID:** Should point to a JSON file on IPFS with model card, weights CID, benchmark results, license, etc.

##### `certifyCapability(uint256 capabilityId) external nonReentrant → bool`

Marks a capability as certified. Callable by the designated `certifier` or the contract `owner`.

**Preconditions:**
- `msg.sender == certifier || msg.sender == owner()` (else reverts `NotCertifier`)
- Capability NFT exists

**Postconditions:**
- `_capabilities[capabilityId].certified = true`
- `CapabilityCertified` event emitted

##### `slashCapability(uint256 capabilityId, uint256 penalty) external nonReentrant → bool`

Reduces the creator's ETH bond. Callable by `certifier` or `owner`.

**Preconditions:**
- `msg.sender == certifier || msg.sender == owner()`
- Capability NFT exists
- `penalty <= _capabilities[capabilityId].bond` (else reverts `PenaltyExceedsBond`)

**Postconditions:**
- `bond` reduced by `penalty`; `slashed = true`
- `penalty` added to `slashedEthPool`
- `CapabilitySlashed` event emitted

##### `withdrawBond(uint256 capabilityId) external nonReentrant`

Creator reclaims their un-slashed ETH bond. Burns the NFT and returns the remaining bond to the caller.

**Preconditions:**
- Capability NFT exists
- `msg.sender == _capabilities[capabilityId].creator` (else reverts `NotCreator`)
- `bond > 0` (else reverts `BondStillSlashed`)

**Postconditions:**
- NFT burned; remaining bond sent to creator
- `BondWithdrawn` event emitted

##### `setCertifier(address c) external onlyOwner`

Updates the designated certifier address.

##### `withdrawEthPool(address payable to, uint256 amount) external onlyOwner nonReentrant`

Owner withdraws slashed ETH bonds from the protocol pool.

##### `getCapability(uint256 capabilityId) external view → Capability`

Returns the full Capability struct (reverts `NoSuchCapability` if absent).

##### `capabilityTypeOf(uint256 capabilityId) external view → bytes32`

Returns the capability type hash for a given ID.

#### 4.2.6 ERC-721Enumerable Functions (Inherited)

These are available for capability discovery:

| Function | Returns | Use Case |
|----------|---------|----------|
| `totalSupply()` | `uint256` | Count total capabilities |
| `tokenByIndex(uint256)` | `uint256` | Iterate all capability IDs |
| `ownerOf(uint256)` | `address` | Find capability owner |
| `balanceOf(address)` | `uint256` | Count capabilities of an agent |

#### 4.2.7 v0.1 → v2 Upgrade Path

| Feature | Status in v0.1 |
|---------|----------------|
| `supportedCapabilityTypes` registry | Not implemented |
| Validator vote-based certification | Not implemented (v2) |
| Capability metadata URI standard | Not implemented |

---

### 4.3 Aspirational v2: Validator Staking + Protocol Token (not deployeded)

> ⚠️ **This entire section is aspirational v2 design. None of it is in the deployed v0.1 bytecode.** It is preserved here as the documented roadmap for a future validator-ratings + protocol-token model, and as the rationale for *why* it was deferred. The earlier drafts of this whitepaper described this as the shipping model; it was removed because a validator set with zero users, zero token value, and zero fees is borrowed trouble, and the self-attest + challenge model is trustless by construction without it.

A future v2 may add:

- **`TaopToken` (ERC-20):** A protocol token with a fixed 100M supply cap, no owner-mintable function, and distribution via a token generation event. *Not deployeded in v0.1 — no `contracts/TaopToken.sol` exists.*
- **Validator staking:** Validators stake tokens to submit weighted ratings (`submitScores`), aggregated via `aggregate(agent)` into a stake-weighted score. *Not in v0.1.*
- **Planned AgentRegistry (§4.4 below):** Separating agent identity from capability ownership. *Specification only in v0.1.*

The v2 score formula would be a stake-weighted average (`Σ(rating_i × stake_i) / Σ(stake_i)`), upgradeable to an exponential moving average. The v0.1 score is simply `completions − disputes`.

A v2 would be an **ETH-native rewrite** (ETH bonds, not tokens), not a reactivation of the removed token-based code.

### 4.4 Planned: AgentRegistry (v2 specification)

**Status:** Specification only — not deployed in v0.1.

In v0.1, agents are identified by their Ethereum address. A dedicated AgentRegistry contract is planned to separate agent identity from capability ownership, allowing agents to update their operational address while maintaining a persistent identity. This is documented as a v2 feature and is not part of the deployed contracts.

---

## 5. Protocol Flows (v0.1 — shipped)

### 5.1 The Demo Loop (what the live demo shows)

```
┌────────────────────────────────────────────────────────────┐
│                   THE v0.1 LOOP (shipped)                   │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Register — Agent A registers a LoRA capability with an  │
│     ETH bond via registerCapabilityEth. Certifier marks it  │
│     certified via certifyCapability.                        │
│                                                             │
│  2. Self-attest — Agent A calls attestCompletion(taskType,  │
│     resultCID). A unique completionId is minted on-chain.   │
│     completionCount[agentA] increments.                     │
│                                                             │
│  3. Challenge (optional) — Anyone calls challengeCompletion │
│     with a 0.01 ETH bond. Owner resolves via               │
│     resolveChallenge(id, upheld). Upheld → disputeCount++,  │
│     challenger refunded. Rejected → challenger forfeits.    │
│                                                             │
│  4. Discover — Agent B queries /api/discover → gets a       │
│     ranked list of certified agents with                    │
│     score = completions − disputes, capability proof, and   │
│     ETH bond status. No platform in the middle.            │
└────────────────────────────────────────────────────────────┘
```

### 5.2 Step-by-Step: Agent B Discovers Agent A

```
Step 1: Agent A registers a capability "LoRA"
    → tx: CapabilityRegistry.registerCapabilityEth(keccak256("LoRA"), metadataCID)
      { value: 0.01 ether }
    → result: tokenId minted to Agent A, 0.01 ETH locked as bond

Step 2: Certifier verifies A's capability
    → tx: CapabilityRegistry.certifyCapability(tokenId)
    → result: capability marked certified ✓

Step 3: Agent A completes a task and self-attests
    → tx: ReputationOracleNetwork.attestCompletion(keccak256("LoRA"), resultCID)
    → result: completionId minted; completionCount[A]++

Step 4: Agent B queries discovery
    → GET /api/discover?capabilityType=LoRA
    → result: [A (score: N, bond: 0.01 ETH, cap: LoRA, certified: true)]

Step 5 (optional, if A's completion was fraudulent):
    → Anyone calls challengeCompletion(completionId, evidenceCID) { value: 0.01 ether }
    → Owner calls resolveChallenge(completionId, true)
    → result: disputeCount[A]++; score drops; challenger refunded
```

### 5.3 Score Mechanics (v0.1)

**Current formula:**
```
score = completions − disputes   (saturating at 0)
```

`completions` = total self-attested completions (`completionCount[agent]`).
`disputes` = total upheld challenges (`disputeCount[agent]`).

This is deliberately decidable and explainable: two integers, readable by anyone, no aggregation ambiguity. The economic security comes from the public challenge bond, not from a validator weight calculation.

**Planned v2 upgrade:** continuous-time score decay (reputations should not persist indefinitely) and weighted-history aggregation. These are documented v2 features, not in v0.1.

### 5.4 Dispute Flow (shipped in v0.1)

```
1. Anyone observes a fraudulent self-attested completion
2. Challenger calls challengeCompletion(completionId, evidenceCID) with 0.01 ETH bond
3. Owner reviews evidence (the one trusted role; upgradeable to DAO/optimistic in v2)
4. Owner calls resolveChallenge(completionId, upheld):
   a. upheld = true: completion marked disputed, disputeCount[agent]++,
      challenger's 0.01 ETH bond refunded
   b. upheld = false: challenger's bond forfeited to slashedEthPool
5. Agent's score = completions − disputes updates accordingly
```

> The challenge model is the trust mechanism in v0.1: anyone can challenge, the resolver is upgradeable. The trustless claim is "no platform vouches for the agent; the open, bonded challenge process is the verification."

---

## 6. Cryptoeconomics

### 6.1 v0.1 — ETH-Only, Zero Protocol Revenue (shipped)

v0.1 is **ETH-only and intentionally generates zero protocol revenue at launch.** The full fee schedule is documented in [`FEE_MODEL.md`](./FEE_MODEL.md). Summary:

| Action | Cost | Purpose |
|--------|------|---------|
| Register capability | ETH bond (creator-chosen, e.g. 0.01 ETH) | Skin in the game; slashable |
| Attest completion | Free (gas only) | No gate on building reputation |
| Challenge completion | **0.01 ETH bond** | Game-theoretic deterrent; refundable if upheld |
| Discovery query | Free | Zero friction drives adoption |
| Certification | Free | Let the certifier earn trust first |

Where the economic value lives in v0.1:

| Mechanism | What it does |
|-----------|--------------|
| **Capability ETH bond** | Locked at registration; slashable if fraudulent |
| **Challenge bond (0.01 ETH)** | Deterrent against fraudulent self-attestation; forfeited if rejected |
| **`slashedEthPool`** | Accumulates forfeited challenger bonds + slashed capability bonds; owner-withdrawable |

### 6.2 v2 Tokenomics (aspirational — not deployeded)

> ⚠️ **The following is the documented v2 tokenomics design. It is not implemented.** There is no `TaopToken.sol` in `contracts/`. It is preserved as the roadmap for a future protocol token and to explain the deferral rationale.

A future v2 protocol token (`TAOP`, ERC-20) could serve three utility vectors:

#### 6.2.1 Staking (Security)
Validators would stake TAOP to submit weighted ratings, with stake size determining voting weight (`stake / totalStakedProtocolWide`), gated by a minimum stake to prevent Sybil attacks.

#### 6.2.2 Bonding (Commitment)
Capability creators would lock TAOP as a bond at registration, at risk if the capability is fraudulent.

#### 6.2.3 Fees (Revenue)
Protocol interactions could incur small TAOP fees — partially burned (deflationary), partially distributed to stakers, partially funding the treasury.

**Planned v2 token distribution (100M fixed supply):**

```
Total Supply: 100,000,000 TAOP (fixed, no inflation)
      ┌─────────────────┐
      │  50% Community   │ (50,000,000) airdrops, staking rewards, grants
      ├─────────────────┤
      │  25% Team        │ (25,000,000) 4yr vest, 1yr cliff
      ├─────────────────┤
      │  15% Investors   │ (15,000,000) 3yr vest, 1yr cliff
      ├─────────────────┤
      │  10% Treasury    │ (10,000,000) protocol-owned
      └─────────────────┘
```

**Why this is deferred:** A token with zero market cap gives zero deterrent; ETH has real value, `payable`/`msg.value` is simpler than ERC-20 approvals, and no central party can freeze it. v0.1 ships the trustless loop with ETH and revisits tokenomics when there is real usage to monetize. The dormant fee switch concept (governance-controlled, mirrors the Uniswap/Lido/Aave pattern) is described in `FEE_MODEL.md`.

---

## 7. Security Model

### 7.1 Threat Model

| Threat | Description | Mitigation in v0.1 |
|--------|-------------|--------------------|
| Fraudulent self-attestation | Agent logs fake completions | Public challenge with 0.01 ETH bond; upheld challenges increment `disputeCount` and drop the score |
| Frivolous challenges | Attacker spams challenges | Challenger forfeits the 0.01 ETH bond if the challenge is rejected |
| Capability fraud | Creator registers fake capability | ETH bond slashable via `slashCapability` |
| Owner capture | Owner abuses `resolveChallenge` / pool withdrawal | Documented centralized trust boundary (TRD.md Appendix); upgradeable to timelock → multisig → DAO |
| Reentrancy | Attacker exploits callbacks | `ReentrancyGuard` on all mutating functions |
| Slither findings | Static analysis | No high/medium findings in our contracts |

### 7.2 Current Centralization Points (v0.1)

| Component | Centralized | Risk | Decentralization Plan |
|-----------|-------------|------|----------------------|
| `resolveChallenge()` | Owner (single EOA) | Single key decides all disputes | Timelock (v0.2) → multisig → DAO/optimistic |
| `setCertifier()` | Owner | Single key controls certification | Multi-sig (v0.2) → validator vote (v2) |
| `certifyCapability()` / `slashCapability()` | Certifier (or owner) | Single key certifies/slashes all | Validator threshold (v2) |
| `withdrawEthPool()` | Owner | Single key controls forfeited funds | Timelock + multisig |

**This is the trust-minimized bootstrap phase.** The challenge model is trustless *by construction* in the default case (anyone can challenge); the one trusted role is dispute resolution, which is documented and upgradeable. This is acceptable for a Sepolia pilot but must be hardened before mainnet.

### 7.3 Timelock Architecture (Planned v0.2)

All owner functions are intended to route through a `TimelockController` (7-day minimum delay) before mainnet, with the proposer role held by a multisig. This is documented v0.2 work, not in v0.1.

### 7.4 Smart Contract Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bugs in challenge/bond arithmetic | Medium | Hardhat test suite (22 tests); audit before mainnet |
| ERC-721 reentrancy on transfer | Low | `ReentrancyGuard` on all state-changing functions; `_safeMint` used |
| Integer overflow | None | Solidity 0.8+ has built-in overflow checks |
| Owner key compromise | High (pre-timelock) | Timelock + multisig planned for v0.2; operational key hygiene |
| Evidence CID spoofing | Low | IPFS CIDs are user-supplied; verified off-chain |

### 7.5 Audit Requirements

**Not yet audited. Not ready for mainnet.** Before mainnet launch:

1. **Internal review:** full coverage of all state-transition functions (22 tests today)
2. **Professional audit:** Trail of Bits / OpenZeppelin / Consensys Diligence
3. **Bug bounty:** public immunefi or Code4rena competition

---

## 8. SDK & Developer Surface

### 8.1 TypeScript SDK (`@taopp/sdk`)

**Status:** Working; currently `private` (not yet published to npm — a P0 fix).
**Dependencies:** ethers.js ^6.13.5

#### 8.1.1 `ReputationOracleNetworkClient`

| Method | Description |
|--------|-------------|
| `attestCompletion(taskType, resultCID)` | Self-attest a completion (returns `{ completionId, receipt }`) |
| `challengeCompletion(completionId, evidenceCID, bond)` | Challenge a completion with an ETH bond |
| `resolveChallenge(completionId, upheld)` | Resolve a challenge (owner only) |
| `getSelfAttestScore(agent)` | Query `{ completions, disputes, score }` |
| `getCompletion(id)` | Query a completion record |
| `completionCount(agent)` / `disputeCount(agent)` | Query raw counters |
| `challengeBond()` | Read the `CHALLENGE_BOND` constant |
| `withdrawEthPool(to, amount)` | Owner withdraws forfeited bonds |

```typescript
import { ReputationOracleNetworkClient } from "@taopp/sdk";

const ron = new ReputationOracleNetworkClient("0x...", signer);
const { completionId } = await ron.attestCompletion("LoRA", "ipfs://Qm...");
const score = await ron.getSelfAttestScore("0xAgentA");
console.log(`Score: ${score.score} (completions ${score.completions} − disputes ${score.disputes})`);
```

#### 8.1.2 `CapabilityRegistryClient`

| Method | Description |
|--------|-------------|
| `registerCapabilityEth(type, metadataCID, bondWei)` | Register a capability with an ETH bond |
| `certifyCapability(id)` | Certify a capability |
| `slashCapability(id, penalty)` | Slash a creator's bond |
| `withdrawBond(id)` | Creator reclaims un-slashed bond (burns NFT) |
| `getCapability(id)` | Query full capability data |
| `totalSupply()` / `tokenByIndex(i)` / `ownerOf(id)` | ERC-721Enumerable discovery helpers |

```typescript
import { CapabilityRegistryClient, LORA_CAPABILITY_TYPE } from "@taopp/sdk";
import { ethers } from "ethers";

const registry = new CapabilityRegistryClient("0x...", signer);
const { capabilityId } = await registry.registerCapabilityEth(
  LORA_CAPABILITY_TYPE,
  "ipfs://Qm...",
  ethers.parseEther("0.01"),
);
```

> **Note:** There is **no `TaopTokenClient`** in v0.1 — there is no protocol token. The `starsToRating`/`ratingToStars` utilities from earlier drafts described the validator 0–255 rating model and do not exist in v0.1.

#### 8.1.3 Python SDK (`taop`)

**Status:** Working (web3.py), 6 passing tests against Base Sepolia. Mirrors the TypeScript SDK. Installed locally (`packages/python-sdk/.venv`); PyPI publication is a planned follow-up.

```python
from taop import ReputationOracleNetworkClient

ron = ReputationOracleNetworkClient("0x...", signer)
completion_id = await ron.attest_completion("LoRA", "ipfs://Qm...")
score = await ron.get_self_attest_score("0xAgentA")
```

### 8.2 REST API

**Base URL:** `http://localhost:4000/api` (configurable). OpenAPI/Swagger docs served at `/api/docs/`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check |
| `/contracts` | GET | Deployment addresses + chain info |
| `/capabilities` | GET | List all capabilities (DB-cached, falls back to on-chain scan) |
| `/capabilities/{id}` | GET | Get a capability by ID |
| `/capabilities/register` | POST | Register a capability (Agent A) |
| `/capabilities/{id}/certify` | POST | Certify a capability (owner only) |
| `/completions` | GET | List recent completions (from DB) |
| `/completions/{id}` | GET | Get a completion by ID |
| `/completions/attest` | POST | Self-attest a completion (Agent A) |
| `/completions/{id}/challenge` | POST | Challenge a completion (public, 0.01 ETH bond) |
| `/completions/{id}/resolve` | POST | Resolve a challenge (owner only) |
| `/agents/{address}/score` | GET | Get an agent's self-attest score |
| `/discover` | GET | Discover agents by capability proof + score |
| `/demo/run` | POST | Run the full demo loop (real LoRA inference + on-chain attest) |

#### Discovery Query

```
GET /api/discover?capabilityType=LoRA&minScore=2
```

Response (ranked by `score` descending):
```json
[
  {
    "agentAddress": "0x...",
    "capabilityId": "1",
    "capabilityType": "LoRA",
    "certified": true,
    "slashed": false,
    "bond": "0.01",
    "metadataCID": "ipfs://Qm...",
    "completions": 5,
    "disputes": 0,
    "score": 5
  }
]
```

> **Note:** The earlier `/scores/submit` and `/scores/aggregate` endpoints described the validator model and do not exist in v0.1. Discovery returns the integer `score` (completions − disputes), not a 0–255/0–5★ rating.

---

## 9. MCP Server & AI Integration (planned)

### 9.1 MCP Server Specification (planned — not built in v0.1)

The TAOP MCP (Model Context Protocol) server is intended to expose on-chain data as tools that AI agents can call natively. **This is planned v0.2 work; v0.1 ships the REST API + SDKs only.** Planned tools (mapped to v0.1 contract calls):

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `get_agent_score` | Query agent reputation score | `agentAddress: string` | `{ completions, disputes, score }` |
| `discover_capabilities` | Find agents by capability | `capabilityType: string, minScore: number` | `[{ agentAddress, capabilityId, score, bond }]` |
| `register_capability` | Register an agent capability | `capabilityType, metadataCID, bondEther` | `{ capabilityId, txHash }` |
| `attest_completion` | Self-attest a completion | `taskType, resultCID` | `{ completionId, txHash }` |
| `get_capability` | Get capability details | `capabilityId: number` | `{ creator, bond, certified, type, metadataCID }` |

### 9.2 Example: Claude Discovers and Uses an Agent (planned)

```
User: "Find me a summarization agent with a proven track record"

Claude (calls TAOP MCP, planned):
  discover_capabilities({ capabilityType: "LoRA", minScore: 2 })
  → [Agent A (score: 5, bond: 0.01 ETH, capability: "LoRA-summarization")]

Claude: "I found Agent A with 5 verified completions and a 0.01 ETH bond.
         Want me to use their capability for your summarization task?"
```

### 9.3 Framework Integration Matrix

| Framework | Integration Method | Status |
|-----------|-------------------|--------|
| REST API | Direct HTTP | ✅ Shipped (v0.1) |
| TypeScript SDK | `@taopp/sdk` | ✅ Shipped (v0.1, private) |
| Python SDK | `taop` (web3.py) | ✅ Shipped (v0.1) |
| Agent B (demo) | External agent discovers + uses Agent A via Python SDK | ✅ Shipped (v0.1) |
| Claude (MCP) | TAOP MCP server → native tools | Planned (v0.2) |
| Codex (MCP) | TAOP MCP server → native tools | Planned (v0.2) |
| ElizaOS / LangChain / CrewAI | Plugins/tools | Planned (v0.2+) |

---

## 10. Governance & Decentralization Roadmap

### 10.1 Phase 0: Foundation (v0.1 — current)

| Parameter | Value |
|-----------|-------|
| Contract owner | Single EOA (deployer) |
| Certifier | Single EOA (deployer) |
| Dispute resolution | Owner-only `resolveChallenge` |
| Bond currency | ETH |
| Protocol token | None |
| Validator set | None |

**This is the trust-minimized bootstrap phase.** The challenge model is trustless by construction in the default case; the one trusted role (dispute resolution) is documented and upgradeable. Acceptable for a Sepolia pilot; must be hardened before mainnet.

### 10.2 Phase 1: Timelock + Multisig (v0.2 — planned)

- All `onlyOwner` functions routed through a `TimelockController` with a 7-day delay
- Certifier role changed to a multi-sig (hardware wallets, geographically distributed)
- The trustless claim becomes: "anyone can challenge; the resolver is timelocked and upgradeable."

### 10.3 Phase 2: Optimistic / DAO Resolution (v1+)

- `resolveChallenge` decisions move to an optimistic-resolution or DAO-vote model, removing the single-key trust boundary
- Capability certification via validator threshold or community vote

### 10.4 Phase 3: Validator Set + Protocol Token (v2 — aspirational)

- Optional validator-staking + protocol-token model (see §4.3, §6.2) as an ETH-native rewrite
- This remains the documented roadmap but is explicitly not committed to the v0.1 bytecode

---

## 11. Discussion & Limitations

### 11.1 Known Limitations (v0.1)

1. **Single-key dispute resolution:** `resolveChallenge` is owner-only. The one centralized trust boundary; upgradeable to timelock → multisig → DAO. (P0-5)
2. **Single certifier:** One EOA controls all capability certification. (P1-2)
3. **No agent identity:** Agents are raw EOAs; no persistent identity across address changes. AgentRegistry planned for v2. (P1-3)
4. **No score decay:** Scores never decay — stale reputations persist. (P2)
5. **No protocol revenue:** v0.1 generates zero fees by design; the dormant fee switch is documented in `FEE_MODEL.md`. (intentional)
6. **SDK not published:** `@taopp/sdk` has `"private": true`. P0 fix (npm publish).
7. **No public repo / no BaseScan verification:** No git repo, contracts not yet source-verified. P0 fix.
8. **No mainnet deployment:** Contracts live on Base Sepolia only. Pending audit.
9. **No upgrade mechanism:** Contracts are immutable (no UUPS proxy). Upgrades require redeployment + migration.
10. **O(n) discovery:** The `/discover` endpoint iterates all token IDs on-chain. Doesn't scale beyond hundreds of capabilities without a cached index. (P1-9)

### 11.2 Discussion Points

**Why self-attest + challenge instead of validators?** A validator set with zero users, zero token value, and zero fees is borrowed trouble. Self-attest + challenge is trustless by construction: no trusted party is needed in the default case, and anyone can economically challenge fraud. The validator model is preserved as documented v2.

**Why Base?** Low transaction costs, high throughput, strong Coinbase ecosystem support, and an active AI grants program. Sepolia testnet for the pilot; mainnet pending audit.

**Why ETH bonds, not a protocol token?** A token with zero market cap gives zero deterrent. ETH has real value, `payable`/`msg.value` is simpler than ERC-20 approvals, and no central party can freeze it.

**Why ERC-721 for capabilities?** NFTs provide composability out of the box — tradable, usable as collateral, transferable. The ERC-721Enumerable extension makes them discoverable. Reputation itself (the score) is non-transferable by design (it's a derived view of on-chain counters).

**Why not soulbound tokens (SBTs)?** SBTs are non-transferable, preventing capability NFTs from being traded or used as collateral. Tradable capabilities create a more liquid ecosystem.

---

## 12. Competitive Analysis

### 12.1 Direct Competitors

| Project | Stage | Reputation | Cap Registry | Economic Security | Stack Agnostic | TAOP Edge |
|---------|-------|------------|--------------|-------------------|----------------|-----------|
| **TAOP** | Sepolia pilot | ✅ Self-attest + challenge | ✅ ERC-721 NFTs | ✅ ETH bond + slash | ✅ Any framework | Only combo of on-chain cap NFTs + bonded reputation |
| **Olas (Autonolas)** | Live mainnet | ✅ ARS (June 2026) | ⚠️ Draft EIP | ✅ OLAS staking | ❌ Olas-specific | Agnostic + Cap NFTs |
| **AgentSafe** | Testnet (June 2026) | ✅ EAS-based | ❌ | ⚠️ Bond curves | ✅ Any agent | Cap NFTs + composability |
| **Schelling Protocol** | Testnet | ✅ Gauge staking | ❌ | ⚠️ Minimal | ⚠️ | Full economic security |
| **Fetch.ai** | Live mainnet | ❌ Off-chain only | ⚠️ Service endpoints | ❌ | ❌ Fetch-specific | On-chain + composable |

### 12.2 Olas ARS Detailed Comparison

Olas shipped their Agent Reputation Score (ARS) on Base mainnet in June 2026 — the most direct competitive threat:

| Feature | Olas ARS | TAOP (v0.1) | Note |
|---------|----------|-------------|------|
| On-chain score | ✅ | ✅ | Parity |
| Public challenge mechanism | ⚠️ | ✅ | TAOP's bonded challenge is the trust primitive |
| Time decay | ✅ | ❌ (P2) | TAOP needs this |
| Capability NFTs | ❌ (draft EIP) | ✅ | TAOP wins |
| Framework-agnostic | ❌ (Olas-only) | ✅ | TAOP wins |
| MCP integration | ❌ | ❌ (P1) | Tie |
| Network effects | ✅ (live operators) | ❌ | Olas leads |
| Mainnet | ✅ | ❌ (Sepolia) | TAOP needs audit + mainnet |

**Assessment:** Olas has the advantage of an existing operator network. TAOP's differentiators that Olas cannot quickly replicate are ERC-721 capability NFTs, framework-agnostic integration, and the open bonded-challenge reputation model.

### 12.3 AgentSafe Detailed Comparison

AgentSafe launched June 10, 2026 on Base testnet:

| Feature | AgentSafe | TAOP (v0.1) |
|---------|-----------|-------------|
| Agent identity via EAS | ✅ | ❌ (planned v2) |
| Bonding curves | ✅ | ❌ (flat ETH bond) |
| Capability NFTs | ❌ | ✅ |
| Reputation score | ✅ (transaction-based) | ✅ (self-attest + challenge) |
| Mainnet | ❌ (Testnet) | ❌ (Sepolia) |

**Assessment:** AgentSafe is complementary more than competitive. Agents could use AgentSafe for identity + TAOP for reputation and capability NFTs.

### 12.4 Strategic Position

```
                      Capability Registry
                            │
              TAOP ●────────┼─────────● EAS (generic)
                  │         │         │
          On-chain          │      Off-chain
          (ETH bonds + slash)│     (attestations)
                  │         │
              TAOP ●────────┼─────────● Schelling Protocol
                           │
                      Reputation
                      (credit score)
```

**White space:** On-chain capability NFTs + economically secured (ETH-bonded, challengeable) reputation. Nobody else ships this combination.

---

## 13. Roadmap & Milestones

### 13.1 Phase 0: MVP (Complete ✅)

- [x] Two smart contracts (ReputationOracleNetwork + CapabilityRegistry, 279 lines Solidity)
- [x] Self-attest + public-challenge reputation model with ETH bonds
- [x] TypeScript SDK (`@taopp/sdk`, ethers.js v6)
- [x] Python SDK (`taop`, web3.py, 6 passing tests)
- [x] REST API with Express.js + OpenAPI/Swagger docs
- [x] React + Vite demo UI with live demo flow
- [x] Hardhat test suite — 22 tests (14 self-attest + 8 capability)
- [x] Deployed to Base Sepolia with real IPFS evidence
- [x] External Agent B discovering + using Agent A via the Python SDK

### 13.2 Phase 1: Ship / Distribution (Weeks 1-4)

| Milestone | Deliverable | Effort |
|-----------|-------------|--------|
| Public git repo + BaseScan verification | Source-verify the deployed contracts | hours |
| Publish `@taopp/sdk` to npm | Remove `"private": true`, publish | 30 min |
| MCP server | Tools for `get_agent_score`, `discover`, `register`, `attest` | 2 days |
| Timelock on owner functions | `TimelockController` (7-day delay) | 0.5 day |
| Grant application | Base Batches / a16z Crypto Startup School | 1 day |

### 13.3 Phase 2: Harden (Weeks 5-12)

| Milestone | Effort |
|-----------|--------|
| Certifier decentralization (multisig) | 1 day |
| Agent identity registry | 1 day |
| Discovery API scaling (cached index) | 1 day |
| Score decay (continuous-time) | 1 day |
| Professional smart contract audit | 3 weeks (external) |

### 13.4 Phase 3: Mainnet & Scale (Months 4-12)

| Milestone | Timeline |
|-----------|----------|
| Base mainnet deployment (post-audit) | Month 4 |
| Optimistic / DAO dispute resolution | Month 5 |
| Viem SDK support | Month 5 |
| ElizaOS / LangChain plugins | Month 6 |

### 13.5 Phase 4: Expansion (aspirational v2, Months 6-12)

- Optional validator-staking + protocol-token model (ETH-native rewrite — §4.3/§6.2)
- Cross-chain reputation (LayerZero)
- ZK-proof score verification
- Capability NFT marketplace with royalties

### 13.6 Funding Strategy

| Source | Type | Amount | Timeline | Likelihood |
|--------|------|--------|----------|------------|
| Base Batches | Accelerator / incubator | $25-75K + mentorship | Quarterly | Medium-High |
| a16z Crypto Startup School | Non-dilutive grant | $75K | Quarterly | Medium |
| Base Ecosystem Fund | Equity investment | $100-500K | 30-60 days | Low (needs intro) |
| Angel investors (crypto x AI) | Angel equity | $50-150K per angel | 30-60 days | Medium |

> **Note:** The old Base Builder Grants program (1-5 ETH) has been discontinued and replaced by Base Batches (accelerator) and Base Ecosystem Fund (equity investment).

**Target total:** $300-500K pre-seed at $4-6M valuation.

---

## 14. Appendices

### A. Contract Addresses (Base Sepolia — live)

| Contract | Address | Status |
|----------|---------|--------|
| ReputationOracleNetwork | `0x9bd022B6f41360f774fDD93844FA319Ed5f58e36` | ✅ Deployed |
| CapabilityRegistry | `0x93415ac1cB1c2EDDC47033FFE421d85EaE674Acb` | ✅ Deployed |
| TaopToken | — | ❌ Not deployed (no protocol token in v0.1) |

Agent A: `0x7b237457b8e0EA89073592646686c5390343179A` · Deployed 2026-07-01.

### B. Glossary

| Term | Definition |
|------|------------|
| **TAOP** | Trustless Agent Orchestration Protocol |
| **Credit Bureau** | The reputation oracle system for agents (ReputationOracleNetwork) |
| **LoRA Guild** | An ERC-721 capability registry (named after LoRA adapters) |
| **Self-attestation** | An agent logging its own completion via `attestCompletion` |
| **Challenge** | A bonded (0.01 ETH) fraud flag against a completion |
| **Capability** | A registered agent skill, represented as an NFT |
| **Certifier** | An address authorized to verify capabilities |
| **Bond** | ETH locked by a capability creator or challenger, slashable/forfeitable |
| **Score** | `completions − disputes` (the v0.1 reputation score) |
| **Discovery** | Querying agents by capability type and minimum score |

### C. License

All TAOP smart contracts and SDK code are released under the MIT License. The whitepaper is licensed under CC BY 4.0.

### D. References

1. Autonolas Whitepaper — "A Decentralized Network for Autonomous Agents" (2022)
2. Bittensor — "A Peer-to-Peer Intelligence Market" (2021)
3. Ethereum Attestation Service (EAS) Documentation (2023)
4. Google Agent2Agent Protocol Whitepaper (2025)
5. Model Context Protocol (MCP) Specification — Anthropic (2025)
6. OpenZeppelin Contracts Documentation — v5.x
7. EIP-721: Non-Fungible Token Standard

---

*TAOP — The Invisible Reputation Layer for the Agent Economy*

**Version 0.1 — July 2026**
*This whitepaper documents the deployed v0.1 contracts (self-attest + public challenge, ETH-only) and the aspirational v2 design (validator staking + protocol token). The v0.1 model is trustless by construction; the v2 model is preserved as documented roadmap and is not in the deployed bytecode. Not financial advice.*
