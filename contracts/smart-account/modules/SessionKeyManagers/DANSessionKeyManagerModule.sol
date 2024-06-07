// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {BaseAuthorizationModule} from "../BaseAuthorizationModule.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISessionValidationModule} from "../../interfaces/modules/ISessionValidationModule.sol";
import {ISessionKeyManagerModule} from "../../interfaces/modules/SessionKeyManagers/ISessionKeyManagerModule.sol";
import {IAuthorizationModule} from "../../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../../interfaces/ISignatureValidator.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Performs basic verifications for every session key signed userOp.
 * Checks if the session key has been enabled, that it is not due and has not yet expired
 * Then passes the validation flow to appropriate Session Validation module
 *         - For the sake of efficiency and flexibility, doesn't limit what operations
 *           Session Validation modules can perform
 *         - Should be used with carefully verified and audited Session Validation Modules only
 *         - Compatible with Biconomy Modular Interface v 0.1
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract DANSessionKeyManager is
    BaseAuthorizationModule,
    ISessionKeyManagerModule
{
    string public constant NAME = "DAN Session Manager";
    string public constant VERSION = "1.1.0";

    uint256 private constant MODULE_SIGNATURE_OFFSET = 96;

    /**
     * @dev mapping of Smart Account to a SessionStorage
     * Info about session keys is stored as root of the merkle tree built over the session keys
     */
    mapping(address => SessionStorage) internal _userSessions;

    // TODO // Review
    // What if we could take some inspiration from Session Key Manager Hybrid module.

    /// @inheritdoc ISessionKeyManagerModule
    function setMerkleRoot(bytes32 _merkleRoot) external override {
        _userSessions[msg.sender].merkleRoot = _merkleRoot;
        emit MerkleRootUpdated(msg.sender, _merkleRoot);
    }

    // TODO // Review
    // We could also remove sessionValidationModule everywhere

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256) {
        (
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes memory sessionKeyData,
            bytes32[] memory merkleProof,
            bytes memory sessionKeySignature
        ) = abi.decode(
                userOp.signature[MODULE_SIGNATURE_OFFSET:],
                (uint48, uint48, address, bytes, bytes32[], bytes)
            );

        validateSessionKey(
            userOp.sender,
            validUntil,
            validAfter,
            sessionValidationModule,
            sessionKeyData,
            merkleProof
        );

        (address sessionKey, , , , ) = abi.decode(
            sessionKeyData,
            (address, address, address, uint256, uint256)
        );

        bool isValidSignatureFromDAN = ECDSA.recover(
            ECDSA.toEthSignedMessageHash(userOpHash),
            sessionKeySignature
        ) == sessionKey;

        return
            _packValidationData(
                !isValidSignatureFromDAN,
                validUntil,
                validAfter
            );
    }

    /// @inheritdoc ISessionKeyManagerModule
    function getSessionKeys(
        address smartAccount
    ) external view override returns (SessionStorage memory) {
        return _userSessions[smartAccount];
    }

    /// @inheritdoc ISessionKeyManagerModule
    function validateSessionKey(
        address smartAccount,
        uint48 validUntil,
        uint48 validAfter,
        address sessionValidationModule,
        bytes memory sessionKeyData,
        bytes32[] memory merkleProof
    ) public virtual override {
        SessionStorage storage sessionKeyStorage = _getSessionData(
            smartAccount
        );
        bytes32 leaf = keccak256(
            abi.encodePacked(
                validUntil,
                validAfter,
                sessionValidationModule,
                sessionKeyData
            )
        );
        if (
            !MerkleProof.verify(merkleProof, sessionKeyStorage.merkleRoot, leaf)
        ) {
            revert("SessionNotApproved");
        }
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }

    /**
     * @dev returns the SessionStorage object for a given smartAccount
     * @param _account Smart Account address
     * @return sessionKeyStorage SessionStorage object at storage
     */
    function _getSessionData(
        address _account
    ) internal view returns (SessionStorage storage sessionKeyStorage) {
        sessionKeyStorage = _userSessions[_account];
    }
}