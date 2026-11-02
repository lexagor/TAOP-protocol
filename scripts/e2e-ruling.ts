import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Local end-to-end proof of the Phase-0 adjudication loop:
 * publish → challenge → escalate → 2-of-3 reviewer signatures → outcome().
 * Also exercises the 24h reviewer timeout and both ruling directions.
 *
 *   npm run e2e:ruling
 */
const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
const BOND = USDC(3000);
const VALUE = USDC(300);

const Ruling = { PAY: 1, REFUND: 2 };
const Status = { FINALIZED: 3, OVERTURNED: 4 };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`E2E FAILED: ${message}`);
}

let seq = 0;

async function main() {
  const [owner, provider, payer, feePayer, challenger, treasury, reviewer1, reviewer2, reviewer3] =
    await ethers.getSigners();

  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const panel = await (await ethers.getContractFactory("ReviewerPanelAdapter")).deploy(owner.address);
  const oracle = await (await ethers.getContractFactory("RulingOracle")).deploy(
    await usdc.getAddress(),
    await panel.getAddress(),
    treasury.address,
    owner.address,
  );
  await panel.setOracle(await oracle.getAddress());
  await panel.setReviewers([reviewer1.address, reviewer2.address, reviewer3.address]);

  await usdc.mint(owner.address, USDC(100_000));
  await usdc.mint(feePayer.address, USDC(10_000));
  await usdc.mint(challenger.address, USDC(10_000));
  await usdc.connect(owner).approve(await oracle.getAddress(), ethers.MaxUint256);
  await usdc.connect(feePayer).approve(await oracle.getAddress(), ethers.MaxUint256);
  await usdc.connect(challenger).approve(await oracle.getAddress(), ethers.MaxUint256);
  await oracle.connect(owner).depositBond(BOND);

  console.log("RulingOracle:", await oracle.getAddress());
  console.log("ReviewerPanel:", await panel.getAddress());

  const publish = async (ruling: number) => {
    seq += 1;
    const caseId = ethers.id(`e2e-case-${seq}`);
    const request = {
      caseId,
      provider: provider.address,
      payer: payer.address,
      feePayer: feePayer.address,
      agentId: BigInt(1000 + seq),
      value: VALUE,
      specHash: ethers.id(`e2e-spec-${seq}`),
      evidenceHash: ethers.id(`e2e-evidence-${seq}`),
      evidenceURI: `ipfs://e2e-case-${seq}.json`,
      ruling,
    };
    await oracle.connect(owner).publishRuling(request);
    await oracle.connect(feePayer).payFee(caseId);
    return request;
  };

  const topUpBond = async () => {
    const current = await oracle.operatorBond();
    if (current < BOND) await oracle.connect(owner).depositBond(BOND - current);
  };

  const escalate = async (caseId: string) => {
    await oracle.connect(owner).escalateRuling(caseId);
    return (await oracle.getCase(caseId)).escalationId;
  };

  const sign = async (
    reviewer: typeof reviewer1,
    requestId: string,
    caseId: string,
    evidenceHash: string,
    upheld: boolean,
  ) => {
    const network = await ethers.provider.getNetwork();
    return reviewer.signTypedData(
      {
        name: "RulingOracleReviewerPanel",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await panel.getAddress(),
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
  };

  // 1. Free wronged-party challenge, reviewers uphold.
  const upheld = await publish(Ruling.PAY);
  await oracle.connect(payer).challenge(upheld.caseId);
  const upheldId = await escalate(upheld.caseId);
  const upheldSigs = [
    await sign(reviewer1, upheldId, upheld.caseId, upheld.evidenceHash, true),
    await sign(reviewer2, upheldId, upheld.caseId, upheld.evidenceHash, true),
  ];
  await panel.connect(challenger).resolve(upheldId, true, upheldSigs);
  const [upheldRuling, upheldStatus] = await oracle.outcome(upheld.caseId);
  assert(
    Number(upheldStatus) === Status.FINALIZED && Number(upheldRuling) === Ruling.PAY,
    "upheld appeal",
  );

  // 2. Third-party challenge, reviewers overturn; payer is made whole.
  const overturned = await publish(Ruling.PAY);
  await oracle.connect(challenger).challenge(overturned.caseId);
  const overturnedId = await escalate(overturned.caseId);
  const payerBefore = await usdc.balanceOf(payer.address);
  const overturnedSigs = [
    await sign(reviewer2, overturnedId, overturned.caseId, overturned.evidenceHash, false),
    await sign(reviewer3, overturnedId, overturned.caseId, overturned.evidenceHash, false),
  ];
  await panel.connect(challenger).resolve(overturnedId, false, overturnedSigs);
  const [finalRuling, finalStatus] = await oracle.outcome(overturned.caseId);
  assert(
    Number(finalStatus) === Status.OVERTURNED && Number(finalRuling) === Ruling.REFUND,
    "overturned appeal",
  );
  assert(
    (await usdc.balanceOf(payer.address)) === payerBefore + VALUE,
    "payer receives the overturned value",
  );

  // 3. REFUND overturned to PAY: provider is made whole and no loss is recorded.
  await topUpBond();
  const refund = await publish(Ruling.REFUND);
  await oracle.connect(provider).challenge(refund.caseId);
  const refundId = await escalate(refund.caseId);
  const providerBefore = await usdc.balanceOf(provider.address);
  const lossesBefore = await oracle.lossCount(provider.address);
  const refundSigs = [
    await sign(reviewer1, refundId, refund.caseId, refund.evidenceHash, false),
    await sign(reviewer3, refundId, refund.caseId, refund.evidenceHash, false),
  ];
  await panel.connect(challenger).resolve(refundId, false, refundSigs);
  assert(
    (await usdc.balanceOf(provider.address)) === providerBefore + VALUE,
    "provider receives the overturned value",
  );
  assert(
    (await oracle.lossCount(provider.address)) === lossesBefore,
    "no new loss on a cleared provider",
  );

  // 4. No reviewer quorum: 24h timeout makes the challenge succeed.
  await topUpBond();
  const timedOut = await publish(Ruling.PAY);
  await oracle.connect(challenger).challenge(timedOut.caseId);
  const timedOutId = await escalate(timedOut.caseId);
  const request = await panel.getRequest(timedOutId);
  await time.increaseTo(request.deadline + 1n);
  await panel.connect(challenger).timeout(timedOutId);
  const [, timeoutStatus] = await oracle.outcome(timedOut.caseId);
  assert(Number(timeoutStatus) === Status.OVERTURNED, "timeout overturns");

  assert((await oracle.liveCases()) === 0n, "all cases settled");
  const held = await usdc.balanceOf(await oracle.getAddress());
  assert(
    held === (await oracle.operatorBond()) + (await oracle.challengeBonds()),
    "USDC accounting invariant",
  );

  console.log("E2E OK: upheld, overturned, cleared provider, timeout, accounting");
  console.log("Outcome statuses: FINALIZED=3, OVERTURNED=4; rulings: PAY=1, REFUND=2");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
