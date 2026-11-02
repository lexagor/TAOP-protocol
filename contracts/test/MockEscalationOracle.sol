// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEscalationOracle} from "../interfaces/IEscalationOracle.sol";

interface IResolutionCallback {
    function resolveEscalation(bytes32 requestId, bool rulingUpheld) external;
}

/// @dev Test-only appeal adapter. It records the escalation and lets the test
///      resolve it (or return a zero id to simulate a broken adapter).
contract MockEscalationOracle is IEscalationOracle {
    IResolutionCallback public oracle;
    bytes32 public nextId;
    bool public returnZero;
    uint256 public nonce;

    bytes32 public lastCaseId;
    uint8 public lastRuling;
    bytes32 public lastEvidenceHash;

    event Escalated(bytes32 indexed caseId, bytes32 indexed requestId);

    function setOracle(address next) external {
        oracle = IResolutionCallback(next);
    }

    function setNextId(bytes32 next) external {
        nextId = next;
    }

    function setReturnZero(bool value) external {
        returnZero = value;
    }

    function escalate(bytes32 caseId, uint8 ruling, bytes32 evidenceHash)
        external
        override
        returns (bytes32 id)
    {
        if (returnZero) return bytes32(0);
        id = nextId;
        if (id == bytes32(0)) {
            id = keccak256(abi.encode(caseId, ruling, evidenceHash, nonce));
        }
        nonce += 1;
        nextId = bytes32(0);
        lastCaseId = caseId;
        lastRuling = ruling;
        lastEvidenceHash = evidenceHash;
        emit Escalated(caseId, id);
    }

    function resolve(bytes32 requestId, bool rulingUpheld) external {
        oracle.resolveEscalation(requestId, rulingUpheld);
    }
}
