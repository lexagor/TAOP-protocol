import "dotenv/config";
import { logger } from "./logger.js";
import { ethers } from "ethers";
import path from "node:path";
import {
  ReputationOracleNetworkClient,
  CapabilityRegistryClient,
  loadDeployment,
  LORA_CAPABILITY_TYPE,
  type Deployment,
} from "@taopp/sdk";
import { isCapabilityRegistered, recordCapability, getMeta, setMeta, db } from "./db.js";
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
  timelock: ethers.Contract | null;
  timelockDelay: bigint;
  executeViaTimelock: ((target: string, data: string, value?: bigint) => Promise<TimelockResult>) | null;
  capabilityId: bigint;
  capabilityMetadataCID: string;
  taskCounter: number;
  // Runners exposed for nonce reset (public RPCs often cause "nonce too low" desync)
  oracleRunner: ethers.NonceManager;
  agentARunner: ethers.NonceManager;
}

export interface TimelockResult {
  receipt: ethers.TransactionReceipt | null;
  executed: boolean;
  scheduled: boolean;
  delay: bigint;
}

let _state: BackendState | null = null;

function deriveWallet(mnemonic: string, index: number, provider: ethers.JsonRpcProvider): ethers.HDNodeWallet {
  const mn = ethers.Mnemonic.fromPhrase(mnemonic);
  return ethers.HDNodeWallet.fromMnemonic(mn, `m/44'/60'/0'/0/${index}`).connect(provider);
}

/** Build a NonceManager-wrapped signer so back-to-back txs get sequential nonces.
 *  Override getNonce to always query fresh max(latest, pending) to avoid
 *  stale nonce issues common with public L2 RPCs.
 */
function makeRunner(pk: string | undefined, mnemonicIndex: number, provider: ethers.JsonRpcProvider): ethers.NonceManager {
  const wallet: ethers.Signer = pk ? new ethers.Wallet(pk, provider) : deriveWallet(HARDHAT_MNEMONIC, mnemonicIndex, provider);
  const manager = new ethers.NonceManager(wallet);
  const origGetNonce = manager.getNonce.bind(manager);
  // Patch to force a fresh query every time. Use raw `eth_getTransactionCount`
  // rather than `provider.getTransactionCount`, which ethers caches — that cache
  // is the usual cause of "nonce too low" on public RPCs and fast local nodes.
  (manager as any).getNonce = async (blockTag?: string) => {
    if (blockTag === "pending" || !blockTag) {
      const addr = await wallet.getAddress();
      const [latest, pending] = (await Promise.all([
        provider.send("eth_getTransactionCount", [addr, "latest"]),
        provider.send("eth_getTransactionCount", [addr, "pending"]),
      ])) as [string, string];
      return Math.max(Number(latest), Number(pending));
    }
    return origGetNonce(blockTag);
  };
  return manager;
}

export async function initState(): Promise<BackendState> {
  if (_state) return _state;
  const rpcUrl = process.env.RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
  const deploymentsPath = process.env.DEPLOYMENTS_PATH || path.resolve(process.cwd(), "deployments.json");
  const deployment = await loadDeployment(deploymentsPath);

  const provider = new ethers.JsonRpcProvider(rpcUrl, deployment.chainId);

  const oracleRunner = makeRunner(process.env.ORACLE_PK || process.env.DEPLOYER_PK, 0, provider);

  // SECURITY (Phase 0): key material comes from the environment (.env, gitignored).
  // `deployments.json` is a publishable artifact and must never hold keys — a
  // legacy file that still does is accepted with a loud warning so operators can
  // migrate, but the environment always wins.
  const legacyFilePk = (deployment as { agentAPk?: string }).agentAPk;
  if (legacyFilePk) {
    logger.warn(
      "[backend] SECURITY WARNING: deployments.json still contains 'agentAPk' — remove it and set AGENT_A_PK in .env " +
        "(deployments.json is publishable, see SECURITY.md).",
    );
  }
  const agentAPk = process.env.AGENT_A_PK || legacyFilePk;
  if (!agentAPk) {
    throw new Error(
      "No Agent A key found: set AGENT_A_PK in .env (running `npm run deploy:sepolia` generates and persists one).",
    );
  }
  const agentARunner = makeRunner(agentAPk, 1, provider);
  const oracleAddress = await oracleRunner.getAddress();
  const agentAAddress = await agentARunner.getAddress();

  const ron = new ReputationOracleNetworkClient(deployment.ron, oracleRunner);
  const ronAgentA = new ReputationOracleNetworkClient(deployment.ron, agentARunner);
  const registryOracle = new CapabilityRegistryClient(deployment.registry, oracleRunner);
  const registryAgentA = new CapabilityRegistryClient(deployment.registry, agentARunner);

  // Timelock support (P0 ownership hardening). If present, admin actions (resolve, withdraws, setCertifier) go through it.
  let timelock: ethers.Contract | null = null;
  if (deployment.timelock) {
    const timelockAbi = [
      "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) external",
      "function execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) external payable",
      "function getMinDelay() view returns (uint256)",
      "function hashOperation(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
      "function isOperationReady(bytes32 id) view returns (bool)",
      "function getOperationState(bytes32 id) view returns (uint8)"
    ];
    timelock = new ethers.Contract(deployment.timelock, timelockAbi, oracleRunner);
  }

  let currentTimelockDelay = 0n;
  if (timelock) {
    currentTimelockDelay = await timelock.getMinDelay();
    if (currentTimelockDelay > 0n) {
      logger.info(`[Timelock] Current minDelay = ${currentTimelockDelay}s (non-zero delay mode)`);
    }
  }

  /** Execute a call via Timelock (handles schedule + execute).
   *  For delay=0 this is synchronous. For >0 it only schedules (caller/keeper must call execute later).
   *  Returns structured result so callers (demo/backend) can react appropriately.
   */
  async function executeViaTimelock(target: string, data: string, value: bigint = 0n): Promise<TimelockResult> {
    if (!timelock) {
      throw new Error("No timelock configured");
    }
    // Always reset before admin actions (public RPC nonce/lag issues)
    (oracleRunner as any)?.reset?.();

    const salt = ethers.id(`taop-${Date.now()}-${Math.random()}`);
    const predecessor = ethers.ZeroHash;
    const delay = await timelock.getMinDelay();

    const scheduleTx = await timelock.schedule(target, value, data, predecessor, salt, delay);
    const scheduleReceipt = await scheduleTx.wait();

    if (delay > 0n) {
      logger.warn(
        `[Timelock] Admin action scheduled with ${delay}s delay. ` +
        `It will NOT execute immediately. Use the Timelock UI or a keeper to execute after the delay.`
      );
      return {
        receipt: scheduleReceipt,
        executed: false,
        scheduled: true,
        delay,
      };
    }

    // For delay=0: after schedule.wait(), poll until the operation is Ready.
    // This is required because on public L2 RPCs (e.g. Base), a just-mined schedule
    // may not be immediately visible to the next eth_estimateGas / send for execute.
    // Without this, execute can revert with TimelockUnexpectedOperationState (expected Ready).
    const id = await timelock.hashOperation(target, value, data, predecessor, salt);
    let ready = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        ready = await timelock.isOperationReady(id);
      } catch {}
      if (ready) break;
      if (attempt > 0) {
        logger.info(`[Timelock] waiting for 0-delay operation to become Ready (attempt ${attempt + 1})...`);
      }
      await new Promise((r) => setTimeout(r, 700));
      // also reset in case of any transient signer state
      (oracleRunner as any)?.reset?.();
    }
    if (!ready) {
      // As a last resort, try execute anyway (it may still work or surface a clearer error)
      logger.warn(`[Timelock] operation ${id} not yet Ready after polling; attempting execute anyway`);
    }

    const execTx = await timelock.execute(target, value, data, predecessor, salt);
    const execReceipt = await execTx.wait();
    return {
      receipt: execReceipt,
      executed: true,
      scheduled: false,
      delay: 0n,
    };
  }

  const state: BackendState = {
    deployment,
    provider,
    oracleAddress,
    agentAAddress,
    ron,
    ronAgentA,
    registryOracle,
    registryAgentA,
    timelock,
    timelockDelay: currentTimelockDelay,
    executeViaTimelock: timelock ? executeViaTimelock : null,
    capabilityId: 0n,
    capabilityMetadataCID: "ipfs://taop-demo-lora-summarization-v1",
    taskCounter: 0,
    oracleRunner,
    agentARunner,
  };
  _state = state;
  await ensureCapability(state);
  return state;
}

/** Ensure Agent A has a certified LoRA capability registered with an ETH bond.
 *  Checks DB first; only registers on-chain if not present. Pins a real model
 *  card to IPFS at registration time. */
export async function ensureCapability(state: BackendState): Promise<void> {
  const { registryOracle, registryAgentA, agentAAddress, oracleRunner, agentARunner, deployment } = state;
  // Reset nonces before any potential writes to avoid nonce-too-low errors
  // from public RPCs, previous processes, or failed txs.
  agentARunner?.reset?.();
  oracleRunner?.reset?.();
  const loraHash = ethers.id(LORA_CAPABILITY_TYPE).toLowerCase();

  // Invalidate capability cache if the registry address has changed (e.g. after redeploy).
  // Old capability IDs are meaningless on a new registry.
  const currentRegistry = deployment.registry.toLowerCase();
  const lastRegistry = getMeta("last_registry")?.toLowerCase();
  if (lastRegistry && lastRegistry !== currentRegistry) {
    logger.info(`[ensureCapability] Registry changed (old: ${lastRegistry} new: ${currentRegistry}) — clearing stale capability and completion caches`);
    db().prepare("DELETE FROM capabilities").run();
    db().prepare("DELETE FROM completions").run();
    setMeta("last_registry", currentRegistry);
  } else if (!lastRegistry) {
    setMeta("last_registry", currentRegistry);
  }

  // 1. Check DB cache — if we've already registered, just restore the id.
  // Validate against current registry to handle redeploys (old ids won't exist on new registry).
  const dbId = isCapabilityRegistered(agentAAddress, LORA_CAPABILITY_TYPE);
  if (dbId) {
    let useCached = false;
    try {
      const cap = await registryOracle.getCapability(dbId);
      if (cap.creator.toLowerCase() === agentAAddress.toLowerCase()) {
        useCached = true;
        state.capabilityId = dbId;
        if (!cap.certified) await registryOracle.certifyCapability(dbId);
      }
    } catch {
      // NoSuchCapability or other — cache is stale (common after `npm run deploy:sepolia`)
      logger.warn(`[ensureCapability] Cached capabilityId ${dbId} invalid on current registry (likely after redeploy), will scan/register fresh.`);
    }
    if (useCached) return;
  }

  // 2. Check on-chain (in case DB was wiped but chain wasn't).
  const total = await registryOracle.totalSupply();
  for (let i = 0n; i < total; i++) {
    const id = await registryOracle.tokenByIndex(i);
    if (id === 0n) {
      logger.warn("[ensureCapability] tokenByIndex returned 0, skipping (should not happen)");
      continue;
    }
    let cap;
    try {
      cap = await registryOracle.getCapability(id);
    } catch (e) {
      const reason = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e);
      logger.warn(`[ensureCapability] getCapability(${id}) failed on current registry, skipping: ${reason}`);
      continue;
    }
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
  // L2 read-after-write lag: public RPC replicas may serve the registration a
  // few seconds late, and certifying too early reverts NoSuchCapability at the
  // estimateGas stage. Wait until the capability is visible first.
  let visible = false;
  for (let i = 0; i < 10; i++) {
    try {
      await registryOracle.getCapability(capabilityId);
      visible = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!visible) {
    throw new Error(`Capability ${capabilityId} not visible after register (L2 lag exceeded).`);
  }
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
