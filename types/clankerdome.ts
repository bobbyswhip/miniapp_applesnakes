// types/clankerdome.ts

// ====================================
// NEW X402-backed Prediction Markets
// ====================================

// Outcome labels for sellout markets
export const SELLOUT_LABELS = [
  "0-25% Funded",
  "25-50% Funded",
  "50-75% Funded",
  "75-99% Funded",
  "100% SELL OUT!"
] as const;

// Market status
export type MarketStatus = "active" | "paused" | "closed" | "resolved" | "cancelled";

// Market summary from API
export interface MarketSummary {
  market: {
    id: string;
    title: string;
    description?: string;
    marketType: string;        // "sellout", "price", "custom"
    relatedId?: string;        // launchId for Clankerdome
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
  market: MarketSummary["market"];
  positions: Array<{
    outcomeIndex: number;
    outcomeLabel: string;
    side: "yes" | "no";
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
    side: "yes" | "no";
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
    side: "yes" | "no";
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
    trend: "bullish" | "bearish" | "neutral";
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
    side: "yes" | "no";
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
    side: "yes" | "no";
    shares: number;
    potentialPayout: number;
  }>;
  totalClaimable: number;
}

// Claim result
export interface ClaimResult {
  success: boolean;
  type: "winnings" | "refund";
  totalAmount: number;
  claims: Array<{
    outcomeIndex: number;
    side: "yes" | "no";
    amount: number;
  }>;
  note: string;
}

// ====================================
// Consensus Voting Types
// ====================================

// Protocol vote options
export type ProtocolVote = "uniswap" | "aerodrome";

// Consensus data from API
export interface ProtocolConsensus {
  leadingProtocol: ProtocolVote;
  uniswap: {
    votes: number;    // Total USDC voting for Uniswap
    percent: number;  // 0-100
  };
  aerodrome: {
    votes: number;    // Total USDC voting for Aerodrome
    percent: number;  // 0-100
  };
  totalVotes: number; // Total USDC in presale
  isTie: boolean;     // True if 50/50 (Aerodrome wins ties)
  description?: string;
}

// X402 payment accepts (from 402 response body)
export interface X402Accepts {
  payTo: string;
  asset: string;
  maxAmount: string;
  extra: {
    name: string;
    version: string;
  };
}

// Buy request with protocol vote
export interface ConsensusBuyRequest {
  launchId: string;
  protocolVote: ProtocolVote;
}

// Buy response with consensus
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

// ====================================
// Clankerdome Launch Types
// ====================================

// New prediction market info (X402-backed)
export interface PredictionMarketInfo {
  id: string;              // Market ID for API calls
  hasMarket: boolean;
  type: "x402";            // New X402-based system
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
  // Legacy fields for backwards compatibility
  address?: string | null;
  txHash?: string | null;
}

// Clankerdome launch
export interface ClankerdomeLaunch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted?: string;
  status: 'active' | 'launching' | 'launched' | 'failed' | 'cancelled';
  isActive: boolean;
  targetAmount?: number;
  totalRaised: number;
  participantCount: number;
  progressPercent?: number;
  creatorWallet: string;
  tokenAddress?: string;
  predictionMarket?: PredictionMarketInfo;
  consensus?: ProtocolConsensus | null;  // Consensus voting data
  // Legacy support
  predictionMarketAddress?: string;
}

// Clankerdome global stats
export interface ClankerdomeStats {
  totalLaunches: number;
  activeLaunches: number;
  activePredictionMarkets: number;
  totalRaisedUsdc: number;
  totalParticipants: number;
}
