// hooks/useTokenWarsEarnings.ts
// Token Wars Earnings Hooks - manage earnings queries and claims
// Uses @tanstack/react-query for data fetching and caching

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  EarningsSummaryResponse,
  WarEarningsResponse,
  CreatorEarningsResponse,
  UserRewardsResponse,
  FeeCalculationResponse,
} from '@/types/token-wars';

// ====================================
// Query Hooks
// ====================================

/**
 * Hook to get platform earnings summary
 * @returns Platform-wide earnings data including treasury balances
 */
export function useEarningsSummary() {
  return useQuery<EarningsSummaryResponse>({
    queryKey: ['token-wars-earnings', 'summary'],
    queryFn: async () => {
      const res = await fetch('/api/token-wars/earnings?type=summary');
      if (!res.ok) {
        throw new Error('Failed to fetch earnings summary');
      }
      return res.json();
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Hook to get earnings for a specific war
 * @param warId - The war ID to get earnings for
 * @returns War-specific earnings and volume breakdown
 */
export function useWarEarnings(warId: string | null | undefined) {
  return useQuery<WarEarningsResponse>({
    queryKey: ['token-wars-earnings', 'war', warId],
    queryFn: async () => {
      const res = await fetch(`/api/token-wars/earnings?type=war&warId=${warId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch war earnings');
      }
      return res.json();
    },
    enabled: !!warId,
    staleTime: 15000, // 15 seconds
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

/**
 * Hook to get all earnings for a creator
 * @param wallet - Creator wallet address
 * @returns Creator earnings summary across all wars
 */
export function useCreatorEarnings(wallet: string | null | undefined) {
  return useQuery<CreatorEarningsResponse>({
    queryKey: ['token-wars-earnings', 'creator', wallet],
    queryFn: async () => {
      const res = await fetch(`/api/token-wars/earnings?type=creator&wallet=${wallet}`);
      if (!res.ok) {
        throw new Error('Failed to fetch creator earnings');
      }
      return res.json();
    },
    enabled: !!wallet,
    staleTime: 15000,
    refetchInterval: 30000,
  });
}

/**
 * Hook to get rewards for a user
 * @param wallet - User wallet address
 * @param claimedFilter - Optional filter for claimed status (undefined = all, true = claimed only, false = pending only)
 * @returns User rewards list and pending totals
 */
export function useUserRewards(
  wallet: string | null | undefined,
  claimedFilter?: boolean
) {
  return useQuery<UserRewardsResponse>({
    queryKey: ['token-wars-earnings', 'user', wallet, claimedFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ type: 'user', wallet: wallet! });
      if (claimedFilter !== undefined) {
        params.set('claimed', String(claimedFilter));
      }
      const res = await fetch(`/api/token-wars/earnings?${params}`);
      if (!res.ok) {
        throw new Error('Failed to fetch user rewards');
      }
      return res.json();
    },
    enabled: !!wallet,
    staleTime: 15000,
    refetchInterval: 30000,
  });
}

/**
 * Hook to get only pending (unclaimed) rewards for a user
 * @param wallet - User wallet address
 * @returns Only pending/unclaimed rewards
 */
export function usePendingRewards(wallet: string | null | undefined) {
  return useUserRewards(wallet, false);
}

// ====================================
// Mutation Hooks
// ====================================

/**
 * Hook to claim creator earnings for a war
 * Invalidates relevant queries on success
 */
export function useClaimCreatorEarnings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ warId, txHash }: { warId: string; txHash: string }) => {
      const res = await fetch('/api/token-wars/earnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim_creator', warId, txHash }),
      });
      if (!res.ok) {
        throw new Error('Failed to claim creator earnings');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      // Invalidate creator earnings and war earnings queries
      queryClient.invalidateQueries({ queryKey: ['token-wars-earnings', 'creator'] });
      queryClient.invalidateQueries({ queryKey: ['token-wars-earnings', 'war', variables.warId] });
      queryClient.invalidateQueries({ queryKey: ['token-wars-earnings', 'summary'] });
    },
  });
}

/**
 * Hook to claim user rewards
 * Invalidates user rewards query on success
 */
export function useClaimUserRewards() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      wallet,
      rewardIds,
      txHash,
    }: {
      wallet: string;
      rewardIds: number[];
      txHash: string;
    }) => {
      const res = await fetch('/api/token-wars/earnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim_rewards', wallet, rewardIds, txHash }),
      });
      if (!res.ok) {
        throw new Error('Failed to claim rewards');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      // Invalidate user rewards queries
      queryClient.invalidateQueries({ queryKey: ['token-wars-earnings', 'user', variables.wallet] });
      queryClient.invalidateQueries({ queryKey: ['token-wars-earnings', 'summary'] });
    },
  });
}

// ====================================
// Utility Hooks
// ====================================

/**
 * Hook to calculate fees for an amount
 * @param amount - Amount to calculate fees for
 * @returns Fee breakdown with creator and platform fees
 */
export function useCalculateFees(amount: number | null | undefined) {
  return useQuery<FeeCalculationResponse>({
    queryKey: ['token-wars-fees', amount],
    queryFn: async () => {
      const res = await fetch('/api/token-wars/earnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'calculate_fees', amount }),
      });
      if (!res.ok) {
        throw new Error('Failed to calculate fees');
      }
      return res.json();
    },
    enabled: typeof amount === 'number' && amount > 0,
    staleTime: Infinity, // Fee calculations are deterministic
  });
}

/**
 * Synchronous fee calculation (no API call)
 * For immediate UI feedback before API response
 */
export function calculateFeesSync(amount: number) {
  const totalFeePercent = 2;
  const creatorFeePercent = 1;
  const platformFeePercent = 1;

  const totalFee = amount * (totalFeePercent / 100);
  const creatorFee = amount * (creatorFeePercent / 100);
  const platformFee = amount * (platformFeePercent / 100);
  const netAmount = amount - totalFee;

  return {
    originalAmount: amount,
    netAmount,
    totalFee,
    creatorFee,
    platformFee,
  };
}

// ====================================
// Combined Hooks
// ====================================

/**
 * Hook combining creator earnings with claim mutation
 * Useful for creator dashboard components
 */
export function useCreatorEarningsWithClaim(wallet: string | null | undefined) {
  const earningsQuery = useCreatorEarnings(wallet);
  const claimMutation = useClaimCreatorEarnings();

  return {
    ...earningsQuery,
    claim: claimMutation.mutate,
    claimAsync: claimMutation.mutateAsync,
    isClaiming: claimMutation.isPending,
    claimError: claimMutation.error,
  };
}

/**
 * Hook combining user rewards with claim mutation
 * Useful for rewards display components
 */
export function useUserRewardsWithClaim(wallet: string | null | undefined) {
  const rewardsQuery = useUserRewards(wallet);
  const claimMutation = useClaimUserRewards();

  return {
    ...rewardsQuery,
    claim: claimMutation.mutate,
    claimAsync: claimMutation.mutateAsync,
    isClaiming: claimMutation.isPending,
    claimError: claimMutation.error,
  };
}
