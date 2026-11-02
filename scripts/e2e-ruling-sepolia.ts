import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Base Sepolia end-to-end proof with mock USDC and the real reviewer panel:
 * deploy -> bond -> publish -> payFee -> challenge -> escalate -> 2-of-3
 * signatures -> outcome(). Runs one upheld and one overturned case.
 *
 * Requires DEPLOYER_PK with testnet ETH and BASE_SEPOLIA_RPC_URL.
 *
 *   npm run e2e:ruling:sepolia
 */
const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
const BOND = USDC(3000);
const FEE = USDC(25);
const VALUE = USDC(300);
const Ruling = { PAY: 1, REFUND: 2 };
const Status = { FINALIZED: 3, OVERTURNED: 4 };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`SEPOLIA E2E FAILED: ${message}`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 84532) {
    throw new Error(`Expected Base Sepolia (84532), got ${network.chainId}`);
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer; set DEPLOYER_PK.");
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);
  console.log("Deployer:", deployerAddr, "ETH:", ethers.formatEther(balance));
  if (balance < ethers.parseEther("0.01")) {
    throw new Error("Deployer needs Base Sepolia ETH for the E2E deploy.");
  }

  const reviewer1 = ethers.Wallet.createRandom();
  const reviewer2 = ethers.Wallet.createRandom();
  const reviewer3 = ethers.Wallet.createRandom();
  const provider = ethers.Wallet.createRandom().address;
  const payer2 = ethers.Wallet.createRandom().address;
  const provider2 = ethers.Wallet.createRandom().address;
  const challenger = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log("Deploying mock USDC, reviewer panel, and oracle...");
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await usdc.waitForDeployment();
  const panel = await (await ethers.getContractFactory("ReviewerPanelAdapter")).deploy(deployerAddr);
  await panel.waitForDeployment();
  const oracle = await (await ethers.getContractFactory("RulingOracle")).deploy(
    await usdc.getAddress(),
    await panel.getAddress(),
    deployerAddr,
    deployerAddr,
  );
  await oracle.waitForDeployment();

  const usdcAddr = await usdc.getAddress();
  const panelAddr = await panel.getAddress();
  const oracleAddr = await oracle.getAddress();
  console.log("MockUSDC:", usdcAddr);
  console.log("ReviewerPanel:", panelAddr);
  console.log("RulingOracle:", oracleAddr);

  console.log("Wiring panel and funding the operator bond...");
  await (await panel.setOracle(oracleAddr)).wait();
  await (await panel.setReviewers([reviewer1.address, reviewer2.address, reviewer3.address])).wait();
  await (await usdc.mint(deployerAddr, USDC(10_000))).wait();
  await (await usdc.approve(oracleAddr, BOND + 2n * FEE + USDC(100))).wait();
  await (await oracle.depositBond(BOND)).wait();

  // Fund the third-party challenger with gas + mock USDC.
  await (await deployer.sendTransaction({ to: challenger.address, value: ethers.parseEther("0.003") })).wait();
  await (await usdc.mint(challenger.address, USDC(100))).wait();
  await (await usdc.connect(challenger).approve(oracleAddr, USDC(100))).wait();

  const sign = async (
    reviewer: typeof reviewer1,
    requestId: string,
    caseId: string,
    evidenceHash: string,
    upheld: boolean,
  ) =>
    reviewer.signTypedData(
      {
        name: "RulingOracleReviewerPanel",
        version: "1",
        chainId: 84532,
        verifyingContract: panelAddr,
      },
      {
        Review: [
          { name: "requestId", type: "bytes32" },
          { name: "caseId", type: "bytes32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "upheld", type: "bool" },
        ],
      },
      { requestId, caseId, evidenceHash, upheld },
    );

  // Case 1: wronged payer challenges free; reviewers uphold.
  const case1 = {
    caseId: ethers.id("sepolia-e2e-upheld"),
    provider,
    payer: deployerAddr,
    feePayer: deployerAddr,
    agentId: 9001n,
    value: VALUE,
    specHash: ethers.id("sepolia-spec-1"),
    evidenceHash: ethers.id("sepolia-evidence-1"),
    evidenceURI: "ipfs://sepolia-e2e-upheld.json",
    ruling: Ruling.PAY,
  };
  await (await oracle.publishRuling(case1)).wait();
  await (await oracle.payFee(case1.caseId)).wait();
  await (await oracle.challenge(case1.caseId)).wait(); // payer == deployer, free
  await (await oracle.escalateRuling(case1.caseId)).wait();
  const case1Id = (await oracle.getCase(case1.caseId)).escalationId;
  const case1Sigs = [
    await sign(reviewer1, case1Id, case1.caseId, case1.evidenceHash, true),
    await sign(reviewer2, case1Id, case1.caseId, case1.evidenceHash, true),
  ];
  await (await panel.resolve(case1Id, true, case1Sigs)).wait();
  const [case1Ruling, case1Status] = await oracle.outcome(case1.caseId);
  assert(
    Number(case1Ruling) === Ruling.PAY && Number(case1Status) === Status.FINALIZED,
    "case 1 should finalize PAY",
  );

  // Case 2: third-party challenger posts 30; reviewers overturn to REFUND.
  const case2 = {
    caseId: ethers.id("sepolia-e2e-overturned"),
    provider: provider2,
    payer: payer2,
    feePayer: deployerAddr,
    agentId: 9002n,
    value: VALUE,
    specHash: ethers.id("sepolia-spec-2"),
    evidenceHash: ethers.id("sepolia-evidence-2"),
    evidenceURI: "ipfs://sepolia-e2e-overturned.json",
    ruling: Ruling.PAY,
  };
  await (await oracle.publishRuling(case2)).wait();
  await (await oracle.payFee(case2.caseId)).wait();
  await (await oracle.connect(challenger).challenge(case2.caseId)).wait();
  await (await oracle.escalateRuling(case2.caseId)).wait();
  const case2Id = (await oracle.getCase(case2.caseId)).escalationId;
  const payer2Before = await usdc.balanceOf(payer2);
  const case2Sigs = [
    await sign(reviewer2, case2Id, case2.caseId, case2.evidenceHash, false),
    await sign(reviewer3, case2Id, case2.caseId, case2.evidenceHash, false),
  ];
  await (await panel.resolve(case2Id, false, case2Sigs)).wait();
  const [case2Ruling, case2Status] = await oracle.outcome(case2.caseId);
  assert(
    Number(case2Ruling) === Ruling.REFUND && Number(case2Status) === Status.OVERTURNED,
    "case 2 should overturn to REFUND",
  );
  assert((await usdc.balanceOf(payer2)) === payer2Before + VALUE, "payer2 should receive the value");
  assert((await oracle.lossCount(provider2)) === 1n, "overturned provider should have one loss");
  assert((await oracle.liveCases()) === 0n, "all cases should be settled");

  const held = await usdc.balanceOf(oracleAddr);
  assert(
    held ===
      (await oracle.operatorBond()) +
        (await oracle.challengeBonds()) +
        (await oracle.feePool()) +
        (await oracle.heldFees()),
    "USDC accounting invariant",
  );

  const report = {
    chainId: 84532,
    usdc: usdcAddr,
    reviewerPanel: panelAddr,
    rulingOracle: oracleAddr,
    reviewers: [reviewer1.address, reviewer2.address, reviewer3.address],
    cases: {
      upheld: { caseId: case1.caseId, status: "FINALIZED", ruling: "PAY" },
      overturned: { caseId: case2.caseId, status: "OVERTURNED", ruling: "REFUND" },
    },
    operatorBond: (await oracle.operatorBond()).toString(),
    checkedAt: new Date().toISOString(),
  };
  const out = path.resolve(__dirname, "..", "ruling-e2e-sepolia.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log("SEPOLIA E2E OK: upheld, overturned, loss record, accounting");
  console.log("Wrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
