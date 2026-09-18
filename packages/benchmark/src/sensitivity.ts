/**
 * Sensitivity analysis: how class scores move with the assumptions that matter
 * most. Run with `npm run benchmark:sensitivity -w @taopp/benchmark`.
 */

import fs from "node:fs";
import path from "node:path";
import { WEI_PER_ETH } from "./economics";
import { BaseTaopSelfAttestMechanism, BaseTaopV03Mechanism, defaultParams } from "./mechanisms";
import { defaultBenchmarkConfigs, ALL_SCENARIOS, buildMechanismReport } from "./rubric";
import { defaultSybilConfig, sybilResistanceScore, runSybilFarming } from "./scenarios/sybil";
import { defaultSlowBurnConfig, slowBurnResistanceScore, runSlowBurnHarvest } from "./scenarios/slowBurn";

const SYBIL_CHALLENGE_PROBABILITIES = [0, 0.01, 0.05, 0.1, 0.3, 0.5];
const CAPABILITY_BONDS_ETH = [0.001, 0.01, 0.1, 1, 5];
const ETH_PRICE_USD = 3_000;

function sybilTable(): string[] {
  const lines: string[] = [];
  lines.push("### Sybil resistance vs watcher challenge probability");
  lines.push("");
  lines.push("| Challenge probability | Self-attest | v0.3 credit score |");
  lines.push("|---:|---:|---:|");
  for (const probability of SYBIL_CHALLENGE_PROBABILITIES) {
    const config = { ...defaultSybilConfig, challengeProbability: probability };
    const selfAttest = sybilResistanceScore(
      runSybilFarming(new BaseTaopSelfAttestMechanism(defaultParams()), config),
    );
    const v03 = sybilResistanceScore(
      runSybilFarming(new BaseTaopV03Mechanism(defaultParams()), config),
    );
    lines.push(
      `| ${probability.toFixed(2)} | ${selfAttest.toFixed(1)} | ${v03.toFixed(1)} |`,
    );
  }
  lines.push("");
  return lines;
}

function slowBurnTable(): string[] {
  const lines: string[] = [];
  lines.push("### Slow-burn coverage vs capability bond (harvest = 5 ETH)");
  lines.push("");
  lines.push("| Capability bond | USD (at $3k/ETH) | Slash coverage | Resistance |");
  lines.push("|---:|---:|---:|---:|");
  for (const bondEth of CAPABILITY_BONDS_ETH) {
    const params = { ...defaultParams(), capabilityBondWei: bondEth * WEI_PER_ETH };
    const result = runSlowBurnHarvest(
      new BaseTaopV03Mechanism(params),
      defaultSlowBurnConfig,
    );
    lines.push(
      `| ${bondEth} ETH | $${(bondEth * ETH_PRICE_USD).toLocaleString("en-US")} | ` +
        `${(result.metrics.slashCoverage * 100).toFixed(2)}% | ${slowBurnResistanceScore(result).toFixed(1)} |`,
    );
  }
  lines.push("");
  return lines;
}

function summary(): string[] {
  const configs = defaultBenchmarkConfigs(42);
  const mechanisms = [
    new BaseTaopV03Mechanism(defaultParams()),
    new BaseTaopSelfAttestMechanism(defaultParams()),
  ];
  const lines: string[] = [];
  lines.push("### Seed-42 reference");
  lines.push("");
  lines.push("| Mechanism | Sybil | Slow burn | Collusion | Composite |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const mechanism of mechanisms) {
    const report = buildMechanismReport(mechanism, configs, ALL_SCENARIOS);
    lines.push(
      `| \`${report.mechanism}\` | ${report.scores.sybilFarming?.toFixed(1)} | ` +
        `${report.scores.slowBurnHarvest?.toFixed(1)} | ${report.scores.collusiveRing?.toFixed(1)} | ` +
        `${report.scores.composite.toFixed(1)} |`,
    );
  }
  lines.push("");
  return lines;
}

function main(): void {
  const lines = [
    "# TAOP benchmark sensitivity",
    "",
    "Assumptions are varied one at a time around the seed-42 defaults. Amounts are in ETH;",
    "the reference capital threshold for the Sybil capital component is 0.01 ETH.",
    "",
    ...summary(),
    ...sybilTable(),
    ...slowBurnTable(),
    "",
    "Notes:",
    "",
    "- The Sybil capital component is zero for both TAOP mechanisms when attackers lock no",
    "  capital; the difference between them is the cost of the counterparty receipts a",
    "  diversity-adjusted score requires.",
    "- Slow-burn resistance is linear in the capability bond because the bond is the only",
    "  slashable capital: coverage of a 5 ETH harvest needs a 5 ETH bond.",
    "",
  ];
  const text = `${lines.join("\n").trimEnd()}\n`;
  const outDir = path.resolve(import.meta.dirname, "../results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "SENSITIVITY.md"), text);
  console.log(text);
  console.log(`wrote ${path.join(outDir, "SENSITIVITY.md")}`);
}

main();

export { sybilTable, slowBurnTable, summary };
