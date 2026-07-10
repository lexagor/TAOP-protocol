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
  if (!deployer) {
    console.error("\n❌ ERROR: No deployer signer available.");
    console.error("   Set a valid DEPLOYER_PK (0x + 64 hex chars) in .env");
    console.error("   Example: DEPLOYER_PK=0x1234... (length must be 66)");
    console.error("\n   Get test ETH for Base Sepolia (free faucets):");
    console.error("   - Coinbase CDP: https://portal.cdp.coinbase.com/products/faucet (up to 0.1 ETH/24h)");
    console.error("   - Alchemy: https://www.alchemy.com/faucets/base-sepolia");
    console.error("   - thirdweb: https://thirdweb.com/base-sepolia-testnet");
    console.error("   - Official list: https://docs.base.org/base-chain/network-information/network-faucets");
    console.error("   - Chainlink: https://faucets.chain.link/base-sepolia\n");
    console.error("   Then: npm run deploy:sepolia\n");
    process.exit(1);
  }
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

  // --- Deploy TimelockController and transfer ownership (P0: harden single owner) ---
  // Using 0 delay for the live pilot/demo so resolve flows remain instant and the demo is usable.
  // For real use (e.g. testing hardened flows or before mainnet): set TIMELOCK_DELAY=86400 (1 day)
  // and use a multisig as proposer (update proposers/executors arrays).
  // Mainnet prep: increase delay, use multisig, run audit. See IMPROVEMENTS_PLAN.md
  const Timelock = await ethers.getContractFactory("TimelockController");
  const minDelay = process.env.TIMELOCK_DELAY ? BigInt(process.env.TIMELOCK_DELAY) : 0n;
  const proposers = [deployerAddr];
  const executors = [deployerAddr];
  const admin = ethers.ZeroAddress;
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  console.log("TimelockController:", timelockAddr);

  await ron.transferOwnership(timelockAddr);
  await registry.transferOwnership(timelockAddr);

  // --- Generate a fresh Agent A wallet, fund it from the deployer ---
  const agentAWallet = ethers.Wallet.createRandom();
  const agentAAddr = agentAWallet.address;
  const agentAPk = agentAWallet.privateKey;
  const fundAmount = ethers.parseEther("0.02"); // lowered from 0.05 for small testnet balances (still enough for several 0.01 bonds + gas)
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
    timelock: timelockAddr,
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
