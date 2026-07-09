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

  // --- Deploy CapabilityRegistry (ETH-only, certifier = deployer) ---
  const Registry = await ethers.getContractFactory("CapabilityRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();

  const deployment = {
    chainId: 31337,
    token: ethers.ZeroAddress,
    ron: await ron.getAddress(),
    registry: await registry.getAddress(),
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
