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
  // v0.3 hardening
  { file: "contracts/ReputationOracleNetwork.sol", find: "nonReentrant\n        whenNotPaused\n        returns (uint256 completionId)", replace: "nonReentrant\n        returns (uint256 completionId)", label: "RON attestCompletion ignores pause" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (attestCooldown != 0) {", replace: "if (false) {", label: "RON attest cooldown ignored" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (counterpartyConfirmations[c.agent][msg.sender] == 0) {\n            distinctCounterparties[c.agent] += 1;\n        }", replace: "// mutated: diversity not tracked", label: "RON distinct counterparties not counted" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "confirmedCount[c.agent] -= 1;\n            _decrementCounterparty(c.agent, cp);", replace: "confirmedCount[c.agent] -= 1;", label: "RON does not decrement diversity on upheld dispute" },
  // v0.4 hardening: challenge liveness + URI caps
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (block.timestamp < readyAt) revert ChallengeNotTimedOut(readyAt);", replace: "if (false) revert ChallengeNotTimedOut(readyAt);", label: "RON cancelChallenge ignores the timeout" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (msg.sender != ch.challenger) revert NotChallenger();", replace: "if (false) revert NotChallenger();", label: "RON cancelChallenge open to anyone" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "if (bytes(uri).length > MAX_URI_LEN) revert URITooLong(bytes(uri).length);", replace: "if (false) revert URITooLong(bytes(uri).length);", label: "RON URI cap ignored" },
  { file: "contracts/ReputationOracleNetwork.sol", find: "ch.resolved = true;\n        (bool ok, ) = payable(ch.challenger).call{value: CHALLENGE_BOND}(\"\");", replace: "ch.resolved = true;\n        (bool ok, ) = payable(ch.challenger).call{value: 0}(\"\");", label: "RON cancelChallenge does not refund" },
  { file: "contracts/CapabilityRegistry.sol", find: "if (bytes(uri).length > MAX_URI_LEN) revert URITooLong(bytes(uri).length);", replace: "if (false) revert URITooLong(bytes(uri).length);", label: "Registry URI cap ignored" },
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
