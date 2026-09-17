import { ethers } from "ethers";
import { logger } from "./logger.js";
import type { BackendState } from "./contracts.js";
import {
  initIndexSchema,
  getIndexerLastBlock,
  setIndexerLastBlock,
  getIndexerLastHash,
  setIndexerLastHash,
  resetIndexerDerived,
  alreadyIndexed,
  markIndexed,
  upsertIndexedCapability,
  certifyIndexedCapability,
  slashIndexedCapability,
  deleteIndexedCapability,
  bumpAgent,
  recordIndexedCompletion,
  getCompletionAgent,
  addReceiptIndex,
  getReceiptAgent,
  deleteReceiptIndex,
  setAgentIdentity,
  getAgentIdentity,
  countIndexedCapabilities,
  queryIndexedCapabilities,
  recordAlert,
  bumpCounterparty,
  getReceiptCounterparty,
} from "./index_db.js";

/**
 * F10 — minimal off-chain indexer.
 *
 * Polls `eth_getLogs` for the RON + Registry contracts, denormalises capability
 * and reputation state into SQLite, and serves `/api/discover` from that index
 * with pagination — so discovery is no longer an O(n) JSON-RPC fan-out per
 * request. The first pass enriches each new capability/completion with a single
 * `getCapability`/`getCompletion` call because the events don't carry metadata.
 */

const REGISTRY_EVENTS = [
  "event CapabilityRegistered(uint256 capabilityId, address indexed creator)",
  "event CapabilityCertified(uint256 capabilityId, address indexed certifier)",
  "event CapabilitySlashed(uint256 capabilityId, uint256 penalty)",
  "event BondWithdrawn(uint256 capabilityId, address indexed to, uint256 amount)",
  "event EthPoolWithdrawn(address indexed to, uint256 amount)",
  "event CertifierChanged(address indexed previousCertifier, address indexed newCertifier)",
];

const RON_EVENTS = [
  "event SelfAttested(uint256 completionId, address indexed agent, bytes32 taskType)",
  "event ReceiptAttested(uint256 completionId, address indexed agent, address indexed counterparty)",
  "event ReceiptRevoked(uint256 completionId, address indexed counterparty)",
  "event ChallengeSubmitted(uint256 completionId, address indexed challenger)",
  "event ChallengeResolved(uint256 completionId, bool upheld)",
  "event EthPoolWithdrawn(address indexed to, uint256 amount)",
  "event AgentRegistered(address indexed agent, string metadataCID)",
];

const registryIface = new ethers.Interface(REGISTRY_EVENTS);
const ronIface = new ethers.Interface(RON_EVENTS);

export interface IndexerStatus {
  enabled: boolean;
  ready: boolean;
  useTwoSided: boolean;
  /** v0.3: diversity-adjusted credit score supported. */
  useCredit: boolean;
  lastBlock: number;
  headBlock: number;
  /** Highest block safe to index (head - confirmations). */
  safeHead: number;
  lag: number;
  /** Number of chain reorganizations detected and rebuilt from logs. */
  reorgsDetected: number;
  lastError: string | null;
}

const status: IndexerStatus = {
  enabled: false,
  ready: false,
  useTwoSided: false,
  useCredit: false,
  lastBlock: 0,
  headBlock: 0,
  safeHead: 0,
  lag: 0,
  reorgsDetected: 0,
  lastError: null,
};

export function indexerStatus(): IndexerStatus {
  return { ...status };
}

/** True once the index has at least one capability and the cursor is live. */
export function isIndexerReady(): boolean {
  return status.enabled && status.ready;
}

// --- decay (mirrors ReputationOracleNetwork._decayedScore) ---

let DECAY_GRACE = 30 * 24 * 3600;
let DECAY_HORIZON = 150 * 24 * 3600;

function decayedScore(count: number, disputes: number, lastActivity: number, now: number): number {
  const net = Math.max(0, count - disputes);
  if (net === 0 || lastActivity === 0) return net;
  const elapsed = now - lastActivity;
  if (elapsed <= DECAY_GRACE) return net;
  const decayed = elapsed - DECAY_GRACE;
  if (decayed >= DECAY_HORIZON) return 0;
  const bps = ((DECAY_HORIZON - decayed) * 10000) / DECAY_HORIZON;
  return Math.floor((net * Math.floor(bps)) / 10000);
}

export function computeIndexedScore(
  count: number,
  disputes: number,
  lastActivity: number,
  now = Math.floor(Date.now() / 1000),
): number {
  return decayedScore(count, disputes, lastActivity, now);
}

/** Detect whether the deployed contract supports the v0.2 two-sided view. */
async function detectTwoSided(state: BackendState): Promise<boolean> {
  try {
    const probe = new ethers.Contract(
      state.deployment.ron,
      ["function CHALLENGE_WINDOW() view returns (uint256)"],
      state.provider,
    );
    await probe.CHALLENGE_WINDOW();
    return true;
  } catch {
    return false;
  }
}

/** Detect whether the deployed contract supports the v0.3 credit score. */
async function detectCredit(state: BackendState): Promise<boolean> {
  try {
    const probe = new ethers.Contract(
      state.deployment.ron,
      ["function getCreditScore(address) view returns (uint64,uint64,uint64,uint64,uint16)"],
      state.provider,
    );
    await probe.getCreditScore(ethers.ZeroAddress);
    return true;
  } catch {
    return false;
  }
}

/** Read the decay constants once so the index score matches on-chain exactly. */
async function loadDecayConstants(state: BackendState): Promise<void> {
  try {
    const c = new ethers.Contract(
      state.deployment.ron,
      ["function DECAY_GRACE() view returns (uint256)", "function DECAY_HORIZON() view returns (uint256)"],
      state.provider,
    );
    DECAY_GRACE = Number(await c.DECAY_GRACE());
    DECAY_HORIZON = Number(await c.DECAY_HORIZON());
  } catch {
    /* keep defaults */
  }
}

/** Process a contiguous block range, applying logs in (block, index) order. */
export async function indexRange(state: BackendState, fromBlock: number, toBlock: number): Promise<void> {
  if (fromBlock > toBlock) return;
  const addresses = [state.deployment.registry.toLowerCase(), state.deployment.ron.toLowerCase()];

  const logs = await state.provider.getLogs({ address: addresses, fromBlock, toBlock });
  logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));

  const tsCache = new Map<number, number>();
  const blockTs = async (blk: number): Promise<number> => {
    if (tsCache.has(blk)) return tsCache.get(blk)!;
    const b = await state.provider.getBlock(blk);
    const t = b?.timestamp ?? Math.floor(Date.now() / 1000);
    tsCache.set(blk, t);
    return t;
  };

  for (const log of logs) {
    if (alreadyIndexed(log.transactionHash, log.index)) continue;
    const ts = await blockTs(log.blockNumber);
    const isRegistry = log.address.toLowerCase() === state.deployment.registry.toLowerCase();
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = (isRegistry ? registryIface : ronIface).parseLog(log);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      markIndexed(log.transactionHash, log.index, log.blockNumber);
      continue;
    }

    try {
      if (isRegistry) {
        await applyRegistryEvent(state, parsed, log, ts);
      } else {
        await applyRonEvent(state, parsed, log, ts);
      }
    } catch (e) {
      // Don't wedge the whole range on one bad enrichment call; retry on next poll.
      logger.warn(`[indexer] failed to apply ${parsed.name} at ${log.blockNumber}: ${String((e as Error).message ?? e)}`);
      continue;
    }
    markIndexed(log.transactionHash, log.index, log.blockNumber);
  }
}

async function applyRegistryEvent(
  state: BackendState,
  parsed: ethers.LogDescription,
  log: ethers.Log,
  ts: number,
): Promise<void> {
  const capabilityId = parsed.args[0] as bigint;
  switch (parsed.name) {
    case "CapabilityRegistered": {
      // Event has no metadata — enrich once, then it is cached in SQLite.
      const cap = await state.registryOracle.getCapability(capabilityId);
      upsertIndexedCapability({
        capabilityId,
        creator: cap.creator,
        bond: cap.bond,
        capabilityType: cap.capabilityType,
        metadataCID: cap.metadataCID,
        blockTimestamp: ts,
      });
      break;
    }
    case "CapabilityCertified":
      certifyIndexedCapability(capabilityId);
      break;
    case "CapabilitySlashed":
      slashIndexedCapability(capabilityId);
      recordAlert("CapabilitySlashed", log.blockNumber, log.transactionHash, {
        capabilityId: capabilityId.toString(),
        penalty: (parsed.args[1] as bigint).toString(),
      });
      break;
    case "BondWithdrawn":
      deleteIndexedCapability(capabilityId);
      recordAlert("BondWithdrawn", log.blockNumber, log.transactionHash, {
        capabilityId: capabilityId.toString(),
        to: parsed.args[1] as string,
        amount: (parsed.args[2] as bigint).toString(),
      });
      break;
    case "EthPoolWithdrawn":
      recordAlert("EthPoolWithdrawn", log.blockNumber, log.transactionHash, {
        contract: "CapabilityRegistry",
        to: parsed.args[0] as string,
        amount: (parsed.args[1] as bigint).toString(),
      });
      break;
    case "CertifierChanged":
      recordAlert("CertifierChanged", log.blockNumber, log.transactionHash, {
        previousCertifier: parsed.args[0] as string,
        newCertifier: parsed.args[1] as string,
      });
      break;
    default:
      break;
  }
  void log;
}

async function applyRonEvent(
  state: BackendState,
  parsed: ethers.LogDescription,
  log: ethers.Log,
  ts: number,
): Promise<void> {
  switch (parsed.name) {
    case "SelfAttested": {
      const completionId = parsed.args[0] as bigint;
      const agent = (parsed.args[1] as string).toLowerCase();
      const taskType = parsed.args[2] as string;
      let resultCID = "";
      try {
        const c = await state.ron.getCompletion(completionId);
        resultCID = c.resultCID;
      } catch {
        /* keep empty */
      }
      recordIndexedCompletion({ completionId, agent, taskType, resultCID, timestamp: ts, txHash: log.transactionHash });
      bumpAgent(agent, { completions: 1, lastActivity: ts });
      break;
    }
    case "ReceiptAttested": {
      const completionId = parsed.args[0] as bigint;
      const agent = (parsed.args[1] as string).toLowerCase();
      const counterparty = (parsed.args[2] as string).toLowerCase();
      addReceiptIndex(completionId, agent, counterparty, ts);
      bumpAgent(agent, { confirmed: 1, lastActivity: ts });
      bumpCounterparty(agent, counterparty, 1);
      break;
    }
    case "ReceiptRevoked": {
      const completionId = parsed.args[0] as bigint;
      const agent = getReceiptAgent(completionId);
      const counterparty = getReceiptCounterparty(completionId);
      if (agent) bumpAgent(agent, { confirmed: -1 });
      if (agent && counterparty) bumpCounterparty(agent, counterparty, -1);
      deleteReceiptIndex(completionId);
      break;
    }
    case "ChallengeSubmitted": {
      const completionId = parsed.args[0] as bigint;
      const challenger = (parsed.args[1] as string).toLowerCase();
      recordAlert("ChallengeSubmitted", log.blockNumber, log.transactionHash, {
        completionId: completionId.toString(),
        challenger,
      });
      break;
    }
    case "ChallengeResolved": {
      const completionId = parsed.args[0] as bigint;
      const upheld = parsed.args[1] as boolean;
      recordAlert("ChallengeResolved", log.blockNumber, log.transactionHash, {
        completionId: completionId.toString(),
        upheld,
      });
      if (upheld) {
        const agent = getCompletionAgent(completionId);
        if (agent) {
          bumpAgent(agent, { disputes: 1 });
          const counterparty = getReceiptCounterparty(completionId);
          if (counterparty) {
            bumpAgent(agent, { confirmed: -1 });
            bumpCounterparty(agent, counterparty, -1);
            deleteReceiptIndex(completionId);
          }
        }
      }
      break;
    }
    case "EthPoolWithdrawn":
      recordAlert("EthPoolWithdrawn", log.blockNumber, log.transactionHash, {
        contract: "ReputationOracleNetwork",
        to: parsed.args[0] as string,
        amount: (parsed.args[1] as bigint).toString(),
      });
      break;
    case "AgentRegistered": {
      const agent = (parsed.args[0] as string).toLowerCase();
      const metadataCID = parsed.args[1] as string;
      setAgentIdentity(agent, metadataCID);
      break;
    }
    default:
      break;
  }
}

// --- lifecycle ---

let pollTimer: NodeJS.Timeout | null = null;

export interface PollOptions {
  startBlock: number;
  chunkSize: number;
  /** Only index up to `head - confirmations` so shallow reorgs are never indexed. */
  confirmations: number;
  maxChunks: number;
}

/**
 * One indexing pass (exported for tests). Indexes only up to
 * `head - confirmations`; if the last-indexed block's hash no longer matches the
 * chain (a reorg deeper than the confirmation depth), the derived state is
 * rebuilt from logs.
 */
export async function pollOnce(state: BackendState, opts: PollOptions): Promise<void> {
  const head = await state.provider.getBlockNumber();
  status.headBlock = head;
  const safeHead = head - opts.confirmations;
  status.safeHead = Math.max(0, safeHead);

  // Reorg detection: the block we last indexed must still have the same hash.
  let cursor = getIndexerLastBlock();
  if (cursor !== null && cursor > 0) {
    const stored = getIndexerLastHash();
    let chainHash: string | null = null;
    try {
      const b = await state.provider.getBlock(cursor);
      chainHash = b?.hash ?? null;
    } catch {
      chainHash = null;
    }
    if (stored && chainHash && stored !== chainHash) {
      status.reorgsDetected += 1;
      logger.warn(
        { block: cursor, stored, chainHash },
        "[indexer] reorg detected — rebuilding index from logs",
      );
      resetIndexerDerived();
      cursor = null;
    }
  }

  let from = cursor === null ? opts.startBlock - 1 : cursor;
  let chunks = 0;
  while (from < safeHead && chunks < opts.maxChunks) {
    const to = Math.min(safeHead, from + opts.chunkSize);
    await indexRange(state, from + 1, to);
    setIndexerLastBlock(to);
    try {
      const b = await state.provider.getBlock(to);
      setIndexerLastHash(b?.hash ?? "");
    } catch {
      setIndexerLastHash("");
    }
    from = to;
    chunks++;
  }
  status.lastBlock = getIndexerLastBlock() ?? opts.startBlock;
  status.lag = Math.max(0, head - status.lastBlock);
  status.lastError = null;
  status.ready = true;
}

export async function startIndexer(state: BackendState): Promise<void> {
  if ((process.env.INDEXER_ENABLED ?? "true").toLowerCase() === "false") {
    status.enabled = false;
    logger.info("[indexer] disabled (INDEXER_ENABLED=false)");
    return;
  }
  status.enabled = true;
  initIndexSchema();

  const pollMs = Number(process.env.INDEXER_POLL_MS ?? 15000);
  const chunkSize = Number(process.env.INDEXER_CHUNK_SIZE ?? 2000);
  const confirmations = Number(process.env.INDEXER_CONFIRMATIONS ?? 5);
  const lookback = Number(process.env.INDEXER_LOOKBACK_BLOCKS ?? 50000);
  const maxChunks = Number(process.env.INDEXER_MAX_CHUNKS_PER_TICK ?? 20);

  await loadDecayConstants(state);
  status.useTwoSided = await detectTwoSided(state);
  status.useCredit = status.useTwoSided ? await detectCredit(state) : false;

  const head = await state.provider.getBlockNumber();
  const explicitStart = process.env.INDEXER_START_BLOCK ? Number(process.env.INDEXER_START_BLOCK) : undefined;
  const deployedBlock = (state.deployment as { deployedBlock?: number }).deployedBlock;
  const startBlock = explicitStart ?? deployedBlock ?? Math.max(0, head - lookback);

  const opts: PollOptions = { startBlock, chunkSize, confirmations, maxChunks };

  const poll = async (): Promise<void> => {
    try {
      await pollOnce(state, opts);
    } catch (e) {
      status.lastError = String((e as Error).message ?? e);
      logger.warn({ err: status.lastError }, "[indexer] poll failed");
    }
  };

  await poll();
  pollTimer = setInterval(poll, pollMs);
  if (typeof pollTimer.unref === "function") pollTimer.unref();
  logger.info(
    { pollMs, chunkSize, startBlock, confirmations, twoSided: status.useTwoSided },
    "[indexer] started",
  );
}

export function stopIndexer(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// --- read path for /api/discover ---

export interface IndexedDiscoveryItem {
  agentAddress: string;
  capabilityId: string;
  capabilityType: string;
  certified: boolean;
  slashed: boolean;
  bond: string;
  metadataCID: string;
  identityCID: string;
  completions: number;
  disputes: number;
  score: number;
  scoreType: "credit" | "two-sided" | "self-attest";
}

export function queryIndexedDiscovery(opts: {
  capabilityType: string;
  minScore: number;
  offset: number;
  limit: number;
  now?: number;
}): { items: IndexedDiscoveryItem[]; total: number } {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const rows = queryIndexedCapabilities(opts.capabilityType);
  const scored: IndexedDiscoveryItem[] = [];

  for (const r of rows) {
    // Best available signal: credit (v0.3 distinct) > two-sided > self-attest.
    const count = status.useCredit ? r.distinct_count : status.useTwoSided ? r.confirmed : r.completions;
    const score = computeIndexedScore(count, r.disputes, r.last_activity, now);
    if (score < opts.minScore) continue;
    scored.push({
      agentAddress: r.creator,
      capabilityId: String(r.capability_id),
      capabilityType: opts.capabilityType,
      certified: r.certified === 1,
      slashed: r.slashed === 1,
      bond: ethers.formatEther(BigInt(r.bond)),
      metadataCID: r.metadata_cid,
      identityCID: getAgentIdentity(r.creator),
      completions: count,
      disputes: r.disputes,
      score,
      scoreType: status.useTwoSided ? "two-sided" : "self-attest",
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const total = scored.length;
  const items = scored.slice(opts.offset, opts.offset + opts.limit);
  return { items, total };
}

export function indexedCount(capabilityType: string): number {
  try {
    return countIndexedCapabilities(capabilityType);
  } catch {
    return 0;
  }
}
