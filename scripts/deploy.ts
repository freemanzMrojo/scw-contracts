import { ethers, run } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  encodeParam,
  getDeployerInstance,
  isContract,
} from "./utils";
import { Deployer } from "../typechain";

const provider = ethers.provider;
let entryPointAddress = "";
let baseImpAddress = "";
let fallBackHandlerAddress = "";
const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
const verifyingSigner = "0x416B03E2E5476B6a2d1dfa627B404Da1781e210d";

async function deployEntryPointContract(deployerInstance: Deployer) {
  try {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.ENTRY_POINT)
    );

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPointBytecode = `${EntryPoint.bytecode}`;
    entryPointAddress = await deployerInstance.addressOf(salt);

    console.log("Entry Point Computed Address: ", entryPointAddress);

    const isEntryPointDeployed = await isContract(entryPointAddress, provider); // true (deployed on-chain)
    if (!isEntryPointDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.ENTRY_POINT,
        entryPointAddress,
        salt,
        entryPointBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: entryPointAddress,
        constructorArguments: [],
      });
    } else {
      console.log(
        "Entry Point is Already deployed with address ",
        entryPointAddress
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployCallBackHandlerContract(deployerInstance: Deployer) {
  try {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.FallBACK_HANDLER)
    );

    const callBackHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    const callBackHandlerBytecode = `${callBackHandler.bytecode}`;
    fallBackHandlerAddress = await deployerInstance.addressOf(salt);
    console.log("CallBack Handler Computed Address: ", fallBackHandlerAddress);

    const isCallBackHandlerDeployed = await isContract(
      fallBackHandlerAddress,
      provider
    ); // true (deployed on-chain)
    if (!isCallBackHandlerDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.FallBACK_HANDLER,
        fallBackHandlerAddress,
        salt,
        callBackHandlerBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: fallBackHandlerAddress,
        constructorArguments: [],
      });
    } else {
      console.log(
        "CallBack Handler is Already deployed with address ",
        fallBackHandlerAddress
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployBaseWalletImpContract(deployerInstance: Deployer) {
  try {
    const WALLET_FACTORY_IMP_SALT = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.WALLET_IMP)
    );

    const SmartWallet = await ethers.getContractFactory("SmartAccount");
    const smartWalletBytecode = `${SmartWallet.bytecode}${encodeParam(
      "address",
      entryPointAddress
    ).slice(2)}`;
    baseImpAddress = await deployerInstance.addressOf(WALLET_FACTORY_IMP_SALT);
    console.log("Base wallet Computed Address: ", baseImpAddress);

    let baseImpDeployedAddr;
    const isBaseImpDeployed = await isContract(baseImpAddress, provider); // true (deployed on-chain)
    if (!isBaseImpDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.WALLET_IMP,
        baseImpAddress,
        WALLET_FACTORY_IMP_SALT,
        smartWalletBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: fallBackHandlerAddress,
        constructorArguments: [entryPointAddress],
      });
    } else {
      console.log("Base Imp is already deployed with address ", baseImpAddress);
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployWalletFactoryContract(deployerInstance: Deployer) {
  try {
    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );

    const WALLET_FACTORY_SALT = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.WALLET_FACTORY)
    );

    const walletFactoryBytecode = `${WalletFactory.bytecode}${encodeParam(
      "address",
      baseImpAddress
    ).slice(2)}${encodeParam("address", fallBackHandlerAddress).slice(2)}`;

    const walletFactoryComputedAddr = await deployerInstance.addressOf(
      WALLET_FACTORY_SALT
    );

    console.log("Wallet Factory Computed Address: ", walletFactoryComputedAddr);

    const iswalletFactoryDeployed = await isContract(
      walletFactoryComputedAddr,
      provider
    ); // true (deployed on-chain)
    if (!iswalletFactoryDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.WALLET_FACTORY,
        walletFactoryComputedAddr,
        WALLET_FACTORY_SALT,
        walletFactoryBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: walletFactoryComputedAddr,
        constructorArguments: [baseImpAddress, fallBackHandlerAddress],
      });
    } else {
      console.log(
        "Wallet Factory is Already Deployed with address ",
        walletFactoryComputedAddr
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployGasEstimatorContract(deployerInstance: Deployer) {
  try {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.GAS_ESTIMATOR)
    );

    const gasEstimator = await ethers.getContractFactory("GasEstimator");
    const gasEstimatorBytecode = `${gasEstimator.bytecode}`;
    const gasEstimatorComputedAddr = await deployerInstance.addressOf(salt);

    console.log("gasEstimator Computed Address: ", gasEstimatorComputedAddr);

    const isgasEstimatorDeployed = await isContract(
      gasEstimatorComputedAddr,
      provider
    ); // true (deployed on-chain)
    if (!isgasEstimatorDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.GAS_ESTIMATOR,
        gasEstimatorComputedAddr,
        salt,
        gasEstimatorBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: gasEstimatorComputedAddr,
        constructorArguments: [],
      });
    } else {
      console.log(
        "GasEstimator is Already deployed with address ",
        gasEstimatorComputedAddr
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployDecoderContract(deployerInstance: Deployer) {
  try {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.DECODER)
    );

    const decoder = await ethers.getContractFactory("Decoder");
    const decoderBytecode = `${decoder.bytecode}`;
    const decoderComputedAddr = await deployerInstance.addressOf(salt);

    console.log("decoder Computed Address: ", decoderComputedAddr);

    const isdecoderDeployed = await isContract(decoderComputedAddr, provider); // true (deployed on-chain)
    if (!isdecoderDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.DECODER,
        decoderComputedAddr,
        salt,
        decoderBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: decoderComputedAddr,
        constructorArguments: [],
      });
    } else {
      console.log(
        "decoder is Already deployed with address ",
        decoderComputedAddr
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployMultiSendContract(deployerInstance: Deployer) {
  try {
    const MULTI_SEND_SALT = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.MULTI_SEND)
    );

    const multiSend = await ethers.getContractFactory("MultiSend");
    const multiSendBytecode = `${multiSend.bytecode}`;
    const multiSendComputedAddr = await deployerInstance.addressOf(
      MULTI_SEND_SALT
    );

    console.log("MultiSend Computed Address: ", multiSendComputedAddr);

    const ismultiSendDeployed = await isContract(
      multiSendComputedAddr,
      provider
    ); // true (deployed on-chain)
    if (!ismultiSendDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.MULTI_SEND,
        multiSendComputedAddr,
        MULTI_SEND_SALT,
        multiSendBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: multiSendComputedAddr,
        constructorArguments: [],
      });
    } else {
      console.log(
        "MultiSend is Already deployed with address ",
        multiSendComputedAddr
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployMultiSendCallOnlyContract(deployerInstance: Deployer) {
  try {
    const MULTI_SEND_CALLONLY_SALT = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.MULTI_SEND_CALLONLY)
    );

    const multiSendCallOnly = await ethers.getContractFactory(
      "MultiSendCallOnly"
    );
    const multiSendCallOnlyBytecode = `${multiSendCallOnly.bytecode}`;
    const multiSendCallOnlyComputedAddr = await deployerInstance.addressOf(
      MULTI_SEND_CALLONLY_SALT
    );
    console.log(
      "MultiSend Callonly Computed Address: ",
      multiSendCallOnlyComputedAddr
    );

    const ismultiSendCallOnlyDeployed = await isContract(
      multiSendCallOnlyComputedAddr,
      provider
    ); // true (deployed on-chain)
    if (!ismultiSendCallOnlyDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.MULTI_SEND_CALLONLY,
        multiSendCallOnlyComputedAddr,
        MULTI_SEND_CALLONLY_SALT,
        multiSendCallOnlyBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: multiSendCallOnlyComputedAddr,
        constructorArguments: [],
      });
    } else {
      console.log(
        "MultiSend Call Only is Already deployed with address ",
        multiSendCallOnlyComputedAddr
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function deployVerifySingeltonPaymaster(deployerInstance: Deployer) {
  try {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.SINGELTON_PAYMASTER)
    );

    const VerifyingSingletonPaymaster = await ethers.getContractFactory(
      "VerifyingSingletonPaymaster"
    );
    const verifyingSingletonPaymasterBytecode = `${
      VerifyingSingletonPaymaster.bytecode
    }${encodeParam("address", owner).slice(2)}${encodeParam(
      "address",
      entryPointAddress
    ).slice(2)}${encodeParam("address", verifyingSigner).slice(2)}`;

    const verifyingSingletonPaymasterComputedAddr =
      await deployerInstance.addressOf(salt);
    console.log(
      "verifyingSingletonPaymaster Computed Address: ",
      verifyingSingletonPaymasterComputedAddr
    );
    const isContractDeployed = await isContract(
      verifyingSingletonPaymasterComputedAddr,
      provider
    );
    if (!isContractDeployed) {
      await deployContract(
        DEPLOYMENT_SALTS.SINGELTON_PAYMASTER,
        verifyingSingletonPaymasterComputedAddr,
        salt,
        verifyingSingletonPaymasterBytecode,
        deployerInstance
      );
      await run(`verify:verify`, {
        address: verifyingSingletonPaymasterComputedAddr,
        constructorArguments: [owner, entryPointAddress, verifyingSigner],
      });
    } else {
      console.log(
        "verifyingSingletonPaymaster is Already deployed with address ",
        verifyingSingletonPaymasterComputedAddr
      );
    }
  } catch (err) {
    console.log(err);
  }
}

async function main() {
  const deployerInstance = await getDeployerInstance();
  await deployEntryPointContract(deployerInstance);
  await deployCallBackHandlerContract(deployerInstance);
  await deployBaseWalletImpContract(deployerInstance);
  await deployWalletFactoryContract(deployerInstance);
  await deployGasEstimatorContract(deployerInstance);
  await deployDecoderContract(deployerInstance);
  await deployMultiSendContract(deployerInstance);
  await deployMultiSendCallOnlyContract(deployerInstance);
  await deployVerifySingeltonPaymaster(deployerInstance);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});