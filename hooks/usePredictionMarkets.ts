// hooks/usePredictionMarkets.ts
// Hook for fetching all prediction markets, optionally filtered by warId
'use client';

import { useState, useEffect, useCallback } from 'react';

// Prediction Markets API
const API_BASE_URL = 'https://api.applesnakes.com';

// Market types from the API
export type MarketType = 'dex_vote' | 'pair_vote' | 'token_war_sellout' | 'sellout' | 'price' | 'custom';
export type MarketStatus = 'active' | 'closed' | 'resolved' | 'cancelled';

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
  description?: string;
  marketType: MarketType;
  marketStyle: string;
  relatedId?: string; // warId for Token Wars markets
  status: MarketStatus;
  createdAt: number;
  endsAt: number;
  resolvedAt?: number;
  resolvedOutcome?: number;
  totalPool: number;
  creatorWallet?: string;
  metadata?: string;
}

export interface MarketWithOutcomes {
  market: Market;
  outcomes: MarketOutcome[];
  stats: {
    totalPool: number;
    totalBets: number;
    uniqueBettors: number;
    timeRemaining: number;
    isActive: boolean;
  };
}

export interface MarketsResponse {
  success: boolean;
  stats: {
    totalMarkets: number;
    activeMarkets: number;
    resolvedMarkets: number;
    totalVolume: number;
    totalBets: number;
    uniqueBettors: number;
  };
  markets: MarketWithOutcomes[];
  availableTypes: string[];
  selloutLabels: string[];
}

interface UsePredictionMarketsOptions {
  warId?: string;
  status?: MarketStatus;
  type?: MarketType;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function usePredictionMarkets(options: UsePredictionMarketsOptions = {}) {
  const {
    warId,
    status,
    type,
    autoRefresh = true,
    refreshInterval = 15000,
  } = options;

  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (warId) params.set('warId', warId);
      if (status) params.set('status', status);
      if (type) params.set('type', type);

      const url = `${API_BASE_URL}/api/prediction-market${params.toString() ? `?${params}` : ''}`;
      console.log('[PredictionMarkets] Fetching:', url);

      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      // Check response before parsing
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('API returned non-JSON response');
      }

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch markets');
      }

      setData(result);
      setError(null);
    } catch (err) {
      console.error('[PredictionMarkets] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [warId, status, type]);

  useEffect(() => {
    fetchMarkets();

    if (autoRefresh) {
      const interval = setInterval(fetchMarkets, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchMarkets, autoRefresh, refreshInterval]);

  // Helper to get markets for a specific war
  const getWarMarkets = useCallback((targetWarId: string) => {
    if (!data?.markets) return { dexMarket: null, pairMarket: null, selloutMarket: null };

    const warMarkets = data.markets.filter(m => m.market.relatedId === targetWarId);

    return {
      dexMarket: warMarkets.find(m => m.market.marketType === 'dex_vote') || null,
      pairMarket: warMarkets.find(m => m.market.marketType === 'pair_vote') || null,
      selloutMarket: warMarkets.find(m =>
        m.market.marketType === 'token_war_sellout' || m.market.marketType === 'sellout'
      ) || null,
    };
  }, [data?.markets]);

  return {
    data,
    markets: data?.markets || [],
    stats: data?.stats || null,
    loading,
    error,
    refresh: fetchMarkets,
    getWarMarkets,
    // Derived values
    totalMarkets: data?.stats?.totalMarkets || 0,
    activeMarkets: data?.stats?.activeMarkets || 0,
    totalVolume: data?.stats?.totalVolume || 0,
  };
}
