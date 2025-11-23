'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getContracts, PREDICTION_ADDRESS } from '@/config';
import { base } from 'wagmi/chains';
import { formatEther, parseEther } from 'viem';
import Image from 'next/image';
import { BuyMarketModal } from './BuyMarketModal';

interface BlackjackInterfaceProps {
  onClose: () => void;
}

interface LiveGameCardProps {
  gameId: bigint;
  onOpenMarket: (gameId: bigint) => void;
}

type TabType = 'play' | 'games';

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
}

// Component to display a single live game card
function LiveGameCard({ gameId, onOpenMarket }: LiveGameCardProps) {
  const contracts = getContracts(base.id);

  // Fetch game info
  const { data: gameInfoData } = useReadContract({
    address: PREDICTION_ADDRESS(base.id),
    abi: contracts.prediction.abi,
    functionName: 'getGameInfo',
    args: [gameId],
    chainId: base.id,
  });

  const gameInfo = gameInfoData as any;

  if (!gameInfo) {
    return (
      <div className="bg-gray-800/50 p-4 rounded-lg animate-pulse">
        <div className="h-16 bg-gray-700/50 rounded"></div>
      </div>
    );
  }

  const stateNames = ['Inactive', 'Dealing', 'Active', 'Hitting', 'Standing', 'Busted', 'Finished'];
  const stateName = stateNames[Number(gameInfo.state)] || 'Unknown';

  return (
    <div
      className="bg-gray-800/50 p-4 rounded-lg border border-gray-700 hover:border-purple-500 transition-all cursor-pointer"
      onClick={() => gameInfo.marketCreated && onOpenMarket(gameId)}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-white font-semibold">Game #{gameId.toString()}</div>
          <div className="text-xs text-gray-400">
            Player: {gameInfo.player.slice(0, 6)}...{gameInfo.player.slice(-4)}
          </div>
        </div>
        <div className={`px-2 py-1 rounded text-xs font-semibold ${
          stateName === 'Active' ? 'bg-green-900/50 text-green-300' :
          stateName === 'Dealing' ? 'bg-yellow-900/50 text-yellow-300' :
          stateName === 'Busted' ? 'bg-red-900/50 text-red-300' :
          'bg-gray-700/50 text-gray-300'
        }`}>
          {stateName}
        </div>
      </div>

      <div className="flex gap-4 text-sm items-center">
        <div>
          <div className="text-gray-400 text-xs">Player</div>
          <div className="text-white font-bold">{gameInfo.playerTotal.toString()}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs">Dealer</div>
          <div className="text-white font-bold">{gameInfo.dealerTotal.toString()}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {gameInfo.marketCreated && (
            <>
              <div className="text-xs text-purple-300">
                📊 Market Active
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMarket(gameId);
                }}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded transition-all"
              >
                Trade
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function BlackjackInterface({ onClose }: BlackjackInterfaceProps) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);

  const [activeTab, setActiveTab] = useState<TabType>('play');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedMarketGameId, setSelectedMarketGameId] = useState<bigint | null>(null);

  // Fetch start game fee
  const { data: startGameFeeData } = useReadContract({
    address: PREDICTION_ADDRESS(base.id),
    abi: contracts.prediction.abi,
    functionName: 'startGameFee',
    chainId: base.id,
  });
  const startGameFee = startGameFeeData ? formatEther(startGameFeeData as bigint) : '0.00069';

  // Fetch current game display
  const { data: gameDisplayData, refetch: refetchGame } = useReadContract({
    address: PREDICTION_ADDRESS(base.id),
    abi: contracts.prediction.abi,
    functionName: 'getGameDisplay',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
      refetchInterval: 3000, // Refetch every 3 seconds
    },
  });

  const gameDisplay = gameDisplayData as GameDisplay | undefined;

  // Fetch claimable winnings for current user
  // Check if user has claimable winnings from their last game
  const { data: claimableData, refetch: refetchClaimable } = useReadContract({
    address: PREDICTION_ADDRESS(base.id),
    abi: contracts.prediction.abi,
    functionName: 'getClaimableAmount',
    args: gameDisplay?.gameId && gameDisplay.gameId > 0n && address ? [gameDisplay.gameId, address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!gameDisplay && gameDisplay.gameId > 0n && !!address,
      refetchInterval: 3000, // Refetch every 3 seconds
    },
  });

  const claimableAmount = claimableData as bigint | undefined;

  // Fetch player stats
  const { data: statsData } = useReadContract({
    address: PREDICTION_ADDRESS(base.id),
    abi: contracts.prediction.abi,
    functionName: 'getStats',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const stats = (statsData as unknown as bigint[]) || [0n, 0n, 0n, 0n, 0n, 0n];
  const gamesPlayed = stats[0] || 0n;
  const wins = stats[1] || 0n;
  const losses = stats[2] || 0n;
  const pushes = stats[3] || 0n;
  const busts = stats[4] || 0n;
  const winRate = stats[5] || 0n;

  // Fetch active games for Live Games tab
  const { data: activeGamesData, refetch: refetchActiveGames } = useReadContract({
    address: PREDICTION_ADDRESS(base.id),
    abi: contracts.prediction.abi,
    functionName: 'getActiveGames',
    args: [0n, 20n], // Start at 0, fetch 20 games
    chainId: base.id,
    query: {
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });

  const activeGamesResult = activeGamesData as [bigint[], bigint, boolean] | undefined;
  const activeGameIds = activeGamesResult?.[0] || [];
  const totalActiveGames = activeGamesResult?.[1] || 0n;

  // Start game transaction
  const {
    data: startGameHash,
    writeContract: writeStartGame,
    isPending: isStartGamePending,
    error: startGameError
  } = useWriteContract();

  const {
    isLoading: isStartGameConfirming,
    isSuccess: isStartGameConfirmed
  } = useWaitForTransactionReceipt({ hash: startGameHash });

  // Hit transaction
  const {
    data: hitHash,
    writeContract: writeHit,
    isPending: isHitPending,
    error: hitError
  } = useWriteContract();

  const {
    isLoading: isHitConfirming,
    isSuccess: isHitConfirmed
  } = useWaitForTransactionReceipt({ hash: hitHash });

  // Stand transaction
  const {
    data: standHash,
    writeContract: writeStand,
    isPending: isStandPending,
    error: standError
  } = useWriteContract();

  const {
    isLoading: isStandConfirming,
    isSuccess: isStandConfirmed
  } = useWaitForTransactionReceipt({ hash: standHash });

  // Claim winnings transaction
  const {
    data: claimHash,
    writeContract: writeClaim,
    isPending: isClaimPending,
    error: claimError
  } = useWriteContract();

  const {
    isLoading: isClaimConfirming,
    isSuccess: isClaimConfirmed
  } = useWaitForTransactionReceipt({ hash: claimHash });

  // Refetch game after successful transactions
  useEffect(() => {
    if (isStartGameConfirmed || isHitConfirmed || isStandConfirmed || isClaimConfirmed) {
      refetchGame();
      refetchClaimable();
    }
  }, [isStartGameConfirmed, isHitConfirmed, isStandConfirmed, isClaimConfirmed, refetchGame, refetchClaimable]);

  // Handle errors
  useEffect(() => {
    if (startGameError) {
      setErrorMessage(startGameError.message);
    } else if (hitError) {
      setErrorMessage(hitError.message);
    } else if (standError) {
      setErrorMessage(standError.message);
    } else if (claimError) {
      setErrorMessage(claimError.message);
    }
  }, [startGameError, hitError, standError, claimError]);

  const handleStartGame = () => {
    if (!address) return;
    setErrorMessage('');

    writeStartGame({
      address: PREDICTION_ADDRESS(base.id),
      abi: contracts.prediction.abi,
      functionName: 'startGame',
      args: [],
      value: parseEther(startGameFee),
    });
  };

  const handleHit = () => {
    if (!address) return;
    setErrorMessage('');

    writeHit({
      address: PREDICTION_ADDRESS(base.id),
      abi: contracts.prediction.abi,
      functionName: 'hit',
      args: [],
    });
  };

  const handleStand = () => {
    if (!address) return;
    setErrorMessage('');

    writeStand({
      address: PREDICTION_ADDRESS(base.id),
      abi: contracts.prediction.abi,
      functionName: 'stand',
      args: [],
    });
  };

  const handleClaimWinnings = () => {
    if (!address || !gameDisplay?.gameId) return;
    setErrorMessage('');

    writeClaim({
      address: PREDICTION_ADDRESS(base.id),
      abi: contracts.prediction.abi,
      functionName: 'claimWinnings',
      args: [gameDisplay.gameId],
    });
  };

  const renderCard = (card: CardDisplay, index: number) => {
    // Map suits to image files and colors
    const suitImages: { [key: string]: string } = {
      'Hearts': '/Images/Heart2.png',      // Red heart
      'Diamonds': '/Images/Diamond2.png',  // Red diamond
      'Clubs': '/Images/Clover.png',       // Black clover
      'Spades': '/Images/Spade.png'        // Black spade
    };

    const suitColors: { [key: string]: string } = {
      'Hearts': '#dc2626',    // Red
      'Diamonds': '#dc2626',  // Red
      'Clubs': '#1f2937',     // Black
      'Spades': '#1f2937'     // Black
    };

    const suitImage = suitImages[card.suit] || '/Images/Spade.png';
    const textColor = suitColors[card.suit] || '#1f2937';

    return (
      <div
        key={index}
        className="relative"
        style={{
          width: '90px',
          height: '126px',
          marginRight: '-25px',
        }}
      >
        {/* Card background */}
        <div className="absolute inset-0 rounded-xl shadow-2xl overflow-hidden border-2 border-gray-300">
          <Image
            src="/Images/Card.png"
            alt="Card background"
            fill
            style={{ objectFit: 'cover' }}
            className="brightness-110"
          />
        </div>

        {/* Card content */}
        <div className="absolute inset-0 flex flex-col items-center justify-between p-2">
          {/* Top rank and suit */}
          <div className="flex flex-col items-center gap-0.5" style={{ color: textColor }}>
            <span className="text-lg font-bold leading-none" style={{
              textShadow: '0.5px 0.5px 1px rgba(255, 255, 255, 0.8)',
              fontFamily: 'Georgia, serif',
              fontSize: '1.1rem'
            }}>
              {card.rank}
            </span>
            <div className="relative w-4 h-4">
              <Image
                src={suitImage}
                alt={card.suit}
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
          </div>

          {/* Center suit image */}
          <div className="relative w-10 h-10">
            <Image
              src={suitImage}
              alt={card.suit}
              fill
              style={{ objectFit: 'contain' }}
              className="opacity-75"
            />
          </div>

          {/* Bottom rank and suit (upside down) */}
          <div className="flex flex-col items-center gap-0.5 rotate-180" style={{ color: textColor }}>
            <span className="text-lg font-bold leading-none" style={{
              textShadow: '0.5px 0.5px 1px rgba(255, 255, 255, 0.8)',
              fontFamily: 'Georgia, serif',
              fontSize: '1.1rem'
            }}>
              {card.rank}
            </span>
            <div className="relative w-4 h-4">
              <Image
                src={suitImage}
                alt={card.suit}
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 cursor-pointer"
        style={{
          zIndex: 99,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed"
        style={{
          zIndex: 100,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'clamp(280px, 92vw, 600px)',
          maxHeight: '90vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(168, 85, 247, 0.08), rgba(99, 102, 241, 0.05))',
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          border: '2px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '16px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 50px rgba(139, 92, 246, 0.3), 0 0 100px rgba(168, 85, 247, 0.2), inset 0 0 30px rgba(168, 85, 247, 0.05)',
          padding: '20px',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-red-400 transition-colors text-2xl font-bold z-10"
          style={{
            textShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
          }}
        >
          ✕
        </button>

      {/* Title */}
      <h2
        className="text-3xl font-bold text-center mb-6"
        style={{
          color: '#fff',
          textShadow: '0 0 20px rgba(168, 85, 247, 0.8)',
        }}
      >
        Prediction Jack
      </h2>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('play')}
          className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
            activeTab === 'play'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Play Game
        </button>
        <button
          onClick={() => setActiveTab('games')}
          className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
            activeTab === 'games'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Live Games
        </button>
      </div>

      {/* Claimable winnings alert */}
      {claimableAmount && claimableAmount > 0n && (
        <div className="mb-4 p-4 bg-green-900/50 border border-green-500 rounded-lg">
          <div className="text-green-200 font-semibold mb-2">
            💰 Winnings Available!
          </div>
          <div className="text-green-100 text-sm mb-3">
            You have {formatEther(claimableAmount)} tokens to claim from your previous game.
            <br />
            <span className="text-yellow-300">You must claim these before starting a new game.</span>
          </div>
          <button
            onClick={handleClaimWinnings}
            disabled={isClaimPending || isClaimConfirming}
            className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all"
          >
            {isClaimPending || isClaimConfirming ? 'Claiming...' : 'Claim Winnings'}
          </button>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-200 text-sm">
          {errorMessage}
        </div>
      )}

      {/* Play Tab */}
      {activeTab === 'play' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-800/50 p-4 rounded-lg text-center">
              <div className="text-gray-400 text-sm">Games</div>
              <div className="text-2xl font-bold text-white">{gamesPlayed.toString()}</div>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg text-center">
              <div className="text-gray-400 text-sm">Wins</div>
              <div className="text-2xl font-bold text-green-400">{wins.toString()}</div>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg text-center">
              <div className="text-gray-400 text-sm">Win Rate</div>
              <div className="text-2xl font-bold text-purple-400">{winRate.toString()}%</div>
            </div>
          </div>

          {/* Game status */}
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <div className="text-center text-lg font-semibold text-purple-300 mb-4">
              {gameDisplay?.status || 'No active game'}
            </div>

            {/* Dealer hand */}
            {gameDisplay && gameDisplay.dealerCards.length > 0 && (
              <div className="mb-6">
                <div className="text-gray-400 text-sm mb-2">Dealer: {gameDisplay.dealerTotal}</div>
                <div className="flex justify-center items-center">
                  {gameDisplay.dealerCards.map((card, i) => renderCard(card, i))}
                </div>
              </div>
            )}

            {/* Player hand */}
            {gameDisplay && gameDisplay.playerCards.length > 0 && (
              <div>
                <div className="text-gray-400 text-sm mb-2">Player: {gameDisplay.playerTotal}</div>
                <div className="flex justify-center items-center">
                  {gameDisplay.playerCards.map((card, i) => renderCard(card, i))}
                </div>
              </div>
            )}
          </div>

          {/* Trading period timer */}
          {gameDisplay && gameDisplay.secondsUntilCanAct > 0n && (
            <div className="bg-blue-900/50 border border-blue-500 p-3 rounded-lg text-center">
              <div className="text-blue-200 text-sm">Trading period active</div>
              <div className="text-white font-bold">{gameDisplay.secondsUntilCanAct.toString()}s until you can act</div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-4">
            {gameDisplay?.canStartNew && (
              <button
                onClick={handleStartGame}
                disabled={isStartGamePending || isStartGameConfirming || !!(claimableAmount && claimableAmount > 0n)}
                className="flex-1 py-3 px-6 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all"
                title={claimableAmount && claimableAmount > 0n ? 'Claim your winnings first' : ''}
              >
                {isStartGamePending || isStartGameConfirming ? 'Starting...' : `Start Game (${startGameFee} ETH)`}
              </button>
            )}

            {gameDisplay?.canHit && (
              <button
                onClick={handleHit}
                disabled={isHitPending || isHitConfirming}
                className="flex-1 py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all"
              >
                {isHitPending || isHitConfirming ? 'Hitting...' : 'Hit'}
              </button>
            )}

            {gameDisplay?.canStand && (
              <button
                onClick={handleStand}
                disabled={isStandPending || isStandConfirming}
                className="flex-1 py-3 px-6 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all"
              >
                {isStandPending || isStandConfirming ? 'Standing...' : 'Stand'}
              </button>
            )}
          </div>

          {/* Game info with market button */}
          {gameDisplay && gameDisplay.gameId > 0n && (
            <div className="bg-gray-800/50 p-3 rounded-lg">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-400">
                  Game ID: #{gameDisplay.gameId.toString()}
                </div>
                <button
                  onClick={() => setSelectedMarketGameId(gameDisplay.gameId)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-all"
                >
                  View Market
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Games Tab */}
      {activeTab === 'games' && (
        <div className="space-y-4">
          {/* Active games count */}
          <div className="bg-gray-800/50 p-3 rounded-lg text-center">
            <div className="text-purple-300 font-semibold">
              {totalActiveGames.toString()} Active Game{totalActiveGames !== 1n ? 's' : ''}
            </div>
          </div>

          {/* Games list */}
          {activeGameIds.length === 0 ? (
            <div className="bg-gray-800/50 p-6 rounded-lg text-center">
              <div className="text-gray-400 mb-2">No active games right now</div>
              <div className="text-sm text-gray-500">
                Start a game to be the first player!
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {activeGameIds.map((gameId) => (
                <LiveGameCard
                  key={gameId.toString()}
                  gameId={gameId}
                  onOpenMarket={setSelectedMarketGameId}
                />
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Buy/Sell Market Modal */}
      {selectedMarketGameId && (
        <BuyMarketModal
          gameId={selectedMarketGameId}
          onClose={() => setSelectedMarketGameId(null)}
        />
      )}
    </>
  );
}
