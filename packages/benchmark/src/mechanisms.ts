/**
 * Mechanism models for the benchmark: the TAOP Base contracts (v0.2/v0.3
 * semantics) plus four baselines. Economic behaviour mirrors the deployed
 * bytecode; costs come from `./economics`.
 */

import { GAS, WEI_PER_ETH, txCost } from "./economics";

export const BPS_DENOMINATOR = 10_000;

export interface MechanismParams {
  /** ETH bond required to challenge a completion (RON.CHALLENGE_BOND). */
  challengeBondWei: number;
  /** ETH bonded behind a capability (Registry registration bond). */
  capabilityBondWei: number;
  /** Inactivity grace before decay starts (RON.DECAY_GRACE). */
  decayGraceSecs: number;
  /** Length of the linear decay window after the grace (RON.DECAY_HORIZON). */
  decayHorizonSecs: number;
}

export const DEFAULT_CHALLENGE_BOND_WEI = 0.01 * WEI_PER_ETH;
export const DEFAULT_CAPABILITY_BOND_WEI = 0.01 * WEI_PER_ETH;
export const DECAY_GRACE_SECS = 30 * 24 * 60 * 60;
export const DECAY_HORIZON_SECS = 150 * 24 * 60 * 60;

export interface AgentState {
  id: number;
  completions: number;
  disputes: number;
  /** Receipt confirmations received, keyed by counterparty id. */
  confirmations: Map<number, number>;
  /** Distinct counterparties that confirmed at least one completion. */
  raters: Set<number>;
  lastActivity: number;
  /** Wei the attacker has irreversibly spent (gas, forfeited bonds). */
  spentWei: number;
  /** Wei currently locked in bonds (recoverable). */
  lockedWei: number;
  /** Bonded wei that has been slashed (lost). */
  slashedWei: number;
}

export interface CompletionState {
  id: number;
  agent: number;
  timestamp: number;
  challenged: boolean;
  disputed: boolean;
  challenger?: number;
  /** Counterparty that confirmed this completion, if any. */
  receiptFrom?: number;
}

export interface MechanismState {
  now: number;
  nextCompletionId: number;
  agents: Map<number, AgentState>;
  completions: CompletionState[];
}

export interface Mechanism {
  readonly name: string;
  readonly description: string;
  readonly params: MechanismParams;
  /** True when the mechanism records counterparty receipts that detection can inspect. */
  readonly usesPeerRatings?: boolean;
  /** True when a completion only contributes to the score after a receipt. */
  readonly requiresReceipts?: boolean;
  newState(now?: number): MechanismState;
  ensureAgent(state: MechanismState, id: number): AgentState;
  /** Submit a self-attested completion; returns the completion id. */
  attest(state: MechanismState, agent: number, now: number): number;
  /** Confirm agent `to`'s latest unconfirmed completion from counterparty `from`. */
  rate(state: MechanismState, from: number, to: number, now: number): void;
  challenge(state: MechanismState, completionId: number, challenger: number, now: number): void;
  resolve(state: MechanismState, completionId: number, upheld: boolean): void;
  slashCapability(state: MechanismState, agent: number): void;
  score(state: MechanismState, agent: number, now: number): number;
  /** Wei a counterparty can recover by slashing this agent's bonds. */
  slashable(state: MechanismState, agent: number): number;
  /** Modeled cost of one self-attestation. */
  attestCost(): number;
  /** Modeled cost of one receipt transaction (also used as a rating cost). */
  receiptCost(): number;
  capitalRequiredForScore?(targetScore: number): number;
  lockCapital?(state: MechanismState, agent: number, wei: number): void;
}

export function confirmedCount(agent: AgentState): number {
  let total = 0;
  for (const count of agent.confirmations.values()) total += count;
  return total;
}

export function distinctCounterparties(agent: AgentState): number {
  return agent.raters.size;
}

/**
 * Single source of truth for the v0.1.2+ decay curve, matching
 * `ReputationOracleNetwork._decayedScore` exactly (integer division, floor).
 */
export function linearDecayScore(
  count: number,
  disputes: number,
  lastActivity: number,
  now: number,
  graceSecs: number,
  horizonSecs: number,
): number {
  let net = count > disputes ? count - disputes : 0;
  let decayBps = BPS_DENOMINATOR;
  if (lastActivity > 0 && net > 0) {
    const elapsed = now - lastActivity;
    if (elapsed > graceSecs) {
      const decayed = elapsed - graceSecs;
      if (decayed >= horizonSecs) {
        decayBps = 0;
      } else {
        decayBps = Math.floor(((horizonSecs - decayed) * BPS_DENOMINATOR) / horizonSecs);
      }
    }
    net = Math.floor((net * decayBps) / BPS_DENOMINATOR);
  }
  return net;
}

function newAgent(id: number): AgentState {
  return {
    id,
    completions: 0,
    disputes: 0,
    confirmations: new Map(),
    raters: new Set(),
    lastActivity: 0,
    spentWei: 0,
    lockedWei: 0,
    slashedWei: 0,
  };
}

function baseState(now: number): MechanismState {
  return { now, nextCompletionId: 1, agents: new Map(), completions: [] };
}

function ensure(state: MechanismState, id: number): AgentState {
  let agent = state.agents.get(id);
  if (!agent) {
    agent = newAgent(id);
    state.agents.set(id, agent);
  }
  return agent;
}

function submitCompletion(state: MechanismState, agent: AgentState, now: number): number {
  const id = state.nextCompletionId;
  state.nextCompletionId += 1;
  agent.completions += 1;
  agent.lastActivity = now;
  state.completions.push({
    id,
    agent: agent.id,
    timestamp: now,
    challenged: false,
    disputed: false,
  });
  return id;
}

function removeConfirmation(agent: AgentState, counterparty: number): void {
  const current = agent.confirmations.get(counterparty);
  if (current === undefined) return;
  if (current <= 1) {
    agent.confirmations.delete(counterparty);
    agent.raters.delete(counterparty);
  } else {
    agent.confirmations.set(counterparty, current - 1);
  }
}

abstract class AbstractMechanism implements Mechanism {
  abstract readonly name: string;
  abstract readonly description: string;
  readonly usesPeerRatings?: boolean;
  readonly requiresReceipts?: boolean;
  constructor(readonly params: MechanismParams) {}

  abstract newState(now?: number): MechanismState;
  abstract score(state: MechanismState, agent: number, now: number): number;

  ensureAgent(state: MechanismState, id: number): AgentState {
    return ensure(state, id);
  }

  attest(state: MechanismState, agent: number, now: number): number {
    const record = ensure(state, agent);
    const id = submitCompletion(state, record, now);
    record.spentWei += this.attestCost();
    return id;
  }

  rate(state: MechanismState, from: number, to: number, now: number): void {
    const counterparty = ensure(state, from);
    const record = ensure(state, to);
    counterparty.spentWei += this.receiptCost();
    const completion = [...state.completions]
      .reverse()
      .find(
        (entry) =>
          entry.agent === to &&
          entry.receiptFrom === undefined &&
          !entry.challenged &&
          !entry.disputed,
      );
    // A receipt confirms a specific completion; peer feedback (ERC-8004-style)
    // needs no completion, and a mechanism that records neither still pays gas.
    if (this.requiresReceipts) {
      if (!completion) return;
      completion.receiptFrom = from;
    }
    record.confirmations.set(from, (record.confirmations.get(from) ?? 0) + 1);
    record.raters.add(from);
    void now;
  }

  challenge(state: MechanismState, completionId: number, challenger: number, now: number): void {
    const completion = state.completions.find((c) => c.id === completionId);
    if (!completion || completion.challenged) return;
    completion.challenged = true;
    completion.challenger = challenger;
    const record = ensure(state, challenger);
    record.spentWei += txCost(GAS.challengeCompletion) + this.params.challengeBondWei;
    record.lockedWei += this.params.challengeBondWei;
    void now;
  }

  resolve(state: MechanismState, completionId: number, upheld: boolean): void {
    const completion = state.completions.find((c) => c.id === completionId);
    if (!completion || completion.challenger === undefined) return;
    const challenger = ensure(state, completion.challenger);
    if (upheld) {
      completion.disputed = true;
      const agent = ensure(state, completion.agent);
      agent.disputes += 1;
      if (completion.receiptFrom !== undefined) {
        removeConfirmation(agent, completion.receiptFrom);
      }
      challenger.lockedWei = Math.max(
        0,
        challenger.lockedWei - this.params.challengeBondWei,
      );
      challenger.spentWei -= this.params.challengeBondWei;
    } else {
      challenger.lockedWei = Math.max(
        0,
        challenger.lockedWei - this.params.challengeBondWei,
      );
      challenger.slashedWei += this.params.challengeBondWei;
    }
  }

  slashCapability(state: MechanismState, agent: number): void {
    const record = ensure(state, agent);
    const slashed = Math.min(this.slashable(state, agent), record.lockedWei);
    record.lockedWei -= slashed;
    record.slashedWei += slashed;
    record.spentWei += slashed;
  }

  slashable(state: MechanismState, agent: number): number {
    void state;
    void agent;
    return this.params.capabilityBondWei;
  }

  attestCost(): number {
    return txCost(GAS.attestCompletion);
  }

  receiptCost(): number {
    return txCost(GAS.attestReceipt);
  }
}

/** Shared score shape for the TAOP Base contracts: net signal + linear decay. */
abstract class DecayingMechanism extends AbstractMechanism {
  abstract netScore(state: MechanismState, agent: number): number;

  score(state: MechanismState, agent: number, now: number): number {
    const record = ensure(state, agent);
    return linearDecayScore(
      this.netScore(state, agent),
      record.disputes,
      record.lastActivity,
      now,
      this.params.decayGraceSecs,
      this.params.decayHorizonSecs,
    );
  }
}

/** v0.1 interface: self-attested completions - disputes, with linear decay. */
export class BaseTaopSelfAttestMechanism extends DecayingMechanism {
  readonly name = "base_taop_self_attest";
  readonly description =
    "RON getSelfAttestScore: self-attested completions, ETH challenge bonds, optimistic " +
    "resolution, score = max(0, completions - disputes) with inactivity decay.";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  netScore(state: MechanismState, agent: number): number {
    return ensure(state, agent).completions;
  }
}

/** v0.2: only receipt-confirmed completions count, with linear decay. */
export class BaseTaopTwoSidedMechanism extends DecayingMechanism {
  readonly name = "base_taop_twosided";
  readonly usesPeerRatings = true;
  readonly requiresReceipts = true;
  readonly description =
    "RON getTwoSidedScore: receipt-confirmed completions, score = max(0, confirmations - disputes) " +
    "with inactivity decay.";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  netScore(state: MechanismState, agent: number): number {
    return confirmedCount(ensure(state, agent));
  }
}

/** v0.3: diversity-adjusted credit score (distinct counterparties only). */
export class BaseTaopV03Mechanism extends DecayingMechanism {
  readonly name = "base_taop_v03";
  readonly usesPeerRatings = true;
  readonly requiresReceipts = true;
  readonly description =
    "RON getCreditScore: distinct counterparties that confirmed at least one completion, " +
    "score = max(0, distinct counterparties - disputes) with inactivity decay.";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  netScore(state: MechanismState, agent: number): number {
    return distinctCounterparties(ensure(state, agent));
  }
}

/** Baseline: count completions, ignore disputes and decay. */
export class NaiveCountMechanism extends AbstractMechanism {
  readonly name = "naive_count";
  readonly description = "Baseline: score = completions, no bonds, no disputes, no decay.";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  score(state: MechanismState, agent: number): number {
    return ensure(state, agent).completions;
  }
}

/** Baseline: disputes subtract, but there is no decay. */
export class NoDecayMechanism extends AbstractMechanism {
  readonly name = "completions_minus_disputes";
  readonly description =
    "Baseline: score = max(0, completions - disputes), no inactivity decay.";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  score(state: MechanismState, agent: number): number {
    const record = ensure(state, agent);
    return Math.max(0, record.completions - record.disputes);
  }
}

/** Baseline: ERC-8004-style peer feedback among agents. */
export class PeerRatingsMechanism extends AbstractMechanism {
  readonly name = "peer_ratings";
  readonly usesPeerRatings = true;
  readonly description =
    "Baseline: score = distinct agents that rated you minus disputes (ERC-8004-style feedback).";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  score(state: MechanismState, agent: number): number {
    const record = ensure(state, agent);
    return Math.max(0, distinctCounterparties(record) - record.disputes);
  }
}

/** Baseline: reputation requires locked capital (1 point per 0.01 ETH staked). */
export class StakeGatedMechanism extends AbstractMechanism {
  readonly name = "stake_gated";
  readonly stakePerPointWei = 0.01 * WEI_PER_ETH;
  readonly description =
    "Baseline: score = min(completions - disputes, floor(stake / 0.01 ETH)), stake fully slashable.";

  newState(now = 0): MechanismState {
    return baseState(now);
  }

  score(state: MechanismState, agent: number): number {
    const record = ensure(state, agent);
    const stakeCap = Math.floor(record.lockedWei / this.stakePerPointWei);
    return Math.max(0, Math.min(record.completions - record.disputes, stakeCap));
  }

  slashable(state: MechanismState, agent: number): number {
    return ensure(state, agent).lockedWei;
  }

  capitalRequiredForScore(targetScore: number): number {
    return targetScore * this.stakePerPointWei;
  }

  lockCapital(state: MechanismState, agent: number, wei: number): void {
    const record = ensure(state, agent);
    record.lockedWei += wei;
    record.spentWei += txCost(GAS.certifyCapability);
  }
}

export function defaultParams(): MechanismParams {
  return {
    challengeBondWei: DEFAULT_CHALLENGE_BOND_WEI,
    capabilityBondWei: DEFAULT_CAPABILITY_BOND_WEI,
    decayGraceSecs: DECAY_GRACE_SECS,
    decayHorizonSecs: DECAY_HORIZON_SECS,
  };
}

export function allMechanisms(params = defaultParams()): Mechanism[] {
  return [
    new BaseTaopV03Mechanism(params),
    new BaseTaopTwoSidedMechanism(params),
    new BaseTaopSelfAttestMechanism(params),
    new NaiveCountMechanism(params),
    new NoDecayMechanism(params),
    new PeerRatingsMechanism(params),
    new StakeGatedMechanism(params),
  ];
}
