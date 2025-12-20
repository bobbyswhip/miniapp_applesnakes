"use client";

// TokenWarsPredictionMarketsV2.tsx
// On-Chain Prediction Markets using wagmi/viem - V2 Implementation

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { parseEther } from "viem";

import {
  useTokenWarsPredictionMarketsV2,
  useBuySharesV2,
  useSellSharesV2,
  useClaimV2,
  useSharesEstimate,
  useSellEstimate,
  useETHQuote,
  useUserPositionV2,
  useTotalMarkets,
  warIdToBytes32,
} from "@/hooks/usePredictionMarketV2";

import {
  MarketInfoV2,
  MarketTypeV2,
  MarketStatusV2,
  UserMarketInfoV2,
  UserPositionV2,
  formatWASS,
  parseWASS,
  formatETH,
  parseETH,
  MARKET_TYPE_ICONS,
  MARKET_TYPE_NAMES,
  getStatusName,
  getStatusColor,
  getOutcomeColor,
} from "@/types/prediction-market-v2";

// =============================================================================
// TYPES
// =============================================================================

interface TokenWarsPredictionMarketsV2Props {
  warId: string;
  warName?: string;
  warSymbol?: string;
}

interface SellModalData {
  marketId: number;
  outcomeIndex: number;
  outcomeLabel: string;
  shares: bigint;
  sharesFormatted: string;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TokenWarsPredictionMarketsV2({
  warId,
  warName,
  warSymbol,
}: TokenWarsPredictionMarketsV2Props) {
  const { address } = useAccount();

  const {
    markets,
    dexVoteMarket,
    pairVoteMarket,
    selloutMarket,
    userPositions,
    isLoading,
    error,
    refresh,
    refetchPositions,
  } = useTokenWarsPredictionMarketsV2({
    warId,
    userAddress: address,
    autoRefresh: true,
  });

  // Get total markets on-chain for debug info (must be before any returns)
  const { totalMarkets } = useTotalMarkets();

  // Track which market card is expanded for betting
  const [expandedMarketId, setExpandedMarketId] = useState<number | null>(null);

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
    const bytes32Id = warIdToBytes32(warId);
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-800/30 rounded-lg p-4">
        <p className="text-gray-400 text-sm mb-2">No prediction markets for this war.</p>
        <div className="text-[10px] text-gray-500 space-y-1 text-center">
          <p>War ID: {warId}</p>
          <p className="font-mono break-all">bytes32: {bytes32Id.slice(0, 20)}...{bytes32Id.slice(-8)}</p>
          <p>Total on-chain markets: {totalMarkets}</p>
          <p className="mt-2 text-gray-600">Markets are created by admin when a war starts</p>
        </div>
        <button
          onClick={refresh}
          className="mt-3 px-3 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600"
        >
          Refresh
        </button>
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
          <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded">
            On-Chain
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

      {/* Scrollable Markets Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {markets.map((market) => (
          <CompactMarketCardV2
            key={market.marketId}
            market={market}
            warId={warId}
            userAddress={address}
            onBetPlaced={refresh}
            isExpanded={expandedMarketId === market.marketId}
            onToggle={() => setExpandedMarketId(
              expandedMarketId === market.marketId ? null : market.marketId
            )}
            onSell={handleOpenSellModal}
          />
        ))}
      </div>

      {/* Sell Modal */}
      {sellModalData && (
        <SellModalV2
          isOpen={true}
          onClose={() => setSellModalData(null)}
          position={sellModalData}
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
// COMPACT MARKET CARD V2
// =============================================================================

interface CompactMarketCardV2Props {
  market: MarketInfoV2;
  warId: string;
  userAddress?: `0x${string}`;
  onBetPlaced: () => void;
  isExpanded: boolean;
  onToggle: () => void;
  onSell: (data: SellModalData) => void;
}

function CompactMarketCardV2({
  market,
  warId,
  userAddress,
  onBetPlaced,
  isExpanded,
  onToggle,
  onSell,
}: CompactMarketCardV2Props) {
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [paymentType, setPaymentType] = useState<"wass" | "eth">("wass");
  const [betAmount, setBetAmount] = useState<string>("10");
  const [betError, setBetError] = useState<string | null>(null);

  // Get user position for this market
  const { position: userPosition, refetch: refetchPosition } = useUserPositionV2(
    market.marketId,
    userAddress,
    market.marketType
  );

  // Buy hooks
  const {
    buyShares,
    buySharesWithETH,
    isApproving,
    isLoading: isBuying,
    isSuccess: buySuccess,
    error: buyError,
    hash: buyHash,
  } = useBuySharesV2();

  // Get shares estimate for wASS bet
  const wassAmount = useMemo(() => {
    if (paymentType !== "wass" || !betAmount) return 0n;
    return parseWASS(betAmount);
  }, [paymentType, betAmount]);

  const { estimate: sharesEstimate } = useSharesEstimate(
    selectedOutcome ? market.marketId : null,
    selectedOutcome || 0,
    wassAmount
  );

  // Get ETH quote
  const ethAmount = useMemo(() => {
    if (paymentType !== "eth" || !betAmount) return 0n;
    return parseETH(betAmount);
  }, [paymentType, betAmount]);

  const { quote: ethQuote } = useETHQuote(ethAmount);

  // Reset after successful buy
  useEffect(() => {
    if (buySuccess) {
      setSelectedOutcome(null);
      setBetAmount("10");
      setBetError(null);
      // Refetch immediately and again after a short delay to ensure data is updated
      refetchPosition();
      onBetPlaced();
      // Additional refetch after delay to handle any indexing lag
      const timer = setTimeout(() => {
        refetchPosition();
        onBetPlaced();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [buySuccess, refetchPosition, onBetPlaced]);

  // Handle bet error
  useEffect(() => {
    if (buyError) {
      setBetError(buyError.message);
    }
  }, [buyError]);

  const handlePlaceBet = async () => {
    if (!userAddress || selectedOutcome === null) return;

    setBetError(null);

    try {
      if (paymentType === "wass") {
        await buyShares(market.marketId, selectedOutcome, wassAmount);
      } else {
        const minWassOut = ethQuote ? (ethQuote.totalWassOut * 95n) / 100n : 0n; // 5% slippage
        await buySharesWithETH(market.marketId, selectedOutcome, ethAmount, minWassOut);
      }
    } catch (err) {
      setBetError(err instanceof Error ? err.message : "Transaction failed");
    }
  };

  const isActive = market.isActive;
  const icon = MARKET_TYPE_ICONS[market.marketType] || "📊";
  const label = market.marketTypeName;

  // Calculate total pool for display
  const totalPool = market.outcomes.reduce((sum, o) => sum + o.totalDeposits, 0n);

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-700/50 overflow-hidden">
      {/* Compact Header - Always Visible */}
      <button
        onClick={onToggle}
        className="w-full p-2 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div className="text-left">
            <div className="text-xs font-bold text-white">{label}</div>
            <div className="flex items-center gap-1">
              <span className={`text-[10px] ${getStatusColor(market.status)}`}>
                {market.statusName}
              </span>
              {market.isResolved && market.winningOutcome > 0 && (
                <span className="text-[10px] text-yellow-400">
                  🏆 Winner: {market.outcomes[market.winningOutcome - 1]?.label}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-xs font-bold text-cyan-400">{formatWASS(totalPool)} wASS</div>
            <div className="text-[10px] text-gray-400">{market.outcomes.length} outcomes</div>
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
          {/* Outcomes - With Visual Probability Bars */}
          <div className="mt-2 space-y-2">
            {market.outcomes.map((outcome) => {
              const isWinner = market.isResolved && market.winningOutcome === outcome.index;
              const colorClass = getOutcomeColor(outcome.index, market.marketType);

              return (
                <button
                  key={outcome.index}
                  onClick={() => {
                    if (isActive) {
                      setSelectedOutcome(outcome.index);
                      setBetError(null);
                    }
                  }}
                  disabled={!isActive}
                  className={`w-full p-2 rounded-lg text-left transition-all ${
                    selectedOutcome === outcome.index
                      ? 'bg-cyan-500/20 border border-cyan-500'
                      : 'bg-gray-800/50 border border-transparent hover:bg-gray-700/50'
                  } ${!isActive ? 'opacity-50 cursor-not-allowed' : ''} ${
                    isWinner ? 'ring-2 ring-yellow-500' : ''
                  }`}
                >
                  {/* Outcome Label + Probability */}
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white">{outcome.label}</span>
                      {isWinner && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/30 text-yellow-400 rounded font-bold">
                          🏆 WINNER
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold text-cyan-400">
                      {outcome.probability.toFixed(1)}%
                    </span>
                  </div>

                  {/* Probability Bar */}
                  <div className="relative w-full h-3 rounded-full overflow-hidden bg-gray-700 mb-1.5">
                    <div
                      className={`h-full ${colorClass} transition-all duration-500`}
                      style={{ width: `${Math.min(outcome.probability, 100)}%` }}
                    />
                  </div>

                  {/* Pool Info */}
                  <div className="text-[9px] text-gray-500 flex justify-between">
                    <span>Pool: {formatWASS(outcome.totalDeposits)} wASS</span>
                    <span>Shares: {formatWASS(outcome.totalShares, 4)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Betting Panel - Inline Compact */}
          {isActive && selectedOutcome !== null && userAddress && (
            <div className="mt-2 p-2 bg-gray-800/50 rounded-lg">
              {/* Payment Type Selection */}
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setPaymentType("wass")}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
                    paymentType === "wass"
                      ? 'bg-purple-500/30 text-purple-400 border border-purple-500'
                      : 'bg-gray-700/50 text-gray-400 border border-transparent'
                  }`}
                >
                  Pay with wASS
                </button>
                <button
                  onClick={() => setPaymentType("eth")}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
                    paymentType === "eth"
                      ? 'bg-blue-500/30 text-blue-400 border border-blue-500'
                      : 'bg-gray-700/50 text-gray-400 border border-transparent'
                  }`}
                >
                  Pay with ETH
                </button>
              </div>

              {/* Amount + Bet Button - Single Row */}
              <div className="flex gap-2 items-center">
                <div className="flex items-center gap-1 bg-gray-900 rounded px-1">
                  <button
                    onClick={() => {
                      const current = parseFloat(betAmount) || 0;
                      setBetAmount(Math.max(1, current - 5).toString());
                    }}
                    className="w-6 h-6 text-gray-400 hover:text-white"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    className="w-16 bg-transparent text-center text-xs text-white outline-none"
                    placeholder={paymentType === "wass" ? "wASS" : "ETH"}
                  />
                  <button
                    onClick={() => {
                      const current = parseFloat(betAmount) || 0;
                      setBetAmount((current + 5).toString());
                    }}
                    className="w-6 h-6 text-gray-400 hover:text-white"
                  >
                    +
                  </button>
                </div>
                <div className="flex-1 text-center">
                  {paymentType === "wass" && sharesEstimate && (
                    <>
                      <span className="text-[10px] text-gray-400">Shares: </span>
                      <span className="text-xs font-bold text-green-400">{sharesEstimate.sharesFormatted}</span>
                    </>
                  )}
                  {paymentType === "eth" && ethQuote && (
                    <>
                      <span className="text-[10px] text-gray-400">Get: </span>
                      <span className="text-xs font-bold text-green-400">{ethQuote.totalWassFormatted} wASS</span>
                    </>
                  )}
                </div>
                <button
                  onClick={handlePlaceBet}
                  disabled={isBuying || !betAmount || parseFloat(betAmount) <= 0}
                  className={`px-3 py-1.5 rounded font-bold text-[10px] transition-all ${
                    isBuying
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-cyan-600 text-white hover:bg-cyan-500'
                  }`}
                >
                  {isApproving ? 'Approving...' : isBuying ? 'Buying...' : `Buy ${betAmount} ${paymentType.toUpperCase()}`}
                </button>
              </div>

              {/* Fee note */}
              {sharesEstimate && paymentType === "wass" && (
                <div className="text-[9px] text-gray-500 text-center mt-1">
                  <span>Fee: {sharesEstimate.feeFormatted} wASS (1%)</span>
                </div>
              )}

              {betError && (
                <div className="mt-1 text-[10px] text-red-400 text-center">{betError}</div>
              )}
            </div>
          )}

          {/* Show user position for this market */}
          {userPosition && userPosition.positions.length > 0 && (
            <UserPositionDisplayV2
              position={userPosition}
              market={market}
              onSell={onSell}
            />
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
// USER POSITION DISPLAY V2
// =============================================================================

interface UserPositionDisplayV2Props {
  position: UserMarketInfoV2;
  market: MarketInfoV2;
  onSell: (data: SellModalData) => void;
}

function UserPositionDisplayV2({ position, market, onSell }: UserPositionDisplayV2Props) {
  const { claimWinnings, claimRefund, isLoading: isClaiming, isSuccess: claimSuccess } = useClaimV2();
  const [claimError, setClaimError] = useState<string | null>(null);

  const handleClaim = async () => {
    setClaimError(null);
    try {
      if (market.isResolved) {
        await claimWinnings(market.marketId);
      } else if (market.isClosed) {
        await claimRefund(market.marketId);
      }
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-cyan-700/30 bg-cyan-900/10 rounded-lg p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-cyan-400 font-bold">📊 Your Position</span>
        {position.claimableAmount > 0n && (
          <button
            onClick={handleClaim}
            disabled={isClaiming}
            className="px-2 py-1 text-[10px] font-bold bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
          >
            {isClaiming ? "..." : `Claim ${position.claimableFormatted} wASS`}
          </button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-1 mb-2 text-center bg-gray-800/30 rounded-lg p-1.5">
        <div>
          <div className="text-[9px] text-gray-500">Invested</div>
          <div className="text-[10px] text-white font-medium">{position.totalInvestedFormatted} wASS</div>
        </div>
        <div>
          <div className="text-[9px] text-gray-500">Claimable</div>
          <div className="text-[10px] text-green-400 font-bold">{position.claimableFormatted} wASS</div>
        </div>
      </div>

      {/* Individual positions */}
      {position.positions.map((pos) => {
        const isWinner = market.isResolved && market.winningOutcome === pos.outcomeIndex;
        const colorClass = getOutcomeColor(pos.outcomeIndex, market.marketType);

        return (
          <div
            key={pos.outcomeIndex}
            className={`flex items-center justify-between p-2 bg-gray-800/50 rounded-lg mb-1 border ${
              isWinner ? 'border-yellow-500/50' : 'border-cyan-700/20'
            }`}
          >
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs text-white font-medium">{pos.outcomeLabel}</span>
                {isWinner && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/30 text-yellow-400 font-bold">
                    🏆 WINNER
                  </span>
                )}
                {pos.claimed && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/30 text-green-400 font-bold">
                    ✓ CLAIMED
                  </span>
                )}
              </div>
              <div className="text-[11px] text-cyan-300 font-bold">
                {pos.sharesFormatted} shares
              </div>
              <div className="text-[9px] text-gray-500">
                Cost: {pos.depositedFormatted} wASS
              </div>
            </div>
            <div className="text-right mr-2">
              <div className="text-xs text-white font-bold">{pos.potentialPayoutFormatted} wASS</div>
              <div className={`text-[10px] font-semibold ${pos.profitLoss >= 0n ? 'text-green-400' : 'text-red-400'}`}>
                {pos.profitLoss >= 0n ? '+' : ''}{pos.profitLossPercent.toFixed(1)}%
              </div>
            </div>
            {market.isActive && pos.shares > 0n && !pos.claimed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSell({
                    marketId: market.marketId,
                    outcomeIndex: pos.outcomeIndex,
                    outcomeLabel: pos.outcomeLabel,
                    shares: pos.shares,
                    sharesFormatted: pos.sharesFormatted,
                  });
                }}
                className="px-3 py-1.5 text-[10px] font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors"
              >
                Sell
              </button>
            )}
          </div>
        );
      })}

      {claimError && (
        <div className="mt-1 text-[10px] text-red-400 text-center">{claimError}</div>
      )}
    </div>
  );
}

// =============================================================================
// SELL MODAL V2
// =============================================================================

interface SellModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  position: SellModalData;
  onSuccess: () => void;
}

function SellModalV2({ isOpen, onClose, position, onSuccess }: SellModalV2Props) {
  const [sharesToSell, setSharesToSell] = useState<string>(formatWASS(position.shares, 4));
  const [error, setError] = useState<string | null>(null);

  const { sellShares, isLoading, isSuccess, error: sellError } = useSellSharesV2();

  // Get sell estimate
  const sharesToSellBigInt = useMemo(() => {
    const parsed = parseFloat(sharesToSell) || 0;
    return BigInt(Math.floor(parsed * 1e18));
  }, [sharesToSell]);

  const { estimate } = useSellEstimate(
    position.marketId,
    position.outcomeIndex,
    sharesToSellBigInt
  );

  // Handle success
  useEffect(() => {
    if (isSuccess) {
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  // Handle error
  useEffect(() => {
    if (sellError) {
      setError(sellError.message);
    }
  }, [sellError]);

  if (!isOpen) return null;

  const handleSell = async () => {
    setError(null);
    try {
      await sellShares(position.marketId, position.outcomeIndex, sharesToSellBigInt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sell failed");
    }
  };

  const maxShares = parseFloat(position.sharesFormatted) || 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-4 max-w-sm w-full border border-gray-700">
        <h2 className="text-lg font-bold text-white mb-3">Sell Position</h2>

        {/* Position Info */}
        <div className="mb-3 p-2 bg-gray-900/50 rounded">
          <div className="font-medium text-white text-sm">{position.outcomeLabel}</div>
          <div className="text-xs text-gray-400">
            {position.sharesFormatted} shares available
          </div>
        </div>

        {/* Shares Input */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Shares to Sell</label>
          <input
            type="number"
            value={sharesToSell}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0;
              setSharesToSell(Math.min(val, maxShares).toString());
            }}
            min={0.0001}
            max={maxShares}
            step={0.01}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <button onClick={() => setSharesToSell((maxShares * 0.25).toFixed(4))} className="hover:text-cyan-400">25%</button>
            <button onClick={() => setSharesToSell((maxShares * 0.5).toFixed(4))} className="hover:text-cyan-400">50%</button>
            <button onClick={() => setSharesToSell((maxShares * 0.75).toFixed(4))} className="hover:text-cyan-400">75%</button>
            <button onClick={() => setSharesToSell(maxShares.toFixed(4))} className="hover:text-cyan-400">Max</button>
          </div>
        </div>

        {/* Estimated Proceeds */}
        <div className="mb-3 p-2 bg-green-900/30 rounded border border-green-700/30">
          <div className="text-xs text-gray-400">Estimated Proceeds</div>
          <div className="text-xl font-bold text-green-400">
            {estimate ? estimate.wassFormatted : "..."} wASS
          </div>
          {estimate && (
            <div className="text-[10px] text-gray-500">
              Fee: {estimate.feeFormatted} wASS (1%)
            </div>
          )}
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
            disabled={isLoading || sharesToSellBigInt <= 0n}
            className="flex-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50 text-sm font-medium"
          >
            {isLoading ? "Selling..." : `Sell for ~${estimate?.wassFormatted || "..."} wASS`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TokenWarsPredictionMarketsV2;
