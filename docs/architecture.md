# Architecture

TAOP is two on-chain contracts on Base plus a thin set of clients. On-chain truth
is the source of record; everything else is a cache or a view.

## System overview

```mermaid
graph TD
    subgraph Agents
      A[Agent A<br/>self-attests, contests]
      B[Agent B / Requester<br/>countersigns receipts]
      C[Challenger<br/>posts ETH bond]
    end

    subgraph Clients
      SDK["@taopp/sdk<br/>(TS)"]
      PY["taop<br/>(Python)"]
      MCP["@taopp/mcp-server<br/>(stdio)"]
      UI[Demo UI<br/>apps/demo]
      READONLY[Read-only demo<br/>apps/static-demo · GitHub Pages]
    end

    subgraph Backend["Backend (Node/Express, holds hot keys)"]
      API[REST API]
      ORCH[Demo orchestrator<br/>+ IPFS pinning]
      IX[Log indexer<br/>eth_getLogs → SQLite]
      DB[(SQLite<br/>capabilities · scores · alerts)]
    end

    subgraph Chain["Base Sepolia / Base"]
      RON[ReputationOracleNetwork]
      REG[CapabilityRegistry]
      TL[TimelockController<br/>owner]
    end

    IPFS[(IPFS / Pinata)]

    A & B & C --> SDK & PY & UI
    MCP --> SDK
    SDK --> RON & REG
    PY --> RON & REG
    READONLY --> RON & REG
    UI --> API
    API --> ORCH --> RON & REG
    ORCH --> IPFS
    IX --> RON & REG
    IX --> DB
    API --> DB
    TL -. onlyOwner .-> RON & REG
```

## Two-sided lifecycle (v0.2)

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent A
    participant R as Requester
    participant C as Challenger
    participant O as Owner (Timelock)
    participant RON as ReputationOracleNetwork

    A->>RON: attestCompletion(taskType, resultCID)
    R->>RON: attestReceipt(completionId, receiptCID)
    Note over RON: confirmedCount++ → two-sided score
    R-->>RON: revokeReceipt (optional)
    C->>RON: challengeCompletion{0.01 ETH}
    Note over RON: opens CHALLENGE_WINDOW (3 days)
    alt Agent rebuts in time
        A->>RON: contestChallenge(completionId, rebuttalCID)
        O->>RON: resolveChallenge(upheld)
    else Agent stays silent
        C->>RON: finalizeChallenge(completionId)  (permissionless, after window)
        Note over RON: upheld optimistically; receipt invalidated
    end
```

## Challenge state machine

```mermaid
stateDiagram-v2
    [*] --> Pending: challengeCompletion (+bond)
    Pending --> Contested: contestChallenge (agent, within window)
    Pending --> Upheld: finalizeChallenge (anyone, after window)
    Contested --> Upheld: resolveChallenge(upheld=true) by owner
    Contested --> Rejected: resolveChallenge(upheld=false) by owner
    Upheld --> [*]: disputeCount++, challenger refunded, receipt cleared
    Rejected --> [*]: challenger bond forfeited to slashedEthPool
```

## Trust boundaries

- **On-chain truth:** scores, bonds, dispute state, capability index. Discovery
  reads it directly or via the index.
- **Owner = TimelockController.** At the pilot it is 0-delay, single-EOA
  proposer/executor; mainnet requires a multisig + non-zero delay
  (`hardened-timelock.md`).
- **Backend = trusted operator.** Holds hot keys and can spend bonds / pin to
  IPFS — run it privately (`TAOP_API_KEY`, loopback) and expose only the
  read-only instance (`DEMO_READ_ONLY=true`).
- **Indexer = rebuildable cache.** Never authoritative; reorg-aware and
  reconstructible from logs. `/api/discover` falls back to direct chain reads.

See [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md), [`EMERGENCY.md`](EMERGENCY.md)
and [`OPERATIONS.md`](OPERATIONS.md).
