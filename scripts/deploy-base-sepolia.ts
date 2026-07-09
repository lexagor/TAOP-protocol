import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploy the TAOP MVP contracts to Base Sepolia (chainId 84532) and write
 * deployments.json at the repo root. ETH-only mode (token = address(0)).
 *
 * The deployer (signer #0, from DEPLOYER_PK) becomes the certifier + the
 * challenge resolver (owner). A fresh Agent A wallet is generated, saved,
 * and funded from the deployer so it can bond + self-attest.
 *
 *   npm run deploy:sepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  console.log("Deploying to Base Sepolia with deployer:", deployerAddr);

  const deployerBal = await ethers.provider.getBalance(deployerAddr);
  console.log("Deployer balance:", ethers.formatEther(deployerBal), "ETH");

  // --- Deploy RON (v1, ETH-only) ---
  const RON = await ethers.getContractFactory("ReputationOracleNetwork");
  const ron = await RON.deploy();
  await ron.waitForDeployment();
  const ronAddr = await ron.getAddress();
  console.log("ReputationOracleNetwork:", ronAddr);

  // --- Deploy CapabilityRegistry (v1, ETH-only, certifier = deployer) ---
  const Registry = await ethers.getContractFactory("CapabilityRegistry");
  const registry = await Registry.deploy(deployerAddr);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("CapabilityRegistry:", registryAddr);

  // --- Generate a fresh Agent A wallet, fund it from the deployer ---
  const agentAWallet = ethers.Wallet.createRandom();
  const agentAAddr = agentAWallet.address;
  const agentAPk = agentAWallet.privateKey;
  const fundAmount = ethers.parseEther("0.05"); // enough for several 0.01 ETH bonds + gas
  console.log("Funding Agent A:", agentAAddr, "with", ethers.formatEther(fundAmount), "ETH");
  const fundTx = await deployer.sendTransaction({
    to: agentAAddr,
    value: fundAmount,
  });
  await fundTx.wait();
  console.log("Funded Agent A in tx:", fundTx.hash);

  const deployment = {
    chainId: 84532,
    network: "base-sepolia",
    ron: ronAddr,
    registry: registryAddr,
    validator: deployerAddr,
    agentA: agentAAddr,
    agentAPk: agentAPk,
    deployedAt: new Date().toISOString(),
  };
  const outPath = path.resolve(__dirname, "..", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n");

  console.log("\n=== TAOP MVP deployed to Base Sepolia ===");
  console.log("RON:       ", ronAddr);
  console.log("Registry:  ", registryAddr);
  console.log("Agent A:   ", agentAAddr);
  console.log("Agent A PK:", agentAPk);
  console.log("Basescan:  https://sepolia.basescan.org/address/" + ronAddr);
  console.log("\nWrote", outPath);
  console.log("\nNext: set AGENT_A_PK=" + agentAPk + " in .env");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
