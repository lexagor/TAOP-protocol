// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IEscalationOracle} from "./interfaces/IEscalationOracle.sol";

/**
 * @title RulingOracle
 * @notice Bonded, appealable adjudication oracle for public-evidence agent work.
 *
 *         It does NOT custody case funds. A marketplace keeps its own escrow and
 *         reads `outcome(caseId)` once the ruling is final. The operator locks a
 *         USDC bond and publishes provisional rulings; anyone may challenge
 *         within 48h. A challenge escalates to a pluggable appeal layer (UMA
 *         OOv3 in production). If the operator does not escalate in time, the
 *         challenge succeeds by default. Overturned rulings pay the wronged
 *         party from the operator bond; the operator never keeps challenge bonds.
 */
contract RulingOracle is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Pilot parameters (frozen for Phase 0) ---
    uint256 public constant CASE_CAP = 300e6; // $300 (USDC, 6 decimals)
    uint256 public constant CHALLENGE_WINDOW = 48 hours;
    uint256 public constant ESCALATION_WINDOW = 72 hours;
    uint256 public constant ESCALATION_RESOLUTION_TIMEOUT = 30 days;
    uint256 public constant CHALLENGE_BOND_BPS = 1_000; // 10%
    uint256 public constant MIN_CHALLENGE_BOND = 25e6; // $25
    uint256 public constant FEE = 25e6; // $25 flat per published ruling
    uint8 public constant MAX_LIVE_CASES = 5;
    uint256 public constant BOND_FLOOR = 3_000e6; // $3,000, i.e. 2x the max live exposure
    uint256 public constant MAX_URI_LEN = 512;
    uint256 private constant BPS = 10_000;

    IERC20 public immutable USDC;
    IEscalationOracle public immutable ESCALATION;
    address public treasury;

    enum Ruling {
        NONE,
        PAY, // provider is clean; the marketplace should pay the provider
        REFUND // provider is at fault; the marketplace should refund the payer
    }

    enum Status {
        NONE,
        RULED,
        CHALLENGED,
        FINALIZED,
        OVERTURNED
    }

    struct Case {
        address provider;
        address payer;
        address feePayer;
        uint256 agentId; // ERC-8004 agentId (0 if unregistered)
        uint64 value; // USDC units, <= CASE_CAP
        Ruling ruling;
        Status status;
        uint64 ruledAt;
        uint64 challengeDeadline;
        uint64 challengeBond;
        uint64 escalationDeadline;
        uint64 finalizedAt;
        bytes32 specHash;
        bytes32 evidenceHash;
        string evidenceURI; // public evidence bundle
        address challenger;
        bytes32 escalationId;
        bool feeRefunded;
    }

    struct LossRecord {
        bytes32 caseId;
        address provider;
        uint256 agentId;
        uint64 value;
        uint64 finalizedAt;
        bytes32 evidenceHash;
    }

    struct PublishRequest {
        bytes32 caseId;
        address provider;
        address payer;
        address feePayer;
        uint256 agentId;
        uint256 value;
        bytes32 specHash;
        bytes32 evidenceHash;
        string evidenceURI;
        Ruling ruling;
    }

    mapping(bytes32 => Case) private _cases;
    mapping(bytes32 => bytes32) public caseByEscalation;
    mapping(address => LossRecord[]) private _losses;

    /// @notice USDC held as the operator's own bond.
    uint256 public operatorBond;
    /// @notice USDC held on behalf of challengers.
    uint256 public challengeBonds;
    /// @notice Sum of case values currently RULED or CHALLENGED.
    uint256 public liveExposure;
    uint8 public liveCases;

    event BondDeposited(address indexed operator, uint256 amount);
    event BondWithdrawn(address indexed operator, uint256 amount);
    event TreasuryUpdated(address indexed previousTreasury, address indexed nextTreasury);
    event FeePaid(bytes32 indexed caseId, address indexed feePayer, uint256 amount);
    event RulingPublished(
        bytes32 indexed caseId,
        address indexed provider,
        address indexed payer,
        uint256 agentId,
        uint256 value,
        Ruling ruling,
        bytes32 specHash,
        bytes32 evidenceHash
    );
    event RulingChallenged(
        bytes32 indexed caseId, address indexed challenger, uint256 bond, bool wrongedParty
    );
    event RulingEscalated(bytes32 indexed caseId, bytes32 indexed escalationId);
    event RulingFinalized(bytes32 indexed caseId, Ruling ruling, uint64 finalizedAt);
    event RulingOverturned(bytes32 indexed caseId, Ruling finalRuling, uint64 finalizedAt);
    event LossRecorded(
        bytes32 indexed caseId,
        address indexed provider,
        uint256 agentId,
        uint256 value,
        bytes32 evidenceHash
    );
    event FeeRefunded(bytes32 indexed caseId, address indexed feePayer, uint256 amount);
    event LateResolutionIgnored(bytes32 indexed requestId, bool rulingUpheld);

    error NotEscalationOracle();
    error InvalidCase();
    error CaseExists();
    error CaseNotPending();
    error ChallengeWindowClosed();
    error ChallengeWindowOpen();
    error EscalationExists();
    error EscalationFailed();
    error EscalationTooLate();
    error EscalationNotPending();
    error BondBelowFloor();
    error InsufficientBond();
    error CasesLive();
    error LiveCasesExceeded();
    error ValueAboveCap();
    error ValueZero();
    error SameParty();
    error ZeroAddress();
    error URITooLong(uint256 length);

    constructor(address usdc_, address escalation_, address treasury_, address owner_)
        Ownable(owner_)
    {
        if (
            usdc_ == address(0) || escalation_ == address(0) || treasury_ == address(0)
                || treasury_ == address(this) || treasury_ == usdc_
        ) {
            revert ZeroAddress();
        }
        USDC = IERC20(usdc_);
        ESCALATION = IEscalationOracle(escalation_);
        treasury = treasury_;
    }

    // --- Operator bond ---

    function depositBond(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ValueZero();
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        operatorBond += amount;
        emit BondDeposited(msg.sender, amount);
    }

    /// @notice Withdraw the operator bond. Blocked while any case is live.
    function withdrawBond(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ValueZero();
        if (amount > operatorBond) revert InsufficientBond();
        if (liveCases != 0) revert CasesLive();
        operatorBond -= amount;
        USDC.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    function setTreasury(address next) external onlyOwner {
        if (next == address(0) || next == address(this) || next == address(USDC)) {
            revert ZeroAddress();
        }
        address previous = treasury;
        treasury = next;
        emit TreasuryUpdated(previous, next);
    }

    // --- Rulings ---

    /// @notice Publish a provisional ruling and charge the flat case fee.
    /// @param req Everything the marketplace attests to; `feePayer` must have
    ///        approved this contract for `FEE`.
    function publishRuling(PublishRequest calldata req) external onlyOwner nonReentrant {
        if (req.caseId == bytes32(0) || req.provider == address(0) || req.payer == address(0)) {
            revert InvalidCase();
        }
        if (req.provider == req.payer) revert SameParty();
        if (req.feePayer == address(0)) revert InvalidCase();
        if (_cases[req.caseId].status != Status.NONE) revert CaseExists();
        if (req.ruling == Ruling.NONE) revert InvalidCase();
        if (req.specHash == bytes32(0) || req.evidenceHash == bytes32(0)) revert InvalidCase();
        if (bytes(req.evidenceURI).length == 0) revert InvalidCase();
        if (req.value == 0) revert ValueZero();
        if (req.value > CASE_CAP) revert ValueAboveCap();
        if (bytes(req.evidenceURI).length > MAX_URI_LEN) {
            revert URITooLong(bytes(req.evidenceURI).length);
        }
        if (operatorBond < BOND_FLOOR) revert BondBelowFloor();
        if (liveCases >= MAX_LIVE_CASES) revert LiveCasesExceeded();

        Case storage c = _cases[req.caseId];
        c.provider = req.provider;
        c.payer = req.payer;
        c.feePayer = req.feePayer;
        c.agentId = req.agentId;
        c.value = uint64(req.value);
        c.ruling = req.ruling;
        c.status = Status.RULED;
        c.ruledAt = uint64(block.timestamp);
        c.challengeDeadline = uint64(block.timestamp + CHALLENGE_WINDOW);
        c.specHash = req.specHash;
        c.evidenceHash = req.evidenceHash;
        c.evidenceURI = req.evidenceURI;

        liveExposure += req.value;
        liveCases += 1;
        USDC.safeTransferFrom(req.feePayer, treasury, FEE);
        emit FeePaid(req.caseId, req.feePayer, FEE);
        emit RulingPublished(
            req.caseId,
            req.provider,
            req.payer,
            req.agentId,
            req.value,
            req.ruling,
            req.specHash,
            req.evidenceHash
        );
    }

    /// @notice Finalize an unchallenged ruling after the 48h window.
    function finalizeUnchallenged(bytes32 caseId) external nonReentrant {
        Case storage c = _cases[caseId];
        if (c.status != Status.RULED) revert CaseNotPending();
        if (block.timestamp < c.challengeDeadline) revert ChallengeWindowOpen();
        _finalize(caseId, c);
    }

    /// @notice Challenge a provisional ruling within 48h. The wronged party
    ///         challenges for free; anyone else posts 10% of value (min $25).
    function challenge(bytes32 caseId) external nonReentrant {
        Case storage c = _cases[caseId];
        if (c.status != Status.RULED) revert CaseNotPending();
        if (block.timestamp >= c.challengeDeadline) revert ChallengeWindowClosed();

        address wronged = c.ruling == Ruling.PAY ? c.payer : c.provider;
        bool free = msg.sender == wronged;
        uint256 bond = free ? 0 : challengeBondFor(c.value);

        c.status = Status.CHALLENGED;
        c.challenger = msg.sender;
        c.challengeBond = uint64(bond);
        c.escalationDeadline = uint64(block.timestamp + ESCALATION_WINDOW);
        if (bond != 0) {
            challengeBonds += bond;
            USDC.safeTransferFrom(msg.sender, address(this), bond);
        }
        emit RulingChallenged(caseId, msg.sender, bond, free);
    }

    /// @notice Operator escalates a challenged ruling to the appeal layer.
    function escalateRuling(bytes32 caseId) external onlyOwner nonReentrant {
        Case storage c = _cases[caseId];
        if (c.status != Status.CHALLENGED) revert CaseNotPending();
        if (block.timestamp >= c.escalationDeadline) revert EscalationTooLate();
        if (c.escalationId != bytes32(0)) revert EscalationExists();
        bytes32 id = ESCALATION.escalate(caseId, uint8(c.ruling), c.evidenceHash);
        if (id == bytes32(0) || caseByEscalation[id] != bytes32(0)) revert EscalationFailed();
        c.escalationId = id;
        caseByEscalation[id] = caseId;
        emit RulingEscalated(caseId, id);
    }

    /// @notice If the operator never escalates, the challenge succeeds by default.
    function defaultOverturn(bytes32 caseId) external nonReentrant {
        Case storage c = _cases[caseId];
        if (c.status != Status.CHALLENGED) revert CaseNotPending();
        uint64 deadline = c.escalationDeadline;
        if (c.escalationId != bytes32(0)) {
            deadline += uint64(ESCALATION_RESOLUTION_TIMEOUT);
        }
        if (block.timestamp < deadline) revert EscalationNotPending();
        _overturn(caseId, c);
    }

    /// @notice Appeal-layer callback. Only the configured escalation oracle.
    function resolveEscalation(bytes32 requestId, bool rulingUpheld) external nonReentrant {
        if (msg.sender != address(ESCALATION)) revert NotEscalationOracle();
        bytes32 caseId = caseByEscalation[requestId];
        if (caseId == bytes32(0)) revert InvalidCase();
        Case storage c = _cases[caseId];
        if (c.status == Status.FINALIZED || c.status == Status.OVERTURNED) {
            emit LateResolutionIgnored(requestId, rulingUpheld);
            return;
        }
        if (c.status != Status.CHALLENGED) revert CaseNotPending();
        if (rulingUpheld) _finalize(caseId, c);
        else _overturn(caseId, c);
    }

    // --- Views ---

    /// @notice Final outcome for a marketplace escrow. `status == FINALIZED` is
    ///         the only state in which the escrow should act; `OVERTURNED` means
    ///         the opposite of the original ruling is the final outcome.
    function outcome(bytes32 caseId)
        external
        view
        returns (uint8 ruling, uint8 status, uint64 finalizedAt, bytes32 evidenceHash)
    {
        Case storage c = _cases[caseId];
        uint8 finalRuling = uint8(c.ruling);
        if (c.status == Status.OVERTURNED) {
            finalRuling = c.ruling == Ruling.PAY ? uint8(Ruling.REFUND) : uint8(Ruling.PAY);
        }
        return (finalRuling, uint8(c.status), c.finalizedAt, c.evidenceHash);
    }

    function challengeBondFor(uint256 value) public pure returns (uint256) {
        uint256 bpsBond = (value * CHALLENGE_BOND_BPS) / BPS;
        return bpsBond > MIN_CHALLENGE_BOND ? bpsBond : MIN_CHALLENGE_BOND;
    }

    function getCase(bytes32 caseId) external view returns (Case memory) {
        return _cases[caseId];
    }

    function lossCount(address provider) external view returns (uint256) {
        return _losses[provider].length;
    }

    function lossAt(address provider, uint256 index) external view returns (LossRecord memory) {
        return _losses[provider][index];
    }

    // --- Internals ---

    function _finalize(bytes32 caseId, Case storage c) private {
        c.status = Status.FINALIZED;
        c.finalizedAt = uint64(block.timestamp);
        _releaseExposure(c);

        // A failed challenge pays the party favored by the ruling, never us.
        uint64 bond = c.challengeBond;
        c.challengeBond = 0;
        if (bond != 0) {
            challengeBonds -= bond;
            address wronged = c.ruling == Ruling.PAY ? c.provider : c.payer;
            USDC.safeTransfer(wronged, bond);
        }
        if (c.ruling == Ruling.REFUND) _recordLoss(caseId, c);
        emit RulingFinalized(caseId, c.ruling, c.finalizedAt);
    }

    function _overturn(bytes32 caseId, Case storage c) private {
        c.status = Status.OVERTURNED;
        c.finalizedAt = uint64(block.timestamp);
        _releaseExposure(c);

        address wronged = c.ruling == Ruling.PAY ? c.payer : c.provider;
        Ruling finalRuling = c.ruling == Ruling.PAY ? Ruling.REFUND : Ruling.PAY;

        // Pay the wronged party from the operator bond (cap <= bond/2).
        uint256 remaining = operatorBond;
        uint256 payout = c.value;
        if (payout > remaining) payout = remaining;
        remaining -= payout;
        if (payout != 0) USDC.safeTransfer(wronged, payout);

        // Refund the case fee to the marketplace.
        if (!c.feeRefunded && remaining >= FEE) {
            c.feeRefunded = true;
            remaining -= FEE;
            USDC.safeTransfer(c.feePayer, FEE);
            emit FeeRefunded(caseId, c.feePayer, FEE);
        }

        // Return the challenger's bond and pay a watcher bounty from the bond.
        uint64 bond = c.challengeBond;
        c.challengeBond = 0;
        if (bond != 0) {
            challengeBonds -= bond;
            USDC.safeTransfer(c.challenger, bond);
        }
        if (c.challenger != address(0) && c.challenger != wronged) {
            uint256 bounty = challengeBondFor(c.value);
            if (bounty > remaining) bounty = remaining;
            if (bounty != 0) {
                remaining -= bounty;
                USDC.safeTransfer(c.challenger, bounty);
            }
        }
        operatorBond = remaining;

        if (finalRuling == Ruling.REFUND) _recordLoss(caseId, c);
        emit RulingOverturned(caseId, finalRuling, c.finalizedAt);
    }

    function _releaseExposure(Case storage c) private {
        liveExposure -= c.value;
        liveCases -= 1;
    }

    function _recordLoss(bytes32 caseId, Case storage c) private {
        LossRecord memory record = LossRecord({
            caseId: caseId,
            provider: c.provider,
            agentId: c.agentId,
            value: c.value,
            finalizedAt: c.finalizedAt,
            evidenceHash: c.evidenceHash
        });
        _losses[c.provider].push(record);
        emit LossRecorded(caseId, c.provider, c.agentId, c.value, c.evidenceHash);
    }
}
