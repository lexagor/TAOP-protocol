// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pluggable appeal layer for RulingOracle. Implementations may use UMA
///         OOv3, a reviewer panel, or another bonded mechanism. The core oracle
///         only needs an id to correlate the callback.
interface IEscalationOracle {
    /// @notice Escalate a challenged ruling. The adapter is responsible for its
    ///         own bond/collateral and for eventually calling
    ///         `RulingOracle.resolveEscalation(requestId, rulingUpheld)`.
    function escalate(bytes32 caseId, uint8 ruling, bytes32 evidenceHash)
        external
        returns (bytes32 requestId);
}
