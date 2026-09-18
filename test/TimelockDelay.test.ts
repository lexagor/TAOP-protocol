import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase 3 — hardened Timelock rehearsal.
 *
 * Before mainnet we want admin actions (resolveChallenge, withdrawEthPool,
 * setCertifier) behind a **non-zero** delay and a multisig-style proposer, not a
 * single EOA. This test proves that path works end to end, mirroring what
 * `TIMELOCK_DELAY=3600 MULTISIG_ADDRESS=0x...` sets up on deploy.
 */
describe("TimelockController — non-zero delay + multisig proposer (hardened)", () => {
  const SUMMARY = ethers.id("summarization");
  const BOND = ethers.parseEther("0.01");
  const DELAY = 3600n;

  async function deploy() {
    const [deployer, agent, challenger, multisig] = await ethers.getSigners();

    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();

    const Timelock = await ethers.getContractFactory("TimelockController");
    const timelock = await Timelock.deploy(
      DELAY,
      [multisig.address], // proposers  (multisig only)
      [multisig.address], // executors  (multisig only; in prod often zero-addr = anyone)
      ethers.ZeroAddress, // no admin after setup
    );
    await timelock.waitForDeployment();

    await ron.transferOwnership(await timelock.getAddress());

    // Ownable2Step: ownership is pending until the Timelock accepts. Mirror the
    // production path — schedule + execute acceptOwnership with the multisig.
    const target = await ron.getAddress();
    const data = ron.interface.encodeFunctionData("acceptOwnership");
    const salt = ethers.id("accept-ownership");
    await timelock.connect(multisig).schedule(target, 0, data, ethers.ZeroHash, salt, DELAY);
    await time.increase(Number(DELAY) + 1);
    await timelock.connect(multisig).execute(target, 0, data, ethers.ZeroHash, salt);

    return { ron, timelock, deployer, agent, challenger, multisig };
  }

  it("records the non-zero min delay", async () => {
    const { timelock } = await deploy();
    expect(await timelock.getMinDelay()).to.eq(DELAY);
  });

  it("a non-proposer cannot schedule an admin action", async () => {
    const { ron, timelock, agent, challenger, deployer } = await deploy();
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });

    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    const salt = ethers.id("nope");
    await expect(
      timelock.connect(deployer).schedule(await ron.getAddress(), 0, data, ethers.ZeroHash, salt, DELAY),
    ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
  });

  it("schedule → (too early) → time.increase → execute resolves the challenge", async () => {
    const { ron, timelock, agent, challenger, multisig } = await deploy();
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });

    const target = await ron.getAddress();
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    const salt = ethers.id("resolve-1");

    await timelock.connect(multisig).schedule(target, 0, data, ethers.ZeroHash, salt, DELAY);

    // Not executable until the delay elapses.
    await expect(
      timelock.connect(multisig).execute(target, 0, data, ethers.ZeroHash, salt),
    ).to.be.reverted;

    await time.increase(Number(DELAY) + 1);

    await expect(timelock.connect(multisig).execute(target, 0, data, ethers.ZeroHash, salt))
      .to.emit(ron, "ChallengeResolved")
      .withArgs(1n, true);

    expect(await ron.disputeCount(agent.address)).to.eq(1n);
    expect((await ron.getCompletion(1)).disputed).to.eq(true);
  });

  it("0-delay execute is immediate (pilot mode, for contrast)", async () => {
    const [, agent, challenger, multisig] = await ethers.getSigners();
    // Fresh contracts: the shared fixture already handed ownership to its timelock.
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    const Timelock = await ethers.getContractFactory("TimelockController");
    const zero = await Timelock.deploy(0n, [multisig.address], [multisig.address], ethers.ZeroAddress);
    await zero.waitForDeployment();
    await ron.transferOwnership(await zero.getAddress());

    // Ownable2Step: accept via the 0-delay Timelock.
    const ronTarget = await ron.getAddress();
    const acceptData = ron.interface.encodeFunctionData("acceptOwnership");
    const acceptSalt = ethers.id("accept-ownership-zero");
    await zero.connect(multisig).schedule(ronTarget, 0, acceptData, ethers.ZeroHash, acceptSalt, 0n);
    await zero.connect(multisig).execute(ronTarget, 0, acceptData, ethers.ZeroHash, acceptSalt);

    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });

    const target = await ron.getAddress();
    const data = ron.interface.encodeFunctionData("resolveChallenge", [1, true]);
    const salt = ethers.id("zero-delay");
    await zero.connect(multisig).schedule(target, 0, data, ethers.ZeroHash, salt, 0n);
    await expect(zero.connect(multisig).execute(target, 0, data, ethers.ZeroHash, salt))
      .to.emit(ron, "ChallengeResolved")
      .withArgs(1n, true);
    expect(await ron.disputeCount(agent.address)).to.eq(1n);
  });
});
