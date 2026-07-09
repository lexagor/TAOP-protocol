import { ethers, type Contract, type ContractRunner, type ContractTransactionReceipt } from "ethers";
import { RON_ABI, CAPABILITY_REGISTRY_ABI } from "./abis.js";
import type { Capability, Completion, SelfAttestScore } from "./types.js";

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
    let completionId = (await this.c.nextCompletionId()) as bigint;
    for (let i = 0; i < 5 && completionId === 0n; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      completionId = (await this.c.nextCompletionId()) as bigint;
    }
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
    const capabilityId = (await this.c.totalSupply()) as bigint;
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
}

/** Load deployments.json written by scripts/deploy-*.ts. */
export async function loadDeployment(path: string) {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw) as import("./types.js").Deployment;
}