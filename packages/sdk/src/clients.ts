import { ethers, type Contract, type ContractRunner, type ContractTransactionReceipt } from "ethers";
import { RON_ABI, CAPABILITY_REGISTRY_ABI } from "./abis.js";
import type { Capability, Completion, ScoreDetails, SelfAttestScore } from "./types.js";

/** Extract an event argument from a receipt (v0.1.2): ids must come from the
 *  emitted event, never from supply counters (which diverge after burns). */
function parseEventId(
  receipt: ContractTransactionReceipt | null,
  contract: Contract,
  eventName: string,
  argName: string,
): bigint | null {
  if (!receipt) return null;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        const value = parsed.args.getValue(argName) ?? parsed.args[0];
        return BigInt(value);
      }
    } catch {
      // log emitted by another contract in the same tx — ignore
    }
  }
  return null;
}

export class ReputationOracleNetworkClient {
  private readonly c: Contract;
  constructor(address: string, runner?: ContractRunner) {
    this.c = new ethers.Contract(address, RON_ABI, runner);
  }
  get address(): string {
    return this.c.target as string;
  }
  completionCount(agent: string): Promise<bigint> {
    return this.c.completionCount(agent) as Promise<bigint>;
  }
  disputeCount(agent: string): Promise<bigint> {
    return this.c.disputeCount(agent) as Promise<bigint>;
  }

  async attestCompletion(taskType: string, resultCID: string): Promise<{ completionId: bigint; receipt: ContractTransactionReceipt | null }> {
    const tx = await this.c.attestCompletion(ethers.id(taskType), resultCID);
    const receipt = (await tx.wait()) ?? null;
    // v0.1.2: read the id from the emitted event. Reading `nextCompletionId()`
    // after the tx breaks under concurrency (two attestations in flight).
    const completionId =
      parseEventId(receipt, this.c, "SelfAttested", "completionId") ?? (await this.c.nextCompletionId() as bigint);
    return { completionId, receipt };
  }
  async challengeCompletion(completionId: number | bigint, evidenceCID: string, bond: bigint): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.challengeCompletion(completionId, evidenceCID, { value: bond })).wait()) ?? null;
  }
  async resolveChallenge(completionId: number | bigint, upheld: boolean): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.resolveChallenge(completionId, upheld)).wait()) ?? null;
  }
  async getSelfAttestScore(agent: string): Promise<SelfAttestScore> {
    const r = (await this.c.getSelfAttestScore(agent)) as [bigint, bigint, bigint];
    return { completions: r[0], disputes: r[1], score: r[2] };
  }
  /** v0.1.2: score with decay inputs (lastActivity, decayBps). */
  async getScoreDetails(agent: string): Promise<ScoreDetails> {
    const r = (await this.c.getScoreDetails(agent)) as [bigint, bigint, bigint, bigint, number];
    return { completions: r[0], disputes: r[1], score: r[2], lastActivity: r[3], decayBps: Number(r[4]) };
  }
  async getCompletion(id: number | bigint): Promise<Completion> {
    const r = (await this.c.getCompletion(id)) as [string, string, string, bigint, boolean, boolean];
    return { agent: r[0], taskType: r[1], resultCID: r[2], timestamp: r[3], challenged: r[4], disputed: r[5] };
  }
  async withdrawEthPool(to: string, amount: bigint): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.withdrawEthPool(to, amount)).wait()) ?? null;
  }
  challengeBond(): Promise<bigint> {
    return this.c.CHALLENGE_BOND() as Promise<bigint>;
  }

  // Basic agent identity (Step 7)
  lastActivity(agent: string): Promise<bigint> {
    return this.c.lastActivity(agent) as Promise<bigint>;
  }
  agentMetadataCID(agent: string): Promise<string> {
    return this.c.agentMetadataCID(agent) as Promise<string>;
  }
  async registerAgent(metadataCID: string): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.registerAgent(metadataCID)).wait()) ?? null;
  }
  getAgentMetadata(agent: string): Promise<string> {
    return this.c.getAgentMetadata(agent) as Promise<string>;
  }
}

export class CapabilityRegistryClient {
  private readonly c: Contract;
  constructor(address: string, runner?: ContractRunner) {
    this.c = new ethers.Contract(address, CAPABILITY_REGISTRY_ABI, runner);
  }
  get address(): string {
    return this.c.target as string;
  }
  totalSupply(): Promise<bigint> {
    return this.c.totalSupply() as Promise<bigint>;
  }
  tokenByIndex(index: number | bigint): Promise<bigint> {
    return this.c.tokenByIndex(index) as Promise<bigint>;
  }
  ownerOf(id: number | bigint): Promise<string> {
    return this.c.ownerOf(id) as Promise<string>;
  }
  async getCapability(id: number | bigint): Promise<Capability> {
    const raw = (await this.c.getCapability(id)) as [string, bigint, string, string, boolean, boolean];
    return {
      creator: raw[0],
      bond: raw[1],
      capabilityType: raw[2],
      metadataCID: raw[3],
      certified: raw[4],
      slashed: raw[5],
    };
  }
  async registerCapabilityEth(capabilityType: string, metadataCID: string, bondWei: bigint): Promise<{ capabilityId: bigint; receipt: ContractTransactionReceipt | null }> {
    const tx = await this.c.registerCapabilityEth(ethers.id(capabilityType), metadataCID, { value: bondWei });
    const receipt = (await tx.wait()) ?? null;
    // v0.1.2: derive the id from the emitted event. `totalSupply()` returns the
    // wrong id once any capability has been withdrawn (burn decrements supply
    // but ids keep incrementing) — which made the backend certify the wrong NFT.
    const capabilityId =
      parseEventId(receipt, this.c, "CapabilityRegistered", "capabilityId") ??
      (await this.c.totalSupply() as bigint);
    return { capabilityId, receipt };
  }
  async certifyCapability(id: number | bigint): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.certifyCapability(id)).wait()) ?? null;
  }
  async slashCapability(id: number | bigint, penalty: bigint): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.slashCapability(id, penalty)).wait()) ?? null;
  }
  async withdrawBond(id: number | bigint): Promise<ContractTransactionReceipt | null> {
    return (await (await this.c.withdrawBond(id)).wait()) ?? null;
  }

  async getCapabilitiesByType(capabilityType: string): Promise<bigint[]> {
    const ids = (await this.c.getCapabilitiesByType(ethers.id(capabilityType))) as bigint[];
    return ids;
  }
}

export type DiscoveryItem = {
  agentAddress: string;
  capabilityId: bigint;
  capabilityType: string;
  certified: boolean;
  slashed: boolean;
  bond: bigint;
  metadataCID: string;
  completions: bigint;
  disputes: bigint;
  score: bigint;
};

export async function discover(
  registry: CapabilityRegistryClient,
  ron: ReputationOracleNetworkClient,
  capabilityType = "LoRA",
  minScore = 0n as bigint | number,
): Promise<DiscoveryItem[]> {
  const min = typeof minScore === "bigint" ? minScore : BigInt(minScore);
  let ids: bigint[];
  try {
    ids = await registry.getCapabilitiesByType(capabilityType);
  } catch {
    const total = await registry.totalSupply();
    ids = [];
    for (let i = 0n; i < total; i++) ids.push(await registry.tokenByIndex(i));
  }
  const out: DiscoveryItem[] = [];
  for (const capId of ids) {
    // v0.1.2: a single stale/unreadable id (e.g. pre-fix index pollution, or an
    // id burned on another deployment) must never break the whole discovery call.
    let cap;
    try {
      cap = await registry.getCapability(capId);
    } catch {
      continue;
    }
    if (cap.capabilityType.toLowerCase() !== ethers.id(capabilityType).toLowerCase()) continue;
    if (!cap.certified || cap.slashed) continue;
    const s = await ron.getSelfAttestScore(cap.creator);
    if (s.score < min) continue;
    out.push({
      agentAddress: cap.creator,
      capabilityId: capId,
      capabilityType,
      certified: cap.certified,
      slashed: cap.slashed,
      bond: cap.bond,
      metadataCID: cap.metadataCID,
      completions: s.completions,
      disputes: s.disputes,
      score: s.score,
    });
  }
  out.sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));
  return out;
}

/** Load deployments.json written by scripts/deploy-*.ts. */
export async function loadDeployment(path: string) {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw) as import("./types.js").Deployment;
}