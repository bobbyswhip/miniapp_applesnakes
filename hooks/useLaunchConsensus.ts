// hooks/useLaunchConsensus.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ProtocolConsensus, ClankerdomeLaunch } from '@/types/clankerdome';

interface UseLaunchConsensusResult {
  consensus: ProtocolConsensus | null;
  launch: ClankerdomeLaunch | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// API proxy base - uses local proxy to avoid CORS
const API_BASE_URL = '';

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
      // Try local proxy first, then direct API
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/buy?launchId=${launchId}`);
      const data = await response.json();

      if (data.success !== false) {
        setConsensus(data.consensus || null);
        setLaunch(data.launch || null);
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
