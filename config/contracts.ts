import { base, baseSepolia } from 'wagmi/chains';
import { ERC20_ABI } from '@/abis/erc20';
import { NFT_ABI } from '@/abis/nft'; // Full ABI with poolIdRaw and hook functions
import { WRAPPER_ABI } from '@/abis/wrapper';
import { QUOTER_ABI } from '@/abis/quoter';
import { STAKING_ABI } from '@/abis/staking';
import { PREDICTION_ABI } from '@/abis/predictionLegacy'; // Legacy combined contract
import { BLACKJACK_ABI } from '@/abis/blackjack'; // New game contract
import { PREDICTION_HUB_ABI } from '@/abis/predictionHub'; // New market hub
import type { ChainContracts } from './types';

// Uniswap V4 Quoter address on Base
export const QUOTER_ADDRESS = '0x0d5e0f971ed27fbff6c2837bf31316121532048d' as const;

// Hook address for V4 Super Strategy
export const HOOK_ADDRESS = '0x77e180e90130FA6e6A4bf4d07cf2032f5f2B70C8' as const;

// Pool Manager address on Base
export const POOL_MANAGER_ADDRESS = '0x498581fF718922c3f8e6A244956aF099B2652b2b' as const;

// Pool configuration for ETH/Token swap
export const POOL_CONFIG = {
  currency0: '0x0000000000000000000000000000000000000000', // ETH
  currency1: '0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6', // Token1
  fee: 3000, // 0.3% fee tier
  tickSpacing: 60,
  hooks: HOOK_ADDRESS, // Hook address
} as const;

export { QUOTER_ABI };

/**
 * Contract addresses and configuration for Base Mainnet
 */
export const BASE_MAINNET_CONTRACTS: ChainContracts = {
  nft: {
    address: '0xa85D49d8B7a041c339D18281a750dE3D7c15A628',
    abi: NFT_ABI,
    name: 'Applesnakes NFT',
  },
  token: {
    address: '0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6',
    abi: ERC20_ABI,
    name: 'Token1',
  },
  wrapper: {
    address: '0x038b70E9311D5aE12C816c32818aeec90cBe7C29',
    abi: WRAPPER_ABI,
    name: 'wTokens',
  },
  staking: {
    address: '0x63b2A9Bd65f516E49Cee75C9001FB5aa3588CB3c',
    abi: STAKING_ABI,
    name: 'Apple Staking',
  },
  prediction: {
    address: '0x6c52a18E604Ba6292B1b2f3A06447B9ae99cD070',
    abi: PREDICTION_ABI,
    name: 'Prediction Jack (Legacy)',
  },
  blackjack: {
    address: '0x466FBE3e5f7A89A05F69070A9b016A68E758c14A',
    abi: BLACKJACK_ABI,
    name: 'Blackjack Game',
  },
  predictionHub: {
    address: '0xcEFE23c5DEA2f5E39B6E5240DE92F99558C3Fa70',
    abi: PREDICTION_HUB_ABI,
    name: 'Prediction Market Hub',
  },
};

/**
 * Contract addresses and configuration for Base Sepolia Testnet
 */
export const BASE_SEPOLIA_CONTRACTS: ChainContracts = {
  nft: {
    address: '0x424f2d63D32122431412394317DA55a317354692',
    abi: NFT_ABI,
    name: 'Applesnakes NFT (Testnet)',
  },
  token: {
    address: '0xc1e1fEf47Ec73b5572494f63234aAC18e344490D',
    abi: ERC20_ABI,
    name: 'Token1 (Testnet)',
  },
  wrapper: {
    address: '0x038b70E9311D5aE12C816c32818aeec90cBe7C29',
    abi: WRAPPER_ABI,
    name: 'wTokens (Testnet)',
  },
  staking: {
    address: '0x0000000000000000000000000000000000000000', // TODO: Deploy to testnet
    abi: STAKING_ABI,
    name: 'Apple Staking (Testnet)',
  },
  prediction: {
    address: '0x0000000000000000000000000000000000000000', // TODO: Deploy to testnet
    abi: PREDICTION_ABI,
    name: 'Prediction Jack (Legacy - Testnet)',
  },
  blackjack: {
    address: '0x0000000000000000000000000000000000000000', // TODO: Deploy to testnet
    abi: BLACKJACK_ABI,
    name: 'Blackjack Game (Testnet)',
  },
  predictionHub: {
    address: '0x0000000000000000000000000000000000000000', // TODO: Deploy to testnet
    abi: PREDICTION_HUB_ABI,
    name: 'Prediction Market Hub (Testnet)',
  },
};

/**
 * Get contracts for a specific chain
 */
export function getContracts(chainId: number): ChainContracts {
  switch (chainId) {
    case base.id:
      return BASE_MAINNET_CONTRACTS;
    case baseSepolia.id:
      return BASE_SEPOLIA_CONTRACTS;
    default:
      return BASE_MAINNET_CONTRACTS;
  }
}

/**
 * All contracts indexed by chain
 */
export const CONTRACTS = {
  [base.id]: BASE_MAINNET_CONTRACTS,
  [baseSepolia.id]: BASE_SEPOLIA_CONTRACTS,
};

/**
 * Helper to get NFT contract address for current chain
 */
export const NFT_ADDRESS = (chainId: number) => getContracts(chainId).nft.address;

/**
 * Helper to get Token contract address for current chain
 */
export const TOKEN_ADDRESS = (chainId: number) => getContracts(chainId).token.address;

/**
 * Helper to get Staking contract address for current chain
 */
export const STAKING_ADDRESS = (chainId: number) => getContracts(chainId).staking.address;

/**
 * Helper to get Prediction contract address for current chain (Legacy)
 */
export const PREDICTION_ADDRESS = (chainId: number) => getContracts(chainId).prediction.address;

/**
 * Helper to get Blackjack contract address for current chain
 */
export const BLACKJACK_ADDRESS = (chainId: number) => getContracts(chainId).blackjack.address;

/**
 * Helper to get PredictionHub contract address for current chain
 */
export const PREDICTION_HUB_ADDRESS = (chainId: number) => getContracts(chainId).predictionHub.address;
