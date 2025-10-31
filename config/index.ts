/**
 * Central export for contract configuration
 * Import using: import { CONTRACTS, getContracts, NFT_ADDRESS } from '@/config';
 */

export {
  CONTRACTS,
  BASE_MAINNET_CONTRACTS,
  BASE_SEPOLIA_CONTRACTS,
  getContracts,
  NFT_ADDRESS,
  TOKEN_ADDRESS,
  QUOTER_ADDRESS,
  QUOTER_ABI,
  POOL_CONFIG,
} from './contracts';

export type { ContractConfig, ChainContracts, AppContracts } from './types';
