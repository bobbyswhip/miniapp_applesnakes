// hooks/usePredictionMarket.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MarketSummary, MarketActivity, UserMarketPosition } from '@/types/clankerdome';

const API_BASE_URL = 'https://api.applesnakes.com';

interface UsePredictionMarketOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  includeActivity?: boolean;
  walletAddress?: string;
}

export function usePredictionMarket(
  marketId: string | null,
  options: UsePredictionMarketOptions = {}
) {
  const {
    autoRefresh = true,
    refreshInterval = 10000,
    includeActivity = false,
    walletAddress
  } = options;

  const [market, setMarket] = useState<MarketSummary | null>(null);
  const [activity, setActivity] = useState<MarketActivity | null>(null);
  const [userPosition, setUserPosition] = useState<UserMarketPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarket = useCallback(async () => {
    if (!marketId) {
      setLoading(false);
      return;
    }

    try {
      // Build URL with query params
      const params = new URLSearchParams();
      if (includeActivity) params.set('activity', 'true');
      if (walletAddress) params.set('wallet', walletAddress);

      const url = `${API_BASE_URL}/api/prediction-market/${marketId}${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch market');
      }

      setMarket(data);
      if (data.activity) setActivity(data.activity);
      if (data.userPosition) setUserPosition(data.userPosition);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [marketId, includeActivity, walletAddress]);

  // Fetch activity separately if needed
  const fetchActivity = useCallback(async () => {
    if (!marketId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/prediction-market/${marketId}/activity`);
      const data = await res.json();
      if (data.success) {
        setActivity(data);
      }
    } catch (err) {
      console.error('Failed to fetch activity:', err);
    }
  }, [marketId]);

  useEffect(() => {
    fetchMarket();

    if (autoRefresh && marketId) {
      const interval = setInterval(fetchMarket, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchMarket, autoRefresh, refreshInterval, marketId]);

  return {
    market,
    activity,
    userPosition,
    loading,
    error,
    refresh: fetchMarket,
    refreshActivity: fetchActivity,
    // Derived values for convenience
    isActive: market?.stats?.isActive ?? false,
    isResolved: market?.market?.status === 'resolved',
    totalPool: market?.stats?.totalPool ?? 0,
    totalBets: market?.stats?.totalBets ?? 0,
    uniqueBettors: market?.stats?.uniqueBettors ?? 0,
    timeRemaining: market?.stats?.timeRemaining ?? 0,
    outcomes: market?.outcomes ?? [],
    resolvedOutcome: market?.market?.resolvedOutcome,
  };
}

// Re-export types for convenience
export type { MarketSummary, MarketActivity, UserMarketPosition };
