// components/PredictionMarketCard.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { usePlaceBet } from '@/hooks/usePlaceBet';
import { SELLOUT_LABELS } from '@/types/clankerdome';
import type { BetResult, PredictionMarketInfo } from '@/types/clankerdome';

// Embedded outcome from launch response
interface EmbeddedOutcome {
  index: number;
  label: string;
  yesProbability: number;
  noProbability: number;
  yesOdds: number;
  noOdds: number;
  totalPool: number;
}

interface Props {
  marketId: string | null;
  launchName?: string;
  currentProgress?: number; // 0-100 percentage of target raised
  // NEW: Accept embedded market data from launch response
  embeddedMarket?: PredictionMarketInfo;
  onBetPlaced?: (result: BetResult) => void;
  onSelect?: () => void;
  onRefresh?: () => void;
}

export function PredictionMarketCard({
  marketId,
  launchName,
  currentProgress = 0,
  embeddedMarket,
  onBetPlaced,
  onSelect,
  onRefresh
}: Props) {
  const { address } = useAccount();
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [selectedSide, setSelectedSide] = useState<'yes' | 'no'>('yes');
  const [betAmount, setBetAmount] = useState('');
  const [timeLeft, setTimeLeft] = useState('');

  const { placeBet, loading: betting, error: betError, clearError } = usePlaceBet();

  // Use embedded data if available
  const hasEmbeddedData = embeddedMarket?.hasMarket && embeddedMarket?.outcomes && embeddedMarket.outcomes.length > 0;

  // Normalize outcomes from embedded data
  const outcomes = useMemo(() => {
    if (!hasEmbeddedData || !embeddedMarket?.outcomes) return [];
    return embeddedMarket.outcomes.map(o => ({
      outcomeIndex: o.index,
      label: o.label || SELLOUT_LABELS[o.index],
      yesProbability: o.yesProbability,
      noProbability: o.noProbability,
      yesOdds: o.yesOdds,
      noOdds: o.noOdds,
      totalPool: o.totalPool,
    }));
  }, [hasEmbeddedData, embeddedMarket?.outcomes]);

  // Derive stats from embedded data
  const totalPool = embeddedMarket?.totalPool ?? 0;
  const totalBets = embeddedMarket?.totalBets ?? 0;
  const uniqueBettors = embeddedMarket?.uniqueBettors ?? 0;
  const isActive = embeddedMarket?.hasMarket ?? false;
  const isResolved = false; // Embedded data doesn't have resolution status yet
  const resolvedOutcome: number | undefined = undefined;

  // Refresh handler
  const refresh = () => {
    onRefresh?.();
  };

  // No market ID or no embedded data
  if (!marketId || !hasEmbeddedData) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-gray-400">Prediction Market</h3>
        <p className="text-gray-500 mt-2">No prediction market for this launch</p>
      </div>
    );
  }

  // No outcomes data
  if (outcomes.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-gray-400">Prediction Market</h3>
        <p className="text-gray-500 mt-2">Market data loading...</p>
      </div>
    );
  }

  // Determine which outcome is "current" based on progress
  const getCurrentOutcome = (progress: number): number => {
    if (progress >= 100) return 4;
    if (progress >= 75) return 3;
    if (progress >= 50) return 2;
    if (progress >= 25) return 1;
    return 0;
  };

  const currentOutcome = getCurrentOutcome(currentProgress);

  // Handle bet placement
  const handlePlaceBet = async () => {
    if (selectedOutcome === null || !betAmount || !marketId) return;

    clearError();
    const result = await placeBet({
      marketId,
      outcomeIndex: selectedOutcome,
      side: selectedSide,
      amountUsdc: parseFloat(betAmount),
    });

    if (result) {
      onBetPlaced?.(result);
      refresh();
      setBetAmount('');
      setSelectedOutcome(null);
    }
  };

  // Get the selected outcome data
  const selectedOutcomeData = outcomes.find(o => o.outcomeIndex === selectedOutcome);

  // Calculate potential payout
  const potentialPayout = selectedOutcomeData && betAmount
    ? parseFloat(betAmount) * (selectedSide === 'yes'
        ? selectedOutcomeData.yesOdds
        : selectedOutcomeData.noOdds)
    : 0;

  const title = launchName ? `Will ${launchName} Sell Out?` : 'Prediction Market';

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      {/* Header */}
      <div
        className={`flex justify-between items-center mb-4 ${onSelect ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={onSelect}
      >
        <h3 className="text-lg font-semibold text-white">
          {title}
          {onSelect && <span className="text-xs text-gray-500 ml-2">→ Expand</span>}
        </h3>
        <div className={`px-3 py-1 rounded-full text-sm ${
          isResolved ? 'bg-purple-500/20 text-purple-400' :
          isActive ? 'bg-green-500/20 text-green-400' :
          'bg-red-500/20 text-red-400'
        }`}>
          {isResolved ? 'Resolved' : isActive ? 'Active' : 'Closed'}
        </div>
      </div>

      {/* Current Progress Indicator */}
      {currentProgress > 0 && (
        <div className="mb-4 p-3 bg-gray-900 rounded-lg">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">Current Progress</span>
            <span className="text-white font-medium">{currentProgress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, currentProgress)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="flex justify-between mb-4">
        <div className="text-center flex-1">
          <span className="text-gray-400 text-sm">Total Pool</span>
          <p className="text-2xl font-bold text-white">${totalPool.toFixed(2)}</p>
        </div>
        <div className="text-center flex-1">
          <span className="text-gray-400 text-sm">Total Bets</span>
          <p className="text-2xl font-bold text-cyan-400">{totalBets}</p>
        </div>
      </div>

      {/* Outcomes Grid */}
      <div className="space-y-3 mb-4">
        {outcomes.map((outcome) => {
          const isCurrentOutcome = outcome.outcomeIndex === currentOutcome;
          const isWinner = isResolved && outcome.outcomeIndex === resolvedOutcome;
          const isSelected = selectedOutcome === outcome.outcomeIndex;

          return (
            <div
              key={outcome.outcomeIndex}
              className={`rounded-lg border transition-all ${
                isWinner
                  ? 'border-green-500 bg-green-500/10'
                  : isSelected
                  ? 'border-blue-500 bg-blue-500/10'
                  : isCurrentOutcome
                  ? 'border-yellow-500/50 bg-yellow-500/5'
                  : 'border-gray-600 bg-gray-700/30'
              }`}
            >
              {/* Outcome Header */}
              <div className="p-3">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${
                      isWinner ? 'text-green-400' :
                      isCurrentOutcome ? 'text-yellow-400' :
                      'text-white'
                    }`}>
                      {outcome.label || SELLOUT_LABELS[outcome.outcomeIndex]}
                    </span>
                    {isCurrentOutcome && !isResolved && (
                      <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                        Current
                      </span>
                    )}
                    {isWinner && (
                      <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                        Winner!
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-400">
                    ${outcome.totalPool.toFixed(2)} pool
                  </span>
                </div>

                {/* YES/NO Buttons */}
                {isActive && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedOutcome(outcome.outcomeIndex);
                        setSelectedSide('yes');
                      }}
                      className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                        isSelected && selectedSide === 'yes'
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'bg-green-500/10 border-green-500/50 text-green-400 hover:bg-green-500/20'
                      }`}
                    >
                      <div className="text-center">
                        <div className="font-bold">YES</div>
                        <div className="text-xs opacity-80">
                          {outcome.yesProbability.toFixed(0)}% • {outcome.yesOdds.toFixed(2)}x
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedOutcome(outcome.outcomeIndex);
                        setSelectedSide('no');
                      }}
                      className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                        isSelected && selectedSide === 'no'
                          ? 'bg-red-500 border-red-500 text-white'
                          : 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20'
                      }`}
                    >
                      <div className="text-center">
                        <div className="font-bold">NO</div>
                        <div className="text-xs opacity-80">
                          {outcome.noProbability.toFixed(0)}% • {outcome.noOdds.toFixed(2)}x
                        </div>
                      </div>
                    </button>
                  </div>
                )}

                {/* Resolved state - show winner badge */}
                {isResolved && (
                  <div className="flex gap-2 mt-2">
                    <div className={`flex-1 py-2 px-3 rounded-lg text-center ${
                      isWinner ? 'bg-green-500/30 text-green-400' : 'bg-gray-700/50 text-gray-500'
                    }`}>
                      YES: {outcome.yesProbability.toFixed(0)}%
                    </div>
                    <div className={`flex-1 py-2 px-3 rounded-lg text-center ${
                      !isWinner ? 'bg-red-500/30 text-red-400' : 'bg-gray-700/50 text-gray-500'
                    }`}>
                      NO: {outcome.noProbability.toFixed(0)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bet Form (only when active and outcome selected) */}
      {isActive && selectedOutcome !== null && (
        <div className="mb-4 p-4 bg-gray-900 rounded-lg border border-blue-500/50">
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              selectedSide === 'yes' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
            }`}>
              {selectedSide.toUpperCase()}
            </span>
            <span className="text-white font-medium">
              {SELLOUT_LABELS[selectedOutcome]}
            </span>
          </div>

          <div className="flex gap-2 mb-3">
            <input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              placeholder="Amount (USDC)"
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white"
              min="1"
              step="1"
            />
            <button
              onClick={handlePlaceBet}
              disabled={betting || !betAmount || parseFloat(betAmount) < 1}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                betting || !betAmount
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : selectedSide === 'yes'
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              {betting ? 'Betting...' : 'Place Bet'}
            </button>
          </div>

          {/* Quick amounts */}
          <div className="flex gap-2 mb-3">
            {[5, 10, 25, 50].map((val) => (
              <button
                key={val}
                onClick={() => setBetAmount(val.toString())}
                className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${
                  betAmount === val.toString()
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                ${val}
              </button>
            ))}
          </div>

          {/* Potential payout */}
          {potentialPayout > 0 && (
            <div className="text-sm text-gray-400">
              Potential payout: <span className="text-white font-medium">${potentialPayout.toFixed(2)}</span>
            </div>
          )}

          {betError && (
            <div className="mt-2 p-2 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-sm">
              {betError}
            </div>
          )}
        </div>
      )}

      {/* Not connected warning */}
      {!address && isActive && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm text-center">
          Connect wallet to place bets
        </div>
      )}

      {/* Market stats footer */}
      <div className="flex justify-between text-sm text-gray-500 pt-3 border-t border-gray-700">
        <span>{totalBets} bets</span>
        <span>{uniqueBettors} bettors</span>
      </div>
    </div>
  );
}
