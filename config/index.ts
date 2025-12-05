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
  STAKING_ADDRESS,
  PREDICTION_ADDRESS,
  BLACKJACK_ADDRESS,
  PREDICTION_HUB_ADDRESS,
  QUOTER_ADDRESS,
  QUOTER_ABI,
  POOL_CONFIG,
  HOOK_ADDRESS,
  POOL_MANAGER_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS,
  PERMIT2_ADDRESS,
  STATE_VIEW_ADDRESS,
  OPENSEA_COLLECTION_URL,
  // Token pair configuration for chart system
  TOKEN_PAIRS,
  WASS_TOKEN_ADDRESS,
  ETH_ADDRESS,
  getDefaultPair,
  getTokenPairById,
  getAllTokenAddresses,
} from './contracts';

export type { ContractConfig, ChainContracts, AppContracts } from './types';
export type { TokenPairConfig } from './contracts';
