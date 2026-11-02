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
  /** v0.2: independent requester who countersigned, or the zero address. */
  counterparty: string;
  /** v0.2: unix seconds when the receipt was given (0 if none). */
  receiptTimestamp: bigint;
}

export interface SelfAttestScore {
  completions: bigint;
  disputes: bigint;
  score: bigint;
}

/** v0.2: two-sided score = receipt-confirmed completions - disputes. */
export interface TwoSidedScore {
  confirmed: bigint;
  disputes: bigint;
  score: bigint;
  /** Unix seconds of the agent's last positive activity. */
  lastActivity: bigint;
  /** Remaining score weight in basis points (10000 = undecayed, 0 = fully decayed). */
  decayBps: number;
}

/** v0.3: diversity-adjusted credit score = distinct counterparties - disputes. */
export interface CreditScore {
  distinctCounterparties: bigint;
  disputes: bigint;
  score: bigint;
  lastActivity: bigint;
  decayBps: number;
}

/** Which signal a ranking score came from (best available on the deployment). */
export type ScoreType = "credit" | "two-sided" | "self-attest";

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
/** Phase-0 adjudication: 0 = none, 1 = PAY (provider clean), 2 = REFUND. */
export type Ruling = 0 | 1 | 2;
/** 0 = none, 1 = ruled, 2 = challenged, 3 = finalized, 4 = overturned. */
export type RulingStatus = 0 | 1 | 2 | 3 | 4;

export interface PublishRulingRequest {
  caseId: string;
  provider: string;
  payer: string;
  feePayer: string;
  agentId: bigint;
  /** USDC units (6 decimals), capped by CASE_CAP. */
  value: bigint;
  specHash: string;
  evidenceHash: string;
  evidenceURI: string;
  ruling: Ruling;
}

export interface RulingCase {
  provider: string;
  payer: string;
  feePayer: string;
  agentId: bigint;
  value: bigint;
  ruling: Ruling;
  status: RulingStatus;
  ruledAt: bigint;
  challengeDeadline: bigint;
  challengeBond: bigint;
  escalationDeadline: bigint;
  finalizedAt: bigint;
  specHash: string;
  evidenceHash: string;
  evidenceURI: string;
  challenger: string;
  escalationId: string;
  feeRefunded: boolean;
}

export interface RulingOutcome {
  /** Final ruling: the original ruling unless status is OVERTURNED. */
  ruling: Ruling;
  status: RulingStatus;
  finalizedAt: bigint;
  evidenceHash: string;
}

export interface RulingLossRecord {
  caseId: string;
  provider: string;
  agentId: bigint;
  value: bigint;
  finalizedAt: bigint;
  evidenceHash: string;
}


export interface ReviewerRequest {
  caseId: string;
  ruling: number;
  evidenceHash: string;
  reviewers: [string, string, string];
  deadline: bigint;
  resolved: boolean;
  upheld: boolean;
}
