"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// =============================================================================
// TYPES
// =============================================================================

export interface MarketOutcome {
  id: number;
  marketId: string;
  outcomeIndex: number;
  label: string;
  yesPool: number;
  noPool: number;
  yesShares: number;
  noShares: number;
  isWinner: boolean;
  yesOdds: number;
  noOdds: number;
  yesProbability: number;
  noProbability: number;
  totalPool: number;
}

export interface Market {
  id: string;
  title: string;
  description: string;
  marketType: "dex_vote" | "pair_vote" | "token_war_sellout";
  marketStyle: string;
  relatedId: string;
  status: "active" | "closed" | "resolved" | "cancelled";
  createdAt: number;
  endsAt: number;
  resolvedAt: number | null;
  resolvedOutcome: number | null;
  totalPool: number;
  creatorWallet: string;
  metadata: string;
}

export interface MarketStats {
  totalPool: number;
  totalBets: number;
  uniqueBettors: number;
  timeRemaining: number;
  isActive: boolean;
}

export interface MarketSummary {
  market: Market;
  outcomes: MarketOutcome[];
  stats: MarketStats;
}

// API can return either single market or array of markets
export interface PredictionMarketsData {
  success: boolean;
  relatedId?: string;
  count?: number;
  markets?: MarketSummary[];
  market?: MarketSummary;  // Single market response format
}

export interface UserPosition {
  outcomeIndex: number;
  outcomeLabel: string;
  side: "yes" | "no";
  shares: number;
  totalCost: number;
  currentValue: number;
  potentialPayout: number;
  profitLoss: number;
  profitLossPercent: number;
  isWinner: boolean;
}

export interface UserMarketPosition {
  marketId: string;
  market: {
    title: string;
    status: string;
    marketType: string;
    isActive: boolean;
  };
  positions: UserPosition[];
  totalInvested: number;
  totalCurrentValue: number;
  totalPotentialPayout: number;
  profitLoss: number;
}

export interface UserData {
  success: boolean;
  wallet: string;
  stats: {
    totalBets: number;
    totalVolume: number;
    totalWinnings: number;
    winRate: number;
    totalInvested: number;
    totalCurrentValue: number;
    unrealizedPL: number;
  };
  activePositions: UserMarketPosition[];
  claimable: Array<{
    marketId: string;
    marketTitle: string;
    outcomeIndex: number;
    outcomeLabel: string;
    side: string;
    potentialPayout: number;
  }>;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const POLL_INTERVAL = 10000; // 10 seconds

// =============================================================================
// HOOK
// =============================================================================

interface UseTokenWarsPredictionMarketsOptions {
  warId: string | null;
  userAddress?: string;
  autoRefresh?: boolean;
}

interface UseTokenWarsPredictionMarketsResult {
  // Market data
  markets: MarketSummary[];
  dexVoteMarket: MarketSummary | null;
  pairVoteMarket: MarketSummary | null;
  selloutMarket: MarketSummary | null;

  // User data
  userPositions: UserMarketPosition[];
  claimableWinnings: UserData["claimable"];
  userStats: UserData["stats"] | null;

  // State
  isLoading: boolean;
  error: string | null;
  lastUpdate: number | null;

  // Actions
  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export function useTokenWarsPredictionMarkets({
  warId,
  userAddress,
  autoRefresh = true,
}: UseTokenWarsPredictionMarketsOptions): UseTokenWarsPredictionMarketsResult {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [userPositions, setUserPositions] = useState<UserMarketPosition[]>([]);
  const [claimableWinnings, setClaimableWinnings] = useState<UserData["claimable"]>([]);
  const [userStats, setUserStats] = useState<UserData["stats"] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const warIdRef = useRef<string | null>(null);

  // Fetch markets for the war
  const fetchMarkets = useCallback(async () => {
    if (!warId) {
      setMarkets([]);
      return;
    }

    try {
      // Use relatedId parameter as per API spec
      const response = await fetch(`${API_BASE}/api/prediction-market?relatedId=${warId}`);
      const data: PredictionMarketsData = await response.json();

      if (data.success) {
        // Handle both array format (markets) and single object format (market)
        let marketsArray: MarketSummary[] = [];
        if (data.markets && Array.isArray(data.markets)) {
          marketsArray = data.markets;
        } else if (data.market) {
          marketsArray = [data.market];
        }
        setMarkets(marketsArray);
        setError(null);
      } else {
        setError("Failed to fetch markets");
        setMarkets([]);
      }
    } catch (err) {
      console.error("[PredictionMarkets] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Network error");
      setMarkets([]);
    }
  }, [warId]);

  // Fetch user positions
  const fetchUserData = useCallback(async () => {
    if (!userAddress) {
      setUserPositions([]);
      setClaimableWinnings([]);
      setUserStats(null);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/api/prediction-market/user?wallet=${userAddress}`
      );
      const data: UserData = await response.json();

      if (data.success) {
        // Filter positions for current war's markets
        const warMarketIds = markets.map(m => m.market.id);
        const filteredPositions = data.activePositions.filter(
          pos => warMarketIds.includes(pos.marketId)
        );

        setUserPositions(filteredPositions);
        setClaimableWinnings(data.claimable);
        setUserStats(data.stats);
      }
    } catch (err) {
      console.error("[PredictionMarkets] User data error:", err);
    }
  }, [userAddress, markets]);

  // Combined refresh
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchMarkets();
    await fetchUserData();
    setLastUpdate(Date.now());
    setIsLoading(false);
  }, [fetchMarkets, fetchUserData]);

  // Polling controls
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    console.log("[PredictionMarkets] Starting polling...");
    pollingRef.current = setInterval(refresh, POLL_INTERVAL);
  }, [refresh]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      console.log("[PredictionMarkets] Stopping polling");
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Initial fetch and warId change handling
  useEffect(() => {
    if (warId !== warIdRef.current) {
      warIdRef.current = warId;
      refresh();
    }
  }, [warId, refresh]);

  // Auto-refresh setup
  useEffect(() => {
    if (autoRefresh && warId) {
      startPolling();
    }
    return () => stopPolling();
  }, [autoRefresh, warId, startPolling, stopPolling]);

  // Fetch user data when markets or address changes
  useEffect(() => {
    if (markets.length > 0 && userAddress) {
      fetchUserData();
    }
  }, [markets, userAddress, fetchUserData]);

  // Derived market references - ensure markets is always an array
  const safeMarkets = markets || [];
  const dexVoteMarket = safeMarkets.find(m => m.market.marketType === "dex_vote") || null;
  const pairVoteMarket = safeMarkets.find(m => m.market.marketType === "pair_vote") || null;
  const selloutMarket = safeMarkets.find(m => m.market.marketType === "token_war_sellout") || null;

  return {
    markets,
    dexVoteMarket,
    pairVoteMarket,
    selloutMarket,
    userPositions,
    claimableWinnings,
    userStats,
    isLoading,
    error,
    lastUpdate,
    refresh,
    startPolling,
    stopPolling,
  };
}
