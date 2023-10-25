import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  makeEcdsaModuleUserOp,
  getUserOpHash,
  fillAndSign,
} from "../../utils/userOp";
import {
  getEntryPoint,
  getEcdsaOwnershipRegistryModule,
  getMockToken,
  getStakedSmartAccountFactory,
  getSimpleExecutionModule,
  getSmartAccountWithModule,
  getSmartAccountFactory,
  getSmartAccountImplementation,
} from "../../utils/setupHelper";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Transaction } from "../../../src/utils/execution";

const feeCollector = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
const AddressOne = "0x0000000000000000000000000000000000000001";

describe("ECDSA Registry Validation + Simple Execution Module (with Bundler):", async () => {
  let [deployer, smartAccountOwner, bob] = [] as SignerWithAddress[];
  const smartAccountDeploymentIndex = 0;
  const SIG_VALIDATION_SUCCESS = 0;
  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, bob] = await ethers.getSigners();
  });

  afterEach(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    await Promise.all([
      environment.revert(environment.defaultSnapshot!),
      environment.resetBundler(),
    ]);
  });

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    const saFactory = await getStakedSmartAccountFactory();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
    console.log("ecdsa module addr ", ecdsaRegistryModule.address);
    // const delegateCallModuleAddress = await getSimpleExecutionModule();

    const ecdsaOwnershipSetupData =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        await smartAccountOwner.getAddress(),
      ]);

    const userSA = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const mockWrapper = await (
      await ethers.getContractFactory("MockWrapper")
    ).deploy();

    // deploy simple execution module and enable it in the smart account
    const delegateCallModule = await (
      await ethers.getContractFactory("SimpleExecutionModule")
    ).deploy();

    const userOp1 = await makeEcdsaModuleUserOp(
      "enableModule",
      [delegateCallModule.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address
    );

    await entryPoint.handleOps([userOp1], bob.address);

    console.log("delegate call module addr ", delegateCallModule.address);

    /* const deploymentData = saFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        ecdsaRegistryModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    const expectedSmartAccountAddress =
      await saFactory.getAddressForCounterFactualAccount(
        ecdsaRegistryModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      ); */

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(bob.address, tokensToMint.toString());

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      saFactory: saFactory,
      ecdsaRegistryModule: ecdsaRegistryModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      delegateCallModule: delegateCallModule,
      mockWrapper: mockWrapper,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  describe("delegatecall using enabled module ", async () => {
    it("validate using ecdsa and call enabled delegate call module for simple execution", async () => {
      const {
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        delegateCallModule,
        mockWrapper,
        mockToken,
      } = await setupTests();
      // console.log(await userSA.getImplementation());

      // simple execution module should have been enabled
      expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
        true
      );

      // ecdsa module should have been enabled as default auth module
      expect(
        await userSA.isModuleEnabled(ecdsaRegistryModule.address)
      ).to.equal(true);

      // logging enabled modules
      const returnedValue = await userSA.getModulesPaginated(
        "0x0000000000000000000000000000000000000001",
        10
      );
      console.log("enabled modules ", returnedValue);

      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);

      const wrapperCallData = mockWrapper.interface.encodeFunctionData(
        "interact",
        [mockToken.address, bob.address, ethers.utils.parseEther("30")]
      );

      // type Transaction without targetTxGas
      const transaction: any = {
        to: mockWrapper.address,
        value: "0",
        data: wrapperCallData,
        operation: 1, // dalegate call
      };

      // Calldata to send tokens using a wrapper
      const txnData1 = delegateCallModule.interface.encodeFunctionData(
        "execTransaction",
        [transaction]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [delegateCallModule.address, 0, txnData1],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      let thrownError: Error | null = null;

      // let expectedError = new UserOperationSubmissionError()

      // If bundler was supposed to throw from Validation.
      try {
        await environment.sendUserOperation(userOp, entryPoint.address);
      } catch (e) {
        thrownError = e as Error;
        console.log("=================> error thrown here ==========>");
      }

      // expect(thrownError).to.deep.equal(expectedError);

      expect(await mockToken.balanceOf(bob.address)).to.equal(
        bobBalanceBefore.add(ethers.utils.parseEther("20"))
      );

      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore.sub(ethers.utils.parseEther("30"))
      );

      expect(await mockToken.balanceOf(feeCollector)).to.equal(
        feeCollctorBalanceBefore.add(ethers.utils.parseEther("10"))
      );
    });

    // TODO: negative test cases should be moved outside of bundler tests
    // TODO: utils can be added to parse userOperationEvent and userOperationRevertReason
    // Note: negative test case can have random sender calling this module method.
    it("Should not be able to execute if module is not enabled", async () => {
      const {
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        delegateCallModule,
        mockWrapper,
        mockToken,
      } = await setupTests();
      // console.log(await userSA.getImplementation());

      expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
        true
      );

      const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);
      console.log("collector balance before ", feeCollctorBalanceBefore);

      // Checking enabled modules
      const returnedValueBefore = await userSA.getModulesPaginated(
        "0x0000000000000000000000000000000000000001",
        10
      );
      console.log("enabled modules before", returnedValueBefore);

      // Accurate as modules are added in linked list in opposite order
      // Making a tx to disable a module
      const userOp1 = await makeEcdsaModuleUserOp(
        "disableModule",
        [AddressOne, delegateCallModule.address], // in order to remove last added module prevModule would be Sentinel
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      // Review: how to check failures from bundler side
      await environment.sendUserOperation(userOp1, entryPoint.address);

      // Module should have been disabled correctly
      expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
        false
      );

      // Logging modules after disabling
      const returnedValue = await userSA.getModulesPaginated(
        "0x0000000000000000000000000000000000000001",
        10
      );
      console.log("enabled modules ", returnedValue);

      // Making the transaction using a module which should technically fail
      const wrapperCallData = mockWrapper.interface.encodeFunctionData(
        "interact",
        [mockToken.address, bob.address, ethers.utils.parseEther("30")]
      );

      // type Transaction without targetTxGas
      const transaction: any = {
        to: mockWrapper.address,
        value: "0",
        data: wrapperCallData,
        operation: 1, // dalegate call
      };

      // Calldata to set Bob as owner
      const txnData1 = delegateCallModule.interface.encodeFunctionData(
        "execTransaction",
        [transaction]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [delegateCallModule.address, 0, txnData1],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      // Such transaction would fail at SDK estimation only when estimating callGasLimit!
      /* try {
        const estimation = await ethers.provider.estimateGas({
          to: userSA.address,
          data: userOp.callData,
          from: entryPoint.address,
        });
      } catch (error) {
        console.log("revert reason ", error);
      } */

      // await entryPoint.simulateValidation(userOp, { gasLimit: 1e6 }); // works as long as execution doesn't fail
      // await environment.sendUserOperation(userOp1, entryPoint.address);
      const tx = await entryPoint.handleOps([userOp], bob.address);
      const receipt = await tx.wait();
      console.log(receipt.logs);
      const userOperationEvent = receipt.logs[3];

      const eventLogs = entryPoint.interface.decodeEventLog(
        "UserOperationEvent",
        userOperationEvent.data
      );

      console.log(eventLogs);

      expect(eventLogs.success).to.equal(false);

      /* const eventLogs2 = entryPoint.interface.decodeEventLog(
        "UserOperationRevertReason",
        receipt.logs[2].data
      );
      console.log(eventLogs2); */
      // revertReason: 0x21ac7c5f000000000000000000000000da19cab9cc9c4df0f360f0165e37ade1dd3455fd

      // Checking effects
      expect(await mockToken.balanceOf(feeCollector)).to.equal(
        feeCollctorBalanceBefore.add(ethers.utils.parseEther("0"))
      );
    });
  });
});
