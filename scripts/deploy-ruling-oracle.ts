import { ethers } from "hardhat";
import type { Contract } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertNoKeyMaterial, assertNotTracked } from "./lib/security";

/**
 * Deploy the Phase-0 bonded adjudication oracle.
 *
 * Local (chain 31337): deploys MockUSDC + ReviewerPanelAdapter (+ mock USDC
 * faucet) and funds the $3,000 operator bond so the full lifecycle can run
 * immediately. Set RULING_USE_MOCK_ESCALATION=true to use the unit-test mock.
 *
 * Base Sepolia / Base: requires RULING_USDC_ADDRESS (defaults to canonical
 * USDC) and RULING_ESCALATION_ADDRESS pointing at a deployed adapter. If
 * RULING_REVIEWERS is also set, the script wires the panel; otherwise the panel
 * owner must call setOracle/setReviewers.
 *
 *   npm run deploy:ruling
 *   RULING_ESCALATION_ADDRESS=0x... RULING_REVIEWERS=0xA,0xB,0xC npm run deploy:ruling:sepolia
 */
const USDC_BY_CHAIN: Record<number, string> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

function outPath(): string {
  return process.env.RULING_DEPLOYMENTS_PATH
    ? path.resolve(process.env.RULING_DEPLOYMENTS_PATH)
    : path.resolve(__dirname, "..", "ruling-oracle-deployment.json");
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
  console.log(`RulingOracle deploy → chain ${chainId}, deployer ${deployerAddr}`);

  if (isMainnet) {
    if (process.env.ALLOW_RULING_MAINNET !== "true") {
      fail(
        "RulingOracle is a bonded pilot. Refusing mainnet without ALLOW_RULING_MAINNET=true " +
          "and a reviewed appeal adapter, Safe owner, treasury, audit, and entity.",
      );
    }
    if (!process.env.RULING_OWNER || !process.env.RULING_TREASURY) {
      fail("Mainnet requires explicit RULING_OWNER and RULING_TREASURY (multisig/Safe).");
    }
    const owner = process.env.RULING_OWNER.trim();
    const code = await ethers.provider.getCode(owner);
    if (code === "0x") fail("RULING_OWNER must be a contract (Safe/multisig), not an EOA.");
    if (owner.toLowerCase() === deployerAddr.toLowerCase()) {
      fail("RULING_OWNER must not be the hot deployer.");
    }
  }

  const owner = (process.env.RULING_OWNER || deployerAddr).trim();
  const treasury = (process.env.RULING_TREASURY || deployerAddr).trim();
  if (owner === ethers.ZeroAddress || treasury === ethers.ZeroAddress) {
    fail("RULING_OWNER and RULING_TREASURY must be non-zero.");
  }

  let usdcAddr = (process.env.RULING_USDC_ADDRESS || USDC_BY_CHAIN[chainId] || "").trim();
  let mockUsdc: Contract | undefined;
  if (!usdcAddr) {
    if (!isLocal) fail("RULING_USDC_ADDRESS is required on this chain.");
    const factory = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await factory.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddr = await mockUsdc.getAddress();
    console.log("MockUSDC:", usdcAddr);
  }

  let escalationAddr = (process.env.RULING_ESCALATION_ADDRESS || "").trim();
  let mockEscalation: Contract | undefined;
  let panel: Contract | undefined;
  let reviewers: string[] = [];
  let wirePanel = false;

  if (escalationAddr) {
    if (process.env.RULING_REVIEWERS && process.env.RULING_WIRE_PANEL !== "false") {
      reviewers = parseReviewers(process.env.RULING_REVIEWERS);
      panel = await ethers.getContractAt("ReviewerPanelAdapter", escalationAddr);
      wirePanel = true;
    }
  } else if (isLocal) {
    if (process.env.RULING_USE_MOCK_ESCALATION === "true") {
      const factory = await ethers.getContractFactory("MockEscalationOracle");
      mockEscalation = await factory.deploy();
      await mockEscalation.waitForDeployment();
      escalationAddr = await mockEscalation.getAddress();
      console.log("MockEscalationOracle:", escalationAddr);
    } else {
      reviewers = process.env.RULING_REVIEWERS
        ? parseReviewers(process.env.RULING_REVIEWERS)
        : signers.slice(1, 4).map((s) => s.address);
      const factory = await ethers.getContractFactory("ReviewerPanelAdapter");
      panel = await factory.deploy(owner);
      await panel.waitForDeployment();
      escalationAddr = await panel.getAddress();
      wirePanel = true;
      console.log("ReviewerPanelAdapter:", escalationAddr);
      console.log("Reviewers:", reviewers.join(", "));
    }
  } else {
    fail(
      "RULING_ESCALATION_ADDRESS is required. Deploy ReviewerPanelAdapter first " +
        "(npm run deploy:panel:sepolia), then pass its address here.",
    );
  }

  const deployedBlock = await ethers.provider.getBlockNumber();
  const factory = await ethers.getContractFactory("RulingOracle");
  const oracle = await factory.deploy(usdcAddr, escalationAddr, treasury, owner);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("RulingOracle:", oracleAddr);

  if (mockEscalation) {
    await (await mockEscalation.setOracle(oracleAddr)).wait();
    console.log("MockEscalationOracle wired to the oracle");
  }

  if (panel && wirePanel) {
    const panelOwner = (await panel.owner()) as string;
    if (panelOwner.toLowerCase() !== deployerAddr.toLowerCase()) {
      fail(
        `ReviewerPanelAdapter owner is ${panelOwner}, not the deployer. ` +
          "Call setOracle and setReviewers from the panel owner, or rerun with RULING_WIRE_PANEL=false.",
      );
    }
    const currentOracle = (await panel.oracle()) as string;
    if (currentOracle.toLowerCase() === ethers.ZeroAddress) {
      await (await panel.setOracle(oracleAddr)).wait();
      console.log("ReviewerPanelAdapter wired to the oracle");
    } else if (currentOracle.toLowerCase() !== oracleAddr.toLowerCase()) {
      fail(`ReviewerPanelAdapter is already wired to ${currentOracle}, not ${oracleAddr}.`);
    }
    if (reviewers.length > 0) {
      await (await panel.setReviewers(reviewers)).wait();
      console.log("ReviewerPanelAdapter reviewers configured");
    }
  }

  // Local convenience: mint + deposit the $3,000 bond. Non-local deploys require
  // an explicit RULING_BOND_USDC so no real USDC moves by surprise.
  const bondSetting = (process.env.RULING_BOND_USDC || (isLocal ? "3000" : "")).trim();
  if (bondSetting) {
    const amount = ethers.parseUnits(bondSetting, 6);
    const erc20 = new ethers.Contract(
      usdcAddr,
      [
        "function approve(address spender, uint256 amount) returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
      ],
      deployer,
    );
    if (mockUsdc) {
      await (await mockUsdc.mint(deployerAddr, amount)).wait();
    } else {
      const bal = (await erc20.balanceOf(deployerAddr)) as bigint;
      if (bal < amount) {
        fail(
          `Deployer holds ${ethers.formatUnits(bal, 6)} USDC but the bond is ` +
            `${ethers.formatUnits(amount, 6)}. Fund the deployer or lower RULING_BOND_USDC.`,
        );
      }
    }
    await (await erc20.approve(oracleAddr, amount)).wait();
    await (await oracle.depositBond(amount)).wait();
    console.log(`Operator bond deposited: ${bondSetting} USDC`);
  } else {
    console.log("Bond not deposited. Set RULING_BOND_USDC and re-run, or call depositBond separately.");
  }

  const deployment = {
    chainId,
    network: chainId === 8453 ? "base" : chainId === 84532 ? "base-sepolia" : `chain-${chainId}`,
    rulingOracle: oracleAddr,
    usdc: usdcAddr,
    escalation: escalationAddr,
    escalationType: panel ? "reviewer-panel" : mockEscalation ? "mock" : "external",
    reviewers,
    treasury,
    owner,
    caseCapUsdc: "300",
    feeUsdc: "25",
    bondFloorUsdc: "3000",
    challengeWindowSeconds: 48 * 60 * 60,
    escalationWindowSeconds: 72 * 60 * 60,
    pendingFeeTtlSeconds: 7 * 24 * 60 * 60,
    panelResolutionWindowSeconds: 48 * 60 * 60,
    maxUriLen: 512,
    deployedAt: new Date().toISOString(),
    deployedBlock,
  };

  const target = outPath();
  assertNotTracked(target, "ruling oracle deployment output");
  const json = JSON.stringify(deployment, null, 2) + "\n";
  assertNoKeyMaterial(json, target);
  fs.writeFileSync(target, json);
  console.log(`\nWrote ${target}`);
  console.log(
    "Next: deposit the bond (if skipped), verify on Basescan, then have the marketplace escrow call outcome(caseId).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
