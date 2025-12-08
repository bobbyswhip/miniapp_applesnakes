import { base, baseSepolia } from 'wagmi/chains';
import { ERC20_ABI } from '@/abis/erc20';
import { NFT_ABI } from '@/abis/nft'; // Full ABI with poolIdRaw and hook functions
import { WRAPPER_ABI } from '@/abis/wrapper';
import { QUOTER_ABI } from '@/abis/quoter';
import { STAKING_ABI } from '@/abis/staking';
import { PREDICTION_ABI } from '@/abis/predictionLegacy'; // Legacy combined contract
import { BLACKJACK_ABI } from '@/abis/blackjack'; // New game contract
import { PREDICTION_HUB_ABI } from '@/abis/predictionHub'; // New market hub
import { WASSOTC_ABI } from '@/abis/wassotc'; // wASS OTC hybrid swap
import type { ChainContracts } from './types';

// Uniswap V4 Quoter address on Base
export const QUOTER_ADDRESS = '0x0d5e0f971ed27fbff6c2837bf31316121532048d' as const;

// Hook address for V4 Super Strategy
export const HOOK_ADDRESS = '0x77e180e90130FA6e6A4bf4d07cf2032f5f2B70C8' as const;

// Pool Manager address on Base
export const POOL_MANAGER_ADDRESS = '0x498581fF718922c3f8e6A244956aF099B2652b2b' as const;

// Universal Router V4 address on Base
export const UNIVERSAL_ROUTER_ADDRESS = '0x6ff5693b99212da76ad316178a184ab56d299b43' as const;

// Permit2 address (same on all chains)
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

// StateView for V4 pool queries
export const STATE_VIEW_ADDRESS = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71' as const;

// External links
export const OPENSEA_COLLECTION_URL = 'https://opensea.io/collection/applesnakes' as const;

// ============================================================================
// IPNS/IPFS Configuration for NFT Metadata and Images
// ============================================================================
// IPNS provides mutable addresses - metadata always points to latest version
// This allows updating metadata without changing tokenURI on-chain
// ============================================================================

// IPNS key for AppleSnakes metadata (points to latest metadata folder)
export const IPNS_KEY = 'k51qzi5uqu5diqasdnw3fydh31emy8lksdygkl4ycimvxqaj22oeekiclww6mc' as const;

// Primary gateway for IPNS resolution
export const IPNS_GATEWAY = 'https://applesnakes.myfilebase.com' as const;

// Legacy IPFS gateway (for backwards compatibility with cached data)
export const LEGACY_IPFS_GATEWAY = 'https://surrounding-amaranth-catshark.myfilebase.com' as const;

/**
 * Get NFT metadata URL via IPNS (always returns latest version)
 * @param tokenId - The token ID
 * @returns Full URL to the metadata JSON
 */
export const getNFTMetadataUrl = (tokenId: number): string => {
  return `${IPNS_GATEWAY}/ipns/${IPNS_KEY}/${tokenId}.json`;
};

/**
 * Get NFT image URL via IPNS (always returns latest version)
 * @param tokenId - The token ID
 * @returns Full URL to the image
 */
export const getNFTImageUrl = (tokenId: number): string => {
  return `${IPNS_GATEWAY}/ipns/${IPNS_KEY}/${tokenId}.png`;
};

/**
 * Convert any IPFS/IPNS URL to use our gateway
 * Handles:
 * - ipfs://CID/path → gateway URL
 * - ipns://key/path → gateway URL
 * - Already full URLs → returns as-is
 * - Bare paths (e.g., "QmHash/1.png") → prepends gateway
 * @param url - The URL or path to convert
 * @returns Full gateway URL
 */
export const resolveIPFSUrl = (url: string): string => {
  if (!url) return '';

  // Already a full HTTP URL - return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // IPNS URL
  if (url.startsWith('ipns://')) {
    return `${IPNS_GATEWAY}/ipns/${url.replace('ipns://', '')}`;
  }

  // IPFS URL
  if (url.startsWith('ipfs://')) {
    return `${IPNS_GATEWAY}/ipfs/${url.replace('ipfs://', '')}`;
  }

  // Bare path (assume IPFS CID/path format)
  return `${IPNS_GATEWAY}/ipfs/${url}`;
};

// Pool configuration for ETH/Token swap
export const POOL_CONFIG = {
  currency0: '0x0000000000000000000000000000000000000000', // ETH
  currency1: '0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6', // Token1
  fee: 3000, // 0.3% fee tier
  tickSpacing: 60,
  hooks: HOOK_ADDRESS, // Hook address
} as const;

// Token Pair Configuration for Chart System
export interface TokenPairConfig {
  id: string;
  token0: `0x${string}`;
  token1: `0x${string}`;
  hook: `0x${string}`;
  fee: number;
  tickSpacing: number;
  geckoPoolAddress: string; // GeckoTerminal pool address for chart data
  isDefault?: boolean;
}

// wASS token address (base token for all pairs)
export const WASS_TOKEN_ADDRESS = '0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6' as const;

// ETH represented as zero address
export const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Available token pairs for chart display
// Names/symbols are fetched dynamically via RPC - just store addresses here
export const TOKEN_PAIRS: TokenPairConfig[] = [
  {
    id: 'wass-eth',
    token0: ETH_ADDRESS, // ETH (native)
    token1: WASS_TOKEN_ADDRESS, // wASS
    hook: HOOK_ADDRESS,
    fee: 3000,
    tickSpacing: 60,
    geckoPoolAddress: '0xa113103448f7b09199e019656f377988c87f8f312ddcebc6fea9e78bcd6ec2af',
    isDefault: true,
  },
  {
    id: 'wass-token',
    token0: WASS_TOKEN_ADDRESS, // wASS is token0
    token1: '0x9B26FcCf0C90C2DAf54B82FeF07dDBF21E11c658', // Paired token (name fetched via RPC)
    hook: '0x35B9b5b023897DA8C7375ba6141245B8416460CC' as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    geckoPoolAddress: '0xe4821b1cbfce1906c2249d1b34366610960c01fa3f762b0579c594d2033b9152',
  },
];

// Get default token pair
export const getDefaultPair = (): TokenPairConfig => {
  return TOKEN_PAIRS.find(p => p.isDefault) || TOKEN_PAIRS[0];
};

// Get token pair by ID
export const getTokenPairById = (id: string): TokenPairConfig | undefined => {
  return TOKEN_PAIRS.find(p => p.id === id);
};

// Get all unique token addresses from pairs (excluding ETH)
export const getAllTokenAddresses = (): `0x${string}`[] => {
  const addresses = new Set<`0x${string}`>();
  TOKEN_PAIRS.forEach(pair => {
    if (pair.token0 !== ETH_ADDRESS) addresses.add(pair.token0);
    if (pair.token1 !== ETH_ADDRESS) addresses.add(pair.token1);
  });
  return Array.from(addresses);
};

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
    address: '0x7a02CE55Ad7D01C93afb514282E816063B6e31eF',
    abi: BLACKJACK_ABI,
    name: 'Blackjack Game',
  },
  predictionHub: {
    address: '0x6d16424EC2b3f0dd42481d31FFD3Dc0CD25cAa78',
    abi: PREDICTION_HUB_ABI,
    name: 'Prediction Market Hub',
  },
  otc: {
    address: '0xD39bcE42ad5Cf7704e74206aD9551206fa0aD98a',
    abi: WASSOTC_ABI,
    name: 'wASS OTC Router',
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
  otc: {
    address: '0x0000000000000000000000000000000000000000', // TODO: Deploy to testnet
    abi: WASSOTC_ABI,
    name: 'wASS OTC Swap (Testnet)',
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
