// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntryPoint} from "@vechain/account-abstraction-contracts/interfaces/IEntryPoint.sol";

/**
 * @title Stakeable Entity
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
contract Stakeable is Ownable {
    constructor(address _newOwner) {
        _transferOwnership(_newOwner);
    }

    function unlockStake(address epAddress) external onlyOwner {
        require(epAddress != address(0), "Invalid EP address");
        IEntryPoint(epAddress).unlockStake();
    }

    function withdrawStake(
        address epAddress,
        address payable withdrawAddress
    ) external onlyOwner {
        require(epAddress != address(0), "Invalid EP address");
        IEntryPoint(epAddress).withdrawStake(withdrawAddress);
    }
}
