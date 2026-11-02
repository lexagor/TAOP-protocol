// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRulingOracle {
    function outcome(bytes32 caseId)
        external
        view
        returns (uint8 ruling, uint8 status, uint64 finalizedAt, bytes32 evidenceHash);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Minimal marketplace escrow: keep case funds here, then settle only
///         after the RulingOracle outcome is final.
contract RulingEscrowExample {
    IRulingOracle public immutable oracle;
    IERC20 public immutable usdc;

    constructor(address oracle_, address usdc_) {
        oracle = IRulingOracle(oracle_);
        usdc = IERC20(usdc_);
    }

    function settle(bytes32 caseId, address provider, address payer, uint256 amount) external {
        (uint8 ruling, uint8 status,,) = oracle.outcome(caseId);
        require(status == 3 || status == 4, "ruling not final");
        require(ruling == 1 || ruling == 2, "no ruling");
        require(usdc.transfer(ruling == 1 ? provider : payer, amount), "transfer failed");
    }
}
