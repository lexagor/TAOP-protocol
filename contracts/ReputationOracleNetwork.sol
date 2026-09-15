// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol"; // ensure artifact is available for deploys/tests

/**
 * @title ReputationOracleNetwork
 * @notice The TAOP Credit Bureau contract (v0.2, ETH-only).
 *
 *   v0.1 was "an agent grades its own homework": `attestCompletion` was a pure
 *   self-report and the score counted self-reports. v0.2 adds a **two-sided**
 *   signal and makes dispute resolution **optimistic**:
 *
 *   - `attestCompletion`  — an agent records a completion (self-report, as before).
 *   - `attestReceipt`     — an *independent* counterparty (requester) countersigns
 *                           that completion. Only then does it count as confirmed.
 *   - `revokeReceipt`     — the counterparty may withdraw an endorsement.
 *   - `challengeCompletion` + a CHALLENGE_WINDOW. The agent may `contestChallenge`
 *                           within the window; if it does not, anyone may
 *                           `finalizeChallenge` and the challenge is upheld
 *                           optimistically. Contested challenges fall back to
 *                           the owner (via Timelock) in `resolveChallenge`.
 *
 *   Two scores are exposed: `getSelfAttestScore` (legacy, self-reports) and
 *   `getTwoSidedScore` (receipt-confirmed). Consumers that want a credible
 *   "credit bureau" signal should rank on the two-sided score.
 *
 *   v2 may add a validator set + protocol-fee hooks; that design is documented
 *   in TRD.md Appendix but is NOT in this bytecode.
 */
contract ReputationOracleNetwork is ReentrancyGuard, Ownable {
    /// @notice ETH bond required to challenge a completion.
    uint256 public constant CHALLENGE_BOND = 0.01 ether;

    /// @notice Time an agent has to contest a challenge before it can be
    ///         finalized optimistically in the challenger's favour.
    uint256 public constant CHALLENGE_WINDOW = 3 days;

    /// @notice A completion record (self-attested, optionally countersigned).
    struct Completion {
        address agent;
        bytes32 taskType; // e.g., keccak256("summarization")
        string resultCID; // IPFS CID of the task result/evidence
        uint64 timestamp;
        bool challenged;
        bool disputed; // true if a challenge was upheld
        address counterparty; // v0.2: independent requester who countersigned
        uint64 receiptTimestamp; // v0.2: when the receipt was given
    }

    /// @notice A fraud challenge against a completion.
    struct Challenge {
        address challenger;
        string evidenceCID;
        uint64 timestamp;
        bool resolved;
        uint64 deadline; // v0.2: end of the agent's contest window
        bool contested; // v0.2: agent submitted a rebuttal
        string rebuttalCID; // v0.2: agent's counter-evidence
    }

    mapping(uint256 => Completion) public completions;
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => string) public receiptCID; // v0.2: counterparty evidence
    uint256 public nextCompletionId; // first id is 1
    mapping(address => uint64) public completionCount; // self-attested
    mapping(address => uint64) public confirmedCount; // v0.2: receipt-confirmed
    mapping(address => uint64) public disputeCount;
    mapping(address => uint64) public lastActivity; // for score decay
    uint256 public slashedEthPool; // forfeited challenger bonds, owner-withdrawable

    event SelfAttested(uint256 completionId, address agent, bytes32 taskType);
    event ReceiptAttested(uint256 completionId, address indexed agent, address indexed counterparty);
    event ReceiptRevoked(uint256 completionId, address indexed counterparty);
    event ChallengeSubmitted(uint256 completionId, address challenger);
    event ChallengeContested(uint256 completionId, address indexed agent, string rebuttalCID);
    event ChallengeResolved(uint256 completionId, bool upheld);
    event EthPoolWithdrawn(address to, uint256 amount);

    error NoSuchCompletion();
    error AlreadyChallenged();
    error WrongChallengeBond(uint256 sent, uint256 required);
    error ChallengeNotPending();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error ChallengeAlreadyContested();
    error NotAgent();
    error ReceiptNotAllowed();
    error AlreadyReceipted();
    error NotCounterparty();
    error NothingToWithdraw();

    constructor() Ownable(msg.sender) {}

    /// @notice An agent self-attests a completed task. Returns the new
    ///         completionId (unique per attestation, so each can be challenged).
    function attestCompletion(bytes32 taskType, string calldata resultCID_)
        external
        nonReentrant
        returns (uint256 completionId)
    {
        completionId = ++nextCompletionId;
        completions[completionId] = Completion({
            agent: msg.sender,
            taskType: taskType,
            resultCID: resultCID_,
            timestamp: uint64(block.timestamp),
            challenged: false,
            disputed: false,
            counterparty: address(0),
            receiptTimestamp: 0
        });
        completionCount[msg.sender] += 1;
        lastActivity[msg.sender] = uint64(block.timestamp);
        emit SelfAttested(completionId, msg.sender, taskType);
    }

    /// @notice v0.2: an independent counterparty countersigns a completion.
    ///         This is what turns a self-report into a two-sided attestation.
    ///         One receipt per completion; the agent cannot receipt itself, and a
    ///         completion under a pending challenge or already disputed cannot be
    ///         confirmed.
    function attestReceipt(uint256 completionId, string calldata receiptCID_) external {
        Completion storage c = completions[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (msg.sender == c.agent) revert ReceiptNotAllowed();
        if (c.counterparty != address(0)) revert AlreadyReceipted();
        if (c.disputed) revert ReceiptNotAllowed();
        if (c.challenged && !challenges[completionId].resolved) revert ReceiptNotAllowed();

        c.counterparty = msg.sender;
        c.receiptTimestamp = uint64(block.timestamp);
        receiptCID[completionId] = receiptCID_;
        confirmedCount[c.agent] += 1;
        lastActivity[c.agent] = uint64(block.timestamp);
        emit ReceiptAttested(completionId, c.agent, msg.sender);
    }

    /// @notice v0.2: the counterparty withdraws their endorsement.
    function revokeReceipt(uint256 completionId) external {
        Completion storage c = completions[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (c.counterparty != msg.sender) revert NotCounterparty();
        if (c.disputed) revert ReceiptNotAllowed();

        c.counterparty = address(0);
        c.receiptTimestamp = 0;
        delete receiptCID[completionId];
        confirmedCount[c.agent] -= 1;
        emit ReceiptRevoked(completionId, msg.sender);
    }

    /// @notice Anyone can challenge a completion by posting CHALLENGE_BOND in ETH.
    ///         The agent then has CHALLENGE_WINDOW to contest; otherwise the
    ///         challenge can be finalized optimistically. The bond is refunded if
    ///         the challenge is upheld, forfeited to the protocol pool if not.
    function challengeCompletion(uint256 completionId, string calldata evidenceCID) external payable nonReentrant {
        Completion storage c = completions[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (c.challenged) revert AlreadyChallenged();
        if (msg.value != CHALLENGE_BOND) revert WrongChallengeBond(msg.value, CHALLENGE_BOND);
        c.challenged = true;
        challenges[completionId] = Challenge({
            challenger: msg.sender,
            evidenceCID: evidenceCID,
            timestamp: uint64(block.timestamp),
            resolved: false,
            deadline: uint64(block.timestamp + CHALLENGE_WINDOW),
            contested: false,
            rebuttalCID: ""
        });
        emit ChallengeSubmitted(completionId, msg.sender);
    }

    /// @notice v0.2: the agent (and only the agent) rebuts a challenge within the
    ///         window with counter-evidence. A contested challenge must be
    ///         resolved by the owner; it can no longer be finalized optimistically.
    function contestChallenge(uint256 completionId, string calldata rebuttalCID_) external {
        Completion storage c = completions[completionId];
        Challenge storage ch = challenges[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (c.agent != msg.sender) revert NotAgent();
        if (!c.challenged || ch.resolved) revert ChallengeNotPending();
        if (ch.contested) revert ChallengeAlreadyContested();
        if (block.timestamp > ch.deadline) revert ChallengeWindowClosed();

        ch.contested = true;
        ch.rebuttalCID = rebuttalCID_;
        emit ChallengeContested(completionId, msg.sender, rebuttalCID_);
    }

    /// @notice v0.2: anyone can finalize an uncontested challenge once the window
    ///         has closed. The challenge is upheld optimistically (the agent had
    ///         its chance to respond and did not).
    function finalizeChallenge(uint256 completionId) external nonReentrant {
        Completion storage c = completions[completionId];
        Challenge storage ch = challenges[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (!c.challenged || ch.resolved) revert ChallengeNotPending();
        if (ch.contested) revert ChallengeAlreadyContested();
        if (block.timestamp < ch.deadline) revert ChallengeWindowOpen();

        _uphold(c, ch, completionId);
        emit ChallengeResolved(completionId, true);
    }

    /// @notice Owner resolves a challenge (via Timelock). Used for contested
    ///         challenges and as a backstop for any pending challenge.
    ///         upheld = true -> the completion was fraudulent: disputeCount[agent]++,
    ///         any receipt is invalidated, challenger refunded. upheld = false ->
    ///         challenger loses the bond to the protocol pool.
    function resolveChallenge(uint256 completionId, bool upheld) external onlyOwner nonReentrant {
        Completion storage c = completions[completionId];
        Challenge storage ch = challenges[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (!c.challenged || ch.resolved) revert ChallengeNotPending();

        if (upheld) {
            _uphold(c, ch, completionId);
        } else {
            ch.resolved = true;
            slashedEthPool += CHALLENGE_BOND;
        }
        emit ChallengeResolved(completionId, upheld);
    }

    /// @dev Upholds a pending challenge: marks the completion disputed, refunds
    ///      the challenger, and invalidates a receipt if one existed so a
    ///      fraudulent completion cannot stay receipt-confirmed.
    function _uphold(Completion storage c, Challenge storage ch, uint256 completionId) private {
        ch.resolved = true;
        c.disputed = true;
        disputeCount[c.agent] += 1;
        if (c.counterparty != address(0)) {
            delete receiptCID[completionId];
            c.counterparty = address(0);
            c.receiptTimestamp = 0;
            confirmedCount[c.agent] -= 1;
        }
        (bool ok, ) = payable(ch.challenger).call{value: CHALLENGE_BOND}("");
        require(ok, "refund failed");
    }

    /// @notice Owner withdraws forfeited challenger bonds.
    function withdrawEthPool(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > slashedEthPool) revert NothingToWithdraw();
        slashedEthPool -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit EthPoolWithdrawn(to, amount);
    }

    // --- Inactivity decay (v0.1.2 semantics) ---

    /// @notice Scores are untouched for this long after the last positive activity.
    uint256 public constant DECAY_GRACE = 30 days;
    /// @notice After the grace period the score decays linearly to zero over this window.
    uint256 public constant DECAY_HORIZON = 150 days;

    /// @dev Single source of truth for the decay curve (shared by both scores).
    function _decayedScore(uint64 count, uint64 disputes, uint64 lastAct)
        private
        view
        returns (uint64 score, uint16 decayBps)
    {
        decayBps = 10000;
        uint256 net = count > disputes ? uint256(count - disputes) : 0;
        if (lastAct > 0 && net > 0) {
            uint256 elapsed = block.timestamp - lastAct;
            if (elapsed > DECAY_GRACE) {
                uint256 decayed = elapsed - DECAY_GRACE;
                if (decayed >= DECAY_HORIZON) {
                    decayBps = 0;
                } else {
                    decayBps = uint16(((DECAY_HORIZON - decayed) * 10000) / DECAY_HORIZON);
                }
            }
            net = (net * decayBps) / 10000;
        }
        score = uint64(net);
    }

    // --- v1 score (self-attest, backwards compatible) ---

    /// @notice Legacy score = self-attested completions - disputes, with inactivity
    ///         decay. Prefer `getTwoSidedScore` for a credible signal.
    function getSelfAttestScore(address agent)
        external
        view
        returns (uint64 completionCount_, uint64 disputeCount_, uint64 score)
    {
        (completionCount_, disputeCount_, score, , ) = getScoreDetails(agent);
    }

    /// @notice Full self-attest score view including decay inputs, for UIs/indexers.
    function getScoreDetails(address agent)
        public
        view
        returns (
            uint64 completionCount_,
            uint64 disputeCount_,
            uint64 score,
            uint64 lastActivity_,
            uint16 decayBps
        )
    {
        completionCount_ = completionCount[agent];
        disputeCount_ = disputeCount[agent];
        lastActivity_ = lastActivity[agent];
        (score, decayBps) = _decayedScore(completionCount_, disputeCount_, lastActivity_);
    }

    /// @notice v0.2: two-sided score = receipt-confirmed completions - disputes,
    ///         with the same inactivity decay. This is the score to rank on.
    function getTwoSidedScore(address agent)
        external
        view
        returns (
            uint64 confirmedCount_,
            uint64 disputeCount_,
            uint64 score,
            uint64 lastActivity_,
            uint16 decayBps
        )
    {
        confirmedCount_ = confirmedCount[agent];
        disputeCount_ = disputeCount[agent];
        lastActivity_ = lastActivity[agent];
        (score, decayBps) = _decayedScore(confirmedCount_, disputeCount_, lastActivity_);
    }

    function getCompletion(uint256 completionId) external view returns (Completion memory) {
        if (completions[completionId].agent == address(0)) revert NoSuchCompletion();
        return completions[completionId];
    }

    // --- Basic Agent Identity (Step 7) ---

    mapping(address => string) public agentMetadataCID;

    event AgentRegistered(address indexed agent, string metadataCID);

    /// @notice Register or update basic on-chain identity metadata for the caller
    ///         (e.g. IPFS CID pointing to JSON with name, description, avatar, links).
    ///         This is self-sovereign and optional. Future versions may add verification.
    function registerAgent(string calldata metadataCID) external {
        agentMetadataCID[msg.sender] = metadataCID;
        emit AgentRegistered(msg.sender, metadataCID);
    }

    function getAgentMetadata(address agent) external view returns (string memory) {
        return agentMetadataCID[agent];
    }
}
