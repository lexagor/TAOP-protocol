import "dotenv/config";
import { ethers } from "ethers";
import path from "node:path";
import {
  ReputationOracleNetworkClient,
  CapabilityRegistryClient,
  loadDeployment,
  LORA_CAPABILITY_TYPE,
  type Deployment,
} from "@taop/sdk";
import { isCapabilityRegistered, recordCapability, getMeta, setMeta } from "./db.js";
import { pinJSON, buildModelCard } from "./ipfs.js";

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const DEMO_BOND_ETH = "0.01";

export interface BackendState {
  deployment: Deployment;
  provider: ethers.JsonRpcProvider;
  oracleAddress: string;
  agentAAddress: string;
  ron: ReputationOracleNetworkClient;
  ronAgentA: ReputationOracleNetworkClient;
  registryOracle: CapabilityRegistryClient;
  registryAgentA: CapabilityRegistryClient;
  capabilityId: bigint;
  capabilityMetadataCID: string;
  taskCounter: number;
}

let _state: BackendState | null = null;

function deriveWallet(mnemonic: string, index: number, provider: ethers.JsonRpcProvider): ethers.HDNodeWallet {
  const mn = ethers.Mnemonic.fromPhrase(mnemonic);
  return ethers.HDNodeWallet.fromMnemonic(mn, `m/44'/60'/0'/0/${index}`).connect(provider);
}

/** Build a NonceManager-wrapped signer so back-to-back txs get sequential nonces. */
function makeRunner(pk: string | undefined, mnemonicIndex: number, provider: ethers.JsonRpcProvider): ethers.NonceManager {
  const wallet: ethers.Signer = pk ? new ethers.Wallet(pk, provider) : deriveWallet(HARDHAT_MNEMONIC, mnemonicIndex, provider);
  return new ethers.NonceManager(wallet);
}

export async function initState(): Promise<BackendState> {
  if (_state) return _state;
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const deploymentsPath = process.env.DEPLOYMENTS_PATH || path.resolve(process.cwd(), "deployments.json");
  const deployment = await loadDeployment(deploymentsPath);

  const provider = new ethers.JsonRpcProvider(rpcUrl, deployment.chainId);

  const oracleRunner = makeRunner(process.env.ORACLE_PK || process.env.DEPLOYER_PK, 0, provider);
  const agentARunner = makeRunner(process.env.AGENT_A_PK, 1, provider);
  const oracleAddress = await oracleRunner.getAddress();
  const agentAAddress = await agentARunner.getAddress();

  const ron = new ReputationOracleNetworkClient(deployment.ron, oracleRunner);
  const ronAgentA = new ReputationOracleNetworkClient(deployment.ron, agentARunner);
  const registryOracle = new CapabilityRegistryClient(deployment.registry, oracleRunner);
  const registryAgentA = new CapabilityRegistryClient(deployment.registry, agentARunner);

  const state: BackendState = {
    deployment,
    provider,
    oracleAddress,
    agentAAddress,
    ron,
    ronAgentA,
    registryOracle,
    registryAgentA,
    capabilityId: 0n,
    capabilityMetadataCID: "ipfs://taop-demo-lora-summarization-v1",
    taskCounter: 0,
  };
  _state = state;
  await ensureCapability(state);
  return state;
}

/** Ensure Agent A has a certified LoRA capability registered with an ETH bond.
 *  Checks DB first; only registers on-chain if not present. Pins a real model
 *  card to IPFS at registration time. */
export async function ensureCapability(state: BackendState): Promise<void> {
  const { registryOracle, registryAgentA, agentAAddress } = state;
  const loraHash = ethers.id(LORA_CAPABILITY_TYPE).toLowerCase();

  // 1. Check DB cache — if we've already registered, just restore the id.
  const dbId = isCapabilityRegistered(agentAAddress, LORA_CAPABILITY_TYPE);
  if (dbId) {
    state.capabilityId = dbId;
    // Ensure it's certified on-chain (idempotent).
    const cap = await registryOracle.getCapability(dbId);
    if (!cap.certified) await registryOracle.certifyCapability(dbId);
    return;
  }

  // 2. Check on-chain (in case DB was wiped but chain wasn't).
  const total = await registryOracle.totalSupply();
  for (let i = 0n; i < total; i++) {
    const id = await registryOracle.tokenByIndex(i);
    const cap = await registryOracle.getCapability(id);
    if (
      cap.creator.toLowerCase() === agentAAddress.toLowerCase() &&
      cap.capabilityType.toLowerCase() === loraHash
    ) {
      state.capabilityId = id;
      if (!cap.certified) await registryOracle.certifyCapability(id);
      recordCapability({
        capabilityId: id,
        creator: cap.creator,
        bond: cap.bond,
        capabilityType: LORA_CAPABILITY_TYPE,
        metadataCID: cap.metadataCID,
        certified: true,
      });
      return;
    }
  }

  // 3. Register fresh: pin a real model card to IPFS, then register on-chain.
  const modelCard = buildModelCard({
    name: "TAOP Demo Summarization LoRA",
    baseModel: "openai/gpt-4.1-nano",
    loraAdapter: "taop-demo-summarization-prompt-v1",
    taskType: LORA_CAPABILITY_TYPE,
    benchmark: "qualitative: concise 2-3 sentence summaries on demo corpus",
    creator: agentAAddress,
  });
  const metadataCID = await pinJSON(modelCard, "taop-capability-summarization-v1");
  state.capabilityMetadataCID = metadataCID;

  const bond = ethers.parseEther(DEMO_BOND_ETH);
  const { capabilityId } = await registryAgentA.registerCapabilityEth(
    LORA_CAPABILITY_TYPE,
    metadataCID,
    bond,
  );
  await registryOracle.certifyCapability(capabilityId);
  state.capabilityId = capabilityId;

  recordCapability({
    capabilityId,
    creator: agentAAddress,
    bond,
    capabilityType: LORA_CAPABILITY_TYPE,
    metadataCID,
    certified: true,
  });
  setMeta("capability_registered_at", new Date().toISOString());
}
