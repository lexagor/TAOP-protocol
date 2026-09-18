import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runBenchmark } from "../src/run";

/**
 * The committed seed-42 baseline pins the published numbers: any change to the
 * mechanisms, scenarios, or economics must be intentional and regenerate
 * `results/baseline-seed42.json`.
 */
describe("published baseline (seed 42)", () => {
  it("reproduces exactly", () => {
    const baselinePath = path.resolve(import.meta.dirname, "../results/baseline-seed42.json");
    if (!fs.existsSync(baselinePath)) {
      throw new Error(
        `Missing ${baselinePath}. Generate it with: npm run benchmark:baseline`,
      );
    }
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as {
      reports: unknown;
    };
    const { reports } = runBenchmark({ seed: 42 });
    expect(JSON.parse(JSON.stringify(reports))).toEqual(baseline.reports);
  });
});
