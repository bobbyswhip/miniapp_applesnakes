import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, baseSepolia } from 'wagmi/chains';
import { http, fallback } from 'wagmi';

// API Keys from environment
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const COINBASE_RPC_KEY = process.env.NEXT_PUBLIC_COINBASE_RPC_KEY;

// Flashblocks preconf endpoints for 200ms transaction confirmations
// https://docs.base.org/base-chain/flashblocks/apps
const FLASHBLOCKS_MAINNET = 'https://mainnet-preconf.base.org';
const FLASHBLOCKS_SEPOLIA = 'https://sepolia-preconf.base.org';

// Base Mainnet RPC endpoints in priority order
// Flashblocks first for fastest preconfirmations (200ms)
const BASE_RPC_ENDPOINTS = [
  FLASHBLOCKS_MAINNET, // Flashblocks preconf - 200ms confirmations
  COINBASE_RPC_KEY ? `https://api.developer.coinbase.com/rpc/v1/base/${COINBASE_RPC_KEY}` : null,
  ALCHEMY_KEY ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null,
  'https://mainnet.base.org', // Public fallback
].filter(Boolean) as string[];

// Base Sepolia RPC endpoints
// Flashblocks first for fastest preconfirmations (200ms)
const BASE_SEPOLIA_RPC_ENDPOINTS = [
  FLASHBLOCKS_SEPOLIA, // Flashblocks preconf - 200ms confirmations
  ALCHEMY_KEY ? `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}` : null,
  'https://sepolia.base.org', // Public fallback
].filter(Boolean) as string[];

export const config = getDefaultConfig({
  appName: process.env.NEXT_PUBLIC_APP_NAME || 'Base Crypto Wallet',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [base, baseSepolia],
  transports: {
    [base.id]: fallback(
      BASE_RPC_ENDPOINTS.map((url) =>
        http(url, {
          batch: true,
          retryCount: 3,
          timeout: 30_000,
        })
      )
    ),
    [baseSepolia.id]: fallback(
      BASE_SEPOLIA_RPC_ENDPOINTS.map((url) =>
        http(url, {
          batch: true,
          retryCount: 3,
          timeout: 30_000,
        })
      )
    ),
  },
  ssr: true,
  // Enable wallet storage and connection persistence
  storage: typeof window !== 'undefined' ? window.localStorage as any : undefined,
});
