// components/TokenWarsEarnings.tsx
'use client';

import { useState } from 'react';
import {
  useCreatorEarningsWithClaim,
  useUserRewardsWithClaim,
  useEarningsSummary,
  calculateFeesSync,
} from '@/hooks/useTokenWarsEarnings';
import type { RewardType } from '@/types/token-wars';

// ====================================
// Fee Display Component
// ====================================

interface FeeDisplayProps {
  amount: number;
  className?: string;
  compact?: boolean;
}

/**
 * Displays fee breakdown for a bet amount
 * Shows total fee (2%), creator fee (1%), platform fee (1%), and net amount
 */
export function FeeDisplay({ amount, className = '', compact = false }: FeeDisplayProps) {
  const fees = calculateFeesSync(amount);

  if (compact) {
    return (
      <div className={`text-xs text-gray-400 ${className}`}>
        Fee: ${fees.totalFee.toFixed(2)} (2%) → Pool: ${fees.netAmount.toFixed(2)}
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 rounded-lg p-3 space-y-2 ${className}`}>
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Your Bet</span>
        <span className="text-white font-medium">${amount.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-sm text-red-400">
        <span>Fee (2%)</span>
        <span>-${fees.totalFee.toFixed(2)}</span>
      </div>
      <div className="pl-4 space-y-1 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>→ Creator (1%)</span>
          <span>${fees.creatorFee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>→ Platform (1%)</span>
          <span>${fees.platformFee.toFixed(2)}</span>
        </div>
      </div>
      <div className="border-t border-gray-700 pt-2 flex justify-between text-sm font-semibold">
        <span className="text-gray-300">Goes to Pool</span>
        <span className="text-green-400">${fees.netAmount.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ====================================
// Creator Earnings Dashboard
// ====================================

interface CreatorEarningsDashboardProps {
  wallet: string;
  onClaimSuccess?: (warId: string) => void;
  className?: string;
}

/**
 * Dashboard showing creator earnings across all wars
 * Includes claim functionality for pending earnings
 */
export function CreatorEarningsDashboard({
  wallet,
  onClaimSuccess,
  className = '',
}: CreatorEarningsDashboardProps) {
  const { data, isLoading, error, claim, isClaiming } = useCreatorEarningsWithClaim(wallet);
  const [claimingWarId, setClaimingWarId] = useState<string | null>(null);

  const handleClaim = async (warId: string, earnings: number) => {
    setClaimingWarId(warId);
    try {
      // In production, this would be a real transaction hash
      const txHash = `0x${Date.now().toString(16)}mock`;
      await claim({ warId, txHash });
      onClaimSuccess?.(warId);
    } catch (err) {
      console.error('Claim failed:', err);
    } finally {
      setClaimingWarId(null);
    }
  };

  if (isLoading) {
    return (
      <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-16 bg-gray-700 rounded"></div>
            <div className="h-16 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
        <p className="text-red-400">Failed to load creator earnings</p>
      </div>
    );
  }

  const { creatorSummary } = data;

  return (
    <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-2xl">💰</span>
        Your Creator Earnings
      </h3>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Wars Created" value={creatorSummary.totalWars.toString()} />
        <StatCard
          label="Total Volume"
          value={`$${creatorSummary.totalVolume.toLocaleString()}`}
        />
        <StatCard
          label="Total Earnings"
          value={`$${creatorSummary.totalEarnings.toFixed(2)}`}
          highlight
        />
        <StatCard
          label="Pending"
          value={`$${creatorSummary.pendingEarnings.toFixed(2)}`}
          accent={creatorSummary.pendingEarnings > 0 ? 'green' : undefined}
        />
      </div>

      {/* Wars List */}
      {creatorSummary.wars.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-400 mb-2">Your Wars</h4>
          {creatorSummary.wars.map((war) => (
            <div
              key={war.warId}
              className="flex items-center justify-between bg-gray-700/30 rounded-lg p-3"
            >
              <div className="flex-1">
                <p className="text-sm text-white font-medium truncate">{war.warId}</p>
                <p className="text-xs text-gray-400">
                  Volume: ${war.volume.toLocaleString()} • Earnings: ${war.earnings.toFixed(2)}
                </p>
              </div>
              {war.claimed ? (
                <span className="text-xs text-gray-500 px-2 py-1 bg-gray-600/30 rounded">
                  Claimed
                </span>
              ) : war.earnings > 0 ? (
                <button
                  onClick={() => handleClaim(war.warId, war.earnings)}
                  disabled={isClaiming}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                    claimingWarId === war.warId
                      ? 'bg-gray-600 text-gray-300 cursor-wait'
                      : 'bg-green-600 hover:bg-green-500 text-white'
                  }`}
                >
                  {claimingWarId === war.warId ? 'Claiming...' : `Claim $${war.earnings.toFixed(2)}`}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {creatorSummary.wars.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">
          No wars created yet. Create a Token War to start earning!
        </p>
      )}
    </div>
  );
}

// ====================================
// User Rewards Component
// ====================================

interface UserRewardsProps {
  wallet: string;
  onClaimSuccess?: () => void;
  className?: string;
  maxItems?: number;
}

const REWARD_TYPE_LABELS: Record<RewardType, { label: string; emoji: string; color: string }> = {
  prediction_win: { label: 'Prediction Win', emoji: '🎯', color: 'text-green-400' },
  creator_fee: { label: 'Creator Fee', emoji: '💰', color: 'text-yellow-400' },
  referral: { label: 'Referral', emoji: '🤝', color: 'text-blue-400' },
  bonus: { label: 'Bonus', emoji: '🎁', color: 'text-purple-400' },
  refund: { label: 'Refund', emoji: '↩️', color: 'text-gray-400' },
};

/**
 * Display user rewards with claim functionality
 * Shows pending and claimed rewards with type indicators
 */
export function UserRewards({
  wallet,
  onClaimSuccess,
  className = '',
  maxItems = 10,
}: UserRewardsProps) {
  const { data, isLoading, error, claim, isClaiming } = useUserRewardsWithClaim(wallet);
  const [isClaimingAll, setIsClaimingAll] = useState(false);

  const handleClaimAll = async () => {
    if (!data?.rewards) return;

    const pendingRewardIds = data.rewards
      .filter((r) => !r.claimed)
      .map((r) => r.id);

    if (pendingRewardIds.length === 0) return;

    setIsClaimingAll(true);
    try {
      const txHash = `0x${Date.now().toString(16)}mock`;
      await claim({ wallet, rewardIds: pendingRewardIds, txHash });
      onClaimSuccess?.();
    } catch (err) {
      console.error('Claim all failed:', err);
    } finally {
      setIsClaimingAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3"></div>
          <div className="space-y-2">
            <div className="h-12 bg-gray-700 rounded"></div>
            <div className="h-12 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
        <p className="text-red-400">Failed to load rewards</p>
      </div>
    );
  }

  const { rewards, pending } = data;
  const displayRewards = rewards.slice(0, maxItems);

  return (
    <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">🏆</span>
          Your Rewards
        </h3>
        {pending.count > 0 && (
          <button
            onClick={handleClaimAll}
            disabled={isClaiming || isClaimingAll}
            className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${
              isClaimingAll
                ? 'bg-gray-600 text-gray-300 cursor-wait'
                : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
          >
            {isClaimingAll ? 'Claiming...' : `Claim All $${pending.total.toFixed(2)}`}
          </button>
        )}
      </div>

      {/* Pending Summary */}
      {pending.count > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-400 font-semibold text-lg">
                ${pending.total.toFixed(2)} Pending
              </p>
              <p className="text-green-400/70 text-sm">{pending.count} reward(s) to claim</p>
            </div>
            <div className="text-3xl">💎</div>
          </div>
        </div>
      )}

      {/* Rewards List */}
      {displayRewards.length > 0 ? (
        <div className="space-y-2">
          {displayRewards.map((reward) => {
            const typeInfo = REWARD_TYPE_LABELS[reward.rewardType];
            return (
              <div
                key={reward.id}
                className={`flex items-center justify-between rounded-lg p-3 ${
                  reward.claimed ? 'bg-gray-700/20' : 'bg-gray-700/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{typeInfo.emoji}</span>
                  <div>
                    <p className={`text-sm font-medium ${typeInfo.color}`}>{typeInfo.label}</p>
                    {reward.description && (
                      <p className="text-xs text-gray-500">{reward.description}</p>
                    )}
                    <p className="text-xs text-gray-600">
                      {new Date(reward.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${reward.claimed ? 'text-gray-500' : 'text-white'}`}>
                    ${reward.amountUsdc.toFixed(2)}
                  </p>
                  <p className={`text-xs ${reward.claimed ? 'text-gray-600' : 'text-green-400'}`}>
                    {reward.claimed ? 'Claimed' : 'Pending'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-gray-500 text-sm text-center py-4">
          No rewards yet. Participate in Token Wars to earn!
        </p>
      )}

      {rewards.length > maxItems && (
        <p className="text-gray-500 text-xs text-center mt-4">
          Showing {maxItems} of {rewards.length} rewards
        </p>
      )}
    </div>
  );
}

// ====================================
// Platform Earnings Summary
// ====================================

interface EarningsSummaryPanelProps {
  className?: string;
}

/**
 * Platform-wide earnings summary panel
 * Shows treasury balances and global stats
 */
export function EarningsSummaryPanel({ className = '' }: EarningsSummaryPanelProps) {
  const { data, isLoading, error } = useEarningsSummary();

  if (isLoading) {
    return (
      <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-20 bg-gray-700 rounded"></div>
            <div className="h-20 bg-gray-700 rounded"></div>
            <div className="h-20 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
        <p className="text-red-400">Failed to load earnings summary</p>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className={`bg-gray-800/30 rounded-xl p-6 ${className}`}>
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-2xl">📊</span>
        Platform Stats
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Volume"
          value={`$${summary.totalVolume.toLocaleString()}`}
        />
        <StatCard
          label="Fees Collected"
          value={`$${summary.totalFeesCollected.toLocaleString()}`}
        />
        <StatCard
          label="Active Wars"
          value={summary.activeWars.toString()}
          accent="blue"
        />
        <StatCard
          label="Pending Rewards"
          value={`$${summary.pendingUserRewards.toFixed(2)}`}
          accent="green"
        />
      </div>

      {/* Treasury Breakdown */}
      <div className="bg-gray-700/30 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Treasury Breakdown</h4>
        <div className="space-y-2 text-sm">
          <TreasuryRow label="Participant Funds" value={summary.treasury.participantFunds} />
          <TreasuryRow label="Market Pools" value={summary.treasury.marketPools} />
          <TreasuryRow label="Creator Pending" value={summary.treasury.creatorPending} accent="yellow" />
          <TreasuryRow label="Platform Earnings" value={summary.treasury.platformEarnings} accent="purple" />
          <TreasuryRow label="User Rewards" value={summary.treasury.userRewards} accent="green" />
          <div className="border-t border-gray-600 pt-2 mt-2">
            <TreasuryRow label="Total" value={summary.treasury.total} bold />
          </div>
        </div>
      </div>
    </div>
  );
}

// ====================================
// Helper Components
// ====================================

function StatCard({
  label,
  value,
  highlight,
  accent,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  accent?: 'green' | 'blue' | 'yellow' | 'purple';
}) {
  const accentColors = {
    green: 'text-green-400',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
  };

  return (
    <div
      className={`rounded-lg p-3 ${
        highlight ? 'bg-green-500/20 border border-green-500/30' : 'bg-gray-700/30'
      }`}
    >
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p
        className={`text-lg font-bold ${
          highlight ? 'text-green-400' : accent ? accentColors[accent] : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function TreasuryRow({
  label,
  value,
  accent,
  bold,
}: {
  label: string;
  value: number;
  accent?: 'green' | 'yellow' | 'purple';
  bold?: boolean;
}) {
  const accentColors = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
  };

  return (
    <div className="flex justify-between">
      <span className={bold ? 'text-white font-semibold' : 'text-gray-400'}>{label}</span>
      <span className={bold ? 'text-white font-bold' : accent ? accentColors[accent] : 'text-gray-300'}>
        ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

// ====================================
// Bet Confirmation Component
// ====================================

interface BetConfirmationProps {
  amount: number;
  marketType?: string;
  className?: string;
}

/**
 * Shows fee information before placing a bet
 * Only displays fee breakdown for Token Wars markets
 */
export function BetConfirmation({
  amount,
  marketType = 'token_war',
  className = '',
}: BetConfirmationProps) {
  const isTokenWarsMarket = ['dex_vote', 'pair_vote', 'token_war_sellout', 'token_war'].includes(
    marketType
  );

  if (!isTokenWarsMarket) {
    return (
      <div className={`text-sm text-gray-300 ${className}`}>
        Betting ${amount.toFixed(2)} (no fees)
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <FeeDisplay amount={amount} />
      <p className="text-xs text-gray-500 text-center">
        2% fee supports war creators and platform
      </p>
    </div>
  );
}

export default {
  FeeDisplay,
  CreatorEarningsDashboard,
  UserRewards,
  EarningsSummaryPanel,
  BetConfirmation,
};
