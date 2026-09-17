import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * EIP-170 contract-size guard. Deploying a contract whose runtime bytecode
 * exceeds 24,576 bytes reverts on-chain; catching it here keeps a future change
 * from silently becoming undeployable.
 */
describe("EIP-170 contract size guard", () => {
  const MAX_DEPLOYED_BYTES = 24_576;

  // solidity-coverage instruments the bytecode, which inflates it far beyond the
  // real size; skip there (the guard runs in the normal, uninstrumented suite).
  beforeEach(function () {
    if (process.env.SKIP_SIZE_CHECK === "true") this.skip();
  });

  it("ReputationOracleNetwork stays deployable", async () => {
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    const code = await ethers.provider.getCode(await ron.getAddress());
    const size = (code.length - 2) / 2;
    expect(size).to.be.greaterThan(0);
    expect(size).to.be.lessThan(MAX_DEPLOYED_BYTES);
  });

  it("CapabilityRegistry stays deployable", async () => {
    const [owner] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();
    const code = await ethers.provider.getCode(await registry.getAddress());
    const size = (code.length - 2) / 2;
    expect(size).to.be.greaterThan(0);
    expect(size).to.be.lessThan(MAX_DEPLOYED_BYTES);
  });
});
