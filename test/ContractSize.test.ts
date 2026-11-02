import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * EIP-170 contract-size guard. Deploying a contract whose runtime bytecode
 * exceeds 24,576 bytes reverts on-chain; catching it here keeps a future change
 * from silently becoming undeployable.
 */
describe("EIP-170 contract size guard", () => {
  const MAX_DEPLOYED_BYTES = 24_576;

  // solidity-coverage instruments the bytecode (inflating size and gas), so the
  // instrumentation-sensitive guards skip there; they run in the normal suite.
  beforeEach(function () {
    if (process.env.SKIP_SENSITIVE_CHECKS === "true") this.skip();
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

  it("ReviewerPanelAdapter stays deployable", async () => {
    const [owner] = await ethers.getSigners();
    const Panel = await ethers.getContractFactory("ReviewerPanelAdapter");
    const panel = await Panel.deploy(owner.address);
    await panel.waitForDeployment();
    const code = await ethers.provider.getCode(await panel.getAddress());
    const size = (code.length - 2) / 2;
    expect(size).to.be.greaterThan(0);
    expect(size).to.be.lessThan(MAX_DEPLOYED_BYTES);
  });

  it("RulingOracle stays deployable", async () => {
    const [owner, usdc, escalation, treasury] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("RulingOracle");
    const oracle = await Oracle.deploy(
      usdc.address,
      escalation.address,
      treasury.address,
      owner.address,
    );
    await oracle.waitForDeployment();
    const code = await ethers.provider.getCode(await oracle.getAddress());
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
