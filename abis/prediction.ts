/**
 * Prediction Jack Contract ABI
 *
 * Contract Address: 0xDeCA3b724584169F749078099025eb83a4795DfC
 *
 * Features:
 * - Blackjack game with VRF randomness
 * - Prediction market for game outcomes
 * - Buy/Sell YES/NO shares with ETH or tokens
 * - 1% trading fees to staking contract
 * - Claim winnings after game resolution
 */
export const PREDICTION_ABI = [
  // Game Functions
  {
    inputs: [],
    name: 'startGame',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'hit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'stand',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'cancelStuckGame',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Prediction Market - Buy Functions (Token Approval Required)
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
    ],
    name: 'buyYes',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
    ],
    name: 'buyNo',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Prediction Market - Buy Functions (ETH Payment)
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'buyYesWithETH',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'buyNoWithETH',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },

  // Prediction Market - Sell Functions
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'sharesIn', type: 'uint256' },
    ],
    name: 'sellYes',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'sharesIn', type: 'uint256' },
    ],
    name: 'sellNo',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Claim Functions
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'claimWinnings',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // View Functions - Game Status
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getQuickStatus',
    outputs: [
      { internalType: 'string', name: 'status', type: 'string' },
      { internalType: 'uint8', name: 'playerTotal', type: 'uint8' },
      { internalType: 'uint8', name: 'dealerTotal', type: 'uint8' },
      { internalType: 'bool', name: 'canAct', type: 'bool' },
      { internalType: 'uint256', name: 'tradingPeriodEnds', type: 'uint256' },
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getGameDisplay',
    outputs: [
      {
        components: [
          { internalType: 'string', name: 'status', type: 'string' },
          {
            components: [
              { internalType: 'string', name: 'rank', type: 'string' },
              { internalType: 'string', name: 'suit', type: 'string' },
              { internalType: 'uint8', name: 'value', type: 'uint8' },
            ],
            internalType: 'struct PredictionJack.CardDisplay[]',
            name: 'playerCards',
            type: 'tuple[]',
          },
          { internalType: 'uint8', name: 'playerTotal', type: 'uint8' },
          {
            components: [
              { internalType: 'string', name: 'rank', type: 'string' },
              { internalType: 'string', name: 'suit', type: 'string' },
              { internalType: 'uint8', name: 'value', type: 'uint8' },
            ],
            internalType: 'struct PredictionJack.CardDisplay[]',
            name: 'dealerCards',
            type: 'tuple[]',
          },
          { internalType: 'uint8', name: 'dealerTotal', type: 'uint8' },
          { internalType: 'bool', name: 'canHit', type: 'bool' },
          { internalType: 'bool', name: 'canStand', type: 'bool' },
          { internalType: 'bool', name: 'canStartNew', type: 'bool' },
          { internalType: 'bool', name: 'canCancelStuck', type: 'bool' },
          { internalType: 'bool', name: 'canAdminResolve', type: 'bool' },
          { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
          { internalType: 'uint256', name: 'lastActionAt', type: 'uint256' },
          { internalType: 'uint256', name: 'tradingPeriodEnds', type: 'uint256' },
          { internalType: 'uint256', name: 'secondsUntilCanAct', type: 'uint256' },
          { internalType: 'uint256', name: 'gameId', type: 'uint256' },
        ],
        internalType: 'struct PredictionJack.GameDisplay',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Market Status
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getQuickMarketStatus',
    outputs: [
      { internalType: 'uint256', name: 'totalYesShares', type: 'uint256' },
      { internalType: 'uint256', name: 'totalNoShares', type: 'uint256' },
      { internalType: 'uint256', name: 'totalDeposits', type: 'uint256' },
      { internalType: 'uint256', name: 'maxDeposits', type: 'uint256' },
      { internalType: 'uint256', name: 'yesPrice', type: 'uint256' },
      { internalType: 'uint256', name: 'noPrice', type: 'uint256' },
      { internalType: 'bool', name: 'tradingActive', type: 'bool' },
      { internalType: 'bool', name: 'resolved', type: 'bool' },
      { internalType: 'string', name: 'resultString', type: 'string' },
      { internalType: 'bool', name: 'marketCreated', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'address', name: 'user', type: 'address' },
    ],
    name: 'getMarketDisplay',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'gameId', type: 'uint256' },
          { internalType: 'uint256', name: 'yesSharesTotal', type: 'uint256' },
          { internalType: 'uint256', name: 'noSharesTotal', type: 'uint256' },
          { internalType: 'uint256', name: 'yesDeposits', type: 'uint256' },
          { internalType: 'uint256', name: 'noDeposits', type: 'uint256' },
          { internalType: 'uint256', name: 'totalDeposits', type: 'uint256' },
          { internalType: 'uint256', name: 'maxTotalDeposits', type: 'uint256' },
          { internalType: 'uint256', name: 'yesPrice', type: 'uint256' },
          { internalType: 'uint256', name: 'noPrice', type: 'uint256' },
          { internalType: 'bool', name: 'tradingActive', type: 'bool' },
          { internalType: 'bool', name: 'resolved', type: 'bool' },
          { internalType: 'enum PredictionJack.GameResult', name: 'result', type: 'uint8' },
          { internalType: 'uint256', name: 'userYesShares', type: 'uint256' },
          { internalType: 'uint256', name: 'userNoShares', type: 'uint256' },
          { internalType: 'uint256', name: 'userClaimable', type: 'uint256' },
          { internalType: 'bool', name: 'marketCreated', type: 'bool' },
          { internalType: 'uint256', name: 'volume', type: 'uint256' },
        ],
        internalType: 'struct PredictionJack.MarketDisplay',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'address', name: 'user', type: 'address' },
    ],
    name: 'getClaimableAmount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Player Stats
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getPlayerGameIds',
    outputs: [{ internalType: 'uint256[]', name: 'activeGameIds', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getUnclaimedTokensInMarket',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getStats',
    outputs: [
      { internalType: 'uint256', name: 'gamesPlayed', type: 'uint256' },
      { internalType: 'uint256', name: 'wins', type: 'uint256' },
      { internalType: 'uint256', name: 'losses', type: 'uint256' },
      { internalType: 'uint256', name: 'pushes', type: 'uint256' },
      { internalType: 'uint256', name: 'busts', type: 'uint256' },
      { internalType: 'uint256', name: 'winRate', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getMinStartGameFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Public State Variables
  {
    inputs: [],
    name: 'startGameFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextGameId',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'appleStaking',
    outputs: [{ internalType: 'contract IAppleStaking', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'protocolOwner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'hook',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'poolIdRaw',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: '', type: 'uint256' },
      { internalType: 'address', name: '', type: 'address' },
    ],
    name: 'yesShares',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: '', type: 'uint256' },
      { internalType: 'address', name: '', type: 'address' },
    ],
    name: 'noShares',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensReceived', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'protocolFee', type: 'uint256' },
    ],
    name: 'GameStarted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'initialLiquidityYes', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'initialLiquidityNo', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'maxDeposits', type: 'uint256' },
    ],
    name: 'MarketCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint8', name: 'cardId', type: 'uint8' },
      { indexed: false, internalType: 'string', name: 'rank', type: 'string' },
      { indexed: false, internalType: 'string', name: 'suit', type: 'string' },
    ],
    name: 'PlayerHit',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
    ],
    name: 'PlayerStood',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'result', type: 'string' },
      { indexed: false, internalType: 'uint8', name: 'playerValue', type: 'uint8' },
      { indexed: false, internalType: 'uint8', name: 'dealerValue', type: 'uint8' },
      { indexed: false, internalType: 'enum PredictionJack.GameResult', name: 'marketResult', type: 'uint8' },
    ],
    name: 'GameResolved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint8', name: 'playerValue', type: 'uint8' },
    ],
    name: 'PlayerBusted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'sharesOut', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeAmount', type: 'uint256' },
    ],
    name: 'YesPurchased',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'sharesOut', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeAmount', type: 'uint256' },
    ],
    name: 'NoPurchased',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'claimer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeAmount', type: 'uint256' },
    ],
    name: 'WinningsClaimed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'from', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'feeType', type: 'string' },
    ],
    name: 'TradingFeeCollected',
    type: 'event',
  },

  // New View Functions for Game Listings
  {
    inputs: [
      { internalType: 'uint256', name: 'startIndex', type: 'uint256' },
      { internalType: 'uint256', name: 'count', type: 'uint256' },
    ],
    name: 'getActiveGames',
    outputs: [
      { internalType: 'uint256[]', name: 'gameIds', type: 'uint256[]' },
      { internalType: 'uint256', name: 'totalActive', type: 'uint256' },
      { internalType: 'bool', name: 'hasMore', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'startIndex', type: 'uint256' },
      { internalType: 'uint256', name: 'count', type: 'uint256' },
    ],
    name: 'getInactiveGames',
    outputs: [
      { internalType: 'uint256[]', name: 'gameIds', type: 'uint256[]' },
      { internalType: 'uint256', name: 'totalInactive', type: 'uint256' },
      { internalType: 'bool', name: 'hasMore', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getGameCounts',
    outputs: [
      { internalType: 'uint256', name: 'activeCount', type: 'uint256' },
      { internalType: 'uint256', name: 'inactiveCount', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getGameInfo',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'gameId', type: 'uint256' },
          { internalType: 'address', name: 'player', type: 'address' },
          { internalType: 'enum PredictionJack.HandState', name: 'state', type: 'uint8' },
          { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
          { internalType: 'uint256', name: 'lastActionAt', type: 'uint256' },
          { internalType: 'uint8', name: 'playerTotal', type: 'uint8' },
          { internalType: 'uint8', name: 'dealerTotal', type: 'uint8' },
          { internalType: 'bool', name: 'marketCreated', type: 'bool' },
        ],
        internalType: 'struct PredictionJack.GameInfo',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'gameIdToPlayer',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
