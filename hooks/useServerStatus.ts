/**
 * Hook for fetching and polling the AppleSnakes backend status API
 * Rate limited: 1 req/sec, 10 req/min - default poll interval 10s
 * Uses local proxy route to avoid CORS issues
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StatusResponse } from '@/types/status';

// Use local proxy route to avoid CORS issues
const STATUS_API_URL = '/api/backend-status';

interface UseServerStatusOptions {
  /** Polling interval in milliseconds (default: 10000ms, min safe: 6000ms) */
  pollInterval?: number;
  /** Only fetch specific providers (e.g., ['server', 'memory']) */
  providers?: string[];
  /** Whether to start polling immediately (default: true) */
  enabled?: boolean;
}

interface UseServerStatusReturn {
  data: StatusResponse | null;
  error: string | null;
  loading: boolean;
  rateLimited: boolean;
  lastUpdated: Date | null;
  refetch: () => Promise<void>;
}

export function useServerStatus(options: UseServerStatusOptions = {}): UseServerStatusReturn {
  const { pollInterval = 10000, providers, enabled = true } = options;

  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;

    try {
      let url = STATUS_API_URL;
      if (providers && providers.length > 0) {
        url += `?providers=${providers.join(',')}`;
      }

      const response = await fetch(url);

      if (response.status === 429) {
        setRateLimited(true);
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = (parseInt(retryAfter || '1', 10) + 1) * 1000;

        // Clear any existing retry timeout
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        // Schedule retry
        retryTimeoutRef.current = setTimeout(() => {
          setRateLimited(false);
          fetchStatus();
        }, waitTime);
        return;
      }

      setRateLimited(false);
      const json = await response.json();

      if (json.success) {
        setData(json);
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError(json.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setLoading(false);
    }
  }, [enabled, providers]);

  // Initial fetch and polling
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    fetchStatus();

    // Set up polling
    pollIntervalRef.current = setInterval(fetchStatus, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [fetchStatus, pollInterval, enabled]);

  return {
    data,
    error,
    loading,
    rateLimited,
    lastUpdated,
    refetch: fetchStatus,
  };
}

/**
 * Helper function to convert pool tick to approximate market cap
 */
export function tickToMarketCap(tick: number): string {
  if (tick >= -161200) return '~$1,000+';
  if (tick >= -230400) return '~$100';
  if (tick >= -276200) return '~$10';
  if (tick >= -322000) return '~$1';
  return '<$1';
}

/**
 * Helper function to calculate heap usage percentage
 */
export function calcHeapPercent(heapUsedBytes: number, heapTotalBytes: number): number {
  if (heapTotalBytes === 0) return 0;
  return Math.round((heapUsedBytes / heapTotalBytes) * 100);
}
