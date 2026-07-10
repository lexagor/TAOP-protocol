import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploy the TAOP MVP contracts to a local hardhat node (chainId 31337) and
 * write deployments.json at the repo root.
 *
 * MVP (v0.1) runs in ETH-only mode: both contracts are deployed with
 * `token = address(0)`. Bonds are in ETH via `registerCapabilityEth`.
 * The validator-staking + token-bond paths (v2) remain in the bytecode but
 * are not exercised.
 *
 *   npx hardhat node   # in another terminal
 *   npm run deploy:local
 */
async function main() {
  const [deployer, agentA] = await ethers.getSigners();

  // RON: deploy with address(0) — validator path is dormant, ETH challenge
  // path is the MVP.
  const RON = await ethers.getContractFactory("ReputationOracleNetwork");
  const ron = await RON.deploy();
  await ron.waitForDeployment();
  const ronAddr = await ron.getAddress();

  // --- Deploy CapabilityRegistry (ETH-only, certifier = deployer) ---
  const Registry = await ethers.getContractFactory("CapabilityRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();

  // --- Deploy TimelockController and transfer ownership (P0 hardening) ---
  // We use 0 delay for local tests and the public pilot/demo so admin actions remain instant
  // and the full interactive flow is usable. For hardened testing or pre-mainnet use:
  //   TIMELOCK_DELAY=86400 npm run deploy:local
  // (and configure a multisig in the proposers/executors arrays).
  const Timelock = await ethers.getContractFactory("TimelockController");
  const minDelay = process.env.TIMELOCK_DELAY ? BigInt(process.env.TIMELOCK_DELAY) : 0n;
  const proposers = [deployer.address];
  const executors = [deployer.address];
  const admin = ethers.ZeroAddress; // renounce admin role after setup
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();

  // Transfer ownership so only the Timelock can call owner-only functions
  await ron.transferOwnership(timelockAddr);
  await registry.transferOwnership(timelockAddr);

  const deployment = {
    chainId: 31337,
    token: ethers.ZeroAddress,
    ron: ronAddr,
    registry: registryAddr,
    timelock: timelockAddr,
    validator: deployer.address,
    agentA: agentA.address,
    validatorStake: "0",
  };
  const outPath = path.resolve(__dirname, "..", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n");

  console.log("TAOP MVP (ETH-only mode) deployed to localhost:");
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
