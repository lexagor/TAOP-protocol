// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
// Kept so Hardhat/Foundry emit the Timelock artifact used by tests/deploy.
// solhint-disable-next-line no-unused-import
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
contract ReputationOracleNetwork is ReentrancyGuard, Ownable2Step, Pausable {
    /// @notice ETH bond required to challenge a completion.
    uint256 public constant CHALLENGE_BOND = 0.01 ether;

    /// @notice Maximum byte length of any URI field stored on-chain (result,
    ///         receipt, evidence, rebuttal, profile metadata).
    uint256 public constant MAX_URI_LEN = 200;

    /// @notice Time an agent has to contest a challenge before it can be
    ///         finalized optimistically in the challenger's favour.
    uint256 public constant CHALLENGE_WINDOW = 3 days;

    /// @notice After this long, a challenger can reclaim its bond when a pending
    ///         challenge is never resolved (e.g. a contested challenge the owner
    ///         never ruled on). Liveness guard: no bond is locked forever.
    uint256 public constant CHALLENGE_TIMEOUT = 90 days;

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

    // --- v0.3 sybil-resistance ---
    /// @notice Per-(agent, counterparty) confirmation count. Bounded diversity so a
    ///         self-dealing pair contributes at most one distinct counterparty.
    mapping(address => mapping(address => uint64)) public counterpartyConfirmations;
    /// @notice Number of distinct counterparties that have confirmed this agent.
    mapping(address => uint64) public distinctCounterparties;
    /// @notice Minimum seconds between `attestCompletion` calls from one address
    ///         (0 = disabled). Owner/Timelock-settable; set for mainnet.
    uint64 public attestCooldown;
    /// @notice Last attestation timestamp per address (cooldown enforcement).
    mapping(address => uint64) public lastAttestation;

    event SelfAttested(uint256 completionId, address indexed agent, bytes32 taskType);
    event ReceiptAttested(uint256 completionId, address indexed agent, address indexed counterparty);
    event ReceiptRevoked(uint256 completionId, address indexed counterparty);
    event ChallengeSubmitted(uint256 completionId, address indexed challenger);
    event ChallengeContested(uint256 completionId, address indexed agent, string rebuttalCID);
    event ChallengeResolved(uint256 completionId, bool upheld);
    event ChallengeCancelled(uint256 completionId, address indexed challenger);
    event EthPoolWithdrawn(address indexed to, uint256 amount);
    event AttestCooldownChanged(uint64 cooldown);

    error NoSuchCompletion();
    error AlreadyChallenged();
    error WrongChallengeBond(uint256 sent, uint256 required);
    error ChallengeNotPending();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error ChallengeAlreadyContested();
    error ChallengeNotTimedOut(uint64 readyAt);
    error NotChallenger();
    error URITooLong(uint256 length);
    error NotAgent();
    error ReceiptNotAllowed();
    error AlreadyReceipted();
    error NotCounterparty();
    error NothingToWithdraw();
    error ZeroAddress();
    error CooldownActive(uint64 readyAt);

    constructor() Ownable(msg.sender) {}

    // --- v0.3 pause (circuit breaker) ---
    // Pauses state-changing protocol actions only. Owner withdrawals and
    // user exits (`revokeReceipt`, `withdrawEthPool`) are NEVER paused so funds
    // can always be recovered.

    /// @notice Pause protocol actions (owner/Timelock).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause protocol actions (owner/Timelock).
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set the per-address attestation cooldown in seconds (0 = off).
    function setAttestCooldown(uint64 cooldown) external onlyOwner {
        attestCooldown = cooldown;
        emit AttestCooldownChanged(cooldown);
    }

    /// @notice An agent self-attests a completed task. Returns the new
    ///         completionId (unique per attestation, so each can be challenged).
    function attestCompletion(bytes32 taskType, string calldata resultCID_)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 completionId)
    {
        _requireUri(resultCID_);
        if (attestCooldown != 0) {
            uint64 readyAt = lastAttestation[msg.sender] + attestCooldown;
            if (block.timestamp < readyAt) revert CooldownActive(readyAt);
        }
        lastAttestation[msg.sender] = uint64(block.timestamp);
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
    function attestReceipt(uint256 completionId, string calldata receiptCID_) external whenNotPaused {
        _requireUri(receiptCID_);
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
        // v0.3: track diversity (a self-dealing pair contributes one counterparty).
        if (counterpartyConfirmations[c.agent][msg.sender] == 0) {
            distinctCounterparties[c.agent] += 1;
        }
        counterpartyConfirmations[c.agent][msg.sender] += 1;
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
        _decrementCounterparty(c.agent, msg.sender);
        emit ReceiptRevoked(completionId, msg.sender);
    }

    /// @dev Decrement per-counterparty confirmations and the distinct count when a
    ///      counterparty's last confirmation is removed.
    function _decrementCounterparty(address agent, address counterparty) private {
        uint64 n = counterpartyConfirmations[agent][counterparty];
        if (n <= 1) {
            delete counterpartyConfirmations[agent][counterparty];
            if (n == 1 && distinctCounterparties[agent] > 0) {
                distinctCounterparties[agent] -= 1;
            }
        } else {
            counterpartyConfirmations[agent][counterparty] = n - 1;
        }
    }

    /// @notice Anyone can challenge a completion by posting CHALLENGE_BOND in ETH.
    ///         The agent then has CHALLENGE_WINDOW to contest; otherwise the
    ///         challenge can be finalized optimistically. The bond is refunded if
    ///         the challenge is upheld, forfeited to the protocol pool if not.
    function challengeCompletion(uint256 completionId, string calldata evidenceCID) external payable nonReentrant whenNotPaused {
        _requireUri(evidenceCID);
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
    function contestChallenge(uint256 completionId, string calldata rebuttalCID_) external whenNotPaused {
        _requireUri(rebuttalCID_);
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
    function finalizeChallenge(uint256 completionId) external nonReentrant whenNotPaused {
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
    function resolveChallenge(uint256 completionId, bool upheld) external nonReentrant onlyOwner {
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

    /// @notice Liveness exit: after CHALLENGE_TIMEOUT with no resolution (for
    ///         example a contested challenge the owner never ruled on), the
    ///         challenger — and only the challenger — reclaims the bond. The
    ///         completion stays challenged so it cannot be re-challenged and no
    ///         dispute is recorded. Never pausable: bonds can always exit.
    function cancelChallenge(uint256 completionId) external nonReentrant {
        Completion storage c = completions[completionId];
        Challenge storage ch = challenges[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (!c.challenged || ch.resolved) revert ChallengeNotPending();
        if (msg.sender != ch.challenger) revert NotChallenger();
        uint64 readyAt = ch.timestamp + uint64(CHALLENGE_TIMEOUT);
        if (block.timestamp < readyAt) revert ChallengeNotTimedOut(readyAt);

        ch.resolved = true;
        (bool ok, ) = payable(ch.challenger).call{value: CHALLENGE_BOND}("");
        require(ok, "refund failed");
        emit ChallengeCancelled(completionId, ch.challenger);
    }

    /// @dev Upholds a pending challenge: marks the completion disputed, refunds
    ///      the challenger, and invalidates a receipt if one existed so a
    ///      fraudulent completion cannot stay receipt-confirmed.
    function _uphold(Completion storage c, Challenge storage ch, uint256 completionId) private {
        ch.resolved = true;
        c.disputed = true;
        disputeCount[c.agent] += 1;
        if (c.counterparty != address(0)) {
            address cp = c.counterparty;
            delete receiptCID[completionId];
            c.counterparty = address(0);
            c.receiptTimestamp = 0;
            confirmedCount[c.agent] -= 1;
            _decrementCounterparty(c.agent, cp);
        }
        (bool ok, ) = payable(ch.challenger).call{value: CHALLENGE_BOND}("");
        require(ok, "refund failed");
    }

    /// @notice Owner withdraws forfeited challenger bonds.
    function withdrawEthPool(address payable to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
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
    /// @notice Basis-point denominator (100% = 10_000).
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @dev Single source of truth for the decay curve (shared by both scores).
    function _decayedScore(uint64 count, uint64 disputes, uint64 lastAct)
        private
        view
        returns (uint64 score, uint16 decayBps)
    {
        decayBps = BPS_DENOMINATOR;
        uint256 net = count > disputes ? uint256(count - disputes) : 0;
        if (lastAct > 0 && net > 0) {
            uint256 elapsed = block.timestamp - lastAct;
            if (elapsed > DECAY_GRACE) {
                uint256 decayed = elapsed - DECAY_GRACE;
                if (decayed >= DECAY_HORIZON) {
                    decayBps = 0;
                } else {
                    decayBps = uint16(((DECAY_HORIZON - decayed) * BPS_DENOMINATOR) / DECAY_HORIZON);
                }
            }
            net = (net * decayBps) / BPS_DENOMINATOR;
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

    /// @notice v0.3 credit score: diversity-adjusted ranking signal. Counts
    ///         DISTINCT counterparties (not raw confirmations) minus disputes,
    ///         with the same inactivity decay — so a self-dealing pair contributes
    ///         at most one, while independent requesters each add one. Raw volume
    ///         remains available via `getTwoSidedScore`.
    function getCreditScore(address agent)
        external
        view
        returns (
            uint64 distinctCounterparties_,
            uint64 disputeCount_,
            uint64 score,
            uint64 lastActivity_,
            uint16 decayBps
        )
    {
        distinctCounterparties_ = distinctCounterparties[agent];
        disputeCount_ = disputeCount[agent];
        lastActivity_ = lastActivity[agent];
        (score, decayBps) = _decayedScore(distinctCounterparties_, disputeCount_, lastActivity_);
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
        _requireUri(metadataCID);
        agentMetadataCID[msg.sender] = metadataCID;
        emit AgentRegistered(msg.sender, metadataCID);
    }

    function getAgentMetadata(address agent) external view returns (string memory) {
        return agentMetadataCID[agent];
    }

    /// @dev Bound on-chain URI storage: long strings cost gas for everyone and
    ///      have no legitimate use here (IPFS CIDs are ~60 bytes).
    function _requireUri(string calldata uri) private pure {
        if (bytes(uri).length > MAX_URI_LEN) revert URITooLong(bytes(uri).length);
    }
}
