// hooks/useLaunchConsensus.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { VoteConsensus, TokenWar } from '@/types/token-wars';

// Call production API directly - no proxy needed
const API_BASE = 'https://api.applesnakes.com';

// Legacy type aliases for backwards compatibility
type ProtocolConsensus = VoteConsensus;
type ClankerdomeLaunch = TokenWar;

interface UseLaunchConsensusResult {
  consensus: ProtocolConsensus | null;
  launch: ClankerdomeLaunch | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLaunchConsensus(
  launchId: string | null,
  refreshInterval = 5000
): UseLaunchConsensusResult {
  const [consensus, setConsensus] = useState<ProtocolConsensus | null>(null);
  const [launch, setLaunch] = useState<ClankerdomeLaunch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!launchId) {
      setLoading(false);
      return;
    }

    try {
      // Call production API directly (no proxy)
      const response = await fetch(`${API_BASE}/api/token-wars/${launchId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();

      if (data.success !== false) {
        // Extract consensus from war data
        setConsensus(data.war?.consensus || data.consensus || null);
        setLaunch(data.war || data.launch || null);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch consensus');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [launchId]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!launchId || refreshInterval <= 0) return;

    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [launchId, refreshInterval, fetchData]);

  return {
    consensus,
    launch,
    loading,
    error,
    refresh: fetchData,
  };
}

export default useLaunchConsensus;
