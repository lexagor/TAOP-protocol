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
    "function pendingOwner() view returns (address)",
    "function CHALLENGE_WINDOW() view returns (uint256)",
    "function CHALLENGE_TIMEOUT() view returns (uint256)",
    "function MAX_URI_LEN() view returns (uint256)",
    "function getTwoSidedScore(address) view returns (uint64,uint64,uint64,uint64,uint16)",
    "function paused() view returns (bool)",
    "function attestCooldown() view returns (uint64)",
    "function getCreditScore(address) view returns (uint64,uint64,uint64,uint64,uint16)",
  ],
  provider,
);
const registry = new ethers.Contract(
  dep.registry,
  [
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function certifier() view returns (address)",
    "function MAX_URI_LEN() view returns (uint256)",
    "function countCapabilitiesByType(bytes32) view returns (uint256)",
    "function paused() view returns (bool)",
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

// v0.3 features (pause, cooldown, diversity score).
let v3 = true;
try {
  const paused = await ron.paused();
  check("v0.3 paused() present", true, `paused=${paused}`);
  if (paused) console.log("WARN  RON is PAUSED — protocol actions are disabled (exits still open).");
} catch {
  v3 = false;
  check("v0.3 paused() present", false, "reverted — pre-v0.3 deployment");
}
try {
  const cooldown = await ron.attestCooldown();
  console.log(`INFO  attestCooldown = ${cooldown}s`);
} catch {
  v3 = false;
  check("v0.3 attestCooldown() present", false, "reverted — pre-v0.3 deployment");
}
try {
  await ron.getCreditScore(dep.validator);
  check("v0.3 getCreditScore present", true);
} catch {
  v3 = false;
  check("v0.3 getCreditScore present", false, "reverted — pre-v0.3 deployment");
}
try {
  const regPaused = await registry.paused();
  console.log(`INFO  Registry paused = ${regPaused}`);
} catch {
  v3 = false;
}

// v0.4 features (challenge liveness, Ownable2Step, URI caps). Absence is INFO
// (the v0.3 pilot predates them); on a v0.4 redeploy they must be present and
// correctly parameterized, so any mismatch fails the run.
const selectorIn = (code, signature) =>
  code.toLowerCase().includes(ethers.id(signature).slice(2, 10).toLowerCase());
const ronHasV4 =
  selectorIn(ronCode, "CHALLENGE_TIMEOUT()") || selectorIn(ronCode, "cancelChallenge(uint256)");
let v4 = false;
if (ronHasV4) {
  v4 = true;
  try {
    const timeout = await ron.CHALLENGE_TIMEOUT();
    check("v0.4 CHALLENGE_TIMEOUT is 90 days", timeout === 7_776_000n, `${timeout}s`);
  } catch {
    check("v0.4 CHALLENGE_TIMEOUT callable", false, "selector present but the call reverted");
  }
  try {
    const maxRon = await ron.MAX_URI_LEN();
    check("v0.4 RON MAX_URI_LEN is 200", maxRon === 200n, `${maxRon} bytes`);
  } catch {
    check("v0.4 RON MAX_URI_LEN callable", false);
  }
  try {
    const maxReg = await registry.MAX_URI_LEN();
    check("v0.4 Registry MAX_URI_LEN is 200", maxReg === 200n, `${maxReg} bytes`);
  } catch {
    check("v0.4 Registry MAX_URI_LEN callable", false);
  }
  check(
    "v0.4 cancelChallenge selector present",
    selectorIn(ronCode, "cancelChallenge(uint256)"),
  );
  check(
    "v0.4 acceptOwnership selector present on both contracts",
    selectorIn(ronCode, "acceptOwnership()") && selectorIn(regCode, "acceptOwnership()"),
  );
  try {
    const [pendingRon, pendingReg] = await Promise.all([ron.pendingOwner(), registry.pendingOwner()]);
    if (pendingRon !== ethers.ZeroAddress || pendingReg !== ethers.ZeroAddress) {
      console.log(
        `WARN  ownership handover pending (RON=${pendingRon}, Registry=${pendingReg}) — execute acceptOwnership() via the Timelock`,
      );
    }
  } catch {
    /* pendingOwner is optional for the check */
  }
} else {
  console.log(
    "INFO  v0.4 surface absent (pre-v0.4 deployment): cancelChallenge, CHALLENGE_TIMEOUT, MAX_URI_LEN, Ownable2Step",
  );
}

console.log(
  `INFO  feature level: ${v4 ? "v0.4" : v3 ? "v0.3" : v2 ? "v0.2" : "pre-v0.2"}`,
);

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

// If the agent key is available, it must correspond to the descriptor's agentA
// (catches an .env / deployments.json mismatch — e.g. a clobbered key).
function readEnvVar(key) {
  try {
    const env = readFileSync(resolve(".env"), "utf8");
    let value = "";
    for (const line of env.split(/\r?\n/)) {
      if (line.trim().startsWith(`${key}=`)) value = line.split("=").slice(1).join("=").trim();
    }
    return value;
  } catch {
    return "";
  }
}
const agentPk = process.env.AGENT_A_PK || readEnvVar("AGENT_A_PK");
if (/^0x[0-9a-fA-F]{64}$/.test(agentPk)) {
  const derived = new ethers.Wallet(agentPk).address;
  check(
    "AGENT_A_PK matches deployments.json agentA",
    derived.toLowerCase() === dep.agentA.toLowerCase(),
    `env=${derived} descriptor=${dep.agentA}`,
  );
} else {
  console.log("INFO  AGENT_A_PK not available — skipping agent key/descriptor check");
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
