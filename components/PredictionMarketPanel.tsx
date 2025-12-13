// components/PredictionMarketPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { usePredictionMarket } from '@/hooks/usePredictionMarket';
import { usePlaceBet } from '@/hooks/usePlaceBet';
import { useClaim, useClaimable } from '@/hooks/useUserPositions';
import { SELLOUT_LABELS } from '@/types/clankerdome';

interface PredictionMarketPanelProps {
  marketId: string;
  onClose?: () => void;
}

export function PredictionMarketPanel({ marketId, onClose }: PredictionMarketPanelProps) {
  const { address, isConnected } = useAccount();
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [selectedSide, setSelectedSide] = useState<'yes' | 'no'>('yes');
  const [amount, setAmount] = useState('');
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [timeLeft, setTimeLeft] = useState('');

  const {
    market,
    activity,
    loading,
    error,
    refresh,
    isActive,
    isResolved,
    totalPool,
    totalBets,
    uniqueBettors,
    outcomes,
    resolvedOutcome,
    timeRemaining,
  } = usePredictionMarket(marketId, {
    walletAddress: address,
    includeActivity: true,
    autoRefresh: true,
    refreshInterval: 5000,
  });

  const { placeBet, loading: betting, error: betError, clearError } = usePlaceBet();
  const { claim, loading: claiming, error: claimError } = useClaim();
  const { claims: claimablePositions, totalClaimable, refresh: refreshClaimable } = useClaimable(address || null);

  // Live countdown
  useEffect(() => {
    if (!timeRemaining || timeRemaining <= 0) {
      setTimeLeft('Ended');
      return;
    }

    const updateTime = () => {
      const remaining = Math.max(0, timeRemaining * 1000);
      if (remaining <= 0) {
        setTimeLeft('Ended');
        return;
      }

      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

      if (hours > 0) setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      else if (minutes > 0) setTimeLeft(`${minutes}m ${seconds}s`);
      else setTimeLeft(`${seconds}s`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [timeRemaining]);

  const handlePlaceBet = async () => {
    if (selectedOutcome === null || !amount || !marketId) return;

    setTxStatus('pending');
    clearError();

    const result = await placeBet({
      marketId,
      outcomeIndex: selectedOutcome,
      side: selectedSide,
      amountUsdc: parseFloat(amount),
    });

    if (result) {
      setTxStatus('success');
      setAmount('');
      setSelectedOutcome(null);
      refresh();
      setTimeout(() => setTxStatus('idle'), 3000);
    } else {
      setTxStatus('error');
    }
  };

  const handleClaim = async () => {
    if (!address || !marketId) return;

    setTxStatus('pending');
    const result = await claim(marketId, address);

    if (result) {
      setTxStatus('success');
      refresh();
      refreshClaimable();
      setTimeout(() => setTxStatus('idle'), 3000);
    } else {
      setTxStatus('error');
    }
  };

  // Get selected outcome data
  const selectedOutcomeData = outcomes.find(o => o.outcomeIndex === selectedOutcome);
  const potentialPayout = selectedOutcomeData && amount
    ? parseFloat(amount) * (selectedSide === 'yes'
        ? selectedOutcomeData.yesOdds
        : selectedOutcomeData.noOdds)
    : 0;

  // Check if user has claimable winnings from this market
  const marketClaimable = claimablePositions.filter((c: { marketId: string }) => c.marketId === marketId);
  const hasClaimable = marketClaimable.length > 0;

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          <div className="h-32 bg-gray-700 rounded" />
          <div className="h-12 bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-red-500/50 p-6">
        <p className="text-red-400">{error || 'Failed to load market'}</p>
        {onClose && (
          <button onClick={onClose} className="mt-4 text-cyan-400 hover:underline">
            ← Back
          </button>
        )}
      </div>
    );
  }

  const title = market.market.title || 'Prediction Market';

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 p-6 border-b border-gray-700">
        <div className="flex justify-between items-start">
          <div>
            {onClose && (
              <button onClick={onClose} className="text-gray-400 hover:text-white mb-2 text-sm">
                ← Back
              </button>
            )}
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            {market.market.description && (
              <p className="text-gray-400 mt-1">{market.market.description}</p>
            )}
          </div>
          <div className="text-right">
            <div className={`px-3 py-1 rounded-full text-sm mb-2 inline-block ${
              isResolved ? 'bg-purple-500/20 text-purple-400' :
              isActive ? 'bg-green-500/20 text-green-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              {isResolved ? 'Resolved' : isActive ? 'Active' : 'Closed'}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4 mt-4">
          <div className="text-center">
            <p className="text-gray-400 text-sm">Total Pool</p>
            <p className="text-xl font-bold text-green-400">${totalPool.toLocaleString()}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm">Total Bets</p>
            <p className="text-xl font-bold text-white">{totalBets}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm">Bettors</p>
            <p className="text-xl font-bold text-white">{uniqueBettors}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm">Time Left</p>
            <p className={`text-xl font-bold font-mono ${
              timeLeft === 'Ended' ? 'text-red-400' : 'text-cyan-400'
            }`}>{timeLeft}</p>
          </div>
        </div>
      </div>

      {/* Outcomes Grid */}
      <div className="p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Outcomes</h3>
        <div className="space-y-4">
          {outcomes.map((outcome) => {
            const isWinner = isResolved && outcome.outcomeIndex === resolvedOutcome;
            const isSelected = selectedOutcome === outcome.outcomeIndex;

            return (
              <div
                key={outcome.outcomeIndex}
                className={`rounded-xl border-2 transition-all overflow-hidden ${
                  isWinner
                    ? 'border-green-500 bg-green-500/10'
                    : isSelected
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-700 bg-gray-800/50'
                }`}
              >
                {/* Outcome Header */}
                <div className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-medium ${
                        isWinner ? 'text-green-400' : 'text-white'
                      }`}>
                        {outcome.label || SELLOUT_LABELS[outcome.outcomeIndex]}
                      </span>
                      {isWinner && (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-sm">
                          🏆 Winner
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400">
                      ${outcome.totalPool.toFixed(2)} pool
                    </span>
                  </div>

                  {/* YES/NO Betting Options */}
                  {isActive && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => {
                          setSelectedOutcome(outcome.outcomeIndex);
                          setSelectedSide('yes');
                        }}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          isSelected && selectedSide === 'yes'
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'bg-green-500/10 border-green-500/50 text-green-400 hover:bg-green-500/20'
                        }`}
                      >
                        <div className="text-center">
                          <div className="text-2xl font-bold mb-1">YES</div>
                          <div className="text-sm opacity-80">
                            {outcome.yesProbability.toFixed(1)}% chance
                          </div>
                          <div className="text-lg font-medium mt-1">
                            {outcome.yesOdds.toFixed(2)}x odds
                          </div>
                          <div className="text-xs opacity-60 mt-1">
                            ${outcome.yesPool.toFixed(2)} pool
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedOutcome(outcome.outcomeIndex);
                          setSelectedSide('no');
                        }}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          isSelected && selectedSide === 'no'
                            ? 'bg-red-500 border-red-500 text-white'
                            : 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20'
                        }`}
                      >
                        <div className="text-center">
                          <div className="text-2xl font-bold mb-1">NO</div>
                          <div className="text-sm opacity-80">
                            {outcome.noProbability.toFixed(1)}% chance
                          </div>
                          <div className="text-lg font-medium mt-1">
                            {outcome.noOdds.toFixed(2)}x odds
                          </div>
                          <div className="text-xs opacity-60 mt-1">
                            ${outcome.noPool.toFixed(2)} pool
                          </div>
                        </div>
                      </button>
                    </div>
                  )}

                  {/* Resolved State */}
                  {isResolved && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-3 rounded-lg text-center ${
                        isWinner ? 'bg-green-500/30 text-green-400' : 'bg-gray-700/50 text-gray-500'
                      }`}>
                        YES: {outcome.yesProbability.toFixed(1)}%
                      </div>
                      <div className={`p-3 rounded-lg text-center ${
                        !isWinner ? 'bg-red-500/30 text-red-400' : 'bg-gray-700/50 text-gray-500'
                      }`}>
                        NO: {outcome.noProbability.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trading Panel */}
      {isConnected && (
        <div className="p-6 border-t border-gray-700 bg-gray-800/50">
          {/* Claimable Winnings */}
          {hasClaimable && (
            <div className="mb-4 p-4 bg-green-500/20 border border-green-500/50 rounded-xl">
              <p className="text-green-400 font-medium mb-2">🎉 You have winnings to claim!</p>
              <div className="text-white mb-3">
                Total claimable: ${marketClaimable.reduce((sum: number, c: { potentialPayout: number }) => sum + c.potentialPayout, 0).toFixed(2)}
              </div>
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="w-full py-3 bg-green-500 hover:bg-green-400 disabled:bg-gray-600 text-white font-bold rounded-lg transition-all"
              >
                {claiming ? 'Claiming...' : 'Claim Winnings'}
              </button>
            </div>
          )}

          {/* Bet Form */}
          {isActive && selectedOutcome !== null && (
            <div className="p-4 bg-gray-900 rounded-xl border border-blue-500/50">
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

              <div className="mb-4">
                <p className="text-gray-400 text-sm mb-2">Amount (USDC)</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-lg focus:border-blue-500 focus:outline-none"
                    min="1"
                    step="1"
                  />
                </div>
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 mb-4">
                {[5, 10, 25, 50, 100].map((val) => (
                  <button
                    key={val}
                    onClick={() => setAmount(val.toString())}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      amount === val.toString()
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
                <div className="mb-4 p-3 bg-gray-800 rounded-lg">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Potential Payout</span>
                    <span className="text-white font-bold">${potentialPayout.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Odds</span>
                    <span className="text-gray-400">
                      {selectedSide === 'yes' ? selectedOutcomeData?.yesOdds.toFixed(2) : selectedOutcomeData?.noOdds.toFixed(2)}x
                    </span>
                  </div>
                </div>
              )}

              {/* Place Bet Button */}
              <button
                onClick={handlePlaceBet}
                disabled={betting || !amount || parseFloat(amount) < 1}
                className={`w-full py-4 font-bold text-lg rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedSide === 'yes'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white'
                    : 'bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-400 hover:to-pink-400 text-white'
                }`}
              >
                {betting
                  ? 'Placing Bet...'
                  : `Bet $${amount || '0'} ${selectedSide.toUpperCase()}`}
              </button>
            </div>
          )}

          {/* Transaction Status */}
          {txStatus === 'success' && (
            <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
              <p className="text-green-400 text-sm">✓ Transaction successful!</p>
            </div>
          )}
          {(txStatus === 'error' || betError || claimError) && (
            <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <p className="text-red-400 text-sm">{betError || claimError || 'Transaction failed'}</p>
            </div>
          )}
        </div>
      )}

      {/* Connect Wallet Prompt */}
      {!isConnected && isActive && (
        <div className="p-6 border-t border-gray-700 bg-gray-800/50 text-center">
          <p className="text-gray-400 mb-4">Connect your wallet to place bets</p>
        </div>
      )}

      {/* Activity Feed */}
      {activity && activity.recentBets.length > 0 && (
        <div className="p-6 border-t border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>

          {/* Momentum Indicator */}
          {activity.momentum && (
            <div className="mb-4 p-3 bg-gray-800 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Market Momentum</span>
                <span className={`font-medium ${
                  activity.momentum.trend === 'bullish' ? 'text-green-400' :
                  activity.momentum.trend === 'bearish' ? 'text-red-400' :
                  'text-gray-400'
                }`}>
                  {activity.momentum.trend === 'bullish' ? '📈' :
                   activity.momentum.trend === 'bearish' ? '📉' : '➡️'}
                  {' '}{activity.momentum.yesPercent.toFixed(0)}% YES / {activity.momentum.noPercent.toFixed(0)}% NO
                </span>
              </div>
            </div>
          )}

          {/* Recent Bets */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {activity.recentBets.slice(0, 10).map((bet) => (
              <div
                key={bet.id}
                className={`p-2 rounded-lg flex justify-between items-center ${
                  bet.side === 'yes' ? 'bg-green-500/10' : 'bg-red-500/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{bet.sideEmoji}</span>
                  <span className="text-gray-300">{bet.wallet}</span>
                </div>
                <div className="text-right">
                  <span className="text-white font-medium">{bet.formattedAmount}</span>
                  <span className="text-gray-500 text-sm ml-2">{bet.timeAgo}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
