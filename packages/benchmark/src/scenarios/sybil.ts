import { WEI_PER_ETH, eth, rng } from "../economics";
import type { Mechanism } from "../mechanisms";

export interface SybilConfig {
  sybils: number;
  attestsPerSybil: number;
  /** Probability that any given completion is challenged by a watcher. */
  challengeProbability: number;
  /** Probability that a challenge against a fake completion is upheld. */
  upheldProbability: number;
  seed: number;
}

export const defaultSybilConfig: SybilConfig = {
  sybils: 20,
  attestsPerSybil: 10,
  challengeProbability: 0.1,
  upheldProbability: 0.9,
  seed: 42,
};

export interface SybilResult {
  scenario: "sybil_farming";
  mechanism: string;
  config: SybilConfig;
  metrics: {
    sybilAgents: number;
    totalAttestations: number;
    /** Receipt transactions the attacker had to fund (ring-internal counterparties). */
    totalReceipts: number;
    totalScore: number;
    spentWei: number;
    lockedWei: number;
    capitalPerPointWei: number;
    costPerPointWei: number;
    honestCostPerPointWei: number;
    efficiencyRatio: number;
    challenges: number;
    disputes: number;
    costToThreshold: Record<string, string>;
  };
  findings: string;
}

/** Locked capital per point that is considered fully Sybil-resistant. Policy choice, stated openly. */
export const SYBIL_CAPITAL_REFERENCE_WEI = 0.01 * WEI_PER_ETH;

/**
 * Sybil farming: many fresh identities manufacture reputation without external
 * counterparties. Watchers challenge each completion with probability p;
 * upheld challenges subtract score. For receipt-based mechanisms the attacker
 * must also fund a ring of counterparty identities (the diversity tax this
 * benchmark exists to measure). Cost per point is compared to an honest agent
 * paying the same on-chain costs for real work.
 */
export function runSybilFarming(
  mechanism: Mechanism,
  config: SybilConfig = defaultSybilConfig,
): SybilResult {
  const random = rng(config.seed);
  const state = mechanism.newState();

  // --- Honest arm: one agent doing K real completions, plus independent
  // counterparties when the mechanism requires receipts. ---
  const honestId = -1;
  const honestCounterparties = mechanism.requiresReceipts
    ? Array.from({ length: config.attestsPerSybil }, (_, i) => -1000 - i)
    : [];
  const honest = mechanism.ensureAgent(state, honestId);
  if (mechanism.capitalRequiredForScore && mechanism.lockCapital) {
    mechanism.lockCapital(
      state,
      honest.id,
      mechanism.capitalRequiredForScore(config.attestsPerSybil),
    );
  }
  for (let k = 0; k < config.attestsPerSybil; k += 1) {
    mechanism.attest(state, honestId, 0);
    const counterparty = honestCounterparties[k];
    if (counterparty !== undefined) {
      mechanism.rate(state, counterparty, honestId, 0);
    }
  }

  // --- Attacker arm: S fresh identities that attest and, when receipts are
  // required, confirm each other's completions (round-robin so each distinct
  // counterparty is used at most once per agent under a diversity cap). ---
  let challenges = 0;
  let disputes = 0;
  let receipts = 0;
  for (let sybil = 0; sybil < config.sybils; sybil += 1) {
    if (mechanism.capitalRequiredForScore && mechanism.lockCapital) {
      mechanism.lockCapital(
        state,
        sybil,
        mechanism.capitalRequiredForScore(config.attestsPerSybil),
      );
    }
    for (let k = 0; k < config.attestsPerSybil; k += 1) {
      const completionId = mechanism.attest(state, sybil, 0);
      if (mechanism.requiresReceipts && config.sybils > 1) {
        const counterparty = (sybil + 1 + k) % config.sybils;
        if (counterparty !== sybil) {
          mechanism.rate(state, counterparty, sybil, 0);
          receipts += 1;
        }
      }
      if (random() < config.challengeProbability) {
        challenges += 1;
        const challenger = 10_000 + challenges;
        mechanism.challenge(state, completionId, challenger, 0);
        if (random() < config.upheldProbability) {
          disputes += 1;
          mechanism.resolve(state, completionId, true);
        } else {
          mechanism.resolve(state, completionId, false);
        }
      }
    }
  }

  const attackers = Array.from({ length: config.sybils }, (_, id) =>
    mechanism.ensureAgent(state, id),
  );
  const totalScore = attackers.reduce(
    (sum, agent) => sum + mechanism.score(state, agent.id, 0),
    0,
  );
  const spentWei = attackers.reduce((sum, agent) => sum + agent.spentWei, 0);
  const lockedWei = attackers.reduce((sum, agent) => sum + agent.lockedWei, 0);
  const attackerCapital = spentWei + lockedWei;
  const honestScore = mechanism.score(state, honest.id, 0);
  const honestCapital =
    honest.spentWei +
    honest.lockedWei +
    honestCounterparties.reduce((sum, id) => {
      const record = mechanism.ensureAgent(state, id);
      return sum + record.spentWei + record.lockedWei;
    }, 0);

  const costPerPointWei = attackerCapital / Math.max(1, totalScore);
  const capitalPerPointWei =
    totalScore === 0 ? Number.POSITIVE_INFINITY : lockedWei / totalScore;
  const honestCostPerPointWei = honestCapital / Math.max(1, honestScore);
  const efficiencyRatio =
    totalScore === 0 || costPerPointWei === 0
      ? 0
      : honestCostPerPointWei / costPerPointWei;

  const perAttestCost = mechanism.attestCost();
  const costToThreshold: Record<string, string> = {};
  for (const threshold of [10, 100, 1_000]) {
    costToThreshold[String(threshold)] = eth(threshold * perAttestCost);
  }

  const findings =
    totalScore === 0
      ? "No effective score could be manufactured for this configuration."
      : `Attacker commits ${eth(costPerPointWei)} per effective reputation point ` +
        `(${eth(lockedWei)} of it locked capital) versus ${eth(honestCostPerPointWei)} ` +
        `for honest work (efficiency ${efficiencyRatio.toFixed(2)}x). ` +
        `${disputes}/${challenges} challenges were upheld` +
        (mechanism.requiresReceipts
          ? `; ${receipts} ring-internal receipts were funded.`
          : ".") +
        " " +
        (efficiencyRatio > 0.8
          ? "Self-attested work is indistinguishable from honest work at this challenge rate."
          : "Challenge pressure materially taxes fake completions.");

  return {
    scenario: "sybil_farming",
    mechanism: mechanism.name,
    config,
    metrics: {
      sybilAgents: config.sybils,
      totalAttestations: config.sybils * config.attestsPerSybil,
      totalReceipts: receipts,
      totalScore,
      spentWei,
      lockedWei,
      capitalPerPointWei,
      costPerPointWei,
      honestCostPerPointWei,
      efficiencyRatio,
      challenges,
      disputes,
      costToThreshold,
    },
    findings,
  };
}

/**
 * Sybil resistance = half cost-efficiency, half capital intensity:
 *   efficiency component: 100 * (1 - attackerEfficiency)
 *   capital component:    100 * min(1, lockedCapitalPerPoint / 0.01 ETH)
 * A mechanism that manufactures score as cheaply as honest work and locks no
 * capital per point scores 0; one that requires a meaningful bond scores higher.
 */
export function sybilResistanceScore(result: SybilResult): number {
  if (result.metrics.totalScore === 0) return 100;
  const ratio = result.metrics.efficiencyRatio;
  const efficiencyComponent =
    !Number.isFinite(ratio) || ratio <= 0
      ? 100
      : ratio >= 1
        ? 0
        : 100 * (1 - ratio);
  const capital = result.metrics.capitalPerPointWei;
  const capitalComponent = Number.isFinite(capital)
    ? 100 * Math.min(1, capital / SYBIL_CAPITAL_REFERENCE_WEI)
    : 0;
  return Math.round((0.5 * efficiencyComponent + 0.5 * capitalComponent) * 10) / 10;
}

export const SYBIL_ETH_BUDGET = WEI_PER_ETH;
