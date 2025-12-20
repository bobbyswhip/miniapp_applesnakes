// BondedItems V7 ABI - ERC1155 Items with CPMM + Dynamic Fees
// Contract: 0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd
// ItemBridge V7: 0x8EeDb52cb6B9e34f02Cf66Bfd98Ba6b475aCE21b
//
// V7 KEY CHANGES:
// - Dynamic fees: 1% to 20% based on reserve ratio
// - Fee distribution: 30% creator, 70% stakers (was 40/40/20)
// - CPMM bonding curve (x * y = k) replaces sqrt price interpolation
// - New quote functions return feeBps and slippageBps
// - Enhanced events with fee breakdown
// - New getFeeInfo() and calculateDynamicFee() view functions

export const BONDED_ITEMS_V7_ABI = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [],
    name: "WASS",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "OTC_ROUTER",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "STAKING",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextTokenId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V7: DYNAMIC FEE CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [],
    name: "MIN_FEE_BPS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_FEE_BPS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MID_FEE_BPS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },

  // Admin
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "admins",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TOKEN CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "tokenConfigs",
    outputs: [
      { internalType: "address", name: "creator", type: "address" },
      { internalType: "uint256", name: "presalePrice", type: "uint256" },
      { internalType: "uint256", name: "presaleSupply", type: "uint256" },
      { internalType: "uint256", name: "presaleSold", type: "uint256" },
      { internalType: "uint256", name: "presaleWassCollected", type: "uint256" },
      { internalType: "uint8", name: "phase", type: "uint8" },
      { internalType: "bool", name: "exists", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V7: CPMM CURVE DATA (replaces sqrt price curve)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "curves",
    outputs: [
      { internalType: "uint256", name: "virtualTokenReserve", type: "uint256" },
      { internalType: "uint256", name: "wassReserve", type: "uint256" },
      { internalType: "uint256", name: "k", type: "uint256" },
      { internalType: "uint256", name: "initialTokenReserve", type: "uint256" },
      { internalType: "uint256", name: "initialWassReserve", type: "uint256" },
      { internalType: "uint256", name: "minTokenReserve", type: "uint256" },
      { internalType: "uint256", name: "minWassReserve", type: "uint256" },
      { internalType: "int256", name: "position", type: "int256" },
      { internalType: "uint256", name: "adminMinted", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V7: ENHANCED ITEM STATS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "itemStats",
    outputs: [
      { internalType: "uint256", name: "totalVolume", type: "uint256" },
      { internalType: "uint256", name: "totalBuyVolume", type: "uint256" },
      { internalType: "uint256", name: "totalSellVolume", type: "uint256" },
      { internalType: "uint256", name: "totalFees", type: "uint256" },
      { internalType: "uint256", name: "totalBuys", type: "uint256" },
      { internalType: "uint256", name: "totalSells", type: "uint256" },
      { internalType: "uint256", name: "creatorEarnings", type: "uint256" },
      { internalType: "uint256", name: "stakerRewards", type: "uint256" },
      { internalType: "uint256", name: "highPrice", type: "uint256" },
      { internalType: "uint256", name: "lowPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERC1155 STANDARD VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "uri",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "account", type: "address" },
      { internalType: "uint256", name: "id", type: "uint256" },
    ],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "accounts", type: "address[]" },
      { internalType: "uint256[]", name: "ids", type: "uint256[]" },
    ],
    name: "balanceOfBatch",
    outputs: [{ internalType: "uint256[]", name: "balances", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "account", type: "address" },
      { internalType: "address", name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes4", name: "interfaceId", type: "bytes4" }],
    name: "supportsInterface",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "pure",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V7: DYNAMIC FEE VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "calculateDynamicFee",
    outputs: [{ internalType: "uint256", name: "feeBps", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getFeeInfo",
    outputs: [
      { internalType: "uint256", name: "currentFeeBps", type: "uint256" },
      { internalType: "uint256", name: "reserveRatio", type: "uint256" },
      { internalType: "uint256", name: "creatorShareBps", type: "uint256" },
      { internalType: "uint256", name: "stakerShareBps", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRICE & QUOTE FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getCurrentPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },

  // V7: quoteBuy now returns slippageBps and feeBps
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "tokenAmount", type: "uint256" },
    ],
    name: "quoteBuy",
    outputs: [
      { internalType: "uint256", name: "wassCost", type: "uint256" },
      { internalType: "uint256", name: "fee", type: "uint256" },
      { internalType: "uint256", name: "totalCost", type: "uint256" },
      { internalType: "uint256", name: "newPrice", type: "uint256" },
      { internalType: "uint256", name: "slippageBps", type: "uint256" },
      { internalType: "uint256", name: "feeBps", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // V7: quoteSell now returns slippageBps and feeBps
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "tokenAmount", type: "uint256" },
    ],
    name: "quoteSell",
    outputs: [
      { internalType: "uint256", name: "wassReturn", type: "uint256" },
      { internalType: "uint256", name: "fee", type: "uint256" },
      { internalType: "uint256", name: "netReturn", type: "uint256" },
      { internalType: "uint256", name: "newPrice", type: "uint256" },
      { internalType: "uint256", name: "slippageBps", type: "uint256" },
      { internalType: "uint256", name: "feeBps", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // V7: CPMM curve info with full details
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getCurveInfo",
    outputs: [
      { internalType: "uint256", name: "virtualTokenReserve", type: "uint256" },
      { internalType: "uint256", name: "wassReserve", type: "uint256" },
      { internalType: "uint256", name: "k", type: "uint256" },
      { internalType: "uint256", name: "currentPrice", type: "uint256" },
      { internalType: "int256", name: "position", type: "int256" },
      { internalType: "uint256", name: "initialTokenReserve", type: "uint256" },
      { internalType: "uint256", name: "initialWassReserve", type: "uint256" },
      { internalType: "uint256", name: "minTokenReserve", type: "uint256" },
      { internalType: "uint256", name: "minWassReserve", type: "uint256" },
      { internalType: "uint256", name: "adminMinted", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // V7: Pool reserves helper
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getPoolReserves",
    outputs: [
      { internalType: "uint256", name: "tokensInPool", type: "uint256" },
      { internalType: "uint256", name: "wassInPool", type: "uint256" },
      { internalType: "uint256", name: "pricePerToken", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // V7: Enhanced item stats
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getItemStats",
    outputs: [
      { internalType: "uint256", name: "totalVolume", type: "uint256" },
      { internalType: "uint256", name: "totalBuyVolume", type: "uint256" },
      { internalType: "uint256", name: "totalSellVolume", type: "uint256" },
      { internalType: "uint256", name: "totalFees", type: "uint256" },
      { internalType: "uint256", name: "totalBuys", type: "uint256" },
      { internalType: "uint256", name: "totalSells", type: "uint256" },
      { internalType: "uint256", name: "creatorEarnings", type: "uint256" },
      { internalType: "uint256", name: "stakerRewards", type: "uint256" },
      { internalType: "uint256", name: "highPrice", type: "uint256" },
      { internalType: "uint256", name: "lowPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // V7: Enhanced global stats
  {
    inputs: [],
    name: "getGlobalStats",
    outputs: [
      { internalType: "uint256", name: "totalPresaleVolume", type: "uint256" },
      { internalType: "uint256", name: "totalCurveVolume", type: "uint256" },
      { internalType: "uint256", name: "totalBuyVolume", type: "uint256" },
      { internalType: "uint256", name: "totalSellVolume", type: "uint256" },
      { internalType: "uint256", name: "totalFeesCollected", type: "uint256" },
      { internalType: "uint256", name: "totalCreatorPayouts", type: "uint256" },
      { internalType: "uint256", name: "totalStakerRewards", type: "uint256" },
      { internalType: "uint256", name: "totalBuys", type: "uint256" },
      { internalType: "uint256", name: "totalSells", type: "uint256" },
      { internalType: "uint256", name: "totalTokens", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERC1155 WRITE FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [
      { internalType: "address", name: "operator", type: "address" },
      { internalType: "bool", name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "from", type: "address" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "id", type: "uint256" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "safeTransferFrom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "from", type: "address" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256[]", name: "ids", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "safeBatchTransferFrom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESALE FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "buyPresaleWithWass",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "minWassOut", type: "uint256" },
    ],
    name: "buyPresaleWithEth",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BONDING CURVE TRADING FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "tokenAmount", type: "uint256" },
      { internalType: "uint256", name: "maxWassIn", type: "uint256" },
    ],
    name: "buyFromCurve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "tokenAmount", type: "uint256" },
      { internalType: "uint256", name: "minWassFromSwap", type: "uint256" },
    ],
    name: "buyFromCurveWithEth",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "tokenAmount", type: "uint256" },
      { internalType: "uint256", name: "minWassOut", type: "uint256" },
    ],
    name: "sellToCurve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    inputs: [
      { internalType: "address", name: "admin", type: "address" },
      { internalType: "bool", name: "status", type: "bool" },
    ],
    name: "setAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "newUri", type: "string" }],
    name: "setBaseURI",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "creator", type: "address" },
      { internalType: "uint256", name: "presalePrice", type: "uint256" },
      { internalType: "uint256", name: "presaleSupply", type: "uint256" },
    ],
    name: "createToken",
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "creator", type: "address" }],
    name: "createRareItem",
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "endPresaleEarly",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "adminMint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "tos", type: "address[]" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "adminMintBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "wassAmount", type: "uint256" },
    ],
    name: "addLiquidity",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // Emergency
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "emergencyPauseCurve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "resumeCurve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "emergencyWithdrawETH",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "emergencyWithdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ERC1155 Standard Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "operator", type: "address" },
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "id", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "TransferSingle",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "operator", type: "address" },
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256[]", name: "ids", type: "uint256[]" },
      { indexed: false, internalType: "uint256[]", name: "values", type: "uint256[]" },
    ],
    name: "TransferBatch",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "account", type: "address" },
      { indexed: true, internalType: "address", name: "operator", type: "address" },
      { indexed: false, internalType: "bool", name: "approved", type: "bool" },
    ],
    name: "ApprovalForAll",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "string", name: "value", type: "string" },
      { indexed: true, internalType: "uint256", name: "id", type: "uint256" },
    ],
    name: "URI",
    type: "event",
  },

  // Token Lifecycle Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "creator", type: "address" },
      { indexed: false, internalType: "uint256", name: "presalePrice", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "presaleSupply", type: "uint256" },
      { indexed: false, internalType: "bool", name: "isRareItem", type: "bool" },
    ],
    name: "TokenCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "buyer", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassSpent", type: "uint256" },
    ],
    name: "PresalePurchase",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "totalSold", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassSeeded", type: "uint256" },
    ],
    name: "PresaleEnded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "virtualTokenReserve", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassReserve", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "k", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "initialPrice", type: "uint256" },
    ],
    name: "CPMMInitialized",
    type: "event",
  },

  // V7: Enhanced trading events with fee breakdown
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "buyer", type: "address" },
      { indexed: false, internalType: "uint256", name: "tokensBought", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassPaid", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "fee", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "feeRateBps", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "creatorShare", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "stakerShare", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newPrice", type: "uint256" },
      { indexed: false, internalType: "int256", name: "newPosition", type: "int256" },
      { indexed: false, internalType: "uint256", name: "newTokenReserve", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newWassReserve", type: "uint256" },
    ],
    name: "CurveBuy",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "seller", type: "address" },
      { indexed: false, internalType: "uint256", name: "tokensSold", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassReceived", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "fee", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "feeRateBps", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "creatorShare", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "stakerShare", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newPrice", type: "uint256" },
      { indexed: false, internalType: "int256", name: "newPosition", type: "int256" },
      { indexed: false, internalType: "uint256", name: "newTokenReserve", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newWassReserve", type: "uint256" },
    ],
    name: "CurveSell",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassAdded", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "tokensAdded", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newK", type: "uint256" },
    ],
    name: "LiquidityAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "AdminMint",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "admin", type: "address" },
      { indexed: false, internalType: "bool", name: "status", type: "bool" },
    ],
    name: "AdminUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "oldOwner", type: "address" },
      { indexed: true, internalType: "address", name: "newOwner", type: "address" },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERRORS
  // ═══════════════════════════════════════════════════════════════════════════

  { inputs: [], name: "NotOwner", type: "error" },
  { inputs: [], name: "NotAdmin", type: "error" },
  { inputs: [], name: "ZeroAddress", type: "error" },
  { inputs: [], name: "ZeroAmount", type: "error" },
  { inputs: [], name: "ReentrancyGuard", type: "error" },
  { inputs: [], name: "TransferFailed", type: "error" },
  { inputs: [], name: "InsufficientBalance", type: "error" },
  { inputs: [], name: "InsufficientPayment", type: "error" },
  { inputs: [], name: "InsufficientLiquidity", type: "error" },
  { inputs: [], name: "PresaleNotActive", type: "error" },
  { inputs: [], name: "PresaleSoldOut", type: "error" },
  { inputs: [], name: "BondingCurveNotActive", type: "error" },
  { inputs: [], name: "TokenNotFound", type: "error" },
  { inputs: [], name: "SlippageExceeded", type: "error" },
  { inputs: [], name: "ArrayLengthMismatch", type: "error" },
  { inputs: [], name: "NotApproved", type: "error" },
  { inputs: [], name: "CurveExhausted", type: "error" },
  { inputs: [], name: "ExceedsAvailable", type: "error" },
  { inputs: [], name: "MaxTradeExceeded", type: "error" },
  { inputs: [], name: "MinReserveViolation", type: "error" },
] as const;

// V7 ItemBridge ABI
export const ITEM_BRIDGE_V7_ABI = [
  // Core Functions
  {
    inputs: [
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "bridgeIn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "requestWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Admin Functions
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "bridgeOut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "emergencyMint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // View Functions
  {
    inputs: [],
    name: "bondedItems",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "bridgedBalance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256", name: "requestId", type: "uint256" },
    ],
    name: "withdrawRequests",
    outputs: [
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bool", name: "processed", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserWithdrawRequestCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "admins",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { indexed: false, internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "ItemsBridgedIn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "uint256", name: "requestId", type: "uint256" },
      { indexed: false, internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { indexed: false, internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "WithdrawRequested",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { indexed: false, internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "ItemsBridgedOut",
    type: "event",
  },
] as const;
