// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReputationOracleNetwork} from "../../contracts/ReputationOracleNetwork.sol";

/// @notice Property tests for ReputationOracleNetwork: ETH conservation, receipt
///         consistency, and score bounds across the full two-sided lifecycle.
contract RONHandler is Test {
    ReputationOracleNetwork public ron;
    address public owner;

    address[] public agents;
    uint256[] public ids;

    uint256 public pending; // unresolved challenges (each holds one CHALLENGE_BOND)
    uint256 public ghost_challenges;

    constructor(ReputationOracleNetwork _ron, address _owner) {
        ron = _ron;
        owner = _owner;
        agents.push(address(0xA11CE));
        agents.push(address(0xB0B));
        agents.push(address(0xC0FFEE));
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function agentCount() external view returns (uint256) {
        return agents.length;
    }

    /// @dev Public struct-mapping getters return tuples; destructure here.
    function _challenge(uint256 id) internal view returns (bool resolved, uint64 deadline, bool contested) {
        (, , , resolved, deadline, contested, ) = ron.challenges(id);
    }

    function attest(uint256 seed) external {
        address a = agents[seed % agents.length];
        vm.prank(a);
        uint256 id = ron.attestCompletion(bytes32("t"), "ipfs://r");
        ids.push(id);
    }

    function receipt(uint256 idSeed, uint256 cpSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address cp = agents[cpSeed % agents.length];
        ReputationOracleNetwork.Completion memory c = ron.getCompletion(id);
        if (cp == c.agent || c.counterparty != address(0) || c.disputed) return;
        (bool resolved, , ) = _challenge(id);
        if (c.challenged && !resolved) return;
        vm.prank(cp);
        try ron.attestReceipt(id, "ipfs://receipt") {} catch {}
    }

    function challenge(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        ReputationOracleNetwork.Completion memory c = ron.getCompletion(id);
        if (c.challenged) return;
        address ch = agents[idSeed % agents.length];
        uint256 bond = ron.CHALLENGE_BOND();
        vm.deal(ch, bond);
        vm.prank(ch);
        try ron.challengeCompletion{value: bond}(id, "ipfs://ev") {
            pending++;
            ghost_challenges++;
        } catch {}
    }

    function contest(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        ReputationOracleNetwork.Completion memory c = ron.getCompletion(id);
        if (!c.challenged) return;
        (bool resolved, uint64 deadline, bool contested) = _challenge(id);
        if (resolved || contested || block.timestamp > deadline) return;
        vm.prank(c.agent);
        try ron.contestChallenge(id, "ipfs://rebuttal") {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 5 days));
    }

    function finalize(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        ReputationOracleNetwork.Completion memory c = ron.getCompletion(id);
        if (!c.challenged) return;
        (bool resolved, uint64 deadline, bool contested) = _challenge(id);
        if (resolved || contested || block.timestamp < deadline) return;
        try ron.finalizeChallenge(id) {
            pending--;
        } catch {}
    }

    function resolve(uint256 idSeed, bool upheld) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        ReputationOracleNetwork.Completion memory c = ron.getCompletion(id);
        if (!c.challenged) return;
        (bool resolved, , ) = _challenge(id);
        if (resolved) return;
        vm.prank(owner);
        try ron.resolveChallenge(id, upheld) {
            pending--;
        } catch {}
    }
}

contract RONInvariants is Test {
    ReputationOracleNetwork internal ron;
    RONHandler internal handler;
    address internal ownerAddr = address(0xF00D);

    function setUp() public {
        ron = new ReputationOracleNetwork();
        ron.transferOwnership(ownerAddr);
        handler = new RONHandler(ron, ownerAddr);
        targetContract(address(handler));
    }

    /// @dev The contract holds exactly the pending challenge bonds plus the pool:
    ///      balance == pending * CHALLENGE_BOND + slashedEthPool.
    function invariant_ethConservation() public view {
        assertEq(
            address(ron).balance,
            uint256(handler.pending()) * ron.CHALLENGE_BOND() + ron.slashedEthPool()
        );
    }

    /// @dev A disputed completion must never remain receipt-confirmed.
    function invariant_noDisputedReceipt() public view {
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            ReputationOracleNetwork.Completion memory c = ron.getCompletion(handler.ids(i));
            if (c.disputed) assertEq(c.counterparty, address(0));
        }
    }

    /// @dev The decayed two-sided score can never exceed the confirmed count, and
    ///      the self-attest score can never exceed the completion count.
    function invariant_scoresBounded() public view {
        uint256 n = handler.agentCount();
        for (uint256 i = 0; i < n; i++) {
            address a = handler.agents(i);
            (uint64 conf, , uint64 score, , ) = ron.getTwoSidedScore(a);
            assertLe(score, conf);
            (uint64 comps, , uint64 selfScore) = ron.getSelfAttestScore(a);
            assertLe(selfScore, comps);
        }
    }
}

contract RONFuzz is Test {
    ReputationOracleNetwork internal ron;

    function setUp() public {
        ron = new ReputationOracleNetwork();
    }

    /// @dev A challenge only succeeds with exactly CHALLENGE_BOND; any other value reverts.
    function testFuzz_challengeRequiresExactBond(uint96 value) public {
        vm.assume(uint256(value) != ron.CHALLENGE_BOND());
        vm.prank(address(0xABCD));
        ron.attestCompletion(bytes32("t"), "ipfs://r");
        vm.deal(address(0xABCD), uint256(value));
        vm.prank(address(0xABCD));
        vm.expectRevert(
            abi.encodeWithSelector(
                ReputationOracleNetwork.WrongChallengeBond.selector,
                uint256(value),
                ron.CHALLENGE_BOND()
            )
        );
        ron.challengeCompletion{value: uint256(value)}(1, "ipfs://ev");
    }

    /// @dev An agent cannot countersign its own completion.
    function testFuzz_receiptRejectsSelf(address agent) public {
        vm.assume(agent != address(0));
        vm.prank(agent);
        ron.attestCompletion(bytes32("t"), "ipfs://r");
        vm.prank(agent);
        vm.expectRevert(ReputationOracleNetwork.ReceiptNotAllowed.selector);
        ron.attestReceipt(1, "ipfs://receipt");
    }

    /// @dev Decay is monotonic non-increasing in elapsed time (never grows a score).
    function testFuzz_decayMonotonic(uint64 seedA, uint64 seedB) public {
        uint64 elapsedA = uint64(bound(seedA, 0, 400 days));
        uint64 elapsedB = uint64(bound(seedB, 0, 400 days));
        vm.assume(elapsedA <= elapsedB);
        address agent = address(0xDEAD);
        vm.prank(agent);
        ron.attestCompletion(bytes32("t"), "ipfs://r");
        vm.prank(agent);
        ron.attestCompletion(bytes32("t"), "ipfs://r2");
        uint256 t0 = block.timestamp;

        vm.warp(t0 + elapsedA);
        (, , uint64 earlier) = ron.getSelfAttestScore(agent);
        vm.warp(t0 + elapsedB);
        (, , uint64 later) = ron.getSelfAttestScore(agent);
        assertLe(later, earlier);
    }
}
