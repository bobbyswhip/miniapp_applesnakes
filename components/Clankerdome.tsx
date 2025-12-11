'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useClankerdomeLaunch, Launch as LaunchType } from '@/hooks/useClankerdomeLaunch';
import { useClankerdomeBuy } from '@/hooks/useClankerdomeBuy';
import { useClankerdomeLaunchWithParticipants, type TopContributor } from '@/hooks/useClankerdomeLaunchWithParticipants';
import { PredictionMarketCard } from './PredictionMarketCard';
import { PredictionMarketPanel } from './PredictionMarketPanel';
import { ParticipantIdentityCompact } from './ParticipantIdentity';
import { useBatchIdentities } from '@/hooks/useBatchIdentities';
import type { PredictionMarketInfo } from '@/types/clankerdome';

// API Base URL
const API_BASE_URL = 'https://api.applesnakes.com';

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

type ClankerdomeTab = 'launches' | 'markets';

export function Clankerdome() {
  const { address } = useAccount();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLaunch, setSelectedLaunch] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ClankerdomeTab>('launches');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [stats, setStats] = useState<Stats>({
    totalLaunches: 0,
    activeLaunches: 0,
    activePredictionMarkets: 0,
    totalRaisedUsdc: 0,
    totalParticipants: 0,
  });

  // Launch creation hook
  const {
    progress: launchProgress,
    launch: newLaunch,
    error: launchError,
    createLaunch,
    reset: resetLaunch,
    isLoading: isCreatingLaunch
  } = useClankerdomeLaunch();

  // Fetch launches - using /api/clankerdome/launch to get embedded prediction market data
  const fetchLaunches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clankerdome/launch`);
      const data = await res.json();
      if (data.success || data.currentLaunches) {
        // API returns currentLaunches array with embedded predictionMarket data
        setLaunches(data.currentLaunches || data.launches || []);
        if (data.stats) {
          setStats(data.stats);
        }
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch launches');
      }
    } catch (err) {
      console.error('Failed to fetch launches:', err);
      setError('Unable to connect to Clankerdome');
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
        <p className="text-gray-400">Loading Clankerdome...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-y-auto flex-1">
      {/* Header with Create Button */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">Clankerdome</h2>
        {address && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium hover:from-purple-400 hover:to-pink-400 transition-colors flex items-center gap-2"
          >
            <span>+</span>
            Create Launch
          </button>
        )}
      </div>

      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active Launches" value={stats.activeLaunches} icon="&#127914;" />
        <StatCard label="Total Raised" value={`$${stats.totalRaisedUsdc.toLocaleString()}`} icon="&#128176;" />
        <StatCard label="Active Markets" value={stats.activePredictionMarkets} icon="&#128302;" />
        <StatCard label="Total Participants" value={stats.totalParticipants} icon="&#128101;" />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('launches')}
          className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
            activeTab === 'launches'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <span>&#127914;</span>
            Launch Parties ({stats.activeLaunches})
          </span>
        </button>
        <button
          onClick={() => setActiveTab('markets')}
          className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
            activeTab === 'markets'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <span>&#128302;</span>
            Prediction Markets ({stats.activePredictionMarkets})
          </span>
        </button>
      </div>

      {/* Error State */}
      {error && activeTab === 'launches' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-red-400">{error}</p>
          <button
            onClick={fetchLaunches}
            className="mt-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'launches' ? (
        /* Launches Tab */
        <div>
          {launches.length === 0 ? (
            <EmptyState type="launches" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Markets Tab - derive from launches with hasMarket */
        <div>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            </div>
          ) : (() => {
            // Get markets from launches that have predictionMarket.hasMarket and an id
            const marketsFromLaunches = launches
              .filter(l => l.predictionMarket?.hasMarket && l.predictionMarket?.id)
              .map(l => ({
                id: l.predictionMarket!.id,
                launchName: l.name,
                launchSymbol: l.symbol,
                progressPercent: l.progressPercent || 0
              }));

            return marketsFromLaunches.length === 0 ? (
              <EmptyState type="markets" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {marketsFromLaunches.map((market) => {
                  // Find the launch to get the full embeddedMarket data
                  const launch = launches.find(l => l.predictionMarket?.id === market.id);
                  return (
                    <PredictionMarketCard
                      key={market.id}
                      marketId={market.id}
                      launchName={market.launchSymbol}
                      currentProgress={market.progressPercent}
                      embeddedMarket={launch?.predictionMarket}
                      onSelect={() => setSelectedMarketId(market.id)}
                      onRefresh={fetchLaunches}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Create Launch Modal */}
      {showCreateForm && (
        <CreateLaunchModal
          walletAddress={address}
          createLaunch={createLaunch}
          progress={launchProgress}
          newLaunch={newLaunch}
          error={launchError}
          isLoading={isCreatingLaunch}
          onClose={() => {
            setShowCreateForm(false);
            resetLaunch();
          }}
          onSuccess={() => {
            setShowCreateForm(false);
            resetLaunch();
            fetchLaunches();
          }}
        />
      )}

      {/* Buy Modal */}
      {selectedLaunch && (
        <BuyModal
          launchId={selectedLaunch}
          walletAddress={address}
          onClose={() => setSelectedLaunch(null)}
          onSuccess={() => {
            setSelectedLaunch(null);
            fetchLaunches();
          }}
        />
      )}
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
        <span className="text-4xl">{type === 'launches' ? '🎪' : '🔮'}</span>
      </div>
      <h3 className="text-xl font-bold text-white mb-2">
        {type === 'launches' ? 'No Active Launches' : 'No Active Markets'}
      </h3>
      <p className="text-gray-400 max-w-sm">
        {type === 'launches'
          ? 'No launch parties are happening right now. Check back soon or start your own!'
          : 'No prediction markets are active. Markets are created when new launches begin.'}
      </p>
    </div>
  );
}

// Launch Card Component
function LaunchCard({
  launch,
  hasMarket,
  onClick,
  onMarketClick
}: {
  launch: Launch;
  hasMarket?: boolean;
  onClick: () => void;
  onMarketClick?: () => void;
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
              src={launch.imageUrl}
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
          {hasMarket && (
            <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full font-medium">
              🔮
            </span>
          )}
          {launch.isActive && !isEnded && (
            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full font-medium">
              LIVE
            </span>
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

      {/* Countdown */}
      <div className={`text-center py-2 rounded-lg ${isEnding && !isEnded ? 'bg-orange-500/20' : 'bg-gray-900/50'}`}>
        <div className="text-xs text-gray-400 mb-1">
          {isEnded ? 'Launch Party Ended' : 'Time Remaining'}
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
            Join Party
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

// Create Launch Modal Component
function CreateLaunchModal({
  walletAddress,
  createLaunch,
  progress,
  newLaunch,
  error,
  isLoading,
  onClose,
  onSuccess,
}: {
  walletAddress?: string;
  createLaunch: (params: {
    name: string;
    symbol: string;
    description?: string;
    creatorWallet: string;
    image?: File | string;
    targetAmount?: number;
    durationHours?: number;
  }) => Promise<unknown>;
  progress: { status: string; step: number; totalSteps: number; message: string };
  newLaunch: LaunchType | null;
  error: string | null;
  isLoading: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    targetAmount: '',
    image: null as File | null,
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);

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

    if (!walletAddress) {
      return;
    }

    try {
      await createLaunch({
        name: formData.name,
        symbol: formData.symbol,
        description: formData.description || undefined,
        creatorWallet: walletAddress,
        image: formData.image || undefined,
        targetAmount: formData.targetAmount ? parseFloat(formData.targetAmount) : undefined,
        durationHours: 24,
      });
    } catch (err) {
      console.error('Launch creation failed:', err);
    }
  };

  // Show success state
  if (newLaunch) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div
          className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-700"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Launch Party Created!</h2>
            <p className="text-gray-400 mb-6">
              Your 24-hour presale for <span className="text-white font-medium">{newLaunch.name}</span> is now live!
            </p>

            <div className="bg-gray-800 rounded-lg p-4 mb-6 text-left space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Token:</span>
                <span className="text-white">{newLaunch.name} (${newLaunch.symbol})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Time Left:</span>
                <span className="text-cyan-400">{newLaunch.timeRemainingFormatted}</span>
              </div>
              {newLaunch.targetAmount && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Target:</span>
                  <span className="text-green-400">${newLaunch.targetAmount.toLocaleString()} USDC</span>
                </div>
              )}
            </div>

            <div className="bg-purple-900/30 border border-purple-500/30 rounded-lg p-4 mb-6">
              <p className="text-sm text-purple-300">
                Share this launch with your community! Users can buy in with USDC during the 24-hour presale period.
              </p>
            </div>

            <button
              onClick={onSuccess}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl hover:from-purple-400 hover:to-pink-400 transition-all"
            >
              View Launch
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Create Launch Party</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">
            &times;
          </button>
        </div>

        {/* Progress indicator */}
        {isLoading && (
          <div className="mb-6 p-4 bg-purple-900/30 rounded-xl border border-purple-500/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-white">{progress.message}</span>
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
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Token Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Token Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Cool Token"
              required
              disabled={isLoading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>

          {/* Symbol */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Symbol *</label>
            <input
              type="text"
              value={formData.symbol}
              onChange={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
              placeholder="MCT"
              maxLength={10}
              required
              disabled={isLoading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Tell us about your token..."
              rows={3}
              disabled={isLoading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50 resize-none"
            />
          </div>

          {/* Target Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Target Amount (USDC)</label>
            <input
              type="number"
              value={formData.targetAmount}
              onChange={(e) => setFormData(prev => ({ ...prev, targetAmount: e.target.value }))}
              placeholder="1000"
              min="0"
              disabled={isLoading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
            <p className="text-xs text-gray-500 mt-1">Optional funding goal</p>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Token Image</label>
            <div className="flex items-center gap-4">
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-gray-400">
                  📷
                </div>
              )}
              <label className="flex-1 cursor-pointer">
                <div className="bg-gray-800 border border-gray-700 border-dashed rounded-lg px-4 py-3 text-center text-gray-400 hover:border-purple-500 transition-colors">
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

          {/* Info Box */}
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-start gap-3">
              <span className="text-xl">ℹ️</span>
              <div className="text-sm text-gray-400">
                <p className="mb-2">Your launch party will run for <span className="text-white">24 hours</span>.</p>
                <p>Users can buy in with USDC during this period. After the presale ends, the token will be deployed on Clanker and paired with WASS.</p>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !walletAddress || !formData.name || !formData.symbol}
            className={`
              w-full py-4 rounded-xl font-bold text-lg transition-all
              ${isLoading || !walletAddress
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400'
              }
            `}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </span>
            ) : !walletAddress ? (
              'Connect Wallet First'
            ) : (
              'Create Launch Party 🚀'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Buy Modal Component
function BuyModal({
  launchId,
  walletAddress,
  onClose,
  onSuccess,
}: {
  launchId: string;
  walletAddress?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { buyIn, isLoading: buyLoading, error: buyError } = useClankerdomeBuy();
  const [amount, setAmount] = useState('10');
  const [localError, setLocalError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'buy' | 'participants' | 'predict'>('buy');

  // Use the new hook for launch data with participants
  const {
    launch,
    topContributors,
    walletInfo,
    loading: fetchingDetails,
    refresh
  } = useClankerdomeLaunchWithParticipants(launchId, {
    walletAddress
  });

  // Batch fetch identities for all participants (basenames + avatars)
  const participantAddresses = useMemo(
    () => topContributors.map(p => p.fullWallet),
    [topContributors]
  );
  const { getIdentity, isLoading: identitiesLoading } = useBatchIdentities(participantAddresses);

  // Handle buy using the hook
  const handleBuy = async () => {
    if (!walletAddress || !launch) return;

    setLocalError(null);
    const amountNum = parseFloat(amount);

    if (isNaN(amountNum) || amountNum < 1) {
      setLocalError('Minimum buy-in is $1 USDC');
      return;
    }

    const result = await buyIn(launchId, amountNum);
    if (result?.success) {
      refresh(); // Refresh data after successful buy
      onSuccess();
    }
  };

  // Combine errors
  const error = localError || buyError;

  // Calculate estimated share
  const estimatedShare = launch && launch.totalRaised > 0
    ? (((walletInfo?.totalContribution || 0) + parseFloat(amount || '0')) / (launch.totalRaised + parseFloat(amount || '0'))) * 100
    : 100;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {fetchingDetails ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : !launch ? (
          <div className="text-center py-8">
            <p className="text-gray-400">Launch not found</p>
            <button onClick={onClose} className="mt-4 text-purple-400 hover:text-purple-300">
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                {launch.imageUrl ? (
                  <img src={launch.imageUrl} alt={launch.name} className="w-12 h-12 rounded-full" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg font-bold">
                    {launch.symbol.slice(0, 2)}
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold text-white">{launch.name}</h2>
                  <span className="text-gray-400">${launch.symbol}</span>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">
                &times;
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-400">Total Raised</div>
                <div className="font-bold text-green-400">${launch.totalRaised.toLocaleString()}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-400">Participants</div>
                <div className="font-bold text-white">{launch.participantCount}</div>
              </div>
            </div>

            {/* Your Contribution */}
            {walletInfo && walletInfo.totalContribution > 0 && (
              <div className="bg-purple-900/30 rounded-lg p-3 mb-4 border border-purple-500/30">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-gray-400">Your Contribution</div>
                    <div className="font-bold text-lg text-white">${walletInfo.totalContribution.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400">Share</div>
                    <div className="font-bold text-purple-400">{walletInfo.sharePercent.toFixed(2)}%</div>
                  </div>
                </div>
                {walletInfo.rank && (
                  <div className="mt-2 pt-2 border-t border-purple-500/20 flex justify-between text-sm">
                    <span className="text-gray-400">Your Rank</span>
                    <span className="text-yellow-400 font-medium">#{walletInfo.rank}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab Navigation */}
            <div className="flex gap-1 mb-4 border-b border-gray-700">
              <button
                onClick={() => setActiveTab('buy')}
                className={`px-4 py-2 font-medium text-sm transition-all border-b-2 ${
                  activeTab === 'buy'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Buy In
              </button>
              <button
                onClick={() => setActiveTab('participants')}
                className={`px-4 py-2 font-medium text-sm transition-all border-b-2 ${
                  activeTab === 'participants'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Participants ({launch.participantCount})
              </button>
              {launch.predictionMarket?.hasMarket && launch.predictionMarket?.id && (
                <button
                  onClick={() => setActiveTab('predict')}
                  className={`px-4 py-2 font-medium text-sm transition-all border-b-2 ${
                    activeTab === 'predict'
                      ? 'border-cyan-500 text-cyan-400'
                      : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  🎲 Predict
                </button>
              )}
            </div>

            {activeTab === 'buy' && (
              <>
            {/* Amount Input */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">Amount to Contribute (USDC)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-8 py-3 text-lg text-white focus:outline-none focus:border-purple-500"
                  min="1"
                  step="1"
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[5, 10, 25, 50, 100].map((val) => (
                  <button
                    key={val}
                    onClick={() => setAmount(val.toString())}
                    className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${
                      amount === val.toString()
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    ${val}
                  </button>
                ))}
              </div>
            </div>

            {/* Estimated Share */}
            <div className="bg-gray-800 rounded-lg p-3 mb-6">
              <div className="text-sm text-gray-400">Estimated Share After Buy</div>
              <div className="font-bold text-lg text-white">{estimatedShare.toFixed(2)}%</div>
              <div className="text-xs text-gray-500 mt-1">
                Every $1 = equal share. No bonding curve.
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg p-3 mb-4 text-sm">
                {error}
              </div>
            )}

            {/* Buy Button */}
            <button
              onClick={handleBuy}
              disabled={buyLoading || !walletAddress || parseFloat(amount) < 1}
              className={`
                w-full py-3 rounded-xl font-bold text-lg transition-all
                ${buyLoading || !walletAddress
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400'
                }
              `}
            >
              {buyLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </span>
              ) : !walletAddress ? (
                'Connect Wallet First'
              ) : (
                `Buy In for $${amount} USDC`
              )}
            </button>

            {/* Info */}
            <p className="text-xs text-gray-500 text-center mt-4">
              USDC will be transferred via x402 payment protocol.
              <br />
              All contributions are pooled for the token launch dev buy.
            </p>
              </>
            )}

            {activeTab === 'participants' && (
              /* Participants Tab */
              <div className="space-y-4">
                {/* Top Contributors Preview */}
                {topContributors.length > 0 ? (
                  <div className="space-y-2">
                    {topContributors.map((p: TopContributor) => (
                      <div
                        key={p.fullWallet}
                        className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${
                            p.rank === 1 ? 'text-yellow-400' :
                            p.rank === 2 ? 'text-gray-300' :
                            p.rank === 3 ? 'text-orange-400' : 'text-gray-500'
                          }`}>
                            {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`}
                          </span>
                          <ParticipantIdentityCompact address={p.fullWallet} identity={getIdentity(p.fullWallet)} />
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-white">${p.totalUsdc.toLocaleString()}</div>
                          <div className="text-xs text-cyan-400">{p.sharePercent.toFixed(2)}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <p>No participants yet</p>
                    <p className="text-sm mt-1">Be the first to join!</p>
                  </div>
                )}

                {/* Estimated Token Info */}
                {topContributors.length > 0 && (
                  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700">
                    <div className="text-xs text-gray-400 mb-1">Token Allocation Preview</div>
                    <div className="text-sm text-gray-300">
                      Based on 1B total supply. Share % = token %.
                    </div>
                  </div>
                )}

                <button
                  onClick={() => refresh()}
                  className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  🔄 Refresh
                </button>
              </div>
            )}

            {activeTab === 'predict' && launch.predictionMarket?.hasMarket && launch.predictionMarket?.id && (
              /* Predict Tab */
              <div className="space-y-4">
                <PredictionMarketCard
                  marketId={launch.predictionMarket.id}
                  launchName={launch.symbol || launch.name}
                  currentProgress={launch.targetAmount && launch.targetAmount > 0
                    ? (launch.totalRaised / launch.targetAmount) * 100
                    : 0
                  }
                  embeddedMarket={launch.predictionMarket}
                  onRefresh={refresh}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Clankerdome;
