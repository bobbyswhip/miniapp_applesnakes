// hooks/useLaunchedTokens.ts
// Hook for fetching launched tokens for the trading terminal
'use client';

import { useState, useEffect, useCallback } from 'react';
import { TOKEN_WARS_API } from '@/lib/api-config';

// =============================================================================
// Types
// =============================================================================

export type DexType = 'v4' | 'aerodrome' | 'hydrex';
export type PairType = 'eth' | 'wass';

export interface LaunchedToken {
  tokenAddress: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  poolAddress: string;
  dex: DexType;
  pair: PairType;
  launchTxHash: string;
  totalRaisedUsdc: number;
  participantCount: number;
  launchedAt: number;
  createdAt: number;
  warId: string;
  dexScreenerUrl: string | null;
  basescanUrl: string | null;
}

export interface LaunchedTokensStats {
  totalLaunched: number;
  byDex: { v4: number; aerodrome: number; hydrex: number };
  byPair: { eth: number; wass: number };
  totalRaisedUsdc: number;
}

export interface UseLaunchedTokensOptions {
  limit?: number;
  dex?: DexType;
  pair?: PairType;
  refreshInterval?: number; // ms, 0 to disable
}

// =============================================================================
// Hook
// =============================================================================

export function useLaunchedTokens(options: UseLaunchedTokensOptions = {}) {
  const { limit = 50, dex, pair, refreshInterval = 30000 } = options;

  const [tokens, setTokens] = useState<LaunchedToken[]>([]);
  const [stats, setStats] = useState<LaunchedTokensStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchTokens = useCallback(async (newOffset = 0, append = false) => {
    try {
      if (!append) setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(newOffset));
      if (dex) params.set('dex', dex);
      if (pair) params.set('pair', pair);

      const response = await fetch(`${TOKEN_WARS_API}/token-wars/tokens?${params}`);

      // Check if response is OK before parsing
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('API returned non-JSON response');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch tokens');
      }

      setTokens(prev => append ? [...prev, ...data.tokens] : data.tokens);
      setStats(data.stats);
      setHasMore(data.pagination?.hasMore ?? false);
      setOffset(newOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [limit, dex, pair]);

  // Silent refresh - no loading state
  const silentRefresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', '0');
      if (dex) params.set('dex', dex);
      if (pair) params.set('pair', pair);

      const response = await fetch(`${TOKEN_WARS_API}/token-wars/tokens?${params}`);

      // Check response before parsing
      if (!response.ok) return;

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;

      const data = await response.json();

      if (data.success) {
        setTokens(data.tokens);
        setStats(data.stats);
        setHasMore(data.pagination?.hasMore ?? false);
        setOffset(0);
      }
    } catch (err) {
      console.error('[useLaunchedTokens] Silent refresh error:', err);
    }
  }, [limit, dex, pair]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTokens(offset + limit, true);
    }
  }, [loading, hasMore, offset, limit, fetchTokens]);

  const refresh = useCallback(() => {
    fetchTokens(0, false);
  }, [fetchTokens]);

  // Initial fetch
  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(silentRefresh, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, silentRefresh]);

  return {
    tokens,
    stats,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    silentRefresh,
  };
}

export default useLaunchedTokens;
