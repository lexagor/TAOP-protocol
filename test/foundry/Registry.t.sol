// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CapabilityRegistry} from "../../contracts/CapabilityRegistry.sol";

/// @notice Property tests for CapabilityRegistry: ETH conservation and index integrity.
contract RegistryHandler is Test {
    CapabilityRegistry public registry;
    address public owner;
    bytes32 internal constant LORA = keccak256("LoRA");

    uint256 public activeBonds; // un-slashed bonds still held by the registry
    uint256 public ghost_registered;
    uint256[] public ids;
    address internal constant USER = address(0xBEEF); // EOA: _safeMint needs a valid receiver

    constructor(CapabilityRegistry _registry, address _owner) {
        registry = _registry;
        owner = _owner;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function register(uint96 bondSeed) external {
        uint256 bond = bound(uint256(bondSeed), 1, 5 ether);
        vm.deal(USER, bond);
        vm.prank(USER);
        uint256 id = registry.registerCapabilityEth{value: bond}(LORA, "ipfs://m");
        ids.push(id);
        activeBonds += bond;
        ghost_registered++;
    }

    function slash(uint256 idSeed, uint96 penaltySeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        try registry.getCapability(id) returns (CapabilityRegistry.Capability memory c) {
            if (c.bond == 0 || c.slashed) return;
            uint256 penalty = bound(uint256(penaltySeed), 0, c.bond);
            vm.prank(owner);
            registry.slashCapability(id, penalty);
            activeBonds -= penalty;
        } catch {}
    }

    function withdraw(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        try registry.getCapability(id) returns (CapabilityRegistry.Capability memory c) {
            if (c.bond == 0) return; // nothing left to withdraw
            vm.prank(USER);
            registry.withdrawBond(id); // USER is the creator
            activeBonds -= c.bond;
        } catch {}
    }
}

contract RegistryInvariants is Test {
    CapabilityRegistry internal registry;
    RegistryHandler internal handler;
    address internal ownerAddr = address(0xF00D);
    bytes32 internal constant LORA = keccak256("LoRA");

    function setUp() public {
        registry = new CapabilityRegistry(address(this)); // certifier = test
        registry.transferOwnership(ownerAddr);
        vm.prank(ownerAddr);
        registry.acceptOwnership();
        handler = new RegistryHandler(registry, ownerAddr);
        targetContract(address(handler));
    }

    /// @dev The registry never holds ETH it does not owe: balance == live bonds + slashed pool.
    function invariant_ethConservation() public view {
        assertEq(address(registry).balance, handler.activeBonds() + registry.slashedEthPool());
    }

    /// @dev Every id in the type index resolves to a live capability, and the
    ///       owner cannot withdraw more than the recorded pool.
    function invariant_indexOnlyLiveIds() public view {
        uint256[] memory list = registry.getCapabilitiesByType(LORA);
        for (uint256 i = 0; i < list.length; i++) {
            registry.getCapability(list[i]); // reverts if stale/burned
        }
        assertEq(list.length, registry.countCapabilitiesByType(LORA));
        assertLe(registry.slashedEthPool(), address(registry).balance);
    }
}

contract RegistryFuzz is Test {
    CapabilityRegistry internal registry;
    bytes32 internal constant LORA = keccak256("LoRA");
    address internal constant USER = address(0xBEEF);

    function setUp() public {
        registry = new CapabilityRegistry(address(this));
    }

    /// @dev register with any bond in [1, 5e18] locks exactly that bond and returns increasing ids.
    function testFuzz_registerLocksBond(uint96 bondSeed) public {
        uint256 bond = bound(uint256(bondSeed), 1, 5 ether);
        vm.deal(USER, bond);
        vm.prank(USER);
        uint256 id = registry.registerCapabilityEth{value: bond}(LORA, "ipfs://m");
        assertEq(id, 1);
        assertEq(registry.getCapability(id).bond, bond);
        assertEq(address(registry).balance, bond);
    }

    /// @dev A zero bond always reverts, for every caller.
    function testFuzz_registerRejectsZeroBond(address caller) public {
        vm.assume(caller != address(0));
        vm.prank(caller);
        vm.expectRevert(CapabilityRegistry.ZeroBond.selector);
        registry.registerCapabilityEth(LORA, "ipfs://m");
    }

    /// @dev Paged view agrees with the full array for arbitrary offset/limit.
    function testFuzz_pagedView(uint8 offset, uint8 limit) public {
        for (uint256 i = 0; i < 5; i++) {
            vm.deal(USER, 1 ether);
            vm.prank(USER);
            registry.registerCapabilityEth{value: 1 ether}(LORA, "ipfs://m");
        }
        uint256[] memory full = registry.getCapabilitiesByType(LORA);
        uint256[] memory page = registry.getCapabilitiesByTypePaged(LORA, offset, limit);
        if (offset >= full.length || limit == 0) {
            assertEq(page.length, 0);
            return;
        }
        uint256 expectedLen = full.length - offset;
        if (expectedLen > limit) expectedLen = limit;
        assertEq(page.length, expectedLen);
        for (uint256 i = 0; i < expectedLen; i++) {
            assertEq(page[i], full[offset + i]);
        }
    }
}
