# TAOP Credit Bureau + LoRA Guilds — Deep-Dive Improvements Analysis

> Generated: June 22, 2026 (originally) · **Re-graded July 2026 against the shipped v0.1 contracts.**
> Codebase snapshot at re-grade: `contracts/ReputationOracleNetwork.sol` (145 lines), `contracts/CapabilityRegistry.sol` (134 lines), `@taopp/sdk` (~180 lines), REST API (~1143 lines), 2 test files (22 tests), Python SDK (`taop`), deployed on **Base Sepolia (chainId 84532), live**.
> Purpose: Exhaustive product improvements, ranked by impact, with code-level specifics.

---

## ⚠️ Reconciliation banner (read this first — supersedes the inline grading below)

This document was originally written against an **earlier model** (validator staking + a protocol token, `TaopToken`) that was **removed** from the contracts on 2026-07-01. The shipped **v0.1** model is **self-attest + public challenge with ETH bonds** (`attestCompletion` → `challengeCompletion` → `resolveChallenge`), score = `completions − disputes`. There is **no `TaopToken.sol`, no validator set, no `stake`/`submitScores`/`aggregate`/`slash`** in the deployed bytecode.

Therefore several "P0 critical" items below are **already done or moot**. The table below is the authoritative current grading. The detailed sections that follow are kept as technical reference (and as the documented v2 design), but where they conflict with this banner, **this banner wins.**

### What shipped or is now moot in v0.1

| # | Original item | v0.1 status | Why |
|---|---------------|-------------|-----|
| P0-1 | Validator unstake/withdraw | **MOOT** | Validators were removed entirely. There is no `stake()` to unstake. Bonds are ETH and already withdrawable via `withdrawBond` (capability) — no unstake needed. |
| P0-2 | Score decay / stale scores | **OPEN (P2)** | Still genuinely open. v0.1 score = `completions − disputes` with no decay. Real gaming risk. |
| P0-3 | No fee model | **PARTLY DONE (intentional)** | v0.1 is ETH-only, zero-fee by design; the full ETH fee schedule + dormant fee switch are documented in `FEE_MODEL.md`. Protocol-token fees are moot. |
| P0-4 | Slashed tokens go nowhere | **PARTLY DONE** | `slashedEthPool` exists in both contracts and is owner-withdrawable. Validator slash redistribution is moot. |
| P0-5 | Single owner absolute power | **OPEN (P0)** | Still the real centralization risk. v0.1's `resolveChallenge` + `withdrawEthPool` + `setCertifier` are owner-only. Timelock/multisig still needed before mainnet. |
| P1-1 | Add challenge/dispute mechanism | **✅ SHIPPED** | `challengeCompletion` (0.01 ETH bond) + `resolveChallenge` are the v0.1 core loop. |
| P1-2 | Certifier is single address | **OPEN (P1)** | Still open. v0.1 certifier is a single EOA (or owner). |
| P1-3 | No agent identity | **OPEN (P1)** | Still open. Agents are raw EOAs in v0.1. |
| P1-4 | Score precision (0-255 uint8) | **MOOT** | v0.1 score is `completions − disputes` (two `uint64`s), not a 0–255 rating. No aggregation arithmetic to lose precision. |
| P1-5 | Capability type validation | **OPEN (P1-5)** | Still open. `capabilityType` is still an arbitrary `bytes32`. |
| P1-6 | Publish SDK to npm (private) | **OPEN (P0)** | Still open. `@taopp/sdk` is still `private: true`. |
| P1-7 | Open-source contracts on GitHub | **OPEN (P0)** | Still open. There is **no git repo** at all yet. |
| P1-8 | MCP server | **OPEN (P1)** | Still open. REST API + SDKs shipped; MCP not built. |
| P1-9 | Discovery is O(n) | **OPEN (P1)** | Still open. `/discover` iterates `totalSupply` on-chain. |
| P1-10 / P2-9 | No CapabilityRegistry tests | **✅ SHIPPED** | `test/CapabilityRegistryEth.test.ts` exists (8 tests). Total suite is 22 tests. |
| P2-2 | No mainnet deployment | **PARTLY DONE** | **Base Sepolia live** (chainId 84532) with real IPFS evidence + public demo. Base **mainnet** still pending audit. |
| P2-3 | Tokenomics placeholder | **MOOT (v2)** | `TaopToken.sol` does not exist. v0.1 is ETH-only; tokenomics deferred to documented v2. |
| P2-5 / P2-6 | Score decay / EMA aggregation | **OPEN (P2)** | Still open (decays apply to `completions − disputes`, not a weighted rating). |
| P2-7 | Bond locked forever for creators | **✅ SHIPPED** | `withdrawBond` exists in v0.1 — creators reclaim un-slashed ETH and the NFT is burned. |
| P2-8 | SDK is ethers-only (no viem) | **OPEN (P2)** | Still open. |

### The three moves that still matter most (v0.1 reality)

1. **Public git repo + BaseScan verification + npm publish** — visibility and distribution. No repo exists today.
2. **Timelock/multisig on owner functions (P0-5)** before mainnet — the one trust boundary that remains.
3. **MCP server + grant application** — distribution and funding.

The "validator unstake" urgency in the original P0 is gone. The remaining P0 work is about **distribution (repo, npm), trust hardening (timelock), and mainnet (post-audit)** — not contract-level reputation mechanics, which v0.1 already ships trustless-by-construction.

---

## Verdict (read this first)

**TAOP shipped the right primitives but stopped at "compiles and tests pass."** The contracts are structurally sound but missing ~15 features that convert them from demo contracts into a shippable protocol. Olas launched their Agent Reputation Score (ARS) on Base mainnet in June — you have a 60-90 day window before they ship their capability registry too. The improvements below are ordered by **competitive survival** (P0 = must ship to not die, P1 = must ship to raise, P2 = should ship soon, P3 = nice-to-have).

---

## CRITICAL GAPS (Must Fix in Current Contracts)

### P0-1: No unstake/withdraw for validators ⚠️ CRITICAL

**Current:** `stake()` deposits forever. Validators can NEVER withdraw their stake. This is a showstopper — no rational actor deposits tokens they can never retrieve.

**Impact:** Zero validators = zero scores = zero value.

**Fix:** Add `unstake(uint256 amount)` with a 7-day timelock (or 0-day for MVP):

```solidity
// New mapping
mapping(address => uint256) public pendingWithdrawal; // timestamp
mapping(address => uint256) public pendingAmount;

function initiateUnstake(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();
    if (validatorStake[msg.sender] < amount) revert InsufficientStake(validatorStake[msg.sender], amount);
    validatorStake[msg.sender] -= amount;
    pendingWithdrawal[msg.sender] = block.timestamp + 7 days;
    pendingAmount[msg.sender] = amount;
    emit UnstakeInitiated(msg.sender, amount);
}

function withdraw() external nonReentrant {
    if (pendingWithdrawal[msg.sender] == 0) revert NothingToWithdraw();
    if (pendingWithdrawal[msg.sender] > block.timestamp) revert CooldownActive();
    uint256 amount = pendingAmount[msg.sender];
    delete pendingWithdrawal[msg.sender];
    delete pendingAmount[msg.sender];
    require(stakeToken.transfer(msg.sender, amount), "withdraw failed");
    emit StakeWithdrawn(msg.sender, amount);
}
```

**Without this, you literally cannot have validators.** Ship this before anything else.

---

### P0-2: No aggregate periodicity / stale scores ⚠️ CRITICAL

**Current:** A score from day 1 is treated the same as a score from today. Inactive agents retain their reputation forever. This makes the system gameable — create an agent, get one good rating, coast forever.

**Fix:** Add score decay and a minimum aggregation window:

```solidity
struct AgentScore {
    uint128 totalScore;
    uint64 count;
    uint64 lastUpdated;
    uint64 lastActivityBlock; // NEW — track recency
}
```

**Option A (simple):** Decay score by 50% per 30 days of inactivity in the `getAgentScore` view function:
```solidity
function getAgentScore(address agent) external view returns (AgentScore memory) {
    AgentScore memory s = scores[agent];
    if (s.count == 0) return s;
    uint256 daysSinceUpdate = (block.timestamp - s.lastUpdated) / 1 days;
    if (daysSinceUpdate > 30) {
        // Exponential half-life: score halves every 30 days
        uint256 halvings = daysSinceUpdate / 30;
        uint256 decayed = uint256(s.totalScore) >> halvings; // divide by 2^halvings
        s.totalScore = uint128(decayed);
    }
    return s;
}
```

**Option B (the Olas approach — stronger):** Make reputation a soulbound NFT with accumulating + decaying mechanics. Punish inactive agents harder.

**Recommendation:** Option A ships in one afternoon. Do it.

---

### P0-3: No fee model — protocol has zero revenue ⚠️ CRITICAL

**Current:** Zero fees anywhere. The protocol burns gas but collects nothing. Even if millions of credits are issued, TAOP generates $0.

**Fix:** Three fee hooks, all low-gas:

```solidity
uint256 public submissionFee = 0.001 ether; // per score submission (stablecoin-valued)
uint256 public registrationFee = 0.01 ether; // per capability registration
uint256 public aggregateFee = 0; // optional: free to aggregate

// In submitScores:
if (submissionFee > 0) {
    // Collect in ETH or the stake token
    // For ETH: require(msg.value >= submissionFee * submissions.length);
}
```

**Better design:** Charge fees in the protocol token (TAOP) so demand scales with usage:
```solidity
function submitScores(ScoreSubmission[] calldata submissions) external nonReentrant returns (bool) {
    uint256 fee = submissionFeePerSubmission * submissions.length;
    if (fee > 0) {
        require(stakeToken.transferFrom(msg.sender, address(this), fee), "fee transfer failed");
    }
    // ... existing logic
}
```

**Without this, you cannot even pay for your own contract's gas in the long run.**

---

### P0-4: Slashed tokens go nowhere useful ⚠️ HIGH

**Current:** `slash()` transfers to the contract itself (protocol-owned pool). There's no way to *use* that pool — no burn, no redistribution, no treasury.

**Fix (MVP):** Simple redistribution to honest validators:
```solidity
// In slash:
uint256 rewardPerValidator = penalty / totalActiveValidators;
// OR: burn it
// stakeToken.transfer(address(0xdead), penalty);
// OR: keep as protocol-owned liquidity
```

**Better design:** Track total slashed amounts and redistribute proportionally to active validators on aggregate:
```solidity
mapping(address => uint256) public pendingRewards; // validators claim these

function claimRewards() external nonReentrant {
    uint256 reward = pendingRewards[msg.sender];
    pendingRewards[msg.sender] = 0;
    require(stakeToken.transfer(msg.sender, reward), "reward transfer failed");
}
```

This turns slashing from "burn money" into "compensate honest actors" — critical for validator recruitment.

---

### P0-5: Single owner has absolute power — governance centralization ⚠️ HIGH

**Current:** `Ownable` with `onlyOwner` on `slash()`, `setCertifier()`. One private key controls slashing and certification. This is a single point of failure and a non-starter for any protocol claiming to be trustless.

**Fix (MVP):** Multi-sig via OpenZeppelin `Ownable2Step` or a simple timelock:
```solidity
import "@openzeppelin/contracts/governance/TimelockController.sol";
// Deploy with 7-day delay on all owner functions
```

**Medium-term:** Move to a governance token / DAO for `slash()` and `setCertifier()`.

---

## STRUCTURAL IMPROVEMENTS (Sharpen the Contracts)

### P1-1: Add challenge/dispute mechanism to Credit Bureau ⚠️ HIGH

**Current:** Validators submit scores. They can be slashed by the owner. There's no way for an agent (or a third party) to challenge a score they believe is fraudulent. This means the reputation data has NO verifiability guarantee — it's just "trust the validator."

**Fix:** Add `challengeScore(address agent, uint256 taskId)`:
```solidity
mapping(bytes32 => Challenge) public challenges; // keccak(agent, taskId)

struct Challenge {
    address challenger;
    uint256 bond;
    uint256 deadline;
}

function challengeScore(address agent, uint64 taskId) external payable {
    require(msg.value > MIN_CHALLENGE_BOND, "insufficient bond");
    bytes32 key = keccak256(abi.encodePacked(agent, taskId));
    challenges[key] = Challenge(msg.sender, msg.value, block.timestamp + 7 days);
    emit ChallengeFiled(agent, taskId, msg.sender);
}

function resolveChallenge(address agent, uint64 taskId, bool valid) external onlyOwner {
    bytes32 key = keccak256(abi.encodePacked(agent, taskId));
    Challenge storage c = challenges[key];
    if (valid) {
        // Challenger was right — slash the validator, reward challenger
        payable(c.challenger).transfer(c.bond * 2); // return bond + reward
    } else {
        // Challenger was wrong — lose bond
        // Bond goes to protocol treasury or validators
    }
    delete challenges[key];
}
```

This is the **core mechanism that makes reputation cryptoeconomic.** Without it, scores are just subjective numbers with no recourse.

---

### P1-2: Certifier is a single centralized address ⚠️ HIGH

**Current:** `certifier` is a single EOA. It can `certifyCapability()` and `slashCapability()`. If the certifier key is lost OR goes rogue, the entire CapabilityRegistry is compromised.

**Fix (MVP):** Multi-sig certifier, or a certifier committee:
```solidity
// Option A: Use Ownable for certifier too (already kind of — owner can change certifier)
// Option B: Certifier committee via EAS attestation or threshold signatures
// Option C (simplest): Allow token holders to vote on certification
mapping(uint256 => uint256) public certificationVotes; // capabilityId => yes votes
uint256 public constant CERTIFICATION_THRESHOLD = 5; // staked validators who agree

function voteToCertify(uint256 capabilityId) external {
    require(validatorStake[msg.sender] >= MIN_VALIDATOR_STAKE, "not a validator");
    certificationVotes[capabilityId]++;
    if (certificationVotes[capabilityId] >= CERTIFICATION_THRESHOLD) {
        _capabilities[capabilityId].certified = true;
        emit CapabilityCertified(capabilityId, address(0)); // collective cert
    }
}
```

**Minimum viable fix:** Make `certifyCapability` also callable by the OWNER in addition to the certifier (which it already is). Add a timelock to the certifier role change.

---

### P1-3: No agent identity — agents are just EOAs ⚠️ HIGH

**Current:** Agents are identified by their `address` in `ScoreSubmission.agent` and `Capability.creator`. This means:
- One person can create 100 agent addresses and game the system
- There's no way to verify that "Agent A" = "the agent that runs model X"
- No agent profile/metadata on-chain

**Fix:** Add a simple `AgentRegistry` contract or extend `CapabilityRegistry`:

```solidity
// New mapping: agent address => AgentInfo
struct AgentInfo {
    bytes32 agentId; // keccak256(owner's DID or immutable identifier)
    string agentType; // e.g. "chatbot", "trader", "researcher"
    string metadataURI; // JSON profile
    bool verified; // KYC/verification by certifier
}

mapping(address => AgentInfo) public agents;

function registerAgent(bytes32 agentId, string calldata agentType, string calldata metadataURI) external {
    agents[msg.sender] = AgentInfo(agentId, agentType, metadataURI, false);
    emit AgentRegistered(msg.sender, agentId);
}
```

**Better design:** Align with ERC-7715 (Smart Accounts for Agents — proposed standard) or use EAS attestations as agent identities.

---

### P1-4: Score precision is too coarse (0-255 uint8) ⚠️ MEDIUM

**Current:** Rating is `uint8` (0-255). Weighted average uses integer division: `weightedSum / weightSum` which truncates to integer. This loses precision on every aggregation.

**Impact:** After many aggregations, scores converge to similar values and become indistinguishable.

**Fix:** Use `uint256` with a scalar:
```solidity
// Store raw values with 2 decimal places of precision
// Internal: totalScore * 100 (so 25500 = max)
// External: divide by 100 in view functions

struct AgentScore {
    uint256 totalScore; // weighted sum * 100 (avoids float)
    uint256 totalWeight; // sum of weights * 100
    uint64 count;
    uint64 lastUpdated;
}

function aggregate(address agent) external nonReentrant returns (uint64) {
    PendingAggregation storage p = pending[agent];
    if (p.count == 0) revert NothingToAggregate();
    
    uint256 newScore = (p.weightedSum * 100) / p.weightSum; // preserve precision
    AgentScore storage sc = scores[agent];
    sc.totalScore = sc.totalScore + newScore; // running sum of scores
    sc.count += uint64(p.count);
    sc.lastUpdated = uint64(block.timestamp);
    delete pending[agent];
    
    uint64 currentAverage = uint64(newScore); // latest score
    emit ScoreAggregated(agent, currentAverage);
    return currentAverage;
}
```

**Simpler path:** Just use `uint256` for internal storage and let the SDK handle division.

---

### P1-5: No capability type validation/enumeration standard ⚠️ MEDIUM

**Current:** `capabilityType` is `bytes32` — set by the creator as any arbitrary hash. There's no enumeration of valid capability types, no type hierarchy, and no way to discover "all LoRA capabilities" without string-matching the hash.

**Fix:** Add a capability type registry:
```solidity
mapping(bytes32 => bool) public supportedCapabilityTypes;

function addCapabilityType(bytes32 typeHash, string calldata label) external onlyOwner {
    supportedCapabilityTypes[typeHash] = true;
    emit CapabilityTypeAdded(typeHash, label);
}

function registerCapability(bytes32 capabilityType, string calldata metadataCID, uint256 bond)
    external nonReentrant returns (uint256 capabilityId)
{
    require(supportedCapabilityTypes[capabilityType], "unsupported type");
    // ... rest of existing logic
}
```

Define initial types:
- `keccak256("LoRA")` — LoRA model adapter
- `keccak256("Tool")` — function/tool agent capability  
- `keccak256("Prompt")` — prompt template
- `keccak256("Model")` — base model
- `keccak256("Plugin")` — agent plugin

This also prevents spam — no one can register a "fake" capability type.

---

## PRODUCT-MARKET IMPROVEMENTS (Ship the Platform)

### P1-6: Publish SDK to npm (it's private) ⚠️ CRITICAL

**Current:** `packages/sdk/package.json` has `"private": true`. Nobody can install `@taopp/sdk`.

**Impact:** Zero SDK downloads = zero integrations = zero value.

**Fix in 30 seconds:**
```json
{
  "name": "@taopp/sdk",
  "version": "0.1.0",
  "private": false,  // ← change this
  "publishConfig": {
    "access": "public"
  }
}
```

Then `npm publish`. That's it. Your SDK is 102 lines of clean TypeScript — it's shippable TODAY.

**P0 recommendation:** Do this before finishing this document.

---

### P1-7: Open-source the contracts on a public GitHub repo ⚠️ HIGH

**Current:** Contracts are in `~/Documents/new-credit-bureau/`. No public GitHub repo. No CI. No npm badge. No README for developers.

**Fix:** Create `github.com/TAOP-protocol/contracts` (or similar), push with:
- README.md explaining the protocol
- Hardhat build instructions
- Badge showing tests pass
- License file (MIT or Apache 2.0)

**Note from research:** No grant program funds closed-source private repos. Base grants require public repos.

---

### P1-8: Build an MCP server ⚠️ HIGH

**Current:** Data is accessible via REST API (Express server on port 4000) and directly via ethers.js. No MCP server — meaning Claude, Codex, and other AI agents cannot natively access TAOP reputation data.

**Fix:** Build a 100-line MCP server:

```typescript
// taop-mcp-server/src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ethers } from "ethers";

// Load contract ABIs, create RON client

const server = new Server({
  name: "taop-credit-bureau",
  version: "0.1.0",
}, {
  capabilities: { tools: {} },
});

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "get_agent_score",
      description: "Get the reputation score of an AI agent",
      inputSchema: {
        type: "object",
        properties: {
          agentAddress: { type: "string", description: "Agent's Ethereum address" },
        },
        required: ["agentAddress"],
      },
    },
    {
      name: "discover_capabilities",
      description: "Find capabilities matching a type and minimum score",
      inputSchema: {
        type: "object",
        properties: {
          capabilityType: { type: "string", enum: ["LoRA", "Tool", "Model", "Prompt"] },
          minStars: { type: "number", default: 0 },
        },
      },
    },
    {
      name: "register_capability",
      description: "Register an agent capability as a LoRA Guild NFT",
      inputSchema: {
        type: "object",
        properties: {
          capabilityType: { type: "string" },
          metadataCID: { type: "string" },
          bondInEther: { type: "string", description: "ETH bond amount" },
        },
      },
    },
  ],
}));

server.setRequestHandler("tools/call", async (request) => {
  // Route to contract methods, return JSON
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Install:** `npx @taop/taop-mcp-server` or `hermes tools install taop` — and any Hermes agent can query TAOP reputation natively.

---

### P1-9: Discovery API is O(n) iteration — doesn't scale ⚠️ MEDIUM

**Current:** The `/api/discover` endpoint iterates over every token ID in `CapabilityRegistry` (with `tokenByIndex`). At 10 capabilities this is fine. At 10,000 it's a gas-bomb that will timeout and revert.

**Fix:** Add an on-chain index or off-chain indexer:

**Option A (on-chain, MVP):** Maintain a mapping from `capabilityType` to an array of capability IDs:
```solidity
mapping(bytes32 => uint256[]) public capabilitiesByType;
// Update on register:
capabilitiesByType[capabilityType].push(capabilityId);
```

**Option B (recommended for scale):** Use an off-chain indexer (e.g., the Express server caches results from events). Since the MVP uses an Express API anyway, cache the data there:

```typescript
// On server startup: scan all events
// Cache in memory
// Update on each new event
const capabilityCache = new Map<string, Capability[]>();

server.on("CapabilityRegistered", (event) => {
  // Invalidate cache for this capabilityType
});
```

**Option C (production):** Use The Graph subgraph or Ponder indexer for production-grade discovery.

---

### P1-10: No test coverage for CapabilityRegistry ⚠️ HIGH

**Current:** `test/ReputationOracleNetwork.test.ts` has 8 tests for the Credit Bureau. Zero tests for `CapabilityRegistry`.

**Impact:** You can't deploy `CapabilityRegistry` with confidence. Bugs are guaranteed to ship.

**Fix:** Write tests covering:
- `registerCapability` with valid bond → mints NFT, emits event
- `registerCapability` with zero bond → reverts
- `registerCapability` with insufficient approval → reverts
- `certifyCapability` by certifier → updates state
- `certifyCapability` by non-certifier → reverts
- `slashCapability` by certifier → reduces bond
- `slashCapability` exceeding bond → reverts
- `getCapability` for non-existent ID → reverts
- ERC-721 enumeration (`totalSupply`, `tokenByIndex`, `ownerOf`)

---

## STRATEGIC IMPROVEMENTS (Why This Wins or Dies)

### P2-1: Defensive response to Olas Agent Reputation Score 🚨 CRITICAL

**The threat:** Olas shipped ARS on Base mainnet in June 2026. It's a soulbound reputation token with staking yield weighted by reputation. They already have agent operators, stakers, and a live mainnet. If Olas adds a capability registry next (and their draft EIP suggests they're working on it), TAOP's differentiating features disappear.

**Response (do this month):**
1. Ship mainnet deployment of current contracts (even with the gaps — iterate fast)
2. Open-source + npm publish (visibility beats perfection)
3. Build the MCP server so Claude agents use TAOP instead of waiting for Olas
4. Ship the validator unstake function (P0-1) so people can actually join
5. Speed-run a Base grant application (your competition is Olas — Base wants alternatives)

**Do NOT:** Wait until all improvements are done before shipping mainnet. Ship what works, iterate.

---

### P2-2: No mainnet deployment exists ⚠️ CRITICAL

**Current:** `deployments.json` points to `chainId: 31337` (Hardhat localhost). No Base Sepolia testnet. No Base mainnet.

**Fix:** 

1. **Today:** Deploy to Base Sepolia:
```bash
npx hardhat run scripts/deploy-local.ts --network baseSepolia
# Get the deployment addresses
# Update deployments.json with real addresses
# Verify contracts on BaseScan
```

2. **Within 7 days:** Deploy to Base mainnet with minimal viable features:
- 1 validator (you, running a script)
- 1 agent (your demo agent A)
- Show 1 real attestation on BaseScan

**A single tx hash on BaseScan with real ETH is worth more to investors and grant reviewers than all 13 pages of this document combined.** The "one real transaction" principle applies here.

---

### P2-3: Tokenomics design is placeholder ⚠️ CRITICAL

**Current:** `TaopToken.sol` is 22 lines — an owner-mintable ERC20 with no caps, no distribution, no inflation schedule, no fee mechanics. Market cap = $0.

**Recommended tokenomics (based on research of Olas/Allora/Chainlink patterns):**

| Parameter | Recommendation | Rationale |
|-----------|---------------|-----------|
| Total supply | 100M TAOP (fixed, no inflation) | Matches Olas standard; avoids ongoing dilution |
| Community/ecosystem | 50% | Airdrops to early validators+agents, grants, staking rewards |
| Team+founding | 25% | 4-year vesting, 1-year cliff |
| Investors | 15% | 3-year vesting, 1-year cliff |
| Treasury | 10% | Protocol-owned liquidity, future development |
| Staking yield | From protocol fees, not inflation | Fee-driven model (like Chainlink, not Bittensor) |
| Token utility | Staking (validator bond), fees, governance voting | 3 vectors of demand |

**Fee model for sustainability:**
| Fee Type | Amount | Payer | Recipient |
|----------|--------|-------|-----------|
| Score submission | 0.001 TAOP | Validator staking reward | Stakers (burn 30%) |
| Capability registration | 0.1 TAOP | Creator | Treasury (50%) + burned (50%) |
| Capability challenge bond | 10 TAOP | Challenger | Held in escrow, returned if valid |
| Query fee (future) | 0.0001 TAOP | External protocol querying scores | Stakers (100%) |

---

### P2-4: AgentSafe launched on Base as a direct competitor ⚠️ HIGH

**The threat:** AgentSafe (agentsafe.xyz) launched June 10, 2026 — combines EAS attestations with bonding curves for "reputation-backed agent identities" on Base testnet. This is the closest new entrant to TAOP's exact positioning.

**Response:**
1. Differentiate on **capability registry** (AgentSafe has identity + reputation, NOT capability NFTs)
2. Differentiate on **LoRA Guilds** naming (AgentSafe uses generic "agent identities")
3. Be first to mainnet (AgentSafe is still testnet)
4. Integrate AgentSafe's identity layer as a complement (agents could use AgentSafe for identity + TAOP for reputation + capability)

---

## ARCHITECTURAL IMPROVEMENTS (Clean Up the Contracts)

### P2-5: Score decay model is naive — needs continuous-time formula

**Current recommendation (P0-2):** Simple half-life view function. Good for MVP.

**Production version (champion-challenger model):**

```solidity
// Use exponential moving average:
// newScore = α * latestSubmission + (1-α) * previousScore
// Where α is time-dependent: α = 1 - e^(-Δt / τ)
// τ = decay constant (e.g., 30 days)

function _decayedScore(AgentScore storage s, uint256 decayPeriod) internal view returns (uint128) {
    if (s.count == 0) return 0;
    uint256 elapsed = block.timestamp - s.lastUpdated;
    if (elapsed >= decayPeriod) return 0; // fully decayed
    uint256 lambda = 1e18; // 1.0 precision
    uint256 alpha = (elapsed * lambda) / decayPeriod; // linear approx
    return uint128((uint256(s.totalScore) * (lambda - alpha)) / lambda);
}
```

**Ship the simple version first, upgrade later.**

---

### P2-6: Score aggregation uses simple average — needs weighted history

**Current:** `aggregate()` computes `weightedSum / weightSum` which overwrites the previous score entirely. Each aggregation forgets history.

**Better:** Use exponential moving average:
```solidity
function aggregate(address agent, uint256 alphaNumerator, uint256 alphaDenominator) external nonReentrant returns (uint64) {
    PendingAggregation storage p = pending[agent];
    if (p.count == 0) revert NothingToAggregate();
    
    uint256 newScore = p.weightedSum / p.weightSum; // latest batch score
    AgentScore storage sc = scores[agent];
    
    if (sc.count == 0) {
        sc.totalScore = uint128(newScore);
    } else {
        // EMA: score = α * new + (1-α) * old
        // α = alphaNumerator / alphaDenominator (e.g., 1/3 = recent 33% weight)
        sc.totalScore = uint128(
            (newScore * alphaNumerator + sc.totalScore * (alphaDenominator - alphaNumerator)) / alphaDenominator
        );
    }
    sc.count += uint64(p.count);
    sc.lastUpdated = uint64(block.timestamp);
    delete pending[agent];
    emit ScoreAggregated(agent, sc.totalScore);
    return uint64(sc.totalScore);
}
```

This makes TAOP's Credit Bureau behave like a **real credit score** (FICO-like) where past behavior has momentum and recent behavior matters more.

---

### P2-7: Bond tokens are locked forever for capability creators

**Current:** `registerCapability` locks `bond` tokens permanently. There's no unbond function, no `withdrawBond`, no `slash` refund, no voluntary delisting.

**Fix:** Add unbonding with a challenge window:
```solidity
mapping(uint256 => uint256) public unbondRequestedAt; // capabilityId => timestamp

function requestUnbond(uint256 capabilityId) external {
    require(ownerOf(capabilityId) == msg.sender, "not owner");
    require(!_capabilities[capabilityId].slashed, "already slashed");
    unbondRequestedAt[capabilityId] = block.timestamp;
    emit UnbondRequested(capabilityId);
}

function withdrawBond(uint256 capabilityId) external nonReentrant {
    require(ownerOf(capabilityId) == msg.sender, "not owner");
    require(unbondRequestedAt[capabilityId] > 0, "not requested");
    require(block.timestamp >= unbondRequestedAt[capabilityId] + 14 days, "cooldown active");
    require(!_capabilities[capabilityId].slashed, "slashed");
    
    uint256 bond = _capabilities[capabilityId].bond;
    _capabilities[capabilityId].bond = 0;
    _burn(capabilityId); // or transfer to null address
    require(bondToken.transfer(msg.sender, bond), "unbond transfer failed");
    emit BondWithdrawn(capabilityId, bond);
}
```

**With 14-day challenge window**, anyone can slash the capability during unbonding if they have evidence of fraud. This prevents a "run with the bond" attack.

---

### P2-8: SDK uses ethers.js v6 — no viem support

**Current:** `@taopp/sdk` uses `ethers.js ^6.13.5`. Viem is the dominant web3 library in 2026 (more TypeScript-native, better tree-shaking, wagmi/rainbowkit compatible).

**Fix:** Add a viem-based client:
```typescript
// packages/sdk/src/viem-clients.ts
import { createPublicClient, createWalletClient, http, getContract, type Address } from "viem";
import { base } from "viem/chains";
import { ronAbi, registryAbi } from "./abis-viem.js";

export function createRonPublicClient(rpcUrl: string, ronAddress: Address) {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  // Access: client.readContract({ address, abi: ronAbi, functionName: "getAgentScore", args: [agentAddress] })
}
```

---

## QA & OPERATIONAL IMPROVEMENTS

### P2-9: No CapabilityRegistry tests exist

**Already covered in P1-10** — but worth separating as a concrete deliverable. Write 8-10 tests.

### P2-10: No CI/CD pipeline

**Current:** No `.github/workflows/` directory. No automated testing. No automated deployment.

**Fix:** Add GitHub Actions:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx hardhat compile
      - run: npx hardhat test
  deploy-sepolia:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      # ... deploy to Base Sepolia
```

---

### P2-11: No TypeScript type generation from Solidity

**Current:** ABIs are hand-written (44 lines in `abis.ts`). TypeChain types exist in `@typechain/hardhat` but aren't exported.

**Fix:** Generate types during build:
```bash
npx typechain --target ethers-v6 --out-dir packages/sdk/src/typechain contracts/*.sol
```
Then use generated types instead of hand-written ABIs. This prevents ABI drift between contracts and SDK.

---

## FEATURE INNOVATIONS (Unlock New Value)

### P3-1: Multi-chain support via message passing

**Current:** Contracts are EVM-only (Base). Agents on Solana, Near, or Cosmos cannot use TAOP.

**Future:** Use LayerZero, Axelar, or Wormhole for cross-chain reputation queries. An agent on Solana should be able to "check their TAOP credit score" before interacting with an agent on Base.

### P3-2: ZK-proof based score verification

**Future:** Instead of `getAgentScore` returning a plain number, return a ZK-proof that the score was computed correctly. This allows agents to prove their reputation without revealing all their ratings.

### P3-3: Agent reputation as a credit default swap (the "Credit Bureau" name)

**Future:** Allow stakers to buy "reputation insurance" on agents — if an agent's score drops below a threshold, the insurer pays out. This is the DeFi-native version of a credit default swap, and it's exactly what the name "Credit Bureau for AI agents" implies.

### P3-4: Capability NFT marketplace

**Current:** Capabilities are ERC-721 NFTs but aren't tradeable (no marketplace integration). Add royalty support so creators earn on secondary sales of capability NFTs.

### P3-5: On-chain agent verification via EAS attestations

Integrate with Ethereum Attestation Service (EAS) so agents can receive attestations from multiple verifiers, not just the single `certifier`. This makes the capability registry trust-minimized.

---

## COMPETITIVE RESPONSE TIMELINE

### What Olas shipped (June 2026) — your window is closing

| Feature | Olas Status | TAOP Status | Gap | 
|---------|-------------|-------------|-----|
| Agent Reputation Score (on-chain) | ✅ Live on Base mainnet | 🟡 Code works, not deployed | CRITICAL |
| Stake-weighted reputation | ✅ Live | 🟡 Code works | Low |
| Time-decay reputation | ✅ Live | ❌ Not implemented | HIGH |
| Staking yield proportional to reputation | ✅ Live | ❌ Not implemented | HIGH |
| Capability registry | 🟡 Draft EIP, not shipped | ✅ Code works, not deployed | Narrow window |
| MCP server | ❌ Not built | ❌ Not built | Tie |
| Soulbound reputation tokens | ✅ Live | ❌ Not implemented | HIGH |
| Validator unstake | ✅ Live | ❌ Not implemented | CRITICAL |

### What AgentSafe shipped (June 10, 2026)

| Feature | AgentSafe | TAOP | 
|---------|-----------|------|
| Agent identity with reputation | ✅ Live (testnet) | 🟡 Via CapabilityRegistry |
| Bonding curves for reputation | ✅ | ❌ |
| EAS attestation integration | ✅ | ❌ |
| Capability NFTs | ❌ | ✅ Core differentiator |
| LoRA/plugin specialization | ❌ | ✅ Core differentiator |
| MCP server | ❌ | ❌ |

### What Schelling Protocol ships (May 2026)

| Feature | Schelling v0.3 | TAOP |
|---------|----------------|------|
| On-chain reputation gauge staking | ✅ | ❌ Could add |
| Agent coordination layer | ✅ | ❌ |
| Capability registry | ❌ | ✅ |
| Economic bonding | ❌ | ✅ |

---

## IMPROVEMENT ROADMAP

> Re-graded July 2026 against the shipped v0.1 contracts (self-attest + ETH-bond challenge, score = completions − disputes). Items the old model needed (validator unstake, token fees, CapabilityRegistry tests, bond withdrawal) are shipped or moot; the remaining work is distribution, trust hardening, and mainnet.

### P0 — Ship This Month (Weeks 1-4)

| # | Improvement | Effort | Impact | Dependency |
|---|-------------|--------|--------|------------|
| P1-7 | Public git repo + BaseScan source verification | 2 hours | CRITICAL — no repo exists today; required for grants/audits | None |
| P1-6 | Publish `@taopp/sdk` to npm (it's `private: true`) | 30 minutes | CRITICAL — zero distribution | None |
| P0-5 | Timelock on owner functions (`resolveChallenge`, `withdrawEthPool`, `setCertifier`) | 0.5 day | HIGH — the one trust boundary; needed before mainnet | None |
| P2-2 | Base mainnet deployment (post-audit) | 1 day + audit | CRITICAL — Sepolia is live; mainnet pending audit | P0-5, audit |

**Total P0: ~2-3 days of focused work + external audit.** Do these first. (Sepolia is already live; the gap is repo/npm/timelock/mainnet, not contract mechanics.)

---

### P1 — Ship This Quarter (Weeks 5-12)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| P1-8 | MCP server (Claude + Codex integration) | 2 days | HIGH — native agent distribution |
| P1-2 | Certifier decentralization (multisig) | 1 day | HIGH — removes centralization risk |
| P1-3 | Agent identity registry | 1 day | HIGH — agents are raw EOAs today |
| P1-9 | Discovery scaling (cached index, not O(n) on-chain scan) | 1 day | MEDIUM — scale beyond hundreds of caps |
| P0-2 | Score decay (continuous-time on `completions − disputes`) | 1 day | HIGH — prevents reputation gaming |
| P1-5 | Capability type registry | 0.5 day | MEDIUM — spam prevention |
| P2-1 | Competitive response (Olas ARS) | Ongoing | CRITICAL — competitive survival |

**Total P1: ~6.5 days of focused work.** (Tokenomics design, P2-3, is moot in v0.1 — ETH-only, deferred to documented v2.)

---

### P2 — Ship This Year (Months 4-6)

| # | Improvement | Effort |
|---|-------------|--------|
| P2-4 | AgentSafe integration/complement | 3 days |
| P2-5 | Score decay refinement (continuous-time formula) | 1 day |
| P2-8 | Viem SDK support | 2 days |
| P2-10 | CI/CD pipeline (no `.github/workflows` yet) | 1 day |
| P2-11 | TypeChain type generation (ABIs currently hand-written) | 0.5 day |

> Note: P2-6 (EMA aggregation) and P2-7 (bond withdrawal) described the validator model; the former is moot (no weighted aggregation in v0.1), the latter is already shipped (`withdrawBond`).

---

## SUMMARY

**The good news:** The v0.1 contracts compile, 22 tests pass, and **the protocol is live on Base Sepolia** with real IPFS evidence, a public demo, and an external Agent B that discovers + uses Agent A. The self-attest + public-challenge loop is trustless by construction — no validator set, no token, no trusted party in the default case. You're the only project combining capability NFTs + bonded/challengeable reputation + discovery in a single stack-agnostic protocol.

**The remaining gap:** The honest open work is **distribution and trust hardening, not reputation mechanics.** No public git repo, SDK still private, the owner-only `resolveChallenge` is the one centralized trust boundary, and Base mainnet is pending audit. Olas shipped ARS on Base mainnet in June — the window for mainnet + MCP distribution is still open but narrowing.

**The three moves that matter most (v0.1 reality):**

1. **🟢 Public repo + BaseScan verification + npm publish** — visibility and distribution. No repo exists today.
2. **🟢 Timelock/multisig on owner functions** — the one trust boundary, before mainnet.
3. **🟢 MCP server + grant application (Base Batches)** — native agent distribution + funding.

Skip the zk-proofs, skip the cross-chain, skip the governance token for now. Shipping a usable, ETH-bonded, challengeable protocol on Base mainnet beats a perfect protocol that only exists on Sepolia.

---

## APPENDIX: Key Metrics Dashboard

> Re-graded July 2026. v0.1 is ETH-only, no validators — "Validators" row removed.

| Metric | Current (v0.1, July 2026) | Target (30 days) | Target (90 days) |
|--------|--------------------------|-------------------|-------------------|
| Contracts deployed | **Base Sepolia (live)** | + BaseScan source-verified | Base Mainnet (verified, post-audit) |
| Public git repo | ❌ None | ✅ Public + README + CI | Public + starred |
| Active agents | 1 (Agent A) + Agent B (discovery demo) | 3 | 10+ |
| Real self-attested completions | Live on Sepolia | 10+ | 50+ |
| Public challenges | Live (owner-resolved) | 1 real third-party | 5+ |
| SDK on npm | ❌ Private | ✅ Published | 1000+ downloads |
| MCP server | Not built | Alpha | Live |
| Grant applied (Base Batches) | No | Yes | Funded |
| Capabilities registered | 1+ on Sepolia | 3 | 20+ |
| Tests | 22 (14 self-attest + 8 capability) | 22 + fuzz | 30+ + audited |
