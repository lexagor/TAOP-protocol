// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Test helper: a challenger contract whose receive() reverts. Refunds are
///      pull-based, so this must not be able to block challenge resolution.
contract RejectingChallenger {
    function challenge(address ron, uint256 completionId) external payable {
        (bool ok, ) = ron.call{value: msg.value}(
            abi.encodeWithSignature("challengeCompletion(uint256,string)", completionId, "ipfs://ev")
        );
        require(ok, "challenge failed");
    }

    function withdraw(address ron) external {
        (bool ok, ) = ron.call(abi.encodeWithSignature("withdrawRefund()"));
        require(ok, "withdraw failed");
    }

    receive() external payable {
        revert("no refunds here");
    }
}
