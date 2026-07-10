import { expect } from "chai";
import { ethers } from "hardhat";

describe("ReputationOracleNetwork — self-attest + challenge (MVP)", () => {
  const SUMMARY = ethers.id("summarization");
  const CHALLENGE_BOND = ethers.parseEther("0.01");

  async function deploy() {
    const [owner, agentA, agentB, challenger, other] = await ethers.getSigners();

    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();

    // Deploy Timelock with 0 delay (for test convenience) and transfer ownership
    const Timelock = await ethers.getContractFactory("TimelockController");
    const minDelay = 0;
    const proposers = [owner.address];
    const executors = [owner.address];
    const admin = ethers.ZeroAddress;
    const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
    await timelock.waitForDeployment();

    await ron.transferOwnership(await timelock.getAddress());

    // Helper to execute owner-only functions via the Timelock (supports delay=0)
    async function executeAsOwner(target: string, data: string, value: bigint = 0n) {
      const salt = ethers.id(`salt-${Date.now()}-${Math.random()}`);
      const predecessor = ethers.ZeroHash;
      await timelock.schedule(target, value, data, predecessor, salt, minDelay);
      const tx = await timelock.execute(target, value, data, predecessor, salt);
      return tx;
    }

    return { ron, owner, agentA, agentB, challenger, other, timelock, executeAsOwner };
  }

  it("attestCompletion mints a unique completionId, increments count, and emits", async () => {
    const { ron, agentA } = await deploy();
    await expect(ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result1"))
      .to.emit(ron, "SelfAttested")
      .withArgs(1n, agentA.address, SUMMARY);
    const completion = await ron.getCompletion(1);
    expect(completion.agent).to.eq(agentA.address);
    expect(completion.taskType).to.eq(SUMMARY);
    expect(completion.resultCID).to.eq("ipfs://result1");
    expect(completion.challenged).to.eq(false);
    expect(completion.disputed).to.eq(false);
    expect(await ron.completionCount(agentA.address)).to.eq(1n);
  });

  it("multiple attestments produce sequential ids", async () => {
    const { ron, agentA } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r1");
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r2");
    expect((await ron.getCompletion(1)).resultCID).to.eq("ipfs://r1");
    expect((await ron.getCompletion(2)).resultCID).to.eq("ipfs://r2");
    expect(await ron.completionCount(agentA.address)).to.eq(2n);
  });

  it("getCompletion reverts for a nonexistent completion", async () => {
    const { ron } = await deploy();
    await expect(ron.getCompletion(999)).to.be.revertedWithCustomError(ron, "NoSuchCompletion");
  });

  it("challengeCompletion posts the bond, marks challenged, and emits", async () => {
    const { ron, agentA, challenger } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    await expect(
      ron.connect(challenger).challengeCompletion(1, "ipfs://fraud-evidence", { value: CHALLENGE_BOND }),
    )
      .to.emit(ron, "ChallengeSubmitted")
      .withArgs(1n, challenger.address);
    const completion = await ron.getCompletion(1);
    expect(completion.challenged).to.eq(true);
    const challenge = await ron.challenges(1);
    expect(challenge.challenger).to.eq(challenger.address);
    expect(challenge.resolved).to.eq(false);
  });

  it("challengeCompletion reverts on wrong bond amount", async () => {
    const { ron, agentA, challenger } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    await expect(
      ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: ethers.parseEther("0.005") }),
    ).to.be.revertedWithCustomError(ron, "WrongChallengeBond");
  });

  it("challengeCompletion reverts on a nonexistent completion", async () => {
    const { ron, challenger } = await deploy();
    await expect(
      ron.connect(challenger).challengeCompletion(999, "ipfs://ev", { value: CHALLENGE_BOND }),
    ).to.be.revertedWithCustomError(ron, "NoSuchCompletion");
  });

  it("challengeCompletion reverts if already challenged", async () => {
    const { ron, agentA, challenger, other } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });
    await expect(
      ron.connect(other).challengeCompletion(1, "ipfs://ev2", { value: CHALLENGE_BOND }),
    ).to.be.revertedWithCustomError(ron, "AlreadyChallenged");
  });

  it("resolveChallenge upheld: disputeCount++, challenger refunded, completion disputed", async () => {
    const { ron, executeAsOwner, agentA, challenger } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });

    const challengerBefore = await ethers.provider.getBalance(challenger.address);
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    await expect(executeAsOwner(await ron.getAddress(), data))
      .to.emit(ron, "ChallengeResolved")
      .withArgs(1n, true);

    expect(await ron.disputeCount(agentA.address)).to.eq(1n);
    const completion = await ron.getCompletion(1);
    expect(completion.disputed).to.eq(true);
    const challenge = await ron.challenges(1);
    expect(challenge.resolved).to.eq(true);
    const challengerAfter = await ethers.provider.getBalance(challenger.address);
    expect(challengerAfter).to.be.gt(challengerBefore);
  });

  it("resolveChallenge rejected: challenger bond forfeited to pool, not disputed", async () => {
    const { ron, executeAsOwner, agentA, challenger } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });

    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, false]);
    await expect(executeAsOwner(await ron.getAddress(), data))
      .to.emit(ron, "ChallengeResolved")
      .withArgs(1n, false);

    expect(await ron.disputeCount(agentA.address)).to.eq(0n);
    expect((await ron.getCompletion(1)).disputed).to.eq(false);
    expect(await ron.slashedEthPool()).to.eq(CHALLENGE_BOND);
  });

  it("resolveChallenge is owner-only", async () => {
    const { ron, agentA, challenger, other } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });
    await expect(ron.connect(other).resolveChallenge(1, true))
      .to.be.revertedWithCustomError(ron, "OwnableUnauthorizedAccount");
  });

  it("resolveChallenge reverts on an unchallenged completion", async () => {
    const { ron, executeAsOwner, agentA } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://result");
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    await expect(executeAsOwner(await ron.getAddress(), data))
      .to.be.revertedWithCustomError(ron, "ChallengeNotPending");
  });

  it("getSelfAttestScore returns completions - disputes", async () => {
    const { ron, executeAsOwner, agentA, challenger } = await deploy();
    // 3 completions, 1 upheld dispute -> score = 2
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r1");
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r2");
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r3");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    await executeAsOwner(await ron.getAddress(), data);

    const [completions, disputes, score] = await ron.getSelfAttestScore(agentA.address);
    expect(completions).to.eq(3n);
    expect(disputes).to.eq(1n);
    expect(score).to.eq(2n);
  });

  it("getSelfAttestScore clamps to zero when disputes exceed completions", async () => {
    const { ron, executeAsOwner, agentA, challenger } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r1");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    await executeAsOwner(await ron.getAddress(), data);
    const [, , score] = await ron.getSelfAttestScore(agentA.address);
    expect(score).to.eq(0n);
  });

  it("withdrawEthPool is owner-only and pulls forfeited bonds", async () => {
    const { ron, executeAsOwner, agentA, challenger, other } = await deploy();
    await ron.connect(agentA).attestCompletion(SUMMARY, "ipfs://r");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE_BOND });
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, false]);
    await executeAsOwner(await ron.getAddress(), data);
    expect(await ron.slashedEthPool()).to.eq(CHALLENGE_BOND);

    await expect(ron.connect(other).withdrawEthPool(other.address, CHALLENGE_BOND))
      .to.be.revertedWithCustomError(ron, "OwnableUnauthorizedAccount");

    const data = ron.interface.encodeFunctionData("withdrawEthPool", [other.address, CHALLENGE_BOND]);
    await expect(executeAsOwner(await ron.getAddress(), data))
      .to.emit(ron, "EthPoolWithdrawn");
    expect(await ron.slashedEthPool()).to.eq(0n);
  });
});
