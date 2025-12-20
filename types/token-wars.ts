// types/token-wars.ts
// Token Wars - Evolved from Clankerdome with 3-way DEX voting and 2-way pair voting

// ====================================
// DEX and Pair Vote Types
// ====================================

// 3-way DEX vote options
export type DexVote = 'v4' | 'aerodrome' | 'hydrex';

// 2-way Pair vote options
export type PairVote = 'eth' | 'wass';

// DEX consensus data
export interface DexConsensus {
  leading: DexVote;
  v4: {
    votes: number;    // Total USDC voting for V4 Uniswap
    percent: number;  // 0-100
  };
  aerodrome: {
    votes: number;    // Total USDC voting for Aerodrome
    percent: number;  // 0-100
  };
  hydrex: {
    votes: number;    // Total USDC voting for Hydrex
    percent: number;  // 0-100
  };
  isTie: boolean;     // True if tied (Aerodrome wins ties)
}

// Pair consensus data
export interface PairConsensus {
  leading: PairVote;
  eth: {
    votes: number;    // Total USDC voting for ETH pair
    percent: number;  // 0-100
  };
  wass: {
    votes: number;    // Total USDC voting for wASS pair
    percent: number;  // 0-100
  };
  isTie: boolean;     // True if tied (ETH wins ties)
}

// Combined vote consensus
export interface VoteConsensus {
  dex: DexConsensus;
  pair: PairConsensus;
  totalVotes: number;
  description?: string;
}

// ====================================
// Prediction Market Types
// ====================================

// Market status
export type MarketStatus = 'active' | 'paused' | 'closed' | 'resolved' | 'cancelled';

// Market style - Token Wars adds winner-takes-all
export type MarketStyle = 'binary' | 'winner_takes_all';

// Outcome labels for sellout markets
export const SELLOUT_LABELS = [
  '0-25% Funded',
  '25-50% Funded',
  '50-75% Funded',
  '75-99% Funded',
  '100% SELL OUT!'
] as const;

// DEX market labels
export const DEX_LABELS = ['V4 Uniswap', 'Aerodrome', 'Hydrex'] as const;

// Pair market labels
export const PAIR_LABELS = ['ETH', 'wASS'] as const;

// Market summary from API
export interface MarketSummary {
  market: {
    id: string;
    title: string;
    description?: string;
    marketType: string;        // 'sellout', 'dex', 'pair', 'price', 'custom'
    marketStyle: MarketStyle;  // 'binary' or 'winner_takes_all'
    relatedId?: string;        // warId for Token Wars
    status: MarketStatus;
    createdAt: number;
    endsAt: number;
    resolvedAt?: number;
    resolvedOutcome?: number;
    totalPool: number;
    creatorWallet?: string;
  };
  outcomes: Array<{
    outcomeIndex: number;
    label: string;
    yesPool: number;
    noPool: number;
    yesShares: number;
    noShares: number;
    yesProbability: number;    // 0-100%
    noProbability: number;     // 0-100%
    yesOdds: number;           // e.g., 2.0 = 2:1 odds
    noOdds: number;
    totalPool: number;
    isWinner?: boolean;
  }>;
  stats: {
    totalPool: number;
    totalBets: number;
    uniqueBettors: number;
    timeRemaining: number;
    isActive: boolean;
  };
}

// User position in a market
export interface UserMarketPosition {
  market: MarketSummary['market'];
  positions: Array<{
    outcomeIndex: number;
    outcomeLabel: string;
    side: 'yes' | 'no';
    shares: number;
    totalCost: number;
    currentValue: number;
    potentialPayout: number;
    profitLoss: number;
    profitLossPercent: number;
  }>;
  totalInvested: number;
  totalCurrentValue: number;
  totalPotentialPayout: number;
}

// Bet result from API
export interface BetResult {
  success: boolean;
  bet: {
    marketId: string;
    outcomeIndex: number;
    side: 'yes' | 'no';
    amount: number;
    shares: number;
    price: number;
    txIdentifier: string;
    wallet: string;
  };
  position: UserMarketPosition;
  market: MarketSummary;
}

// Market activity from API
export interface MarketActivity {
  recentBets: Array<{
    id: number;
    wallet: string;
    fullWallet: string;
    outcomeIndex: number;
    outcomeLabel: string;
    side: 'yes' | 'no';
    sideEmoji: string;
    amount: number;
    formattedAmount: string;
    shares: number;
    price: number;
    timestamp: number;
    timeAgo: string;
  }>;
  volumeByOutcome: Array<{
    outcomeIndex: number;
    label: string;
    yesVolume: number;
    noVolume: number;
    totalVolume: number;
  }>;
  topBettors: Array<{
    rank: number;
    wallet: string;
    fullWallet: string;
    totalVolume: number;
    formattedVolume: string;
    betCount: number;
  }>;
  momentum: {
    yesPercent: number;
    noPercent: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
}

// User positions response
export interface UserPositionsResponse {
  success: boolean;
  wallet: string;
  stats: {
    totalInvested: number;
    totalWinnings: number;
    winRate: number;
    totalBets: number;
  };
  summary: {
    activePositionsCount: number;
    resolvedPositionsCount: number;
  };
  activePositions: UserMarketPosition[];
  resolvedPositions: UserMarketPosition[];
  claimable: Array<{
    marketId: string;
    marketTitle: string;
    outcomeIndex: number;
    outcomeLabel: string;
    side: 'yes' | 'no';
    shares: number;
    potentialPayout: number;
  }>;
}

// Claimable response
export interface ClaimableResponse {
  success: boolean;
  wallet: string;
  claimable: Array<{
    marketId: string;
    marketTitle: string;
    outcomeIndex: number;
    outcomeLabel: string;
    side: 'yes' | 'no';
    shares: number;
    potentialPayout: number;
  }>;
  totalClaimable: number;
}

// Claim result
export interface ClaimResult {
  success: boolean;
  type: 'winnings' | 'refund';
  totalAmount: number;
  claims: Array<{
    outcomeIndex: number;
    side: 'yes' | 'no';
    amount: number;
  }>;
  note: string;
}

// ====================================
// X402 Payment Types
// ====================================

// X402 payment accepts (from 402 response body)
export interface X402Accepts {
  payTo: string;
  asset: string;
  maxAmount: string;
  maxAmountRequired: string;  // Atomic amount required for payment
  extra: {
    name: string;
    version: string;
  };
}

// Buy request with DEX + Pair votes
export interface TokenWarsBuyRequest {
  warId: string;
  dexVote: DexVote;
  pairVote: PairVote;
}

// Buy response with consensus
export interface TokenWarsBuyResponse {
  success: boolean;
  message?: string;
  error?: string;
  buy?: {
    warId: string;
    amount: number;
    txHash: string;
    wallet: string;
    timestamp: number;
    dexVote: DexVote;
    pairVote: PairVote;
  };
  war?: {
    id: string;
    name: string;
    symbol: string;
    totalRaised: number;
    participantCount: number;
  };
  wallet?: {
    totalContribution: number;
    sharePercent: number;
  };
  consensus?: VoteConsensus;
}

// ====================================
// Token War Types
// ====================================

// Prediction market info for a war
export interface WarPredictionMarkets {
  dexMarketId?: string;      // 3-way DEX market
  pairMarketId?: string;     // 2-way Pair market
  selloutMarketId?: string;  // Binary sellout market
  hasMarkets: boolean;
}

// War status type
export type WarStatus = 'active' | 'launching' | 'launched' | 'failed' | 'cancelled';

// Vote locks for RAW ICO mode
export interface WarLocks {
  lockedDex: DexVote | null;
  lockedPair: PairVote | null;
  isRawIco: boolean;     // True if any lock is set
  isDexLocked: boolean;  // Convenience flag
  isPairLocked: boolean; // Convenience flag
}

// Token War (replaces ClankerdomeLaunch)
export interface TokenWar {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;

  // Timing
  createdAt: number;
  endsAt: number;
  durationHours?: number;  // Custom duration in hours (min 24)
  timeRemainingMs: number;
  timeRemainingFormatted?: string;
  isExpired: boolean;

  // Status
  status: WarStatus;
  isActive: boolean;

  // Funding
  targetAmount?: number;     // Optional sellout threshold
  totalRaised: number;
  participantCount: number;
  progressPercent?: number | null;

  // DEX Votes
  dexVotes: {
    v4: number;
    aerodrome: number;
    hydrex: number;
    leading: DexVote;
    v4Percent: number;
    aerodromePercent: number;
    hydrexPercent: number;
  };

  // Pair Votes
  pairVotes: {
    eth: number;
    wass: number;
    leading: PairVote;
    ethPercent: number;
    wassPercent: number;
  };

  // Creator
  creatorWallet: string;
  creatorBuyUsdc: number;
  creatorDexVote: DexVote;
  creatorPairVote: PairVote;

  // Vote Locks (RAW ICO mode)
  locks: WarLocks;

  // Prediction Markets
  predictionMarkets: WarPredictionMarkets;

  // After launch
  winningDex?: DexVote;
  winningPair?: PairVote;
  tokenAddress?: string;
  poolAddress?: string;
  launchTxHash?: string;

  // Consensus (computed from votes)
  consensus?: VoteConsensus | null;
}

// Token Wars global stats
export interface TokenWarsStats {
  totalWars: number;
  activeWars: number;
  launchedWars: number;
  totalRaisedUsdc: number;
  totalParticipants: number;
}

// ====================================
// Earnings System Types
// ====================================

// Fee configuration
export const FEE_CONFIG = {
  totalFeePercent: 2,
  creatorFeePercent: 1,
  platformFeePercent: 1,
} as const;

// Reward types
export type RewardType = 'prediction_win' | 'creator_fee' | 'referral' | 'bonus' | 'refund';

// Treasury balance types
export type TreasuryBalanceType = 'participant_funds' | 'market_pools' | 'creator_pending' | 'platform_earnings' | 'user_rewards';

// War earnings record
export interface WarEarnings {
  id: number;
  warId: string;
  creatorWallet: string;
  totalVolume: number;
  dexMarketVolume: number;
  pairMarketVolume: number;
  selloutMarketVolume: number;
  totalFeesCollected: number;
  creatorEarnings: number;
  platformEarnings: number;
  creatorClaimed: boolean;
  creatorClaimTxHash?: string;
  creatorClaimedAt?: number;
}

// User reward record
export interface UserReward {
  id: number;
  walletAddress: string;
  warId?: string;
  marketId?: string;
  rewardType: RewardType;
  amountUsdc: number;
  description?: string;
  claimed: boolean;
  claimTxHash?: string;
  claimedAt?: number;
  createdAt: number;
}

// Treasury balance
export interface TreasuryBalance {
  balanceType: TreasuryBalanceType;
  amount: number;
  lastUpdated: number;
}

// Earnings summary response
export interface EarningsSummaryResponse {
  success: boolean;
  summary: {
    totalVolume: number;
    totalFeesCollected: number;
    totalCreatorEarnings: number;
    totalPlatformEarnings: number;
    treasury: {
      participantFunds: number;
      marketPools: number;
      creatorPending: number;
      platformEarnings: number;
      userRewards: number;
      total: number;
    };
    activeWars: number;
    totalRewardsIssued: number;
    pendingUserRewards: number;
  };
  feeConfig: typeof FEE_CONFIG;
}

// War earnings response
export interface WarEarningsResponse {
  success: boolean;
  warId: string;
  earnings: {
    totalVolume: number;
    dexMarketVolume: number;
    pairMarketVolume: number;
    selloutMarketVolume: number;
    totalFeesCollected: number;
    creatorEarnings: number;
    platformEarnings: number;
    creatorClaimed: boolean;
    creatorClaimTxHash?: string;
  };
  volumeBreakdown: {
    totalVolume: number;
    byMarketType: { dex: number; pair: number; sellout: number };
    byWallet: Array<{ wallet: string; volume: number; fees: number }>;
    transactions: number;
  };
}

// Creator earnings response
export interface CreatorEarningsResponse {
  success: boolean;
  creatorSummary: {
    wallet: string;
    totalWars: number;
    totalVolume: number;
    totalEarnings: number;
    pendingEarnings: number;
    claimedEarnings: number;
    wars: Array<{
      warId: string;
      volume: number;
      earnings: number;
      claimed: boolean;
    }>;
  };
}

// User rewards response
export interface UserRewardsResponse {
  success: boolean;
  wallet: string;
  rewards: UserReward[];
  pending: {
    total: number;
    byType: Record<string, number>;
    count: number;
  };
}

// Fee calculation response
export interface FeeCalculationResponse {
  success: boolean;
  originalAmount: number;
  netAmount: number;
  totalFee: number;
  creatorFee: number;
  platformFee: number;
  feeConfig: typeof FEE_CONFIG;
}

// Calculate fees helper
export function calculateFees(amount: number) {
  const totalFee = amount * (FEE_CONFIG.totalFeePercent / 100);
  const creatorFee = amount * (FEE_CONFIG.creatorFeePercent / 100);
  const platformFee = amount * (FEE_CONFIG.platformFeePercent / 100);
  const netAmount = amount - totalFee;

  return {
    originalAmount: amount,
    netAmount,
    totalFee,
    creatorFee,
    platformFee,
  };
}

// ====================================
// Create War Types
// ====================================

// Create war request with RAW ICO support
export interface CreateWarRequest {
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  targetAmount?: number;       // Optional sellout threshold in USDC
  durationHours?: number;      // Custom duration (min 24 hours)
  dexVote: DexVote;            // Creator's DEX vote
  pairVote: PairVote;          // Creator's pair vote
  lockedDex?: DexVote;         // RAW ICO: lock DEX choice (disables voting)
  lockedPair?: PairVote;       // RAW ICO: lock pair choice (disables voting)
}

// Create war response
export interface CreateWarResponse {
  success: boolean;
  message?: string;
  error?: string;
  war?: TokenWar;
}

// ====================================
// Legacy Compatibility
// ====================================

// Re-export with old names for gradual migration
export type ProtocolVote = DexVote;
export type ProtocolConsensus = VoteConsensus;
export type ClankerdomeLaunch = TokenWar;
export type ClankerdomeStats = TokenWarsStats;

// Legacy prediction market info type
export interface PredictionMarketInfo {
  id: string;
  hasMarket: boolean;
  type: 'x402';
  totalPool: number;
  totalBets: number;
  uniqueBettors: number;
  outcomes?: Array<{
    index: number;
    label: string;
    yesProbability: number;
    noProbability: number;
    yesOdds: number;
    noOdds: number;
    totalPool: number;
  }>;
  address?: string | null;
  txHash?: string | null;
}

// Legacy buy request (maps to new structure)
export interface ConsensusBuyRequest {
  launchId: string;
  protocolVote: ProtocolVote;
}

// Legacy buy response
export interface ConsensusBuyResponse {
  success: boolean;
  message?: string;
  error?: string;
  buy?: {
    launchId: string;
    amount: number;
    txHash: string;
    wallet: string;
    timestamp: number;
    protocolVote: ProtocolVote;
  };
  launch?: {
    id: string;
    name: string;
    symbol: string;
    totalRaised: number;
    participantCount: number;
  };
  wallet?: {
    totalContribution: number;
    sharePercent: number;
  };
  consensus?: ProtocolConsensus;
}
