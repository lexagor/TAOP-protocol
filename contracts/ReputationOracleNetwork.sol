// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReputationOracleNetwork
 * @notice The TAOP Credit Bureau contract (v1, ETH-only).
 *
 *   Agents self-attest completions via `attestCompletion`. Anyone can post a
 *   CHALLENGE_BOND (in ETH) to flag fraud via `challengeCompletion`. The owner
 *   resolves disputes via `resolveChallenge`. The public score is
 *   `completions - disputes`. No trusted validator set, no protocol token.
 *
 *   v2 may introduce a validator set + protocol-fee hooks; that design is
 *   documented in TRD.md Appendix but is NOT in this v1 bytecode.
 */
contract ReputationOracleNetwork is ReentrancyGuard, Ownable {
    /// @notice ETH bond required to challenge a completion.
    uint256 public constant CHALLENGE_BOND = 0.01 ether;

    /// @notice A self-attested completion record.
    struct Completion {
        address agent;
        bytes32 taskType; // e.g., keccak256("summarization")
        string resultCID; // IPFS CID of the task result/evidence
        uint64 timestamp;
        bool challenged;
        bool disputed; // true if a challenge was upheld
    }

    /// @notice A fraud challenge against a completion.
    struct Challenge {
        address challenger;
        string evidenceCID;
        uint64 timestamp;
        bool resolved;
    }

    mapping(uint256 => Completion) public completions;
    mapping(uint256 => Challenge) public challenges;
    uint256 public nextCompletionId; // first id is 1
    mapping(address => uint64) public completionCount;
    mapping(address => uint64) public disputeCount;
    uint256 public slashedEthPool; // forfeited challenger bonds, owner-withdrawable

    event SelfAttested(uint256 completionId, address agent, bytes32 taskType);
    event ChallengeSubmitted(uint256 completionId, address challenger);
    event ChallengeResolved(uint256 completionId, bool upheld);
    event EthPoolWithdrawn(address to, uint256 amount);

    error NoSuchCompletion();
    error AlreadyChallenged();
    error WrongChallengeBond(uint256 sent, uint256 required);
    error ChallengeNotPending();
    error NothingToWithdraw();

    constructor() Ownable(msg.sender) {}

    /// @notice An agent self-attests a completed task. Returns the new
    ///         completionId (unique per attestation, so each can be challenged).
    function attestCompletion(bytes32 taskType, string calldata resultCID)
        external
        nonReentrant
        returns (uint256 completionId)
    {
        completionId = ++nextCompletionId;
        completions[completionId] = Completion({
            agent: msg.sender,
            taskType: taskType,
            resultCID: resultCID,
            timestamp: uint64(block.timestamp),
            challenged: false,
            disputed: false
        });
        completionCount[msg.sender] += 1;
        emit SelfAttested(completionId, msg.sender, taskType);
    }

    /// @notice Anyone can challenge a completion by posting CHALLENGE_BOND in ETH.
    ///         The bond is refunded if the challenge is upheld; forfeited if not.
    function challengeCompletion(uint256 completionId, string calldata evidenceCID)
        external
        payable
        nonReentrant
    {
        Completion storage c = completions[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (c.challenged) revert AlreadyChallenged();
        if (msg.value != CHALLENGE_BOND) revert WrongChallengeBond(msg.value, CHALLENGE_BOND);
        c.challenged = true;
        challenges[completionId] = Challenge({
            challenger: msg.sender,
            evidenceCID: evidenceCID,
            timestamp: uint64(block.timestamp),
            resolved: false
        });
        emit ChallengeSubmitted(completionId, msg.sender);
    }

    /// @notice Owner resolves a challenge. upheld = true -> the completion was
    ///         fraudulent: disputeCount[agent]++, challenger refunded. upheld =
    ///         false -> challenger loses the bond to the protocol pool.
    function resolveChallenge(uint256 completionId, bool upheld) external onlyOwner nonReentrant {
        Completion storage c = completions[completionId];
        Challenge storage ch = challenges[completionId];
        if (c.agent == address(0)) revert NoSuchCompletion();
        if (!c.challenged || ch.resolved) revert ChallengeNotPending();
        ch.resolved = true;
        if (upheld) {
            c.disputed = true;
            disputeCount[c.agent] += 1;
            (bool ok, ) = payable(ch.challenger).call{value: CHALLENGE_BOND}("");
            require(ok, "refund failed");
        } else {
            slashedEthPool += CHALLENGE_BOND;
        }
        emit ChallengeResolved(completionId, upheld);
    }

    /// @notice Owner withdraws forfeited challenger bonds.
    function withdrawEthPool(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > slashedEthPool) revert NothingToWithdraw();
        slashedEthPool -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit EthPoolWithdrawn(to, amount);
    }

    /// @notice v1 score = completions - disputes for `agent`.
    function getSelfAttestScore(address agent)
        external
        view
        returns (uint64 completionCount_, uint64 disputeCount_, uint64 score)
    {
        completionCount_ = completionCount[agent];
        disputeCount_ = disputeCount[agent];
        score = completionCount_ > disputeCount_ ? completionCount_ - disputeCount_ : 0;
    }

    function getCompletion(uint256 completionId) external view returns (Completion memory) {
        if (completions[completionId].agent == address(0)) revert NoSuchCompletion();
        return completions[completionId];
    }
}