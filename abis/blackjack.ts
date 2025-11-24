/**
 * Blackjack Contract ABI
 *
 * Contract Address: 0xECa714C994fA917883f78f7e3af0cB5B9EEabdf7
 *
 * Features:
 * - Blackjack game with VRF randomness
 * - Game state management (hit, stand, cancel)
 * - Start game with ETH or tokens
 * - Integrates with PredictionMarketHub for market creation
 */
export const BLACKJACK_ABI = [
  // Game Functions
  {
    inputs: [],
    name: 'startGame',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenAmount', type: 'uint256' }],
    name: 'startGameWithTokens',
    outputs: [],
    stateMutability: 'nonpayable',
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
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'forceResolvePush',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // View Functions - Game Display
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

  // View Functions - Game Info and Lists
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getGameInfo',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'gameId', type: 'uint256' },
          { internalType: 'address', name: 'player', type: 'address' },
          {
            internalType: 'enum PredictionJack.HandState',
            name: 'state',
            type: 'uint8',
          },
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
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getPlayerGameIds',
    outputs: [{ internalType: 'uint256[]', name: 'gameIds', type: 'uint256[]' }],
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
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getPlayerHand',
    outputs: [{ internalType: 'uint8[]', name: '', type: 'uint8[]' }],
    stateMutability: 'view',
    type: 'function',
  },

  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getDealerHand',
    outputs: [{ internalType: 'uint8[]', name: '', type: 'uint8[]' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Public State Variables (auto-generated getters)
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
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'games',
    outputs: [
      { internalType: 'address', name: 'player', type: 'address' },
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
      { internalType: 'uint256', name: 'lastActionAt', type: 'uint256' },
      { internalType: 'uint256', name: 'vrfRequestTime', type: 'uint256' },
      { internalType: 'uint256', name: 'tradingPeriodEnds', type: 'uint256' },
      { internalType: 'uint256', name: 'tokensHeld', type: 'uint256' },
      { internalType: 'enum PredictionJack.HandState', name: 'state', type: 'uint8' },
      { internalType: 'bool', name: 'marketCreated', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'playerStats',
    outputs: [
      { internalType: 'uint256', name: 'gamesPlayed', type: 'uint256' },
      { internalType: 'uint256', name: 'wins', type: 'uint256' },
      { internalType: 'uint256', name: 'losses', type: 'uint256' },
      { internalType: 'uint256', name: 'pushes', type: 'uint256' },
      { internalType: 'uint256', name: 'busts', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'isAdmin',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'vrfConfig',
    outputs: [
      { internalType: 'uint256', name: 'subscriptionId', type: 'uint256' },
      { internalType: 'uint32', name: 'callbackGasLimit', type: 'uint32' },
      { internalType: 'uint16', name: 'requestConfirmations', type: 'uint16' },
      { internalType: 'uint256', name: 'vrfFee', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'bjConfig',
    outputs: [
      { internalType: 'uint256', name: 'gameExpiryDelay', type: 'uint256' },
      { internalType: 'uint256', name: 'minActionDelay', type: 'uint256' },
      { internalType: 'uint256', name: 'vrfTimeout', type: 'uint256' },
      { internalType: 'uint256', name: 'tradingDelay', type: 'uint256' },
      { internalType: 'uint256', name: 'gameAbandonmentPeriod', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // Admin Functions
  {
    inputs: [
      { internalType: 'uint256', name: 'subscriptionId', type: 'uint256' },
      { internalType: 'uint32', name: 'callbackGasLimit', type: 'uint32' },
      { internalType: 'uint16', name: 'requestConfirmations', type: 'uint16' },
    ],
    name: 'setVrfConfig',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameExpiryDelay', type: 'uint256' },
      { internalType: 'uint256', name: 'minActionDelay', type: 'uint256' },
      { internalType: 'uint256', name: 'vrfTimeout', type: 'uint256' },
      { internalType: 'uint256', name: 'tradingDelay', type: 'uint256' },
      { internalType: 'uint256', name: 'gameAbandonmentPeriod', type: 'uint256' },
    ],
    name: 'setBjConfig',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'fee', type: 'uint256' }],
    name: 'setStartGameFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'h', type: 'address' }],
    name: 'setHook',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
    name: 'setPoolId',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'admin', type: 'address' },
      { internalType: 'bool', name: 'status', type: 'bool' },
    ],
    name: 'setAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
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
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensForGame', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'protocolFee', type: 'uint256' },
    ],
    name: 'GameStartedWithTokens',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'initialLiquidity', type: 'uint256' },
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
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'reason', type: 'string' },
    ],
    name: 'GameCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'admin', type: 'address' },
      { indexed: false, internalType: 'string', name: 'reason', type: 'string' },
    ],
    name: 'GameForceResolved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'endsAt', type: 'uint256' },
    ],
    name: 'TradingPeriodStarted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensRefunded', type: 'uint256' },
    ],
    name: 'InstantWinRefund',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensRefunded', type: 'uint256' },
    ],
    name: 'DealerBlackjack',
    type: 'event',
  },

  // Constants
  {
    inputs: [],
    name: 'COORDINATOR',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'KEY_HASH',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'NUM_WORDS',
    outputs: [{ internalType: 'uint32', name: '', type: 'uint32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'NATIVE_PAYMENT',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MANAGER',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MARKET_HUB',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'START_GAME_PROTOCOL_FEE_BPS',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Receive and Fallback
  {
    stateMutability: 'payable',
    type: 'receive',
  },
  {
    stateMutability: 'payable',
    type: 'fallback',
  },
] as const;
