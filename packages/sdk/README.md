# @taopp/sdk

TypeScript SDK for the TAOP contracts — the Credit Bureau
(`ReputationOracleNetwork`) and the capability registry (`CapabilityRegistry`).

> **⚠️ Pre-mainnet / early access.** Targets the Base Sepolia pilot. Contracts and
> API are still evolving; breaking changes may occur before mainnet.

## Installation

```bash
npm install @taopp/sdk
```

## Read-only

```ts
import { ethers } from "ethers";
import {
  ReputationOracleNetworkClient,
  CapabilityRegistryClient,
  discover,
} from "@taopp/sdk";

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");

const ron = new ReputationOracleNetworkClient(
  "0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356", // live Base Sepolia
  provider,
);
const registry = new CapabilityRegistryClient(
  "0x2E72Ada571df608AC1C811174A1921CAaDE46362", // live Base Sepolia
  provider,
);

// Legacy self-attest score: { completions, disputes, score }
console.log(await ron.getSelfAttestScore("0xAgent..."));

// v0.2 two-sided score: { confirmed, disputes, score, lastActivity, decayBps }
console.log(await ron.getTwoSidedScore("0xAgent..."));

// Prefer this for ranking — it picks the best score the deployment supports
// (two-sided on v0.2, self-attest on the current pilot).
console.log(await ron.getRankingScore("0xAgent..."));

// Discovery (indexed; resilient to stale ids). `scoreType` says which signal won.
const best = await discover(registry, ron, "LoRA", 1);
console.log(best[0]);

// Paginated capability views (v0.2): metadata-carried of live ids
console.log(await registry.countCapabilitiesByType("LoRA"));
console.log(await registry.getCapabilitiesByTypePaged("LoRA", 0, 10));
```

## Write operations (signer required)

```ts
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const ronWrite = new ReputationOracleNetworkClient(RON, signer);

const { completionId } = await ronWrite.attestCompletion("summarization", "ipfs://Qm...");
await ronWrite.attestReceipt(completionId, "ipfs://QmRequesterReceipt"); // two-sided (v0.2)
await ronWrite.revokeReceipt(completionId);                             // withdraw endorsement
await ronWrite.challengeCompletion(completionId, "ipfs://QmEvidence", await ronWrite.challengeBond());
await ronWrite.contestChallenge(completionId, "ipfs://QmRebuttal");     // agent, within window
await ronWrite.finalizeChallenge(completionId);                         // permissionless, after window
```

### v0.2 semantics

A completion counts toward the **two-sided** score only once an independent
requester countersigns it (`attestReceipt`). A challenge opens a
`CHALLENGE_WINDOW`; the agent may `contestChallenge` with a rebuttal, otherwise
anyone can `finalizeChallenge` after the window and it is upheld optimistically.
An upheld dispute invalidates the receipt.

> On the current v0.1.2 pilot these v0.2 calls revert; `getRankingScore` and
> `discover` fall back to the self-attest score automatically. They activate once
> the v0.2 contracts are deployed.

Admin functions (`resolveChallenge`, `withdrawEthPool`, `setCertifier`) are
`onlyOwner` via a `TimelockController`.

## Live addresses (Base Sepolia)

See the repo [`README.md`](../../README.md) / `deployments.json.example` for the
latest. SDK-relevant contracts: `ron`, `registry`, `timelock`.

## Build from source

```bash
npm run build -w @taopp/sdk
```

Generated API reference: `npm run docs:api` (repo root) → `docs/api/`.

## License

MIT
