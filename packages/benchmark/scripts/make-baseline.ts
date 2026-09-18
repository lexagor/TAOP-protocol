import fs from "node:fs";
import path from "node:path";

import { runBenchmark } from "../src/run";

const { json } = runBenchmark({ seed: 42 });
const parsed = JSON.parse(json) as {
  metadata: Record<string, unknown>;
  configs: unknown;
  params: unknown;
  reports: unknown;
};

const out = path.resolve(import.meta.dirname, "../results/baseline-seed42.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      metadata: { ...parsed.metadata, generatedAt: "baseline" },
      configs: parsed.configs,
      params: parsed.params,
      reports: parsed.reports,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${out}`);
