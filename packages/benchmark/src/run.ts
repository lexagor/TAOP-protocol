import fs from "node:fs";
import path from "node:path";
import { allMechanisms, defaultParams } from "./mechanisms";
import { renderReport } from "./report";
import {
  ALL_SCENARIOS,
  buildMechanismReport,
  defaultBenchmarkConfigs,
  type BenchmarkConfigs,
  type MechanismReport,
  type ScenarioName,
} from "./rubric";

export const HARNESS_VERSION = "0.1.0";

interface CliArgs {
  mechanisms: string[];
  scenarios: ScenarioName[];
  seed: number;
  outDir: string;
  jsonOnly: boolean;
}

const SCENARIO_ALIASES: Record<string, ScenarioName> = {
  all: "sybil",
  sybil: "sybil",
  "slow-burn": "slow-burn",
  slowburn: "slow-burn",
  collusion: "collusion",
};

function parseArgs(argv: string[]): CliArgs {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(`--${flag}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const mechanismArg = value("mechanism");
  const scenarioArg = value("scenario");
  const scenarios: ScenarioName[] =
    !scenarioArg || scenarioArg === "all"
      ? ALL_SCENARIOS
      : scenarioArg
          .split(",")
          .map((name) => {
            const mapped = SCENARIO_ALIASES[name.trim()];
            if (!mapped) {
              throw new Error(`Unknown scenario '${name}'. Use sybil, slow-burn, collusion, or all.`);
            }
            return mapped;
          })
          .filter((name, index, list) => list.indexOf(name) === index);

  return {
    mechanisms: mechanismArg && mechanismArg !== "all" ? mechanismArg.split(",") : [],
    scenarios,
    seed: Number(value("seed") ?? "42"),
    outDir: value("out") ?? path.resolve(import.meta.dirname, "../results"),
    jsonOnly: argv.includes("--json-only"),
  };
}

function printSummary(reports: MechanismReport[], args: CliArgs): void {
  const showSybil = args.scenarios.includes("sybil");
  const showSlowBurn = args.scenarios.includes("slow-burn");
  const showCollusion = args.scenarios.includes("collusion");

  const header = ["mechanism".padEnd(28)];
  if (showSybil) header.push("sybil".padStart(8));
  if (showSlowBurn) header.push("slow-burn".padStart(12));
  if (showCollusion) header.push("collusion".padStart(12));
  header.push("composite".padStart(12));

  console.log(`\nTAOP gaming-resistance benchmark (seed=${args.seed})`);
  console.log(header.join(""));
  for (const report of reports) {
    const row = [report.mechanism.padEnd(28)];
    if (showSybil) row.push((report.scores.sybilFarming?.toFixed(1) ?? "-").padStart(8));
    if (showSlowBurn) {
      row.push((report.scores.slowBurnHarvest?.toFixed(1) ?? "-").padStart(12));
    }
    if (showCollusion) row.push((report.scores.collusiveRing?.toFixed(1) ?? "-").padStart(12));
    row.push(report.scores.composite.toFixed(1).padStart(12));
    console.log(row.join(""));
  }
  console.log("");
}

function configLines(configs: BenchmarkConfigs, args: CliArgs): string[] {
  const lines: string[] = [];
  if (args.scenarios.includes("sybil")) {
    lines.push(
      `Sybil: ${configs.sybil.sybils} identities x ${configs.sybil.attestsPerSybil} attestations, ` +
        `challenge probability ${configs.sybil.challengeProbability}, upheld probability ${configs.sybil.upheldProbability}`,
    );
  }
  if (args.scenarios.includes("slow-burn")) {
    lines.push(
      `Slow burn: target score ${configs.slowBurn.targetScore}, harvest ` +
        `${configs.slowBurn.harvestValueWei / 1e18} ETH, ${configs.slowBurn.attestsPerDay} attestations/day, ` +
        `${configs.slowBurn.accomplices} accomplices`,
    );
  }
  if (args.scenarios.includes("collusion")) {
    lines.push(
      `Collusion: ring of ${configs.collusion.ringSize}, ${configs.collusion.ratingsPerPair} ratings per pair, ` +
        `${configs.collusion.honestAgents} honest agents x ${configs.collusion.honestRatings} ratings, ` +
        `reciprocity threshold ${configs.collusion.reciprocityThreshold}, k-core threshold ${configs.collusion.coreThreshold}`,
    );
  }
  const params = defaultParams();
  lines.push(
    `Economics: ${params.challengeBondWei / 1e18} ETH challenge bond, ` +
      `${params.capabilityBondWei / 1e18} ETH capability bond, 30-day grace + 150-day linear decay`,
  );
  lines.push(
    "Gas: measured from gas-snapshot.json; 0.03 gwei base fee + 0.01 gwei priority fee + 0.000003 ETH L1 data per tx",
  );
  return lines;
}

export function runBenchmark(
  args: Partial<CliArgs> = {},
): { metadata: Record<string, unknown>; reports: MechanismReport[]; json: string } {
  const seed = args.seed ?? 42;
  const scenarios = args.scenarios ?? ALL_SCENARIOS;
  const params = defaultParams();
  const configs = defaultBenchmarkConfigs(seed);
  const mechanisms = allMechanisms(params).filter(
    (mechanism) => !args.mechanisms?.length || args.mechanisms.includes(mechanism.name),
  );
  if (mechanisms.length === 0) {
    throw new Error(`No mechanisms matched: ${args.mechanisms?.join(", ")}`);
  }
  const reports = mechanisms.map((mechanism) =>
    buildMechanismReport(mechanism, configs, scenarios),
  );
  const metadata = {
    generatedAt: new Date().toISOString(),
    seed,
    nodeVersion: process.version,
    version: HARNESS_VERSION,
    scenarios,
  };
  const json = `${JSON.stringify({ metadata, configs, params, reports }, null, 2)}\n`;
  return { metadata, reports, json };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { metadata, reports, json } = runBenchmark({
    mechanisms: args.mechanisms,
    scenarios: args.scenarios,
    seed: args.seed,
  });
  const configs = defaultBenchmarkConfigs(args.seed);

  fs.mkdirSync(args.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(args.outDir, `run-${timestamp}.json`);
  fs.writeFileSync(jsonPath, json);

  if (!args.jsonOnly) {
    const markdown = renderReport(reports, metadata as never, configLines(configs, args));
    const markdownPath = path.join(args.outDir, "RESULTS.md");
    fs.writeFileSync(markdownPath, `${markdown.trimEnd()}\n`);
    console.log(`wrote ${markdownPath}`);
  }
  console.log(`wrote ${jsonPath}`);
  printSummary(reports, args);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("run.ts") || process.argv[1].endsWith("run.js"));
if (invokedDirectly) {
  main();
}
