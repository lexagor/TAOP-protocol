/**
 * Mutation spot-check (test-strength probe).
 *
 * `slither-mutate` can't drive this Hardhat project (crytic-compile insists on a
 * directory but slither-mutate passes the source file), so we do the same idea by
 * hand: deliberately break a critical line, run the suite, and record whether the
 * tests caught it. A surviving mutant is a real test gap.
 *
 *   node scripts/mutation-spotcheck.mjs
 *
 * Restores every file after each run, and exits non-zero if any mutant survives.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const MUTANTS = [
  // ReputationOracleNetwork
  { file: "contracts/ReputationOracleNetwork.sol", find: "completionCount[msg.sender] += 1;", replace: "completionCount[msg.sender] += 2;", label: "RON attestCompletion count +=1 -> +=2" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "confirmedCount[c.agent] += 1;", replace: "confirmedCount[c.agent] += 0;", label: "RON attestReceipt confirmed +=1 -> +=0" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "confirmedCount[c.agent] -= 1;", replace: "confirmedCount[c.agent] -= 0;", label: "RON _uphold does not invalidate receipt" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "disputeCount[c.agent] += 1;", replace: "disputeCount[c.agent] += 0;", label: "RON _uphold does not record dispute" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (msg.value != CHALLENGE_BOND) revert WrongChallengeBond(msg.value, CHALLENGE_BOND);", replace: "if (msg.value > CHALLENGE_BOND) revert WrongChallengeBond(msg.value, CHALLENGE_BOND);", label: "RON challenge accepts wrong (low) bond" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (c.counterparty != address(0)) revert AlreadyReceipted();", replace: "if (false) revert AlreadyReceipted();", label: "RON allows a second receipt" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (block.timestamp > ch.deadline) revert ChallengeWindowClosed();", replace: "if (false) revert ChallengeWindowClosed();", label: "RON allows contest after the window" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (c.disputed) revert ReceiptNotAllowed();\n        if (c.challenged", replace: "if (false) revert ReceiptNotAllowed();\n        if (c.challenged", label: "RON allows receipt on a disputed completion" },
  // CapabilityRegistry
  { file: "contracts/CapabilityRegistry.sol", find: "_removeFromTypeIndex(c.capabilityType, capabilityId);", replace: "// mutated: index cleanup removed", label: "Registry withdrawBond leaves stale index id" },
  { file: "contracts/CapabilityRegistry.sol", find: "capabilitiesByType[capabilityType].push(capabilityId);", replace: "// mutated: index push removed", label: "Registry register does not index" },
  { file: "contracts/CapabilityRegistry.sol", find: "if (end > len) end = len;", replace: "if (false) end = len;", label: "Registry paged view does not clamp" },
  { file: "contracts/CapabilityRegistry.sol", find: "if (msg.sender != c.creator) revert NotCreator();", replace: "if (false) revert NotCreator();", label: "Registry allows non-creator withdraw" },
];

let caught = 0;
let survived = 0;
let skipped = 0;

for (const m of MUTANTS) {
  const original = readFileSync(m.file, "utf8");
  if (!original.includes(m.find)) {
    console.log(`SKIP     ${m.label} (anchor not found)`);
    skipped++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.find, m.replace));
  let testsPassed = true;
  try {
    execSync("npx hardhat test", { stdio: "ignore", timeout: 300000 });
  } catch {
    testsPassed = false;
  }
  writeFileSync(m.file, original); // always restore
  if (testsPassed) {
    console.log(`SURVIVED ${m.label}`);
    survived++;
  } else {
    console.log(`caught   ${m.label}`);
    caught++;
  }
}

console.log(`\nmutation spot-check: caught=${caught} survived=${survived} skipped=${skipped}`);
process.exit(survived > 0 ? 1 : 0);
