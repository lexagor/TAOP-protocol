// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IEscalationOracle} from "./interfaces/IEscalationOracle.sol";

interface IRulingOracleResolution {
    function resolveEscalation(bytes32 requestId, bool rulingUpheld) external;
}

/**
 * @title ReviewerPanelAdapter
 * @notice Phase-0 appeal layer for RulingOracle: three named reviewers, any two
 *         of whom can sign the outcome with EIP-712. There is no token vote and
 *         no reviewer bond in Phase 0; the operator bond is the economic
 *         backstop. If two signatures do not arrive within 24 hours, anyone can
 *         time the request out and the challenge succeeds by default.
 *
 *         This is intentionally a trusted/named panel, not a trustless court.
 *         UMA OOv3 belongs to the Phase-1 $2K+ tier.
 */
contract ReviewerPanelAdapter is IEscalationOracle, EIP712, Ownable2Step, ReentrancyGuard {
    uint256 public constant REVIEWER_COUNT = 3;
    uint256 public constant REQUIRED_SIGNATURES = 2;
    uint256 public constant RESOLUTION_WINDOW = 24 hours;

    // solhint-disable gas-small-strings
    bytes32 public constant REVIEW_TYPEHASH =
        keccak256("Review(bytes32 requestId,bytes32 caseId,bytes32 evidenceHash,bool upheld)");
    // solhint-enable gas-small-strings

    struct Request {
        bytes32 caseId;
        uint8 ruling;
        bytes32 evidenceHash;
        address[REVIEWER_COUNT] reviewers;
        uint64 deadline;
        bool resolved;
        bool upheld;
    }

    address public oracle;
    address[REVIEWER_COUNT] private _reviewers;
    uint256 private _nonce;

    mapping(bytes32 => Request) private _requests;

    event OracleUpdated(address indexed oracle);
    event ReviewersUpdated(address[REVIEWER_COUNT] reviewers);
    event Escalated(
        bytes32 indexed requestId,
        bytes32 indexed caseId,
        uint8 ruling,
        bytes32 evidenceHash,
        uint64 deadline
    );
    event ReviewResolved(
        bytes32 indexed requestId, bool upheld, address indexed signerA, address indexed signerB
    );
    event ReviewTimedOut(bytes32 indexed requestId);

    error NotOracle();
    error ZeroAddress();
    error OracleAlreadySet();
    error InvalidReviewers();
    error ReviewersNotSet();
    error RequestNotFound();
    error RequestResolved();
    error ResolutionWindowClosed();
    error ResolutionWindowOpen();
    error InvalidSignatures();

    constructor(address owner_) EIP712("RulingOracleReviewerPanel", "1") Ownable(owner_) {}

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    function setOracle(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        if (oracle != address(0)) revert OracleAlreadySet();
        oracle = next;
        emit OracleUpdated(next);
    }

    function setReviewers(address[REVIEWER_COUNT] calldata next) external onlyOwner {
        _validateReviewers(next);
        _reviewers = next;
        emit ReviewersUpdated(next);
    }

    function reviewers() external view returns (address[REVIEWER_COUNT] memory) {
        return _reviewers;
    }

    function getRequest(bytes32 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    /// @notice EIP-712 digest a reviewer signs. Exposed for wallet/UI clients.
    function reviewDigest(bytes32 requestId, bool upheld) external view returns (bytes32) {
        Request storage r = _requests[requestId];
        return _digest(requestId, r.caseId, r.evidenceHash, upheld);
    }

    /// @inheritdoc IEscalationOracle
    function escalate(bytes32 caseId, uint8 ruling, bytes32 evidenceHash)
        external
        override
        onlyOracle
        returns (bytes32 requestId)
    {
        if (_reviewers[0] == address(0)) revert ReviewersNotSet();
        requestId = keccak256(
            abi.encode(caseId, ruling, evidenceHash, _nonce, address(this), block.chainid)
        );
        _nonce += 1;

        Request storage r = _requests[requestId];
        r.caseId = caseId;
        r.ruling = ruling;
        r.evidenceHash = evidenceHash;
        r.reviewers = _reviewers;
        r.deadline = uint64(block.timestamp + RESOLUTION_WINDOW);

        emit Escalated(requestId, caseId, ruling, evidenceHash, r.deadline);
    }

    /// @notice Submit two distinct reviewer signatures for the same outcome.
    function resolve(bytes32 requestId, bool upheld, bytes[] calldata signatures)
        external
        nonReentrant
    {
        Request storage r = _requests[requestId];
        if (r.caseId == bytes32(0)) revert RequestNotFound();
        if (r.resolved) revert RequestResolved();
        if (block.timestamp > r.deadline) revert ResolutionWindowClosed();
        if (signatures.length != REQUIRED_SIGNATURES) revert InvalidSignatures();

        bytes32 digest = _digest(requestId, r.caseId, r.evidenceHash, upheld);
        address signerA = ECDSA.recover(digest, signatures[0]);
        address signerB = ECDSA.recover(digest, signatures[1]);
        if (signerA == signerB) revert InvalidSignatures();
        if (!_isReviewer(r, signerA) || !_isReviewer(r, signerB)) revert InvalidSignatures();

        r.resolved = true;
        r.upheld = upheld;
        emit ReviewResolved(requestId, upheld, signerA, signerB);
        IRulingOracleResolution(oracle).resolveEscalation(requestId, upheld);
    }

    /// @notice After the 24h window, anyone can make the challenge succeed.
    function timeout(bytes32 requestId) external nonReentrant {
        Request storage r = _requests[requestId];
        if (r.caseId == bytes32(0)) revert RequestNotFound();
        if (r.resolved) revert RequestResolved();
        if (block.timestamp <= r.deadline) revert ResolutionWindowOpen();

        r.resolved = true;
        r.upheld = false;
        emit ReviewTimedOut(requestId);
        IRulingOracleResolution(oracle).resolveEscalation(requestId, false);
    }

    function _digest(bytes32 requestId, bytes32 caseId, bytes32 evidenceHash, bool upheld)
        private
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(REVIEW_TYPEHASH, requestId, caseId, evidenceHash, upheld))
        );
    }

    function _isReviewer(Request storage r, address signer) private view returns (bool) {
        for (uint256 i = 0; i < REVIEWER_COUNT; i++) {
            if (r.reviewers[i] == signer) return true;
        }
        return false;
    }

    function _validateReviewers(address[REVIEWER_COUNT] calldata next) private pure {
        for (uint256 i = 0; i < REVIEWER_COUNT; i++) {
            if (next[i] == address(0)) revert InvalidReviewers();
            for (uint256 j = i + 1; j < REVIEWER_COUNT; j++) {
                if (next[i] == next[j]) revert InvalidReviewers();
            }
        }
    }
}
