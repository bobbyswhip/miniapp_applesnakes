// hooks/useClankerdomeLaunchWithParticipants.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PredictionMarketInfo } from '@/types/clankerdome';

const API_BASE_URL = 'https://api.applesnakes.com';

interface Launch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  isExpired: boolean;
  status: 'active' | 'launching' | 'launched' | 'failed' | 'cancelled';
  isActive: boolean;
  targetAmount?: number;
  totalRaised: number;
  participantCount: number;
  progressPercent?: number;
  creatorWallet: string;
  predictionMarket?: PredictionMarketInfo;
  tokenAddress?: string;
  poolAddress?: string;
  launchTxHash?: string;
}

interface TopContributor {
  rank: number;
  wallet: string;
  fullWallet: string;
  totalUsdc: number;
  sharePercent: number;
  buyCount: number;
  estimatedTokens: number;
}

interface Participant {
  rank: number;
  wallet: string;
  totalUsdc: number;
  sharePercent: number;
  buyCount: number;
  firstBuy: number;
  lastBuy: number;
  estimatedTokens: number;
}

interface Stats {
  totalParticipants: number;
  averageContribution: number;
  largestContribution: number;
}

interface WalletInfo {
  address: string;
  totalContribution: number;
  sharePercent: number;
  buyCount: number;
  rank: number | null;
}

interface LaunchWithParticipants {
  launch: Launch;
  topContributors: TopContributor[];
  allParticipants?: Participant[];
  stats: Stats;
  wallet?: WalletInfo;
}

export function useClankerdomeLaunchWithParticipants(
  launchId: string | null,
  options?: {
    includeAllParticipants?: boolean;
    walletAddress?: string;
  }
) {
  const [data, setData] = useState<LaunchWithParticipants | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLaunch = useCallback(async () => {
    if (!launchId) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (options?.includeAllParticipants) {
        params.set('participants', 'true');
      }
      if (options?.walletAddress) {
        params.set('wallet', options.walletAddress);
      }

      const url = `${API_BASE_URL}/api/clankerdome/${launchId}${params.toString() ? '?' + params : ''}`;
      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch launch');
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [launchId, options?.includeAllParticipants, options?.walletAddress]);

  useEffect(() => {
    fetchLaunch();
  }, [fetchLaunch]);

  return {
    launch: data?.launch || null,
    topContributors: data?.topContributors || [],
    allParticipants: data?.allParticipants || [],
    stats: data?.stats || null,
    walletInfo: data?.wallet || null,
    loading,
    error,
    refresh: fetchLaunch,
  };
}

// Export types for use in components
export type { Launch, TopContributor, Participant, Stats, WalletInfo };
