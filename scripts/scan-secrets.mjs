#!/usr/bin/env node
/**
 * Scan tracked files for secret-shaped literals. Catches a key pasted into any
 * file (not just the known filenames the gitignore guard covers).
 *
 *   npm run scan:secrets
 *
 * Well-known Hardhat test keys are allowlisted; everything else is a failure.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Public, always-funded Hardhat dev keys — safe by design.
const ALLOWLIST = new Set([
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
]);

const PATTERNS = [
  {
    // Key material assigned to a key-ish identifier.
    re: /\b(agentAPk|privateKey|private_key|PRIVATE_KEY|DEPLOYER_PK|AGENT_A_PK|ORACLE_PK|ARA_DEPLOYER_PK|ARA_DISPUTE_PK|ARA_RELAYER_PK|MNEMONIC|SEED_PHRASE)\b\s*[:=]\s*["']?(0x[0-9a-fA-F]{64})/g,
    label: (m) => `private-key literal near "${m[1]}"`,
    skip: (m) => ALLOWLIST.has(m[2].toLowerCase()),
  },
  {
    // JWTs (Pinata, etc.).
    re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    label: () => "JWT-shaped literal",
    skip: () => false,
  },
  {
    // Provider tokens assigned to their env var.
    re: /\b(PINATA_JWT|PINATA_API_KEY|REPLICATE_API_TOKEN|TAOP_API_KEY|BASESCAN_API_KEY)\b\s*[:=]\s*["']?([A-Za-z0-9._-]{20,})/g,
    label: (m) => `${m[1]} literal`,
    skip: (m) => /[<>{]/.test(m[2]) || /YOUR|PLACEHOLDER|EXAMPLE|test-key/i.test(m[2]),
  },
];

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|eot|pdf|tgz|zip|gz|xz|db|sqlite|wasm|node)$/i;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
let hits = 0;

for (const file of files) {
  if (BINARY.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { re, label, skip } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        if (skip(m)) continue;
        console.error(`${file}:${i + 1}  ${label(m)}`);
        hits++;
      }
    }
  });
}

if (hits > 0) {
  console.error(`\n✖ ${hits} potential secret(s) in tracked files. Remove them and rotate any exposed value.`);
  process.exit(1);
}
console.log(`scan-secrets: ${files.length} tracked files, no secrets found`);
