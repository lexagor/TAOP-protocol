import { expect } from "chai";
import { ethers } from "hardhat";

describe("CapabilityRegistry — ETH bonds (MVP)", () => {
  const LORA = ethers.id("LoRA");

  async function deploy() {
    const [owner, creator, certifier, other] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(certifier.address);
    await registry.waitForDeployment();

    // Deploy Timelock (0 delay for tests) and transfer ownership
    const Timelock = await ethers.getContractFactory("TimelockController");
    const minDelay = 0;
    const proposers = [owner.address];
    const executors = [owner.address];
    const admin = ethers.ZeroAddress;
    const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
    await timelock.waitForDeployment();

    await registry.transferOwnership(await timelock.getAddress());

    async function executeAsOwner(target: string, data: string, value: bigint = 0n) {
      const salt = ethers.id(`salt-${Date.now()}-${Math.random()}`);
      const predecessor = ethers.ZeroHash;
      await timelock.schedule(target, value, data, predecessor, salt, minDelay);
      const tx = await timelock.execute(target, value, data, predecessor, salt);
      return tx;
    }

    return { registry, owner, creator, certifier, other, timelock, executeAsOwner };
  }

  it("registerCapabilityEth mints an NFT, locks the ETH bond, and emits", async () => {
    const { registry, creator } = await deploy();
    const bond = ethers.parseEther("0.05");
    await expect(registry.connect(creator).registerCapabilityEth(LORA, "ipfs://meta", { value: bond }))
      .to.emit(registry, "CapabilityRegistered")
      .withArgs(1n, creator.address);

    expect(await registry.ownerOf(1)).to.eq(creator.address);
    expect(await ethers.provider.getBalance(await registry.getAddress())).to.eq(bond);

    const cap = await registry.getCapability(1);
    expect(cap.creator).to.eq(creator.address);
    expect(cap.bond).to.eq(bond);
    expect(cap.certified).to.eq(false);
    expect(cap.slashed).to.eq(false);
  });

  it("registerCapabilityEth reverts on zero bond", async () => {
    const { registry, creator } = await deploy();
    await expect(registry.connect(creator).registerCapabilityEth(LORA, "ipfs://meta", { value: 0 }))
      .to.be.revertedWithCustomError(registry, "ZeroBond");
  });

  it("slashCapability routes slashed ETH to slashedEthPool", async () => {
    const { registry, creator, certifier } = await deploy();
    const bond = ethers.parseEther("0.1");
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: bond });

    await expect(registry.connect(certifier).slashCapability(1, ethers.parseEther("0.03")))
      .to.emit(registry, "CapabilitySlashed")
      .withArgs(1n, ethers.parseEther("0.03"));

    const cap = await registry.getCapability(1);
    expect(cap.bond).to.eq(ethers.parseEther("0.07"));
    expect(cap.slashed).to.eq(true);
    expect(await registry.slashedEthPool()).to.eq(ethers.parseEther("0.03"));
  });

  it("slashCapability is bounded by the remaining bond", async () => {
    const { registry, creator, certifier } = await deploy();
    const bond = ethers.parseEther("0.05");
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: bond });
    await expect(registry.connect(certifier).slashCapability(1, ethers.parseEther("0.06")))
      .to.be.revertedWithCustomError(registry, "PenaltyExceedsBond");
  });

  it("withdrawBond returns un-slashed ETH to the creator and burns the NFT", async () => {
    const { registry, creator } = await deploy();
    const bond = ethers.parseEther("0.05");
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: bond });

    const before = await ethers.provider.getBalance(creator.address);
    await expect(registry.connect(creator).withdrawBond(1))
      .to.emit(registry, "BondWithdrawn")
      .withArgs(1n, creator.address, bond);
    const after = await ethers.provider.getBalance(creator.address);
    // after should be greater (bond returned minus gas)
    expect(after).to.be.gt(before);
    expect(await registry.getCapability(1).catch(() => null)).to.be.null;
  });

  it("withdrawBond reverts when called by a non-creator", async () => {
    const { registry, creator, other } = await deploy();
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: ethers.parseEther("0.05") });
    await expect(registry.connect(other).withdrawBond(1))
      .to.be.revertedWithCustomError(registry, "NotCreator");
  });

  it("withdrawEthPool is owner-only and pulls slashed ETH", async () => {
    const { registry, executeAsOwner, creator, certifier, other } = await deploy();
    const bond = ethers.parseEther("0.1");
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: bond });
    await registry.connect(certifier).slashCapability(1, ethers.parseEther("0.04"));
    expect(await registry.slashedEthPool()).to.eq(ethers.parseEther("0.04"));

    await expect(registry.connect(other).withdrawEthPool(other.address, ethers.parseEther("0.04")))
      .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    const data = registry.interface.encodeFunctionData("withdrawEthPool", [other.address, ethers.parseEther("0.04")]);
    await expect(executeAsOwner(await registry.getAddress(), data))
      .to.emit(registry, "EthPoolWithdrawn");
    expect(await registry.slashedEthPool()).to.eq(0n);
  });

  it("certifyCapability works on an ETH-bonded capability", async () => {
    const { registry, creator, certifier } = await deploy();
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: ethers.parseEther("0.05") });
    await expect(registry.connect(certifier).certifyCapability(1))
      .to.emit(registry, "CapabilityCertified");
    expect((await registry.getCapability(1)).certified).to.eq(true);
  });
});
