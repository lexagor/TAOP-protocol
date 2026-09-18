import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Challenge liveness: a contested challenge the owner never resolves would lock
 * the challenger's bond forever. `cancelChallenge` is the escape hatch after
 * CHALLENGE_TIMEOUT (90 days).
 */
describe("challenge liveness — cancelChallenge", () => {
  const SUMMARY = ethers.id("summarization");
  const BOND = ethers.parseEther("0.01");
  const TIMEOUT = 90 * 24 * 60 * 60;

  async function deployRon() {
    const [owner, agent, cp1, challenger, other] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    return { ron, owner, agent, cp1, challenger, other };
  }

  async function challengedCompletion(
    ron: Awaited<ReturnType<typeof deployRon>>["ron"],
    agent: Awaited<ReturnType<typeof deployRon>>["agent"],
    challenger: Awaited<ReturnType<typeof deployRon>>["challenger"],
  ) {
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://result");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://evidence", { value: BOND });
  }

  it("exposes CHALLENGE_TIMEOUT = 90 days", async () => {
    const { ron } = await deployRon();
    expect(await ron.CHALLENGE_TIMEOUT()).to.eq(BigInt(TIMEOUT));
  });

  it("reverts before the timeout with ChallengeNotTimedOut", async () => {
    const { ron, agent, challenger } = await deployRon();
    await challengedCompletion(ron, agent, challenger);
    const challenge = await ron.challenges(1);
    const readyAt = BigInt(challenge.timestamp) + BigInt(TIMEOUT);
    await time.setNextBlockTimestamp(readyAt - 1n);
    await expect(ron.connect(challenger).cancelChallenge(1))
      .to.be.revertedWithCustomError(ron, "ChallengeNotTimedOut")
      .withArgs(readyAt);
    await time.increaseTo(readyAt);
    await expect(ron.connect(challenger).cancelChallenge(1)).to.emit(ron, "ChallengeCancelled");
  });

  it("only the challenger can cancel", async () => {
    const { ron, agent, challenger, other } = await deployRon();
    await challengedCompletion(ron, agent, challenger);
    await time.increase(TIMEOUT);
    await expect(ron.connect(other).cancelChallenge(1)).to.be.revertedWithCustomError(
      ron,
      "NotChallenger",
    );
    await expect(ron.connect(agent).cancelChallenge(1)).to.be.revertedWithCustomError(
      ron,
      "NotChallenger",
    );
  });

  it("refunds the bond at the timeout and leaves the completion challenged", async () => {
    const { ron, agent, challenger } = await deployRon();
    await challengedCompletion(ron, agent, challenger);
    expect(await ethers.provider.getBalance(await ron.getAddress())).to.eq(BOND);

    await time.increase(TIMEOUT);
    await expect(ron.connect(challenger).cancelChallenge(1))
      .to.emit(ron, "ChallengeCancelled")
      .withArgs(1, challenger.address);

    expect(await ethers.provider.getBalance(await ron.getAddress())).to.eq(0n);
    const challenge = await ron.challenges(1);
    expect(challenge.resolved).to.eq(true);
    expect((await ron.completions(1)).challenged).to.eq(true);
    expect(await ron.disputeCount(agent.address)).to.eq(0n);
  });

  it("cancels a contested challenge the owner never ruled on", async () => {
    const { ron, agent, challenger } = await deployRon();
    await challengedCompletion(ron, agent, challenger);
    await ron.connect(agent).contestChallenge(1, "ipfs://rebuttal");
    await time.increase(TIMEOUT);
    await expect(ron.connect(challenger).cancelChallenge(1)).to.emit(ron, "ChallengeCancelled");
    expect((await ron.challenges(1)).resolved).to.eq(true);
  });

  it("is an exit and works while paused", async () => {
    const { ron, owner, agent, challenger } = await deployRon();
    await challengedCompletion(ron, agent, challenger);
    await ron.connect(agent).contestChallenge(1, "ipfs://rebuttal");
    await ron.connect(owner).pause();
    await time.increase(TIMEOUT);
    await expect(ron.connect(challenger).cancelChallenge(1)).to.emit(ron, "ChallengeCancelled");
  });

  it("cannot cancel a resolved challenge and cannot re-challenge after a cancel", async () => {
    const { ron, owner, agent, challenger } = await deployRon();
    await challengedCompletion(ron, agent, challenger);
    await ron.connect(owner).resolveChallenge(1, false);
    await time.increase(TIMEOUT);
    await expect(ron.connect(challenger).cancelChallenge(1)).to.be.revertedWithCustomError(
      ron,
      "ChallengeNotPending",
    );

    const { ron: ron2, agent: agent2, challenger: challenger2 } = await deployRon();
    await challengedCompletion(ron2, agent2, challenger2);
    await time.increase(TIMEOUT);
    await ron2.connect(challenger2).cancelChallenge(1);
    await expect(
      ron2.connect(challenger2).challengeCompletion(1, "ipfs://again", { value: BOND }),
    ).to.be.revertedWithCustomError(ron2, "AlreadyChallenged");
  });

  it("reverts for unknown completions", async () => {
    const { ron, challenger } = await deployRon();
    await expect(ron.connect(challenger).cancelChallenge(99)).to.be.revertedWithCustomError(
      ron,
      "NoSuchCompletion",
    );
  });
});
