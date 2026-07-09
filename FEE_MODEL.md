# TAOP Fee Model — ETH-Only Protocol (v1, July 2026)

> **Design principle:** Minimum viable fees for anti-spam today. Dormant fee switch for future monetization. Never gate growth behind profit.

## Current Fee Schedule (Live on Deploy)

| Action | Fee | Purpose | Revenue Today |
|--------|-----|---------|---------------|
| Register capability | **0.0001 ETH (~$0.25)** | Anti-Sybil. Too cheap to care, too expensive to spam. | ~$0 (0 registrations) |
| Challenge completion | **0.01 ETH (~$25)** | Game-theoretic bond. Already exists in v0.1. Refundable if challenge upheld. | ~$0 (no challenges) |
| Attest completion | **Free** (gas only) | No gate on building reputation. Agents should self-attest freely. | $0 |
| Discovery query | **Free** | The wedge. Zero friction drives API adoption and integration deals. | $0 |
| Certification | **Free** | Let the certifier earn trust first. Monetize certification later. | $0 |

**Total protocol revenue at launch:** $0. Intentional.

## Where the Value Actually Lives

| Mechanism | What It Does | Value to Protocol |
|-----------|-------------|-------------------|
| **ETH bond** (0.01 ETH) | Skin in the game for capability registration | Slashed bonds go to protocol pool (owner-withdrawable) |
| **Challenge bond** (0.01 ETH) | Economic deterrent against fraudulent self-attestation | Forfeited bonds go to protocol pool |
| **Slashing** | Punishes dishonest creators/validators | Protocol accumulates slashed value |

## Future Monetization (Dormant Fee Switch)

The contracts include a **governance-controlled fee switch** that can be enabled by a multisig → future DAO. This mirrors the Uniswap / Lido / Aave pattern — the infrastructure is there, but it's not turned on until there's actual demand.

### Fee Switch Parameters (Pre-Configured, Dormant)

| Action | Fee (dormant) | Monthly Revenue at 1M Queries | Revenue at 10M Queries |
|--------|---------------|-------------------------------|------------------------|
| Discovery query | **0.0001 ETH** (~$0.25) | **$250K/mo** | **$2.5M/mo** |
| Registration | **0.001 ETH** (~$2.50) | Negligible | ~$5K/mo |
| Certification | **0.001 ETH** (~$2.50) | Negligible | ~$2.5K/mo |

### Conservative Revenue Model (Year 2)

| Metric | Conservative | Bull Case |
|--------|-------------|-----------|
| Agent frameworks integrated | 3 (ElizaOS, LangChain, AutoGPT) | 8 (adds CrewAI, Olas, Fetch, Codex, custom) |
| Daily active agents querying | 500 | 5,000 |
| Discovery queries / agent / day | 200 | 1,000 |
| Monthly queries | **3M** | **150M** |
| Fee switch status | Dormant | Enabled at 0.00005 ETH |
| **Monthly protocol revenue** | **$0** (fee switch off) | **$187,500** |

### Treasury Flow (When Fee Switch Is On)

```
Discovery Fees (in ETH)
        │
        ▼
┌────────────────┐
│ Fee Collector   │ ← Multisig (3/5 → future DAO)
│ (contract)      │
└────────┬───────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 60% OPEX   30% Staker    10% Reserve
 (dev,       Rewards      (surplus,
  infra,     (validator    emergency
  grants)    incentives)   fund)
```

## Non-Dilutive Funding Path

| Program | Type | Amount | Likelihood | How |
|---------|------|--------|------------|-----|
| **Base Batches** | Accelerator / incubator | $25-75K | Medium-High | Quarterly cohort. Apply with the Level 2 demo + agent focus. Mentorship included. |
| **a16z Crypto Startup School** | Non-dilutive grant | $75K | Medium | Apply quarterly. Focus on infrastructure thesis. |
| **Base Ecosystem Fund** | Equity investment (not grant) | $100-500K | Low unless intro'd | VC-style process. Needs warm intro. Treat as a pre-seed round, not a grant application. |

> **Note:** The old Base Builder Grants program (which gave 1-5 ETH) has been **discontinued.** It was replaced by Base Batches (for early-stage builders) and the Base Ecosystem Fund (for venture-stage equity investments).

## Investor Narrative (One Paragraph)

> *"TAOP launches with zero friction fees — $0.25 to register a capability, everything else free. We need agents, not revenue. But every contract has a dormant fee switch. When TAOP reaches 10M discovery queries per month — a plausible milestone with 5 framework integrations — enabling a $0.0001 ETH query fee generates $2.5M/month in protocol revenue. This is the AWS free-tier strategy: build the network first, monetize later. The fee switch is a unilateral action by governance. It's already there. We just need the network to turn it on."*

## Why This Works for Pre-Seed Investors

| Concern | Answer |
|---------|--------|
| **"How do you make money?"** | We don't today. We charge $0.25 to register (anti-spam) and everything else is free. The fee switch in the contract gives us a $2.5M/mo option at 10M queries. We invest in the network now; the revenue comes later. |
| **"What if you never turn the fee switch on?"** | Then TAOP is public infrastructure, acquired for the network. Credit bureaus (Equifax, Experian) are worth $5B+ on data alone. The agent reputation dataset is the exit. |
| **"Why not charge from day one?"** | Because 10 agents paying $0 is worth more than 0 agents paying $25. Traction beats revenue at pre-seed. |
| **"No token — how do we get upside?"** | Equity + token warrant. If TAOP issues a token within 5 years, investors get X% allocation at TGE. Standard in crypto pre-seeds. |

## What We Ship Before Fundraising

| Item | Status | Effort |
|------|--------|--------|
| Fee model doc (this) | ✅ Done | 1 hour |
| Unstake function in RON | ❌ Not shipped | 1 day |
| ETH-only fee hooks in contracts | ❌ Not shipped | 1 day |
| Dormant fee switch in contracts | ❌ Not shipped | 1 day |
| Mainnet deployment (Base) | ❌ Sepolia only | 1 day |
| Public SDK on npm | ❌ Private | 30 min |

**Total remaining work before first investor conversation: ~4 engineering days.**
