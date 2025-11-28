'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getContracts, BLACKJACK_ADDRESS, PREDICTION_HUB_ADDRESS, TOKEN_ADDRESS } from '@/config';
import { base } from 'wagmi/chains';
import { formatEther, parseEther, formatUnits, parseUnits } from 'viem';
import Image from 'next/image';
import { Avatar, Name } from '@coinbase/onchainkit/identity';
import { StakingInterface } from '@/components/StakingInterface';
import { SubaccountsPanel } from '@/components/SubaccountsPanel';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { useBatchTransaction } from '@/hooks/useBatchTransaction';
import { useSubaccounts } from '@/hooks/useSubaccounts';

// Token ticker constant
const TOKEN_TICKER = '$wASS';

// Pool size thresholds and labels (in USD equivalent)
// <$10 = thin, $10-50 = medium, $50-100 = good, >$100 = optimal
const POOL_SIZES = {
  THIN: { maxUSD: 10, color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-500', label: 'Thin Pool', description: 'Low liquidity - may have high slippage' },
  MEDIUM: { maxUSD: 50, color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-500', label: 'Medium Pool', description: 'Moderate liquidity for trading' },
  GOOD: { maxUSD: 100, color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-500', label: 'Good Pool', description: 'Good liquidity for active trading' },
  OPTIMAL: { maxUSD: Infinity, color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-500', label: 'Optimal Pool', description: 'Best starting ratio for trading volume' },
};

// Get pool size category based on USD value
function getPoolSizeByUSD(usdValue: number) {
  if (usdValue < POOL_SIZES.THIN.maxUSD) return POOL_SIZES.THIN;
  if (usdValue <= POOL_SIZES.MEDIUM.maxUSD) return POOL_SIZES.MEDIUM;
  if (usdValue <= POOL_SIZES.GOOD.maxUSD) return POOL_SIZES.GOOD;
  return POOL_SIZES.OPTIMAL;
}

// Helper to get token price from Navigation
function useTokenPrice() {
  const [tokenPriceUSD, setTokenPriceUSD] = useState(0);
  const [ethPriceUSD, setEthPriceUSD] = useState(0);

  useEffect(() => {
    const updatePrices = () => {
      if (typeof window !== 'undefined') {
        setTokenPriceUSD((window as any).__TOKEN_PRICE_USD__ || 0);
        setEthPriceUSD((window as any).__ETH_PRICE_USD__ || 0);
      }
    };
    updatePrices();
    const interval = setInterval(updatePrices, 1000);
    return () => clearInterval(interval);
  }, []);

  return { tokenPriceUSD, ethPriceUSD };
}

// ===================== TYPES =====================
interface PredictionJackAppProps {
  onClose: () => void;
  initialGameId?: bigint | null;
}

interface CardDisplay {
  rank: string;
  suit: string;
  value: number;
}

interface GameDisplay {
  status: string;
  playerCards: CardDisplay[];
  playerTotal: number;
  dealerCards: CardDisplay[];
  dealerTotal: number;
  canHit: boolean;
  canStand: boolean;
  canStartNew: boolean;
  canCancelStuck: boolean;
  canAdminResolve: boolean;
  startedAt: bigint;
  lastActionAt: bigint;
  tradingPeriodEnds: bigint;
  secondsUntilCanAct: bigint;
  gameId: bigint;
  marketCreated: boolean;
}

interface GameInfo {
  gameId: bigint;
  player: string;
  state: number;
  startedAt: bigint;
  lastActionAt: bigint;
  playerTotal: number;
  dealerTotal: number;
  marketCreated: boolean;
}

interface MarketDisplay {
  gameId: bigint;
  yesSharesTotal: bigint;
  noSharesTotal: bigint;
  yesDeposits: bigint;
  noDeposits: bigint;
  totalDeposits: bigint;
  yesPrice: bigint;
  noPrice: bigint;
  tradingActive: boolean;
  resolved: boolean;
  result: number;
  userYesShares: bigint;
  userNoShares: bigint;
  userClaimable: bigint;
  volume: bigint;
  status: number;
}

interface ClaimableMarket {
  gameId: bigint;
  claimableAmount: bigint;
  userYesShares: bigint;
  userNoShares: bigint;
  result: number;
  yesPrice: bigint;
  noPrice: bigint;
}

// PlayerStats interface - used for type casting contract response
interface _PlayerStats {
  gamesPlayed: bigint;
  wins: bigint;
  losses: bigint;
  pushes: bigint;
  busts: bigint;
  winRate: bigint;
}

type ViewMode = 'live' | 'play' | 'game' | 'closed' | 'stake' | 'accounts';

// ===================== MINI CARD COMPONENT =====================
function MiniCard({ card, size = 'sm', faceDown = false }: { card: CardDisplay; size?: 'sm' | 'md' | 'lg' | 'xs'; faceDown?: boolean }) {
  const suitColors: Record<string, string> = {
    'Hearts': '#dc2626',
    'Diamonds': '#dc2626',
    'Clubs': '#1f2937',
    'Spades': '#1f2937'
  };

  const suitSymbols: Record<string, string> = {
    'Hearts': '♥',
    'Diamonds': '♦',
    'Clubs': '♣',
    'Spades': '♠'
  };

  const sizes = {
    xs: { w: 20, h: 28, text: 'text-[8px]', symbol: 'text-[7px]', centerSymbol: 'text-[10px]', rankSize: 'text-[9px]' },
    sm: { w: 28, h: 40, text: 'text-[10px]', symbol: 'text-[9px]', centerSymbol: 'text-xs', rankSize: 'text-[10px]' },
    md: { w: 40, h: 56, text: 'text-xs', symbol: 'text-[10px]', centerSymbol: 'text-sm', rankSize: 'text-xs' },
    lg: { w: 56, h: 78, text: 'text-sm', symbol: 'text-xs', centerSymbol: 'text-base', rankSize: 'text-sm' }
  };

  const s = sizes[size];
  const color = suitColors[card.suit] || '#1f2937';
  const symbol = suitSymbols[card.suit] || '♠';

  if (faceDown) {
    return (
      <div
        className="relative rounded shadow-md"
        style={{
          width: s.w,
          height: s.h,
          background: 'linear-gradient(135deg, #1e3a5f 0%, #0f1f32 100%)',
          border: '1px solid #3b82f6',
        }}
      >
        <div className="absolute inset-0.5 rounded border border-blue-500/30"
          style={{
            background: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(59, 130, 246, 0.1) 2px, rgba(59, 130, 246, 0.1) 4px)'
          }}
        />
      </div>
    );
  }

  // For xs size: simplified card with just rank + symbol in center (cleaner look for live games)
  if (size === 'xs') {
    return (
      <div
        className="relative rounded shadow-md overflow-hidden flex flex-col items-center justify-center"
        style={{
          width: s.w,
          height: s.h,
          backgroundColor: '#fefce8',
          border: '1px solid #d4d4d4',
          color,
        }}
      >
        <span className={`font-bold ${s.rankSize} leading-none`}>{card.rank}</span>
        <span className={`${s.centerSymbol} leading-none`}>{symbol}</span>
      </div>
    );
  }

  // For larger sizes: full card with corners
  return (
    <div
      className="relative rounded shadow-md overflow-hidden"
      style={{
        width: s.w,
        height: s.h,
        backgroundColor: '#fefce8',
        border: '1px solid #d4d4d4',
      }}
    >
      {/* Top left rank + suit */}
      <div className="absolute flex flex-col items-center leading-none" style={{ top: 2, left: 3, color }}>
        <span className={`font-bold ${s.text}`}>{card.rank}</span>
        <span className={s.symbol}>{symbol}</span>
      </div>
      {/* Center suit */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ color }}>
        <span className={`${s.centerSymbol} opacity-60`}>{symbol}</span>
      </div>
      {/* Bottom right (rotated) */}
      <div className="absolute flex flex-col items-center leading-none rotate-180" style={{ bottom: 2, right: 3, color }}>
        <span className={`font-bold ${s.text}`}>{card.rank}</span>
        <span className={s.symbol}>{symbol}</span>
      </div>
    </div>
  );
}

// Helper to convert card ID to display
function cardIdToDisplay(cardId: number): CardDisplay {
  const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  // Card ID format: suit * 13 + rank (1-13)
  const suit = Math.floor(cardId / 13);
  const rankNum = cardId % 13 || 13; // Handle 0 becoming 13

  return {
    rank: ranks[rankNum] || '?',
    suit: suits[suit] || 'Spades',
    value: rankNum > 10 ? 10 : rankNum === 1 ? 11 : rankNum
  };
}

// ===================== PLAYER STATS BADGE =====================
function PlayerStatsBadge({ playerAddress }: { playerAddress: string }) {
  const contracts = getContracts(base.id);

  const { data: statsData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getStats',
    args: [playerAddress as `0x${string}`],
    chainId: base.id,
  });

  const stats = statsData as [bigint, bigint, bigint, bigint, bigint, bigint] | undefined;
  const winRate = stats ? Number(stats[5]) : 0;
  const gamesPlayed = stats ? Number(stats[0]) : 0;

  return (
    <div className="flex items-center gap-1.5">
      {/* Avatar using OnchainKit - handles data fetching internally */}
      <Avatar
        address={playerAddress as `0x${string}`}
        chain={base}
        className="w-4 h-4"
      />
      {/* Display name using OnchainKit Name component */}
      <Name
        address={playerAddress as `0x${string}`}
        chain={base}
        className="text-xs truncate max-w-[90px] text-purple-300 font-medium"
      />
      {/* Win rate badge - shows player's historical win rate */}
      {gamesPlayed > 0 && (
        <span
          className={`text-[10px] px-1 py-0.5 rounded flex items-center gap-0.5 ${
            winRate >= 50 ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
          }`}
          title={`Win rate: ${winRate}% (${gamesPlayed} games played)`}
        >
          <span className="opacity-70">W:</span>{winRate}%
        </span>
      )}
    </div>
  );
}

// ===================== ENHANCED GAME CARD =====================
function EnhancedGameCard({
  gameId,
  onSelect,
  isSelected
}: {
  gameId: bigint;
  onSelect: (gameId: bigint) => void;
  isSelected: boolean;
}) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const { tokenPriceUSD } = useTokenPrice();

  // Fetch game info with faster polling
  const { data: gameInfoData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getGameInfo',
    args: [gameId],
    chainId: base.id,
    query: {
      refetchInterval: 1000,
    },
  });

  // Fetch market display
  const { data: marketData } = useReadContract({
    address: PREDICTION_HUB_ADDRESS(base.id),
    abi: contracts.predictionHub.abi,
    functionName: 'getMarketDisplay',
    args: address ? [gameId, address] : [gameId, '0x0000000000000000000000000000000000000000' as `0x${string}`],
    chainId: base.id,
    query: {
      refetchInterval: 1000,
    },
  });

  // Fetch player's cards
  const { data: playerCardsData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getPlayerHand',
    args: gameInfoData ? [(gameInfoData as GameInfo).player as `0x${string}`] : undefined,
    chainId: base.id,
    query: {
      enabled: !!gameInfoData,
      refetchInterval: 1000,
    },
  });

  // Fetch dealer's cards
  const { data: dealerCardsData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getDealerHand',
    args: gameInfoData ? [(gameInfoData as GameInfo).player as `0x${string}`] : undefined,
    chainId: base.id,
    query: {
      enabled: !!gameInfoData,
      refetchInterval: 1000,
    },
  });

  const gameInfo = gameInfoData as GameInfo | undefined;
  const market = marketData as MarketDisplay | undefined;
  const playerCardIds = playerCardsData as number[] | undefined;
  const dealerCardIds = dealerCardsData as number[] | undefined;

  if (!gameInfo) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-4 animate-pulse border border-gray-700">
        <div className="h-40 bg-gray-700/50 rounded" />
      </div>
    );
  }

  const stateNames = ['Inactive', 'Dealing', 'Active', 'Hitting', 'Standing', 'Busted', 'Finished'];
  const stateName = stateNames[Number(gameInfo.state)] || 'Unknown';

  const yesPrice = market?.yesPrice ? Number(market.yesPrice) / 100 : 50;
  const noPrice = market?.noPrice ? Number(market.noPrice) / 100 : 50;
  const volume = market?.volume ? formatEther(market.volume) : '0';
  const _volumeUSD = tokenPriceUSD > 0 ? (Number(volume) * tokenPriceUSD).toFixed(2) : null;
  const totalDeposits = market?.totalDeposits ? formatEther(market.totalDeposits) : '0';
  const depositsUSD = tokenPriceUSD > 0 ? (Number(totalDeposits) * tokenPriceUSD).toFixed(2) : null;

  // Convert card IDs to displays
  const playerCards = playerCardIds?.map(id => cardIdToDisplay(id)) || [];
  const dealerCards = dealerCardIds?.map(id => cardIdToDisplay(id)) || [];

  return (
    <div
      onClick={() => onSelect(gameId)}
      className={`bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-xl p-3 cursor-pointer
        transition-all duration-200 hover:scale-[1.02] border-2 ${
        isSelected
          ? 'border-purple-500 shadow-lg shadow-purple-500/30'
          : 'border-gray-700 hover:border-purple-500/50'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-white font-bold text-sm">Game #{gameId.toString()}</div>
          <PlayerStatsBadge playerAddress={gameInfo.player} />
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
          stateName === 'Active' || stateName === 'Hitting' ? 'bg-green-500/20 text-green-400 animate-pulse' :
          stateName === 'Dealing' ? 'bg-yellow-500/20 text-yellow-400' :
          stateName === 'Standing' ? 'bg-blue-500/20 text-blue-400' :
          stateName === 'Busted' ? 'bg-red-500/20 text-red-400' :
          stateName === 'Finished' ? 'bg-purple-500/20 text-purple-400' :
          'bg-gray-700/50 text-gray-300'
        }`}>
          {stateName}
        </div>
      </div>

      {/* Cards Display - Two Rows */}
      <div className="bg-green-900/30 rounded-lg p-2 mb-2">
        {/* Dealer Row */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-[10px] w-10">Dealer</span>
            <div className="flex gap-0.5">
              {dealerCards.length > 0 ? (
                dealerCards.slice(0, 5).map((card, i) => (
                  <MiniCard key={i} card={card} size="xs" />
                ))
              ) : (
                <>
                  <MiniCard card={{ rank: '?', suit: 'Spades', value: 0 }} size="xs" faceDown />
                  <MiniCard card={{ rank: '?', suit: 'Spades', value: 0 }} size="xs" faceDown />
                </>
              )}
            </div>
          </div>
          <span className="text-white font-bold text-sm bg-gray-800/50 px-1.5 py-0.5 rounded">
            {gameInfo.dealerTotal}
          </span>
        </div>

        {/* Player Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-[10px] w-10">Player</span>
            <div className="flex gap-0.5">
              {playerCards.length > 0 ? (
                playerCards.slice(0, 5).map((card, i) => (
                  <MiniCard key={i} card={card} size="xs" />
                ))
              ) : (
                <>
                  <MiniCard card={{ rank: '?', suit: 'Hearts', value: 0 }} size="xs" faceDown />
                  <MiniCard card={{ rank: '?', suit: 'Hearts', value: 0 }} size="xs" faceDown />
                </>
              )}
            </div>
          </div>
          <span className="text-white font-bold text-sm bg-gray-800/50 px-1.5 py-0.5 rounded">
            {gameInfo.playerTotal}
          </span>
        </div>
      </div>

      {/* Market Info */}
      {gameInfo.marketCreated && market && (
        <div className="bg-gray-900/50 rounded-lg p-2">
          {/* Share Prices - show actual token cost per share */}
          <div className="flex justify-between items-center mb-1.5">
            <div className="flex gap-3">
              <div className="text-center">
                <div className="text-green-400 text-[10px]">YES Share</div>
                <div className="text-white font-bold text-xs">
                  {(yesPrice / 100).toFixed(4)}
                  {tokenPriceUSD > 0 && (
                    <span className="text-gray-500 text-[9px] ml-0.5">
                      (${((yesPrice / 100) * tokenPriceUSD).toFixed(4)})
                    </span>
                  )}
                </div>
              </div>
              <div className="text-center">
                <div className="text-red-400 text-[10px]">NO Share</div>
                <div className="text-white font-bold text-xs">
                  {(noPrice / 100).toFixed(4)}
                  {tokenPriceUSD > 0 && (
                    <span className="text-gray-500 text-[9px] ml-0.5">
                      (${((noPrice / 100) * tokenPriceUSD).toFixed(4)})
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-[10px]">Pool</div>
              <div className="text-purple-300 font-semibold text-xs">
                {Number(totalDeposits).toFixed(4)} {TOKEN_TICKER}
                {depositsUSD && <span className="text-gray-500 text-[9px] block">${depositsUSD}</span>}
              </div>
            </div>
          </div>

          {/* Price Bar - shows probability distribution */}
          <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400"
              style={{ width: `${yesPrice}%` }}
            />
          </div>
        </div>
      )}

      {!gameInfo.marketCreated && (
        <div className="bg-yellow-900/20 rounded-lg p-1.5 text-center">
          <span className="text-yellow-400 text-[10px]">⏳ Market pending...</span>
        </div>
      )}
    </div>
  );
}

// ===================== INTEGRATED MARKET PANEL =====================
function MarketPanel({
  gameId,
  compact = false,
  showFullStats = false
}: {
  gameId: bigint;
  compact?: boolean;
  showFullStats?: boolean;
}) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const { tokenPriceUSD } = useTokenPrice();

  // Smart wallet detection for batch transactions
  const { supportsAtomicBatch } = useSmartWallet();
  const {
    executeBatch,
    isPending: isBatchPending,
    isConfirming: isBatchConfirming,
    isSuccess: isBatchSuccess,
    reset: resetBatch,
  } = useBatchTransaction();

  const [actionType, setActionType] = useState<'buy' | 'sell'>('buy');
  const [position, setPosition] = useState<'yes' | 'no'>('yes');
  const [paymentMethod, setPaymentMethod] = useState<'token' | 'eth'>('token');
  const [amount, setAmount] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch market with fast polling
  const { data: marketData, refetch: refetchMarket } = useReadContract({
    address: PREDICTION_HUB_ADDRESS(base.id),
    abi: contracts.predictionHub.abi,
    functionName: 'getMarketDisplay',
    args: address ? [gameId, address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
      refetchInterval: 1000,
    },
  });

  // Token allowance
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: TOKEN_ADDRESS(base.id),
    abi: contracts.token.abi,
    functionName: 'allowance',
    args: address ? [address, PREDICTION_HUB_ADDRESS(base.id)] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address && paymentMethod === 'token',
    },
  });

  const { data: decimalsData } = useReadContract({
    address: TOKEN_ADDRESS(base.id),
    abi: contracts.token.abi,
    functionName: 'decimals',
    chainId: base.id,
  });

  // Token balance
  const { data: tokenBalanceData } = useReadContract({
    address: TOKEN_ADDRESS(base.id),
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const allowance = allowanceData as bigint | undefined;
  const tokenDecimals = (decimalsData as number) || 18;
  const market = marketData as MarketDisplay | undefined;
  const tokenBalance = tokenBalanceData as bigint | undefined;

  // Approval
  const { data: approveHash, writeContract: writeApprove, isPending: isApprovePending } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash });

  // Transaction
  const { data: txHash, writeContract: writeTx, isPending: isTxPending } = useWriteContract();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isTxConfirmed) {
      refetchMarket();
      setAmount('');
    }
  }, [isTxConfirmed, refetchMarket]);

  useEffect(() => {
    if (isApproveConfirmed) {
      refetchAllowance();
    }
  }, [isApproveConfirmed, refetchAllowance]);

  // Handle batch transaction success
  useEffect(() => {
    if (isBatchSuccess) {
      refetchMarket();
      refetchAllowance();
      setAmount('');
      resetBatch();
    }
  }, [isBatchSuccess, refetchMarket, refetchAllowance, resetBatch]);

  const needsApproval = () => {
    if (actionType === 'sell') return false;
    if (paymentMethod === 'eth') return false;
    if (!amount || !allowance) return true;
    try {
      const amountInWei = parseUnits(amount, tokenDecimals);
      return allowance < amountInWei;
    } catch {
      return true;
    }
  };

  const handleApprove = () => {
    // Approve 3000 tokens for one-time approval
    writeApprove({
      address: TOKEN_ADDRESS(base.id),
      abi: contracts.token.abi,
      functionName: 'approve',
      args: [PREDICTION_HUB_ADDRESS(base.id), parseEther('3000')],
    });
  };

  const handleTrade = () => {
    if (!amount) return;
    setErrorMessage('');

    try {
      if (actionType === 'buy') {
        if (paymentMethod === 'eth') {
          // Buy with ETH
          const amountInWei = parseEther(amount);
          const functionName = position === 'yes' ? 'buyYesWithETH' : 'buyNoWithETH';
          writeTx({
            address: PREDICTION_HUB_ADDRESS(base.id),
            abi: contracts.predictionHub.abi,
            functionName,
            args: [gameId],
            value: amountInWei,
          });
        } else {
          // Buy with tokens
          const amountInWei = parseUnits(amount, tokenDecimals);
          writeTx({
            address: PREDICTION_HUB_ADDRESS(base.id),
            abi: contracts.predictionHub.abi,
            functionName: 'buyShares',
            args: [gameId, amountInWei, position === 'yes'],
          });
        }
      } else {
        const sharesIn = parseUnits(amount, tokenDecimals);
        writeTx({
          address: PREDICTION_HUB_ADDRESS(base.id),
          abi: contracts.predictionHub.abi,
          functionName: 'sellShares',
          args: [gameId, sharesIn, position === 'yes'],
        });
      }
    } catch {
      setErrorMessage('Transaction failed');
    }
  };

  // Smart wallet: batch approve + buy in single transaction
  const handleApproveAndTrade = async () => {
    if (!amount || actionType !== 'buy' || paymentMethod !== 'token') return;
    setErrorMessage('');

    try {
      const amountInWei = parseUnits(amount, tokenDecimals);
      await executeBatch([
        {
          address: TOKEN_ADDRESS(base.id),
          abi: contracts.token.abi,
          functionName: 'approve',
          args: [PREDICTION_HUB_ADDRESS(base.id), parseEther('3000')],
        },
        {
          address: PREDICTION_HUB_ADDRESS(base.id),
          abi: contracts.predictionHub.abi,
          functionName: 'buyShares',
          args: [gameId, amountInWei, position === 'yes'],
        },
      ]);
    } catch {
      setErrorMessage('Transaction failed');
    }
  };

  const getButtonText = () => {
    if (isBatchPending || isBatchConfirming) return '⚡ Processing...';
    if (isApprovePending || isApproveConfirming) return 'Approving...';
    if (isTxPending || isTxConfirming) return 'Processing...';
    if (needsApproval()) {
      if (supportsAtomicBatch && actionType === 'buy' && paymentMethod === 'token') {
        return `⚡ Approve & Buy ${position.toUpperCase()}`;
      }
      return `Approve ${TOKEN_TICKER}`;
    }
    if (actionType === 'buy') {
      const method = paymentMethod === 'eth' ? 'ETH' : TOKEN_TICKER;
      return `Buy ${position.toUpperCase()} with ${method}`;
    }
    return `Sell ${position.toUpperCase()} Shares`;
  };

  if (!market) return null;

  const yesPrice = Number(market.yesPrice) / 100;
  const noPrice = Number(market.noPrice) / 100;
  const userYes = formatUnits(market.userYesShares, tokenDecimals);
  const userNo = formatUnits(market.userNoShares, tokenDecimals);
  const totalDeposits = market.totalDeposits ? formatUnits(market.totalDeposits, tokenDecimals) : '0';
  const volume = market.volume ? formatUnits(market.volume, tokenDecimals) : '0';
  const tokenBalanceFormatted = tokenBalance ? formatUnits(tokenBalance, tokenDecimals) : '0';

  return (
    <div className={`bg-gray-800/80 rounded-xl ${compact ? 'p-3' : 'p-4'}`}>
      {/* Price Display */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setPosition('yes')}
          className={`flex-1 p-2 rounded-lg transition-all ${
            position === 'yes'
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <div className="text-xs opacity-80">YES</div>
          <div className="font-bold">{yesPrice.toFixed(1)}%</div>
        </button>
        <button
          onClick={() => setPosition('no')}
          className={`flex-1 p-2 rounded-lg transition-all ${
            position === 'no'
              ? 'bg-red-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <div className="text-xs opacity-80">NO</div>
          <div className="font-bold">{noPrice.toFixed(1)}%</div>
        </button>
      </div>

      {/* User Shares with To Win calculations in USD */}
      {(Number(userYes) > 0 || Number(userNo) > 0) && (
        <div className="bg-gray-900/50 p-2 rounded-lg mb-3 text-xs">
          <div className="text-gray-400 mb-1">Your Position</div>
          <div className="space-y-1.5">
            {Number(userYes) > 0 && (() => {
              const yesWinTokens = Number(userYes) * (100 / yesPrice);
              const yesWinUSD = tokenPriceUSD > 0 ? yesWinTokens * tokenPriceUSD : null;
              return (
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-green-400">YES:</span>{' '}
                    <span className="text-white">{Number(userYes).toFixed(4)} {TOKEN_TICKER}</span>
                  </div>
                  <div className="text-green-300 font-semibold">
                    To Win: {yesWinUSD ? `$${yesWinUSD.toFixed(4)}` : `${yesWinTokens.toFixed(4)} ${TOKEN_TICKER}`}
                  </div>
                </div>
              );
            })()}
            {Number(userNo) > 0 && (() => {
              const noWinTokens = Number(userNo) * (100 / noPrice);
              const noWinUSD = tokenPriceUSD > 0 ? noWinTokens * tokenPriceUSD : null;
              return (
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-red-400">NO:</span>{' '}
                    <span className="text-white">{Number(userNo).toFixed(4)} {TOKEN_TICKER}</span>
                  </div>
                  <div className="text-red-300 font-semibold">
                    To Win: {noWinUSD ? `$${noWinUSD.toFixed(4)}` : `${noWinTokens.toFixed(4)} ${TOKEN_TICKER}`}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Action Toggle */}
      <div className="flex gap-1 mb-3 bg-gray-900/50 rounded-lg p-1">
        <button
          onClick={() => setActionType('buy')}
          className={`flex-1 py-1.5 rounded text-sm font-semibold transition-all ${
            actionType === 'buy' ? 'bg-green-600 text-white' : 'text-gray-400'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setActionType('sell')}
          className={`flex-1 py-1.5 rounded text-sm font-semibold transition-all ${
            actionType === 'sell' ? 'bg-red-600 text-white' : 'text-gray-400'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Payment Method Toggle (only for buying) */}
      {actionType === 'buy' && (
        <div className="flex gap-1 mb-3 bg-gray-900/50 rounded-lg p-1">
          <button
            onClick={() => setPaymentMethod('token')}
            className={`flex-1 py-1.5 rounded text-sm font-semibold transition-all ${
              paymentMethod === 'token' ? 'bg-purple-600 text-white' : 'text-gray-400'
            }`}
          >
            {TOKEN_TICKER}
          </button>
          <button
            onClick={() => setPaymentMethod('eth')}
            className={`flex-1 py-1.5 rounded text-sm font-semibold transition-all ${
              paymentMethod === 'eth' ? 'bg-blue-600 text-white' : 'text-gray-400'
            }`}
          >
            ETH
          </button>
        </div>
      )}

      {/* Amount Input */}
      <div className="mb-3">
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={actionType === 'buy'
            ? `Amount in ${paymentMethod === 'eth' ? 'ETH' : TOKEN_TICKER}`
            : 'Shares to sell'}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
        />
        <div className="text-xs text-gray-400 mt-1">
          {actionType === 'buy' && paymentMethod === 'token' && (
            <span>Balance: {Number(tokenBalanceFormatted).toFixed(4)} {TOKEN_TICKER}</span>
          )}
          {actionType === 'sell' && (
            <span>Your shares: {position === 'yes' ? Number(userYes).toFixed(4) : Number(userNo).toFixed(4)} {TOKEN_TICKER}</span>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="text-red-400 text-xs mb-2">{errorMessage}</div>
      )}

      {/* Trade Button */}
      <button
        onClick={() => {
          if (needsApproval()) {
            // Smart wallet: batch approve + trade in one tx
            if (supportsAtomicBatch && actionType === 'buy' && paymentMethod === 'token') {
              handleApproveAndTrade();
            } else {
              handleApprove();
            }
          } else {
            handleTrade();
          }
        }}
        disabled={!amount || !market.tradingActive || isApprovePending || isApproveConfirming || isTxPending || isTxConfirming || isBatchPending || isBatchConfirming}
        className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all text-sm"
      >
        {getButtonText()}
      </button>

      {!market.tradingActive && (
        <div className="text-yellow-400 text-xs text-center mt-2">Trading paused</div>
      )}
      {market.resolved && (
        <div className="text-purple-300 text-xs text-center mt-2">Market resolved</div>
      )}

      {/* Market Stats */}
      <div className="mt-3 pt-3 border-t border-gray-700 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-gray-400">Total Deposits</div>
          <div className="text-white font-semibold">
            {Number(totalDeposits).toFixed(4)}
            {tokenPriceUSD > 0 && (
              <span className="text-gray-500 text-[10px] ml-1">(${(Number(totalDeposits) * tokenPriceUSD).toFixed(4)})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Volume</div>
          <div className="text-white font-semibold">
            {Number(volume).toFixed(4)}
            {tokenPriceUSD > 0 && (
              <span className="text-gray-500 text-[10px] ml-1">(${(Number(volume) * tokenPriceUSD).toFixed(4)})</span>
            )}
          </div>
        </div>
      </div>

      {/* Extended Stats for showFullStats mode */}
      {showFullStats && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-gray-400">YES Pool</div>
              <div className="text-green-400 font-semibold">
                {market.yesDeposits ? Number(formatUnits(market.yesDeposits, tokenDecimals)).toFixed(4) : '0'}
              </div>
            </div>
            <div>
              <div className="text-gray-400">NO Pool</div>
              <div className="text-red-400 font-semibold">
                {market.noDeposits ? Number(formatUnits(market.noDeposits, tokenDecimals)).toFixed(4) : '0'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-gray-400">YES Shares</div>
              <div className="text-green-300">{market.yesSharesTotal ? Number(formatUnits(market.yesSharesTotal, tokenDecimals)).toFixed(4) : '0'}</div>
            </div>
            <div>
              <div className="text-gray-400">NO Shares</div>
              <div className="text-red-300">{market.noSharesTotal ? Number(formatUnits(market.noSharesTotal, tokenDecimals)).toFixed(4) : '0'}</div>
            </div>
          </div>
          {/* Claim Button when resolved and user has claimable amount */}
          {market.resolved && market.userClaimable > 0n && (
            <ClaimInlineButton gameId={gameId} claimableAmount={market.userClaimable} tokenPriceUSD={tokenPriceUSD} tokenDecimals={tokenDecimals} />
          )}
        </div>
      )}
    </div>
  );
}

// ===================== INLINE CLAIM BUTTON =====================
function ClaimInlineButton({
  gameId,
  claimableAmount,
  tokenPriceUSD,
  tokenDecimals
}: {
  gameId: bigint;
  claimableAmount: bigint;
  tokenPriceUSD: number;
  tokenDecimals: number;
}) {
  const contracts = getContracts(base.id);
  const { writeContract, isPending } = useWriteContract();
  const { data: txHash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleClaim = () => {
    writeContract({
      address: PREDICTION_HUB_ADDRESS(base.id),
      abi: contracts.predictionHub.abi,
      functionName: 'claimWinnings',
      args: [gameId],
    });
  };

  const claimableFormatted = Number(formatUnits(claimableAmount, tokenDecimals));
  const claimableUSD = tokenPriceUSD > 0 ? (claimableFormatted * tokenPriceUSD).toFixed(4) : null;

  return (
    <button
      onClick={handleClaim}
      disabled={isPending || isConfirming || isSuccess}
      className="w-full py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold rounded-lg text-sm transition-all animate-pulse"
    >
      {isPending || isConfirming ? 'Claiming...' : isSuccess ? 'Claimed!' : (
        <>
          💰 Claim {claimableFormatted.toFixed(4)}
          {claimableUSD && <span className="text-green-200 ml-1">(${claimableUSD})</span>}
        </>
      )}
    </button>
  );
}

// ===================== START PAGE CLAIM ITEM =====================
function StartPageClaimItem({ market, tokenPriceUSD }: { market: ClaimableMarket; tokenPriceUSD: number }) {
  const contracts = getContracts(base.id);
  const { writeContract, isPending } = useWriteContract();
  const { data: txHash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleClaim = () => {
    writeContract({
      address: PREDICTION_HUB_ADDRESS(base.id),
      abi: contracts.predictionHub.abi,
      functionName: 'claimWinnings',
      args: [market.gameId],
    });
  };

  const claimableFormatted = Number(formatEther(market.claimableAmount));
  const claimableUSD = tokenPriceUSD > 0 ? (claimableFormatted * tokenPriceUSD).toFixed(4) : null;
  const resultLabels = ['Pending', 'Win', 'Lose', 'Push'];
  const resultLabel = resultLabels[market.result] || 'Unknown';

  return (
    <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-2">
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-semibold truncate">
          Game #{market.gameId.toString()}
          <span className={`ml-2 text-xs ${
            resultLabel === 'Win' ? 'text-green-400' :
            resultLabel === 'Lose' ? 'text-red-400' :
            'text-gray-400'
          }`}>
            ({resultLabel})
          </span>
        </div>
        <div className="text-green-400 text-xs">
          {claimableFormatted.toFixed(4)}
          {claimableUSD && <span className="text-gray-500 ml-1">(${claimableUSD})</span>}
        </div>
      </div>
      <button
        onClick={handleClaim}
        disabled={isPending || isConfirming || isSuccess}
        className="ml-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white text-xs font-semibold rounded transition-all flex-shrink-0"
      >
        {isPending || isConfirming ? '...' : isSuccess ? '✓' : 'Claim'}
      </button>
    </div>
  );
}

// ===================== FULL GAME SCREEN =====================
function GameScreen({
  gameId,
  onBack,
  isWaitingForVRF = false,
  onVRFComplete,
  showBackButton = true
}: {
  gameId: bigint | null;
  onBack: () => void;
  isWaitingForVRF?: boolean;
  onVRFComplete?: () => void;
  showBackButton?: boolean;
}) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const [clientSecondsUntilCanAct, setClientSecondsUntilCanAct] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [showLinkCopied, setShowLinkCopied] = useState(false);
  const [vrfWaitSeconds, setVrfWaitSeconds] = useState(0);

  // When viewing another player's game, first get their address from gameId
  const { data: gameInfoData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getGameInfo',
    args: gameId ? [gameId] : undefined,
    chainId: base.id,
    query: {
      enabled: !!gameId,
    },
  });
  const gameInfo = gameInfoData as GameInfo | undefined;

  // Determine which player address to use for getGameDisplay
  // If viewing another game (gameId provided), use that game's player address
  // Otherwise use current user's address
  const targetPlayerAddress = gameId && gameInfo?.player ? gameInfo.player : address;
  const isViewingOwnGame = !gameId || (gameInfo?.player?.toLowerCase() === address?.toLowerCase());

  // Fetch game display with 1s polling
  const { data: gameDisplayData, refetch: refetchGame } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getGameDisplay',
    args: targetPlayerAddress ? [targetPlayerAddress] : undefined,
    chainId: base.id,
    query: {
      enabled: !!targetPlayerAddress,
      refetchInterval: 1000,
    },
  });

  const gameDisplay = gameDisplayData as GameDisplay | undefined;
  const activeGameId = gameId || gameDisplay?.gameId;

  // Hit transaction
  const { data: hitHash, writeContract: writeHit, isPending: isHitPending } = useWriteContract();
  const { isLoading: isHitConfirming, isSuccess: isHitConfirmed } = useWaitForTransactionReceipt({ hash: hitHash });

  // Stand transaction
  const { data: standHash, writeContract: writeStand, isPending: isStandPending } = useWriteContract();
  const { isLoading: isStandConfirming, isSuccess: isStandConfirmed } = useWaitForTransactionReceipt({ hash: standHash });

  useEffect(() => {
    if (isHitConfirmed || isStandConfirmed) {
      refetchGame();
    }
  }, [isHitConfirmed, isStandConfirmed, refetchGame]);

  // Client-side countdown
  useEffect(() => {
    if (gameDisplay?.secondsUntilCanAct) {
      setClientSecondsUntilCanAct(Number(gameDisplay.secondsUntilCanAct));
    }
  }, [gameDisplay?.secondsUntilCanAct]);

  useEffect(() => {
    if (clientSecondsUntilCanAct <= 0) return;
    const id = setInterval(() => {
      setClientSecondsUntilCanAct(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [clientSecondsUntilCanAct]);

  // Detect when VRF completes (cards appear)
  useEffect(() => {
    if (isWaitingForVRF && gameDisplay?.playerCards && gameDisplay.playerCards.length > 0) {
      onVRFComplete?.();
      setVrfWaitSeconds(0); // Reset timer when VRF completes
    }
  }, [isWaitingForVRF, gameDisplay?.playerCards, onVRFComplete]);

  // Check if game is waiting for VRF (no cards yet but game exists)
  const isGameWaitingForVRF = isWaitingForVRF || (
    gameDisplay &&
    gameDisplay.gameId > 0n &&
    gameDisplay.playerCards.length === 0 &&
    gameDisplay.status.toLowerCase().includes('waiting')
  );

  // VRF wait timer - counts up when waiting for VRF
  useEffect(() => {
    if (!isGameWaitingForVRF) {
      setVrfWaitSeconds(0);
      return;
    }
    const id = setInterval(() => {
      setVrfWaitSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [isGameWaitingForVRF]);

  // Cancel stuck game transaction
  const { data: cancelHash, writeContract: writeCancelStuckGame, isPending: isCancelPending } = useWriteContract();
  const { isLoading: isCancelConfirming, isSuccess: isCancelConfirmed } = useWaitForTransactionReceipt({ hash: cancelHash });

  useEffect(() => {
    if (isCancelConfirmed) {
      setVrfWaitSeconds(0);
      refetchGame();
    }
  }, [isCancelConfirmed, refetchGame]);

  const handleCancelStuckGame = () => {
    setErrorMessage('');
    writeCancelStuckGame({
      address: BLACKJACK_ADDRESS(base.id),
      abi: contracts.blackjack.abi,
      functionName: 'cancelStuckGame',
      args: [],
    });
  };

  const handleHit = () => {
    setErrorMessage('');
    writeHit({
      address: BLACKJACK_ADDRESS(base.id),
      abi: contracts.blackjack.abi,
      functionName: 'hit',
      args: [],
    });
  };

  const handleStand = () => {
    setErrorMessage('');
    writeStand({
      address: BLACKJACK_ADDRESS(base.id),
      abi: contracts.blackjack.abi,
      functionName: 'stand',
      args: [],
    });
  };

  // Card renderer
  const renderCard = (card: CardDisplay, index: number) => {
    const suitImages: Record<string, string> = {
      'Hearts': '/Images/Heart2.png',
      'Diamonds': '/Images/Diamond2.png',
      'Clubs': '/Images/Clover.png',
      'Spades': '/Images/Spade.png'
    };
    const suitColors: Record<string, string> = {
      'Hearts': '#dc2626',
      'Diamonds': '#dc2626',
      'Clubs': '#1f2937',
      'Spades': '#1f2937'
    };

    const suitImage = suitImages[card.suit] || '/Images/Spade.png';
    const textColor = suitColors[card.suit] || '#1f2937';

    return (
      <div
        key={index}
        className="relative"
        style={{ width: '80px', height: '112px', marginRight: '-20px' }}
      >
        <div className="absolute inset-0 rounded-xl shadow-2xl overflow-hidden">
          <Image src="/Images/Card.png" alt="Card" fill style={{ objectFit: 'cover' }} />
        </div>
        <div className="absolute inset-0">
          <div className="absolute flex flex-col items-center gap-0.5" style={{ color: textColor, top: '14px', left: '12px' }}>
            <span className="text-base font-bold" style={{ fontFamily: 'Georgia, serif' }}>{card.rank}</span>
            <div className="relative w-3 h-3">
              <Image src={suitImage} alt={card.suit} fill style={{ objectFit: 'contain' }} />
            </div>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6">
            <Image src={suitImage} alt={card.suit} fill style={{ objectFit: 'contain' }} className="opacity-75" />
          </div>
          <div className="absolute flex flex-col items-center gap-0.5 rotate-180" style={{ color: textColor, bottom: '14px', right: '12px' }}>
            <span className="text-base font-bold" style={{ fontFamily: 'Georgia, serif' }}>{card.rank}</span>
            <div className="relative w-3 h-3">
              <Image src={suitImage} alt={card.suit} fill style={{ objectFit: 'contain' }} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!gameDisplay) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">Loading game...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
      {/* Main Game Area */}
      <div className="flex-1 flex flex-col bg-gradient-to-b from-green-900/30 to-green-950/50 rounded-2xl p-4 relative">
        {/* Top Bar - Back button (left) and Game ID with Share (right) */}
        <div className="flex justify-between items-start mb-3">
          {/* Back Button - Only show when viewing other games */}
          {showBackButton ? (
            <button
              onClick={onBack}
              className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 rounded-lg text-sm flex items-center gap-2"
            >
              ← Back to Games
            </button>
          ) : (
            <div /> // Empty div for spacing
          )}

          {/* Game ID and Share Button - Upper Right */}
          {gameDisplay.gameId > 0n && (
            <div className="flex items-center gap-2">
              <div className="text-gray-400 text-xs">Game #{gameDisplay.gameId.toString()}</div>
              <button
                onClick={() => {
                  const shareUrl = `${window.location.origin}/blackjack?id=${gameDisplay.gameId.toString()}`;
                  navigator.clipboard.writeText(shareUrl);
                  setShowLinkCopied(true);
                  setTimeout(() => setShowLinkCopied(false), 2000);
                }}
                className="p-1.5 bg-purple-600/50 hover:bg-purple-500/50 text-purple-200 rounded-lg text-xs flex items-center gap-1 transition-all"
                title="Copy link to clipboard"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Share
              </button>
              {/* Link copied feedback with fade animation */}
              <span
                className={`text-xs text-white/60 transition-all duration-500 ${
                  showLinkCopied ? 'opacity-100' : 'opacity-0'
                }`}
              >
                link copied
              </span>
            </div>
          )}
        </div>

        {/* Game Status */}
        <div className="text-center mb-3">
          <div className="text-purple-300 font-semibold text-lg">{gameDisplay.status}</div>
        </div>

        {/* VRF Waiting Info Box */}
        {isGameWaitingForVRF && (
          <div className={`${vrfWaitSeconds >= 60 ? 'bg-red-900/40 border-red-500' : 'bg-purple-900/40 border-purple-500'} border p-4 rounded-xl mb-4 text-center`}>
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="animate-spin w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full" />
              <span className="text-purple-200 font-semibold">Waiting for Chainlink VRF</span>
              <span className="text-gray-400 text-sm">({vrfWaitSeconds}s)</span>
            </div>
            {vrfWaitSeconds < 60 ? (
              <p className="text-purple-300 text-sm">
                Generating secure random cards... This usually takes 2-3 seconds on Base.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-red-300 text-sm">
                  VRF is taking longer than expected. You can cancel and get your funds back.
                </p>
                <button
                  onClick={handleCancelStuckGame}
                  disabled={isCancelPending || isCancelConfirming}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-bold rounded-lg transition-all"
                >
                  {isCancelPending || isCancelConfirming ? 'Cancelling...' : 'Cancel Stuck Game'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Dealer Hand */}
        {gameDisplay.dealerCards.length > 0 && (
          <div className="mb-4">
            <div className="text-gray-300 text-sm mb-2 text-center">
              Dealer: <span className="font-bold text-white">{gameDisplay.dealerTotal}</span>
            </div>
            <div className="flex justify-center items-center">
              {gameDisplay.dealerCards.map((card, i) => renderCard(card, i))}
            </div>
          </div>
        )}

        {/* Player Hand */}
        {gameDisplay.playerCards.length > 0 && (
          <div className="mb-4">
            <div className="text-gray-300 text-sm mb-2 text-center">
              Your Hand: <span className="font-bold text-white">{gameDisplay.playerTotal}</span>
            </div>
            <div className="flex justify-center items-center">
              {gameDisplay.playerCards.map((card, i) => renderCard(card, i))}
            </div>
          </div>
        )}

        {/* Trading Period Timer with Better Context */}
        {clientSecondsUntilCanAct > 0 && (
          <div className="bg-blue-900/50 border border-blue-500 p-3 rounded-lg text-center mb-3">
            <div className="text-blue-200 text-sm font-semibold">⏱️ Trading Window Open</div>
            <div className="text-white font-bold text-2xl">{clientSecondsUntilCanAct}s</div>
            <div className="text-blue-300 text-xs mt-1">
              Trade on the prediction market before making your move
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-900/50 border border-red-500 p-2 rounded-lg text-red-200 text-sm mb-3 text-center">
            {errorMessage}
          </div>
        )}

        {/* Action Buttons - only show for own game */}
        {isViewingOwnGame && (
          <div className="flex gap-4 justify-center mt-auto">
            {gameDisplay.canHit && (
              <button
                onClick={handleHit}
                disabled={isHitPending || isHitConfirming}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold rounded-xl transition-all text-lg shadow-lg"
              >
                {isHitPending || isHitConfirming ? 'Hitting...' : 'HIT'}
              </button>
            )}
            {gameDisplay.canStand && (
              <button
                onClick={handleStand}
                disabled={isStandPending || isStandConfirming}
                className="px-8 py-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white font-bold rounded-xl transition-all text-lg shadow-lg"
              >
                {isStandPending || isStandConfirming ? 'Standing...' : 'STAND'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Enhanced Market Panel with Trading Context */}
      <div className="lg:w-[420px] flex-shrink-0 flex flex-col gap-3">
        {/* Market Panel */}
        {activeGameId && activeGameId > 0n && gameDisplay.marketCreated && (
          <MarketPanel gameId={activeGameId} showFullStats={true} />
        )}

        {/* Trading Tips Box - Always show when market exists to help users understand the game */}
        {activeGameId && activeGameId > 0n && gameDisplay.marketCreated && (
          <div className="bg-gray-800/60 rounded-xl p-3 text-xs">
            <div className="text-purple-300 font-semibold mb-2">💡 Trading Tips & Odds</div>
            <div className="space-y-1.5 text-gray-300">
              <div>• <span className="text-green-400">YES</span> wins if player beats dealer or dealer busts</div>
              <div>• <span className="text-red-400">NO</span> wins if player busts or dealer wins</div>
              <div className="pt-1 border-t border-gray-700 mt-1">
                <div className="flex justify-between items-center">
                  <span>Current hand:</span>
                  <span className="text-white font-semibold">{gameDisplay.playerTotal} vs Dealer: {gameDisplay.dealerTotal}</span>
                </div>
              </div>
              {/* Player Win Odds based on current hand situation */}
              {gameDisplay.playerTotal > 0 && (
                <div className="bg-gray-900/50 rounded-lg p-2 mt-2">
                  <div className="text-gray-400 text-[10px] mb-1">Player Win Probability</div>
                  {(() => {
                    // Blackjack odds calculation comparing player vs dealer totals
                    let winChance = 50;
                    const playerTotal = Number(gameDisplay.playerTotal);
                    const dealerTotal = Number(gameDisplay.dealerTotal);
                    const status = gameDisplay.status.toLowerCase();

                    // Check if game is truly resolved - must have canStartNew=true OR status indicates finished
                    // canHit/canStand can be false during trading period while game is still active
                    const isGameResolved = gameDisplay.gameId > 0n && gameDisplay.playerCards.length > 0 && (
                      gameDisplay.canStartNew || // Can start new game means current is finished
                      status.includes('win') ||
                      status.includes('lose') ||
                      status.includes('bust') ||
                      status.includes('push') ||
                      status.includes('finished')
                    );

                    // If game is resolved, show definitive results
                    if (isGameResolved) {
                      // Check for player win conditions
                      if (dealerTotal > 21 || (playerTotal <= 21 && playerTotal > dealerTotal)) {
                        winChance = 100; // Player won
                      } else if (playerTotal > 21 || dealerTotal > playerTotal) {
                        winChance = 0; // Player lost
                      } else if (playerTotal === dealerTotal) {
                        winChance = 50; // Push
                      }
                    } else {
                      // Game in progress - calculate odds
                      if (playerTotal > 21) {
                        // Player busted
                        winChance = 0;
                      } else if (dealerTotal > 21) {
                        // Dealer busted
                        winChance = 100;
                      } else if (playerTotal === 21) {
                        // Player has 21
                        winChance = dealerTotal === 21 ? 50 : 95;
                      } else if (dealerTotal === 21) {
                        // Dealer has 21, player doesn't
                        winChance = 5;
                      } else if (playerTotal > dealerTotal) {
                        // Player is ahead
                        const lead = playerTotal - dealerTotal;
                        if (lead >= 5) winChance = 85;
                        else if (lead >= 3) winChance = 75;
                        else if (lead >= 1) winChance = 65;
                      } else if (playerTotal === dealerTotal) {
                        // Currently tied - dealer must hit if under 17
                        if (dealerTotal >= 17) {
                          winChance = 50; // Push likely
                        } else {
                          // Dealer will hit, ~35% chance dealer busts
                          winChance = 45;
                        }
                      } else {
                        // Player is behind - must hit to have any chance
                        const deficit = dealerTotal - playerTotal;
                        if (deficit >= 5) winChance = 15;
                        else if (deficit >= 3) winChance = 25;
                        else if (deficit >= 1) winChance = 35;
                      }
                    }

                    const loseChance = 100 - winChance;
                    const winColor = winChance >= 60 ? 'text-green-400' : winChance >= 45 ? 'text-yellow-400' : 'text-red-400';
                    const isDefinitive = isGameResolved && (winChance === 100 || winChance === 0 || winChance === 50);

                    return (
                      <>
                        <div className="flex justify-between items-center">
                          <span className={winColor}>
                            {isDefinitive ? (winChance === 100 ? '🎉 WIN: 100%' : winChance === 0 ? '💀 LOSE: 100%' : '🤝 PUSH') : `WIN: ~${winChance}%`}
                          </span>
                          {!isDefinitive && <span className="text-red-400">LOSE: ~{loseChance}%</span>}
                        </div>
                        <div className="h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isGameResolved && winChance === 100 ? 'bg-gradient-to-r from-green-500 to-green-300' :
                              isGameResolved && winChance === 0 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                              isGameResolved && winChance === 50 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                              'bg-gradient-to-r from-green-500 to-green-400'
                            }`}
                            style={{ width: `${winChance}%` }}
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              {/* Situational tips - considers both player AND dealer hands */}
              {(() => {
                const playerTotal = Number(gameDisplay.playerTotal);
                const dealerTotal = Number(gameDisplay.dealerTotal);
                const status = gameDisplay.status.toLowerCase();

                if (playerTotal <= 0) return null;

                // Check if game is truly resolved - must have canStartNew=true OR status indicates finished
                const isGameResolved = gameDisplay.gameId > 0n && gameDisplay.playerCards.length > 0 && (
                  gameDisplay.canStartNew ||
                  status.includes('win') ||
                  status.includes('lose') ||
                  status.includes('bust') ||
                  status.includes('push') ||
                  status.includes('finished')
                );

                // If game is resolved, show final outcome
                if (isGameResolved) {
                  if (playerTotal > 21) {
                    return <div className="text-red-400 mt-1 font-semibold">💀 RESULT: Player busted - Dealer wins!</div>;
                  } else if (dealerTotal > 21) {
                    return <div className="text-green-400 mt-1 font-semibold">🎉 RESULT: Dealer busted - Player wins!</div>;
                  } else if (playerTotal > dealerTotal) {
                    return <div className="text-green-400 mt-1 font-semibold">🎉 RESULT: Player wins with {playerTotal} vs {dealerTotal}!</div>;
                  } else if (dealerTotal > playerTotal) {
                    return <div className="text-red-400 mt-1 font-semibold">💀 RESULT: Dealer wins with {dealerTotal} vs {playerTotal}!</div>;
                  } else {
                    return <div className="text-yellow-400 mt-1 font-semibold">🤝 RESULT: Push! Both have {playerTotal}.</div>;
                  }
                }

                // Game in progress - show tips
                // Player busted
                if (playerTotal > 21) {
                  return <div className="text-red-400 mt-1">💀 Busted! Game over.</div>;
                }

                // Dealer busted
                if (dealerTotal > 21) {
                  return <div className="text-green-400 mt-1">🎉 Dealer busted! You win!</div>;
                }

                // Player has 21
                if (playerTotal === 21) {
                  return <div className="text-green-400 mt-1">🎰 21! Stand and hope dealer doesn&apos;t match!</div>;
                }

                // Compare hands for advice
                if (playerTotal > dealerTotal) {
                  // Player is winning
                  if (playerTotal >= 17) {
                    return <div className="text-green-400 mt-1">✅ You&apos;re ahead ({playerTotal} vs {dealerTotal})! Standing is smart.</div>;
                  } else {
                    return <div className="text-yellow-400 mt-1">⚠️ Ahead but low ({playerTotal} vs {dealerTotal}). Hit carefully or stand.</div>;
                  }
                } else if (playerTotal === dealerTotal) {
                  // Tied
                  if (playerTotal >= 17) {
                    return <div className="text-yellow-400 mt-1">🤝 Tied at {playerTotal}. Stand for push or risk a hit.</div>;
                  } else {
                    return <div className="text-orange-400 mt-1">🤝 Tied at {playerTotal}. Consider hitting - dealer likely will too.</div>;
                  }
                } else {
                  // Player is losing
                  if (playerTotal <= 11) {
                    return <div className="text-blue-400 mt-1">📈 Behind ({playerTotal} vs {dealerTotal}) - Hit! Can&apos;t bust.</div>;
                  } else if (playerTotal >= 17) {
                    return <div className="text-red-400 mt-1">⚠️ Behind ({playerTotal} vs {dealerTotal}) but hitting risks bust. Tough spot!</div>;
                  } else {
                    return <div className="text-orange-400 mt-1">📉 Behind ({playerTotal} vs {dealerTotal}) - Need to hit but risk busting.</div>;
                  }
                }
              })()}
              {/* Trading window indicator */}
              {clientSecondsUntilCanAct > 0 && (
                <div className="text-purple-300 mt-2 pt-2 border-t border-gray-700">
                  ⏱️ Trading window: <span className="font-bold text-white">{clientSecondsUntilCanAct}s</span> remaining
                </div>
              )}
            </div>
          </div>
        )}

        {/* Waiting for Market / Game ended too quickly */}
        {activeGameId && activeGameId > 0n && !gameDisplay.marketCreated && (
          <div className={`${gameDisplay.canStartNew ? 'bg-gray-800/50 border-gray-600' : 'bg-yellow-900/30 border-yellow-600'} border rounded-xl p-4 text-center`}>
            {gameDisplay.canStartNew ? (
              <>
                <div className="text-gray-300 font-semibold mb-1">⚡ No Market Created</div>
                <div className="text-gray-400 text-sm">
                  This game ended too quickly to start a prediction market
                </div>
              </>
            ) : (
              <>
                <div className="text-yellow-300 font-semibold mb-1">⏳ Market Creating...</div>
                <div className="text-yellow-200 text-sm">
                  The prediction market will be available once the game initializes
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== MAIN APP COMPONENT =====================
export function PredictionJackApp({ onClose, initialGameId }: PredictionJackAppProps) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const { tokenPriceUSD, ethPriceUSD } = useTokenPrice();
  const [navHeight, setNavHeight] = useState(56); // Default header height

  // Smart wallet detection for batch transactions
  const { supportsAtomicBatch: mainSupportsAtomicBatch } = useSmartWallet();
  const {
    executeBatch: mainExecuteBatch,
    isPending: isMainBatchPending,
    isConfirming: isMainBatchConfirming,
    isSuccess: isMainBatchSuccess,
    reset: resetMainBatch,
  } = useBatchTransaction();

  // Subaccounts support for gaming accounts
  const { supportsSubaccounts, subaccounts } = useSubaccounts();

  // Start on game view if initialGameId is provided, otherwise start on live view
  const [view, setView] = useState<ViewMode>(initialGameId ? 'game' : 'live');
  const [selectedGameId, setSelectedGameId] = useState<bigint | null>(initialGameId ?? null);
  const [errorMessage, setErrorMessage] = useState('');

  // Start game slider state
  const [startPaymentMethod, setStartPaymentMethod] = useState<'eth' | 'token'>('eth');
  const [ethAmount, setEthAmount] = useState(0.00069); // Min ETH
  const [tokenAmount, setTokenAmount] = useState(0.1); // Default to 0.1 token (user requested)
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);

  // Slider drag tracking - prevents polling re-renders from interrupting drag
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [localSliderValue, setLocalSliderValue] = useState(0);

  // Staking selection state (for StakingInterface)
  const [selectedSnakesForStaking, setSelectedSnakesForStaking] = useState<Set<number>>(new Set());
  const [selectedStakedSnakes, setSelectedStakedSnakes] = useState<Set<number>>(new Set());

  // Min/Max values for sliders
  const ETH_MIN = 0.00069;
  const ETH_MAX = 0.1;
  const ETH_OPTIMAL = 0.07; // BEST pool threshold
  const TOKEN_MIN = 0.03; // Minimum for good pool liquidity
  const TOKEN_MAX = 10;

  // Slider uses 0-100, with 30% = optimal threshold
  // This makes it easier for users to select amounts in the optimal range
  const OPTIMAL_SLIDER_POSITION = 30;

  // Convert slider position (0-100) to ETH amount (non-linear: 30% = optimal)
  const sliderToEth = (sliderValue: number): number => {
    if (sliderValue <= OPTIMAL_SLIDER_POSITION) {
      // 0-30% maps to ETH_MIN to ETH_OPTIMAL
      const ratio = sliderValue / OPTIMAL_SLIDER_POSITION;
      return ETH_MIN + ratio * (ETH_OPTIMAL - ETH_MIN);
    } else {
      // 30-100% maps to ETH_OPTIMAL to ETH_MAX
      const ratio = (sliderValue - OPTIMAL_SLIDER_POSITION) / (100 - OPTIMAL_SLIDER_POSITION);
      return ETH_OPTIMAL + ratio * (ETH_MAX - ETH_OPTIMAL);
    }
  };

  // Convert ETH amount to slider position (inverse of above)
  const ethToSlider = (ethValue: number): number => {
    if (ethValue <= ETH_OPTIMAL) {
      const ratio = (ethValue - ETH_MIN) / (ETH_OPTIMAL - ETH_MIN);
      return ratio * OPTIMAL_SLIDER_POSITION;
    } else {
      const ratio = (ethValue - ETH_OPTIMAL) / (ETH_MAX - ETH_OPTIMAL);
      return OPTIMAL_SLIDER_POSITION + ratio * (100 - OPTIMAL_SLIDER_POSITION);
    }
  };

  // Token equivalents for optimal threshold (approximated)
  const TOKEN_OPTIMAL = 3; // ~0.07 ETH equivalent at typical prices

  // Convert slider position (0-100) to token amount
  const sliderToToken = (sliderValue: number): number => {
    if (sliderValue <= OPTIMAL_SLIDER_POSITION) {
      const ratio = sliderValue / OPTIMAL_SLIDER_POSITION;
      return TOKEN_MIN + ratio * (TOKEN_OPTIMAL - TOKEN_MIN);
    } else {
      const ratio = (sliderValue - OPTIMAL_SLIDER_POSITION) / (100 - OPTIMAL_SLIDER_POSITION);
      return TOKEN_OPTIMAL + ratio * (TOKEN_MAX - TOKEN_OPTIMAL);
    }
  };

  // Convert token amount to slider position
  const tokenToSlider = (tokenValue: number): number => {
    if (tokenValue <= TOKEN_OPTIMAL) {
      const ratio = (tokenValue - TOKEN_MIN) / (TOKEN_OPTIMAL - TOKEN_MIN);
      return ratio * OPTIMAL_SLIDER_POSITION;
    } else {
      const ratio = (tokenValue - TOKEN_OPTIMAL) / (TOKEN_MAX - TOKEN_OPTIMAL);
      return OPTIMAL_SLIDER_POSITION + ratio * (100 - OPTIMAL_SLIDER_POSITION);
    }
  };

  // Measure navigation height dynamically
  useEffect(() => {
    const nav = document.querySelector('nav');
    if (nav) {
      const updateHeight = () => {
        const height = nav.getBoundingClientRect().height;
        if (height > 0) setNavHeight(height);
      };
      updateHeight();
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }
  }, []);

  // Fetch active games with 1s polling
  const { data: activeGamesData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getActiveGames',
    args: [0n, 30n],
    chainId: base.id,
    query: {
      refetchInterval: 1000,
    },
  });

  const activeGamesResult = activeGamesData as [bigint[], bigint, boolean] | undefined;
  const activeGameIds = activeGamesResult?.[0] || [];
  const totalActiveGames = activeGamesResult?.[1] || 0n;

  // Fetch user's game display
  const { data: gameDisplayData, refetch: refetchGame } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getGameDisplay',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
      refetchInterval: 1000,
    },
  });

  const gameDisplay = gameDisplayData as GameDisplay | undefined;

  // Start game fee
  const { data: startGameFeeData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'startGameFee',
    chainId: base.id,
  });
  const _startGameFee = startGameFeeData ? formatEther(startGameFeeData as bigint) : '0.00069';

  // Token allowance check
  const { data: tokenAllowanceData, refetch: refetchAllowance } = useReadContract({
    address: TOKEN_ADDRESS(base.id),
    abi: contracts.token.abi,
    functionName: 'allowance',
    args: address ? [address, BLACKJACK_ADDRESS(base.id)] : undefined,
    chainId: base.id,
    query: { enabled: !!address },
  });
  const tokenAllowance = (tokenAllowanceData as bigint) || 0n;
  const startGameFeeInTokens = startGameFeeData ? (startGameFeeData as bigint) : parseEther('0.00069');
  const isTokenApproved = tokenAllowance >= startGameFeeInTokens;

  // Transactions
  const { data: approveHash, writeContract: writeApprove, isPending: isApprovePending } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash });

  const { data: startGameHash, writeContract: writeStartGame, isPending: isStartGamePending, error: startGameError } = useWriteContract();
  const { isLoading: isStartGameConfirming, isSuccess: isStartGameConfirmed } = useWaitForTransactionReceipt({ hash: startGameHash });

  const { data: startWithTokensHash, writeContract: writeStartWithTokens, isPending: isStartWithTokensPending } = useWriteContract();
  const { isLoading: isStartWithTokensConfirming, isSuccess: isStartWithTokensConfirmed } = useWaitForTransactionReceipt({ hash: startWithTokensHash });

  // Claimable markets
  const { data: claimableMarketsData } = useReadContract({
    address: PREDICTION_HUB_ADDRESS(base.id),
    abi: contracts.predictionHub.abi,
    functionName: 'getUserClaimableMarkets',
    args: address ? [address, 50n] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
      refetchInterval: 5000,
    },
  });

  const claimableResult = claimableMarketsData as [ClaimableMarket[], bigint] | undefined;
  const claimableMarkets = claimableResult?.[0] || [];
  const totalClaimable = claimableResult?.[1] || 0n;

  useEffect(() => {
    if (isApproveConfirmed) refetchAllowance();
  }, [isApproveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (isStartGameConfirmed || isStartWithTokensConfirmed) {
      // Clear selectedGameId so GameScreen shows the user's own game
      setSelectedGameId(null);
      // Refetch game data then navigate
      refetchGame().then(() => {
        setView('game');
      });
    }
  }, [isStartGameConfirmed, isStartWithTokensConfirmed, refetchGame]);

  useEffect(() => {
    if (startGameError) setErrorMessage(startGameError.message);
  }, [startGameError]);

  // Handle batch transaction success for main component
  useEffect(() => {
    if (isMainBatchSuccess) {
      setSelectedGameId(null);
      refetchAllowance();
      refetchGame().then(() => {
        setView('game');
      });
      resetMainBatch();
    }
  }, [isMainBatchSuccess, refetchAllowance, refetchGame, resetMainBatch]);

  const handleStartGame = () => {
    setErrorMessage('');
    setIsWaitingForVRF(true);
    writeStartGame({
      address: BLACKJACK_ADDRESS(base.id),
      abi: contracts.blackjack.abi,
      functionName: 'startGame',
      args: [],
      value: parseEther(ethAmount.toString()),
    });
  };

  const handleApprove = () => {
    writeApprove({
      address: TOKEN_ADDRESS(base.id),
      abi: contracts.token.abi,
      functionName: 'approve',
      args: [BLACKJACK_ADDRESS(base.id), parseEther('3000')],
    });
  };

  const handleStartWithTokens = () => {
    setErrorMessage('');
    setIsWaitingForVRF(true);
    writeStartWithTokens({
      address: BLACKJACK_ADDRESS(base.id),
      abi: contracts.blackjack.abi,
      functionName: 'startGameWithTokens',
      args: [parseEther(tokenAmount.toString())],
    });
  };

  // Smart wallet: batch approve + startGameWithTokens in single transaction
  const handleApproveAndStartWithTokens = async () => {
    setErrorMessage('');
    setIsWaitingForVRF(true);
    try {
      await mainExecuteBatch([
        {
          address: TOKEN_ADDRESS(base.id),
          abi: contracts.token.abi,
          functionName: 'approve',
          args: [BLACKJACK_ADDRESS(base.id), parseEther('3000')],
        },
        {
          address: BLACKJACK_ADDRESS(base.id),
          abi: contracts.blackjack.abi,
          functionName: 'startGameWithTokens',
          args: [parseEther(tokenAmount.toString())],
        },
      ]);
    } catch {
      setErrorMessage('Transaction failed');
      setIsWaitingForVRF(false);
    }
  };

  const handleGameSelect = useCallback((gameId: bigint) => {
    setSelectedGameId(gameId);
    setView('game');
  }, []);

  // If user has active game, show game view option
  const userHasActiveGame = gameDisplay && !gameDisplay.canStartNew;

  // Tab order: Live Games → Your Game/Start Game → Claim → Stake
  // Tabs are now rendered directly in the JSX for proper ordering

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col bg-gray-900"
      style={{ top: `${navHeight}px` }}
    >
      {/* Tab Buttons Row - Compact, directly under main header */}
      <div className="flex-shrink-0 bg-gray-900 px-0.5 xs:px-1.5 sm:px-4 pt-0.5 xs:pt-1 sm:pt-2">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-0.5 xs:gap-1 sm:gap-2">
            {/* Tab Pills - Order: Live Games → Your Game/Start Game → Claim → Stake */}
            <div className="flex gap-0.5 bg-gray-800/50 p-0.5 rounded-lg xs:rounded-xl overflow-x-auto scrollbar-hide min-w-0">
              {/* Live Games tab */}
              <button
                onClick={() => setView('live')}
                className={`relative px-1 xs:px-1.5 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 font-semibold text-[9px] xs:text-[10px] sm:text-sm transition-all rounded-md xs:rounded-lg whitespace-nowrap flex-shrink-0 ${
                  view === 'live'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span className="hidden sm:inline">🎮 </span><span className="hidden xs:inline">Live </span>Games
              </button>

              {/* Your Game tab (when user has active game) OR Start Game tab (when no active game) */}
              {userHasActiveGame ? (
                <button
                  onClick={() => {
                    setSelectedGameId(null);
                    setView('game');
                  }}
                  className={`px-1 xs:px-1.5 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 font-semibold text-[9px] xs:text-[10px] sm:text-sm transition-all rounded-md xs:rounded-lg whitespace-nowrap flex-shrink-0 ${
                    view === 'game'
                      ? 'bg-green-600 text-white'
                      : 'text-green-400 hover:text-white bg-green-900/30 animate-pulse'
                  }`}
                >
                  <span className="hidden sm:inline">🎯 </span><span className="xs:hidden">You</span><span className="hidden xs:inline">Your Game</span>
                </button>
              ) : (
                <button
                  onClick={() => setView('play')}
                  className={`relative px-1 xs:px-1.5 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 font-semibold text-[9px] xs:text-[10px] sm:text-sm transition-all rounded-md xs:rounded-lg whitespace-nowrap flex-shrink-0 ${
                    view === 'play'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  }`}
                >
                  <span className="hidden sm:inline">▶️ </span><span className="xs:hidden">Start</span><span className="hidden xs:inline">Start Game</span>
                </button>
              )}

              {/* Claim tab */}
              <button
                onClick={() => setView('closed')}
                className={`relative px-1 xs:px-1.5 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 font-semibold text-[9px] xs:text-[10px] sm:text-sm transition-all rounded-md xs:rounded-lg whitespace-nowrap flex-shrink-0 ${
                  view === 'closed'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span className="hidden sm:inline">💰 </span>Claim
                {claimableMarkets.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 xs:w-2 xs:h-2 bg-green-500 rounded-full animate-pulse" />
                )}
              </button>

              {/* Stake tab */}
              <button
                onClick={() => setView('stake')}
                className={`relative px-1 xs:px-1.5 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 font-semibold text-[9px] xs:text-[10px] sm:text-sm transition-all rounded-md xs:rounded-lg whitespace-nowrap flex-shrink-0 ${
                  view === 'stake'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span className="hidden sm:inline">🐍 </span>Stake
              </button>

              {/* Sub Accounts tab - only show if wallet supports subaccounts */}
              {supportsSubaccounts && (
                <button
                  onClick={() => setView('accounts')}
                  className={`relative px-1 xs:px-1.5 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 font-semibold text-[9px] xs:text-[10px] sm:text-sm transition-all rounded-md xs:rounded-lg whitespace-nowrap flex-shrink-0 ${
                    view === 'accounts'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  }`}
                >
                  <span className="hidden sm:inline">👥 </span><span className="xs:hidden">Accts</span><span className="hidden xs:inline">Sub Accts</span>
                  {subaccounts.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 xs:w-4 xs:h-4 bg-green-500 rounded-full text-[8px] xs:text-[10px] flex items-center justify-center">
                      {subaccounts.length}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Right side: Stats + Close */}
            <div className="flex items-center gap-0.5 xs:gap-1 sm:gap-2 flex-shrink-0">
              {/* Token Price Badge */}
              {tokenPriceUSD > 0 && (
                <div className="hidden sm:flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-purple-900/30 rounded-md sm:rounded-lg text-[10px] sm:text-xs">
                  <span className="text-purple-400">{TOKEN_TICKER}</span>
                  <span className="text-white font-semibold">${tokenPriceUSD.toFixed(4)}</span>
                </div>
              )}
              {/* Live Count */}
              <div className="flex items-center gap-0.5 px-0.5 xs:px-1 sm:px-2 py-0.5 xs:py-0.5 sm:py-1 bg-gray-800/50 rounded-md sm:rounded-lg text-[8px] xs:text-[9px] sm:text-xs">
                <span className="text-gray-400 hidden xs:inline">Live:</span>
                <span className="text-green-400 font-bold">{totalActiveGames.toString()}</span>
              </div>
              {/* Claimable Button */}
              {totalClaimable > 0n && (
                <button
                  onClick={() => setView('closed')}
                  className="px-0.5 xs:px-1 sm:px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white text-[8px] xs:text-[9px] sm:text-xs font-semibold rounded-md sm:rounded-lg animate-pulse flex items-center gap-0.5"
                >
                  💰
                  {tokenPriceUSD > 0 && (
                    <span className="hidden xs:inline">${(Number(formatEther(totalClaimable)) * tokenPriceUSD).toFixed(2)}</span>
                  )}
                </button>
              )}
              {/* Help Button - links to main docs page */}
              <Link
                href="/docs"
                className="p-0.5 xs:p-1 sm:p-1.5 hover:bg-purple-900/50 bg-purple-800/30 rounded-md sm:rounded-lg transition-colors text-purple-400 hover:text-purple-300 hidden xs:block"
                aria-label="Help & Documentation"
              >
                <svg className="w-3.5 h-3.5 xs:w-4 xs:h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </Link>
              {/* Close Button */}
              <button
                onClick={onClose}
                className="p-0.5 xs:p-1 sm:p-1.5 hover:bg-red-900/50 bg-red-800/30 rounded-md sm:rounded-lg transition-colors text-red-400 hover:text-red-300"
                aria-label="Close"
              >
                <svg className="w-3.5 h-3.5 xs:w-4 xs:h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-1.5 xs:p-2 sm:p-4">
        <div className="max-w-7xl mx-auto h-full">
          {/* Live Games View */}
          {view === 'live' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">Live Games</h2>
              </div>

              {activeGameIds.length === 0 ? (
                <div className="bg-gray-800/50 rounded-xl p-12 text-center">
                  <div className="text-6xl mb-4">🎰</div>
                  <div className="text-gray-300 text-lg mb-2">No active games</div>
                  <div className="text-gray-500 mb-6">Be the first to start a game!</div>
                  <button
                    onClick={() => setView('play')}
                    className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl"
                  >
                    Start New Game
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeGameIds.map((gameId) => (
                    <EnhancedGameCard
                      key={gameId.toString()}
                      gameId={gameId}
                      onSelect={handleGameSelect}
                      isSelected={selectedGameId === gameId}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Start Game View */}
          {view === 'play' && (
            <div className="max-w-md mx-auto space-y-6">
              {/* Check if user has unclaimed winnings - show claim interface first */}
              {claimableMarkets.length > 0 ? (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-white mb-2">💰 Claim Your Winnings First!</h2>
                    <p className="text-gray-400">
                      You have {claimableMarkets.length} unclaimed {claimableMarkets.length === 1 ? 'reward' : 'rewards'}
                    </p>
                  </div>

                  <div className="bg-green-900/30 border border-green-600 p-4 rounded-xl">
                    <div className="text-center mb-4">
                      <div className="text-green-300 text-lg font-semibold">Total Claimable</div>
                      <div className="text-green-400 text-3xl font-bold">
                        {Number(formatEther(totalClaimable)).toFixed(4)} {TOKEN_TICKER}
                      </div>
                      {tokenPriceUSD > 0 && (
                        <div className="text-green-200 text-sm mt-1">
                          ≈ ${(Number(formatEther(totalClaimable)) * tokenPriceUSD).toFixed(4)} USD
                        </div>
                      )}
                    </div>

                    {/* Individual claim cards */}
                    <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                      {claimableMarkets.map((market) => (
                        <StartPageClaimItem key={market.gameId.toString()} market={market} tokenPriceUSD={tokenPriceUSD} />
                      ))}
                    </div>

                    <button
                      onClick={() => setView('closed')}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-all"
                    >
                      View All Claims →
                    </button>
                  </div>

                  <div className="text-center text-gray-500 text-sm">
                    Claim your winnings to start a new game
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-white mb-2">Start New Game</h2>
                    <p className="text-gray-400">Create a prediction market on your blackjack game</p>
                  </div>

                  {errorMessage && (
                    <div className="bg-red-900/50 border border-red-500 p-3 rounded-lg text-red-200 text-sm">
                      {errorMessage}
                    </div>
                  )}

                  {/* Payment Method Toggle */}
                  <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl">
                    <button
                      onClick={() => setStartPaymentMethod('eth')}
                      className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                        startPaymentMethod === 'eth'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      ETH
                    </button>
                    <button
                      onClick={() => setStartPaymentMethod('token')}
                      className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                        startPaymentMethod === 'token'
                          ? 'bg-purple-600 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {TOKEN_TICKER}
                    </button>
                  </div>

                  {/* Amount Slider with Pool Size Indicator */}
                  <div className="bg-gray-800/50 rounded-xl p-4 space-y-4">
                    {/* Amount Display - shows live value during drag */}
                    <div className="text-center">
                      {(() => {
                        // Show live value during drag for instant feedback
                        const displayEth = isDraggingSlider && startPaymentMethod === 'eth'
                          ? sliderToEth(localSliderValue)
                          : ethAmount;
                        const displayToken = isDraggingSlider && startPaymentMethod === 'token'
                          ? sliderToToken(localSliderValue)
                          : tokenAmount;
                        return (
                          <>
                            <div className="text-3xl font-bold text-white">
                              {startPaymentMethod === 'eth'
                                ? `${displayEth.toFixed(5)} ETH`
                                : `${displayToken.toFixed(2)} ${TOKEN_TICKER}`
                              }
                            </div>
                            {startPaymentMethod === 'eth' && ethPriceUSD > 0 && (
                              <div className="text-gray-400 text-sm">
                                ≈ ${(displayEth * ethPriceUSD).toFixed(4)} USD
                              </div>
                            )}
                            {startPaymentMethod === 'token' && tokenPriceUSD > 0 && (
                              <div className="text-gray-400 text-sm">
                                ≈ ${(displayToken * tokenPriceUSD).toFixed(4)} USD
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Slider - non-linear scale: 30% = optimal threshold */}
                    <div className="space-y-2">
                      {startPaymentMethod === 'eth' ? (
                        <>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={isDraggingSlider ? localSliderValue : ethToSlider(ethAmount)}
                            onPointerDown={(e) => {
                              setIsDraggingSlider(true);
                              setLocalSliderValue(ethToSlider(ethAmount));
                              (e.target as HTMLInputElement).setPointerCapture(e.pointerId);
                            }}
                            onPointerUp={(e) => {
                              setIsDraggingSlider(false);
                              setEthAmount(sliderToEth(localSliderValue));
                              (e.target as HTMLInputElement).releasePointerCapture(e.pointerId);
                            }}
                            onPointerCancel={() => setIsDraggingSlider(false)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setLocalSliderValue(val);
                              if (!isDraggingSlider) setEthAmount(sliderToEth(val));
                            }}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 touch-none"
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{ETH_MIN} ETH</span>
                            <span className="text-purple-400">↑ Optimal ({ETH_OPTIMAL} ETH)</span>
                            <span>{ETH_MAX} ETH</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={isDraggingSlider ? localSliderValue : tokenToSlider(tokenAmount)}
                            onPointerDown={(e) => {
                              setIsDraggingSlider(true);
                              setLocalSliderValue(tokenToSlider(tokenAmount));
                              (e.target as HTMLInputElement).setPointerCapture(e.pointerId);
                            }}
                            onPointerUp={(e) => {
                              setIsDraggingSlider(false);
                              setTokenAmount(sliderToToken(localSliderValue));
                              (e.target as HTMLInputElement).releasePointerCapture(e.pointerId);
                            }}
                            onPointerCancel={() => setIsDraggingSlider(false)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setLocalSliderValue(val);
                              if (!isDraggingSlider) setTokenAmount(sliderToToken(val));
                            }}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500 touch-none"
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{TOKEN_MIN} {TOKEN_TICKER}</span>
                            <span className="text-purple-400">↑ Optimal ({TOKEN_OPTIMAL} {TOKEN_TICKER})</span>
                            <span>{TOKEN_MAX} {TOKEN_TICKER}</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Pool Size Indicator - shows live tier during drag */}
                    {(() => {
                      // Use live values during drag for instant tier feedback
                      const displayEth = isDraggingSlider && startPaymentMethod === 'eth'
                        ? sliderToEth(localSliderValue)
                        : ethAmount;
                      const displayToken = isDraggingSlider && startPaymentMethod === 'token'
                        ? sliderToToken(localSliderValue)
                        : tokenAmount;
                      const usdValue = startPaymentMethod === 'eth'
                        ? displayEth * ethPriceUSD
                        : displayToken * tokenPriceUSD;
                      const poolSize = getPoolSizeByUSD(usdValue);

                      return (
                        <div className={`${poolSize.bgColor} border ${poolSize.borderColor} rounded-lg p-3`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${
                                poolSize === POOL_SIZES.THIN ? 'bg-red-400' :
                                poolSize === POOL_SIZES.MEDIUM ? 'bg-orange-400' :
                                poolSize === POOL_SIZES.GOOD ? 'bg-green-400' :
                                'bg-purple-400'
                              }`} />
                              <span className={`font-semibold ${poolSize.color}`}>
                                {poolSize.label}
                              </span>
                            </div>
                            {poolSize === POOL_SIZES.OPTIMAL && (
                              <span className="text-purple-300 text-xs">🏆 Optimal</span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${poolSize.color} opacity-80`}>
                            {poolSize.description}
                          </p>
                          {/* Show USD value for context */}
                          <p className="text-xs mt-1 text-gray-400">
                            ≈ ${usdValue.toFixed(2)} USD
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Start Button */}
                  <div className="space-y-3">
                    {startPaymentMethod === 'eth' ? (
                      <button
                        onClick={handleStartGame}
                        disabled={isStartGamePending || isStartGameConfirming || !gameDisplay?.canStartNew}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all text-lg"
                      >
                        {isStartGamePending || isStartGameConfirming ? 'Starting...' : `Start Game (${ethAmount.toFixed(5)} ETH)`}
                      </button>
                    ) : !isTokenApproved ? (
                      <button
                        onClick={mainSupportsAtomicBatch ? handleApproveAndStartWithTokens : handleApprove}
                        disabled={isApprovePending || isApproveConfirming || isMainBatchPending || isMainBatchConfirming || !gameDisplay?.canStartNew}
                        className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold rounded-xl transition-all"
                      >
                        {isMainBatchPending || isMainBatchConfirming
                          ? '⚡ Processing...'
                          : isApprovePending || isApproveConfirming
                            ? 'Approving...'
                            : mainSupportsAtomicBatch
                              ? `⚡ Approve & Start (${tokenAmount.toFixed(2)} ${TOKEN_TICKER})`
                              : `Approve ${TOKEN_TICKER} (One-Time)`}
                      </button>
                    ) : (
                      <button
                        onClick={handleStartWithTokens}
                        disabled={isStartWithTokensPending || isStartWithTokensConfirming || !gameDisplay?.canStartNew}
                        className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all text-lg"
                      >
                        {isStartWithTokensPending || isStartWithTokensConfirming ? 'Starting...' : `Start Game (${tokenAmount.toFixed(2)} ${TOKEN_TICKER})`}
                      </button>
                    )}
                  </div>

                </>
              )}
            </div>
          )}

          {/* Game View */}
          {view === 'game' && (
            <GameScreen
              gameId={selectedGameId}
              onBack={() => {
                setSelectedGameId(null);
                setIsWaitingForVRF(false);
                setView('live');
              }}
              isWaitingForVRF={isWaitingForVRF}
              onVRFComplete={() => setIsWaitingForVRF(false)}
              showBackButton={selectedGameId !== null} // Hide back button when viewing own game
            />
          )}

          {/* Closed Games / Claims View */}
          {view === 'closed' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white mb-4">
                Claimable Winnings
                {totalClaimable > 0n && (
                  <span className="ml-2 text-green-400">
                    ({formatEther(totalClaimable)} {TOKEN_TICKER} total)
                  </span>
                )}
              </h2>

              {claimableMarkets.length === 0 ? (
                <div className="bg-gray-800/50 rounded-xl p-12 text-center">
                  <div className="text-6xl mb-4">📭</div>
                  <div className="text-gray-300 text-lg">No claimable winnings</div>
                  <div className="text-gray-500">Play games and win to see claims here</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {claimableMarkets.map((market) => (
                    <ClaimCard key={market.gameId.toString()} market={market} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stake View - Integrated Staking Interface */}
          {view === 'stake' && (
            <div className="space-y-4">
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  🐍 Snake Staking
                </h2>
                <p className="text-purple-300 text-sm mt-1">
                  Stake your snakes to earn {TOKEN_TICKER} rewards from prediction market trading fees.
                </p>
              </div>
              <StakingInterface
                selectedSnakesForStaking={selectedSnakesForStaking}
                setSelectedSnakesForStaking={setSelectedSnakesForStaking}
                selectedStakedSnakes={selectedStakedSnakes}
                setSelectedStakedSnakes={setSelectedStakedSnakes}
              />
            </div>
          )}

          {/* ============ SUB ACCOUNTS VIEW ============ */}
          {view === 'accounts' && supportsSubaccounts && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/30 rounded-xl p-4 mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  👥 Sub Accounts
                </h2>
                <p className="text-blue-300 text-sm mt-1">
                  Create dedicated gaming sub accounts for a seamless, gasless experience in the app.
                </p>
              </div>
              <SubaccountsPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== CLAIM CARD COMPONENT =====================
function ClaimCard({ market }: { market: ClaimableMarket }) {
  const contracts = getContracts(base.id);

  const { writeContract, isPending } = useWriteContract();
  const { data: txHash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleClaim = () => {
    writeContract({
      address: PREDICTION_HUB_ADDRESS(base.id),
      abi: contracts.predictionHub.abi,
      functionName: 'claimWinnings',
      args: [market.gameId],
    });
  };

  const resultLabels = ['Pending', 'Win', 'Lose', 'Push'];
  const resultLabel = resultLabels[market.result] || 'Unknown';

  return (
    <div className="bg-gray-800/80 rounded-xl p-4 border border-gray-700">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-white font-bold">Game #{market.gameId.toString()}</div>
          <div className="text-gray-400 text-xs">
            YES: {(Number(market.yesPrice) / 100).toFixed(1)}% / NO: {(Number(market.noPrice) / 100).toFixed(1)}%
          </div>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-bold ${
          resultLabel === 'Win' ? 'bg-green-500/20 text-green-400' :
          resultLabel === 'Lose' ? 'bg-red-500/20 text-red-400' :
          'bg-gray-700 text-gray-300'
        }`}>
          {resultLabel}
        </span>
      </div>

      <div className="bg-gray-900/50 p-3 rounded-lg mb-3">
        {market.userYesShares > 0n && (
          <div className="flex justify-between text-sm">
            <span className="text-green-400">YES Shares:</span>
            <span className="text-white">{formatEther(market.userYesShares)}</span>
          </div>
        )}
        {market.userNoShares > 0n && (
          <div className="flex justify-between text-sm">
            <span className="text-red-400">NO Shares:</span>
            <span className="text-white">{formatEther(market.userNoShares)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-700 mt-2">
          <span className="text-purple-300">Claimable:</span>
          <span className="text-green-400">{formatEther(market.claimableAmount)}</span>
        </div>
      </div>

      <button
        onClick={handleClaim}
        disabled={isPending || isConfirming || isSuccess}
        className="w-full py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold rounded-lg transition-all"
      >
        {isPending || isConfirming ? 'Claiming...' : isSuccess ? 'Claimed!' : `Claim ${formatEther(market.claimableAmount)}`}
      </button>
    </div>
  );
}

export default PredictionJackApp;
