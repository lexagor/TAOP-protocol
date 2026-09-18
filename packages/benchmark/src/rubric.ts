import type { Mechanism } from "./mechanisms";
import {
  runCollusiveRing,
  collusionResistanceScore,
  defaultCollusionConfig,
  type CollusionConfig,
  type CollusionResult,
} from "./scenarios/collusion";
import {
  runSlowBurnHarvest,
  slowBurnResistanceScore,
  defaultSlowBurnConfig,
  type SlowBurnConfig,
  type SlowBurnResult,
} from "./scenarios/slowBurn";
import {
  runSybilFarming,
  sybilResistanceScore,
  defaultSybilConfig,
  type SybilConfig,
  type SybilResult,
} from "./scenarios/sybil";

export type ScenarioName = "sybil" | "slow-burn" | "collusion";

export const ALL_SCENARIOS: ScenarioName[] = ["sybil", "slow-burn", "collusion"];

export interface BenchmarkConfigs {
  sybil: SybilConfig;
  slowBurn: SlowBurnConfig;
  collusion: CollusionConfig;
}

export function defaultBenchmarkConfigs(seed = 42): BenchmarkConfigs {
  return {
    sybil: { ...defaultSybilConfig, seed },
    slowBurn: defaultSlowBurnConfig,
    collusion: defaultCollusionConfig,
  };
}

export interface ClassScores {
  sybilFarming?: number;
  slowBurnHarvest?: number;
  collusiveRing?: number;
  composite: number;
}

export interface MechanismReport {
  mechanism: string;
  description: string;
  sybil?: SybilResult;
  slowBurn?: SlowBurnResult;
  collusion?: CollusionResult;
  scores: ClassScores;
  weakSpots: string[];
}

/**
 * Composite = equal-weight mean of the selected class scores. The rubric is
 * intentionally simple and published; class scores are defined as:
 *   Sybil:       50% cost efficiency + 50% locked capital per point
 *   Slow burn:   100 * min(1, slashableCapital / harvestValue)
 *   Collusion:   100 * (1 - ringEfficiency / honestEfficiency)
 */
export function buildMechanismReport(
  mechanism: Mechanism,
  configs: BenchmarkConfigs,
  scenarios: ScenarioName[] = ALL_SCENARIOS,
): MechanismReport {
  const selected = new Set(scenarios);
  const sybil = selected.has("sybil") ? runSybilFarming(mechanism, configs.sybil) : undefined;
  const slowBurn = selected.has("slow-burn")
    ? runSlowBurnHarvest(mechanism, configs.slowBurn)
    : undefined;
  const collusion = selected.has("collusion")
    ? runCollusiveRing(mechanism, configs.collusion)
    : undefined;

  const scores: ClassScores = { composite: 0 };
  const components: number[] = [];
  if (sybil) {
    scores.sybilFarming = sybilResistanceScore(sybil);
    components.push(scores.sybilFarming);
  }
  if (slowBurn) {
    scores.slowBurnHarvest = slowBurnResistanceScore(slowBurn);
    components.push(scores.slowBurnHarvest);
  }
  if (collusion) {
    scores.collusiveRing = collusionResistanceScore(collusion);
    components.push(scores.collusiveRing);
  }
  scores.composite =
    components.length === 0
      ? 0
      : Math.round((components.reduce((sum, value) => sum + value, 0) / components.length) * 10) /
        10;

  const weakSpots: string[] = [];
  if (scores.sybilFarming !== undefined && scores.sybilFarming < 50) {
    weakSpots.push(
      mechanism.requiresReceipts
        ? "A funded ring can manufacture counterparties faster than watchers challenge them"
        : "Self-attested completions have no verifier and can be manufactured cheaply",
    );
  }
  if (scores.slowBurnHarvest !== undefined && scores.slowBurnHarvest < 50) {
    weakSpots.push("Bonded capital does not cover a high-value harvest");
  }
  if (scores.collusiveRing !== undefined && scores.collusiveRing < 50) {
    weakSpots.push("Fabricated peer receipts are accepted at face value");
  }

  return {
    mechanism: mechanism.name,
    description: mechanism.description,
    sybil,
    slowBurn,
    collusion,
    scores,
    weakSpots,
  };
}
