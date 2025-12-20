// abis/predictionMarketV2.ts
// TokenWarsPredictionMarket V2 - On-Chain Contract ABI
// Contract: 0xCC71e190c8209C29421345C95F43591391413204 on Base Mainnet

export const PREDICTION_MARKET_V2_ABI = [
  // ============================================================================
  // VIEW FUNCTIONS
  // ============================================================================

  // Market Info
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "getMarket",
    outputs: [
      { name: "warId", type: "bytes32" },
      { name: "marketType", type: "uint8" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
      { name: "resolvedAt", type: "uint256" },
      { name: "totalDeposits", type: "uint256" },
      { name: "numOutcomes", type: "uint8" },
      { name: "winningOutcome", type: "uint8" },
      { name: "creator", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "getMarketInfo",
    outputs: [
      { name: "warId", type: "bytes32" },
      { name: "marketTypeNum", type: "uint8" },
      { name: "statusNum", type: "uint8" },
      { name: "totalDeposits", type: "uint256" },
      { name: "numOutcomes", type: "uint8" },
      { name: "winningOutcome", type: "uint8" },
      { name: "outcomeTotalShares", type: "uint256[]" },
      { name: "outcomeTotalDeposits", type: "uint256[]" },
      { name: "outcomePrices", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // User Position Info
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    name: "getUserMarketInfo",
    outputs: [
      { name: "shares", type: "uint256[]" },
      { name: "depositedAmounts", type: "uint256[]" },
      { name: "claimed", type: "bool[]" },
      { name: "potentialPayouts", type: "uint256[]" },
      { name: "claimableAmount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
      { name: "outcomeIndex", type: "uint8" },
    ],
    name: "getUserPosition",
    outputs: [
      { name: "shares", type: "uint256" },
      { name: "depositedAmount", type: "uint256" },
      { name: "claimed", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    name: "getUserAllPositions",
    outputs: [
      { name: "shares", type: "uint256[]" },
      { name: "depositedAmounts", type: "uint256[]" },
      { name: "claimedStatus", type: "bool[]" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Outcome Info
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
    ],
    name: "getOutcomePool",
    outputs: [
      { name: "totalShares", type: "uint256" },
      { name: "totalDeposits", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "getAllOutcomePools",
    outputs: [
      { name: "shares", type: "uint256[]" },
      { name: "deposits", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
    ],
    name: "getOutcomePrice",
    outputs: [{ name: "priceBps", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "getAllOutcomePrices",
    outputs: [{ name: "prices", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },

  // Estimation Functions
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
      { name: "wassAmount", type: "uint256" },
    ],
    name: "estimateSharesOut",
    outputs: [
      { name: "sharesOut", type: "uint256" },
      { name: "fee", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
      { name: "sharesToSell", type: "uint256" },
    ],
    name: "estimateTokensOut",
    outputs: [
      { name: "wassOut", type: "uint256" },
      { name: "fee", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    name: "estimatePayout",
    outputs: [{ name: "potentialPayout", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },

  // Query Functions
  {
    inputs: [{ name: "warId", type: "bytes32" }],
    name: "getMarketsByWarId",
    outputs: [{ name: "marketIds", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    name: "getClaimableAmount",
    outputs: [{ name: "claimable", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "isMarketResolved",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getTotalMarkets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextMarketId",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalFeesCollected",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalFeesToStaking",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "admins",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },

  // ETH Quote
  {
    inputs: [{ name: "ethIn", type: "uint256" }],
    name: "quoteETHForWASS",
    outputs: [
      { name: "swapPortion", type: "uint256" },
      { name: "otcPortion", type: "uint256" },
      { name: "otcAvailable", type: "uint256" },
      { name: "hasOtc", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ============================================================================
  // WRITE FUNCTIONS
  // ============================================================================

  // Market Creation
  {
    inputs: [
      { name: "warId", type: "bytes32" },
      { name: "marketType", type: "uint8" },
      { name: "initialLiquidity", type: "uint256" },
    ],
    name: "createMarket",
    outputs: [{ name: "marketId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "warId", type: "bytes32" },
      { name: "marketType", type: "uint8" },
      { name: "minWassOut", type: "uint256" },
    ],
    name: "createMarketWithETH",
    outputs: [{ name: "marketId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },

  // Trading
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
      { name: "wassAmount", type: "uint256" },
    ],
    name: "buyShares",
    outputs: [{ name: "sharesReceived", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
      { name: "minWassOut", type: "uint256" },
    ],
    name: "buySharesWithETH",
    outputs: [{ name: "sharesReceived", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcomeIndex", type: "uint8" },
      { name: "sharesToSell", type: "uint256" },
    ],
    name: "sellShares",
    outputs: [{ name: "wassReceived", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },

  // Claims
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "claimWinnings",
    outputs: [{ name: "payout", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "claimRefund",
    outputs: [{ name: "refund", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },

  // Admin Functions
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "winningOutcome", type: "uint8" },
    ],
    name: "resolveMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "closeMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "admin", type: "address" },
      { name: "status", type: "bool" },
    ],
    name: "setAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ============================================================================
  // EVENTS
  // ============================================================================
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "warId", type: "bytes32" },
      { indexed: false, name: "marketType", type: "uint8" },
      { indexed: false, name: "numOutcomes", type: "uint8" },
      { indexed: false, name: "creator", type: "address" },
    ],
    name: "MarketCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: false, name: "outcomeIndex", type: "uint8" },
      { indexed: false, name: "wassAmount", type: "uint256" },
      { indexed: false, name: "sharesReceived", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "SharesPurchased",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "outcomeIndex", type: "uint8" },
      { indexed: false, name: "sharesSold", type: "uint256" },
      { indexed: false, name: "wassReceived", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "SharesSold",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "warId", type: "bytes32" },
      { indexed: false, name: "winningOutcome", type: "uint8" },
      { indexed: false, name: "totalPayout", type: "uint256" },
    ],
    name: "MarketResolved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "outcomeIndex", type: "uint8" },
      { indexed: false, name: "payout", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "WinningsClaimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "ethAmount", type: "uint256" },
      { indexed: false, name: "wassReceived", type: "uint256" },
    ],
    name: "ETHSwappedToWASS",
    type: "event",
  },
] as const;

export default PREDICTION_MARKET_V2_ABI;
