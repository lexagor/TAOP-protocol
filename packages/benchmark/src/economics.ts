/**
 * Base (EVM) cost model for the gaming-resistance benchmark.
 *
 * All amounts are denominated in wei. The gas figures come from the committed
 * Hardhat gas snapshot (`gas-snapshot.json`) so the model tracks the real
 * bytecode; price assumptions are published constants so they can be
 * challenged and varied in sensitivity runs.
 */

export const WEI_PER_ETH = 1_000_000_000_000_000_000;

/** Assumed Base L2 base fee (0.03 gwei). */
export const BASE_FEE_WEI_PER_GAS = 30_000_000;

/** Assumed priority fee (0.01 gwei). */
export const PRIORITY_FEE_WEI_PER_GAS = 10_000_000;

/**
 * Approximate L1 data-availability fee per Base transaction (0.000003 ETH).
 * Excludes blob-market variance; results are conservative (costs understated)
 * when this is too low.
 */
export const L1_DATA_FEE_WEI_PER_TX = 3_000_000_000_000;

/** Gas per operation, measured by `npm run contracts:test:gas`. */
export const GAS = {
  attestCompletion: 212_186,
  attestReceipt: 152_606,
  challengeCompletion: 105_920,
  contestChallenge: 59_591,
  resolveChallenge: 84_060,
  finalizeChallenge: 68_476,
  registerCapabilityEth: 305_621,
  certifyCapability: 54_229,
  withdrawBond: 73_980,
} as const;

/** Total cost in wei of a transaction that consumes `gasUsed` L2 gas. */
export function txCost(gasUsed: number): number {
  return (
    gasUsed * (BASE_FEE_WEI_PER_GAS + PRIORITY_FEE_WEI_PER_GAS) +
    L1_DATA_FEE_WEI_PER_TX
  );
}

export function eth(wei: number): string {
  return `${(wei / WEI_PER_ETH).toFixed(9)} ETH`;
}

/** Deterministic PRNG (mulberry32) so published results are reproducible. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
