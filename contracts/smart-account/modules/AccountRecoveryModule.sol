// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAccountRecoveryModule} from "../interfaces/IAccountRecoveryModule.sol";

/**
 * @title Account Recovery module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows the submission and execution of recovery requests
 *         - EOA guardians only
 *         - For security reasons the guardian's address is not stored,
 *           instead, its signature over CONTROL_HASH is used
 *         - Security delay is always applied to new guardians and recovery requests
 *         - It is highly recommended to not set security delay to 0
 * @dev For the validation stage (validateUserOp) can not use custom errors
 * as EntryPoint contract doesn't support custom error messages within its
 * 'try IAccount(sender).validateUserOp catch Error' expression
 * so it becomes more difficult to debug validateUserOp if it uses custom errors
 * For the execution methods custom errors are used
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 * based on https://vitalik.ca/general/2021/01/11/recovery.html by Vitalik Buterin
 */

contract AccountRecoveryModule is
    BaseAuthorizationModule,
    IAccountRecoveryModule
{
    using ECDSA for bytes32;

    string public constant NAME = "Account Recovery Module";
    string public constant VERSION = "0.1.0";

    // keccak256(abi.encodePacked("ACCOUNT RECOVERY GUARDIAN SECURE MESSAGE"))
    bytes32 public constant CONTROL_HASH =
        0x1c3074d7ce4e35b6f0a67e3db0f31ff117ca8f0a1853e86a95837fea35af828b;
    bytes32 public immutable controlHashEthSigned = CONTROL_HASH
        .toEthSignedMessageHash();    

    // guardianID => (smartAccount => TimeFrame)
    // guardianID = keccak256(signature over CONTROL_HASH)
    // complies with associated storage rules
    // see https://eips.ethereum.org/EIPS/eip-4337#storage-associated-with-an-address
    // see https://docs.soliditylang.org/en/v0.8.15/internals/layout_in_storage.html#mappings-and-dynamic-arrays
    mapping(bytes32 => mapping(address => TimeFrame)) internal _guardians;

    mapping(address => SaSettings) internal _smartAccountSettings;

    mapping(address => RecoveryRequest) internal _smartAccountRequests;

    /**
     * @dev Initializes the module for a Smart Account.
     * Can only be used at a time of first enabling the module for a Smart Account.
     * @param guardians the list of guardians
     * @param timeFrames validity timeframes for guardians
     * @param recoveryThreshold how many guardians' signatures are required to authorize recovery request
     * @param securityDelay amount of time required to pass between the submission of the recovery request
     * and its execution
     * @dev no need for explicit check `length == 0` as it is covered by `recoveryThreshold > length` and
     * `recoveryThreshold == 0` cheks. So length can never be 0 while recoveryThreshold is not 0
     */
    function initForSmartAccount(
        bytes32[] calldata guardians,
        TimeFrame[] memory timeFrames,
        uint8 recoveryThreshold,
        uint48 securityDelay
    ) external returns (address) {
        uint256 length = guardians.length;
        if (_smartAccountSettings[msg.sender].guardiansCount > 0)
            revert AlreadyInitedForSmartAccount(msg.sender);
        if (recoveryThreshold > length)
            revert ThresholdTooHigh(recoveryThreshold, length);
        if (recoveryThreshold == 0) revert ZeroThreshold();
        if (length != timeFrames.length) revert InvalidAmountOfGuardianParams();
        _smartAccountSettings[msg.sender] = SaSettings(
            uint8(length),
            recoveryThreshold,
            securityDelay
        );
        for (uint256 i; i < length; ) {
            if (guardians[i] == bytes32(0)) revert ZeroGuardian();
            if (_guardians[guardians[i]][msg.sender].validUntil != 0) revert GuardianAlreadySet(guardians[i], msg.sender);
            if (timeFrames[i].validUntil == 0)
                timeFrames[i].validUntil = type(uint48).max;
            if (timeFrames[i].validUntil < timeFrames[i].validAfter)
                revert InvalidTimeFrame(
                    timeFrames[i].validUntil,
                    timeFrames[i].validAfter
                );
            if (timeFrames[i].validUntil < block.timestamp)
                revert ExpiredValidUntil(timeFrames[i].validUntil);

            _guardians[guardians[i]][msg.sender] = timeFrames[i];
            emit GuardianAdded(msg.sender, guardians[i], timeFrames[i]);
            unchecked {
                ++i;
            }
        }
        return address(this);
    }

    /**
     * @dev validates userOps to submit and execute recovery requests
     *     - if securityDelay is 0, it allows to execute the request immediately
     *     - if securityDelay is non 0, the request is submitted and stored on-chain
     *     - if userOp.callData matches the callData of the request already submitted,
     *     - and the security delay has passed, it allows to execute the request
     * @param userOp User Operation to be validated.
     * @param userOpHash Hash of the User Operation to be validated.
     * @return validation data (sig validation result + validUntil + validAfter)
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256) {
        // if there is already a request added for this userOp.callData, return validation success
        // to procced with executing the request
        // with validAfter set to the timestamp of the request + securityDelay
        // so that the request execution userOp can be validated only after the delay
        if (
            keccak256(userOp.callData) ==
            _smartAccountRequests[msg.sender].callDataHash
        ) {
            uint48 reqValidAfter = _smartAccountRequests[msg.sender]
                .requestTimestamp +
                _smartAccountSettings[msg.sender].securityDelay;
            delete _smartAccountRequests[msg.sender];
            return
                VALIDATION_SUCCESS |
                (0 << 160) | // validUntil = 0 is converted to max uint48 in EntryPoint
                (uint256(reqValidAfter) << (160 + 48));
        }

        // otherwise we need to check all the signatures first
        uint256 requiredSignatures = _smartAccountSettings[userOp.sender]
            .recoveryThreshold;
        if (requiredSignatures == 0) revert("AccRecovery: Threshold not set");

        bytes calldata moduleSignature = userOp.signature[96:];

        require(
            moduleSignature.length >= requiredSignatures * 2 * 65,
            "AccRecovery: Invalid Sigs Length"
        );

        address lastGuardianAddress;
        address currentGuardianAddress;
        bytes memory currentGuardianSig;
        uint48 validAfter;
        uint48 validUntil;
        uint48 latestValidAfter;
        uint48 earliestValidUntil = type(uint48).max;
        bytes32 userOpHashSigned = userOpHash.toEthSignedMessageHash();

        for (uint256 i; i < requiredSignatures; ) {

            // even indexed signatures are signatures over userOpHash
            // every signature is 65 bytes long and they are packed into moduleSignature
            address currentUserOpSignerAddress = userOpHashSigned
                .recover(moduleSignature[2 * i * 65:(2 * i + 1) * 65]);

            // odd indexed signatures are signatures over CONTROL_HASH used to calculate guardian id
            currentGuardianSig = moduleSignature[(2 * i + 1) * 65:(2 * i + 2) *
                65];

            currentGuardianAddress = controlHashEthSigned
                .recover(currentGuardianSig);

            if (currentUserOpSignerAddress != currentGuardianAddress) {
                return SIG_VALIDATION_FAILED;
            }

            bytes32 currentGuardian = keccak256(currentGuardianSig);

            validAfter = _guardians[currentGuardian][userOp.sender].validAfter;
            validUntil = _guardians[currentGuardian][userOp.sender].validUntil;

            // validUntil == 0 means the `currentGuardian` has not been set as guardian
            // for the userOp.sender smartAccount
            // validUntil can never be 0 as it is set to type(uint48).max in initForSmartAccount
            if (validUntil == 0) {
                return SIG_VALIDATION_FAILED;
            }

            // gas efficient way to ensure all guardians are unique
            // requires from dapp to sort signatures before packing them into bytes
            if (currentGuardianAddress <= lastGuardianAddress)
                revert("AccRecovery: NotUnique/BadOrder");

            // detect the common validity window for all the guardians
            // if at least one guardian is not valid yet or expired
            // the whole userOp will be invalidated at the EntryPoint
            if (validUntil < earliestValidUntil) {
                earliestValidUntil = validUntil;
            }
            if (validAfter > latestValidAfter) {
                latestValidAfter = validAfter;
            }
            lastGuardianAddress = currentGuardianAddress;

            unchecked {
                ++i;
            }
        }

        // if all the signatures are ok, we need to check if it is a new recovery request
        // anything except adding a new request to this module is allowed only if securityDelay is 0
        // which means user explicitly allowed to execute an operation immediately
        // userOp.callData expected to be the calldata of the default execution function
        // in this case execute(address dest, uint256 value, bytes calldata data);
        // where `data` is the submitRecoveryRequest() method calldata
        (address dest, uint256 callValue, bytes memory innerCallData) = abi
            .decode(
                userOp.callData[4:], // skip selector
                (address, uint256, bytes)
            );
        bytes4 innerSelector;
        assembly {
            innerSelector := mload(add(innerCallData, 0x20))
        }
        bool isValidAddingRequestUserOp = (innerSelector ==
            this.submitRecoveryRequest.selector) &&
            (dest == address(this)) &&
            callValue == 0;
        if (
            isValidAddingRequestUserOp != //this a userOp to submit Recovery Request
            (_smartAccountSettings[msg.sender].securityDelay == 0) //securityDelay is 0,
        ) {
            return
                VALIDATION_SUCCESS | //consider this userOp valid within the timeframe
                (uint256(earliestValidUntil) << 160) |
                (uint256(latestValidAfter) << (160 + 48));
        } else {
            // a) if both conditions are true, it makes no sense, as with the 0 delay, there's no need to submit a
            // request, as request can be immediately executed in the execution phase of userOp handling
            // b) if non of the conditions are met, this means userOp is not for submitting a new request which is
            // only allowed with when the securityDelay is non 0
            // not using custom error here because of how EntryPoint handles the revert data for the validation failure
            revert("AccRecovery: Wrong userOp");
        }
    }

    /**
     * @dev Adds guardian for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param guardian guardian to add
     * @param validUntil guardian validity end timestamp
     * @param validAfter guardian validity start timestamp
     */
    function addGuardian(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == bytes32(0)) revert ZeroGuardian();
        if (_guardians[guardian][msg.sender].validUntil != 0)
            revert GuardianAlreadySet(guardian, msg.sender);
        (validUntil, validAfter) = _checkAndAdjustValidUntilValidAfter(
            validUntil,
            validAfter
        );
        _guardians[guardian][msg.sender] = TimeFrame(validUntil, validAfter);
        ++_smartAccountSettings[msg.sender].guardiansCount;
        emit GuardianAdded(
            msg.sender,
            guardian,
            TimeFrame(validUntil, validAfter)
        );
    }

    /**
     * @dev Replaces guardian for a Smart Account (msg.sender)
     * Deletes the replaced guardian and adds the new one
     * The new guardian will be valid not earlier than now+securityDelay
     * @param guardian guardian to replace
     * @param newGuardian new guardian to add
     * @param validUntil new guardian validity end timestamp
     * @param validAfter new guardian validity start timestamp
     */
    function replaceGuardian(
        bytes32 guardian,
        bytes32 newGuardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (_guardians[guardian][msg.sender].validUntil == 0)
            revert GuardianNotSet(guardian, msg.sender);
        if (guardian == newGuardian) revert GuardiansAreIdentical();
        if (newGuardian == bytes32(0)) revert ZeroGuardian();

        // remove guardian
        delete _guardians[guardian][msg.sender];
        emit GuardianRemoved(msg.sender, guardian);

        (validUntil, validAfter) = _checkAndAdjustValidUntilValidAfter(
            validUntil,
            validAfter
        );

        _guardians[newGuardian][msg.sender] = TimeFrame(
            validUntil == 0 ? type(uint48).max : validUntil,
            validAfter
        );
        // don't increment guardiansCount as we haven't decremented it when deleting previous one
        emit GuardianAdded(
            msg.sender,
            newGuardian,
            TimeFrame(
                validUntil == 0 ? type(uint48).max : validUntil,
                validAfter
            )
        );
    }

    /**
     * @dev Removes guardian for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param guardian guardian to remove
     */
    function removeGuardian(bytes32 guardian) external {
        if (_guardians[guardian][msg.sender].validUntil == 0)
            revert GuardianNotSet(guardian, msg.sender);
        _removeGuardianAndChangeTresholdIfNeeded(guardian, msg.sender);
    }

    /**
     * @dev Removes the expired guardian for a Smart Account
     * Can be called  by anyone. Allows clearing expired guardians automatically
     * and maintain the list of guardians actual
     * @param guardian guardian to remove
     */
    function removeExpiredGuardian(
        bytes32 guardian,
        address smartAccount
    ) external {
        uint48 validUntil = _guardians[guardian][smartAccount].validUntil;
        if (validUntil == 0) revert GuardianNotSet(guardian, smartAccount);
        if (validUntil >= block.timestamp)
            revert GuardianNotExpired(guardian, smartAccount);
        _removeGuardianAndChangeTresholdIfNeeded(guardian, smartAccount);
    }

    /**
     * @dev Changes guardian validity timeframes for the Smart Account (msg.sender)
     * @param guardian guardian to change
     * @param validUntil guardian validity end timestamp
     * @param validAfter guardian validity start timestamp
     */
    function changeGuardianParams(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        (validUntil, validAfter) = _checkAndAdjustValidUntilValidAfter(
            validUntil,
            validAfter
        );
        _guardians[guardian][msg.sender] = TimeFrame(validUntil, validAfter);
        emit GuardianChanged(
            msg.sender,
            guardian,
            TimeFrame(validUntil, validAfter)
        );
    }

    /**
     * @dev Changes recovery threshold for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param newThreshold new recovery threshold
     */
    function setThreshold(uint8 newThreshold) external {
        if (newThreshold == 0) revert ZeroThreshold();
        if (newThreshold > _smartAccountSettings[msg.sender].guardiansCount)
            revert ThresholdTooHigh(
                newThreshold,
                _smartAccountSettings[msg.sender].guardiansCount
            );
        _smartAccountSettings[msg.sender].recoveryThreshold = newThreshold;
        emit ThresholdChanged(msg.sender, newThreshold);
    }

    /**
     * @dev Changes security delay for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param newSecurityDelay new security delay
     */
    function setSecurityDelay(uint48 newSecurityDelay) external {
        _smartAccountSettings[msg.sender].securityDelay = newSecurityDelay;
        emit SecurityDelayChanged(msg.sender, newSecurityDelay);
    }

    /**
     * @dev Returns guardian validity timeframes for the Smart Account
     * @param guardian guardian to get params for
     * @param smartAccount smartAccount to get params for
     * @return TimeFrame struct
     */
    function getGuardianParams(
        bytes32 guardian,
        address smartAccount
    ) external view returns (TimeFrame memory) {
        return _guardians[guardian][smartAccount];
    }

    /**
     * @dev Returns Smart Account settings
     * @param smartAccount smartAccount to get settings for
     * @return Smart Account Settings struct
     */
    function getSmartAccountSettings(
        address smartAccount
    ) external view returns (SaSettings memory) {
        return _smartAccountSettings[smartAccount];
    }

    /**
     * @dev Returns recovery request for a Smart Account
     * Only one request per Smart Account is stored at a time
     * @param smartAccount smartAccount to get recovery request for
     * @return RecoveryRequest struct
     */
    function getRecoveryRequest(
        address smartAccount
    ) external view returns (RecoveryRequest memory) {
        return _smartAccountRequests[smartAccount];
    }

    /**
     * @dev Submits recovery request for a Smart Account
     * Hash of the callData is stored on-chain along with the timestamp of the request submission
     * @param recoveryCallData callData of the recovery request
     */
    function submitRecoveryRequest(bytes calldata recoveryCallData) public {
        if (recoveryCallData.length == 0) revert EmptyRecoveryCallData();
        if (
            _smartAccountRequests[msg.sender].callDataHash ==
            keccak256(recoveryCallData)
        )
            revert RecoveryRequestAlreadyExists(
                msg.sender,
                keccak256(recoveryCallData)
            );

        _smartAccountRequests[msg.sender] = RecoveryRequest(
            keccak256(recoveryCallData),
            uint48(block.timestamp)
        );
        emit RecoveryRequestSubmitted(msg.sender, recoveryCallData);
    }

    /**
     * @dev renounces existing recovery request for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * Can be used during the security delay to cancel the request
     */
    function renounceRecoveryRequest() public {
        delete _smartAccountRequests[msg.sender];
        emit RecoveryRequestRenounced(msg.sender);
    }

    /**
     * @dev Not supported here
     */
    function isValidSignature(
        bytes32,
        bytes memory
    ) public view virtual override returns (bytes4) {
        return 0xffffffff; // not supported
    }

    /**
     * @dev Internal method to remove guardian and adjust threshold if needed
     * It is needed when after removing guardian, the threshold becomes higher than
     * the number of guardians
     * @param guardian guardian to remove
     * @param smartAccount smartAccount to remove guardian from
     */
    function _removeGuardianAndChangeTresholdIfNeeded(
        bytes32 guardian,
        address smartAccount
    ) internal {
        delete _guardians[guardian][smartAccount];
        --_smartAccountSettings[smartAccount].guardiansCount;
        emit GuardianRemoved(smartAccount, guardian);
        // if number of guardians became less than threshold, lower the threshold
        if (
            _smartAccountSettings[smartAccount].guardiansCount <
            _smartAccountSettings[smartAccount].recoveryThreshold
        ) {
            _smartAccountSettings[smartAccount].recoveryThreshold--;
            emit ThresholdChanged(
                smartAccount,
                _smartAccountSettings[smartAccount].recoveryThreshold
            );
        }
    }

    /**
     * @dev Internal method to check and adjust validUntil and validAfter
     * @dev if validUntil is 0, guardian is considered active forever
     * Thus we put type(uint48).max as value for validUntil in this case,
     * so the calldata itself doesn't need to contain this big value and thus
     * txn is cheaper.
     * we need to explicitly change 0 to type(uint48).max, so the algorithm of intersecting
     * validUntil's and validAfter's for several guardians works correctly
     * @dev if validAfter is less then now + securityDelay, it is set to now + securityDelay
     * as for security reasons new guardian is only active after securityDelay
     * validAfter is always gte now+securityDelay
     * and validUntil is always gte validAfter
     * thus we do not need to check than validUntil is gte now
     * @param validUntil guardian validity end timestamp
     * @param validAfter guardian validity start timestamp
     */
    function _checkAndAdjustValidUntilValidAfter(
        uint48 validUntil,
        uint48 validAfter
    ) internal view returns (uint48, uint48) {
        if (validUntil == 0) validUntil = type(uint48).max;
        uint48 minimalSecureValidAfter = uint48(
            block.timestamp + _smartAccountSettings[msg.sender].securityDelay
        );
        validAfter = validAfter < minimalSecureValidAfter
            ? minimalSecureValidAfter
            : validAfter;
        if (validUntil < validAfter)
            revert InvalidTimeFrame(validUntil, validAfter);
        return (validUntil, validAfter);
    }
}
