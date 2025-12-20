// hooks/useMarketData.ts
// Hook for fetching prediction market data and odds
// Endpoint: GET /api/prediction-market/bet/verified?marketId=xxx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_BASE, MarketStatus, MarketType } from '@/lib/prediction-market-constants';

export interface Outcome {
  index: number;
  label: string;
  yesOdds: number;
  noOdds: number;
  yesProbability: number;   // 0-1
  noProbability: number;    // 0-1
  totalPool: number;
  yesPool?: number;
  noPool?: number;
}

export interface Market {
  id: string;
  title: string;
  description?: string;
  status: MarketStatus;
  marketType: MarketType;
  endsAt: number;
  createdAt?: number;
  isActive: boolean;
  totalPool: number;
  resolvedOutcome?: number;
}

export interface PaymentRequirements {
  minAmount: number;
  maxAmount: number;
  currency: string;
  network: string;
}

interface UseMarketDataOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useMarketData(
  marketId: string | null,
  options: UseMarketDataOptions = {}
) {
  const {
    autoRefresh = true,
    refreshInterval = 10000,  // 10 seconds for live odds updates
  } = options;

  const [market, setMarket] = useState<Market | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [payment, setPayment] = useState<PaymentRequirements | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarket = useCallback(async () => {
    if (!marketId) {
      setIsLoading(false);
      return;
    }

    try {
      const url = `${API_BASE}/api/prediction-market/bet/verified?marketId=${encodeURIComponent(marketId)}`;
      console.log('[MarketData] Fetching:', url);

      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        setMarket(data.market || null);
        setOutcomes(data.outcomes || []);
        setPayment(data.payment || null);
        setError(null);
      } else {
        throw new Error(data.error || 'Failed to fetch market');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MarketData] Error:', message, err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchMarket();

    if (autoRefresh && marketId) {
      const interval = setInterval(fetchMarket, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchMarket, autoRefresh, refreshInterval, marketId]);

  // Helper to get outcome by index
  const getOutcome = useCallback((index: number): Outcome | undefined => {
    return outcomes.find(o => o.index === index);
  }, [outcomes]);

  // Calculate time remaining
  const getTimeRemaining = useCallback((): number => {
    if (!market?.endsAt) return 0;
    return Math.max(0, market.endsAt - Date.now());
  }, [market?.endsAt]);

  // Check if market is still active for betting
  const canBet = useCallback((): boolean => {
    if (!market) return false;
    return market.isActive && market.status === 'active' && getTimeRemaining() > 0;
  }, [market, getTimeRemaining]);

  return {
    market,
    outcomes,
    payment,
    isLoading,
    error,
    refresh: fetchMarket,
    // Helpers
    getOutcome,
    getTimeRemaining,
    canBet,
    // Derived values
    isActive: market?.isActive ?? false,
    isResolved: market?.status === 'resolved',
    isCancelled: market?.status === 'cancelled',
    totalPool: market?.totalPool ?? 0,
    resolvedOutcome: market?.resolvedOutcome,
  };
}
