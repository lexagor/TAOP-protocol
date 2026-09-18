import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Ownable2Step handover (a typo'd transfer can no longer brick the owner role)
 * and on-chain URI length caps (MAX_URI_LEN = 200 bytes).
 */
describe("Ownable2Step + URI caps", () => {
  const SUMMARY = ethers.id("summarization");
  const BOND = ethers.parseEther("0.01");
  const MAX = 200;

  async function deployRon() {
    const [owner, agent, cp, challenger, newOwner] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    return { ron, owner, agent, cp, challenger, newOwner };
  }

  async function deployRegistry() {
    const [owner, creator, newOwner] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();
    return { registry, owner, creator, newOwner };
  }

  describe("Ownable2Step", () => {
    it("RON ownership only moves when the pending owner accepts", async () => {
      const { ron, owner, agent, newOwner } = await deployRon();
      await ron.transferOwnership(newOwner.address);
      expect(await ron.owner()).to.eq(owner.address);
      expect(await ron.pendingOwner()).to.eq(newOwner.address);

      await expect(ron.connect(agent).acceptOwnership())
        .to.be.revertedWithCustomError(ron, "OwnableUnauthorizedAccount")
        .withArgs(agent.address);

      await expect(ron.connect(newOwner).acceptOwnership())
        .to.emit(ron, "OwnershipTransferred")
        .withArgs(owner.address, newOwner.address);
      expect(await ron.owner()).to.eq(newOwner.address);
      expect(await ron.pendingOwner()).to.eq(ethers.ZeroAddress);
    });

    it("Registry ownership only moves when the pending owner accepts", async () => {
      const { registry, owner, creator, newOwner } = await deployRegistry();
      await registry.transferOwnership(newOwner.address);
      expect(await registry.owner()).to.eq(owner.address);
      await expect(registry.connect(creator).acceptOwnership()).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount",
      );
      await registry.connect(newOwner).acceptOwnership();
      expect(await registry.owner()).to.eq(newOwner.address);
    });

    it("a zero-address transfer cannot complete; a later valid transfer can", async () => {
      const { ron, owner, newOwner } = await deployRon();
      await ron.transferOwnership(ethers.ZeroAddress);
      expect(await ron.pendingOwner()).to.eq(ethers.ZeroAddress);
      expect(await ron.owner()).to.eq(owner.address);

      await ron.transferOwnership(newOwner.address);
      await ron.connect(newOwner).acceptOwnership();
      expect(await ron.owner()).to.eq(newOwner.address);
    });
  });

  describe("URI caps (MAX_URI_LEN = 200)", () => {
    const atCap = `ipfs://${"a".repeat(MAX - 7)}`;
    const overCap = `ipfs://${"a".repeat(MAX - 6)}`;

    it("exposes the cap and accepts a URI at the limit", async () => {
      const { ron, agent } = await deployRon();
      expect(await ron.MAX_URI_LEN()).to.eq(BigInt(MAX));
      expect(atCap.length).to.eq(MAX);
      await expect(ron.connect(agent).attestCompletion(SUMMARY, atCap)).to.emit(ron, "SelfAttested");
    });

    it("reverts result, receipt, evidence, rebuttal and metadata URIs over the cap", async () => {
      const { ron, agent, cp, challenger } = await deployRon();
      expect(overCap.length).to.eq(MAX + 1);

      await expect(ron.connect(agent).attestCompletion(SUMMARY, overCap))
        .to.be.revertedWithCustomError(ron, "URITooLong")
        .withArgs(MAX + 1);

      await ron.connect(agent).attestCompletion(SUMMARY, atCap);
      await expect(ron.connect(cp).attestReceipt(1, overCap))
        .to.be.revertedWithCustomError(ron, "URITooLong")
        .withArgs(MAX + 1);

      await expect(ron.connect(challenger).challengeCompletion(1, overCap, { value: BOND }))
        .to.be.revertedWithCustomError(ron, "URITooLong")
        .withArgs(MAX + 1);

      await ron.connect(challenger).challengeCompletion(1, atCap, { value: BOND });
      await expect(ron.connect(agent).contestChallenge(1, overCap))
        .to.be.revertedWithCustomError(ron, "URITooLong")
        .withArgs(MAX + 1);

      await expect(ron.connect(agent).registerAgent(overCap))
        .to.be.revertedWithCustomError(ron, "URITooLong")
        .withArgs(MAX + 1);
    });

    it("Registry rejects metadata over the cap", async () => {
      const { registry, creator } = await deployRegistry();
      expect(await registry.MAX_URI_LEN()).to.eq(BigInt(MAX));
      await expect(
        registry.connect(creator).registerCapabilityEth(SUMMARY, overCap, { value: BOND }),
      )
        .to.be.revertedWithCustomError(registry, "URITooLong")
        .withArgs(MAX + 1);
    });
  });
});
