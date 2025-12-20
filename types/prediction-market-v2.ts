// types/prediction-market-v2.ts
// TypeScript types for TokenWarsPredictionMarket V2 (On-Chain)

// =============================================================================
// CONTRACT ADDRESSES
// =============================================================================

export const PREDICTION_MARKET_V2_ADDRESS = "0xCC71e190c8209C29421345C95F43591391413204" as const;
export const WASS_ADDRESS = "0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6" as const;
export const OTC_ROUTER_ADDRESS = "0xD39bcE42ad5Cf7704e74206aD9551206fa0aD98a" as const;

// =============================================================================
// ENUMS (Matching Contract)
// =============================================================================

export enum MarketStatusV2 {
  None = 0,
  Active = 1,
  Resolved = 2,
  Closed = 3,
}

export enum MarketTypeV2 {
  DexVote = 0,   // 3 outcomes: Uniswap, Aerodrome, Clankerdome
  PairVote = 1, // 2 outcomes: ETH pair, wASS pair
  Sellout = 2,  // Binary: Yes/No
}

// =============================================================================
// OUTCOME LABELS
// =============================================================================

export const OUTCOME_LABELS_V2: Record<MarketTypeV2, string[]> = {
  [MarketTypeV2.DexVote]: ["Uniswap", "Aerodrome", "Clankerdome"],
  [MarketTypeV2.PairVote]: ["ETH Pair", "wASS Pair"],
  [MarketTypeV2.Sellout]: ["Yes", "No"],
};

// Market type display names
export const MARKET_TYPE_NAMES: Record<MarketTypeV2, string> = {
  [MarketTypeV2.DexVote]: "DEX Vote",
  [MarketTypeV2.PairVote]: "Pair Vote",
  [MarketTypeV2.Sellout]: "Sellout",
};

// Market type icons
export const MARKET_TYPE_ICONS: Record<MarketTypeV2, string> = {
  [MarketTypeV2.DexVote]: "🏦",
  [MarketTypeV2.PairVote]: "💱",
  [MarketTypeV2.Sellout]: "🎯",
};

// =============================================================================
// RAW CONTRACT RETURN TYPES
// =============================================================================

export interface RawMarketData {
  warId: `0x${string}`;
  marketType: number;
  status: number;
  createdAt: bigint;
  resolvedAt: bigint;
  totalDeposits: bigint;
  numOutcomes: number;
  winningOutcome: number;
  creator: `0x${string}`;
}

export interface RawMarketInfo {
  warId: `0x${string}`;
  marketTypeNum: number;
  statusNum: number;
  totalDeposits: bigint;
  numOutcomes: number;
  winningOutcome: number;
  outcomeTotalShares: readonly bigint[];
  outcomeTotalDeposits: readonly bigint[];
  outcomePrices: readonly bigint[];
}

export interface RawUserMarketInfo {
  shares: readonly bigint[];
  depositedAmounts: readonly bigint[];
  claimed: readonly boolean[];
  potentialPayouts: readonly bigint[];
  claimableAmount: bigint;
}

export interface RawETHQuote {
  swapPortion: bigint;
  otcPortion: bigint;
  otcAvailable: bigint;
  hasOtc: boolean;
}

export interface RawSharesEstimate {
  sharesOut: bigint;
  fee: bigint;
}

export interface RawTokensEstimate {
  wassOut: bigint;
  fee: bigint;
}

// =============================================================================
// PROCESSED TYPES (Frontend-Friendly)
// =============================================================================

export interface OutcomeInfoV2 {
  index: number;          // 1-indexed (matches contract)
  label: string;
  totalShares: bigint;
  totalDeposits: bigint;
  priceBps: bigint;       // Raw BPS value from contract
  probability: number;    // Percentage (0-100)
}

export interface MarketInfoV2 {
  marketId: number;
  warId: `0x${string}`;
  warIdHex: string;       // Hex string for display
  marketType: MarketTypeV2;
  marketTypeName: string;
  status: MarketStatusV2;
  statusName: string;
  totalDeposits: bigint;
  totalDepositsFormatted: string;
  numOutcomes: number;
  winningOutcome: number;
  createdAt: number;
  resolvedAt: number;
  creator: `0x${string}`;
  outcomes: OutcomeInfoV2[];
  isActive: boolean;
  isResolved: boolean;
  isClosed: boolean;
}

export interface UserPositionV2 {
  outcomeIndex: number;
  outcomeLabel: string;
  shares: bigint;
  sharesFormatted: string;
  depositedAmount: bigint;
  depositedFormatted: string;
  claimed: boolean;
  potentialPayout: bigint;
  potentialPayoutFormatted: string;
  profitLoss: bigint;
  profitLossFormatted: string;
  profitLossPercent: number;
}

export interface UserMarketInfoV2 {
  marketId: number;
  positions: UserPositionV2[];
  claimableAmount: bigint;
  claimableFormatted: string;
  hasWinningPosition: boolean;
  totalInvested: bigint;
  totalInvestedFormatted: string;
}

export interface ETHQuoteV2 {
  swapPortion: bigint;
  otcPortion: bigint;
  totalWassOut: bigint;
  totalWassFormatted: string;
  otcAvailable: bigint;
  hasOtc: boolean;
}

export interface SharesEstimateV2 {
  sharesOut: bigint;
  sharesFormatted: string;
  fee: bigint;
  feeFormatted: string;
  effectivePrice: number; // wASS per share
}

export interface TokensEstimateV2 {
  wassOut: bigint;
  wassFormatted: string;
  fee: bigint;
  feeFormatted: string;
}

// =============================================================================
// HOOK RETURN TYPES
// =============================================================================

export interface UseMarketInfoResult {
  market: MarketInfoV2 | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseUserPositionResult {
  position: UserMarketInfoV2 | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseWarMarketsResult {
  marketIds: number[];
  markets: MarketInfoV2[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseBuySharesResult {
  buyShares: (marketId: number, outcomeIndex: number, wassAmount: bigint) => Promise<`0x${string}`>;
  buySharesWithETH: (marketId: number, outcomeIndex: number, ethAmount: bigint, minWassOut?: bigint) => Promise<`0x${string}`>;
  isLoading: boolean;
  error: Error | null;
}

export interface UseSellSharesResult {
  sellShares: (marketId: number, outcomeIndex: number, sharesToSell: bigint) => Promise<`0x${string}`>;
  isLoading: boolean;
  error: Error | null;
}

export interface UseClaimResult {
  claimWinnings: (marketId: number) => Promise<`0x${string}`>;
  claimRefund: (marketId: number) => Promise<`0x${string}`>;
  isLoading: boolean;
  error: Error | null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert war ID string to bytes32
 */
export function warIdToBytes32(warId: string): `0x${string}` {
  // If already hex, return as-is (padded to 32 bytes)
  if (warId.startsWith('0x')) {
    return warId.padEnd(66, '0') as `0x${string}`;
  }
  // Otherwise, hash the string to get bytes32
  // Using keccak256 style hashing (will be done in the hook with viem)
  return `0x${warId.padEnd(64, '0')}` as `0x${string}`;
}

/**
 * Get status display name
 */
export function getStatusName(status: MarketStatusV2): string {
  switch (status) {
    case MarketStatusV2.None: return "None";
    case MarketStatusV2.Active: return "Active";
    case MarketStatusV2.Resolved: return "Resolved";
    case MarketStatusV2.Closed: return "Closed";
    default: return "Unknown";
  }
}

/**
 * Get status color class
 */
export function getStatusColor(status: MarketStatusV2): string {
  switch (status) {
    case MarketStatusV2.Active: return "text-green-400";
    case MarketStatusV2.Resolved: return "text-blue-400";
    case MarketStatusV2.Closed: return "text-red-400";
    default: return "text-gray-400";
  }
}

/**
 * Get outcome color based on index (for visualization)
 */
export function getOutcomeColor(index: number, marketType: MarketTypeV2): string {
  if (marketType === MarketTypeV2.DexVote) {
    const colors = ["bg-purple-500", "bg-blue-500", "bg-orange-500"];
    return colors[index - 1] || "bg-gray-500";
  }
  if (marketType === MarketTypeV2.PairVote) {
    const colors = ["bg-indigo-500", "bg-green-500"];
    return colors[index - 1] || "bg-gray-500";
  }
  // Sellout (Yes/No)
  const colors = ["bg-green-500", "bg-red-500"];
  return colors[index - 1] || "bg-gray-500";
}

/**
 * Format wASS amount (18 decimals)
 */
export function formatWASS(amount: bigint, decimals: number = 2): string {
  const formatted = Number(amount) / 1e18;
  return formatted.toFixed(decimals);
}

/**
 * Parse wASS amount from string
 */
export function parseWASS(amount: string): bigint {
  const parsed = parseFloat(amount);
  return BigInt(Math.floor(parsed * 1e18));
}

/**
 * Format ETH amount
 */
export function formatETH(amount: bigint, decimals: number = 4): string {
  const formatted = Number(amount) / 1e18;
  return formatted.toFixed(decimals);
}

/**
 * Parse ETH amount from string
 */
export function parseETH(amount: string): bigint {
  const parsed = parseFloat(amount);
  return BigInt(Math.floor(parsed * 1e18));
}

/**
 * Calculate profit/loss percentage
 */
export function calculateProfitLossPercent(currentValue: bigint, invested: bigint): number {
  if (invested === 0n) return 0;
  return Number((currentValue - invested) * 10000n / invested) / 100;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const BPS_DENOMINATOR = 10000;
export const FEE_BPS = 100; // 1% fee
export const MIN_LIQUIDITY = BigInt(1e18); // 1 wASS minimum
