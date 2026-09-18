import { GAS, WEI_PER_ETH, eth, txCost } from "../economics";
import type { Mechanism } from "../mechanisms";

export interface SlowBurnConfig {
  /** Reputation threshold required to be awarded a high-value contract. */
  targetScore: number;
  /** Off-chain value the attacker extracts once above the threshold (wei). */
  harvestValueWei: number;
  /** Attestations the attacker performs per day while accumulating. */
  attestsPerDay: number;
  /** Simulated horizon in days. */
  horizonDays: number;
  /**
   * Counterparty identities the attacker controls and can use for receipts.
   * Only used by receipt-based mechanisms; a diversity-adjusted score cannot
   * exceed the number of distinct confirming accomplices.
   */
  accomplices: number;
}

export const defaultSlowBurnConfig: SlowBurnConfig = {
  targetScore: 50,
  harvestValueWei: 5 * WEI_PER_ETH,
  attestsPerDay: 2,
  horizonDays: 180,
  accomplices: 64,
};

export interface SlowBurnResult {
  scenario: "slow_burn_harvest";
  mechanism: string;
  config: SlowBurnConfig;
  metrics: {
    reachable: boolean;
    daysToThreshold: number | null;
    scoreAtHarvest: number;
    spentWei: number;
    slashableWei: number;
    harvestValueWei: number;
    slashCoverage: number;
    netAttackerProfitWei: number;
    scoreAfterSlash: number;
  };
  findings: string;
}

const DAY = 24 * 60 * 60;

/**
 * Slow burn then harvest: the attacker builds just enough reputation for one
 * high-value action, then exits. The only capital a counterparty can seize is
 * the attacker's bonded capability, so slash coverage measures the defense.
 */
export function runSlowBurnHarvest(
  mechanism: Mechanism,
  config: SlowBurnConfig = defaultSlowBurnConfig,
): SlowBurnResult {
  const state = mechanism.newState();
  const attacker = 0;
  mechanism.ensureAgent(state, attacker);

  // Model the capital required to bid on the high-value contract: a stake-gated
  // mechanism needs locked stake, TAOP needs a bonded capability.
  if (mechanism.capitalRequiredForScore && mechanism.lockCapital) {
    mechanism.lockCapital(
      state,
      attacker,
      mechanism.capitalRequiredForScore(config.targetScore),
    );
  } else {
    const record = mechanism.ensureAgent(state, attacker);
    record.lockedWei += mechanism.params.capabilityBondWei;
    record.spentWei += txCost(GAS.registerCapabilityEth);
  }

  const accomplices = mechanism.requiresReceipts
    ? Array.from({ length: Math.max(0, config.accomplices) }, (_, i) => 1 + i)
    : [];
  for (const id of accomplices) mechanism.ensureAgent(state, id);
  let receiptIndex = 0;

  let daysToThreshold: number | null = null;
  let scoreAtHarvest = 0;
  for (let day = 1; day <= config.horizonDays; day += 1) {
    for (let i = 0; i < config.attestsPerDay; i += 1) {
      mechanism.attest(state, attacker, day * DAY);
      if (accomplices.length > 0) {
        const counterparty = accomplices[receiptIndex % accomplices.length];
        receiptIndex += 1;
        mechanism.rate(state, counterparty, attacker, day * DAY);
      }
    }
    const score = mechanism.score(state, attacker, day * DAY);
    if (score >= config.targetScore) {
      daysToThreshold = day;
      scoreAtHarvest = score;
      break;
    }
  }

  const slashableWei = mechanism.slashable(state, attacker);
  const attackerSpent = mechanism.ensureAgent(state, attacker).spentWei;
  const accompliceSpent = accomplices.reduce(
    (sum, id) => sum + mechanism.ensureAgent(state, id).spentWei,
    0,
  );
  const spentWei = attackerSpent + accompliceSpent;
  const slashCoverage =
    config.harvestValueWei === 0 ? 0 : slashableWei / config.harvestValueWei;

  if (daysToThreshold !== null) {
    mechanism.slashCapability(state, attacker);
    // The fraud is discovered: every completion is disputed retroactively.
    const record = mechanism.ensureAgent(state, attacker);
    record.disputes = record.completions;
  }
  const scoreAfterSlash = mechanism.score(state, attacker, config.horizonDays * DAY);

  const netAttackerProfitWei =
    daysToThreshold === null
      ? 0
      : config.harvestValueWei - slashableWei - spentWei;

  const findings =
    daysToThreshold === null
      ? `Unreachable: score ${config.targetScore} was not reached at ${config.attestsPerDay} attestations/day` +
        (mechanism.requiresReceipts
          ? ` with ${accomplices.length} accomplice identities.`
          : ".")
      : `Reached score ${scoreAtHarvest} in ${daysToThreshold} days for ${eth(spentWei)}. ` +
        `Bonded capital (${eth(slashableWei)}) covers ${(slashCoverage * 100).toFixed(1)}% of the ` +
        `${eth(config.harvestValueWei)} harvest. ` +
        (slashCoverage >= 1
          ? "A fully bonded capability neutralizes the harvest."
          : "Underbonded capabilities are the attack surface; raise the bond or gate the contract on more than score.");

  return {
    scenario: "slow_burn_harvest",
    mechanism: mechanism.name,
    config,
    metrics: {
      reachable: daysToThreshold !== null,
      daysToThreshold,
      scoreAtHarvest,
      spentWei,
      slashableWei,
      harvestValueWei: config.harvestValueWei,
      slashCoverage,
      netAttackerProfitWei,
      scoreAfterSlash,
    },
    findings,
  };
}

export function slowBurnResistanceScore(result: SlowBurnResult): number {
  if (!result.metrics.reachable) return 100;
  const coverage = result.metrics.slashCoverage;
  return Math.round(Math.min(1, Math.max(0, coverage)) * 1000) / 10;
}
