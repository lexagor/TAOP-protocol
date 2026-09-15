// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// Kept so Hardhat/Foundry emit the Timelock artifact used by tests/deploy.
// solhint-disable-next-line no-unused-import
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

    event CapabilityRegistered(uint256 capabilityId, address indexed creator);
    event CapabilityCertified(uint256 capabilityId, address indexed certifier);
    event CapabilitySlashed(uint256 capabilityId, uint256 penalty);
    event BondWithdrawn(uint256 capabilityId, address indexed to, uint256 amount);
    event EthPoolWithdrawn(address indexed to, uint256 amount);
    event CertifierChanged(address indexed previousCertifier, address indexed newCertifier);

    error NotCertifier();
    error ZeroBond();
    error ZeroAddress();
    error PenaltyExceedsBond(uint256 requested, uint256 available);
    error NoSuchCapability();
    error NotCreator();
    error BondStillSlashed();
    error NothingToWithdraw();

    constructor(address _certifier) ERC721("TAOP Capability", "TAOP-CAP") Ownable(msg.sender) {
        if (_certifier == address(0)) revert ZeroAddress();
        certifier = _certifier;
    }

    function setCertifier(address c) external onlyOwner {
        if (c == address(0)) revert ZeroAddress();
        emit CertifierChanged(certifier, c);
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

    /// @notice Remove `capabilityId` from its type index (swap-and-pop) so
    ///         discovery never yields burned capabilities (v0.1.2 fix: previously
    ///         a withdrawn bond left a stale id that made discovery revert for
    ///         every consumer).
    function _removeFromTypeIndex(bytes32 capabilityType, uint256 capabilityId) private {
        uint256[] storage list = capabilitiesByType[capabilityType];
        uint256 len = list.length;
        for (uint256 i = 0; i < len; i++) {
            if (list[i] == capabilityId) {
                list[i] = list[len - 1];
                list.pop();
                return;
            }
        }
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
        _removeFromTypeIndex(c.capabilityType, capabilityId);
        _burn(capabilityId);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "eth withdraw failed");
        emit BondWithdrawn(capabilityId, msg.sender, amount);
    }

    /// @notice Owner withdraws slashed ETH bonds from the protocol pool.
    function withdrawEthPool(address payable to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
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

    /// @notice v0.2 / F10: number of live capabilities of a type, so indexers and
    ///         UIs can page without loading the whole array.
    function countCapabilitiesByType(bytes32 capabilityType) external view returns (uint256) {
        return capabilitiesByType[capabilityType].length;
    }

    /// @notice v0.2 / F10: paginated view over `getCapabilitiesByType`. Returns an
    ///         empty array when `offset` is past the end or `limit` is zero, and
    ///         clamps the page to the end of the list.
    function getCapabilitiesByTypePaged(bytes32 capabilityType, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        uint256[] storage list = capabilitiesByType[capabilityType];
        uint256 len = list.length;
        if (limit == 0 || offset >= len) return new uint256[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        page = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = list[i];
        }
    }
}