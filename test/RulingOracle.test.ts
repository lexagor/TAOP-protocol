import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * RulingOracle pilot: bonded, appealable adjudication for public-evidence agent
 * work. The oracle never custodies case funds; a marketplace escrow reads
 * `outcome(caseId)` after the challenge/escalation process.
 */
describe("RulingOracle", () => {
  const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
  const BOND = USDC(3000);
  const CAP = USDC(300);
  const FEE = USDC(25);
  const MIN_CHALLENGE = USDC(25);
  const VALUE = USDC(300);

  const Ruling = { NONE: 0, PAY: 1, REFUND: 2 };
  const Status = { NONE: 0, RULED: 1, CHALLENGED: 2, FINALIZED: 3, OVERTURNED: 4, PENDING_FEE: 5 };

  let seq = 0;

  async function deployFixture(deposit = true) {
    const [owner, provider, payer, feePayer, challenger, treasury, other] =
      await ethers.getSigners();

    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const esc = await (await ethers.getContractFactory("MockEscalationOracle")).deploy();
    const oracle = await (await ethers.getContractFactory("RulingOracle")).deploy(
      await usdc.getAddress(),
      await esc.getAddress(),
      treasury.address,
      owner.address,
    );
    await esc.setOracle(await oracle.getAddress());

    await usdc.mint(owner.address, USDC(100_000));
    await usdc.mint(feePayer.address, USDC(10_000));
    await usdc.mint(challenger.address, USDC(10_000));
    await usdc.connect(owner).approve(await oracle.getAddress(), ethers.MaxUint256);
    await usdc.connect(feePayer).approve(await oracle.getAddress(), ethers.MaxUint256);
    await usdc.connect(challenger).approve(await oracle.getAddress(), ethers.MaxUint256);

    if (deposit) await oracle.connect(owner).depositBond(BOND);

    return { owner, provider, payer, feePayer, challenger, treasury, other, usdc, esc, oracle };
  }

  function req(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    seq += 1;
    return {
      caseId: ethers.id(`case-${seq}`),
      provider: fixture.provider.address,
      payer: fixture.payer.address,
      feePayer: fixture.feePayer.address,
      agentId: 42n,
      value: VALUE,
      specHash: ethers.id(`spec-${seq}`),
      evidenceHash: ethers.id(`evidence-${seq}`),
      evidenceURI: `ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/case-${seq}.json`,
      ruling: Ruling.PAY,
      ...overrides,
    };
  }

  async function publishOnly(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    const r = req(fixture, overrides);
    await fixture.oracle.connect(fixture.owner).publishRuling(r);
    return r;
  }

  async function publish(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    const r = await publishOnly(fixture, overrides);
    await fixture.oracle.connect(fixture.feePayer).payFee(r.caseId);
    return r;
  }

  async function challenge(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    caseId: string,
    who: "challenger" | "payer" | "provider" | "other" = "challenger",
  ) {
    await fixture.oracle.connect(fixture[who]).challenge(caseId);
  }

  async function escalate(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    caseId: string,
  ) {
    await fixture.oracle.connect(fixture.owner).escalateRuling(caseId);
  }

  const balance = async (
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    addr: string,
  ) => fixture.usdc.balanceOf(addr);

  const accounting = async (fixture: Awaited<ReturnType<typeof deployFixture>>) => {
    const held = await balance(fixture, await fixture.oracle.getAddress());
    const bond = await fixture.oracle.operatorBond();
    const challenges = await fixture.oracle.challengeBonds();
    const feePool = await fixture.oracle.feePool();
    const heldFees = await fixture.oracle.heldFees();
    return { held, bond, challenges, feePool, heldFees };
  };

  describe("deployment and frozen parameters", () => {
    it("exposes the pilot parameters and structurally caps exposure at bond/2", async () => {
      const f = await deployFixture();
      expect(await f.oracle.CASE_CAP()).to.eq(CAP);
      expect(await f.oracle.CHALLENGE_WINDOW()).to.eq(48n * 60n * 60n);
      expect(await f.oracle.ESCALATION_WINDOW()).to.eq(72n * 60n * 60n);
      expect(await f.oracle.ESCALATION_RESOLUTION_TIMEOUT()).to.eq(30n * 24n * 60n * 60n);
      expect(await f.oracle.CHALLENGE_BOND_BPS()).to.eq(1000n);
      expect(await f.oracle.MIN_CHALLENGE_BOND()).to.eq(MIN_CHALLENGE);
      expect(await f.oracle.FEE()).to.eq(FEE);
      expect(await f.oracle.MAX_LIVE_CASES()).to.eq(5n);
      expect(await f.oracle.BOND_FLOOR()).to.eq(BOND);
      expect(await f.oracle.PENDING_FEE_TTL()).to.eq(7n * 24n * 60n * 60n);
      expect(await f.oracle.MAX_URI_LEN()).to.eq(512n);
      expect(BigInt(await f.oracle.MAX_LIVE_CASES()) * CAP).to.eq(BOND / 2n);
      expect(await f.oracle.treasury()).to.eq(f.treasury.address);
      expect(await f.oracle.USDC()).to.eq(await f.usdc.getAddress());
      expect(await f.oracle.ESCALATION()).to.eq(await f.esc.getAddress());
      expect(await f.usdc.decimals()).to.eq(6n);
    });

    it("rejects zero addresses and a treasury that is the oracle itself", async () => {
      const [owner, , , , , treasury] = await ethers.getSigners();
      const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const esc = await (await ethers.getContractFactory("MockEscalationOracle")).deploy();
      const factory = await ethers.getContractFactory("RulingOracle");

      await expect(
        factory.deploy(ethers.ZeroAddress, await esc.getAddress(), treasury.address, owner.address),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      await expect(
        factory.deploy(await usdc.getAddress(), ethers.ZeroAddress, treasury.address, owner.address),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      await expect(
        factory.deploy(await usdc.getAddress(), await esc.getAddress(), ethers.ZeroAddress, owner.address),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");

      await expect(
        factory.deploy(await usdc.getAddress(), await esc.getAddress(), await usdc.getAddress(), owner.address),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");

      const predicted = ethers.getCreateAddress({ from: owner.address, nonce: await owner.getNonce() });
      await expect(
        factory.deploy(
          await usdc.getAddress(),
          await esc.getAddress(),
          predicted,
          owner.address,
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("lets only the owner rotate the treasury and emits the change", async () => {
      const f = await deployFixture();
      await expect(f.oracle.connect(f.other).setTreasury(f.other.address)).to.be.revertedWithCustomError(
        f.oracle,
        "OwnableUnauthorizedAccount",
      );
      await expect(f.oracle.connect(f.owner).setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        f.oracle,
        "ZeroAddress",
      );
      const oracleAddr = await f.oracle.getAddress();
      await expect(f.oracle.connect(f.owner).setTreasury(oracleAddr)).to.be.revertedWithCustomError(
        f.oracle,
        "ZeroAddress",
      );
      await expect(
        f.oracle.connect(f.owner).setTreasury(await f.usdc.getAddress()),
      ).to.be.revertedWithCustomError(f.oracle, "ZeroAddress");
      await expect(f.oracle.connect(f.owner).setTreasury(f.other.address))
        .to.emit(f.oracle, "TreasuryUpdated")
        .withArgs(f.treasury.address, f.other.address);
      expect(await f.oracle.treasury()).to.eq(f.other.address);
    });
  });

  describe("operator bond", () => {
    it("deposits, withdraws, and blocks withdrawal while a case is live", async () => {
      const f = await deployFixture(false);
      await expect(f.oracle.connect(f.owner).depositBond(0)).to.be.revertedWithCustomError(
        f.oracle,
        "ValueZero",
      );
      await expect(f.oracle.connect(f.owner).depositBond(BOND))
        .to.emit(f.oracle, "BondDeposited")
        .withArgs(f.owner.address, BOND);
      expect(await f.oracle.operatorBond()).to.eq(BOND);

      const r = await publish(f);
      await expect(f.oracle.connect(f.owner).withdrawBond(1n)).to.be.revertedWithCustomError(
        f.oracle,
        "CasesLive",
      );

      await time.increase(48n * 60n * 60n);
      await f.oracle.connect(f.other).finalizeUnchallenged(r.caseId);
      await expect(f.oracle.connect(f.owner).withdrawBond(BOND + 1n)).to.be.revertedWithCustomError(
        f.oracle,
        "InsufficientBond",
      );
      await expect(f.oracle.connect(f.owner).withdrawBond(0)).to.be.revertedWithCustomError(
        f.oracle,
        "ValueZero",
      );
      await expect(f.oracle.connect(f.owner).withdrawBond(BOND))
        .to.emit(f.oracle, "BondWithdrawn")
        .withArgs(f.owner.address, BOND);
      expect(await f.oracle.operatorBond()).to.eq(0n);
      expect(await f.oracle.feePool()).to.eq(FEE);
      expect(await balance(f, await f.oracle.getAddress())).to.eq(FEE);
      await expect(f.oracle.connect(f.owner).withdrawFees())
        .to.emit(f.oracle, "FeesWithdrawn")
        .withArgs(f.treasury.address, FEE);
      expect(await balance(f, await f.oracle.getAddress())).to.eq(0n);
    });

    it("only the owner can deposit or withdraw", async () => {
      const f = await deployFixture(false);
      await expect(f.oracle.connect(f.other).depositBond(BOND)).to.be.revertedWithCustomError(
        f.oracle,
        "OwnableUnauthorizedAccount",
      );
      await f.oracle.connect(f.owner).depositBond(BOND);
      await expect(f.oracle.connect(f.other).withdrawBond(1n)).to.be.revertedWithCustomError(
        f.oracle,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("publishing rulings", () => {
    it("publishes an offer, then activates it when the fee payer pays", async () => {
      const f = await deployFixture();
      const r = req(f);
      const treasuryBefore = await balance(f, f.treasury.address);
      const feePayerBefore = await balance(f, f.feePayer.address);

      await expect(f.oracle.connect(f.owner).publishRuling(r))
        .to.emit(f.oracle, "RulingPublished")
        .withArgs(
          r.caseId,
          f.provider.address,
          f.payer.address,
          r.agentId,
          r.value,
          r.ruling,
          r.specHash,
          r.evidenceHash,
        );

      const pending = await f.oracle.getCase(r.caseId);
      expect(pending.status).to.eq(BigInt(Status.PENDING_FEE));
      expect(await f.oracle.liveCases()).to.eq(0n);
      expect(await f.oracle.liveExposure()).to.eq(0n);
      expect(await balance(f, f.treasury.address)).to.eq(treasuryBefore);

      await expect(f.oracle.connect(f.other).payFee(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "NotFeePayer",
      );
      await expect(f.oracle.connect(f.feePayer).payFee(r.caseId))
        .to.emit(f.oracle, "FeePaid")
        .withArgs(r.caseId, f.feePayer.address, FEE)
        .and.to.emit(f.oracle, "RulingActivated");

      expect(await balance(f, f.treasury.address)).to.eq(treasuryBefore);
      expect(await balance(f, f.feePayer.address)).to.eq(feePayerBefore - FEE);
      expect(await f.oracle.feePool()).to.eq(0n);
      expect(await f.oracle.heldFees()).to.eq(FEE);
      expect(await f.oracle.caseFee(r.caseId)).to.eq(FEE);
      expect(await f.oracle.liveCases()).to.eq(1n);
      expect(await f.oracle.liveExposure()).to.eq(r.value);

      const c = await f.oracle.getCase(r.caseId);
      expect(c.provider).to.eq(f.provider.address);
      expect(c.payer).to.eq(f.payer.address);
      expect(c.feePayer).to.eq(f.feePayer.address);
      expect(c.agentId).to.eq(r.agentId);
      expect(c.value).to.eq(r.value);
      expect(c.ruling).to.eq(BigInt(Ruling.PAY));
      expect(c.status).to.eq(BigInt(Status.RULED));
      expect(c.evidenceURI).to.eq(r.evidenceURI);
      expect(c.challengeBond).to.eq(0n);
      expect(await f.oracle.challengeBonds()).to.eq(0n);
      expect(await balance(f, await f.oracle.getAddress())).to.eq(BOND + FEE);
      await expect(f.oracle.connect(f.feePayer).payFee(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
      await expect(f.oracle.connect(f.feePayer).payFee(ethers.id("unknown"))).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });

    it("requires the operator bond floor at fee payment", async () => {
      const f = await deployFixture(false);
      const r = req(f);
      await f.oracle.connect(f.owner).publishRuling(r);
      await expect(f.oracle.connect(f.feePayer).payFee(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "BondBelowFloor",
      );
    });

    it("rejects invalid cases (zero ids, parties, hashes, URI, value, ruling)", async () => {
      const f = await deployFixture();
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ["zero case", { caseId: ethers.ZeroHash }, "InvalidCase"],
        ["zero provider", { provider: ethers.ZeroAddress }, "InvalidCase"],
        ["zero payer", { payer: ethers.ZeroAddress }, "InvalidCase"],
        ["zero fee payer", { feePayer: ethers.ZeroAddress }, "InvalidCase"],
        ["same party", { payer: f.provider.address }, "SameParty"],
        ["zero value", { value: 0n }, "ValueZero"],
        ["above cap", { value: CAP + 1n }, "ValueAboveCap"],
        ["zero spec", { specHash: ethers.ZeroHash }, "InvalidCase"],
        ["zero evidence", { evidenceHash: ethers.ZeroHash }, "InvalidCase"],
        ["empty uri", { evidenceURI: "" }, "InvalidCase"],
        ["ruling none", { ruling: Ruling.NONE }, "InvalidCase"],
      ];
      for (const [, overrides, error] of cases) {
        await expect(f.oracle.connect(f.owner).publishRuling(req(f, overrides))).to.be.revertedWithCustomError(
          f.oracle,
          error,
        );
      }

      const longUri = `ipfs://${"a".repeat(600)}`;
      await expect(f.oracle.connect(f.owner).publishRuling(req(f, { evidenceURI: longUri })))
        .to.be.revertedWithCustomError(f.oracle, "URITooLong")
        .withArgs(BigInt(longUri.length));
    });

    it("rejects duplicate case ids", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await expect(f.oracle.connect(f.owner).publishRuling(r)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseExists",
      );
    });

    it("caps live cases and releases slots on finalization", async () => {
      const f = await deployFixture();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push((await publish(f)).caseId);
      expect(await f.oracle.liveCases()).to.eq(5n);
      expect(await f.oracle.liveExposure()).to.eq(BOND / 2n);
      const sixth = await publishOnly(f);
      await expect(f.oracle.connect(f.feePayer).payFee(sixth.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "LiveCasesExceeded",
      );

      await time.increase(48n * 60n * 60n);
      await f.oracle.connect(f.other).finalizeUnchallenged(ids[0]);
      expect(await f.oracle.liveCases()).to.eq(4n);
      expect(await f.oracle.liveExposure()).to.eq(BOND / 2n - VALUE);
      await publish(f);
      expect(await f.oracle.liveCases()).to.eq(5n);
    });

    it("fails closed until the case is final and exposes the provisional ruling", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      let [ruling, status] = await f.oracle.outcome(r.caseId);
      expect(ruling).to.eq(Ruling.NONE);
      expect(status).to.eq(Status.RULED);
      expect(await f.oracle.provisionalRuling(r.caseId)).to.deep.eq([
        BigInt(Ruling.PAY),
        BigInt(Status.RULED),
      ]);

      await f.oracle.connect(f.challenger).challenge(r.caseId);
      [ruling, status] = await f.oracle.outcome(r.caseId);
      expect(ruling).to.eq(Ruling.NONE);
      expect(status).to.eq(Status.CHALLENGED);
      expect(await f.oracle.provisionalRuling(r.caseId)).to.deep.eq([
        BigInt(Ruling.PAY),
        BigInt(Status.CHALLENGED),
      ]);

      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      await f.esc.connect(f.other).resolve(c.escalationId, true);
      [ruling, status] = await f.oracle.outcome(r.caseId);
      expect(ruling).to.eq(Ruling.PAY);
      expect(status).to.eq(Status.FINALIZED);
    });

    it("lets the fee payer cancel an unpaid offer and reuses the caseId", async () => {
      const f = await deployFixture();
      const r = await publishOnly(f);
      await expect(f.oracle.connect(f.other).cancelUnpaid(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "NotCanceller",
      );
      await expect(f.oracle.connect(f.feePayer).cancelUnpaid(r.caseId))
        .to.emit(f.oracle, "RulingCancelled")
        .withArgs(r.caseId, f.feePayer.address);

      await f.oracle.connect(f.owner).publishRuling(r);
      await f.oracle.connect(f.feePayer).payFee(r.caseId);
      expect((await f.oracle.getCase(r.caseId)).status).to.eq(BigInt(Status.RULED));
      await expect(f.oracle.connect(f.feePayer).cancelUnpaid(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });

    it("lets the operator cancel an unpaid offer only after the TTL", async () => {
      const f = await deployFixture();
      const r = await publishOnly(f);
      await expect(f.oracle.connect(f.owner).cancelUnpaid(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "PendingFeeNotExpired",
      );
      await time.increase(7n * 24n * 60n * 60n);
      await expect(f.oracle.connect(f.owner).cancelUnpaid(r.caseId))
        .to.emit(f.oracle, "RulingCancelled")
        .withArgs(r.caseId, f.owner.address);
      await expect(f.oracle.connect(f.owner).cancelUnpaid(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });

    it("accrues fees only after finalization and lets the treasury withdraw them", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      expect(await f.oracle.feePool()).to.eq(0n);
      expect(await f.oracle.heldFees()).to.eq(FEE);
      await expect(f.oracle.connect(f.owner).withdrawFees()).to.be.revertedWithCustomError(
        f.oracle,
        "ValueZero",
      );
      await time.increase(48n * 60n * 60n);
      await f.oracle.connect(f.other).finalizeUnchallenged(r.caseId);
      expect(await f.oracle.feePool()).to.eq(FEE);
      expect(await f.oracle.heldFees()).to.eq(0n);
      await expect(f.oracle.connect(f.other).withdrawFees()).to.be.revertedWithCustomError(
        f.oracle,
        "OwnableUnauthorizedAccount",
      );
      await expect(f.oracle.connect(f.owner).withdrawFees()).to.emit(f.oracle, "FeesWithdrawn");
      expect(await f.oracle.feePool()).to.eq(0n);
    });

    it("only the owner can publish", async () => {
      const f = await deployFixture();
      await expect(f.oracle.connect(f.other).publishRuling(req(f))).to.be.revertedWithCustomError(
        f.oracle,
        "OwnableUnauthorizedAccount",
      );
    });

    it("sends accrued fees to the rotated treasury", async () => {
      const f = await deployFixture();
      await f.oracle.connect(f.owner).setTreasury(f.other.address);
      const before = await balance(f, f.other.address);
      const r = await publish(f);
      expect(await balance(f, f.other.address)).to.eq(before);
      await time.increase(48n * 60n * 60n);
      await f.oracle.connect(f.other).finalizeUnchallenged(r.caseId);
      await expect(f.oracle.connect(f.owner).withdrawFees())
        .to.emit(f.oracle, "FeesWithdrawn")
        .withArgs(f.other.address, FEE);
      expect(await balance(f, f.other.address)).to.eq(before + FEE);
    });
  });

  describe("unchallenged finalization and loss records", () => {
    it("cannot finalize before the challenge window closes", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await expect(f.oracle.connect(f.other).finalizeUnchallenged(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "ChallengeWindowOpen",
      );
    });

    it("finalizes at the challenge deadline and records a REFUND loss", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.REFUND });
      const c = await f.oracle.getCase(r.caseId);
      await time.setNextBlockTimestamp(c.challengeDeadline);

      await expect(f.oracle.connect(f.other).finalizeUnchallenged(r.caseId))
        .to.emit(f.oracle, "RulingFinalized")
        .withArgs(r.caseId, Ruling.REFUND, c.challengeDeadline)
        .and.to.emit(f.oracle, "LossRecorded")
        .withArgs(r.caseId, f.provider.address, r.agentId, r.value, r.evidenceHash);

      const after = await f.oracle.getCase(r.caseId);
      expect(after.status).to.eq(BigInt(Status.FINALIZED));
      expect(after.finalizedAt).to.eq(c.challengeDeadline);
      expect(await f.oracle.liveCases()).to.eq(0n);
      expect(await f.oracle.liveExposure()).to.eq(0n);
      expect(await f.oracle.lossCount(f.provider.address)).to.eq(1n);
      const loss = await f.oracle.lossAt(f.provider.address, 0);
      expect(loss.caseId).to.eq(r.caseId);
      expect(loss.agentId).to.eq(r.agentId);
      expect(loss.value).to.eq(r.value);
      expect(loss.evidenceHash).to.eq(r.evidenceHash);

      const [finalRuling, status, finalizedAt] = await f.oracle.outcome(r.caseId);
      expect(finalRuling).to.eq(Ruling.REFUND);
      expect(status).to.eq(Status.FINALIZED);
      expect(finalizedAt).to.eq(c.challengeDeadline);
    });

    it("does not record a loss for a PAY ruling", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.PAY });
      await time.increase(48n * 60n * 60n);
      await f.oracle.connect(f.other).finalizeUnchallenged(r.caseId);
      expect(await f.oracle.lossCount(f.provider.address)).to.eq(0n);
      const [, status] = await f.oracle.outcome(r.caseId);
      expect(status).to.eq(Status.FINALIZED);
    });

    it("cannot finalize twice or challenge after finalization", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await time.increase(48n * 60n * 60n);
      await f.oracle.connect(f.other).finalizeUnchallenged(r.caseId);
      await expect(f.oracle.connect(f.other).finalizeUnchallenged(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
      await expect(f.oracle.connect(f.challenger).challenge(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });
  });

  describe("challenges", () => {
    it("charges a third party 10% of value (min $25)", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      const before = await balance(f, f.challenger.address);
      await expect(f.oracle.connect(f.challenger).challenge(r.caseId))
        .to.emit(f.oracle, "RulingChallenged")
        .withArgs(r.caseId, f.challenger.address, USDC(30), false);
      expect(await f.oracle.challengeBonds()).to.eq(USDC(30));
      expect(await balance(f, f.challenger.address)).to.eq(before - USDC(30));
      const c = await f.oracle.getCase(r.caseId);
      expect(c.status).to.eq(BigInt(Status.CHALLENGED));
      expect(c.challengeBond).to.eq(USDC(30));
      expect(c.challenger).to.eq(f.challenger.address);
      expect(await f.oracle.challengeBondFor(USDC(100))).to.eq(MIN_CHALLENGE);
      expect(await f.oracle.challengeBondFor(USDC(250))).to.eq(MIN_CHALLENGE);
      expect(await f.oracle.challengeBondFor(USDC(251))).to.eq(USDC(25.1));
      expect(await f.oracle.challengeBondFor(VALUE)).to.eq(USDC(30));
    });

    it("lets the wronged party challenge free (PAY -> payer, REFUND -> provider)", async () => {
      const f = await deployFixture();
      const pay = await publish(f, { ruling: Ruling.PAY });
      await expect(f.oracle.connect(f.payer).challenge(pay.caseId))
        .to.emit(f.oracle, "RulingChallenged")
        .withArgs(pay.caseId, f.payer.address, 0n, true);
      expect((await f.oracle.getCase(pay.caseId)).challengeBond).to.eq(0n);

      const refund = await publish(f, { ruling: Ruling.REFUND });
      await expect(f.oracle.connect(f.provider).challenge(refund.caseId))
        .to.emit(f.oracle, "RulingChallenged")
        .withArgs(refund.caseId, f.provider.address, 0n, true);
      expect((await f.oracle.getCase(refund.caseId)).challengeBond).to.eq(0n);
    });

    it("rejects challenges at/after the deadline and for non-pending cases", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      const c = await f.oracle.getCase(r.caseId);
      await time.setNextBlockTimestamp(c.challengeDeadline);
      await expect(f.oracle.connect(f.challenger).challenge(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "ChallengeWindowClosed",
      );

      const f2 = await deployFixture();
      await expect(f2.oracle.connect(f2.challenger).challenge(ethers.id("unknown"))).to.be.revertedWithCustomError(
        f2.oracle,
        "CaseNotPending",
      );
    });

    it("only allows one challenge per case", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await f.oracle.connect(f.challenger).challenge(r.caseId);
      await expect(f.oracle.connect(f.other).challenge(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });
  });

  describe("escalation", () => {
    it("escalates a challenged case and records the adapter request", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);
      await expect(f.oracle.connect(f.owner).escalateRuling(r.caseId))
        .to.emit(f.oracle, "RulingEscalated");
      const c = await f.oracle.getCase(r.caseId);
      expect(c.escalationId).to.not.eq(ethers.ZeroHash);
      expect(await f.oracle.caseByEscalation(c.escalationId)).to.eq(r.caseId);
      expect(await f.esc.lastCaseId()).to.eq(r.caseId);
      expect(await f.esc.lastRuling()).to.eq(BigInt(Ruling.PAY));
      expect(await f.esc.lastEvidenceHash()).to.eq(r.evidenceHash);
    });

    it("enforces owner, challenge state, deadline, and single escalation", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);

      await expect(f.oracle.connect(f.other).escalateRuling(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "OwnableUnauthorizedAccount",
      );

      await f.oracle.connect(f.owner).escalateRuling(r.caseId);
      await expect(f.oracle.connect(f.owner).escalateRuling(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "EscalationExists",
      );

      const r2 = await publish(f);
      await challenge(f, r2.caseId);
      const c2 = await f.oracle.getCase(r2.caseId);
      await time.setNextBlockTimestamp(c2.escalationDeadline);
      await expect(f.oracle.connect(f.owner).escalateRuling(r2.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "EscalationTooLate",
      );

      const r3 = await publish(f);
      await expect(f.oracle.connect(f.owner).escalateRuling(r3.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });

    it("rejects a zero request id and a duplicate adapter id", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);
      await f.esc.setReturnZero(true);
      await expect(f.oracle.connect(f.owner).escalateRuling(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "EscalationFailed",
      );
      await f.esc.setReturnZero(false);

      const sharedId = ethers.id("shared-escalation");
      await f.esc.setNextId(sharedId);
      await f.oracle.connect(f.owner).escalateRuling(r.caseId);
      expect((await f.oracle.getCase(r.caseId)).escalationId).to.eq(sharedId);

      const r2 = await publish(f);
      await challenge(f, r2.caseId);
      await f.esc.setNextId(sharedId);
      await expect(f.oracle.connect(f.owner).escalateRuling(r2.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "EscalationFailed",
      );
    });
  });

  describe("appeal resolution", () => {
    it("only the escalation adapter can resolve, and only known challenged cases", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await expect(
        f.oracle.connect(f.other).resolveEscalation(ethers.id("unknown"), true),
      ).to.be.revertedWithCustomError(f.oracle, "NotEscalationOracle");

      await expect(
        f.esc.connect(f.other).resolve(ethers.id("unknown"), true),
      ).to.be.revertedWithCustomError(f.oracle, "InvalidCase");

      const r2 = await publish(f);
      await f.oracle.connect(f.challenger).challenge(r2.caseId);
      await f.oracle.connect(f.owner).escalateRuling(r2.caseId);
      await expect(f.esc.connect(f.other).resolve(ethers.id("unknown"), true)).to.be.revertedWithCustomError(
        f.oracle,
        "InvalidCase",
      );
      await expect(f.esc.connect(f.other).resolve(ethers.id("unknown2"), false)).to.be.revertedWithCustomError(
        f.oracle,
        "InvalidCase",
      );
      expect(r.caseId).to.not.eq(r2.caseId);
    });

    it("upheld challenge finalizes the original ruling and pays the wronged party", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.PAY });
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const providerBefore = await balance(f, f.provider.address);
      const bondBefore = await f.oracle.operatorBond();

      await expect(f.esc.connect(f.other).resolve(c.escalationId, true))
        .to.emit(f.oracle, "RulingFinalized")
        .withArgs(r.caseId, Ruling.PAY, await time.latest().then((t) => BigInt(t) + 1n));

      expect(await balance(f, f.provider.address)).to.eq(providerBefore + USDC(30));
      expect(await f.oracle.operatorBond()).to.eq(bondBefore);
      expect(await f.oracle.challengeBonds()).to.eq(0n);
      expect((await f.oracle.getCase(r.caseId)).status).to.eq(BigInt(Status.FINALIZED));
      expect(await f.oracle.lossCount(f.provider.address)).to.eq(0n);
      const a = await accounting(f);
      expect(a.held).to.eq(a.bond + a.challenges + a.feePool + a.heldFees);
      expect(a.feePool).to.eq(FEE);
    });

    it("upheld REFUND records a loss and pays the challenger bond to the payer", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.REFUND });
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const payerBefore = await balance(f, f.payer.address);

      await f.esc.connect(f.other).resolve(c.escalationId, true);
      expect(await balance(f, f.payer.address)).to.eq(payerBefore + USDC(30));
      expect(await f.oracle.lossCount(f.provider.address)).to.eq(1n);
      expect((await f.oracle.getCase(r.caseId)).status).to.eq(BigInt(Status.FINALIZED));
    });

    it("overturned PAY pays the payer, refunds the fee and challenger, and pays a bounty", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.PAY });
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const payerBefore = await balance(f, f.payer.address);
      const feePayerBefore = await balance(f, f.feePayer.address);
      const challengerBefore = await balance(f, f.challenger.address);
      const bondBefore = await f.oracle.operatorBond();

      await expect(f.esc.connect(f.other).resolve(c.escalationId, false))
        .to.emit(f.oracle, "RulingOverturned")
        .withArgs(r.caseId, Ruling.REFUND, await time.latest().then((t) => BigInt(t) + 1n))
        .and.to.emit(f.oracle, "FeeRefunded")
        .withArgs(r.caseId, f.feePayer.address, FEE)
        .and.to.emit(f.oracle, "LossRecorded")
        .withArgs(r.caseId, f.provider.address, r.agentId, r.value, r.evidenceHash);

      expect(await balance(f, f.payer.address)).to.eq(payerBefore + VALUE);
      expect(await balance(f, f.feePayer.address)).to.eq(feePayerBefore + FEE);
      expect(await balance(f, f.challenger.address)).to.eq(challengerBefore + USDC(30) + USDC(30));
      expect(await f.oracle.operatorBond()).to.eq(bondBefore - VALUE - USDC(30));
      expect(await f.oracle.challengeBonds()).to.eq(0n);
      expect(await f.oracle.lossCount(f.provider.address)).to.eq(1n);

      const [finalRuling, status, , evidenceHash] = await f.oracle.outcome(r.caseId);
      expect(finalRuling).to.eq(Ruling.REFUND);
      expect(status).to.eq(Status.OVERTURNED);
      expect(evidenceHash).to.eq(r.evidenceHash);
      const a = await accounting(f);
      expect(a.held).to.eq(a.bond + a.challenges);
    });

    it("pays a winning wronged-party challenger the value but no bounty (PAY)", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.PAY });
      await f.oracle.connect(f.payer).challenge(r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const payerBefore = await balance(f, f.payer.address);
      const feePayerBefore = await balance(f, f.feePayer.address);
      const bondBefore = await f.oracle.operatorBond();

      await f.esc.connect(f.other).resolve(c.escalationId, false);
      expect(await balance(f, f.payer.address)).to.eq(payerBefore + VALUE);
      expect(await balance(f, f.feePayer.address)).to.eq(feePayerBefore + FEE);
      expect(await f.oracle.operatorBond()).to.eq(bondBefore - VALUE);
      expect(await f.oracle.challengeBonds()).to.eq(0n);
      expect(c.challenger).to.eq(f.payer.address);
      expect(c.challengeBond).to.eq(0n);
    });

    it("pays a winning wronged-party challenger the value but no bounty (REFUND)", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.REFUND });
      await f.oracle.connect(f.provider).challenge(r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const providerBefore = await balance(f, f.provider.address);
      const feePayerBefore = await balance(f, f.feePayer.address);
      const bondBefore = await f.oracle.operatorBond();

      await f.esc.connect(f.other).resolve(c.escalationId, false);
      expect(await balance(f, f.provider.address)).to.eq(providerBefore + VALUE);
      expect(await balance(f, f.feePayer.address)).to.eq(feePayerBefore + FEE);
      expect(await f.oracle.operatorBond()).to.eq(bondBefore - VALUE);
      expect(await f.oracle.challengeBonds()).to.eq(0n);
      expect(c.challenger).to.eq(f.provider.address);
      expect(c.challengeBond).to.eq(0n);
    });

    it("overturned REFUND pays the provider and records no loss", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.REFUND });
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const providerBefore = await balance(f, f.provider.address);

      await f.esc.connect(f.other).resolve(c.escalationId, false);
      expect(await balance(f, f.provider.address)).to.eq(providerBefore + VALUE);
      expect(await f.oracle.lossCount(f.provider.address)).to.eq(0n);
      const [finalRuling, status] = await f.oracle.outcome(r.caseId);
      expect(finalRuling).to.eq(Ruling.PAY);
      expect(status).to.eq(Status.OVERTURNED);
    });

    it("ignores a late resolution after the case is final", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      await f.esc.connect(f.other).resolve(c.escalationId, true);
      await expect(f.esc.connect(f.other).resolve(c.escalationId, false))
        .to.emit(f.oracle, "LateResolutionIgnored")
        .withArgs(c.escalationId, false);
      expect((await f.oracle.getCase(r.caseId)).status).to.eq(BigInt(Status.FINALIZED));
    });
  });

  describe("default overturn and liveness", () => {
    it("overturns when the operator never escalates", async () => {
      const f = await deployFixture();
      const r = await publish(f, { ruling: Ruling.PAY });
      await challenge(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      const payerBefore = await balance(f, f.payer.address);
      const challengerBefore = await balance(f, f.challenger.address);

      await time.setNextBlockTimestamp(c.escalationDeadline);
      await expect(f.oracle.connect(f.other).defaultOverturn(r.caseId))
        .to.emit(f.oracle, "RulingOverturned")
        .withArgs(r.caseId, Ruling.REFUND, c.escalationDeadline);

      expect(await balance(f, f.payer.address)).to.eq(payerBefore + VALUE);
      expect(await balance(f, f.challenger.address)).to.eq(challengerBefore + USDC(30) + USDC(30));
      expect((await f.oracle.getCase(r.caseId)).status).to.eq(BigInt(Status.OVERTURNED));
    });

    it("waits for the escalation deadline (or the appeal timeout) before overturning", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      await time.setNextBlockTimestamp(c.escalationDeadline - 2n);
      await expect(f.oracle.connect(f.other).defaultOverturn(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "EscalationNotPending",
      );

      // The reverted transaction consumed the pending timestamp; step forward.
      await time.setNextBlockTimestamp(c.escalationDeadline - 1n);
      await escalate(f, r.caseId);
      const esc = await f.oracle.getCase(r.caseId);
      await time.setNextBlockTimestamp(esc.escalationDeadline + 30n * 24n * 60n * 60n - 1n);
      await expect(f.oracle.connect(f.other).defaultOverturn(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "EscalationNotPending",
      );
      await time.setNextBlockTimestamp(esc.escalationDeadline + 30n * 24n * 60n * 60n);
      await expect(f.oracle.connect(f.other).defaultOverturn(r.caseId)).to.emit(
        f.oracle,
        "RulingOverturned",
      );
      await expect(f.esc.connect(f.other).resolve(esc.escalationId, true))
        .to.emit(f.oracle, "LateResolutionIgnored")
        .withArgs(esc.escalationId, true);
    });

    it("does not allow a default overturn before a challenge or after resolution", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await expect(f.oracle.connect(f.other).defaultOverturn(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      await f.esc.connect(f.other).resolve(c.escalationId, true);
      await expect(f.oracle.connect(f.other).defaultOverturn(r.caseId)).to.be.revertedWithCustomError(
        f.oracle,
        "CaseNotPending",
      );
    });
  });

  describe("accounting invariants", () => {
    it("keeps held USDC equal to operator bond plus challenge bonds through the lifecycle", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      await f.esc.connect(f.other).resolve(c.escalationId, false);

      const a = await accounting(f);
      expect(a.held).to.eq(a.bond + a.challenges + a.feePool + a.heldFees);
      await f.oracle.connect(f.owner).withdrawBond(a.bond);
      expect(await balance(f, await f.oracle.getAddress())).to.eq(0n);
    });

    it("never lets the operator keep a challenge bond on an upheld challenge", async () => {
      const f = await deployFixture();
      const r = await publish(f);
      await challenge(f, r.caseId);
      const bondBefore = await f.oracle.operatorBond();
      await escalate(f, r.caseId);
      const c = await f.oracle.getCase(r.caseId);
      await f.esc.connect(f.other).resolve(c.escalationId, true);
      expect(await f.oracle.operatorBond()).to.eq(bondBefore);
      expect(await f.oracle.challengeBonds()).to.eq(0n);
    });
  });
});
