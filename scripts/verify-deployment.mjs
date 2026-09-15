/**
 * Verify an on-chain deployment against deployments.json.
 *
 *   npm run verify:deployment            # uses ./deployments.json
 *   DEPLOYMENTS_PATH=/tmp/new.json npm run verify:deployment
 *
 * Checks the addresses are live, ownership moved to the Timelock, the certifier
 * is set, the v0.2 features are actually present (not just claimed), and the
 * recorded deployedBlock is sane. Exits non-zero on any failure.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = process.env.DEPLOYMENTS_PATH || resolve("deployments.json");
const dep = JSON.parse(readFileSync(path, "utf8"));
const rpc =
  process.env.RPC_URL ||
  (dep.chainId === 8453
    ? process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"
    : dep.chainId === 84532
      ? process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
      : "http://127.0.0.1:8545");

const provider = new ethers.JsonRpcProvider(rpc, dep.chainId);
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const ron = new ethers.Contract(
  dep.ron,
  [
    "function owner() view returns (address)",
    "function CHALLENGE_WINDOW() view returns (uint256)",
    "function getTwoSidedScore(address) view returns (uint64,uint64,uint64,uint64,uint16)",
  ],
  provider,
);
const registry = new ethers.Contract(
  dep.registry,
  [
    "function owner() view returns (address)",
    "function certifier() view returns (address)",
    "function countCapabilitiesByType(bytes32) view returns (uint256)",
  ],
  provider,
);
const timelock = new ethers.Contract(dep.timelock, ["function getMinDelay() view returns (uint256)"], provider);

console.log(`deployments: ${path}`);
console.log(`rpc: ${rpc}  chainId: ${dep.chainId}\n`);

const head = await provider.getBlockNumber();
const [ronCode, regCode] = await Promise.all([
  provider.getCode(dep.ron),
  provider.getCode(dep.registry),
]);
check("RON has bytecode", ronCode !== "0x");
check("Registry has bytecode", regCode !== "0x");

const [ronOwner, regOwner, certifier] = await Promise.all([
  ron.owner(),
  registry.owner(),
  registry.certifier(),
]);
check("RON owner is the Timelock", ronOwner.toLowerCase() === dep.timelock.toLowerCase(), ronOwner);
check("Registry owner is the Timelock", regOwner.toLowerCase() === dep.timelock.toLowerCase(), regOwner);
check("certifier is set", certifier !== ethers.ZeroAddress, certifier);

// v0.2 features must actually exist (call them and require success).
let v2 = true;
try {
  const w = await ron.CHALLENGE_WINDOW();
  check("v0.2 CHALLENGE_WINDOW present", w > 0n, `${w}s`);
} catch {
  v2 = false;
  check("v0.2 CHALLENGE_WINDOW present", false, "reverted — pre-v0.2 deployment");
}
try {
  await ron.getTwoSidedScore(dep.validator);
  check("v0.2 getTwoSidedScore present", true);
} catch {
  v2 = false;
  check("v0.2 getTwoSidedScore present", false, "reverted — pre-v0.2 deployment");
}
try {
  await registry.countCapabilitiesByType(ethers.id("LoRA"));
  check("v0.2 countCapabilitiesByType present", true);
} catch {
  v2 = false;
  check("v0.2 countCapabilitiesByType present", false, "reverted — pre-v0.2 deployment");
}
if (!v2) check("deployment is v0.2 (F11/F10 active)", false, "redeploy not reflected on-chain");

try {
  const delay = await timelock.getMinDelay();
  console.log(`INFO  Timelock minDelay = ${delay}s`);
  if (delay === 0n) console.log("INFO  0-delay (pilot). Mainnet requires a multisig + non-zero delay.");
} catch {
  check("Timelock reachable", false);
}

if (dep.deployedBlock !== undefined) {
  check("deployedBlock <= head", Number(dep.deployedBlock) <= head, `${dep.deployedBlock} <= ${head}`);
} else {
  console.log("INFO  no deployedBlock recorded (older file)");
}

for (const [label, addr] of [["validator", dep.validator], ["agentA", dep.agentA]]) {
  try {
    console.log(`INFO  ${label} ${addr} balance: ${ethers.formatEther(await provider.getBalance(addr))} ETH`);
  } catch {
    /* ignore */
  }
}

console.log(failures === 0 ? "\nAll deployment checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
