import { eth, rng } from "../economics";
import type { Mechanism } from "../mechanisms";

export interface CollusionConfig {
  ringSize: number;
  ratingsPerPair: number;
  /** Fraction of an agent's outgoing ratings that must be reciprocal to flag it. */
  reciprocityThreshold: number;
  /** Honest agents mixed into the graph so detection metrics are meaningful. */
  honestAgents: number;
  /** Outgoing ratings each honest agent emits (to random, non-reciprocating targets). */
  honestRatings: number;
  /** Minimum k-core number to flag an account (dense-clique test). */
  coreThreshold: number;
  seed: number;
}

export const defaultCollusionConfig: CollusionConfig = {
  ringSize: 10,
  // One rating per ordered pair is enough for the ring: repeated ratings do not
  // add distinct raters, so redundancy only increases cost without score.
  ratingsPerPair: 1,
  reciprocityThreshold: 0.8,
  honestAgents: 30,
  honestRatings: 2,
  coreThreshold: 4,
  seed: 42,
};

export interface DetectorResult {
  name: string;
  flagged: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CollusionResult {
  scenario: "collusive_ring";
  mechanism: string;
  config: CollusionConfig;
  metrics: {
    ringScorePerAgent: number;
    ringCostWei: number;
    costPerRingPointWei: number;
    honestCostPerPointWei: number;
    efficiencyRatio: number;
    /** Ensemble precision/recall; null when the mechanism records no rating graph. */
    detectorPrecision: number | null;
    detectorRecall: number | null;
    detectors: DetectorResult[];
  };
  findings: string;
}

export type Edge = [from: number, to: number];

interface Graph {
  nodes: Set<number>;
  outgoing: Map<number, Set<number>>;
  reciprocalPartners: Map<number, number>;
  undirected: Map<number, Set<number>>;
}

/** Build the adjacency views the detectors share. */
export function buildGraph(edges: Edge[], nodes: Iterable<number>): Graph {
  const outgoing = new Map<number, Set<number>>();
  const edgeSet = new Set(edges.map(([from, to]) => `${from}->${to}`));
  const undirected = new Map<number, Set<number>>();
  const nodeSet = new Set(nodes);

  for (const [from, to] of edges) {
    nodeSet.add(from);
    nodeSet.add(to);
    if (!outgoing.has(from)) outgoing.set(from, new Set());
    outgoing.get(from)!.add(to);
    if (!undirected.has(from)) undirected.set(from, new Set());
    if (!undirected.has(to)) undirected.set(to, new Set());
    undirected.get(from)!.add(to);
    undirected.get(to)!.add(from);
  }

  const reciprocalPartners = new Map<number, number>();
  for (const node of nodeSet) {
    let count = 0;
    for (const target of outgoing.get(node) ?? []) {
      if (edgeSet.has(`${target}->${node}`)) count += 1;
    }
    reciprocalPartners.set(node, count);
  }

  return { nodes: nodeSet, outgoing, reciprocalPartners, undirected };
}

/** Flag agents whose outgoing ratings are mostly reciprocated. */
export function detectByReciprocity(graph: Graph, threshold: number): Set<number> {
  const flagged = new Set<number>();
  for (const node of graph.nodes) {
    const outgoing = graph.outgoing.get(node);
    if (!outgoing || outgoing.size === 0) continue;
    const reciprocal = graph.reciprocalPartners.get(node) ?? 0;
    if (reciprocal / outgoing.size >= threshold) flagged.add(node);
  }
  return flagged;
}

/** Flag agents with at least `minPartners` mutual-rating relationships. */
export function detectByMutualDegree(graph: Graph, minPartners: number): Set<number> {
  const flagged = new Set<number>();
  for (const node of graph.nodes) {
    if ((graph.reciprocalPartners.get(node) ?? 0) >= minPartners) flagged.add(node);
  }
  return flagged;
}

/**
 * Flag agents in a dense clique using k-core decomposition: the core number of
 * a node is the largest k such that the node survives iterative removal of all
 * nodes with degree < k. A mutual-rating ring is a dense clique by
 * construction; organic graphs rarely are.
 */
export function detectByKCore(graph: Graph, threshold: number): Set<number> {
  const nodes = [...graph.nodes];
  const maxDegree = nodes.reduce(
    (max, node) => Math.max(max, graph.undirected.get(node)?.size ?? 0),
    0,
  );

  const core = new Map<number, number>();
  for (const node of nodes) core.set(node, 0);

  for (let k = 1; k <= maxDegree; k += 1) {
    const degree = new Map<number, number>();
    const removed = new Set<number>();
    for (const node of nodes) {
      degree.set(node, graph.undirected.get(node)?.size ?? 0);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (removed.has(node)) continue;
        if ((degree.get(node) ?? 0) < k) {
          removed.add(node);
          changed = true;
          for (const neighbor of graph.undirected.get(node) ?? []) {
            if (!removed.has(neighbor)) {
              degree.set(neighbor, (degree.get(neighbor) ?? 0) - 1);
            }
          }
        }
      }
    }

    // Survivors of the k-core peeling have core number >= k.
    for (const node of nodes) {
      if (!removed.has(node)) core.set(node, k);
    }
  }

  const flagged = new Set<number>();
  for (const node of nodes) {
    if ((core.get(node) ?? 0) >= threshold) flagged.add(node);
  }
  return flagged;
}

function evaluate(name: string, flagged: Set<number>, planted: Set<number>): DetectorResult {
  let truePositives = 0;
  for (const node of flagged) if (planted.has(node)) truePositives += 1;
  const falsePositives = flagged.size - truePositives;
  const falseNegatives = planted.size - truePositives;
  const precision = flagged.size === 0 ? 0 : truePositives / flagged.size;
  const recall = planted.size === 0 ? 0 : truePositives / planted.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    name,
    flagged: flagged.size,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

/**
 * Collusive ring: M accounts confirm every other ring member, mixed into a
 * graph of honest, mostly non-reciprocating agents. A mechanism that counts
 * peer feedback lets the ring manufacture reputation with no external
 * counterparties; a mechanism that ignores peer feedback is structurally
 * immune but has no interaction grounding.
 *
 * Receipt-based mechanisms additionally require each ring member to attest
 * completions for its receipts to attach to; those attestation costs are
 * included in the ring's cost.
 *
 * Detection is evaluated on the graph the mechanism actually records: for
 * mechanisms that ignore receipts there is nothing to inspect.
 */
export function runCollusiveRing(
  mechanism: Mechanism,
  config: CollusionConfig = defaultCollusionConfig,
): CollusionResult {
  const state = mechanism.newState();
  const ring = Array.from({ length: config.ringSize }, (_, i) => i);
  const honest = Array.from({ length: config.honestAgents }, (_, i) => 1000 + i);

  const random = rng(config.seed);
  const edges: Edge[] = [];
  const recordsGraph = mechanism.usesPeerRatings === true;
  const needsCompletions = mechanism.requiresReceipts === true;

  if (needsCompletions) {
    for (const from of ring) {
      for (let k = 0; k < config.ringSize - 1; k += 1) {
        mechanism.attest(state, from, 0);
      }
    }
    for (const from of honest) {
      for (let k = 0; k < config.honestRatings; k += 1) {
        mechanism.attest(state, from, 0);
      }
    }
  }

  for (const from of ring) {
    for (const to of ring) {
      if (from === to) continue;
      for (let k = 0; k < config.ratingsPerPair; k += 1) {
        mechanism.rate(state, from, to, 0);
        if (recordsGraph) edges.push([from, to]);
      }
    }
  }

  // Honest agents rate other honest agents (organic, mostly non-reciprocal
  // edges); they do not prop up ring members, so the ring's score is its own.
  for (const from of honest) {
    for (let r = 0; r < config.honestRatings; r += 1) {
      let to = honest[Math.floor(random() * honest.length)];
      while (to === from) to = honest[Math.floor(random() * honest.length)];
      mechanism.rate(state, from, to, 0);
      if (recordsGraph) edges.push([from, to]);
    }
  }

  const ringScorePerAgent = mechanism.score(state, ring[0], 0);
  const ringCostWei = ring.reduce(
    (sum, id) => sum + mechanism.ensureAgent(state, id).spentWei,
    0,
  );
  const costPerRingPointWei = ringCostWei / Math.max(1, config.ringSize * ringScorePerAgent);

  // One honest reputation point costs an attestation plus (for receipt-based
  // mechanisms) a counterparty receipt.
  const honestCostPerPointWei = mechanism.requiresReceipts
    ? mechanism.attestCost() + mechanism.receiptCost()
    : mechanism.receiptCost();

  const efficiencyRatio =
    costPerRingPointWei > 0
      ? honestCostPerPointWei / costPerRingPointWei
      : ringScorePerAgent === 0
        ? 0
        : Number.POSITIVE_INFINITY;

  const planted = new Set(ring);
  let detectors: DetectorResult[] = [];
  let detectorPrecision: number | null = null;
  let detectorRecall: number | null = null;

  if (recordsGraph) {
    const graph = buildGraph(edges, [...ring, ...honest]);
    const reciprocity = detectByReciprocity(graph, config.reciprocityThreshold);
    const mutualDegree = detectByMutualDegree(
      graph,
      Math.max(3, Math.floor((config.ringSize - 1) / 2)),
    );
    const kCore = detectByKCore(graph, config.coreThreshold);
    const ensemble = new Set([...reciprocity, ...mutualDegree, ...kCore]);
    detectors = [
      evaluate("reciprocity", reciprocity, planted),
      evaluate("mutual_degree", mutualDegree, planted),
      evaluate("k_core", kCore, planted),
      evaluate("ensemble", ensemble, planted),
    ];
    const ensembleResult = detectors[detectors.length - 1];
    detectorPrecision = ensembleResult.precision;
    detectorRecall = ensembleResult.recall;
  }

  const bestDetector = detectors.reduce<DetectorResult | null>(
    (best, current) => (!best || current.f1 > best.f1 ? current : best),
    null,
  );

  const findings =
    ringScorePerAgent === 0
      ? "Peer feedback does not contribute to the score, so the ring manufactures nothing and there is no " +
        "recorded rating graph to inspect. This is immunity by omission, not detection."
      : `A ring of ${config.ringSize} accounts manufactures ${ringScorePerAgent} points per member ` +
        `at ${eth(costPerRingPointWei)} per point, versus ${eth(honestCostPerPointWei)} for a genuine rating. ` +
        (bestDetector
          ? `Best detector: ${bestDetector.name} (precision ${bestDetector.precision.toFixed(2)}, ` +
            `recall ${bestDetector.recall.toFixed(2)}, F1 ${bestDetector.f1.toFixed(2)}) over a mixed graph of ` +
            `${config.ringSize + config.honestAgents} accounts.`
          : "");

  return {
    scenario: "collusive_ring",
    mechanism: mechanism.name,
    config,
    metrics: {
      ringScorePerAgent,
      ringCostWei,
      costPerRingPointWei,
      honestCostPerPointWei,
      efficiencyRatio,
      detectorPrecision,
      detectorRecall,
      detectors,
    },
    findings,
  };
}

/** Backwards-compatible single-detector helper (reciprocity only). */
export function detectRing(ring: number[], edges: Edge[], threshold: number): Set<number> {
  const graph = buildGraph(edges, ring);
  const flagged = detectByReciprocity(graph, threshold);
  // Restrict to the provided candidate list, matching the old contract.
  return new Set([...flagged].filter((node) => ring.includes(node)));
}

export function collusionResistanceScore(result: CollusionResult): number {
  if (result.metrics.ringScorePerAgent === 0) return 100;
  const ratio = result.metrics.efficiencyRatio;
  if (!Number.isFinite(ratio)) return 0;
  if (ratio >= 1) return 0;
  return Math.round((1 - ratio) * 1000) / 10;
}
