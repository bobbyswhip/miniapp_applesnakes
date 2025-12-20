// lib/prediction-market-constants.ts
// Prediction Market Constants for Token Wars

export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const AI_WALLET = "0xE5e9033C57B4332283Cda19B39431CD716340098" as const;
export const BASE_CHAIN_ID = 8453;

// API Base URL - use environment variable or default to external API
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.applesnakes.com";

// Payment limits
export const MIN_BET_USDC = 1;       // $1 minimum bet
export const MAX_BET_USDC = 10000;   // $10,000 maximum bet
export const MIN_SELL_USDC = 0.01;   // $0.01 minimum sell value

// Cooldowns
export const SELL_COOLDOWN_MS = 5000; // 5 seconds between sells

// USDC decimals
export const USDC_DECIMALS = 6;

// =============================================================================
// FEE STRUCTURE - Matches predictionHub.sol
// =============================================================================
export const TOTAL_FEE_BPS = 100;     // 1% total
export const CREATOR_FEE_BPS = 30;    // 0.30%
export const STAKING_FEE_BPS = 65;    // 0.65%
export const PROTOCOL_FEE_BPS = 5;    // 0.05%
export const BPS_DENOMINATOR = 10000;
export const FEE_PERCENT = 0.01;      // 1% as decimal

// EIP-3009 Domain for USDC on Base
export const USDC_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: BASE_CHAIN_ID,
  verifyingContract: USDC_ADDRESS,
} as const;

// EIP-3009 TransferWithAuthorization Types
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// Market types
export type MarketType = "dex_vote" | "pair_vote" | "token_war_sellout";

// Market status types
export type MarketStatus = "active" | "paused" | "closed" | "resolved" | "cancelled";

// Transaction action types
export type TransactionAction = "buy" | "sell" | "seed" | "claim" | "refund";
