'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useTokenWarsLaunch, War as LaunchType } from '@/hooks/useTokenWarsLaunch';
import { useTokenWarsBuy } from '@/hooks/useTokenWarsBuy';
import { useClankerdomeLaunchWithParticipants, type TopContributor } from '@/hooks/useClankerdomeLaunchWithParticipants';
import { useLaunchConsensus } from '@/hooks/useLaunchConsensus';
import { PredictionMarketCard } from './PredictionMarketCard';
import { PredictionMarketPanel } from './PredictionMarketPanel';
import { TokenWarsPredictionMarketsV2 } from './TokenWarsPredictionMarketsV2';
import { useTokenWarsPredictionMarketsV2, useUnclaimedRewards, useClaimV2 } from '@/hooks/usePredictionMarketV2';
import { formatWASS, MARKET_TYPE_NAMES } from '@/types/prediction-market-v2';
import { ParticipantIdentityCompact } from './ParticipantIdentity';
import { ConsensusBar } from './ConsensusBar';
import { ProtocolVoteSelector } from './ProtocolVoteSelector';
import { useBatchIdentities } from '@/hooks/useBatchIdentities';
import { AdminTestButton, CancelWarButton, RemoveWarButton } from './AdminTestButton';
import { TradingTerminal, type LaunchedToken } from './TradingTerminal';
import { UserAllocations } from './UserAllocations';
import type { PredictionMarketInfo, ProtocolVote, WarLocks, DexVote, PairVote } from '@/types/token-wars';

type TabType = 'wars' | 'trading' | 'allocations' | 'rewards' | 'create';

interface Launch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  totalRaised: number;
  targetAmount?: number;
  participantCount: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  isActive: boolean;
  progressPercent?: number;
  creatorWallet?: string;
  predictionMarket?: PredictionMarketInfo;
  // RAW ICO mode locks
  locks?: WarLocks;
}

interface Stats {
  totalLaunches: number;
  activeLaunches: number;
  activePredictionMarkets: number;
  totalRaisedUsdc: number;
  totalParticipants: number;
}

interface LaunchDetails extends Launch {
  topContributors?: Array<{
    rank: number;
    wallet: string;
    totalUsdc: number;
    sharePercent: number;
    buyCount: number;
  }>;
}

interface WalletContribution {
  address: string;
  totalContribution: number;
  sharePercent: number;
  buyCount: number;
  rank: number;
}

// =============================================================================
// REWARDS TAB COMPONENT
// =============================================================================

interface RewardsTabProps {
  userAddress?: `0x${string}`;
}

function RewardsTab({ userAddress }: RewardsTabProps) {
  const {
    rewards,
    winnings,
    refunds,
    totalClaimable,
    totalClaimableFormatted,
    totalWinnings,
    totalWinningsFormatted,
    totalRefunds,
    totalRefundsFormatted,
    marketsWithRewards,
    marketsWithWinnings,
    marketsWithRefunds,
    isLoading,
    error,
    refetch,
  } = useUnclaimedRewards(userAddress);

  const { claimWinnings, claimRefund, isLoading: isClaiming, isSuccess: claimSuccess, hash: claimHash } = useClaimV2();
  const [claimingMarketId, setClaimingMarketId] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Refetch after successful claim
  useEffect(() => {
    if (claimSuccess) {
      setClaimingMarketId(null);
      setClaimError(null);
      // Refetch after a short delay to let the blockchain update
      const timer = setTimeout(() => {
        refetch();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [claimSuccess, refetch]);

  const handleClaim = async (marketId: number, isResolved: boolean) => {
    if (!userAddress) return;
    setClaimingMarketId(marketId);
    setClaimError(null);
    try {
      if (isResolved) {
        await claimWinnings(marketId);
      } else {
        await claimRefund(marketId);
      }
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
      setClaimingMarketId(null);
    }
  };

  const handleClaimAll = async () => {
    // Claim rewards one by one
    for (const reward of rewards) {
      if (reward.claimableAmount > 0n) {
        setClaimingMarketId(reward.marketId);
        try {
          if (reward.isResolved) {
            await claimWinnings(reward.marketId);
          } else if (reward.isClosed) {
            await claimRefund(reward.marketId);
          }
        } catch (err) {
          setClaimError(err instanceof Error ? err.message : "Claim failed");
          break;
        }
      }
    }
    setClaimingMarketId(null);
    // Refetch after all claims
    setTimeout(() => refetch(), 2000);
  };

  if (!userAddress) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-800/30 rounded-lg">
        <div className="text-center p-6">
          <div className="text-4xl mb-3">🔗</div>
          <p className="text-gray-400 text-sm">Connect your wallet to view rewards</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-800/30 rounded-lg">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-gray-400 text-xs">Scanning markets for rewards...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-800/30 rounded-lg">
        <div className="text-center">
          <p className="text-red-400 text-xs mb-2">Error: {error}</p>
          <button
            onClick={() => refetch()}
            className="px-3 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-4 p-2">
      {/* Summary Header */}
      <div className="bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border border-yellow-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-yellow-400">🏆 Unclaimed Rewards</h3>
            <p className="text-xs text-gray-400">Prediction market winnings & refunds ready to claim</p>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 bg-gray-700/50 rounded-lg hover:bg-gray-600/50 transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Totals Grid - Separate winnings and refunds */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-gray-800/50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold text-yellow-400">{totalClaimableFormatted}</div>
            <div className="text-[10px] text-gray-400">Total Claimable</div>
          </div>
          <div className="bg-green-900/30 border border-green-500/20 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-green-400">{totalWinningsFormatted}</div>
            <div className="text-[10px] text-green-300/70">Winnings ({marketsWithWinnings})</div>
          </div>
          <div className="bg-orange-900/30 border border-orange-500/20 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-orange-400">{totalRefundsFormatted}</div>
            <div className="text-[10px] text-orange-300/70">Refunds ({marketsWithRefunds})</div>
          </div>
        </div>

        {totalClaimable > 0n && (
          <button
            onClick={handleClaimAll}
            disabled={isClaiming}
            className="w-full py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-bold rounded-lg hover:from-yellow-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isClaiming ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Claiming...
              </span>
            ) : (
              `Claim All ${totalClaimableFormatted} wASS`
            )}
          </button>
        )}

        {claimError && (
          <p className="mt-2 text-xs text-red-400 text-center">{claimError}</p>
        )}
      </div>

      {/* Individual Rewards List - Separated by type */}
      {rewards.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">🎯</div>
          <p className="text-gray-400 text-sm">No unclaimed rewards</p>
          <p className="text-gray-500 text-xs mt-1">
            Participate in prediction markets to earn rewards!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Winnings Section */}
          {winnings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-green-400">🏆</span>
                <h4 className="text-sm font-semibold text-green-400">Winnings ({winnings.length})</h4>
              </div>
              {winnings.map((reward) => (
                <div
                  key={reward.marketId}
                  className="bg-green-900/20 border border-green-500/30 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-500">#{reward.marketId}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                        ✓ Won
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {MARKET_TYPE_NAMES[reward.marketType]}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-green-400">
                      {reward.claimableFormatted} wASS
                    </div>
                  </div>

                  {reward.winningOutcome > 0 && (
                    <div className="text-[10px] text-gray-400 mb-2">
                      Winning Outcome: #{reward.winningOutcome}
                    </div>
                  )}

                  <button
                    onClick={() => handleClaim(reward.marketId, true)}
                    disabled={isClaiming || claimingMarketId === reward.marketId}
                    className="w-full py-1.5 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {claimingMarketId === reward.marketId ? (
                      <span className="flex items-center justify-center gap-1">
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Claiming...
                      </span>
                    ) : (
                      'Claim Winnings'
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Refunds Section */}
          {refunds.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-orange-400">↩️</span>
                <h4 className="text-sm font-semibold text-orange-400">Refunds ({refunds.length})</h4>
                <span className="text-[10px] text-gray-500">(cancelled markets)</span>
              </div>
              {refunds.map((reward) => (
                <div
                  key={reward.marketId}
                  className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-500">#{reward.marketId}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
                        Cancelled
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {MARKET_TYPE_NAMES[reward.marketType]}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-orange-400">
                      {reward.claimableFormatted} wASS
                    </div>
                  </div>

                  <div className="text-[10px] text-gray-400 mb-2">
                    Market was cancelled - your deposit is refundable
                  </div>

                  <button
                    onClick={() => handleClaim(reward.marketId, false)}
                    disabled={isClaiming || claimingMarketId === reward.marketId}
                    className="w-full py-1.5 text-xs font-bold bg-orange-600 text-white rounded hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {claimingMarketId === reward.marketId ? (
                      <span className="flex items-center justify-center gap-1">
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Claiming...
                      </span>
                    ) : (
                      'Claim Refund'
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CREATE TAB COMPONENT (Full-page create experience)
// =============================================================================

interface CreateTabProps {
  walletAddress?: `0x${string}`;
  createLaunch: (params: {
    name: string;
    symbol: string;
    description?: string;
    image?: File | string;
    targetAmount?: number;
    durationHours?: number;
    amountUsdc: number;
    dexVote: 'v4' | 'aerodrome' | 'hydrex';
    pairVote: 'eth' | 'wass';
    lockedDex?: 'v4' | 'aerodrome' | 'hydrex';
    lockedPair?: 'eth' | 'wass';
  }) => Promise<unknown>;
  progress: { status: string; step: number; totalSteps: number; message: string };
  newLaunch: LaunchType | null;
  error: string | null;
  isLoading: boolean;
  onSuccess: () => void;
  onReset: () => void;
}

function CreateTab({
  walletAddress,
  createLaunch,
  progress,
  newLaunch,
  error,
  isLoading,
  onSuccess,
  onReset,
}: CreateTabProps) {
  // Duration constants
  const MIN_DURATION_HOURS = 8;
  const MAX_DURATION_HOURS = 720; // 30 days
  const DEFAULT_DURATION_HOURS = 24;

  // Preset durations for quick selection
  const DURATION_PRESETS = [
    { hours: 8, label: '8h' },
    { hours: 24, label: '1 Day' },
    { hours: 72, label: '3 Days' },
    { hours: 168, label: '1 Week' },
    { hours: 336, label: '2 Weeks' },
    { hours: 720, label: '30 Days' },
  ];

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    targetAmount: '',
    amountUsdc: '5',
    image: null as File | null,
    dexVote: 'aerodrome' as 'v4' | 'aerodrome' | 'hydrex',
    pairVote: 'eth' as 'eth' | 'wass',
    lockDex: false,
    lockPair: false,
    durationHours: DEFAULT_DURATION_HOURS,
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const isRawIco = formData.lockDex || formData.lockPair;
  const usdcAmount = parseFloat(formData.amountUsdc) || 0;

  // Helper function to format duration for display
  const formatDuration = (hours: number): string => {
    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    const days = hours / 24;
    if (days === Math.floor(days)) {
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
    const wholeDays = Math.floor(days);
    const remainingHours = hours % 24;
    return `${wholeDays}d ${remainingHours}h`;
  };

  // Calculate end time for preview
  const calculateEndTime = (): Date => {
    const endTime = new Date();
    endTime.setHours(endTime.getHours() + formData.durationHours);
    return endTime;
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, image: file }));
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress || usdcAmount < 5 || !Number.isInteger(usdcAmount)) return;

    try {
      await createLaunch({
        name: formData.name,
        symbol: formData.symbol,
        description: formData.description || undefined,
        image: formData.image || undefined,
        targetAmount: formData.targetAmount ? parseFloat(formData.targetAmount) : undefined,
        durationHours: formData.durationHours,
        amountUsdc: usdcAmount,
        dexVote: formData.dexVote,
        pairVote: formData.pairVote,
        lockedDex: formData.lockDex ? formData.dexVote : undefined,
        lockedPair: formData.lockPair ? formData.pairVote : undefined,
      });
    } catch (err) {
      console.error('War creation failed:', err);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      symbol: '',
      description: '',
      targetAmount: '',
      amountUsdc: '5',
      image: null,
      dexVote: 'aerodrome',
      pairVote: 'eth',
      lockDex: false,
      lockPair: false,
      durationHours: DEFAULT_DURATION_HOURS,
    });
    setImagePreview(null);
    onReset();
  };

  // Success state - inline card instead of modal
  if (newLaunch) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/30 rounded-2xl p-8 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <span className="text-4xl">✓</span>
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">Token War Created!</h2>
            <p className="text-gray-300 mb-8 text-lg">
              Your {formatDuration(formData.durationHours)} war for <span className="text-white font-semibold">{newLaunch.name}</span> is now live!
            </p>

            <div className="bg-gray-800/50 rounded-xl p-6 mb-8 text-left max-w-md mx-auto">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Token:</span>
                  <span className="text-white font-medium">{newLaunch.name} (${newLaunch.symbol})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Duration:</span>
                  <span className="text-cyan-400 font-medium">{formatDuration(formData.durationHours)}</span>
                </div>
                {newLaunch.targetAmount && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Target:</span>
                    <span className="text-green-400 font-medium">${newLaunch.targetAmount.toLocaleString()} USDC</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 mb-8 max-w-md mx-auto">
              <p className="text-purple-300">
                🎉 Share this war with your community! Users can buy in with USDC during the {formatDuration(formData.durationHours)} period.
              </p>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={onSuccess}
                className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl hover:from-purple-400 hover:to-pink-400 transition-all"
              >
                View War
              </button>
              <button
                onClick={resetForm}
                className="px-8 py-3 bg-gray-700 text-white font-medium rounded-xl hover:bg-gray-600 transition-colors"
              >
                Create Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!walletAddress) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center p-8">
          <div className="text-6xl mb-4">🔗</div>
          <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
          <p className="text-gray-400">Connect your wallet to create a Token War</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-1">⚔️ Create Token War</h2>
          <p className="text-gray-400">Launch a 24-hour token war and let the community decide</p>
        </div>

        {/* Progress indicator */}
        {isLoading && (
          <div className="mb-6 p-4 bg-purple-900/30 rounded-xl border border-purple-500/30">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-white font-medium">{progress.message}</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{ width: `${progress.totalSteps > 0 ? (progress.step / progress.totalSteps) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 text-red-400 rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Basic Info */}
            <div className="space-y-5">
              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700/50">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <span>📝</span> Token Details
                </h3>

                {/* Token Name */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Token Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="My Cool Token"
                    required
                    disabled={isLoading}
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                </div>

                {/* Symbol */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Symbol *</label>
                  <input
                    type="text"
                    value={formData.symbol}
                    onChange={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                    placeholder="MCT"
                    maxLength={10}
                    required
                    disabled={isLoading}
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                </div>

                {/* Description */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Tell us about your token..."
                    rows={4}
                    disabled={isLoading}
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50 resize-none"
                  />
                </div>

                {/* Image Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Token Image</label>
                  <div className="flex items-center gap-4">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="w-20 h-20 rounded-full object-cover border-2 border-purple-500" />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-2xl">
                        📷
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer">
                      <div className="bg-gray-900/50 border border-gray-600 border-dashed rounded-lg px-4 py-4 text-center text-gray-400 hover:border-purple-500 transition-colors">
                        {formData.image ? formData.image.name : 'Click to upload image'}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        disabled={isLoading}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Funding Section */}
              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700/50">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <span>💰</span> Funding
                </h3>

                {/* Target Amount */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Target Amount (USDC)</label>
                  <input
                    type="number"
                    value={formData.targetAmount}
                    onChange={(e) => setFormData(prev => ({ ...prev, targetAmount: e.target.value }))}
                    placeholder="1000"
                    min="0"
                    disabled={isLoading}
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Optional funding goal</p>
                </div>

                {/* Initial Contribution */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Your Initial Contribution (USDC) *</label>
                  <input
                    type="number"
                    value={formData.amountUsdc}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d+$/.test(val)) {
                        setFormData(prev => ({ ...prev, amountUsdc: val }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === '.' || e.key === ',') e.preventDefault();
                    }}
                    placeholder="5"
                    min="5"
                    step="1"
                    required
                    disabled={isLoading}
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum $5. No decimals allowed.</p>
                </div>
              </div>
            </div>

            {/* Right Column - Voting & Settings */}
            <div className="space-y-5">
              {/* Voting Options */}
              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700/50">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <span>🗳️</span> Your Votes
                </h3>

                {/* DEX Vote */}
                <div className="mb-5">
                  <label className="block text-sm font-medium text-gray-300 mb-3">DEX Vote</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['aerodrome', 'v4', 'hydrex'] as const).map((dex) => (
                      <button
                        key={dex}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, dexVote: dex }))}
                        disabled={isLoading}
                        className={`p-3 rounded-xl border-2 text-center transition-all ${
                          formData.dexVote === dex
                            ? dex === 'v4' ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                            : dex === 'aerodrome' ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                            : 'bg-orange-500/20 border-orange-500 text-orange-400'
                            : 'border-gray-600 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        <div className="text-sm font-medium">
                          {dex === 'v4' ? 'Uniswap V4' : dex === 'aerodrome' ? 'Aerodrome' : 'Hydrex'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pair Vote */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">Pair Vote</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, pairVote: 'eth' }))}
                      disabled={isLoading}
                      className={`flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                        formData.pairVote === 'eth'
                          ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400'
                          : 'border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      <img src="/Images/Ether.png" alt="ETH" className="w-6 h-6" />
                      <span className="font-medium">ETH</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, pairVote: 'wass' }))}
                      disabled={isLoading}
                      className={`flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                        formData.pairVote === 'wass'
                          ? 'bg-green-500/20 border-green-500 text-green-400'
                          : 'border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      <img src="/Images/Token.png" alt="wASS" className="w-6 h-6" />
                      <span className="font-medium">wASS</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* War Duration */}
              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700/50">
                <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                  <span>⏱️</span> War Duration
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Choose how long your Token War will run (8 hours to 30 days)
                </p>

                {/* Preset duration buttons */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {DURATION_PRESETS.map(({ hours, label }) => (
                    <button
                      key={hours}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, durationHours: hours }))}
                      disabled={isLoading}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        formData.durationHours === hours
                          ? 'bg-cyan-500/30 border-2 border-cyan-500 text-cyan-400'
                          : 'bg-gray-700/50 border-2 border-transparent text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Fine-tune slider */}
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={MIN_DURATION_HOURS}
                      max={MAX_DURATION_HOURS}
                      value={formData.durationHours}
                      onChange={(e) => setFormData(prev => ({ ...prev, durationHours: Number(e.target.value) }))}
                      disabled={isLoading}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                    <span className="text-cyan-400 font-bold min-w-[80px] text-right">
                      {formatDuration(formData.durationHours)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>8 hours</span>
                    <span>30 days</span>
                  </div>
                </div>

                {/* End time preview */}
                <div className="mt-4 p-3 bg-gray-900/50 rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-400">War ends:</span>
                    <span className="text-white font-medium">
                      {calculateEndTime().toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* RAW ICO Options */}
              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700/50">
                <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                  <span>🔒</span> RAW ICO Mode
                  <span className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">Advanced</span>
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Lock voting options to disable community voting. Higher fees apply.
                </p>

                <div className="space-y-3">
                  <label className="flex items-center gap-4 p-3 bg-gray-900/30 rounded-lg cursor-pointer hover:bg-gray-900/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.lockDex}
                      onChange={(e) => setFormData(prev => ({ ...prev, lockDex: e.target.checked }))}
                      disabled={isLoading}
                      className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500"
                    />
                    <div className="flex-1">
                      <span className="text-white font-medium">Lock DEX to {formData.dexVote === 'v4' ? 'Uniswap V4' : formData.dexVote}</span>
                      <p className="text-xs text-gray-500">Disable DEX voting - all buys use your choice</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-4 p-3 bg-gray-900/30 rounded-lg cursor-pointer hover:bg-gray-900/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.lockPair}
                      onChange={(e) => setFormData(prev => ({ ...prev, lockPair: e.target.checked }))}
                      disabled={isLoading}
                      className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500"
                    />
                    <div className="flex-1">
                      <span className="text-white font-medium">Lock Pair to {formData.pairVote.toUpperCase()}</span>
                      <p className="text-xs text-gray-500">Disable pair voting - all buys use your choice</p>
                    </div>
                  </label>
                </div>

                {isRawIco && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-400 font-medium mb-1">⚠️ RAW ICO Active</p>
                    <ul className="text-xs text-yellow-400/80 space-y-0.5">
                      {formData.lockDex && <li>• DEX locked to {formData.dexVote === 'v4' ? 'Uniswap V4' : formData.dexVote}</li>}
                      {formData.lockPair && <li>• Pair locked to {formData.pairVote.toUpperCase()}</li>}
                      <li>• Protocol fee: 15% (vs 10% standard)</li>
                      <li>• Prediction markets not created for locked options</li>
                    </ul>
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">ℹ️</span>
                  <div className="text-sm text-gray-300">
                    <p className="mb-2">Your token war will run for <span className="text-white font-medium">{formatDuration(formData.durationHours)}</span>.</p>
                    <p>After the war ends, the token will be deployed on the winning DEX and paired accordingly.</p>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading || !walletAddress || !formData.name || !formData.symbol || usdcAmount < 5}
                className={`
                  w-full py-4 rounded-xl font-bold text-lg transition-all
                  ${isLoading || !walletAddress || usdcAmount < 5
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400 hover:scale-[1.02]'
                  }
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : usdcAmount < 5 ? (
                  'Minimum $5 USDC Required'
                ) : isRawIco ? (
                  `Create RAW ICO ($${usdcAmount} USDC) 🔒`
                ) : (
                  `Create Token War ($${usdcAmount} USDC) ⚔️`
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TokenWarsProps {
  onTradeToken?: (token: LaunchedToken) => void;
}

export function TokenWars({ onTradeToken }: TokenWarsProps = {}) {
  const { address } = useAccount();
  const [activeTab, setActiveTab] = useState<TabType>('wars');
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLaunch, setSelectedLaunch] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    totalLaunches: 0,
    activeLaunches: 0,
    activePredictionMarkets: 0,
    totalRaisedUsdc: 0,
    totalParticipants: 0,
  });

  // Launch creation hook (Token Wars)
  const {
    progress: launchProgress,
    war: newLaunch,
    error: launchError,
    createWar: createLaunch,
    reset: resetLaunch,
    isLoading: isCreatingLaunch
  } = useTokenWarsLaunch();

  // Fetch launches directly from production API
  const fetchLaunches = useCallback(async () => {
    try {
      const res = await fetch('https://api.applesnakes.com/api/token-wars', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      // Check if response is OK before parsing
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      // Check content type
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('API returned non-JSON response');
      }

      const data = await res.json();
      if (data.success || data.currentLaunches || data.wars) {
        // API returns currentLaunches/wars array with embedded predictionMarket data
        setLaunches(data.wars || data.currentLaunches || data.launches || []);
        if (data.stats) {
          setStats(data.stats);
        }
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch wars');
      }
    } catch (err) {
      console.error('Failed to fetch wars:', err);
      setError('Unable to connect to Token Wars');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch and refresh
  useEffect(() => {
    fetchLaunches();
    const interval = setInterval(fetchLaunches, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [fetchLaunches]);

  // If a market is selected, show the full panel
  if (selectedMarketId) {
    return (
      <div className="space-y-4 overflow-y-auto flex-1">
        <PredictionMarketPanel
          marketId={selectedMarketId}
          onClose={() => setSelectedMarketId(null)}
        />
      </div>
    );
  }

  // If a launch/war is selected, show full-screen war detail (not a popup)
  if (selectedLaunch) {
    return (
      <WarDetailView
        launchId={selectedLaunch}
        walletAddress={address}
        onClose={() => setSelectedLaunch(null)}
        onRefreshList={fetchLaunches}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
        <p className="text-gray-400">Loading Token Wars...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab Navigation */}
      <div className="flex-shrink-0 flex items-center gap-1 mb-3 border-b border-gray-700/50 pb-2">
        <button
          onClick={() => setActiveTab('wars')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'wars'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          Active Wars
        </button>
        <button
          onClick={() => setActiveTab('trading')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'trading'
              ? 'bg-green-600 text-white'
              : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          Trading
        </button>
        <button
          onClick={() => setActiveTab('allocations')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'allocations'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          My Tokens
        </button>
        <button
          onClick={() => setActiveTab('rewards')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'rewards'
              ? 'bg-yellow-600 text-white'
              : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          🏆 Rewards
        </button>
        {address && (
          <button
            onClick={() => setActiveTab('create')}
            className={`ml-auto px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'create'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                : 'bg-gradient-to-r from-purple-500/50 to-pink-500/50 text-white/80 hover:from-purple-500 hover:to-pink-500 hover:text-white'
            }`}
          >
            + Create
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Trading Terminal Tab */}
        {activeTab === 'trading' && <TradingTerminal onTradeToken={onTradeToken} />}

        {/* User Allocations Tab */}
        {activeTab === 'allocations' && <UserAllocations walletAddress={address ?? null} />}

        {/* Rewards Tab */}
        {activeTab === 'rewards' && <RewardsTab userAddress={address} />}

        {/* Create Tab */}
        {activeTab === 'create' && (
          <CreateTab
            walletAddress={address}
            createLaunch={createLaunch}
            progress={launchProgress}
            newLaunch={newLaunch}
            error={launchError}
            isLoading={isCreatingLaunch}
            onSuccess={() => {
              resetLaunch();
              fetchLaunches();
              setActiveTab('wars');
            }}
            onReset={resetLaunch}
          />
        )}

        {/* Active Wars Tab */}
        {activeTab === 'wars' && (
          <div className="h-full overflow-y-auto space-y-4">
            {/* Header Stats - Compact */}
            <div className="flex items-center gap-1 text-xs overflow-x-auto pb-1">
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
                <span className="text-gray-400">Active:</span>
                <span className="font-bold text-white">{stats.activeLaunches}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
                <span className="text-gray-400">Raised:</span>
                <span className="font-bold text-green-400">${stats.totalRaisedUsdc.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
                <span className="text-gray-400">Markets:</span>
                <span className="font-bold text-purple-400">{stats.activePredictionMarkets}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
                <span className="text-gray-400">Users:</span>
                <span className="font-bold text-cyan-400">{stats.totalParticipants}</span>
              </div>
            </div>

            {/* Error State */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                <p className="text-red-400 text-sm">{error}</p>
                <button onClick={fetchLaunches} className="mt-2 text-xs text-red-400 hover:text-red-300">Retry</button>
              </div>
            )}

            {/* Wars List */}
            {launches.length === 0 ? (
              <EmptyState type="launches" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {launches.map((launch) => {
                  const hasMarket = launch.predictionMarket?.hasMarket ?? false;
                  const marketId = launch.predictionMarket?.id;
                  return (
                    <LaunchCard
                      key={launch.id}
                      launch={launch}
                      hasMarket={hasMarket}
                      onClick={() => setSelectedLaunch(launch.id)}
                      onMarketClick={marketId
                        ? () => setSelectedMarketId(marketId)
                        : undefined
                      }
                      onRefresh={fetchLaunches}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// Stat Card Component
function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg" dangerouslySetInnerHTML={{ __html: icon }} />
        <span className="text-gray-400 text-xs">{label}</span>
      </div>
      <div className="text-lg font-bold text-white">{value}</div>
    </div>
  );
}

// Empty State Component
function EmptyState({ type }: { type: 'launches' | 'markets' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center border border-purple-500/30 mb-4">
        <span className="text-4xl">⚔️</span>
      </div>
      <h3 className="text-xl font-bold text-white mb-2">No Active Wars</h3>
      <p className="text-gray-400 max-w-sm">
        No token wars are happening right now. Check back soon or start your own!
      </p>
    </div>
  );
}

// Launch Card Component
function LaunchCard({
  launch,
  hasMarket,
  onClick,
  onMarketClick,
  onRefresh
}: {
  launch: Launch;
  hasMarket?: boolean;
  onClick: () => void;
  onMarketClick?: () => void;
  onRefresh?: () => void;
}) {
  const [timeRemaining, setTimeRemaining] = useState(launch.timeRemainingMs);

  // Countdown timer
  useEffect(() => {
    setTimeRemaining(launch.timeRemainingMs);
    const interval = setInterval(() => {
      setTimeRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [launch.timeRemainingMs]);

  const formatTime = (ms: number) => {
    if (ms <= 0) return 'Ended';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const isEnding = timeRemaining < 3600000; // Less than 1 hour
  const isEnded = timeRemaining <= 0;

  return (
    <div
      className={`
        bg-gray-800/50 rounded-xl p-4 border-2 transition-all duration-200
        ${isEnded ? 'opacity-60' : ''}
        ${isEnding && !isEnded ? 'border-orange-500/50' : 'border-gray-700/50'}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {launch.imageUrl ? (
            <img
              src={getImageUrl(launch.imageUrl)}
              alt={launch.name}
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg font-bold text-white">
              {launch.symbol.slice(0, 2)}
            </div>
          )}
          <div>
            <h3 className="font-bold text-white">{launch.name}</h3>
            <span className="text-sm text-gray-400">${launch.symbol}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* RAW ICO Badge */}
          {launch.locks?.isRawIco && (
            <span className="px-2 py-1 bg-purple-600/30 text-purple-300 text-xs rounded-full font-medium border border-purple-500/30">
              RAW ICO
            </span>
          )}
          {hasMarket && (
            <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full font-medium">
              🔮
            </span>
          )}
          {launch.isActive && !isEnded && (
            <>
              <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full font-medium">
                LIVE
              </span>
              <AdminTestButton
                warId={launch.id}
                warSymbol={launch.symbol}
                onSuccess={onRefresh}
              />
              <CancelWarButton
                warId={launch.id}
                warSymbol={launch.symbol}
                onCancelled={onRefresh}
              />
              <RemoveWarButton
                warId={launch.id}
                warSymbol={launch.symbol}
                onRemoved={onRefresh}
              />
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {launch.targetAmount && (
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">Progress</span>
            <span className="text-white">
              ${launch.totalRaised.toLocaleString()} / ${launch.targetAmount.toLocaleString()}
            </span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
              style={{ width: `${Math.min(100, launch.progressPercent || 0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-gray-900/50 rounded-lg p-2 text-center">
          <div className="text-gray-400 text-xs">Raised</div>
          <div className="font-bold text-green-400">${launch.totalRaised.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-2 text-center">
          <div className="text-gray-400 text-xs">Participants</div>
          <div className="font-bold text-white">{launch.participantCount}</div>
        </div>
      </div>

      {/* Prediction Market Stats */}
      {launch.predictionMarket?.hasMarket && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-cyan-900/30 border border-cyan-500/20 rounded-lg p-2 text-center">
            <div className="text-cyan-400/70 text-xs">💵 Pool</div>
            <div className="font-bold text-cyan-400 text-sm">${(launch.predictionMarket.totalPool || 0).toLocaleString()}</div>
          </div>
          <div className="bg-purple-900/30 border border-purple-500/20 rounded-lg p-2 text-center">
            <div className="text-purple-400/70 text-xs">🎲 Bets</div>
            <div className="font-bold text-purple-400 text-sm">{launch.predictionMarket.totalBets || 0}</div>
          </div>
          <div className="bg-blue-900/30 border border-blue-500/20 rounded-lg p-2 text-center">
            <div className="text-blue-400/70 text-xs">👥 Bettors</div>
            <div className="font-bold text-blue-400 text-sm">{launch.predictionMarket.uniqueBettors || 0}</div>
          </div>
        </div>
      )}

      {/* Countdown */}
      <div className={`text-center py-2 rounded-lg ${isEnding && !isEnded ? 'bg-orange-500/20' : 'bg-gray-900/50'}`}>
        <div className="text-xs text-gray-400 mb-1">
          {isEnded ? 'War Ended' : 'Time Remaining'}
        </div>
        <div className={`text-lg font-mono font-bold ${isEnding && !isEnded ? 'text-orange-400' : 'text-white'}`}>
          {formatTime(timeRemaining)}
        </div>
      </div>

      {/* CTAs */}
      {!isEnded && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={onClick}
            className="flex-1 py-2 rounded-lg font-medium transition-colors bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400"
          >
            Join War
          </button>
          {onMarketClick && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMarketClick();
              }}
              className="px-4 py-2 rounded-lg font-medium transition-colors bg-purple-900/50 text-purple-400 hover:bg-purple-900/70 border border-purple-500/30"
            >
              🔮 Predict
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Helper to convert IPFS URLs to HTTP gateway URLs with proper fallback handling
// Based on imagefix.md documentation
function getImageUrl(url?: string): string | undefined {
  if (!url) return undefined;

  // IPFS CID Gateway URL - preferred format, always works
  if (url.includes('ipfs.filebase.io/ipfs/')) {
    return url;
  }

  // Handle ipfs:// protocol URLs
  if (url.startsWith('ipfs://')) {
    const cid = url.replace('ipfs://', '');
    return `https://ipfs.filebase.io/ipfs/${cid}`;
  }

  // Temp bucket URL - NOT publicly accessible, return undefined to show fallback
  if (url.includes('temp-images.s3.filebase.com')) {
    console.warn(`[TokenWars] War has temp URL (not accessible): ${url}`);
    return undefined;
  }

  // S3 bucket URL - may work if bucket is public
  if (url.includes('.s3.filebase.com')) {
    return url;
  }

  // Handle other IPFS gateway URLs (ipfs.io, cloudflare-ipfs, etc.)
  const cidMatch = url.match(/ipfs\/([a-zA-Z0-9]+)/);
  if (cidMatch) {
    const cid = cidMatch[1];
    // Prefer filebase gateway for consistency
    return `https://ipfs.filebase.io/ipfs/${cid}`;
  }

  // Return as-is for other URLs (could be regular HTTP images)
  return url;
}

// Full-Screen War Detail View Component (replaces the old popup modal)
function WarDetailView({
  launchId,
  walletAddress,
  onClose,
  onRefreshList,
}: {
  launchId: string;
  walletAddress?: string;
  onClose: () => void;
  onRefreshList?: () => void;
}) {
  const { buyIn, isLoading: buyLoading, error: buyError, statusMessage } = useTokenWarsBuy();
  const [amount, setAmount] = useState('10');
  const [localError, setLocalError] = useState<string | null>(null);
  // DEX vote type - supports all 3 options (uniswap maps to v4 internally)
  const [protocolVote, setProtocolVote] = useState<'uniswap' | 'aerodrome' | 'hydrex'>('aerodrome');
  // Pair vote type - ETH or wASS
  const [pairVote, setPairVote] = useState<'eth' | 'wass'>('eth');
  // Success notification state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Tab state for ICO vs Predictions
  const [activeTab, setActiveTab] = useState<'ico' | 'predictions'>('ico');

  // Prediction markets data for unified stats
  const {
    markets: predictionMarkets,
    userPositions: predictionPositions,
    isLoading: predictionsLoading,
  } = useTokenWarsPredictionMarketsV2({
    warId: launchId,
    userAddress: walletAddress as `0x${string}` | undefined,
    autoRefresh: true,
  });

  // Calculate prediction market stats (V2 - using wASS bigint values, convert from wei)
  const totalPredictionPool = predictionMarkets.reduce(
    (sum, m) => sum + Number(m.totalDeposits || 0n) / 1e18, 0
  );
  const activeMarkets = predictionMarkets.filter(m => m.isActive);
  const totalMarkets = predictionMarkets.length;
  const totalUserPositions = predictionPositions.length;
  const totalClaimable = predictionPositions.reduce(
    (sum, pos) => sum + Number(pos.claimableAmount || 0n) / 1e18, 0
  );

  // Fetch consensus data
  const { consensus, refresh: refreshConsensus } = useLaunchConsensus(launchId, 5000);

  // Use the new hook for launch data with participants
  const {
    launch,
    topContributors,
    walletInfo,
    loading: fetchingDetails,
    refresh,
    silentRefresh
  } = useClankerdomeLaunchWithParticipants(launchId, {
    walletAddress
  });

  // Auto-refresh war details every 4 seconds (silent - no loading indicator)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      silentRefresh();
      refreshConsensus();
    }, 4000);
    return () => clearInterval(refreshInterval);
  }, [silentRefresh, refreshConsensus]);

  // Batch fetch identities for all participants (basenames + avatars)
  const participantAddresses = useMemo(
    () => topContributors.map(p => p.fullWallet),
    [topContributors]
  );
  const { getIdentity } = useBatchIdentities(participantAddresses);

  // Sellout notification state
  const [selloutNotification, setSelloutNotification] = useState<{
    type: 'launch' | 'extended';
    message: string;
  } | null>(null);

  // Countdown timer state
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    if (launch?.timeRemainingMs) {
      setTimeRemaining(launch.timeRemainingMs);
    }
  }, [launch?.timeRemainingMs]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ms: number) => {
    if (ms <= 0) return 'Ended';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  // Handle buy using the hook
  const handleBuy = async () => {
    if (!walletAddress || !launch) return;

    setLocalError(null);
    setSelloutNotification(null);
    setSuccessMessage(null);
    const amountNum = parseFloat(amount);

    if (isNaN(amountNum) || amountNum < 1) {
      setLocalError('Minimum buy-in is $1 USDC');
      return;
    }

    // Ensure integer amount (no decimals)
    if (!Number.isInteger(amountNum)) {
      setLocalError('Decimals not allowed. Use whole numbers only.');
      return;
    }

    // Get locks from launch data (RAW ICO mode)
    const locks = launch.locks;

    // Check if DEX is locked (check both isDexLocked and lockedDex directly)
    const isDexLocked = locks?.isDexLocked || !!locks?.lockedDex;
    // Check if Pair is locked (check both isPairLocked and lockedPair directly)
    const isPairLocked = locks?.isPairLocked || !!locks?.lockedPair;

    // Map protocolVote to DexVote (uniswap -> v4, others pass through)
    // Use locked value if DEX is locked, otherwise use selected vote
    const dexVote: DexVote = isDexLocked && locks?.lockedDex
      ? locks.lockedDex
      : (protocolVote === 'uniswap' ? 'v4' : protocolVote);

    // Use locked value if Pair is locked, otherwise use selected vote
    const finalPairVote: PairVote = isPairLocked && locks?.lockedPair
      ? locks.lockedPair
      : pairVote;

    const result = await buyIn({
      warId: launchId,
      dexVote,
      pairVote: finalPairVote,
      amountUsdc: amountNum,
    });

    if (result?.success) {
      // Refresh data immediately after successful buy (silent - no loading indicator)
      silentRefresh();
      refreshConsensus();
      onRefreshList?.(); // Refresh the main list too

      // Show success message (stays on page!)
      setSuccessMessage(`Successfully bought $${amountNum} into ${launch.symbol}!`);

      // Handle sellout status
      if (result.sellout) {
        if (result.sellout.readyToLaunch) {
          setSelloutNotification({
            type: 'launch',
            message: `${result.war?.symbol || 'Token'} is ready to launch!`,
          });
        } else if (result.sellout.action === 'extended') {
          setSelloutNotification({
            type: 'extended',
            message: `DEX tie detected! War extended to ${new Date(result.war?.endsAt || 0).toLocaleString()}`,
          });
        }
      }

      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    }
  };

  const error = localError || buyError;

  const estimatedShare = launch && launch.totalRaised > 0
    ? (((walletInfo?.totalContribution || 0) + parseFloat(amount || '0')) / (launch.totalRaised + parseFloat(amount || '0'))) * 100
    : 100;

  const isEnding = timeRemaining < 3600000;
  const isEnded = timeRemaining <= 0;

  // Loading state
  if (fetchingDetails) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
        <p className="text-gray-400">Loading war details...</p>
      </div>
    );
  }

  // Not found state
  if (!launch) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-400 mb-4">War not found</p>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          ← Back to Wars
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header with Stats */}
      <div className="flex-shrink-0 pb-2 border-b border-gray-700/50 mb-2">
        {/* Top Row: Back + Token Info + Timer */}
        <div className="flex items-center gap-1 sm:gap-2 mb-2">
          <button
            onClick={onClose}
            className="p-1 sm:p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white flex-shrink-0"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
            {launch.imageUrl ? (
              <img src={getImageUrl(launch.imageUrl)} alt={launch.name} className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex-shrink-0" />
            ) : (
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs sm:text-sm font-bold text-white flex-shrink-0">
                {launch.symbol.slice(0, 2)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-base font-bold text-white truncate">{launch.name}</h1>
              <span className="text-[10px] sm:text-xs text-gray-400">${launch.symbol}</span>
            </div>
          </div>
          <div className={`text-right px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg flex-shrink-0 ${isEnding && !isEnded ? 'bg-orange-500/20' : 'bg-gray-800/50'}`}>
            <div className="text-[8px] sm:text-[10px] text-gray-400">{isEnded ? 'Ended' : 'Time Left'}</div>
            <div className={`text-xs sm:text-sm font-mono font-bold ${isEnding && !isEnded ? 'text-orange-400' : 'text-cyan-400'}`}>
              {formatTime(timeRemaining)}
            </div>
          </div>
        </div>

        {/* Unified Stats Row - ICO + Predictions */}
        <div className="flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs overflow-x-auto pb-2 scrollbar-hide">
          {/* ICO Stats */}
          <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-green-900/30 border border-green-500/20 rounded-lg whitespace-nowrap">
            <span className="text-green-400/70 text-[10px] sm:text-xs">💰</span>
            <span className="font-bold text-green-400">${launch.totalRaised.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
            <span className="text-gray-400 text-[10px] sm:text-xs">👥</span>
            <span className="font-bold text-white">{launch.participantCount}</span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-purple-900/30 border border-purple-500/20 rounded-lg whitespace-nowrap">
            <span className="text-purple-400/70 text-[10px] sm:text-xs">📊</span>
            <span className="font-bold text-purple-400">{walletInfo?.sharePercent?.toFixed(1) || '0'}%</span>
          </div>
          {/* Separator */}
          <div className="w-px h-3 sm:h-4 bg-gray-600 mx-0.5 sm:mx-1 flex-shrink-0"></div>
          {/* Prediction Stats */}
          <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-cyan-900/30 border border-cyan-500/20 rounded-lg whitespace-nowrap">
            <span className="text-cyan-400/70 text-[10px] sm:text-xs">🎲</span>
            <span className="font-bold text-cyan-400">
              {totalMarkets > 0 ? (
                activeMarkets.length < totalMarkets
                  ? `${activeMarkets.length}/${totalMarkets}`
                  : totalMarkets
              ) : '0'}
            </span>
          </div>
          {totalPredictionPool > 0 && (
            <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-cyan-900/30 border border-cyan-500/20 rounded-lg whitespace-nowrap">
              <span className="text-cyan-400/70 text-[10px] sm:text-xs">🎲</span>
              <span className="font-bold text-cyan-400">{totalPredictionPool.toFixed(2)} wASS</span>
            </div>
          )}
          {totalUserPositions > 0 && (
            <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-blue-900/30 border border-blue-500/20 rounded-lg whitespace-nowrap">
              <span className="text-blue-400/70 text-[10px] sm:text-xs">📈</span>
              <span className="font-bold text-blue-400">{totalUserPositions}</span>
            </div>
          )}
          {totalClaimable > 0 && (
            <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-yellow-900/30 border border-yellow-500/20 rounded-lg whitespace-nowrap animate-pulse">
              <span className="text-yellow-400/70 text-[10px] sm:text-xs">🏆</span>
              <span className="font-bold text-yellow-400">{totalClaimable.toFixed(2)} wASS</span>
            </div>
          )}
        </div>

        {/* ICO Progress Bar - Always visible */}
        <div className="mt-2 mb-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-400">ICO Progress</span>
            <span className="text-white">
              ${launch.totalRaised.toLocaleString()}
              {launch.targetAmount ? ` / $${launch.targetAmount.toLocaleString()}` : ''}
            </span>
          </div>
          <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
              style={{
                width: launch.targetAmount
                  ? `${Math.min(100, (launch.totalRaised / launch.targetAmount) * 100)}%`
                  : launch.totalRaised > 0 ? '100%' : '0%'
              }}
            />
          </div>
          {launch.targetAmount && (
            <div className="text-right text-[9px] text-gray-500 mt-0.5">
              {Math.min(100, (launch.totalRaised / launch.targetAmount) * 100).toFixed(1)}% funded
            </div>
          )}
        </div>

        {/* Tab Buttons */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('ico')}
            className={`flex-1 py-1.5 sm:py-2 px-2 sm:px-3 rounded-lg font-bold text-xs sm:text-sm transition-all ${
              activeTab === 'ico'
                ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-500/20'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white'
            }`}
          >
            💰 <span className="hidden xs:inline">Join </span>War
          </button>
          <button
            onClick={() => setActiveTab('predictions')}
            className={`flex-1 py-1.5 sm:py-2 px-2 sm:px-3 rounded-lg font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'predictions'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white'
            }`}
          >
            🎲 <span className="hidden xs:inline">Predictions</span><span className="xs:hidden">Bets</span>
            {predictionMarkets.length > 0 && (
              <span className={`px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] ${
                activeTab === 'predictions' ? 'bg-white/20' : 'bg-cyan-500/30 text-cyan-400'
              }`}>
                {predictionMarkets.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* RAW ICO Banner - Show if any lock is set */}
      {(launch.locks?.isRawIco || launch.locks?.lockedDex || launch.locks?.lockedPair) && (
        <div className="flex-shrink-0 mb-2 p-2 bg-purple-900/30 border border-purple-500/30 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">🔒</span>
            <span className="text-xs font-bold text-purple-400">RAW ICO MODE</span>
          </div>
          <div className="text-[10px] text-purple-300/80 space-y-0.5">
            {(launch.locks?.isDexLocked || launch.locks?.lockedDex) && (
              <p>• DEX locked to <span className="font-bold uppercase">{launch.locks?.lockedDex === 'v4' ? 'Uniswap V4' : launch.locks?.lockedDex}</span></p>
            )}
            {(launch.locks?.isPairLocked || launch.locks?.lockedPair) && (
              <p>• Pair locked to <span className="font-bold uppercase">{launch.locks?.lockedPair}</span></p>
            )}
            <p className="text-purple-400/60">Voting disabled for locked options • 15% protocol fee</p>
          </div>
        </div>
      )}

      {/* Notifications - Compact */}
      {(selloutNotification || (consensus && (consensus.dex?.isTie || consensus.pair?.isTie))) && (
        <div className="flex-shrink-0 space-y-1 mb-2">
          {selloutNotification && (
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
              selloutNotification.type === 'launch' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'
            }`}>
              <span>{selloutNotification.type === 'launch' ? '🎉' : '⏰'}</span>
              <span className="font-medium">{selloutNotification.message}</span>
            </div>
          )}
          {consensus?.dex?.isTie && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-yellow-900/30 rounded-lg text-xs text-yellow-400">
              <span>⚠️</span><span>DEX Tie - War extends if ended</span>
            </div>
          )}
          {consensus?.pair?.isTie && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-blue-900/30 rounded-lg text-xs text-blue-400">
              <span>ℹ️</span><span>Pair tie - wASS used</span>
            </div>
          )}
        </div>
      )}

      {/* Token Address Banner (if launched) */}
      {launch.tokenAddress && (
        <div className="flex-shrink-0 bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/30 rounded-lg p-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">Token:</span>
            <a href={`https://basescan.org/token/${launch.tokenAddress}`} target="_blank" rel="noopener noreferrer"
              className="font-mono text-xs text-green-400 hover:text-green-300 break-all">{launch.tokenAddress}</a>
            {/* Only show Trade button when ICO has ended */}
            {isEnded && (
              <a href={`https://dexscreener.com/base/${launch.tokenAddress}`} target="_blank" rel="noopener noreferrer"
                className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded transition-colors">Trade</a>
            )}
          </div>
        </div>
      )}

      {/* Tab Content Area */}
      {activeTab === 'ico' && (
      /* ICO TAB - Main Content - Two Column Grid */
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 overflow-hidden">
        {/* Left Column: Buy Section */}
        <div className="flex flex-col min-h-0 overflow-hidden">
          {!isEnded ? (
            <div className="flex-1 bg-gray-800/50 rounded-lg p-2 border border-gray-700/50 overflow-y-auto">
              {/* Success/Error Messages */}
              {successMessage && (
                <div className="bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg p-2 mb-2 flex items-center gap-2 text-xs">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="truncate">{successMessage}</span>
                </div>
              )}
              {error && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg p-2 mb-2 text-xs">{error}</div>
              )}

              {/* DEX Vote - Compact */}
              <div className="mb-2">
                <label className="block text-[10px] font-medium text-gray-400 mb-1">DEX Vote</label>
                {/* Check if DEX is locked (RAW ICO mode) - check both isDexLocked and lockedDex directly */}
                {(launch.locks?.isDexLocked || launch.locks?.lockedDex) ? (
                  <div className="bg-gray-900/50 rounded-lg p-2 border border-purple-500/30">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">🔒 Locked to:</span>
                      <span className="text-xs font-bold text-purple-400 uppercase">
                        {launch.locks?.lockedDex === 'v4' ? 'Uniswap V4' : launch.locks?.lockedDex}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">Voting disabled by creator (RAW ICO)</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
                    {(['uniswap', 'aerodrome', 'hydrex'] as const).map((dex) => {
                      const dexKey = dex === 'uniswap' ? 'v4' : dex;
                      const dexData = consensus?.dex?.[dexKey as keyof typeof consensus.dex];
                      const votes = typeof dexData === 'object' && dexData !== null ? (dexData as { votes?: number }).votes ?? 0 : 0;
                      const percent = typeof dexData === 'object' && dexData !== null ? (dexData as { percent?: number }).percent ?? 0 : 0;
                      return (
                        <button
                          key={dex}
                          onClick={() => setProtocolVote(dex)}
                          disabled={buyLoading}
                          className={`p-1 sm:p-1.5 rounded-lg border text-center transition-all ${
                            protocolVote === dex
                              ? dex === 'uniswap' ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                              : dex === 'aerodrome' ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                              : 'bg-orange-500/20 border-orange-500 text-orange-400'
                              : 'border-gray-600 text-gray-400 hover:border-gray-500'
                          } ${buyLoading ? 'opacity-50' : ''}`}
                        >
                          <div className="text-[9px] sm:text-[10px] font-bold">{dex === 'uniswap' ? 'Uniswap' : dex === 'aerodrome' ? 'Aerodrome' : 'Hydrex'}</div>
                          <div className="text-[8px] sm:text-[9px]">${votes} ({percent.toFixed(0)}%)</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pair Vote - Compact */}
              <div className="mb-2">
                <label className="block text-[10px] font-medium text-gray-400 mb-1">Pair Vote</label>
                {/* Check if Pair is locked (RAW ICO mode) - check both isPairLocked and lockedPair directly */}
                {(launch.locks?.isPairLocked || launch.locks?.lockedPair) ? (
                  <div className="bg-gray-900/50 rounded-lg p-2 border border-purple-500/30">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">🔒 Locked to:</span>
                      <span className="text-xs font-bold text-purple-400 uppercase">
                        {launch.locks?.lockedPair}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">Voting disabled by creator (RAW ICO)</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-0.5 sm:gap-1">
                    <button
                      onClick={() => setPairVote('eth')}
                      disabled={buyLoading}
                      className={`flex items-center gap-1 sm:gap-1.5 p-1 sm:p-1.5 rounded-lg border transition-all ${
                        pairVote === 'eth' ? 'bg-indigo-500/20 border-indigo-500' : 'border-gray-600 hover:border-gray-500'
                      } ${buyLoading ? 'opacity-50' : ''}`}
                    >
                      <img src="/Images/Ether.png" alt="ETH" className="w-4 h-4 sm:w-5 sm:h-5" />
                      <div className="text-left min-w-0">
                        <div className={`text-[10px] sm:text-xs font-bold ${pairVote === 'eth' ? 'text-indigo-400' : 'text-white'}`}>ETH</div>
                        <div className="text-[8px] sm:text-[9px] text-gray-400">${consensus?.pair?.eth?.votes ?? 0} ({(consensus?.pair?.eth?.percent ?? 50).toFixed(0)}%)</div>
                      </div>
                    </button>
                    <button
                      onClick={() => setPairVote('wass')}
                      disabled={buyLoading}
                      className={`flex items-center gap-1 sm:gap-1.5 p-1 sm:p-1.5 rounded-lg border transition-all ${
                        pairVote === 'wass' ? 'bg-green-500/20 border-green-500' : 'border-gray-600 hover:border-gray-500'
                      } ${buyLoading ? 'opacity-50' : ''}`}
                    >
                      <img src="/Images/Token.png" alt="wASS" className="w-4 h-4 sm:w-5 sm:h-5" />
                      <div className="text-left min-w-0">
                        <div className={`text-[10px] sm:text-xs font-bold ${pairVote === 'wass' ? 'text-green-400' : 'text-white'}`}>wASS</div>
                        <div className="text-[8px] sm:text-[9px] text-gray-400">${consensus?.pair?.wass?.votes ?? 0} ({(consensus?.pair?.wass?.percent ?? 50).toFixed(0)}%)</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Amount Input - Compact */}
              <div className="mb-2">
                <label className="block text-[9px] sm:text-[10px] font-medium text-gray-400 mb-1">Amount (USDC)</label>
                <div className="relative mb-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs sm:text-sm">$</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => {
                      // Only allow integers
                      const val = e.target.value;
                      if (val === '' || /^\d+$/.test(val)) {
                        setAmount(val);
                      }
                    }}
                    onKeyDown={(e) => {
                      // Block decimal point input
                      if (e.key === '.' || e.key === ',') {
                        e.preventDefault();
                      }
                    }}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-5 sm:pl-6 pr-2 py-1.5 sm:py-2 text-sm sm:text-base text-white focus:outline-none focus:border-purple-500"
                    min="1"
                    step="1"
                  />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                  {[5, 10, 25, 50, 100, 500].map((val) => (
                    <button
                      key={val}
                      onClick={() => setAmount(val.toString())}
                      className={`py-1 sm:py-1.5 rounded text-[9px] sm:text-[10px] font-medium transition-colors ${
                        amount === val.toString() ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      ${val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimated Share */}
              <div className="flex justify-between items-center text-[10px] sm:text-xs bg-gray-900/50 rounded-lg px-2 py-1 sm:py-1.5 mb-2">
                <span className="text-gray-400">Est. Share:</span>
                <span className="font-bold text-white">{estimatedShare.toFixed(2)}%</span>
              </div>

              {/* Buy Button */}
              <button
                onClick={handleBuy}
                disabled={buyLoading || !walletAddress || parseFloat(amount) < 1}
                className={`w-full py-2 sm:py-2.5 rounded-lg font-bold text-xs sm:text-sm transition-all ${
                  buyLoading || !walletAddress
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : protocolVote === 'uniswap'
                      ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400'
                      : protocolVote === 'aerodrome'
                        ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400'
                        : 'bg-gradient-to-r from-orange-600 to-orange-500 text-white hover:from-orange-500 hover:to-orange-400'
                }`}
              >
                {buyLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {statusMessage || 'Processing...'}
                  </span>
                ) : !walletAddress ? (
                  'Connect Wallet'
                ) : (
                  `Buy $${amount}`
                )}
              </button>
            </div>
          ) : (
            <div className="flex-1 bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-2xl mb-2">⏱️</div>
                <div className="font-medium">War Ended</div>
                <div className="text-xs">Voting is closed</div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Consensus + Participants */}
        <div className="flex flex-col min-h-0 gap-1.5 sm:gap-2 overflow-hidden">
          {/* Consensus - Compact */}
          <div className="flex-shrink-0 bg-gray-800/50 rounded-lg p-1.5 sm:p-2 border border-gray-700/50">
            <h3 className="text-[10px] sm:text-xs font-bold text-white mb-1 sm:mb-1.5">Vote Consensus</h3>
            <ConsensusBar consensus={consensus} />
          </div>

          {/* Participants - Scrollable */}
          <div className="flex-1 min-h-0 bg-gray-800/50 rounded-lg p-1.5 sm:p-2 border border-gray-700/50 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-1 sm:mb-1.5 flex-shrink-0">
              <h3 className="text-[10px] sm:text-xs font-bold text-white">Top Contributors ({launch.participantCount})</h3>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {topContributors.length > 0 ? (
                <div className="space-y-0.5 sm:space-y-1">
                  {topContributors.slice(0, 8).map((p: TopContributor) => (
                    <div key={p.fullWallet} className="flex justify-between items-center p-1 sm:p-1.5 bg-gray-900/50 rounded-lg">
                      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                        <span className={`text-[10px] sm:text-xs font-bold flex-shrink-0 ${
                          p.rank === 1 ? 'text-yellow-400' : p.rank === 2 ? 'text-gray-300' : p.rank === 3 ? 'text-orange-400' : 'text-gray-500'
                        }`}>
                          {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`}
                        </span>
                        <div className="min-w-0 truncate">
                          <ParticipantIdentityCompact address={p.fullWallet} identity={getIdentity(p.fullWallet)} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] sm:text-xs font-bold text-white">${p.totalUsdc.toLocaleString()}</div>
                        <div className="text-[8px] sm:text-[10px] text-cyan-400">{p.sharePercent.toFixed(1)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-3 sm:py-4 text-gray-400 text-[10px] sm:text-xs">
                  <p>No participants yet</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
      )}

      {/* PREDICTIONS TAB - V2 On-Chain */}
      {activeTab === 'predictions' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TokenWarsPredictionMarketsV2
            warId={launchId}
            warName={launch.name}
            warSymbol={launch.symbol}
          />
        </div>
      )}
    </div>
  );
}

export default TokenWars;
