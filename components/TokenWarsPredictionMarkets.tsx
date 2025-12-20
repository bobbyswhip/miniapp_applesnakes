"use client";

import React, { useState, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import {
  useTokenWarsPredictionMarkets,
  MarketSummary,
  MarketOutcome,
  UserPosition,
  UserMarketPosition,
} from "@/hooks/useTokenWarsPredictionMarkets";
import {
  placePredictionBet,
  claimPredictionWinnings,
  formatTimeRemaining,
  formatOdds,
  formatProbability,
  formatUSDC,
  calculateBetPreview,
  calculateFee,
  MIN_BET_USDC,
  WalletClient,
  type BetPreview,
} from "@/lib/prediction-market-utils";

// =============================================================================
// TYPES
// =============================================================================

interface TokenWarsPredictionMarketsProps {
  warId: string;
  warName?: string;
  warSymbol?: string;
}

// =============================================================================
// MAIN COMPONENT - Compact layout for tab integration
// =============================================================================

// Sell modal data type
interface SellModalData {
  marketId: string;
  outcomeIndex: number;
  outcomeLabel: string;
  side: "yes" | "no";
  shares: number;
  currentValue: number;
}

export function TokenWarsPredictionMarkets({
  warId,
  warName,
  warSymbol,
}: TokenWarsPredictionMarketsProps) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const {
    markets,
    dexVoteMarket,
    pairVoteMarket,
    selloutMarket,
    userPositions,
    claimableWinnings,
    isLoading,
    error,
    refresh,
  } = useTokenWarsPredictionMarkets({
    warId,
    userAddress: address,
    autoRefresh: true,
  });

  // Track which market card is expanded for betting
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);

  // Sell modal state
  const [sellModalData, setSellModalData] = useState<SellModalData | null>(null);

  // Handler to open sell modal
  const handleOpenSellModal = useCallback((data: SellModalData) => {
    setSellModalData(data);
  }, []);

  if (isLoading && markets.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-800/30 rounded-lg">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-gray-400 text-xs">Loading markets...</p>
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
            onClick={refresh}
            className="px-3 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-800/30 rounded-lg">
        <p className="text-gray-400 text-xs">No prediction markets for this war.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-800/30 rounded-lg">
      {/* Compact Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 text-sm font-bold">🎲 Predictions</span>
          <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 text-[10px] rounded">
            {markets.length} markets
          </span>
        </div>
        <button
          onClick={refresh}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
          title="Refresh"
        >
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Claimable Banner - Compact */}
      {claimableWinnings.length > 0 && (
        <div className="flex-shrink-0 mx-2 mt-2 p-2 bg-green-900/30 border border-green-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-green-400 text-xs font-bold">
              🎉 ${claimableWinnings.reduce((s, c) => s + c.potentialPayout, 0).toFixed(2)} to claim!
            </span>
            <button
              onClick={() => {/* TODO: claim all */}}
              className="px-2 py-1 bg-green-600 text-white text-[10px] font-bold rounded hover:bg-green-500"
            >
              Claim All
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Markets Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Map through ALL markets instead of conditional rendering */}
        {markets.map((market) => (
          <CompactMarketCard
            key={market.market.id}
            market={market}
            warId={warId}
            userAddress={address}
            walletClient={walletClient as WalletClient | undefined}
            onBetPlaced={refresh}
            isExpanded={expandedMarketId === market.market.id}
            onToggle={() => setExpandedMarketId(
              expandedMarketId === market.market.id ? null : market.market.id
            )}
            userPosition={userPositions.find(p => p.marketId === market.market.id)}
            onSell={handleOpenSellModal}
          />
        ))}

        {/* User Positions Summary - Enhanced with currentValue, P&L */}
        {userPositions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <h4 className="text-xs font-bold text-white mb-2">📈 Your Positions</h4>
            <div className="space-y-2">
              {userPositions.map((pos) => (
                <PositionCard
                  key={pos.marketId}
                  position={pos}
                  warId={warId}
                  onSell={handleOpenSellModal}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sell Modal */}
      {sellModalData && (
        <SellModal
          isOpen={true}
          onClose={() => setSellModalData(null)}
          position={sellModalData}
          warId={warId}
          onSuccess={() => {
            setSellModalData(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// COMPACT MARKET CARD
// =============================================================================

interface CompactMarketCardProps {
  market: MarketSummary;
  warId: string;
  userAddress?: string;
  walletClient?: WalletClient;
  onBetPlaced: () => void;
  isExpanded: boolean;
  onToggle: () => void;
  userPosition?: UserMarketPosition;
  onSell: (data: SellModalData) => void;
}

function CompactMarketCard({
  market,
  warId,
  userAddress,
  walletClient,
  onBetPlaced,
  isExpanded,
  onToggle,
  userPosition,
  onSell
}: CompactMarketCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [selectedSide, setSelectedSide] = useState<"yes" | "no">("yes");
  const [betAmount, setBetAmount] = useState<number>(5);
  const [isPlacingBet, setIsPlacingBet] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);

  const isActive = market.stats.isActive;
  const selectedOutcomeData = market.outcomes.find(o => o.outcomeIndex === selectedOutcome);

  // Calculate bet preview using AMM math
  const betPreview: BetPreview | null = selectedOutcomeData ? calculateBetPreview(
    betAmount,
    {
      yesPool: selectedOutcomeData.yesPool,
      noPool: selectedOutcomeData.noPool,
      yesShares: selectedOutcomeData.yesShares,
      noShares: selectedOutcomeData.noShares,
      totalPool: selectedOutcomeData.totalPool,
    },
    selectedSide,
    {
      marketStyle: market.market.marketStyle as "binary" | "winner_takes_all",
      totalPool: market.stats.totalPool,
    }
  ) : null;

  const potentialWin = betPreview?.potentialPayout || 0;

  const handlePlaceBet = async () => {
    if (!userAddress || !walletClient || selectedOutcome === null) return;

    // Ensure integer amount (no decimals)
    if (!Number.isInteger(betAmount)) {
      setBetError('Decimals not allowed. Use whole numbers only.');
      return;
    }

    setIsPlacingBet(true);
    setBetError(null);

    const result = await placePredictionBet({
      marketId: market.market.id,
      outcomeIndex: selectedOutcome,
      side: selectedSide,
      amountUSDC: betAmount,
      walletClient,
      userAddress,
      warId,
    });

    setIsPlacingBet(false);

    if (result.success) {
      setSelectedOutcome(null);
      setBetAmount(5);
      onBetPlaced();
    } else {
      setBetError(result.error || "Failed to place bet");
    }
  };

  const getMarketIcon = () => {
    switch (market.market.marketType) {
      case "dex_vote": return "🏦";
      case "pair_vote": return "💱";
      case "token_war_sellout": return "🎯";
      default: return "📊";
    }
  };

  const getMarketLabel = () => {
    switch (market.market.marketType) {
      case "dex_vote": return "DEX Vote";
      case "pair_vote": return "Pair Vote";
      case "token_war_sellout": return "Sellout";
      default: return "Market";
    }
  };

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-700/50 overflow-hidden">
      {/* Compact Header - Always Visible */}
      <button
        onClick={onToggle}
        className="w-full p-2 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{getMarketIcon()}</span>
          <div className="text-left">
            <div className="text-xs font-bold text-white">{getMarketLabel()}</div>
            <div className="text-[10px] text-gray-400 truncate max-w-[150px]">{market.market.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-xs font-bold text-cyan-400">{formatUSDC(market.stats.totalPool)}</div>
            <div className="text-[10px] text-gray-400">{formatTimeRemaining(market.stats.timeRemaining)}</div>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-2 pb-2 border-t border-gray-700/50">
          {/* Outcomes - With Visual Slider */}
          <div className="mt-2 space-y-2">
            {market.outcomes.map((outcome) => (
              <button
                key={outcome.outcomeIndex}
                onClick={() => {
                  setSelectedOutcome(outcome.outcomeIndex);
                  setBetError(null);
                }}
                disabled={!isActive}
                className={`w-full p-2 rounded-lg text-left transition-all ${
                  selectedOutcome === outcome.outcomeIndex
                    ? 'bg-cyan-500/20 border border-cyan-500'
                    : 'bg-gray-800/50 border border-transparent hover:bg-gray-700/50'
                } ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {/* Outcome Label + Odds */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-white truncate">{outcome.label}</span>
                  <div className="flex gap-2 text-[10px]">
                    <span className="text-green-400">{formatOdds(outcome.yesOdds)}</span>
                    <span className="text-gray-500">|</span>
                    <span className="text-red-400">{formatOdds(outcome.noOdds)}</span>
                  </div>
                </div>

                {/* YES/NO Labels */}
                <div className="flex justify-between text-[9px] mb-0.5">
                  <span className="text-green-400 font-semibold">YES {outcome.yesProbability.toFixed(0)}%</span>
                  <span className="text-red-400 font-semibold">NO {outcome.noProbability.toFixed(0)}%</span>
                </div>

                {/* YES/NO Probability Slider */}
                <div className="relative w-full h-4 rounded-full overflow-hidden bg-gray-700 flex mb-1">
                  {/* YES Side (green) */}
                  <div
                    className="h-full bg-gradient-to-r from-green-600 to-green-500 transition-all duration-500"
                    style={{ width: `${outcome.yesProbability}%` }}
                  />
                  {/* NO Side (red) */}
                  <div
                    className="h-full bg-gradient-to-l from-red-600 to-red-500 transition-all duration-500"
                    style={{ width: `${outcome.noProbability}%` }}
                  />
                </div>

                {/* Pool Info */}
                <div className="text-[9px] text-gray-500 flex justify-between">
                  <span>Pool: {formatUSDC(outcome.totalPool)}</span>
                  <span>YES: {formatUSDC(outcome.yesPool)} • NO: {formatUSDC(outcome.noPool)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Betting Panel - Inline Compact */}
          {isActive && selectedOutcome !== null && userAddress && (
            <div className="mt-2 p-2 bg-gray-800/50 rounded-lg">
              {/* Side Selection - Compact */}
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setSelectedSide("yes")}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
                    selectedSide === "yes"
                      ? 'bg-green-500/30 text-green-400 border border-green-500'
                      : 'bg-gray-700/50 text-gray-400 border border-transparent'
                  }`}
                >
                  YES {formatOdds(selectedOutcomeData?.yesOdds || 0)}
                </button>
                <button
                  onClick={() => setSelectedSide("no")}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
                    selectedSide === "no"
                      ? 'bg-red-500/30 text-red-400 border border-red-500'
                      : 'bg-gray-700/50 text-gray-400 border border-transparent'
                  }`}
                >
                  NO {formatOdds(selectedOutcomeData?.noOdds || 0)}
                </button>
              </div>

              {/* Amount + Bet Button - Single Row */}
              <div className="flex gap-2 items-center">
                <div className="flex items-center gap-1 bg-gray-900 rounded px-1">
                  <button
                    onClick={() => setBetAmount(Math.max(1, betAmount - 5))}
                    className="w-6 h-6 text-gray-400 hover:text-white"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={MIN_BET_USDC}
                    step="1"
                    value={betAmount}
                    onChange={(e) => {
                      // Only allow integers
                      const val = e.target.value;
                      if (val === '' || /^\d+$/.test(val)) {
                        setBetAmount(Number(val) || 0);
                      }
                    }}
                    onKeyDown={(e) => {
                      // Block decimal point input
                      if (e.key === '.' || e.key === ',') {
                        e.preventDefault();
                      }
                    }}
                    className="w-12 bg-transparent text-center text-xs text-white outline-none"
                  />
                  <button
                    onClick={() => setBetAmount(betAmount + 5)}
                    className="w-6 h-6 text-gray-400 hover:text-white"
                  >
                    +
                  </button>
                </div>
                <div className="flex-1 text-center">
                  <span className="text-[10px] text-gray-400">Win: </span>
                  <span className="text-xs font-bold text-green-400">{formatUSDC(potentialWin)}</span>
                  {betPreview && betPreview.multiplier > 0 && (
                    <span className="text-[9px] text-gray-500 ml-1">({betPreview.multiplier.toFixed(2)}x)</span>
                  )}
                </div>
                <button
                  onClick={handlePlaceBet}
                  disabled={isPlacingBet || betAmount < MIN_BET_USDC}
                  className={`px-3 py-1.5 rounded font-bold text-[10px] transition-all ${
                    isPlacingBet
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : selectedSide === 'yes'
                        ? 'bg-green-600 text-white hover:bg-green-500'
                        : 'bg-red-600 text-white hover:bg-red-500'
                  }`}
                >
                  {isPlacingBet ? '...' : `$${betAmount}`}
                </button>
              </div>

              {betError && (
                <div className="mt-1 text-[10px] text-red-400 text-center">{betError}</div>
              )}
            </div>
          )}

          {/* Fee note - 1% on buy, 1% on sell */}
          {isActive && selectedOutcome !== null && userAddress && betPreview && (
            <div className="text-[9px] text-gray-500 text-center mt-1">
              <span>Fee: {formatUSDC(betPreview.fee)} (1%)</span>
              <span className="mx-1">•</span>
              <span>Shares: {betPreview.expectedShares.toFixed(2)}</span>
            </div>
          )}

          {/* Show user position for this market */}
          {userPosition && userPosition.positions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-cyan-700/30 bg-cyan-900/10 rounded-lg p-2">
              <div className="text-[10px] text-cyan-400 font-bold mb-1.5">📊 Your Position</div>
              {userPosition.positions.map((pos) => (
                <div key={`${pos.outcomeIndex}-${pos.side}`} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg mb-1 border border-cyan-700/20">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs text-white font-medium">{pos.outcomeLabel}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pos.side === 'yes' ? 'bg-green-500/30 text-green-400' : 'bg-red-500/30 text-red-400'}`}>
                        {pos.side.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-[11px] text-cyan-300 font-bold">
                      {pos.shares.toFixed(4)} shares
                    </div>
                    <div className="text-[9px] text-gray-500">
                      Cost: {formatUSDC(pos.totalCost)}
                    </div>
                  </div>
                  <div className="text-right mr-2">
                    <div className="text-xs text-white font-bold">{formatUSDC(pos.currentValue)}</div>
                    <div className={`text-[10px] font-semibold ${pos.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pos.profitLoss >= 0 ? '+' : ''}{formatUSDC(pos.profitLoss)}
                    </div>
                  </div>
                  {isActive && pos.shares > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSell({
                          marketId: market.market.id,
                          outcomeIndex: pos.outcomeIndex,
                          outcomeLabel: pos.outcomeLabel,
                          side: pos.side,
                          shares: pos.shares,
                          currentValue: pos.currentValue,
                        });
                      }}
                      className="px-3 py-1.5 text-[10px] font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors"
                    >
                      Sell
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!userAddress && isActive && (
            <div className="mt-2 text-center text-[10px] text-gray-500 py-2">
              Connect wallet to place bets
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// POSITION CARD - Enhanced with currentValue, potentialPayout, P&L
// =============================================================================

interface PositionCardProps {
  position: UserMarketPosition;
  warId: string;
  onSell: (data: SellModalData) => void;
}

function PositionCard({ position, warId, onSell }: PositionCardProps) {
  const isActive = position.market.isActive;

  return (
    <div className="p-2 bg-gray-900/50 rounded-lg border border-cyan-700/20">
      <div className="text-[10px] text-cyan-400 font-medium truncate mb-2">{position.market.title}</div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-1 mb-2 text-center bg-gray-800/30 rounded-lg p-1.5">
        <div>
          <div className="text-[9px] text-gray-500">Invested</div>
          <div className="text-[10px] text-white font-medium">{formatUSDC(position.totalInvested)}</div>
        </div>
        <div>
          <div className="text-[9px] text-gray-500">Value</div>
          <div className="text-[10px] text-cyan-400 font-bold">{formatUSDC(position.totalCurrentValue)}</div>
        </div>
        <div>
          <div className="text-[9px] text-gray-500">If Wins</div>
          <div className="text-[10px] text-blue-400 font-medium">{formatUSDC(position.totalPotentialPayout)}</div>
        </div>
        <div>
          <div className="text-[9px] text-gray-500">P&L</div>
          <div className={`text-[10px] font-bold ${position.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {position.profitLoss >= 0 ? '+' : ''}{formatUSDC(position.profitLoss)}
          </div>
        </div>
      </div>

      {/* Individual positions */}
      <div className="space-y-1.5">
        {position.positions.map((pos) => (
          <div key={`${pos.outcomeIndex}-${pos.side}`} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg border border-gray-700/30">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs text-white font-medium">{pos.outcomeLabel}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pos.side === 'yes' ? 'bg-green-500/30 text-green-400' : 'bg-red-500/30 text-red-400'}`}>
                  {pos.side.toUpperCase()}
                </span>
                {pos.isWinner && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/30 text-yellow-400 font-bold">🏆 WINNER</span>
                )}
              </div>
              <div className="text-[11px] text-cyan-300 font-bold">
                {pos.shares.toFixed(4)} shares
              </div>
              <div className="text-[9px] text-gray-500">
                Cost: {formatUSDC(pos.totalCost)}
              </div>
            </div>
            <div className="text-right mr-2">
              <div className="text-xs text-white font-bold">{formatUSDC(pos.currentValue)}</div>
              <div className={`text-[10px] font-semibold ${pos.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {pos.profitLoss >= 0 ? '+' : ''}{pos.profitLossPercent.toFixed(1)}%
              </div>
            </div>
            {isActive && pos.shares > 0 && (
              <button
                onClick={() => onSell({
                  marketId: position.marketId,
                  outcomeIndex: pos.outcomeIndex,
                  outcomeLabel: pos.outcomeLabel,
                  side: pos.side,
                  shares: pos.shares,
                  currentValue: pos.currentValue,
                })}
                className="px-3 py-1.5 text-[10px] font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors"
              >
                Sell
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// SELL MODAL
// =============================================================================

interface SellModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: SellModalData;
  warId: string;
  onSuccess: () => void;
}

function SellModal({ isOpen, onClose, position, warId, onSuccess }: SellModalProps) {
  const { address } = useAccount();
  const [sharesToSell, setSharesToSell] = useState(position.shares);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Estimate proceeds (proportional to current value)
  const estimatedProceeds = (sharesToSell / position.shares) * position.currentValue;

  const handleSell = async () => {
    if (!address) {
      setError("Wallet not connected");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/prediction-market/sell/verified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: position.marketId,
          outcomeIndex: position.outcomeIndex,
          side: position.side,
          shares: sharesToSell,
          walletAddress: address,
          warId,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Sell failed");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-4 max-w-sm w-full border border-gray-700">
        <h2 className="text-lg font-bold text-white mb-3">Sell Position</h2>

        {/* Position Info */}
        <div className="mb-3 p-2 bg-gray-900/50 rounded">
          <div className="font-medium text-white text-sm">{position.outcomeLabel}</div>
          <div className="text-xs text-gray-400">
            {position.side.toUpperCase()} - {position.shares.toFixed(2)} shares
          </div>
          <div className="text-xs text-gray-400">
            Current Value: <span className="font-bold text-cyan-400">{formatUSDC(position.currentValue)}</span>
          </div>
        </div>

        {/* Shares Input */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Shares to Sell</label>
          <input
            type="number"
            value={sharesToSell}
            onChange={(e) => setSharesToSell(Math.min(parseFloat(e.target.value) || 0, position.shares))}
            min={0.01}
            max={position.shares}
            step={0.01}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <button onClick={() => setSharesToSell(position.shares * 0.25)} className="hover:text-cyan-400">25%</button>
            <button onClick={() => setSharesToSell(position.shares * 0.5)} className="hover:text-cyan-400">50%</button>
            <button onClick={() => setSharesToSell(position.shares * 0.75)} className="hover:text-cyan-400">75%</button>
            <button onClick={() => setSharesToSell(position.shares)} className="hover:text-cyan-400">Max</button>
          </div>
        </div>

        {/* Estimated Proceeds */}
        <div className="mb-3 p-2 bg-green-900/30 rounded border border-green-700/30">
          <div className="text-xs text-gray-400">Estimated Proceeds</div>
          <div className="text-xl font-bold text-green-400">{formatUSDC(estimatedProceeds)}</div>
          <div className="text-[10px] text-gray-500">Actual amount may vary based on market conditions</div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 p-2 bg-red-900/30 text-red-400 rounded text-xs">{error}</div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 border border-gray-600 rounded text-gray-300 hover:bg-gray-700 text-sm"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleSell}
            disabled={isLoading || sharesToSell <= 0}
            className="flex-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50 text-sm font-medium"
          >
            {isLoading ? "Selling..." : `Sell for ~${formatUSDC(estimatedProceeds)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TokenWarsPredictionMarkets;
