import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertNoKeyMaterial, assertNotTracked } from "./lib/security";

/**
 * Deploy the Phase-0 ReviewerPanelAdapter. Use this before deploy-ruling-oracle
 * on a non-local chain, then pass the panel address as RULING_ESCALATION_ADDRESS.
 *
 *   RULING_REVIEWERS=0xA,0xB,0xC npm run deploy:panel:sepolia
 *
 * If the panel owner is not the deployer, the script deploys the panel but
 * prints the setReviewers calldata for the owner (Safe/multisig) to execute.
 */
function outPath(): string {
  return process.env.RULING_PANEL_DEPLOYMENTS_PATH
    ? path.resolve(process.env.RULING_PANEL_DEPLOYMENTS_PATH)
    : path.resolve(__dirname, "..", "reviewer-panel-deployment.json");
}

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function parseReviewers(raw: string): string[] {
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length !== 3) fail("RULING_REVIEWERS must contain exactly 3 comma-separated addresses.");
  const seen = new Set<string>();
  for (const address of list) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || address.toLowerCase() === ethers.ZeroAddress) {
      fail(`Invalid reviewer address: ${address}`);
    }
    const key = address.toLowerCase();
    if (seen.has(key)) fail(`Duplicate reviewer address: ${address}`);
    seen.add(key);
  }
  return list;
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = chainId === 31337;
  const isMainnet = chainId === 8453;
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  if (!deployer) fail("No deployer signer. Set DEPLOYER_PK in .env.");

  const deployerAddr = await deployer.getAddress();
  console.log(`ReviewerPanelAdapter deploy → chain ${chainId}, deployer ${deployerAddr}`);

  if (isMainnet && process.env.ALLOW_RULING_MAINNET !== "true") {
    fail("Refusing mainnet panel deploy without ALLOW_RULING_MAINNET=true.");
  }

  const owner = (process.env.RULING_PANEL_OWNER || process.env.RULING_OWNER || deployerAddr).trim();
  const reviewers = process.env.RULING_REVIEWERS
    ? parseReviewers(process.env.RULING_REVIEWERS)
    : isLocal
      ? signers.slice(1, 4).map((s) => s.address)
      : fail("RULING_REVIEWERS is required on non-local chains.");
  if (!process.env.RULING_REVIEWERS && isLocal) {
    console.warn("RULING_REVIEWERS not set; using the first three Hardhat signers as reviewers.");
  }

  const deployedBlock = await ethers.provider.getBlockNumber();
  const factory = await ethers.getContractFactory("ReviewerPanelAdapter");
  const panel = await factory.deploy(owner);
  await panel.waitForDeployment();
  const panelAddr = await panel.getAddress();
  console.log("ReviewerPanelAdapter:", panelAddr);
  console.log("Reviewers:", reviewers.join(", "));

  let configured = false;
  if (owner.toLowerCase() === deployerAddr.toLowerCase()) {
    await (await panel.setReviewers(reviewers)).wait();
    configured = true;
    console.log("Reviewers configured");
  } else {
    const calldata = panel.interface.encodeFunctionData("setReviewers", [reviewers]);
    console.log(`\nPanel owner is ${owner}. Execute setReviewers from the owner:`);
    console.log(`  target: ${panelAddr}`);
    console.log(`  data:   ${calldata}`);
  }

  const deployment = {
    chainId,
    network: chainId === 8453 ? "base" : chainId === 84532 ? "base-sepolia" : `chain-${chainId}`,
    reviewerPanel: panelAddr,
    owner,
    reviewers,
    resolutionWindowSeconds: 48 * 60 * 60,
    requiredSignatures: 2,
    reviewersConfigured: configured,
    deployedAt: new Date().toISOString(),
    deployedBlock,
  };

  const target = outPath();
  assertNotTracked(target, "reviewer panel deployment output");
  const json = JSON.stringify(deployment, null, 2) + "\n";
  assertNoKeyMaterial(json, target);
  fs.writeFileSync(target, json);
  console.log(`\nWrote ${target}`);
  console.log(
    "Next: deploy RulingOracle with RULING_ESCALATION_ADDRESS set to this panel; " +
      "the oracle deploy script can wire it when the deployer owns the panel.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
