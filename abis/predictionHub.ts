/**
 * Prediction Market Hub Contract ABI
 *
 * Contract Address: 0xaA7959D6396eAFfF60F12AE33136202bbDEeB723
 *
 * Features:
 * - Prediction market management for multiple games
 * - Buy/Sell YES/NO shares with ETH or tokens
 * - 1% trading fees to staking contract
 * - Claim winnings after market resolution
 * - Market tracking (active, resolved, closed)
 */
export const PREDICTION_HUB_ABI = [
  // Market Trading Functions
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
      { internalType: 'bool', name: 'isYes', type: 'bool' },
    ],
    name: 'buyShares',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'uint256', name: 'sharesIn', type: 'uint256' },
      { internalType: 'bool', name: 'isYes', type: 'bool' },
    ],
    name: 'sellShares',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
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
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'claimWinnings',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Market Management Functions (Game Contract Calls)
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'address', name: 'creator', type: 'address' },
      { internalType: 'uint256', name: 'initialLiquidity', type: 'uint256' },
    ],
    name: 'createMarket',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'pauseTrading',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'resumeTrading',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'enum PredictionMarketHub.GameResult', name: 'result', type: 'uint8' },
    ],
    name: 'resolveMarket',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Market Cleanup Functions
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'closeMarketIfEmpty',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256[]', name: 'gameIds', type: 'uint256[]' }],
    name: 'closeMarketsIfEmpty',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // View Functions - Market Status
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'marketExists',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'isMarketActive',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'isMarketResolved',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getMarketStatus',
    outputs: [{ internalType: 'enum PredictionMarketHub.MarketStatus', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Market Data
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
          { internalType: 'uint256', name: 'yesPrice', type: 'uint256' },
          { internalType: 'uint256', name: 'noPrice', type: 'uint256' },
          { internalType: 'bool', name: 'tradingActive', type: 'bool' },
          { internalType: 'bool', name: 'resolved', type: 'bool' },
          {
            internalType: 'enum PredictionMarketHub.GameResult',
            name: 'result',
            type: 'uint8',
          },
          { internalType: 'uint256', name: 'userYesShares', type: 'uint256' },
          { internalType: 'uint256', name: 'userNoShares', type: 'uint256' },
          { internalType: 'uint256', name: 'userClaimable', type: 'uint256' },
          { internalType: 'uint256', name: 'volume', type: 'uint256' },
          { internalType: 'enum PredictionMarketHub.MarketStatus', name: 'status', type: 'uint8' },
        ],
        internalType: 'struct PredictionMarketHub.MarketDisplay',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getMarket',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'gameId', type: 'uint256' },
          { internalType: 'address', name: 'gameContract', type: 'address' },
          { internalType: 'address', name: 'creator', type: 'address' },
          { internalType: 'uint256', name: 'yesSharesTotal', type: 'uint256' },
          { internalType: 'uint256', name: 'noSharesTotal', type: 'uint256' },
          { internalType: 'uint256', name: 'yesDeposits', type: 'uint256' },
          { internalType: 'uint256', name: 'noDeposits', type: 'uint256' },
          { internalType: 'bool', name: 'tradingActive', type: 'bool' },
          { internalType: 'bool', name: 'resolved', type: 'bool' },
          { internalType: 'enum PredictionMarketHub.GameResult', name: 'result', type: 'uint8' },
          { internalType: 'uint256', name: 'initialLiquidity', type: 'uint256' },
          { internalType: 'uint256', name: 'volume', type: 'uint256' },
          { internalType: 'enum PredictionMarketHub.MarketStatus', name: 'status', type: 'uint8' },
        ],
        internalType: 'struct PredictionMarketHub.Market',
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
  {
    inputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'address', name: 'user', type: 'address' },
    ],
    name: 'getUserShares',
    outputs: [
      { internalType: 'uint256', name: 'userYesShares', type: 'uint256' },
      { internalType: 'uint256', name: 'userNoShares', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'getRemainingDeposits',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Market Lists
  {
    inputs: [],
    name: 'getMarketCounts',
    outputs: [
      { internalType: 'uint256', name: 'activeCount', type: 'uint256' },
      { internalType: 'uint256', name: 'resolvedCount', type: 'uint256' },
      { internalType: 'uint256', name: 'closedCount', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'startIndex', type: 'uint256' },
      { internalType: 'uint256', name: 'count', type: 'uint256' },
    ],
    name: 'getActiveMarkets',
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
    name: 'getResolvedMarkets',
    outputs: [
      { internalType: 'uint256[]', name: 'gameIds', type: 'uint256[]' },
      { internalType: 'uint256', name: 'totalResolved', type: 'uint256' },
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
    name: 'getClosedMarkets',
    outputs: [
      { internalType: 'uint256[]', name: 'gameIds', type: 'uint256[]' },
      { internalType: 'uint256', name: 'totalClosed', type: 'uint256' },
      { internalType: 'bool', name: 'hasMore', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // Public State Variables (auto-generated getters)
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'appleStaking',
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
    name: 'protocolOwner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'markets',
    outputs: [
      { internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { internalType: 'address', name: 'gameContract', type: 'address' },
      { internalType: 'address', name: 'creator', type: 'address' },
      { internalType: 'uint256', name: 'yesSharesTotal', type: 'uint256' },
      { internalType: 'uint256', name: 'noSharesTotal', type: 'uint256' },
      { internalType: 'uint256', name: 'yesDeposits', type: 'uint256' },
      { internalType: 'uint256', name: 'noDeposits', type: 'uint256' },
      { internalType: 'bool', name: 'tradingActive', type: 'bool' },
      { internalType: 'bool', name: 'resolved', type: 'bool' },
      { internalType: 'enum PredictionMarketHub.GameResult', name: 'result', type: 'uint8' },
      { internalType: 'uint256', name: 'initialLiquidity', type: 'uint256' },
      { internalType: 'uint256', name: 'volume', type: 'uint256' },
      { internalType: 'enum PredictionMarketHub.MarketStatus', name: 'status', type: 'uint8' },
    ],
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
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'whitelistedGameContracts',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Admin Functions
  {
    inputs: [
      { internalType: 'address', name: 'gameContract', type: 'address' },
      { internalType: 'bool', name: 'status', type: 'bool' },
    ],
    name: 'setWhitelistedGameContract',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address[]', name: 'gameContracts', type: 'address[]' },
      { internalType: 'bool', name: 'status', type: 'bool' },
    ],
    name: 'setWhitelistedGameContractsBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_appleStaking', type: 'address' }],
    name: 'setAppleStaking',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_protocolOwner', type: 'address' }],
    name: 'setProtocolOwner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_hook', type: 'address' }],
    name: 'setHook',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: '_poolIdRaw', type: 'bytes32' }],
    name: 'setPoolId',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'gameContract', type: 'address' },
      { indexed: true, internalType: 'address', name: 'creator', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'initialLiquidity', type: 'uint256' },
    ],
    name: 'MarketCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'bool', name: 'isYes', type: 'bool' },
      { indexed: false, internalType: 'uint256', name: 'tokensIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'sharesOut', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeAmount', type: 'uint256' },
    ],
    name: 'SharesPurchased',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'seller', type: 'address' },
      { indexed: false, internalType: 'bool', name: 'isYes', type: 'bool' },
      { indexed: false, internalType: 'uint256', name: 'sharesIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensOut', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeAmount', type: 'uint256' },
    ],
    name: 'SharesSold',
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
    inputs: [{ indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'TradingPaused',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'TradingResumed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: false, internalType: 'enum PredictionMarketHub.GameResult', name: 'result', type: 'uint8' },
    ],
    name: 'MarketResolved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' }],
    name: 'MarketClosed',
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
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'gameContract', type: 'address' },
      { indexed: false, internalType: 'bool', name: 'status', type: 'bool' },
    ],
    name: 'GameContractWhitelisted',
    type: 'event',
  },

  // Constants
  {
    inputs: [],
    name: 'MANAGER',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'TRADING_FEE_BPS',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'DUST_THRESHOLD',
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
