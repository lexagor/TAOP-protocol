import { describe, expect, it } from "vitest";

import { allMechanisms, defaultParams, linearDecayScore, DECAY_GRACE_SECS, DECAY_HORIZON_SECS } from "../src/mechanisms";
import { buildMechanismReport, defaultBenchmarkConfigs, ALL_SCENARIOS } from "../src/rubric";
import { PeerRatingsMechanism, StakeGatedMechanism } from "../src/mechanisms";
import {
  defaultCollusionConfig,
  runCollusiveRing,
  collusionResistanceScore,
} from "../src/scenarios/collusion";
import {
  defaultSlowBurnConfig,
  runSlowBurnHarvest,
  slowBurnResistanceScore,
} from "../src/scenarios/slowBurn";
import { defaultSybilConfig, runSybilFarming, sybilResistanceScore } from "../src/scenarios/sybil";
import { WEI_PER_ETH } from "../src/economics";

const DAY = 24 * 60 * 60;

describe("linear decay (contract parity)", () => {
  const grace = DECAY_GRACE_SECS;
  const horizon = DECAY_HORIZON_SECS;

  it("does not decay inside the grace period", () => {
    expect(linearDecayScore(100, 0, 1_000, 1_000 + grace, grace, horizon)).toBe(100);
  });

  it("decays linearly halfway through the horizon", () => {
    const now = 1_000 + grace + horizon / 2;
    expect(linearDecayScore(100, 0, 1_000, now, grace, horizon)).toBe(50);
  });

  it("reaches zero at the end of the horizon", () => {
    const now = 1_000 + grace + horizon;
    expect(linearDecayScore(100, 0, 1_000, now, grace, horizon)).toBe(0);
  });

  it("floors disputes out of the net score", () => {
    expect(linearDecayScore(3, 5, 0, 0, grace, horizon)).toBe(0);
    expect(linearDecayScore(10, 4, 0, 0, grace, horizon)).toBe(6);
  });

  it("ignores decay when there is no activity timestamp", () => {
    expect(linearDecayScore(7, 0, 0, 10_000 * DAY, grace, horizon)).toBe(7);
  });
});

describe("TAOP mechanisms", () => {
  it("v0.3 scores only distinct counterparties", () => {
    const mechanism = allMechanisms().find((m) => m.name === "base_taop_v03")!;
    const state = mechanism.newState();
    const agent = mechanism.ensureAgent(state, 1);

    mechanism.attest(state, 1, 0);
    expect(mechanism.score(state, 1, 0)).toBe(0);

    mechanism.rate(state, 2, 1, 0);
    mechanism.rate(state, 2, 1, 0);
    expect(mechanism.score(state, 1, 0)).toBe(1);

    mechanism.attest(state, 1, 0);
    mechanism.rate(state, 3, 1, 0);
    expect(mechanism.score(state, 1, 0)).toBe(2);
    expect(agent.disputes).toBe(0);
  });

  it("v0.2 counts every receipt, including repeats from one counterparty", () => {
    const mechanism = allMechanisms().find((m) => m.name === "base_taop_twosided")!;
    const state = mechanism.newState();
    mechanism.attest(state, 1, 0);
    mechanism.attest(state, 1, 0);
    mechanism.rate(state, 2, 1, 0);
    mechanism.rate(state, 2, 1, 0);
    expect(mechanism.score(state, 1, 0)).toBe(2);
  });

  it("removes a confirmation when a receipted completion is upheld", () => {
    const mechanism = allMechanisms().find((m) => m.name === "base_taop_v03")!;
    const state = mechanism.newState();
    const completionId = mechanism.attest(state, 1, 0);
    mechanism.rate(state, 2, 1, 0);
    expect(mechanism.score(state, 1, 0)).toBe(1);
    mechanism.challenge(state, completionId, 99, 0);
    mechanism.resolve(state, completionId, true);
    expect(mechanism.score(state, 1, 0)).toBe(0);
  });

  it("naive_count ignores disputes", () => {
    const naive = allMechanisms().find((m) => m.name === "naive_count")!;
    const state = naive.newState();
    const id = naive.attest(state, 1, 0);
    naive.challenge(state, id, 99, 0);
    naive.resolve(state, id, true);
    expect(naive.score(state, 1, 0)).toBe(1);
  });
});

describe("scenarios", () => {
  it("is deterministic for a fixed seed", () => {
    const configs = defaultBenchmarkConfigs(42);
    const first = allMechanisms().map((m) => JSON.stringify(buildMechanismReport(m, configs, ALL_SCENARIOS)));
    const second = allMechanisms().map((m) => JSON.stringify(buildMechanismReport(m, configs, ALL_SCENARIOS)));
    expect(first).toEqual(second);
  });

  it("scores a fully bonded capability as resistant to slow-burn harvest", () => {
    const params = { ...defaultParams(), capabilityBondWei: 0.5 * WEI_PER_ETH };
    const result = runSlowBurnHarvest(new StakeGatedMechanism(params), {
      ...defaultSlowBurnConfig,
      harvestValueWei: 0.5 * WEI_PER_ETH,
    });
    expect(result.metrics.reachable).toBe(true);
    expect(slowBurnResistanceScore(result)).toBe(100);
  });

  it("scores peer_ratings at zero collusion resistance (the ring inflates it)", () => {
    const result = runCollusiveRing(new PeerRatingsMechanism(defaultParams()), defaultCollusionConfig);
    expect(result.metrics.ringScorePerAgent).toBeGreaterThan(0);
    expect(result.metrics.detectors.length).toBeGreaterThan(0);
    expect(collusionResistanceScore(result)).toBe(0);
  });

  it("reports detection evidence for the v0.3 receipt graph", () => {
    const v03 = allMechanisms().find((m) => m.name === "base_taop_v03")!;
    const result = runCollusiveRing(v03, defaultCollusionConfig);
    expect(result.metrics.ringScorePerAgent).toBe(defaultCollusionConfig.ringSize - 1);
    expect(result.metrics.detectorRecall).toBe(1);
  });

  it("v0.3 sybil score beats self-attest sybil score", () => {
    const v03 = allMechanisms().find((m) => m.name === "base_taop_v03")!;
    const selfAttest = allMechanisms().find((m) => m.name === "base_taop_self_attest")!;
    const v03Score = sybilResistanceScore(runSybilFarming(v03, defaultSybilConfig));
    const selfAttestScore = sybilResistanceScore(runSybilFarming(selfAttest, defaultSybilConfig));
    expect(v03Score).toBeGreaterThan(selfAttestScore);
  });
});
