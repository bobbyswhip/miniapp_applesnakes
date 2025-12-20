// hooks/usePredictionMarket.ts
// Combined hook for full prediction market functionality
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { usePlaceBet } from './usePlaceBet';
import { useSellShares } from './useSellShares';
import { useMarketData, Market, Outcome } from './useMarketData';
import { useTransactionHistory, Transaction, HistoryStats } from './useTransactionHistory';
import { API_BASE } from '@/lib/prediction-market-constants';

// Position interface
export interface Position {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  shares: number;
  totalCost: number;
  averagePrice: number;
  currentPrice: number;
  currentValue: number;
  profitLoss: number;
  profitLossPercent: number;
}

interface UsePredictionMarketOptions {
  warId?: string;
  autoRefresh?: boolean;
  marketRefreshInterval?: number;
  positionsRefreshInterval?: number;
}

export function usePredictionMarket(
  marketId: string,
  options: UsePredictionMarketOptions = {}
) {
  const {
    warId,
    autoRefresh = true,
    marketRefreshInterval = 10000,
    positionsRefreshInterval = 15000,
  } = options;

  const { address, isConnected } = useAccount();

  // Positions state
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  // Market data hook
  const {
    market,
    outcomes,
    isLoading: marketLoading,
    error: marketError,
    refresh: refreshMarket,
    canBet,
    getTimeRemaining,
  } = useMarketData(marketId, {
    autoRefresh,
    refreshInterval: marketRefreshInterval,
  });

  // Betting hook
  const {
    placeBet: placeBetFn,
    loading: betLoading,
    error: betError,
    clearError: clearBetError,
  } = usePlaceBet();

  // Selling hook
  const {
    sellShares: sellSharesFn,
    checkStatus: checkSellStatus,
    isLoading: sellLoading,
    error: sellError,
    clearError: clearSellError,
    status: sellStatus,
    positions: sellablePositions,
  } = useSellShares();

  // Transaction history hook
  const {
    transactions,
    stats: historyStats,
    isLoading: historyLoading,
    refresh: refreshHistory,
    buys,
    sells,
  } = useTransactionHistory({
    marketId,
    limit: 50,
    autoRefresh: false, // Manual refresh after actions
  });

  // Fetch user positions
  const fetchPositions = useCallback(async () => {
    if (!address || !marketId) return;

    setPositionsLoading(true);
    setPositionsError(null);

    try {
      const url = new URL(`${API_BASE}/api/prediction-market/user`);
      url.searchParams.set('wallet', address);
      url.searchParams.set('marketId', marketId);

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.success) {
        setPositions(data.positions || []);
      } else {
        throw new Error(data.error || 'Failed to fetch positions');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[PredictionMarket] Position fetch error:', message);
      setPositionsError(message);
    } finally {
      setPositionsLoading(false);
    }
  }, [address, marketId]);

  // Auto-refresh positions
  useEffect(() => {
    fetchPositions();

    if (autoRefresh && address && marketId) {
      const interval = setInterval(fetchPositions, positionsRefreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchPositions, autoRefresh, address, marketId, positionsRefreshInterval]);

  // Combined bet handler with refresh
  const handleBet = useCallback(
    async (outcomeIndex: number, side: 'yes' | 'no', amountUsdc: number) => {
      const result = await placeBetFn({
        marketId,
        outcomeIndex,
        side,
        amountUsdc,
        warId,
      });

      if (result?.success) {
        // Refresh all data after successful bet
        await Promise.all([
          refreshMarket(),
          fetchPositions(),
          refreshHistory(),
        ]);
      }

      return result;
    },
    [marketId, warId, placeBetFn, refreshMarket, fetchPositions, refreshHistory]
  );

  // Combined sell handler with refresh
  const handleSell = useCallback(
    async (outcomeIndex: number, side: 'yes' | 'no', sharesToSell: number) => {
      const result = await sellSharesFn({
        marketId,
        outcomeIndex,
        side,
        sharesToSell,
      });

      if (result.success) {
        // Refresh all data after successful sell
        await Promise.all([
          refreshMarket(),
          fetchPositions(),
          refreshHistory(),
          checkSellStatus(marketId),
        ]);
      }

      return result;
    },
    [marketId, sellSharesFn, refreshMarket, fetchPositions, refreshHistory, checkSellStatus]
  );

  // Refresh all data
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshMarket(),
      fetchPositions(),
      refreshHistory(),
      address ? checkSellStatus(marketId) : Promise.resolve(),
    ]);
  }, [refreshMarket, fetchPositions, refreshHistory, checkSellStatus, marketId, address]);

  // Get position for specific outcome/side
  const getPosition = useCallback(
    (outcomeIndex: number, side: 'yes' | 'no'): Position | undefined => {
      return positions.find(
        (p) => p.outcomeIndex === outcomeIndex && p.side === side
      );
    },
    [positions]
  );

  // Check if user has position
  const hasPosition = useCallback(
    (outcomeIndex: number, side: 'yes' | 'no'): boolean => {
      const position = getPosition(outcomeIndex, side);
      return !!position && position.shares > 0;
    },
    [getPosition]
  );

  // Clear all errors
  const clearErrors = useCallback(() => {
    clearBetError();
    clearSellError();
    setPositionsError(null);
  }, [clearBetError, clearSellError]);

  return {
    // Connection
    isConnected,
    address,

    // Market data
    market,
    outcomes,
    marketLoading,
    marketError,

    // Positions
    positions,
    positionsLoading,
    positionsError,
    getPosition,
    hasPosition,

    // Actions
    handleBet,
    handleSell,
    betLoading,
    sellLoading,
    betError,
    sellError,
    sellStatus,

    // Transaction history
    transactions,
    historyStats,
    historyLoading,
    buys,
    sells,

    // Helpers
    canBet: canBet(),
    getTimeRemaining,
    refreshAll,
    clearErrors,

    // Individual refresh functions
    refreshMarket,
    refreshPositions: fetchPositions,
    refreshHistory,
    checkSellStatus: () => checkSellStatus(marketId),
  };
}

// Re-export types for convenience
export type { Market, Outcome, Transaction, HistoryStats };
