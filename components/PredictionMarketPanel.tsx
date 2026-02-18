// components/PredictionMarketPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { usePredictionMarket } from '@/hooks/usePredictionMarket';
import { usePlaceBet } from '@/hooks/usePlaceBet';
import { useClaim, useClaimable } from '@/hooks/useUserPositions';
import { SELLOUT_LABELS } from '@/types/clankerdome';
import { formatTimeRemaining, formatUSDC, formatOdds } from '@/lib/prediction-market-utils';

interface PredictionMarketPanelProps {
  marketId: string;
  warId?: string;
  onClose?: () => void;
}

export function PredictionMarketPanel({ marketId, warId, onClose }: PredictionMarketPanelProps) {
  const { address, isConnected } = useAccount();
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [selectedSide, setSelectedSide] = useState<'yes' | 'no'>('yes');
  const [amount, setAmount] = useState('');
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [timeLeftDisplay, setTimeLeftDisplay] = useState('');

  const {
    market,
    outcomes,
    marketLoading,
    marketError,
    positions,
    canBet,
    getTimeRemaining,
    refreshAll,
    handleBet,
    betLoading,
    betError,
    clearErrors,
  } = usePredictionMarket(marketId, { warId, autoRefresh: true });

  const { claim, loading: claiming, error: claimError } = useClaim();
  const { claims: claimablePositions, refresh: refreshClaimable } = useClaimable(address || null);

  // Live countdown
  useEffect(() => {
    const updateTime = () => {
      const remaining = getTimeRemaining();
      setTimeLeftDisplay(formatTimeRemaining(remaining));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [getTimeRemaining]);

  const handlePlaceBet = async () => {
    if (selectedOutcome === null || !amount || !marketId) return;

    setTxStatus('pending');
    clearErrors();

    const result = await handleBet(selectedOutcome, selectedSide, parseFloat(amount));

    if (result?.success) {
      setTxStatus('success');
      setAmount('');
      setSelectedOutcome(null);
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
      refreshAll();
      refreshClaimable();
      setTimeout(() => setTxStatus('idle'), 3000);
    } else {
      setTxStatus('error');
    }
  };

  // Get selected outcome data
  const selectedOutcomeData = outcomes.find(o => o.index === selectedOutcome);
  const potentialPayout = selectedOutcomeData && amount
    ? parseFloat(amount) * (selectedSide === 'yes'
        ? selectedOutcomeData.yesOdds
        : selectedOutcomeData.noOdds)
    : 0;

  // Check if user has claimable winnings from this market
  const marketClaimable = claimablePositions.filter((c: { marketId: string }) => c.marketId === marketId);
  const hasClaimable = marketClaimable.length > 0;

  // Derived values
  const isActive = market?.isActive && market?.status === 'active';
  const isResolved = market?.status === 'resolved';
  const totalPool = market?.totalPool ?? 0;

  if (marketLoading) {
    return (
      <div className="bg-[#171e1d] rounded-2xl border border-[rgba(255,255,255,0.06)] p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[#1f2827] rounded w-1/3" />
          <div className="h-32 bg-[#1f2827] rounded" />
          <div className="h-12 bg-[#1f2827] rounded" />
        </div>
      </div>
    );
  }

  if (marketError || !market) {
    return (
      <div className="bg-[#171e1d] rounded-2xl border border-red-500/50 p-6">
        <p className="text-red-400">{marketError || 'Failed to load market'}</p>
        {onClose && (
          <button onClick={onClose} className="mt-4 text-[#ffd075] hover:underline">
            ← Back
          </button>
        )}
      </div>
    );
  }

  const title = market.title || 'Prediction Market';

  return (
    <div className="bg-[#171e1d] rounded-2xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#3d2e1a]/50 to-[#3d2e1a]/50 p-6 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex justify-between items-start">
          <div>
            {onClose && (
              <button onClick={onClose} className="text-[#8a9090] hover:text-white mb-2 text-sm">
                ← Back
              </button>
            )}
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            {market.description && (
              <p className="text-[#8a9090] mt-1">{market.description}</p>
            )}
          </div>
          <div className="text-right">
            <div className={`px-3 py-1 rounded-full text-sm mb-2 inline-block ${
              isResolved ? 'bg-[#c5a97b]/20 text-[#ffd075]' :
              isActive ? 'bg-green-500/20 text-green-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              {isResolved ? 'Resolved' : isActive ? 'Active' : 'Closed'}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="text-center">
            <p className="text-[#8a9090] text-sm">Total Pool</p>
            <p className="text-xl font-bold text-green-400">{formatUSDC(totalPool)}</p>
          </div>
          <div className="text-center">
            <p className="text-[#8a9090] text-sm">Time Left</p>
            <p className={`text-xl font-bold font-mono ${
              timeLeftDisplay === 'Ended' ? 'text-red-400' : 'text-[#ffd075]'
            }`}>{timeLeftDisplay}</p>
          </div>
        </div>
      </div>

      {/* Outcomes Grid */}
      <div className="p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Outcomes</h3>
        <div className="space-y-4">
          {outcomes.map((outcome) => {
            const isWinner = isResolved && outcome.index === market.resolvedOutcome;
            const isSelected = selectedOutcome === outcome.index;

            return (
              <div
                key={outcome.index}
                className={`rounded-xl border-2 transition-all overflow-hidden ${
                  isWinner
                    ? 'border-green-500 bg-green-500/10'
                    : isSelected
                    ? 'border-[#c5a97b] bg-[#c5a97b]/10'
                    : 'border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50'
                }`}
              >
                {/* Outcome Header */}
                <div className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-medium ${
                        isWinner ? 'text-green-400' : 'text-white'
                      }`}>
                        {outcome.label || SELLOUT_LABELS[outcome.index] || `Outcome ${outcome.index}`}
                      </span>
                      {isWinner && (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-sm">
                          Winner
                        </span>
                      )}
                    </div>
                    <span className="text-[#8a9090]">
                      {formatUSDC(outcome.totalPool)} pool
                    </span>
                  </div>

                  {/* YES/NO Betting Options */}
                  {canBet && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => {
                          setSelectedOutcome(outcome.index);
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
                            {(outcome.yesProbability * 100).toFixed(1)}% chance
                          </div>
                          <div className="text-lg font-medium mt-1">
                            {formatOdds(outcome.yesOdds)}
                          </div>
                          {outcome.yesPool !== undefined && (
                            <div className="text-xs opacity-60 mt-1">
                              {formatUSDC(outcome.yesPool)} pool
                            </div>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedOutcome(outcome.index);
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
                            {(outcome.noProbability * 100).toFixed(1)}% chance
                          </div>
                          <div className="text-lg font-medium mt-1">
                            {formatOdds(outcome.noOdds)}
                          </div>
                          {outcome.noPool !== undefined && (
                            <div className="text-xs opacity-60 mt-1">
                              {formatUSDC(outcome.noPool)} pool
                            </div>
                          )}
                        </div>
                      </button>
                    </div>
                  )}

                  {/* Resolved State */}
                  {isResolved && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-3 rounded-lg text-center ${
                        isWinner ? 'bg-green-500/30 text-green-400' : 'bg-[#1f2827]/50 text-[#6b7575]'
                      }`}>
                        YES: {(outcome.yesProbability * 100).toFixed(1)}%
                      </div>
                      <div className={`p-3 rounded-lg text-center ${
                        !isWinner ? 'bg-red-500/30 text-red-400' : 'bg-[#1f2827]/50 text-[#6b7575]'
                      }`}>
                        NO: {(outcome.noProbability * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* User Positions */}
      {isConnected && positions.length > 0 && (
        <div className="p-6 border-t border-[rgba(255,255,255,0.06)]">
          <h3 className="text-lg font-semibold text-white mb-4">Your Positions</h3>
          <div className="space-y-2">
            {positions.map((pos, idx) => (
              <div key={idx} className="p-3 bg-[#1a2221] rounded-lg flex justify-between items-center">
                <div>
                  <span className={`px-2 py-0.5 rounded text-sm mr-2 ${
                    pos.side === 'yes' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {pos.side.toUpperCase()}
                  </span>
                  <span className="text-[#cecece]">
                    {outcomes.find(o => o.index === pos.outcomeIndex)?.label || `Outcome ${pos.outcomeIndex}`}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-white font-medium">{pos.shares.toFixed(4)} shares</div>
                  <div className={`text-sm ${pos.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.profitLoss >= 0 ? '+' : ''}{formatUSDC(pos.profitLoss)} ({pos.profitLossPercent.toFixed(1)}%)
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trading Panel */}
      {isConnected && (
        <div className="p-6 border-t border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50">
          {/* Claimable Winnings */}
          {hasClaimable && (
            <div className="mb-4 p-4 bg-green-500/20 border border-green-500/50 rounded-xl">
              <p className="text-green-400 font-medium mb-2">You have winnings to claim!</p>
              <div className="text-white mb-3">
                Total claimable: {formatUSDC(marketClaimable.reduce((sum: number, c: { potentialPayout: number }) => sum + c.potentialPayout, 0))}
              </div>
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="w-full py-3 bg-green-500 hover:bg-green-400 disabled:bg-[#2a3533] text-white font-bold rounded-lg transition-all"
              >
                {claiming ? 'Claiming...' : 'Claim Winnings'}
              </button>
            </div>
          )}

          {/* Bet Form */}
          {canBet && selectedOutcome !== null && (
            <div className="p-4 bg-[#171e1d] rounded-xl border border-[rgba(255,208,117,0.5)]">
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                  selectedSide === 'yes' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                }`}>
                  {selectedSide.toUpperCase()}
                </span>
                <span className="text-white font-medium">
                  {outcomes.find(o => o.index === selectedOutcome)?.label || SELLOUT_LABELS[selectedOutcome] || `Outcome ${selectedOutcome}`}
                </span>
              </div>

              <div className="mb-4">
                <p className="text-[#8a9090] text-sm mb-2">Amount (USDC)</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-[#1f2827] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white text-lg focus:border-[#c5a97b] focus:outline-none"
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
                        ? 'bg-[#a88a5a] text-white'
                        : 'bg-[#1f2827] text-[#cecece] hover:bg-[#2a3533]'
                    }`}
                  >
                    ${val}
                  </button>
                ))}
              </div>

              {/* Potential payout */}
              {potentialPayout > 0 && (
                <div className="mb-4 p-3 bg-[#1a2221] rounded-lg">
                  <div className="flex justify-between">
                    <span className="text-[#8a9090]">Potential Payout</span>
                    <span className="text-white font-bold">{formatUSDC(potentialPayout)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-[#6b7575]">Odds</span>
                    <span className="text-[#8a9090]">
                      {formatOdds(selectedSide === 'yes' ? selectedOutcomeData?.yesOdds ?? 0 : selectedOutcomeData?.noOdds ?? 0)}
                    </span>
                  </div>
                </div>
              )}

              {/* Place Bet Button */}
              <button
                onClick={handlePlaceBet}
                disabled={betLoading || !amount || parseFloat(amount) < 1}
                className={`w-full py-4 font-bold text-lg rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedSide === 'yes'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white'
                    : 'bg-gradient-to-r from-red-500 to-[#c5a97b] hover:from-red-400 hover:to-[#ffd075] text-white'
                }`}
              >
                {betLoading
                  ? 'Placing Bet...'
                  : `Bet ${formatUSDC(parseFloat(amount) || 0)} ${selectedSide.toUpperCase()}`}
              </button>
            </div>
          )}

          {/* Transaction Status */}
          {txStatus === 'success' && (
            <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
              <p className="text-green-400 text-sm">Transaction successful!</p>
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
      {!isConnected && canBet && (
        <div className="p-6 border-t border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50 text-center">
          <p className="text-[#8a9090] mb-4">Connect your wallet to place bets</p>
        </div>
      )}
    </div>
  );
}
