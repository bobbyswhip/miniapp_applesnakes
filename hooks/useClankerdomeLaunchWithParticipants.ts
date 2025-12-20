// hooks/useClankerdomeLaunchWithParticipants.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PredictionMarketInfo, WarLocks, DexVote, PairVote } from '@/types/token-wars';

// Call production API directly - no proxy needed
const API_BASE = 'https://api.applesnakes.com';

interface Launch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  durationHours?: number;
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
  creatorDexVote?: DexVote;
  creatorPairVote?: PairVote;
  predictionMarket?: PredictionMarketInfo;
  tokenAddress?: string;
  poolAddress?: string;
  launchTxHash?: string;
  // RAW ICO mode locks
  locks?: WarLocks;
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
  // Token Wars API returns 'war', legacy returns 'launch'
  war?: Launch;
  launch?: Launch;
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

  // Internal fetch function with option to show loading state
  const fetchLaunchInternal = useCallback(async (showLoading: boolean) => {
    if (!launchId) return;

    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      // Build URL - call production API directly (no proxy)
      const url = `${API_BASE}/api/token-wars/${launchId}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch launch');
      }

      // Transform participants to match expected format
      // Backend returns: { war, participants: [...], consensus }
      // We need: { war, topContributors: [...], allParticipants: [...], stats }
      const participants = result.participants || [];
      const sortedParticipants = [...participants]
        .sort((a: Participant, b: Participant) => (b.totalUsdc || 0) - (a.totalUsdc || 0))
        .map((p: Participant, index: number) => ({
          rank: index + 1,
          wallet: p.wallet ? `${p.wallet.slice(0, 6)}...${p.wallet.slice(-4)}` : 'Unknown',
          fullWallet: p.wallet || '',
          totalUsdc: p.totalUsdc || 0,
          sharePercent: p.sharePercent || 0,
          buyCount: p.buyCount || 0,
          estimatedTokens: 0,
          firstBuy: p.firstBuy,
          lastBuy: p.lastBuy,
        }));

      const totalContributions = sortedParticipants.reduce((sum: number, p: TopContributor) => sum + p.totalUsdc, 0);

      // Find wallet info if walletAddress is provided
      let walletData: WalletInfo | undefined;
      if (options?.walletAddress) {
        const walletLower = options.walletAddress.toLowerCase();
        const userParticipant = sortedParticipants.find(
          (p: TopContributor) => p.fullWallet.toLowerCase() === walletLower
        );
        if (userParticipant) {
          walletData = {
            address: userParticipant.fullWallet,
            totalContribution: userParticipant.totalUsdc,
            sharePercent: userParticipant.sharePercent,
            buyCount: userParticipant.buyCount,
            rank: userParticipant.rank,
          };
        }
      }

      const transformedData: LaunchWithParticipants = {
        war: result.war,
        topContributors: sortedParticipants.slice(0, 10),
        allParticipants: options?.includeAllParticipants ? sortedParticipants : undefined,
        stats: {
          totalParticipants: sortedParticipants.length,
          averageContribution: sortedParticipants.length > 0 ? totalContributions / sortedParticipants.length : 0,
          largestContribution: sortedParticipants[0]?.totalUsdc || 0,
        },
        wallet: walletData,
      };

      setData(transformedData);
    } catch (err) {
      console.error('[TokenWars] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [launchId, options?.includeAllParticipants, options?.walletAddress]);

  // Public refresh function - shows loading indicator
  const fetchLaunch = useCallback(() => {
    return fetchLaunchInternal(true);
  }, [fetchLaunchInternal]);

  // Silent refresh - updates data without showing loading indicator
  const silentRefresh = useCallback(() => {
    return fetchLaunchInternal(false);
  }, [fetchLaunchInternal]);

  useEffect(() => {
    fetchLaunch();
  }, [fetchLaunch]);

  return {
    // Token Wars API returns 'war', legacy returns 'launch'
    launch: data?.war || data?.launch || null,
    topContributors: data?.topContributors || [],
    allParticipants: data?.allParticipants || [],
    stats: data?.stats || null,
    walletInfo: data?.wallet || null,
    loading,
    error,
    refresh: fetchLaunch,
    silentRefresh, // For background polling without UI reset
  };
}

// Export types for use in components
export type { Launch, TopContributor, Participant, Stats, WalletInfo };
