import * as dotenv from "dotenv";

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import '@vechain/hardhat-ethers';
import { VECHAIN_URL_SOLO } from '@vechain/hardhat-vechain';
import "hardhat-dependency-compiler";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import { HardhatUserConfig, task } from "hardhat/config";
import { type HttpNetworkConfig } from 'hardhat/types';
import "solidity-coverage";

const walletUtils = require("./walletUtils");

dotenv.config();

const shouldRunInForkMode = !!process.env.FORK_MODE;

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const hardhatAccounts =
  process.env.PRIVATE_KEY !== undefined
    ? [process.env.PRIVATE_KEY]
    : walletUtils.makeKeyList();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  paths: {
    artifacts: "artifacts",
    cache: "cache",
    deploy: "src/deploy",
    sources: "contracts",
  },
  namedAccounts: {
    deployer: 0,
    verifiedSigner: 5,
  },
  solidity: {
    compilers: [
      {
        version: '0.8.17', // Specify the first Solidity version
        settings: {
          // Additional compiler settings for this version
          optimizer: {
            enabled: true,
            runs: 800
          },
          viaIR: true
        }
      },
    ]
  },
  networks: {
    vechain_solo: {
      url: VECHAIN_URL_SOLO,
    },
    vechain_testnet: {
      // Testnet
      url: 'https://testnet.vechain.org',
      accounts: hardhatAccounts,
      debug: true,
      delegator: undefined,
      gas: 'auto',
      gasPrice: 'auto',
      gasMultiplier: 1,
      timeout: 20000,
      httpHeaders: {}
    } satisfies HttpNetworkConfig,
    vechain_mainnet: {
      // Mainnet
      url: 'https://mainnet.vechain.org',
      accounts: hardhatAccounts,
      debug: false,
      delegator: undefined,
      gas: 'auto',
      gasPrice: 'auto',
      gasMultiplier: 1,
      timeout: 20000,
      httpHeaders: {}
    } satisfies HttpNetworkConfig
  }
};

export default config;
