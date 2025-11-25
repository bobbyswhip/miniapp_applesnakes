'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getContracts, BLACKJACK_ADDRESS, PREDICTION_HUB_ADDRESS, TOKEN_ADDRESS } from '@/config';
import { base } from 'wagmi/chains';
import { formatEther, parseEther, formatUnits, parseUnits } from 'viem';
import Image from 'next/image';
import { Avatar, Name } from '@coinbase/onchainkit/identity';

// Token ticker constant
const TOKEN_TICKER = '$wASS';

// Pool size thresholds and labels (in ETH equivalent)
const POOL_SIZES = {
  THIN: { max: 0.01, color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-500', label: 'Thin Pool', description: 'Low liquidity - may have high slippage' },
  MEDIUM: { max: 0.03, color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-500', label: 'Medium Pool', description: 'Moderate liquidity for trading' },
  DEEP: { max: 0.07, color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-500', label: 'Deep Pool', description: 'Good liquidity for active trading' },
  BEST: { max: Infinity, color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-500', label: 'Best Pool', description: 'Optimal starting ratio for trading volume' },
};

// Get pool size category based on ETH value
function getPoolSize(ethValue: number) {
  if (ethValue <= POOL_SIZES.THIN.max) return POOL_SIZES.THIN;
  if (ethValue <= POOL_SIZES.MEDIUM.max) return POOL_SIZES.MEDIUM;
  if (ethValue <= POOL_SIZES.DEEP.max) return POOL_SIZES.DEEP;
  return POOL_SIZES.BEST;
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

type ViewMode = 'live' | 'play' | 'game' | 'closed';

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
    if (!amount) return;
    const amountInWei = parseUnits(amount, tokenDecimals);
    writeApprove({
      address: TOKEN_ADDRESS(base.id),
      abi: contracts.token.abi,
      functionName: 'approve',
      args: [PREDICTION_HUB_ADDRESS(base.id), amountInWei],
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

  const getButtonText = () => {
    if (isApprovePending || isApproveConfirming) return 'Approving...';
    if (isTxPending || isTxConfirming) return 'Processing...';
    if (needsApproval()) return `Approve ${TOKEN_TICKER}`;
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
      {!compact && <h3 className="text-white font-bold mb-3">📊 Trade Market</h3>}

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
        onClick={needsApproval() ? handleApprove : handleTrade}
        disabled={!amount || !market.tradingActive || isApprovePending || isApproveConfirming || isTxPending || isTxConfirming}
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
  const { tokenPriceUSD } = useTokenPrice();
  const [clientSecondsUntilCanAct, setClientSecondsUntilCanAct] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

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
    }
  }, [isWaitingForVRF, gameDisplay?.playerCards, onVRFComplete]);

  // Check if game is waiting for VRF (no cards yet but game exists)
  const isGameWaitingForVRF = isWaitingForVRF || (
    gameDisplay &&
    gameDisplay.gameId > 0n &&
    gameDisplay.playerCards.length === 0 &&
    gameDisplay.status.toLowerCase().includes('waiting')
  );

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
      <div className="flex-1 flex flex-col bg-gradient-to-b from-green-900/30 to-green-950/50 rounded-2xl p-4">
        {/* Back Button - Only show when viewing other games */}
        {showBackButton && (
          <button
            onClick={onBack}
            className="self-start mb-3 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 rounded-lg text-sm flex items-center gap-2"
          >
            ← Back to Games
          </button>
        )}

        {/* Game Status with Token Price Context */}
        <div className="text-center mb-3">
          <div className="text-purple-300 font-semibold text-lg">{gameDisplay.status}</div>
          {gameDisplay.gameId > 0n && (
            <div className="text-gray-400 text-sm">Game #{gameDisplay.gameId.toString()}</div>
          )}
          {/* Token price context for trading decisions */}
          {tokenPriceUSD > 0 && (
            <div className="text-purple-400 text-xs mt-1">
              {TOKEN_TICKER} = ${tokenPriceUSD.toFixed(4)}
            </div>
          )}
        </div>

        {/* VRF Waiting Info Box */}
        {isGameWaitingForVRF && (
          <div className="bg-purple-900/40 border border-purple-500 p-4 rounded-xl mb-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="animate-spin w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full" />
              <span className="text-purple-200 font-semibold">Waiting for Chainlink VRF</span>
            </div>
            <p className="text-purple-300 text-sm">
              Generating secure random cards... This usually takes 2-3 seconds on Base.
            </p>
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

        {/* Trading Tips Box - Only show when market exists and trading is active */}
        {activeGameId && activeGameId > 0n && gameDisplay.marketCreated && clientSecondsUntilCanAct > 0 && (
          <div className="bg-gray-800/60 rounded-xl p-3 text-xs">
            <div className="text-purple-300 font-semibold mb-2">💡 Trading Tips</div>
            <div className="space-y-1.5 text-gray-300">
              <div>• <span className="text-green-400">YES</span> wins if player beats dealer or dealer busts</div>
              <div>• <span className="text-red-400">NO</span> wins if player busts or dealer wins</div>
              <div>• Current hand: <span className="text-white font-semibold">{gameDisplay.playerTotal}</span> vs Dealer: <span className="text-white font-semibold">{gameDisplay.dealerTotal}</span></div>
              {gameDisplay.playerTotal >= 17 && gameDisplay.playerTotal <= 21 && (
                <div className="text-yellow-400">→ Strong hand! Consider standing.</div>
              )}
              {gameDisplay.playerTotal <= 11 && (
                <div className="text-blue-400">→ Low risk to hit - can&apos;t bust!</div>
              )}
              {gameDisplay.playerTotal >= 12 && gameDisplay.playerTotal <= 16 && (
                <div className="text-orange-400">→ Risky zone - hit could bust!</div>
              )}
            </div>
          </div>
        )}

        {/* Waiting for Market */}
        {activeGameId && activeGameId > 0n && !gameDisplay.marketCreated && (
          <div className="bg-yellow-900/30 border border-yellow-600 rounded-xl p-4 text-center">
            <div className="text-yellow-300 font-semibold mb-1">⏳ Market Creating...</div>
            <div className="text-yellow-200 text-sm">
              The prediction market will be available once the game initializes
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== MAIN APP COMPONENT =====================
export function PredictionJackApp({ onClose }: PredictionJackAppProps) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const { tokenPriceUSD, ethPriceUSD } = useTokenPrice();
  const [navHeight, setNavHeight] = useState(56); // Default header height

  const [view, setView] = useState<ViewMode>('live');
  const [selectedGameId, setSelectedGameId] = useState<bigint | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Start game slider state
  const [startPaymentMethod, setStartPaymentMethod] = useState<'eth' | 'token'>('eth');
  const [ethAmount, setEthAmount] = useState(0.00069); // Min ETH
  const [tokenAmount, setTokenAmount] = useState(0.1); // Default to 0.1 token (user requested)
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);

  // Min/Max values for sliders
  const ETH_MIN = 0.00069;
  const ETH_MAX = 0.1;
  const TOKEN_MIN = 0.03; // Minimum for good pool liquidity
  const TOKEN_MAX = 10;

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

  const handleGameSelect = useCallback((gameId: bigint) => {
    setSelectedGameId(gameId);
    setView('game');
  }, []);

  // If user has active game, show game view option
  const userHasActiveGame = gameDisplay && !gameDisplay.canStartNew;

  // Build tabs based on game state - hide Start tab if user has active game
  const tabs = [
    { key: 'live', label: 'Live Games', icon: '🎮' },
    // Only show Start Game if user doesn't have an active game
    ...(!userHasActiveGame ? [{ key: 'play', label: 'Start Game', icon: '▶️' }] : []),
    { key: 'closed', label: 'Claims', icon: '💰', badge: claimableMarkets.length > 0 },
  ];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col bg-gray-900"
      style={{ top: `${navHeight}px` }}
    >
      {/* Tab Buttons Row - Compact, directly under main header */}
      <div className="flex-shrink-0 bg-gray-900 px-2 sm:px-4 pt-2">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            {/* Tab Pills */}
            <div className="flex gap-1 bg-gray-800/50 p-1 rounded-xl">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setView(tab.key as ViewMode)}
                  className={`relative px-3 py-1.5 font-semibold text-xs sm:text-sm transition-all rounded-lg ${
                    view === tab.key
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  }`}
                >
                  <span className="hidden sm:inline">{tab.icon} </span>{tab.label}
                  {tab.badge && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  )}
                </button>
              ))}
              {/* Your Game tab - always visible when user has active game */}
              {userHasActiveGame && (
                <button
                  onClick={() => {
                    setSelectedGameId(null);
                    setView('game');
                  }}
                  className={`px-3 py-1.5 font-semibold text-xs sm:text-sm transition-all rounded-lg ${
                    view === 'game'
                      ? 'bg-green-600 text-white'
                      : 'text-green-400 hover:text-white bg-green-900/30 animate-pulse'
                  }`}
                >
                  <span className="hidden sm:inline">🎯 </span>Your Game
                </button>
              )}
            </div>

            {/* Right side: Stats + Close */}
            <div className="flex items-center gap-2">
              {/* Token Price Badge */}
              {tokenPriceUSD > 0 && (
                <div className="hidden sm:flex items-center gap-1 px-2 py-1 bg-purple-900/30 rounded-lg text-xs">
                  <span className="text-purple-400">{TOKEN_TICKER}</span>
                  <span className="text-white font-semibold">${tokenPriceUSD.toFixed(4)}</span>
                </div>
              )}
              {/* Live Count */}
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg text-xs">
                <span className="text-gray-400">Live:</span>
                <span className="text-green-400 font-bold">{totalActiveGames.toString()}</span>
              </div>
              {/* Claimable Button */}
              {totalClaimable > 0n && (
                <button
                  onClick={() => setView('closed')}
                  className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg animate-pulse flex items-center gap-1"
                >
                  💰
                  {tokenPriceUSD > 0 && (
                    <span>${(Number(formatEther(totalClaimable)) * tokenPriceUSD).toFixed(2)}</span>
                  )}
                </button>
              )}
              {/* Close Button */}
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-red-900/50 bg-red-800/30 rounded-lg transition-colors text-red-400 hover:text-red-300"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-3 sm:p-4">
        <div className="max-w-7xl mx-auto h-full">
          {/* Live Games View */}
          {view === 'live' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">Live Games</h2>
                <span className="text-gray-400 text-sm">
                  Auto-refreshing every second
                </span>
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
                    {/* Amount Display */}
                    <div className="text-center">
                      <div className="text-3xl font-bold text-white">
                        {startPaymentMethod === 'eth'
                          ? `${ethAmount.toFixed(5)} ETH`
                          : `${tokenAmount.toFixed(2)} ${TOKEN_TICKER}`
                        }
                      </div>
                      {startPaymentMethod === 'eth' && ethPriceUSD > 0 && (
                        <div className="text-gray-400 text-sm">
                          ≈ ${(ethAmount * ethPriceUSD).toFixed(4)} USD
                        </div>
                      )}
                      {startPaymentMethod === 'token' && tokenPriceUSD > 0 && (
                        <div className="text-gray-400 text-sm">
                          ≈ ${(tokenAmount * tokenPriceUSD).toFixed(4)} USD
                        </div>
                      )}
                    </div>

                    {/* Slider */}
                    <div className="space-y-2">
                      {startPaymentMethod === 'eth' ? (
                        <>
                          <input
                            type="range"
                            min={ETH_MIN}
                            max={ETH_MAX}
                            step={0.00001}
                            value={ethAmount}
                            onChange={(e) => setEthAmount(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{ETH_MIN} ETH</span>
                            <span>{ETH_MAX} ETH</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <input
                            type="range"
                            min={TOKEN_MIN}
                            max={TOKEN_MAX}
                            step={0.01}
                            value={tokenAmount}
                            onChange={(e) => setTokenAmount(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{TOKEN_MIN} {TOKEN_TICKER}</span>
                            <span>{TOKEN_MAX} {TOKEN_TICKER}</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Pool Size Indicator */}
                    {(() => {
                      // Calculate ETH equivalent for pool size
                      const ethEquivalent = startPaymentMethod === 'eth'
                        ? ethAmount
                        : (tokenPriceUSD > 0 && ethPriceUSD > 0)
                          ? (tokenAmount * tokenPriceUSD) / ethPriceUSD
                          : tokenAmount * 0.00001; // fallback ratio
                      const poolSize = getPoolSize(ethEquivalent);

                      return (
                        <div className={`${poolSize.bgColor} border ${poolSize.borderColor} rounded-lg p-3`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${
                                poolSize === POOL_SIZES.THIN ? 'bg-red-400' :
                                poolSize === POOL_SIZES.MEDIUM ? 'bg-orange-400' :
                                poolSize === POOL_SIZES.DEEP ? 'bg-green-400' :
                                'bg-purple-400'
                              }`} />
                              <span className={`font-semibold ${poolSize.color}`}>
                                {poolSize.label}
                              </span>
                            </div>
                            {poolSize === POOL_SIZES.BEST && (
                              <span className="text-purple-300 text-xs">🏆 Optimal</span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${poolSize.color} opacity-80`}>
                            {poolSize.description}
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
                        onClick={handleApprove}
                        disabled={isApprovePending || isApproveConfirming}
                        className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold rounded-xl transition-all"
                      >
                        {isApprovePending || isApproveConfirming ? 'Approving...' : `Approve ${TOKEN_TICKER} (One-Time)`}
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

                  {!gameDisplay?.canStartNew && (
                    <div className="bg-yellow-900/30 border border-yellow-600 p-4 rounded-xl text-center">
                      <div className="text-yellow-300 mb-2">You have an active game</div>
                      <button
                        onClick={() => {
                          setSelectedGameId(null); // Clear any selected game to show user's own game
                          setView('game');
                        }}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-lg"
                      >
                        Go to Your Game →
                      </button>
                    </div>
                  )}
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
