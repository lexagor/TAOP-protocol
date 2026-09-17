/**
 * Enforce minimum Solidity coverage (Istanbul `coverage.json`) so a change can't
 * silently drop test coverage. Run after `npm run contracts:coverage`.
 *
 *   node scripts/check-coverage.mjs
 */
import { readFileSync } from "node:fs";

const MIN = { statements: 95, functions: 90, lines: 95, branches: 70 };

const cov = JSON.parse(readFileSync("coverage.json", "utf8"));

const pct = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);
const count = (obj = {}) => {
  const values = Object.values(obj);
  return [values.filter((v) => v > 0).length, values.length];
};

const totals = { statements: [0, 0], functions: [0, 0], lines: [0, 0], branches: [0, 0] };
const add = (key, [c, t]) => {
  totals[key][0] += c;
  totals[key][1] += t;
};

console.log("Coverage per file:");
for (const [file, node] of Object.entries(cov)) {
  add("statements", count(node.s));
  add("functions", count(node.f));
  add("lines", count(node.l));
  let bc = 0;
  let bt = 0;
  for (const paths of Object.values(node.b ?? {})) {
    for (const c of paths) {
      bt += 1;
      if (c > 0) bc += 1;
    }
  }
  add("branches", [bc, bt]);
  console.log(
    `  ${file}: stmts ${pct(...count(node.s)).toFixed(1)}%, lines ${pct(...count(node.l)).toFixed(1)}%`,
  );
}

let failed = false;
console.log("Coverage totals (min):");
for (const key of Object.keys(MIN)) {
  const value = pct(totals[key][0], totals[key][1]);
  const ok = value >= MIN[key];
  if (!ok) failed = true;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${key}: ${value.toFixed(2)}% (min ${MIN[key]}%)`);
}

if (failed) {
  console.error("\n✖ Solidity coverage below the required minimum.");
  process.exit(1);
}
console.log("\n✔ Coverage thresholds met.");
