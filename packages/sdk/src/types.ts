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

/** v0.1.2: full score view including decay inputs. */
export interface ScoreDetails {
  completions: bigint;
  disputes: bigint;
  score: bigint;
  /** Unix seconds of the agent's last attestation. */
  lastActivity: bigint;
  /** Remaining score weight in basis points (10000 = undecayed, 0 = fully decayed). */
  decayBps: number;
}

export interface Deployment {
  chainId: number;
  network?: string;
  ron: string;
  registry: string;
  timelock?: string;   // P0: owner is now the TimelockController
  validator: string;
  agentA: string;
  /**
   * @deprecated Private keys must never live in `deployments.json` (it is a
   * publishable artifact — see SECURITY.md). Kept optional only for reading
   * legacy files. New deploys write the agent key to the gitignored `.env`
   * and consumers must read `process.env.AGENT_A_PK` instead.
   */
  agentAPk?: string;
  deployedAt?: string;
}

export const LORA_CAPABILITY_TYPE = "LoRA";