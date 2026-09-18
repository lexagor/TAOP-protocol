#!/usr/bin/env node
/**
 * Build the Timelock calldata + Safe Transaction Builder files for a privileged
 * TAOP admin action. Nothing is sent — you review and execute via the Safe UI.
 *
 *   node scripts/timelock-tx.mjs --action pause
 *   node scripts/timelock-tx.mjs --action unpause
 *   node scripts/timelock-tx.mjs --action cooldown --seconds 3600
 *   node scripts/timelock-tx.mjs --action resolve --completion 1 --upheld true
 *   node scripts/timelock-tx.mjs --action setCertifier --certifier 0xSafe
 *   node scripts/timelock-tx.mjs --action withdrawRon --to 0xAddr --amount-eth 0.01
 *   node scripts/timelock-tx.mjs --action withdrawRegistry --to 0xAddr --amount-eth 0.01
 *   node scripts/timelock-tx.mjs --action acceptOwnership --target ron|registry
 *
 * Options: --deployments <path> (default deployments.json), --delay <seconds>
 * (default $TIMELOCK_DELAY or 3600), --out <prefix> (default timelock-batch).
 *
 * Writes <prefix>-schedule.json and <prefix>-execute.json for
 * https://app.safe.global/apps/transaction-builder (same salt in both).
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const action = opt("action");
if (!action) {
  console.error(
    "Missing --action (pause|unpause|cooldown|resolve|setCertifier|withdrawRon|withdrawRegistry|acceptOwnership)",
  );
  process.exit(2);
}

const depPath = opt("deployments", "deployments.json");
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const delay = BigInt(opt("delay", process.env.TIMELOCK_DELAY || "3600"));
const outPrefix = opt("out", "timelock-batch");

const RON_IFACE = new ethers.Interface([
  "function pause()",
  "function unpause()",
  "function setAttestCooldown(uint64 cooldown)",
  "function resolveChallenge(uint256 completionId, bool upheld)",
  "function withdrawEthPool(address payable to, uint256 amount)",
  "function acceptOwnership()",
]);
const REG_IFACE = new ethers.Interface([
  "function setCertifier(address c)",
  "function withdrawEthPool(address payable to, uint256 amount)",
  "function acceptOwnership()",
]);
const TIMELOCK_IFACE = new ethers.Interface([
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt)",
]);

let target = dep.ron;
let inner;
let label;
switch (action) {
  case "pause":
    inner = RON_IFACE.encodeFunctionData("pause");
    label = "RON.pause()";
    break;
  case "unpause":
    inner = RON_IFACE.encodeFunctionData("unpause");
    label = "RON.unpause()";
    break;
  case "cooldown":
    inner = RON_IFACE.encodeFunctionData("setAttestCooldown", [BigInt(opt("seconds", "3600"))]);
    label = `RON.setAttestCooldown(${opt("seconds", "3600")})`;
    break;
  case "resolve":
    inner = RON_IFACE.encodeFunctionData("resolveChallenge", [BigInt(opt("completion", "1")), opt("upheld", "true") === "true"]);
    label = `RON.resolveChallenge(${opt("completion", "1")}, ${opt("upheld", "true")})`;
    break;
  case "setCertifier":
    target = dep.registry;
    inner = REG_IFACE.encodeFunctionData("setCertifier", [opt("certifier", "")]);
    label = `Registry.setCertifier(${opt("certifier", "")})`;
    break;
  case "withdrawRon":
    inner = RON_IFACE.encodeFunctionData("withdrawEthPool", [
      opt("to", ""),
      ethers.parseEther(opt("amount-eth", "0.01")),
    ]);
    label = `RON.withdrawEthPool(${opt("to", "")}, ${opt("amount-eth", "0.01")} ETH)`;
    break;
  case "withdrawRegistry":
    target = dep.registry;
    inner = REG_IFACE.encodeFunctionData("withdrawEthPool", [
      opt("to", ""),
      ethers.parseEther(opt("amount-eth", "0.01")),
    ]);
    label = `Registry.withdrawEthPool(${opt("to", "")}, ${opt("amount-eth", "0.01")} ETH)`;
    break;
  case "acceptOwnership": {
    const which = opt("target", "ron");
    if (which === "registry") {
      target = dep.registry;
      inner = REG_IFACE.encodeFunctionData("acceptOwnership");
      label = "Registry.acceptOwnership()";
    } else if (which === "ron") {
      inner = RON_IFACE.encodeFunctionData("acceptOwnership");
      label = "RON.acceptOwnership()";
    } else {
      console.error("Unknown --target:", which, "(use ron or registry)");
      process.exit(2);
    }
    break;
  }
  default:
    console.error("Unknown --action:", action);
    process.exit(2);
}

const salt = ethers.id(`taop-${action}-${Date.now()}`);
const predecessor = ethers.ZeroHash;

const scheduleData = TIMELOCK_IFACE.encodeFunctionData("schedule", [target, 0, inner, predecessor, salt, delay]);
const executeData = TIMELOCK_IFACE.encodeFunctionData("execute", [target, 0, inner, predecessor, salt]);

const batch = (name, data) =>
  JSON.stringify(
    {
      version: "1.0",
      chainId: String(dep.chainId),
      createdAt: Date.now(),
      meta: { name, description: `TAOP ${action} via Timelock (delay ${delay}s)` },
      transactions: [{ to: dep.timelock, value: "0", data }],
    },
    null,
    2,
  ) + "\n";

writeFileSync(`${outPrefix}-schedule.json`, batch(`TAOP schedule ${action}`, scheduleData));
writeFileSync(`${outPrefix}-execute.json`, batch(`TAOP execute ${action}`, executeData));

console.log(`action:     ${label}`);
console.log(`timelock:   ${dep.timelock}`);
console.log(`target:     ${target}`);
console.log(`delay:      ${delay}s`);
console.log(`salt:       ${salt}`);
console.log(`inner data: ${inner}`);
console.log("");
console.log(`1) Schedule (Safe -> Transaction Builder): ${outPrefix}-schedule.json`);
console.log(`2) Wait ${delay}s, verify isOperationReady(hashOperation(...))`);
console.log(`3) Execute:                                ${outPrefix}-execute.json`);
console.log("");
console.log("Or paste into Safe's Transaction Builder as Calldata:");
console.log(`  To:   ${dep.timelock}`);
console.log(`  Data: ${scheduleData}`);
