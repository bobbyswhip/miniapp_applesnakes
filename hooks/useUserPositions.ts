// hooks/useUserPositions.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserPositionsResponse, ClaimResult, ClaimableResponse } from '@/types/clankerdome';

const API_BASE_URL = 'https://api.applesnakes.com';

interface UseUserPositionsOptions {
  includeHistory?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useUserPositions(
  walletAddress: string | null,
  options: UseUserPositionsOptions = {}
) {
  const {
    includeHistory = false,
    autoRefresh = true,
    refreshInterval = 30000,
  } = options;

  const [positions, setPositions] = useState<UserPositionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({ wallet: walletAddress });
      if (includeHistory) params.set('history', 'true');

      const res = await fetch(`${API_BASE_URL}/api/prediction-market/user?${params}`);
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch positions');
      }

      setPositions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [walletAddress, includeHistory]);

  useEffect(() => {
    fetchPositions();

    if (autoRefresh && walletAddress) {
      const interval = setInterval(fetchPositions, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchPositions, autoRefresh, refreshInterval, walletAddress]);

  return {
    positions,
    loading,
    error,
    refresh: fetchPositions,
    // Convenience accessors
    stats: positions?.stats ?? null,
    activePositions: positions?.activePositions ?? [],
    resolvedPositions: positions?.resolvedPositions ?? [],
    claimable: positions?.claimable ?? [],
    hasClaimable: (positions?.claimable?.length ?? 0) > 0,
  };
}

// Hook for fetching claimable amounts
export function useClaimable(walletAddress: string | null) {
  const [claimable, setClaimable] = useState<ClaimableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClaimable = useCallback(async () => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/prediction-market/claim?wallet=${walletAddress}`);
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch claimable');
      }

      setClaimable(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchClaimable();
  }, [fetchClaimable]);

  return {
    claimable,
    loading,
    error,
    refresh: fetchClaimable,
    totalClaimable: claimable?.totalClaimable ?? 0,
    claims: claimable?.claimable ?? [],
  };
}

// Hook for claiming winnings
export function useClaim() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(async (
    marketId: string,
    walletAddress: string
  ): Promise<ClaimResult | null> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/prediction-market/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          walletAddress,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Claim failed');
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { claim, loading, error, clearError };
}
