// hooks/useUserAllocations.ts
// Hook for fetching user's token allocations and airdrop progress
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DexVote, PairVote } from '@/types/token-wars';

// Call production API directly
const API_BASE = 'https://api.applesnakes.com';

// =============================================================================
// Types
// =============================================================================

export interface ActiveIco {
  warId: string;
  status: 'active' | 'launching' | 'ended' | 'cancelled' | 'failed';
  // Token info
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  // User's contribution
  userContribution: number;
  userSharePercent: number;
  // ICO progress
  totalRaised: number;
  targetAmount: number | null;
  percentRaised: number;
  participantCount: number;
  // Timing
  createdAt: number;
  endsAt: number;
  timeRemaining: number;
  timeRemainingFormatted: string;
  isEnded: boolean;
  // Voting info
  isRawIco: boolean;
  lockedDex: DexVote | null;
  lockedPair: PairVote | null;
  winningDex: string | null;
  winningPair: string | null;
}

export interface AirdropShare {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  warId: string;
  imageUrl?: string | null;
  usdcContributed: number;
  sharePercent: number;
  totalTokenAllocation: string;
  tokensSentSoFar: string;
  tokensRemaining: string;
  formatted: {
    totalAllocation: string;
    tokensSent: string;
    tokensRemaining: string;
    nextDripAmount: string;
  };
  percentDistributed: number;
  dripCount: number;
  airdropStartedAt: number;
  airdropEndsAt: number;
  nextDripAt: number;
  lastDripAt: number | null;
  timeToNextDrip: number;
  timeToNextDripFormatted: string;
  timeToComplete: number;
  timeToCompleteFormatted: string;
  isComplete: boolean;
  completedAt: number | null;
  dripSchedule?: {
    intervalMs: number;
    percentPerDrip: number;
    totalDurationMs: number;
    protocolFeePercent: number;
  };
}

export interface ActiveIcosData {
  count: number;
  totalUsdcInvested: number;
  icos: ActiveIco[];
}

export interface LaunchedAirdropsData {
  totalUsdcInvested: number;
  totalSharesCount: number;
  completedCount: number;
  pendingCount: number;
  totalTokensAllocated: string;
  totalTokensSent: string;
  totalTokensRemaining: string;
  formatted: {
    totalTokensAllocated: string;
    totalTokensSent: string;
    totalTokensRemaining: string;
  };
  overallProgress: number;
  shares: AirdropShare[];
}

export interface UserWallet {
  address: string;
  // Active ICO participations (pre-launch)
  activeIcos: ActiveIcosData;
  // Launched token airdrops (post-launch)
  launchedAirdrops: LaunchedAirdropsData;
  // Combined summary
  summary: {
    totalUsdcInvested: number;
    activeIcoCount: number;
    launchedTokenCount: number;
    pendingAirdrops: number;
    completedAirdrops: number;
  };
  // Legacy fields for backwards compatibility
  totalUsdcInvested: number;
  totalSharesCount: number;
  completedCount: number;
  pendingCount: number;
  formatted: {
    totalTokensAllocated: string;
    totalTokensSent: string;
    totalTokensRemaining: string;
  };
  overallProgress: number;
  shares: AirdropShare[];
}

export interface DripConfig {
  intervalMs: number;
  intervalFormatted: string;
  percentPerDrip: number;
  totalDurationMs: number;
  totalDurationFormatted: string;
  protocolFeePercent: number;
  protocolWallet?: string;
}

// =============================================================================
// Hook
// =============================================================================

export function useUserAllocations(walletAddress: string | null) {
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [dripConfig, setDripConfig] = useState<DripConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllocations = useCallback(async (silent = false) => {
    if (!walletAddress) {
      setWallet(null);
      return;
    }

    try {
      if (!silent) setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/token-wars/wallet/${walletAddress}`);

      // Check if response is OK
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      // Check content type before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('API returned non-JSON response');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch allocations');
      }

      setWallet(data.wallet);
      setDripConfig(data.dripConfig);
    } catch (err) {
      console.error('[useUserAllocations] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      if (!silent) setWallet(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [walletAddress]);

  // Initial fetch
  useEffect(() => {
    fetchAllocations(false);
  }, [fetchAllocations]);

  // Auto-refresh every 30 seconds for live drip updates
  useEffect(() => {
    if (!walletAddress) return;

    const interval = setInterval(() => fetchAllocations(true), 30000);
    return () => clearInterval(interval);
  }, [walletAddress, fetchAllocations]);

  // Computed values - Airdrops
  const pendingShares = wallet?.launchedAirdrops?.shares?.filter(s => !s.isComplete) || wallet?.shares?.filter(s => !s.isComplete) || [];
  const completedShares = wallet?.launchedAirdrops?.shares?.filter(s => s.isComplete) || wallet?.shares?.filter(s => s.isComplete) || [];
  const nextDrip = pendingShares.length > 0
    ? pendingShares.reduce((min, s) => s.nextDripAt < min.nextDripAt ? s : min)
    : null;

  // Computed values - Active ICOs
  const activeIcos = wallet?.activeIcos?.icos || [];
  const hasActiveIcos = (wallet?.activeIcos?.count || 0) > 0;
  const hasLaunchedTokens = (wallet?.launchedAirdrops?.totalSharesCount || wallet?.totalSharesCount || 0) > 0;
  const hasPendingAirdrops = (wallet?.launchedAirdrops?.pendingCount || wallet?.pendingCount || 0) > 0;

  return {
    wallet,
    dripConfig,
    loading,
    error,
    refresh: () => fetchAllocations(false),
    silentRefresh: () => fetchAllocations(true),
    // Computed - Airdrops
    pendingShares,
    completedShares,
    nextDrip,
    hasAllocations: wallet !== null && (wallet.totalSharesCount > 0 || (wallet.activeIcos?.count || 0) > 0),
    // Computed - Active ICOs
    activeIcos,
    hasActiveIcos,
    hasLaunchedTokens,
    hasPendingAirdrops,
    // Summary
    summary: wallet?.summary || null,
  };
}

export default useUserAllocations;
