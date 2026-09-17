import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertNotTracked, assertNoKeyMaterial } from "./lib/security";

/**
 * Deploy the TAOP contracts to a local hardhat node (chainId 31337) and write
 * `deployments.json` (or `DEPLOYMENTS_PATH`).
 *
 * Mirrors `scripts/deploy-base-sepolia.ts` so a local run is a faithful proxy for
 * the Base Sepolia redeploy: same Timelock ownership transfer, same output shape
 * (addresses only, plus `deployedBlock` so the F10 indexer can backfill).
 *
 *   npx hardhat node            # terminal 1
 *   npm run deploy:local        # terminal 2
 *
 * Hardened rehearsal (non-zero delay + multisig-style proposers/executors):
 *   MULTISIG_ADDRESS=0xSafe... TIMELOCK_DELAY=3600 npm run deploy:local
 */
function resolveOutPath(): string {
  return process.env.DEPLOYMENTS_PATH
    ? path.resolve(process.env.DEPLOYMENTS_PATH)
    : path.resolve(__dirname, "..", "deployments.json");
}

/**
 * Refuse to clobber an existing non-local deployment file. Running `deploy:local`
 * in a checkout that also holds a live `deployments.json` (chainId 84532/8453)
 * would otherwise silently overwrite the live addresses with local ones.
 */
function assertSafeOverwrite(outPath: string): void {
  if (process.env.DEPLOYMENTS_PATH) return; // explicit path = explicit intent
  if (process.env.ALLOW_OVERWRITE_DEPLOYMENTS === "true") return;
  if (!fs.existsSync(outPath)) return;
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8")) as { chainId?: number };
    if (existing.chainId && existing.chainId !== 31337) {
      console.error(
        `\n❌ REFUSING TO OVERWRITE ${outPath}: it holds a chainId ${existing.chainId} deployment (not local).`,
      );
      console.error("   Use DEPLOYMENTS_PATH=/tmp/local.json, or set ALLOW_OVERWRITE_DEPLOYMENTS=true to override.\n");
      process.exit(1);
    }
  } catch {
    /* unreadable/partial file — allow */
  }
}

async function main() {
  const [deployer, agentA] = await ethers.getSigners();

  // Capture the block so the F10 indexer can backfill from the deployment point.
  const deployStartBlock = await ethers.provider.getBlockNumber();

  const RON = await ethers.getContractFactory("ReputationOracleNetwork");
  const ron = await RON.deploy();
  await ron.waitForDeployment();
  const ronAddr = await ron.getAddress();

  const Registry = await ethers.getContractFactory("CapabilityRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();

  // --- TimelockController + ownership transfer (P0 hardening) ---
  // 0 delay by default so the pilot/demo stays instant. For a hardened rehearsal
  // (and pre-mainnet): TIMELOCK_DELAY=3600 + a multisig in proposers/executors.
  const Timelock = await ethers.getContractFactory("TimelockController");
  const minDelay = process.env.TIMELOCK_DELAY ? BigInt(process.env.TIMELOCK_DELAY) : 0n;

  let proposers: string[];
  let executors: string[];
  const multisig = process.env.MULTISIG_ADDRESS;
  if (multisig && multisig.length === 42) {
    proposers = [multisig];
    executors = [multisig];
  } else if (process.env.PROPOSERS || process.env.EXECUTORS) {
    proposers = (process.env.PROPOSERS || deployer.address).split(",").map((s) => s.trim());
    executors = (process.env.EXECUTORS || deployer.address).split(",").map((s) => s.trim());
  } else {
    proposers = [deployer.address];
    executors = [deployer.address];
  }
  const timelock = await Timelock.deploy(minDelay, proposers, executors, ethers.ZeroAddress);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();

  await ron.transferOwnership(timelockAddr);
  await registry.transferOwnership(timelockAddr);

  const deployment = {
    chainId: 31337,
    network: "localhost",
    token: ethers.ZeroAddress, // legacy field kept for the Python SDK loader
    ron: ronAddr,
    registry: registryAddr,
    timelock: timelockAddr,
    validator: deployer.address,
    agentA: agentA.address,
    validatorStake: "0",
    deployedAt: new Date().toISOString(),
    deployedBlock: deployStartBlock,
  };
  const outPath = resolveOutPath();
  assertSafeOverwrite(outPath);
  assertNotTracked(outPath, "deployments output");
  const json = JSON.stringify(deployment, null, 2) + "\n";
  assertNoKeyMaterial(json, outPath);
  fs.writeFileSync(outPath, json);

  console.log("TAOP deployed to localhost (chainId 31337, ETH-only mode):");
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(
    `Timelock delay: ${minDelay}s | proposers: ${proposers.join(", ")} | executors: ${executors.join(", ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
