// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol"; // ensure artifact for Timelock deploys/tests (P0)

/**
 * @title CapabilityRegistry
 * @notice The TAOP LoRA Guilds contract (v1, ETH-only).
 *
 *   Capabilities (LoRA models, etc.) are registered as ERC-721 NFTs; the
 *   `capabilityId` returned by `registerCapability` is the NFT tokenId.
 *   Creators bond ETH at registration; bonds are slashable if the capability
 *   is fraudulent or underperforms. Certification is recorded on-chain by a
 *   designated certifier. No protocol token in v1.
 */
contract CapabilityRegistry is ERC721Enumerable, Ownable, ReentrancyGuard {
    address public certifier;

    struct Capability {
        address creator;
        uint256 bond; // ETH locked by creator (wei)
        bytes32 capabilityType; // e.g., keccak256("LoRA")
        string metadataCID; // IPFS CID pointing to model metadata
        bool certified;
        bool slashed;
    }

    mapping(uint256 => Capability) private _capabilities;
    uint256 private _nextTokenId; // first minted tokenId is 1
    uint256 public slashedEthPool; // slashed ETH bonds, owner-withdrawable

    mapping(bytes32 => uint256[]) public capabilitiesByType; // for efficient discovery by type

    event CapabilityRegistered(uint256 capabilityId, address creator);
    event CapabilityCertified(uint256 capabilityId, address certifier);
    event CapabilitySlashed(uint256 capabilityId, uint256 penalty);
    event BondWithdrawn(uint256 capabilityId, address to, uint256 amount);
    event EthPoolWithdrawn(address to, uint256 amount);

    error NotCertifier();
    error ZeroBond();
    error PenaltyExceedsBond(uint256 requested, uint256 available);
    error NoSuchCapability();
    error NotCreator();
    error BondStillSlashed();
    error NothingToWithdraw();

    constructor(address _certifier) ERC721("TAOP Capability", "TAOP-CAP") Ownable(msg.sender) {
        certifier = _certifier;
    }

    function setCertifier(address c) external onlyOwner {
        certifier = c;
    }

    /// @notice Register a capability and lock an ETH bond (msg.value). Returns
    ///         the capabilityId (also the NFT tokenId minted to the caller).
    function registerCapabilityEth(bytes32 capabilityType, string calldata metadataCID)
        external
        payable
        nonReentrant
        returns (uint256 capabilityId)
    {
        uint256 bond = msg.value;
        if (bond == 0) revert ZeroBond();
        capabilityId = ++_nextTokenId;
        _safeMint(msg.sender, capabilityId);
        _capabilities[capabilityId] = Capability({
            creator: msg.sender,
            bond: bond,
            capabilityType: capabilityType,
            metadataCID: metadataCID,
            certified: false,
            slashed: false
        });
        capabilitiesByType[capabilityType].push(capabilityId);
        emit CapabilityRegistered(capabilityId, msg.sender);
    }

    /// @notice Mark a capability as certified (certifier / owner only).
    function certifyCapability(uint256 capabilityId) external nonReentrant returns (bool) {
        if (msg.sender != certifier && msg.sender != owner()) revert NotCertifier();
        if (_ownerOf(capabilityId) == address(0)) revert NoSuchCapability();
        _capabilities[capabilityId].certified = true;
        emit CapabilityCertified(capabilityId, msg.sender);
        return true;
    }

    /// @notice Slash a creator's ETH bond (certifier / owner only). The penalty
    ///         is bounded by the remaining bond and added to `slashedEthPool`.
    function slashCapability(uint256 capabilityId, uint256 penalty) external nonReentrant returns (bool) {
        if (msg.sender != certifier && msg.sender != owner()) revert NotCertifier();
        Capability storage c = _capabilities[capabilityId];
        if (_ownerOf(capabilityId) == address(0)) revert NoSuchCapability();
        if (penalty > c.bond) revert PenaltyExceedsBond(penalty, c.bond);
        c.bond -= penalty;
        c.slashed = true;
        slashedEthPool += penalty;
        emit CapabilitySlashed(capabilityId, penalty);
        return true;
    }

    /// @notice Creator reclaims their un-slashed ETH bond. Burns the NFT and
    ///         returns the remaining bond to the caller.
    function withdrawBond(uint256 capabilityId) external nonReentrant {
        Capability storage c = _capabilities[capabilityId];
        if (_ownerOf(capabilityId) == address(0)) revert NoSuchCapability();
        if (msg.sender != c.creator) revert NotCreator();
        uint256 amount = c.bond;
        if (amount == 0) revert BondStillSlashed();
        c.bond = 0;
        _burn(capabilityId);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "eth withdraw failed");
        emit BondWithdrawn(capabilityId, msg.sender, amount);
    }

    /// @notice Owner withdraws slashed ETH bonds from the protocol pool.
    function withdrawEthPool(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > slashedEthPool) revert NothingToWithdraw();
        slashedEthPool -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit EthPoolWithdrawn(to, amount);
    }

    function getCapability(uint256 capabilityId) external view returns (Capability memory) {
        if (_ownerOf(capabilityId) == address(0)) revert NoSuchCapability();
        return _capabilities[capabilityId];
    }

    function capabilityTypeOf(uint256 capabilityId) external view returns (bytes32) {
        return _capabilities[capabilityId].capabilityType;
    }

    /// @notice Get all capability IDs for a given type (for efficient discovery).
    function getCapabilitiesByType(bytes32 capabilityType) external view returns (uint256[] memory) {
        return capabilitiesByType[capabilityType];
    }
}