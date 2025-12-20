// lib/prediction-market-utils.ts
// Payment utilities and helpers for Token Wars prediction markets
'use client';

import { keccak256, toBytes, getAddress } from "viem";
import {
  USDC_ADDRESS,
  AI_WALLET,
  MIN_BET_USDC,
  MAX_BET_USDC,
  API_BASE,
  USDC_DOMAIN,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  TOTAL_FEE_BPS,
  CREATOR_FEE_BPS,
  STAKING_FEE_BPS,
  PROTOCOL_FEE_BPS,
  BPS_DENOMINATOR,
  FEE_PERCENT,
} from "./prediction-market-constants";

// =============================================================================
// EIP-3009 PAYMENT CREATION
// =============================================================================

export interface WalletClient {
  signTypedData: (params: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
}

export interface PaymentAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * Generate a cryptographically secure nonce for EIP-3009
 */
export function generateNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return ('0x' + Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')) as `0x${string}`;
}

/**
 * Create a payment authorization and sign it using EIP-3009
 */
export async function createPredictionMarketPayment(
  walletClient: WalletClient,
  userAddress: string,
  amountUSDC: number
): Promise<string> {
  const amount = BigInt(Math.floor(amountUSDC * 1_000_000));
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = keccak256(toBytes(`pm-bet-${Date.now()}-${Math.random()}`));

  const domain = {
    name: USDC_DOMAIN.name,
    version: USDC_DOMAIN.version,
    chainId: USDC_DOMAIN.chainId,
    verifyingContract: USDC_ADDRESS,
  };

  const types = {
    TransferWithAuthorization: [...TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization],
  };

  const message = {
    from: getAddress(userAddress),
    to: getAddress(AI_WALLET),
    value: amount,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  const paymentPayload = {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      authorization: {
        from: getAddress(userAddress),
        to: getAddress(AI_WALLET),
        value: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      signature,
    },
  };

  // Use btoa for browser compatibility
  return btoa(JSON.stringify(paymentPayload));
}

/**
 * Create X-PAYMENT header from authorization and signature
 */
export function createPaymentHeader(
  authorization: PaymentAuthorization,
  signature: string
): string {
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
      signature,
    },
  };

  return btoa(JSON.stringify(payload));
}

// =============================================================================
// API CALLS
// =============================================================================

export interface PlaceBetParams {
  marketId: string;
  outcomeIndex: number;
  side: "yes" | "no";
  amountUSDC: number;
  walletClient: WalletClient;
  userAddress: string;
  warId?: string;
}

export interface PlaceBetResult {
  success: boolean;
  bet?: {
    marketId: string;
    outcomeIndex: number;
    side: string;
    amount: number;
    shares: number;
    price: number;
    txHash?: string;
  };
  error?: string;
}

export async function placePredictionBet(params: PlaceBetParams): Promise<PlaceBetResult> {
  const { marketId, outcomeIndex, side, amountUSDC, walletClient, userAddress, warId } = params;

  if (amountUSDC < MIN_BET_USDC) {
    return { success: false, error: `Minimum bet is $${MIN_BET_USDC} USDC` };
  }

  if (amountUSDC > MAX_BET_USDC) {
    return { success: false, error: `Maximum bet is $${MAX_BET_USDC} USDC` };
  }

  try {
    // Create payment authorization
    const paymentHeader = await createPredictionMarketPayment(
      walletClient,
      userAddress,
      amountUSDC
    );

    console.log('[PlaceBet] Sending bet with X-PAYMENT header...');

    // Place bet via local proxy
    const response = await fetch(`${API_BASE}/api/prediction-market/bet/verified`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": paymentHeader,
      },
      body: JSON.stringify({
        marketId,
        outcomeIndex,
        side,
        warId,
      }),
    });

    const result = await response.json();
    console.log('[PlaceBet] Response:', result);
    return result;
  } catch (err) {
    console.error("[PlaceBet] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to place bet",
    };
  }
}

export interface ClaimWinningsParams {
  marketId: string;
  userAddress: string;
}

export async function claimPredictionWinnings(
  params: ClaimWinningsParams
): Promise<{ success: boolean; amount?: number; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/prediction-market/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marketId: params.marketId,
        walletAddress: params.userAddress,
      }),
    });

    return response.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Claim failed",
    };
  }
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format time remaining in human-readable format
 */
export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "Ended";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format odds as multiplier (e.g., "2.50x")
 */
export function formatOdds(odds: number): string {
  return odds.toFixed(2) + "x";
}

/**
 * Format probability as percentage (e.g., "75%")
 */
export function formatProbability(probability: number): string {
  // If probability is 0-1, convert to percentage
  const percent = probability <= 1 ? probability * 100 : probability;
  return percent.toFixed(0) + "%";
}

/**
 * Format USDC amount with dollar sign (e.g., "$5.25")
 */
export function formatUSDC(amount: number): string {
  return "$" + amount.toFixed(2);
}

/**
 * Format shares with appropriate precision
 */
export function formatShares(shares: number): string {
  if (shares < 0.01) return shares.toFixed(6);
  if (shares < 1) return shares.toFixed(4);
  return shares.toFixed(2);
}

/**
 * Format wallet address (truncated)
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Calculate potential payout for a bet
 */
export function calculatePotentialPayout(
  amount: number,
  odds: number
): number {
  return amount * odds;
}

/**
 * Calculate profit/loss percentage
 */
export function calculateProfitLossPercent(
  currentValue: number,
  totalCost: number
): number {
  if (totalCost === 0) return 0;
  return ((currentValue - totalCost) / totalCost) * 100;
}

// =============================================================================
// AMM MATH FORMULAS - Matches predictionHub.sol exactly
// =============================================================================

/**
 * Calculate fee breakdown for an amount
 * Total fee is 1%, split between creator (0.30%), staking (0.65%), protocol (0.05%)
 */
export function calculateFee(amount: number): {
  totalFee: number;
  creatorFee: number;
  stakingFee: number;
  protocolFee: number;
  netAmount: number;
} {
  const totalFee = (amount * TOTAL_FEE_BPS) / BPS_DENOMINATOR;
  const netAmount = amount - totalFee;

  return {
    totalFee,
    creatorFee: (amount * CREATOR_FEE_BPS) / BPS_DENOMINATOR,
    stakingFee: (amount * STAKING_FEE_BPS) / BPS_DENOMINATOR,
    protocolFee: (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR,
    netAmount,
  };
}

/**
 * Calculate shares received when buying
 * Formula: shares = (tokensAfterFee * currentShares) / currentDeposits
 * First buyer: shares = tokensAfterFee (1:1 ratio)
 */
export function calculateSharesOut(
  currentShares: number,
  currentDeposits: number,
  tokensIn: number
): number {
  if (currentShares === 0 || currentDeposits === 0) {
    return tokensIn; // First buyer gets 1:1
  }
  return (tokensIn * currentShares) / currentDeposits;
}

/**
 * Calculate tokens received when selling
 * Formula: tokensOut = (sharesIn * currentDeposits) / currentShares
 * Then apply 1% fee to tokensOut
 */
export function calculateTokensOut(
  currentShares: number,
  currentDeposits: number,
  sharesIn: number
): number {
  if (currentShares === 0) return 0;
  return (sharesIn * currentDeposits) / currentShares;
}

/**
 * Calculate current position value (what user would get if sold now)
 * Formula: currentValue = (userShares * sideDeposits) / totalSharesOnSide
 * Then apply 1% sell fee for realistic exit value
 */
export function calculateCurrentValue(
  userShares: number,
  sideDeposits: number,
  totalSharesOnSide: number
): number {
  if (totalSharesOnSide === 0 || userShares === 0) return 0;

  const grossValue = (userShares * sideDeposits) / totalSharesOnSide;
  const afterFee = grossValue * (1 - FEE_PERCENT); // Apply 1% sell fee
  return afterFee;
}

/**
 * Calculate odds for winner-takes-all markets (DEX vote, Pair vote)
 * Each outcome competes for the total pool
 */
export function calculateWinnerTakesAllOdds(outcomePool: number, totalPool: number): {
  probability: number;
  odds: number;
} {
  const probability = totalPool > 0 ? (outcomePool / totalPool) * 100 : 0;
  const odds = probability > 0 ? 100 / probability : 0;
  return { probability, odds };
}

/**
 * Calculate odds for binary markets (Sellout yes/no)
 * YES and NO compete within the same outcome
 */
export function calculateBinaryOdds(yesPool: number, noPool: number): {
  yesProbability: number;
  noProbability: number;
  yesOdds: number;
  noOdds: number;
} {
  const totalPool = yesPool + noPool;

  const yesProbability = totalPool > 0 ? (yesPool / totalPool) * 100 : 50;
  const noProbability = 100 - yesProbability;

  const yesOdds = yesProbability > 0 ? 100 / yesProbability : 0;
  const noOdds = noProbability > 0 ? 100 / noProbability : 0;

  return { yesProbability, noProbability, yesOdds, noOdds };
}

/**
 * Calculate potential payout for winner-takes-all markets
 * Winner shares split the ENTIRE market pool
 */
export function calculateWinnerTakesAllPayout(
  userShares: number,
  totalSharesOnOutcome: number,
  marketTotalPool: number
): number {
  if (totalSharesOnOutcome === 0) return 0;
  return (userShares / totalSharesOnOutcome) * marketTotalPool;
}

/**
 * Calculate potential payout for binary markets
 * Winner shares split the outcome pool (yes + no pools)
 */
export function calculateBinaryPayout(
  userShares: number,
  totalSharesOnSide: number,
  outcomePool: number
): number {
  if (totalSharesOnSide === 0) return 0;
  return (userShares / totalSharesOnSide) * outcomePool;
}

// =============================================================================
// BET PREVIEW - For displaying expected results before placing bet
// =============================================================================

export interface BetPreview {
  amount: number;
  fee: number;
  netAmount: number;
  expectedShares: number;
  pricePerShare: number;
  newProbability: number;
  potentialPayout: number;
  potentialProfit: number;
  multiplier: number;
}

export interface OutcomeData {
  yesPool: number;
  noPool: number;
  yesShares: number;
  noShares: number;
  totalPool: number;
}

export interface MarketData {
  marketStyle: "binary" | "winner_takes_all";
  totalPool: number;
}

/**
 * Calculate bet preview showing expected results
 */
export function calculateBetPreview(
  amount: number,
  outcome: OutcomeData,
  side: "yes" | "no",
  market: MarketData
): BetPreview {
  const fee = amount * FEE_PERCENT;
  const netAmount = amount - fee;

  const sidePool = side === "yes" ? outcome.yesPool : outcome.noPool;
  const sideShares = side === "yes" ? outcome.yesShares : outcome.noShares;

  // Calculate expected shares
  const expectedShares = calculateSharesOut(sideShares, sidePool, netAmount);
  const pricePerShare = expectedShares > 0 ? netAmount / expectedShares : 0;

  // Calculate new pool state after bet
  const newSidePool = sidePool + netAmount;
  const newSideShares = sideShares + expectedShares;

  // New probability after bet
  let newProbability: number;
  if (market.marketStyle === "winner_takes_all") {
    const newTotalPool = market.totalPool + netAmount;
    newProbability = newTotalPool > 0 ? (newSidePool / newTotalPool) * 100 : 0;
  } else {
    const otherPool = side === "yes" ? outcome.noPool : outcome.yesPool;
    const newOutcomePool = newSidePool + otherPool;
    newProbability = newOutcomePool > 0 ? (newSidePool / newOutcomePool) * 100 : 50;
  }

  // Potential payout if this outcome wins
  let potentialPayout: number;
  if (market.marketStyle === "winner_takes_all") {
    const newTotalPool = market.totalPool + netAmount;
    potentialPayout = newSideShares > 0
      ? (expectedShares / newSideShares) * newTotalPool
      : 0;
  } else {
    const otherPool = side === "yes" ? outcome.noPool : outcome.yesPool;
    const newOutcomePool = newSidePool + otherPool;
    potentialPayout = newSideShares > 0
      ? (expectedShares / newSideShares) * newOutcomePool
      : 0;
  }

  return {
    amount,
    fee,
    netAmount,
    expectedShares,
    pricePerShare,
    newProbability,
    potentialPayout,
    potentialProfit: potentialPayout - amount,
    multiplier: amount > 0 ? potentialPayout / amount : 0,
  };
}

// Re-export constants for convenience
export { USDC_ADDRESS, AI_WALLET, MIN_BET_USDC, MAX_BET_USDC, API_BASE };
