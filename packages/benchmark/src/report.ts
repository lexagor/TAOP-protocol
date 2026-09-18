import type { MechanismReport } from "./rubric";

export interface ReportMetadata {
  generatedAt: string;
  seed: number;
  nodeVersion: string;
  version: string;
  scenarios: string[];
}

function formatScore(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(1);
}

export function renderReport(
  reports: MechanismReport[],
  metadata: ReportMetadata,
  configLines: string[],
): string {
  const lines: string[] = [];
  lines.push("# TAOP gaming-resistance benchmark");
  lines.push("");
  lines.push(
    "Deterministic, seed-reproducible scores (0-100, higher is better) for the TAOP Base " +
      "mechanisms and four baselines across three attack classes. See `README.md` for the " +
      "rubric and its limitations.",
  );
  lines.push("");
  lines.push(`- Generated: ${metadata.generatedAt}`);
  lines.push(`- Seed: ${metadata.seed}`);
  lines.push(`- Scenarios: ${metadata.scenarios.join(", ")}`);
  lines.push(`- Harness version: ${metadata.version}`);
  lines.push("");

  lines.push("## Configuration");
  lines.push("");
  for (const line of configLines) lines.push(`- ${line}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Mechanism | Sybil | Slow burn | Collusion | Composite |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const report of reports) {
    lines.push(
      `| \`${report.mechanism}\` | ${formatScore(report.scores.sybilFarming)} | ` +
        `${formatScore(report.scores.slowBurnHarvest)} | ${formatScore(report.scores.collusiveRing)} | ` +
        `${report.scores.composite.toFixed(1)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Composite is the equal-weight mean of the three class scores. Note that collusion " +
      '"immunity by omission" (a mechanism that ignores peer feedback cannot be inflated by a ring, ' +
      "so it scores 100) is not the same as detection: per-mechanism detector precision/recall are " +
      "reported with each mechanism below.",
  );
  lines.push("");

  for (const report of reports) {
    lines.push(`## \`${report.mechanism}\``);
    lines.push("");
    lines.push(report.description);
    lines.push("");
    if (report.weakSpots.length > 0) {
      lines.push("Weak spots:");
      lines.push("");
      for (const spot of report.weakSpots) lines.push(`- ${spot}`);
      lines.push("");
    }
    if (report.sybil) {
      lines.push(`**Sybil farming** — score ${formatScore(report.scores.sybilFarming)}/100`);
      lines.push("");
      lines.push(report.sybil.findings);
      lines.push("");
    }
    if (report.slowBurn) {
      lines.push(
        `**Slow burn then harvest** — score ${formatScore(report.scores.slowBurnHarvest)}/100`,
      );
      lines.push("");
      lines.push(report.slowBurn.findings);
      lines.push("");
    }
    if (report.collusion) {
      lines.push(`**Collusive ring** — score ${formatScore(report.scores.collusiveRing)}/100`);
      lines.push("");
      lines.push(report.collusion.findings);
      lines.push("");
      if (report.collusion.metrics.detectors.length > 0) {
        lines.push("| Detector | Flagged | Precision | Recall | F1 |");
        lines.push("|---|---:|---:|---:|---:|");
        for (const detector of report.collusion.metrics.detectors) {
          lines.push(
            `| ${detector.name} | ${detector.flagged} | ${detector.precision.toFixed(2)} | ` +
              `${detector.recall.toFixed(2)} | ${detector.f1.toFixed(2)} |`,
          );
        }
        lines.push("");
      }
    }
  }

  lines.push("## Limitations");
  lines.push("");
  lines.push(
    "- Simulation, not execution: costs mirror the bytecode via the gas snapshot and the " +
      "score rules mirror the contracts, but transactions are not executed.",
  );
  lines.push(
    "- Locked capital is counted at face value; it is recoverable unless slashed. Treat it " +
      "as capital-at-risk, not spend.",
  );
  lines.push(
    "- Challenge and upheld probabilities are assumptions; watcher incentives are not modeled.",
  );
  lines.push(
    "- Detectors are simple structural baselines (reciprocity, mutual degree, k-core); a " +
      "planted ideal clique is easy, adaptive rings are not.",
  );
  lines.push(
    "- L1 data fees, priority-fee spikes, MEV, and reputation laundering across identities " +
      "are not modeled.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}
