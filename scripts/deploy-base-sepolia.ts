import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertNotTracked, assertNoKeyMaterial, backupFile } from "./lib/security";

/**
 * Deploy the TAOP MVP contracts (works for Sepolia or mainnet).
 * Writes deployments.json (addresses only). ETH-only mode.
 *
 * SECURITY: private keys are NEVER written to deployments.json or printed to
 * stdout. The generated Agent A key is written to the gitignored `.env` only
 * (chmod 600). See `SECURITY.md` / `NEXT_BEST_STEPS_2026-09.md` (F1).
 *
 * For mainnet prep (Step 5): `npm run deploy:mainnet`
 * - Keep 0 delay for pilot usability (see minDelay below and README).
 * - Update hardhat "base" + provide BASE_MAINNET_RPC_URL + real funds.
 * - Use multisig for proposers/executors post-audit.
 *
 * Sepolia: npm run deploy:sepolia
 */
/** Idempotently set `KEY=value` in a dotenv file (creates it if missing).
 *  Never logs the value; restricts the file to the current user (chmod 600). */
function upsertEnvVar(file: string, key: string, value: string): void {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (idx >= 0) lines[idx] = line;
  else {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(line);
  }
  fs.writeFileSync(file, lines.join("\n"), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

async function main() {
  // Detect the target by CHAIN ID, not the hardhat network name: a custom/renamed
  // mainnet network would otherwise be treated as testnet (wrong chainId, and
  // auto-funding a fresh agent with real ETH).
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isMainnet = chainId === 8453;
  // Hardhat exposes forking config on the network; treat a fork as a rehearsal.
  const isFork = Boolean((network.config as { forking?: unknown }).forking);
  const networkLabel = isMainnet ? "Base mainnet" : chainId === 84532 ? "Base Sepolia" : `chain ${chainId}`;

  if (!isMainnet && chainId !== 84532 && chainId !== 31337 && process.env.ALLOW_UNKNOWN_CHAIN !== "true") {
    console.error(`\n❌ REFUSING TO DEPLOY: unexpected chainId ${chainId}.`);
    console.error("   Expected 8453 (Base), 84532 (Base Sepolia) or 31337 (local).");
    console.error("   Set ALLOW_UNKNOWN_CHAIN=true to override deliberately.\n");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    console.error("\n❌ ERROR: No deployer signer available.");
    console.error("   Set a valid DEPLOYER_PK (0x + 64 hex chars) in .env");
    console.error("   Example: DEPLOYER_PK=0x1234... (length must be 66)");
    if (isMainnet) {
      console.error("\n   Fund the deployer with REAL Base ETH (≥ ~0.1 ETH for 3 deploys + agent + gas).");
      console.error("   Then: npm run deploy:mainnet\n");
    } else {
      console.error("\n   Get test ETH for Base Sepolia (free faucets):");
      console.error("   - Coinbase CDP: https://portal.cdp.coinbase.com/products/faucet (up to 0.1 ETH/24h)");
      console.error("   - Alchemy: https://www.alchemy.com/faucets/base-sepolia");
      console.error("   - thirdweb: https://thirdweb.com/base-sepolia-testnet");
      console.error("   - Official list: https://docs.base.org/base-chain/network-information/network-faucets");
      console.error("   - Chainlink: https://faucets.chain.link/base-sepolia\n");
      console.error("   For the full demo (capability 0.01 bond + attest gas + challenge 0.01 bond + buffer): faucet at least ~0.1 ETH to your DEPLOYER_PK.\n");
      console.error("   Then: npm run deploy:sepolia\n");
    }
    process.exit(1);
  }
  const deployerAddr = await deployer.getAddress();
  console.log(`Deploying to ${networkLabel} with deployer:`, deployerAddr);

  const deployerBal = await ethers.provider.getBalance(deployerAddr);
  console.log("Deployer balance:", ethers.formatEther(deployerBal), "ETH");

  // Pre-flight funds check: 3 contract deploys + agent top-up + buffer.
  const MIN_DEPLOYER = ethers.parseEther("0.08");
  if (deployerBal < MIN_DEPLOYER) {
    console.error(
      `\n❌ Deployer ${deployerAddr} holds ${ethers.formatEther(deployerBal)} ETH but at least ` +
        `${ethers.formatEther(MIN_DEPLOYER)} is required (3 deploys + Agent A top-up + gas buffer).`,
    );
    if (isMainnet) {
      console.error("   Send REAL Base ETH to the deployer, then re-run.");
    } else {
      console.error("   Faucet options:");
      console.error("   - Coinbase CDP: https://portal.cdp.coinbase.com/products/faucet (0.1 ETH/24h)");
      console.error("   - Alchemy: https://www.alchemy.com/faucets/base-sepolia");
      console.error("   - Chainlink: https://faucets.chain.link/base-sepolia");
    }
    process.exit(1);
  }

  // --- Deploy RON (v1, ETH-only) ---
  // Capture the block so the F10 indexer can backfill from the deployment point.
  const deployStartBlock = await ethers.provider.getBlockNumber();
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
  // IMPORTANT for mainnet prep (Step 5): We deliberately keep 0 delay for the pilot/demo
  // so flows remain instant and usable. Do NOT change this default to a non-zero value
  // until after audit + multisig setup.
  // For hardened mainnet: set TIMELOCK_DELAY=86400 (or more) + use multisig in proposers/executors.
  // See hardhat.config.ts "base" network, README "Mainnet preparation", and IMPROVEMENTS_PLAN.md
  const Timelock = await ethers.getContractFactory("TimelockController");
  const minDelay = process.env.TIMELOCK_DELAY ? BigInt(process.env.TIMELOCK_DELAY) : 0n;

  // Multisig support for mainnet/hardened deploys.
  // Set MULTISIG_ADDRESS=0x... (recommended) or PROPOSERS=0xA,0xB and EXECUTORS=0xA,0xB
  // If MULTISIG_ADDRESS is set, it is used for both proposers and executors.
  // Admin is left as ZeroAddress (no admin after deploy).
  let proposers: string[];
  let executors: string[];
  const multisig = process.env.MULTISIG_ADDRESS;
  if (multisig && multisig.length === 42) {
    proposers = [multisig];
    executors = [multisig];
    console.log("Using MULTISIG for Timelock proposers/executors:", multisig);
  } else if (process.env.PROPOSERS || process.env.EXECUTORS) {
    proposers = (process.env.PROPOSERS || deployerAddr).split(",").map(s => s.trim());
    executors = (process.env.EXECUTORS || deployerAddr).split(",").map(s => s.trim());
    console.log("Using custom PROPOSERS/EXECUTORS for Timelock");
  } else {
    proposers = [deployerAddr];
    executors = [deployerAddr];
  }
  const admin = ethers.ZeroAddress;
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  console.log("TimelockController:", timelockAddr);

  await ron.transferOwnership(timelockAddr);
  await registry.transferOwnership(timelockAddr);

  // --- Agent A: reuse the existing identity or mint a fresh one ---
  // REUSE_AGENT_A=true + AGENT_A_PK keeps the same agent address across
  // redeploys (per the 2026-09-15 decision to preserve the Agent A identity).
  const existingPk = (process.env.AGENT_A_PK ?? "").trim();
  const reuse = process.env.REUSE_AGENT_A === "true" && existingPk.length === 66;
  let agentAWallet: ethers.Wallet | ethers.HDNodeWallet;
  if (reuse) {
    agentAWallet = new ethers.Wallet(existingPk, ethers.provider);
    console.log("Reusing existing Agent A identity:", agentAWallet.address, "(REUSE_AGENT_A=true)");
  } else {
    agentAWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    console.log("Generated a fresh Agent A:", agentAWallet.address);
  }
  const agentAAddr = agentAWallet.address;
  const agentAPk = agentAWallet.privateKey;

  // Top up only the shortfall so repeated deploys don't accumulate idle funds.
  // On mainnet this would send REAL ETH to a freshly generated wallet, so it is
  // opt-in (FUND_AGENT_A=true); otherwise the operator funds it deliberately.
  const MIN_AGENT_BALANCE = ethers.parseEther("0.05"); // capability bond (0.01) + attest gas + challenge bond (0.01) + buffer
  const agentBal = await ethers.provider.getBalance(agentAAddr);
  if (agentBal < MIN_AGENT_BALANCE) {
    const topUp = MIN_AGENT_BALANCE - agentBal;
    const autoFund = !isMainnet || process.env.FUND_AGENT_A === "true";
    if (autoFund) {
      console.log(
        `Funding Agent A: +${ethers.formatEther(topUp)} ETH (has ${ethers.formatEther(agentBal)} ETH)` +
          (isMainnet ? " (FUND_AGENT_A=true)" : ""),
      );
      const fundTx = await deployer.sendTransaction({ to: agentAAddr, value: topUp });
      await fundTx.wait();
      console.log("Funded Agent A in tx:", fundTx.hash);
    } else {
      console.warn(
        `\n! Agent A ${agentAAddr} holds ${ethers.formatEther(agentBal)} ETH (< ${ethers.formatEther(MIN_AGENT_BALANCE)}).`,
      );
      console.warn(`  Mainnet auto-funding is OFF (no real ETH sent). Send it ≥ ${ethers.formatEther(topUp)} ETH manually,`);
      console.warn("  or re-run with FUND_AGENT_A=true to let the deployer fund it.");
    }
  } else {
    console.log("Agent A already funded:", ethers.formatEther(agentBal), "ETH — no top-up needed");
  }

  // SECURITY: key material never goes into deployments.json (it is a publishable
  // artifact) and is never printed to logs/CI. It is written only to the
  // gitignored .env, which we lock down to the current user.
  //
  // A rehearsal (RL fork / dry run) must NEVER touch .env: it generates a
  // throwaway agent, and overwriting the live key would lose it.
  const envPath = path.resolve(__dirname, "..", ".env");
  if (process.env.REHEARSAL === "true") {
    console.warn("! Rehearsal mode: NOT writing AGENT_A_PK to .env (throwaway agent).");
  } else if (isFork) {
    console.warn("! Fork detected: NOT writing AGENT_A_PK to .env (throwaway agent).");
  } else {
    assertNotTracked(envPath, ".env (key material)");
    backupFile(envPath);
    upsertEnvVar(envPath, "AGENT_A_PK", agentAPk);
  }

  const deployment = {
    chainId,
    network: isMainnet ? "base" : chainId === 84532 ? "base-sepolia" : `chain-${chainId}`,
    ron: ronAddr,
    registry: registryAddr,
    timelock: timelockAddr,
    validator: deployerAddr,
    agentA: agentAAddr,
    deployedAt: new Date().toISOString(),
    deployedBlock: deployStartBlock,
  };
  // Output path can be staged/rehearsed without clobbering the live pilot file.
  const outPath = process.env.DEPLOYMENTS_PATH
    ? path.resolve(process.env.DEPLOYMENTS_PATH)
    : path.resolve(__dirname, "..", "deployments.json");
  assertNotTracked(outPath, "deployments output");
  const json = JSON.stringify(deployment, null, 2) + "\n";
  assertNoKeyMaterial(json, outPath);
  fs.writeFileSync(outPath, json);

  const explorerBase = isMainnet ? "https://basescan.org" : "https://sepolia.basescan.org";
  if (process.env.REHEARSAL === "true" || isFork) {
    console.warn("! Rehearsal/fork: addresses written, no key persisted.");
  }
  console.log("\n=== TAOP MVP deployed (network from hardhat) ===");
  console.log("Network:   ", deployment.network, `(chainId ${deployment.chainId})`);
  console.log("RON:       ", ronAddr);
  console.log("Registry:  ", registryAddr);
  console.log("Agent A:   ", agentAAddr);
  console.log("Explorer:  ", explorerBase + "/address/" + ronAddr);
  console.log("\nWrote", outPath, "(addresses only — no keys)");
  if (process.env.REHEARSAL === "true" || isFork) {
    console.log("Rehearsal/fork: AGENT_A_PK NOT written to .env (throwaway agent).");
  } else {
    console.log("Wrote AGENT_A_PK to", envPath, "(chmod 600, gitignored; previous .env backed up)");
  }
  console.log("\nNext: restart the backend so it picks up the new agent key.");

  // Mainnet prep (Step 5): For Base mainnet use `npm run deploy:mainnet`
  // (requires BASE_MAINNET_RPC_URL + real ETH in DEPLOYER_PK).
  // Keep delay=0 for pilot. Use multisig + higher TIMELOCK_DELAY only after audit.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
