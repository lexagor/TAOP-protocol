export interface Capability {
  creator: string;
  bond: bigint;
  capabilityType: string;
  metadataCID: string;
  certified: boolean;
  slashed: boolean;
}

export interface Completion {
  agent: string;
  taskType: string;
  resultCID: string;
  timestamp: bigint;
  challenged: boolean;
  disputed: boolean;
}

export interface SelfAttestScore {
  completions: bigint;
  disputes: bigint;
  score: bigint;
}

export interface Deployment {
  chainId: number;
  network?: string;
  ron: string;
  registry: string;
  validator: string;
  agentA: string;
  agentAPk?: string;
  deployedAt?: string;
}

export const LORA_CAPABILITY_TYPE = "LoRA";