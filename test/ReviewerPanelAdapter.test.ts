import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase-0 ReviewerPanelAdapter: three named reviewers, any two sign the outcome
 * with EIP-712. No reviewer bond; the RulingOracle operator bond is the backstop.
 */
describe("ReviewerPanelAdapter", () => {
  const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
  const BOND = USDC(3000);
    const VALUE = USDC(300);

  const Ruling = { NONE: 0, PAY: 1, REFUND: 2 };
  const Status = { NONE: 0, RULED: 1, CHALLENGED: 2, FINALIZED: 3, OVERTURNED: 4 };

  let seq = 0;

  async function deployFixture(withReviewers = true) {
    const [
      owner,
      provider,
      payer,
      feePayer,
      challenger,
      treasury,
      reviewer1,
      reviewer2,
      reviewer3,
      other,
    ] = await ethers.getSigners();

    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const panel = await (await ethers.getContractFactory("ReviewerPanelAdapter")).deploy(
      owner.address,
    );
    const oracle = await (await ethers.getContractFactory("RulingOracle")).deploy(
      await usdc.getAddress(),
      await panel.getAddress(),
      treasury.address,
      owner.address,
    );
    await panel.setOracle(await oracle.getAddress());
    if (withReviewers) {
      await panel.setReviewers([reviewer1.address, reviewer2.address, reviewer3.address]);
    }

    await usdc.mint(owner.address, USDC(100_000));
    await usdc.mint(feePayer.address, USDC(10_000));
    await usdc.mint(challenger.address, USDC(10_000));
    await usdc.connect(owner).approve(await oracle.getAddress(), ethers.MaxUint256);
    await usdc.connect(feePayer).approve(await oracle.getAddress(), ethers.MaxUint256);
    await usdc.connect(challenger).approve(await oracle.getAddress(), ethers.MaxUint256);
    await oracle.connect(owner).depositBond(BOND);

    return {
      owner,
      provider,
      payer,
      feePayer,
      challenger,
      treasury,
      reviewer1,
      reviewer2,
      reviewer3,
      other,
      usdc,
      panel,
      oracle,
    };
  }

  function req(
    f: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    seq += 1;
    return {
      caseId: ethers.id(`panel-case-${seq}`),
      provider: f.provider.address,
      payer: f.payer.address,
      feePayer: f.feePayer.address,
      agentId: 77n,
      value: VALUE,
      specHash: ethers.id(`panel-spec-${seq}`),
      evidenceHash: ethers.id(`panel-evidence-${seq}`),
      evidenceURI: `ipfs://panel-case-${seq}.json`,
      ruling: Ruling.PAY,
      ...overrides,
    };
  }

  async function publish(
    f: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    const r = req(f, overrides);
    await f.oracle.connect(f.owner).publishRuling(r);
    return r;
  }

  async function escalatedCase(
    f: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    const r = await publish(f, overrides);
    await f.oracle.connect(f.challenger).challenge(r.caseId);
    await f.oracle.connect(f.owner).escalateRuling(r.caseId);
    const c = await f.oracle.getCase(r.caseId);
    return { r, c };
  }

  async function sign(
    reviewer: Awaited<ReturnType<typeof deployFixture>>["reviewer1"],
    f: Awaited<ReturnType<typeof deployFixture>>,
    requestId: string,
    caseId: string,
    evidenceHash: string,
    upheld: boolean,
  ) {
    const network = await ethers.provider.getNetwork();
    return reviewer.signTypedData(
      {
        name: "RulingOracleReviewerPanel",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await f.panel.getAddress(),
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
  }

  async function signatures(
    f: Awaited<ReturnType<typeof deployFixture>>,
    requestId: string,
    caseId: string,
    evidenceHash: string,
    upheld: boolean,
    signers: [Awaited<ReturnType<typeof deployFixture>>["reviewer1"], Awaited<ReturnType<typeof deployFixture>>["reviewer1"]] = [f.reviewer1, f.reviewer2],
  ) {
    return [
      await sign(signers[0], f, requestId, caseId, evidenceHash, upheld),
      await sign(signers[1], f, requestId, caseId, evidenceHash, upheld),
    ];
  }

  describe("configuration", () => {
    it("validates reviewers and allows only the owner to set them", async () => {
      const f = await deployFixture(false);
      await expect(
        f.panel.connect(f.other).setReviewers([
          f.reviewer1.address,
          f.reviewer2.address,
          f.reviewer3.address,
        ]),
      ).to.be.revertedWithCustomError(f.panel, "OwnableUnauthorizedAccount");

      await expect(
        f.panel.connect(f.owner).setReviewers([
          f.reviewer1.address,
          f.reviewer2.address,
          f.reviewer3.address,
        ]),
      )
        .to.emit(f.panel, "ReviewersUpdated")
        .withArgs([f.reviewer1.address, f.reviewer2.address, f.reviewer3.address]);
      expect(await f.panel.reviewers()).to.deep.eq([
        f.reviewer1.address,
        f.reviewer2.address,
        f.reviewer3.address,
      ]);

      await expect(
        f.panel.connect(f.owner).setReviewers([
          f.reviewer1.address,
          f.reviewer1.address,
          f.reviewer3.address,
        ]),
      ).to.be.revertedWithCustomError(f.panel, "InvalidReviewers");
      await expect(
        f.panel.connect(f.owner).setReviewers([
          f.reviewer1.address,
          f.reviewer2.address,
          ethers.ZeroAddress,
        ]),
      ).to.be.revertedWithCustomError(f.panel, "InvalidReviewers");
    });

    it("wires the oracle once and only the owner", async () => {
      const [owner, other] = await ethers.getSigners();
      const panel = await (await ethers.getContractFactory("ReviewerPanelAdapter")).deploy(
        owner.address,
      );
      await expect(panel.connect(other).setOracle(other.address)).to.be.revertedWithCustomError(
        panel,
        "OwnableUnauthorizedAccount",
      );
      await expect(panel.connect(owner).setOracle(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        panel,
        "ZeroAddress",
      );
      await expect(panel.connect(owner).setOracle(other.address))
        .to.emit(panel, "OracleUpdated")
        .withArgs(other.address);
      await expect(panel.connect(owner).setOracle(other.address)).to.be.revertedWithCustomError(
        panel,
        "OracleAlreadySet",
      );
    });

    it("rejects escalation before reviewers are configured", async () => {
      const f = await deployFixture(false);
      const r = await publish(f);
      await f.oracle.connect(f.challenger).challenge(r.caseId);
      await expect(f.oracle.connect(f.owner).escalateRuling(r.caseId)).to.be.revertedWithCustomError(
        f.panel,
        "ReviewersNotSet",
      );
    });

    it("only the oracle can escalate", async () => {
      const f = await deployFixture();
      await expect(
        f.panel.connect(f.other).escalate(ethers.id("case"), Ruling.PAY, ethers.id("evidence")),
      ).to.be.revertedWithCustomError(f.panel, "NotOracle");
    });
  });

  describe("2-of-3 resolution", () => {
    it("exposes the EIP-712 digest reviewers sign", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const network = await ethers.provider.getNetwork();
      const expected = ethers.TypedDataEncoder.hash(
        {
          name: "RulingOracleReviewerPanel",
          version: "1",
          chainId: network.chainId,
          verifyingContract: await f.panel.getAddress(),
        },
        {
          Review: [
            { name: "requestId", type: "bytes32" },
            { name: "caseId", type: "bytes32" },
            { name: "evidenceHash", type: "bytes32" },
            { name: "upheld", type: "bool" },
          ],
        },
        {
          requestId: c.escalationId,
          caseId: r.caseId,
          evidenceHash: r.evidenceHash,
          upheld: true,
        },
      );
      expect(await f.panel.reviewDigest(c.escalationId, true)).to.eq(expected);
    });

    it("two matching signatures uphold the ruling", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const sigs = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, true);

      await expect(f.panel.connect(f.other).resolve(c.escalationId, true, sigs))
        .to.emit(f.panel, "ReviewResolved")
        .withArgs(c.escalationId, true, f.reviewer1.address, f.reviewer2.address);

      const [finalRuling, status] = await f.oracle.outcome(r.caseId);
      expect(finalRuling).to.eq(Ruling.PAY);
      expect(status).to.eq(Status.FINALIZED);
      const request = await f.panel.getRequest(c.escalationId);
      expect(request.resolved).to.eq(true);
      expect(request.upheld).to.eq(true);
    });

    it("two matching signatures overturn the ruling and pay the payer", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const sigs = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, false);
      const payerBefore = await f.usdc.balanceOf(f.payer.address);

      await f.panel.connect(f.other).resolve(c.escalationId, false, sigs);
      expect(await f.usdc.balanceOf(f.payer.address)).to.eq(payerBefore + VALUE);
      const [finalRuling, status] = await f.oracle.outcome(r.caseId);
      expect(finalRuling).to.eq(Ruling.REFUND);
      expect(status).to.eq(Status.OVERTURNED);
      expect((await f.panel.getRequest(c.escalationId)).upheld).to.eq(false);
    });

    it("accepts either order of the two signatures", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const sigs = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, true, [
        f.reviewer2,
        f.reviewer1,
      ]);
      await f.panel.connect(f.other).resolve(c.escalationId, true, sigs);
      expect((await f.oracle.outcome(r.caseId))[1]).to.eq(Status.FINALIZED);
    });
  });

  describe("rejections", () => {
    it("rejects one signature, duplicate signers, and unauthorized signers", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const valid = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, true);

      await expect(
        f.panel.connect(f.other).resolve(c.escalationId, true, [valid[0]]),
      ).to.be.revertedWithCustomError(f.panel, "InvalidSignatures");
      await expect(
        f.panel.connect(f.other).resolve(c.escalationId, true, [valid[0], valid[0]]),
      ).to.be.revertedWithCustomError(f.panel, "InvalidSignatures");

      const unauthorized = await sign(f.other, f, c.escalationId, r.caseId, r.evidenceHash, true);
      await expect(
        f.panel.connect(f.other).resolve(c.escalationId, true, [valid[0], unauthorized]),
      ).to.be.revertedWithCustomError(f.panel, "InvalidSignatures");

      await f.panel.connect(f.other).resolve(c.escalationId, true, valid);
      expect((await f.oracle.outcome(r.caseId))[1]).to.eq(Status.FINALIZED);
    });

    it("rejects signatures for the opposite outcome", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const trueSigs = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, true);
      await expect(
        f.panel.connect(f.other).resolve(c.escalationId, false, trueSigs),
      ).to.be.revertedWithCustomError(f.panel, "InvalidSignatures");
    });

    it("rejects unknown requests and replays", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const sigs = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, true);
      await expect(
        f.panel.connect(f.other).resolve(ethers.id("unknown"), true, sigs),
      ).to.be.revertedWithCustomError(f.panel, "RequestNotFound");

      await f.panel.connect(f.other).resolve(c.escalationId, true, sigs);
      await expect(
        f.panel.connect(f.other).resolve(c.escalationId, true, sigs),
      ).to.be.revertedWithCustomError(f.panel, "RequestResolved");
    });

    it("rejects signatures after the 24h window", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const request = await f.panel.getRequest(c.escalationId);
      const sigs = await signatures(f, c.escalationId, r.caseId, r.evidenceHash, true);
      await time.setNextBlockTimestamp(request.deadline + 1n);
      await expect(
        f.panel.connect(f.other).resolve(c.escalationId, true, sigs),
      ).to.be.revertedWithCustomError(f.panel, "ResolutionWindowClosed");
    });
  });

  describe("timeout and reviewer rotation", () => {
    it("times out to an overturn after 24h, but not before", async () => {
      const f = await deployFixture();
      const { r, c } = await escalatedCase(f);
      const request = await f.panel.getRequest(c.escalationId);
      await expect(f.panel.connect(f.other).timeout(c.escalationId)).to.be.revertedWithCustomError(
        f.panel,
        "ResolutionWindowOpen",
      );

      await time.setNextBlockTimestamp(request.deadline + 1n);
      await expect(f.panel.connect(f.other).timeout(c.escalationId))
        .to.emit(f.panel, "ReviewTimedOut")
        .withArgs(c.escalationId);
      const [finalRuling, status] = await f.oracle.outcome(r.caseId);
      expect(finalRuling).to.eq(Ruling.REFUND);
      expect(status).to.eq(Status.OVERTURNED);
      await expect(f.panel.connect(f.other).timeout(c.escalationId)).to.be.revertedWithCustomError(
        f.panel,
        "RequestResolved",
      );
    });

    it("snapshots reviewers per request so rotation cannot rewrite an appeal", async () => {
      const f = await deployFixture();
      const first = await escalatedCase(f);
      await f.panel.connect(f.owner).setReviewers([
        f.reviewer1.address,
        f.reviewer2.address,
        f.other.address,
      ]);

      // reviewer3 was in the first request's snapshot and can still sign it.
      const firstSigs = await signatures(f, first.c.escalationId, first.r.caseId, first.r.evidenceHash, true, [
        f.reviewer1,
        f.reviewer3,
      ]);
      await f.panel.connect(f.other).resolve(first.c.escalationId, true, firstSigs);
      expect((await f.oracle.outcome(first.r.caseId))[1]).to.eq(Status.FINALIZED);

      const second = await escalatedCase(f);
      const staleSigs = await signatures(f, second.c.escalationId, second.r.caseId, second.r.evidenceHash, true, [
        f.reviewer1,
        f.reviewer3,
      ]);
      await expect(
        f.panel.connect(f.other).resolve(second.c.escalationId, true, staleSigs),
      ).to.be.revertedWithCustomError(f.panel, "InvalidSignatures");

      const currentSigs = await signatures(f, second.c.escalationId, second.r.caseId, second.r.evidenceHash, true, [
        f.reviewer1,
        f.other,
      ]);
      await f.panel.connect(f.other).resolve(second.c.escalationId, true, currentSigs);
      expect((await f.oracle.outcome(second.r.caseId))[1]).to.eq(Status.FINALIZED);
    });
  });
});
