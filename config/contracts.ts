import { base, baseSepolia } from 'wagmi/chains';
import { ERC20_ABI } from '@/abis/erc20';
import { NFT_ABI } from '@/abis/nft';
import { WRAPPER_ABI } from '@/abis/wrapper';
import { QUOTER_ABI } from '@/abis/quoter';
import type { ChainContracts } from './types';

// Uniswap V4 Quoter address on Base
export const QUOTER_ADDRESS = '0x0d5e0f971ed27fbff6c2837bf31316121532048d' as const;

// Pool configuration for ETH/Token swap
export const POOL_CONFIG = {
  currency0: '0x0000000000000000000000000000000000000000', // ETH
  currency1: '0xcc3440d13e1A7805e45b1Bde3376DA5d90d95d55', // Token1
  fee: 3000, // 0.3% fee tier
  tickSpacing: 60,
  hooks: '0xca51C787E7136dB1cbFd92a24287ea8E9363b0c8', // Hook address
} as const;

export { QUOTER_ABI };

/**
 * Contract addresses and configuration for Base Mainnet
 */
export const BASE_MAINNET_CONTRACTS: ChainContracts = {
  nft: {
    address: '0xDAaBc7Ff7874cC80275950372F4b34fFB93CF18F',
    abi: NFT_ABI,
    name: 'Applesnakes NFT',
  },
  token: {
    address: '0xcc3440d13e1A7805e45b1Bde3376DA5d90d95d55',
    abi: ERC20_ABI,
    name: 'Token1',
  },
  wrapper: {
    address: '0x038b70E9311D5aE12C816c32818aeec90cBe7C29',
    abi: WRAPPER_ABI,
    name: 'wTokens',
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
    address: '0xcc3440d13e1A7805e45b1Bde3376DA5d90d95d55',
    abi: ERC20_ABI,
    name: 'Token1 (Testnet)',
  },
  wrapper: {
    address: '0x038b70E9311D5aE12C816c32818aeec90cBe7C29',
    abi: WRAPPER_ABI,
    name: 'wTokens (Testnet)',
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
