/**
 * BondedItems V7 Contract Types
 * ERC1155 Items with CPMM Bonding Curves + Dynamic Fees
 */

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Token lifecycle phases
 */
export enum TokenPhase {
  None = 0,          // Token doesn't exist
  Presale = 1,       // Active presale
  BondingCurve = 2,  // Trading on bonding curve
  RareItem = 3,      // Marketplace only (no trading)
}

export const TOKEN_PHASE_NAMES: Record<TokenPhase, string> = {
  [TokenPhase.None]: 'None',
  [TokenPhase.Presale]: 'Presale',
  [TokenPhase.BondingCurve]: 'Trading',
  [TokenPhase.RareItem]: 'Rare Item',
};

// ═══════════════════════════════════════════════════════════════════════════
// RAW CONTRACT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw token config from contract
 */
export interface RawTokenConfig {
  creator: `0x${string}`;
  presalePrice: bigint;
  presaleSupply: bigint;
  presaleSold: bigint;
  presaleWassCollected: bigint;
  phase: number;
  exists: boolean;
}

/**
 * Raw bonding curve from contract (legacy)
 */
export interface RawBondingCurve {
  virtualWass: bigint;
  virtualTokens: bigint;
  realWass: bigint;
  circulatingSupply: bigint;
  active: boolean;
}

/**
 * V7 CPMM Curve Info (x * y = k)
 * Full curve state from getCurveInfo()
 */
export interface CPMMCurveInfo {
  virtualTokenReserve: bigint;
  wassReserve: bigint;
  k: bigint;                    // Constant product (x * y)
  currentPrice: bigint;
  position: bigint;             // Current position on curve
  initialTokenReserve: bigint;
  initialWassReserve: bigint;
  minTokenReserve: bigint;
  minWassReserve: bigint;
  adminMinted: bigint;
  active: boolean;
}

/**
 * V7 Dynamic Fee Info
 * Fee varies 1-20% based on reserve ratio
 */
export interface FeeInfo {
  currentFeeBps: number;        // Current fee in basis points (100-2000)
  reserveRatio: bigint;         // Current reserve ratio
  creatorShareBps: number;      // Creator's share (30% = 3000)
  stakerShareBps: number;       // Staker's share (70% = 7000)
}

/**
 * Raw token stats from contract
 */
export interface RawTokenStats {
  totalVolume: bigint;
  totalFees: bigint;
  totalTrades: bigint;
  creatorEarnings: bigint;
  stakerRewards: bigint;
  liquidityAdded: bigint;
}

/**
 * Raw global stats from contract
 */
export interface RawGlobalStats {
  totalPresaleVolume: bigint;
  totalCurveVolume: bigint;
  totalFeesCollected: bigint;
  totalCreatorPayouts: bigint;
  totalStakerRewards: bigint;
  totalTokens: bigint;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSED TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Processed item info for frontend
 */
export interface BondedItem {
  tokenId: bigint;
  creator: `0x${string}`;
  phase: TokenPhase;
  phaseName: string;
  exists: boolean;

  // Presale info
  presalePrice: bigint;
  presalePriceFormatted: string;
  presaleSupply: bigint;
  presaleSold: bigint;
  presaleRemaining: bigint;
  presaleProgress: number; // 0-100

  // Current price (presale or curve)
  currentPrice: bigint;
  currentPriceFormatted: string;

  // Bonding curve info (if in BondingCurve phase)
  curve?: {
    virtualWass: bigint;
    virtualTokens: bigint;
    realWass: bigint;
    realWassFormatted: string;
    circulatingSupply: bigint;
    active: boolean;
  };

  // Stats
  stats?: {
    totalVolume: bigint;
    totalVolumeFormatted: string;
    totalFees: bigint;
    totalTrades: bigint;
    creatorEarnings: bigint;
    stakerRewards: bigint;
    liquidityAdded: bigint;
  };

  // Metadata (fetched separately)
  name?: string;
  description?: string;
  imageUrl?: string;
  metadataUri?: string;
}

/**
 * User's item balance
 */
export interface UserItemBalance {
  tokenId: bigint;
  balance: bigint;
  item?: BondedItem;
}

/**
 * Quote for buying from curve (V7)
 * Input: tokenAmount (how many tokens to buy)
 * Returns: wassCost, fee, totalCost, newPrice, slippageBps, feeBps
 */
export interface BuyQuote {
  wassCost: bigint;
  wassCostFormatted: string;
  fee: bigint;
  feeFormatted: string;
  totalCost: bigint;
  totalCostFormatted: string;
  newPrice: bigint;
  newPriceFormatted: string;
  priceImpact: number; // percentage
  slippageBps: number; // V7: slippage in basis points
  feeBps: number;      // V7: dynamic fee in basis points (100-2000)
}

/**
 * Quote for selling to curve (V7)
 * Input: tokenAmount (how many tokens to sell)
 * Returns: wassReturn, fee, netReturn, newPrice, slippageBps, feeBps
 */
export interface SellQuote {
  wassReturn: bigint;
  wassReturnFormatted: string;
  fee: bigint;
  feeFormatted: string;
  netReturn: bigint;
  netReturnFormatted: string;
  newPrice: bigint;
  newPriceFormatted: string;
  priceImpact: number; // percentage
  slippageBps: number; // V7: slippage in basis points
  feeBps: number;      // V7: dynamic fee in basis points (100-2000)
}

/**
 * Global stats for all items
 */
export interface GlobalItemStats {
  totalPresaleVolume: bigint;
  totalPresaleVolumeFormatted: string;
  totalCurveVolume: bigint;
  totalCurveVolumeFormatted: string;
  totalVolume: bigint;
  totalVolumeFormatted: string;
  totalFeesCollected: bigint;
  totalFeesFormatted: string;
  totalCreatorPayouts: bigint;
  totalCreatorPayoutsFormatted: string;
  totalStakerRewards: bigint;
  totalStakerRewardsFormatted: string;
  totalTokens: bigint;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format wASS amount (18 decimals)
 * Handles bigint, number, and string inputs defensively
 */
export function formatWass(amount: bigint | number | string, decimals: number = 2): string {
  // Convert to number, handling all possible input types
  let numAmount: number;

  if (typeof amount === 'bigint') {
    numAmount = Number(amount);
  } else if (typeof amount === 'string') {
    // Handle string representations of large numbers
    numAmount = parseFloat(amount);
  } else if (typeof amount === 'number') {
    numAmount = amount;
  } else {
    // Fallback for any unexpected type
    numAmount = Number(amount);
  }

  // Divide by 10^18 to convert from wei to token units
  const formatted = numAmount / 1e18;

  // Debug logging
  console.log('[formatWass] input:', amount, 'type:', typeof amount, 'numAmount:', numAmount, 'formatted:', formatted, 'result:', formatted.toFixed(decimals));

  return formatted.toFixed(decimals);
}

/**
 * Parse wASS amount to bigint
 */
export function parseWass(amount: string): bigint {
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return 0n;
  return BigInt(Math.floor(parsed * 1e18));
}

/**
 * Calculate price impact percentage
 */
export function calculatePriceImpact(oldPrice: bigint, newPrice: bigint): number {
  if (oldPrice === 0n) return 0;
  const impact = Number((newPrice - oldPrice) * 10000n / oldPrice) / 100;
  return Math.abs(impact);
}

/**
 * Process raw token info to BondedItem
 */
export function processTokenInfo(
  tokenId: bigint,
  rawInfo: readonly [
    `0x${string}`,   // creator
    bigint,          // presalePrice
    bigint,          // presaleSupply
    bigint,          // presaleSold
    number,          // phase
    bigint,          // currentPrice
    bigint,          // curveRealWass
    bigint           // curveCirculatingSupply
  ],
  rawCurve?: readonly [bigint, bigint, bigint, bigint, boolean],
  rawStats?: readonly [bigint, bigint, bigint, bigint, bigint, bigint]
): BondedItem {
  const [
    creator,
    presalePrice,
    presaleSupply,
    presaleSold,
    phaseNum,
    currentPrice,
    curveRealWass,
    curveCirculatingSupply,
  ] = rawInfo;

  const phase = phaseNum as TokenPhase;
  const presaleRemaining = presaleSupply > presaleSold ? presaleSupply - presaleSold : 0n;
  const presaleProgress = presaleSupply > 0n
    ? Number((presaleSold * 100n) / presaleSupply)
    : 0;

  const item: BondedItem = {
    tokenId,
    creator,
    phase,
    phaseName: TOKEN_PHASE_NAMES[phase] || 'Unknown',
    exists: true,

    presalePrice,
    presalePriceFormatted: formatWass(presalePrice, 4),
    presaleSupply,
    presaleSold,
    presaleRemaining,
    presaleProgress,

    currentPrice,
    currentPriceFormatted: formatWass(currentPrice, 4),
  };

  // Add curve info if available
  if (rawCurve && phase === TokenPhase.BondingCurve) {
    const [virtualWass, virtualTokens, realWass, circulatingSupply, active] = rawCurve;
    item.curve = {
      virtualWass,
      virtualTokens,
      realWass,
      realWassFormatted: formatWass(realWass),
      circulatingSupply,
      active,
    };
  } else if (phase === TokenPhase.BondingCurve) {
    // Fallback if curve data wasn't fetched separately
    item.curve = {
      virtualWass: 0n,
      virtualTokens: 0n,
      realWass: curveRealWass,
      realWassFormatted: formatWass(curveRealWass),
      circulatingSupply: curveCirculatingSupply,
      active: true,
    };
  }

  // Add stats if available
  if (rawStats) {
    const [totalVolume, totalFees, totalTrades, creatorEarnings, stakerRewards, liquidityAdded] = rawStats;
    item.stats = {
      totalVolume,
      totalVolumeFormatted: formatWass(totalVolume),
      totalFees,
      totalTrades,
      creatorEarnings,
      stakerRewards,
      liquidityAdded,
    };
  }

  return item;
}

/**
 * Process raw global stats (V7: 10 values)
 * [totalPresaleVolume, totalCurveVolume, totalBuyVolume, totalSellVolume, totalFeesCollected,
 *  totalCreatorPayouts, totalStakerRewards, totalBuys, totalSells, totalTokens]
 */
export function processGlobalStats(
  rawStats: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
): GlobalItemStats {
  const [
    totalPresaleVolume,
    totalCurveVolume,
    _totalBuyVolume,
    _totalSellVolume,
    totalFeesCollected,
    totalCreatorPayouts,
    totalStakerRewards,
    _totalBuys,
    _totalSells,
    totalTokens,
  ] = rawStats;

  const totalVolume = totalPresaleVolume + totalCurveVolume;

  return {
    totalPresaleVolume,
    totalPresaleVolumeFormatted: formatWass(totalPresaleVolume),
    totalCurveVolume,
    totalCurveVolumeFormatted: formatWass(totalCurveVolume),
    totalVolume,
    totalVolumeFormatted: formatWass(totalVolume),
    totalFeesCollected,
    totalFeesFormatted: formatWass(totalFeesCollected),
    totalCreatorPayouts,
    totalCreatorPayoutsFormatted: formatWass(totalCreatorPayouts),
    totalStakerRewards,
    totalStakerRewardsFormatted: formatWass(totalStakerRewards),
    totalTokens,
  };
}
