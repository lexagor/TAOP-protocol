# @taopp/sdk

TypeScript SDK for interacting with the TAOP (Agent Credit Bureau + LoRA Guilds) contracts.

> **⚠️ Pre-Mainnet / Early Access Notice**
>
> This SDK targets the **current testnet deployment** on Base Sepolia.
> The contracts and API are still evolving. Breaking changes may occur before mainnet.
> Use at your own risk for development and experimentation only.

## Installation

```bash
npm install @taopp/sdk
```

## Usage

### Read-only example

```ts
import { ethers } from "ethers";
import {
  ReputationOracleNetworkClient,
  CapabilityRegistryClient,
} from "@taopp/sdk";

// Use a public or private RPC for Base Sepolia
const provider = new ethers.JsonRpcProvider("https://base-sepolia.infura.io/v3/YOUR_KEY");

const ron = new ReputationOracleNetworkClient(
  "0x716EB78D4E7B297b53d9962e3952228691e3CEaA",  // live Base Sepolia
  provider
);

// Get reputation score for an agent
const score = await ron.getSelfAttestScore("0xAgentAddress...");
console.log(score);
// → { completions: 5n, disputes: 1n, score: 4n }

const registry = new CapabilityRegistryClient(
  "0x6132175a065295A51FC6d0eA8f1a7456F5c82019",  // live Base Sepolia
  provider
);

const cap = await registry.getCapability(1n);
console.log(cap);
```

### Write operations (requires a signer)

```ts
const signer = new ethers.Wallet("0xYOUR_PRIVATE_KEY", provider);

const ronWrite = new ReputationOracleNetworkClient(
  "0x716EB78D4E7B297b53d9962e3952228691e3CEaA",  // live Base Sepolia
  signer
);

const { completionId, receipt } = await ronWrite.attestCompletion(
  "summarization",
  "ipfs://QmYourResultCID..."
);

console.log("Attested completion:", completionId.toString());
```

> **Note:** Write operations on the live Sepolia deployment currently use a TimelockController for admin functions (resolve, withdraw). Most user actions like `attestCompletion`, `challengeCompletion`, and `registerCapability` can be called directly.

## Live Addresses (Base Sepolia)

See the main project `README.md` or `deployments.json` for the latest addresses.

## Building from source

```bash
npm run build -w @taopp/sdk
```

## License

MIT
