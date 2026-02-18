// lib/api-config.ts
// Centralized API configuration for Token Wars

/**
 * Token Wars API base URL
 * Uses NEXT_PUBLIC_TOKEN_WARS_API environment variable
 * Falls back to production URL if not set
 */
export const TOKEN_WARS_API = process.env.NEXT_PUBLIC_TOKEN_WARS_API || 'https://api.lemonaid.finance/api';

/**
 * Legacy API base URL (for backward compatibility during migration)
 */
export const LEGACY_API_BASE = 'https://api.applesnakes.com';

/**
 * API endpoints configuration
 * TOKEN_WARS_API includes /api from env (e.g., https://api.lemonaid.finance/api)
 */
export const API_ENDPOINTS = {
  // Token Wars core endpoints
  tokenWars: `${TOKEN_WARS_API}/token-wars`,
  tokenWarsById: (id: string) => `${TOKEN_WARS_API}/token-wars/${id}`,
  tokenWarsCreate: `${TOKEN_WARS_API}/token-wars`,
  tokenWarsBuy: `${TOKEN_WARS_API}/token-wars/buy`,
  tokenWarsBuyX402: (amount: number) => `${TOKEN_WARS_API}/token-wars/buy/x402?amount=${amount}`,
  tokenWarsQuoteTokens: `${TOKEN_WARS_API}/token-wars/quote-tokens`,
  tokenWarsTokens: `${TOKEN_WARS_API}/token-wars/tokens`,
  tokenWarsWallet: (address: string) => `${TOKEN_WARS_API}/token-wars/wallet/${address}`,
  tokenWarsLaunch: `${TOKEN_WARS_API}/token-wars/launch`,
  tokenWarsAdmin: `${TOKEN_WARS_API}/token-wars/admin`,
  tokenWarsAnalytics: `${TOKEN_WARS_API}/token-wars/analytics`,
  tokenWarsAirdrop: `${TOKEN_WARS_API}/token-wars/airdrop`,
  tokenWarsWatcher: `${TOKEN_WARS_API}/token-wars/watcher`,
  tokenWarsEarnings: `${TOKEN_WARS_API}/token-wars/earnings`,
  tokenWarsClose: `${TOKEN_WARS_API}/token-wars/close`,
  tokenWarsClosePreview: (warId: string) => `${TOKEN_WARS_API}/token-wars/close?warId=${encodeURIComponent(warId)}`,

  // Vesting endpoints
  vestingSummary: (address: string) => `${TOKEN_WARS_API}/token-wars/vesting/${address}/summary`,
  vestingPositions: (address: string, activeOnly = true, limit = 50, offset = 0) =>
    `${TOKEN_WARS_API}/token-wars/vesting/${address}/positions?activeOnly=${activeOnly}&limit=${limit}&offset=${offset}`,
  vestingClaimable: (address: string, token?: string) =>
    token
      ? `${TOKEN_WARS_API}/token-wars/vesting/${address}/claimable?token=${token}`
      : `${TOKEN_WARS_API}/token-wars/vesting/${address}/claimable`,
  vestingPosition: (positionId: string) => `${TOKEN_WARS_API}/token-wars/vesting/position/${positionId}`,
  vestingClaimTx: (positionId: string) => `${TOKEN_WARS_API}/token-wars/vesting/claim/${positionId}/tx`,
  vestingClaimAllTx: (address: string, token?: string) =>
    token
      ? `${TOKEN_WARS_API}/token-wars/vesting/${address}/claim-all/tx?token=${token}`
      : `${TOKEN_WARS_API}/token-wars/vesting/${address}/claim-all/tx`,
  vestingContractInfo: `${TOKEN_WARS_API}/token-wars/vesting/contract-info`,

  // Prediction markets
  predictionMarkets: `${TOKEN_WARS_API}/prediction-markets`,

  // Airdrop endpoints (legacy token drips)
  airdrop: (address: string) => `${TOKEN_WARS_API}/token-wars/airdrop/${address}`,

  // Participation history
  participation: (address: string) => `${TOKEN_WARS_API}/token-wars/participation/${address}`,

  // x402 payment status
  x402Status: `${TOKEN_WARS_API}/x402/status`,

  // Health check
  health: `${TOKEN_WARS_API.replace('/api', '')}/health`,
} as const;
