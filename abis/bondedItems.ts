// BondedItems V4 ABI - ERC1155 Items Contract with Presales + Bonding Curves
// Contract: 0x284Dd31327829238EA419E28B551b093936dD717
// ItemBridge: 0x79Cd9D91d511a976279978752a88972eFb84479A
// Features:
// - Presales with 70% to curve seed, 20% to creator, 10% to stakers
// - V4 Fixed bonding curve math - linear average price calculation
// - 5% trading fee (1% liquidity, 2% creator, 2% stakers)
// - Rare items (admin-only mint, marketplace only)
// - ERC1155 standard transfers
// - 66 total items (49 presale, 17 rare/admin-only)

export const BONDED_ITEMS_ABI = [
  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // Constants
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

  // Admin
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "admins",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },

  // Token Config
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

  // Bonding Curve
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "bondingCurves",
    outputs: [
      { internalType: "uint256", name: "virtualWass", type: "uint256" },
      { internalType: "uint256", name: "virtualTokens", type: "uint256" },
      { internalType: "uint256", name: "realWass", type: "uint256" },
      { internalType: "uint256", name: "circulatingSupply", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Token Stats
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "tokenStats",
    outputs: [
      { internalType: "uint256", name: "totalVolume", type: "uint256" },
      { internalType: "uint256", name: "totalFees", type: "uint256" },
      { internalType: "uint256", name: "totalTrades", type: "uint256" },
      { internalType: "uint256", name: "creatorEarnings", type: "uint256" },
      { internalType: "uint256", name: "stakerRewards", type: "uint256" },
      { internalType: "uint256", name: "liquidityAdded", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Address earnings
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "addressTotalFees",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "addressTokenFees",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },

  // Global Stats
  {
    inputs: [],
    name: "totalPresaleVolume",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalCurveVolume",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalFeesCollected",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalCreatorPayouts",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalStakerRewards",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },

  // ERC1155 Standard
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

  // View Functions
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // V3: quoteBuy now takes amount (tokens to buy) and returns total cost
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "quoteBuy",
    outputs: [
      { internalType: "uint256", name: "wassCost", type: "uint256" },
      { internalType: "uint256", name: "fee", type: "uint256" },
      { internalType: "uint256", name: "totalCost", type: "uint256" },
      { internalType: "uint256", name: "newPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // V3: quoteSell now returns netReturn (after fees)
  {
    inputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "quoteSell",
    outputs: [
      { internalType: "uint256", name: "wassReturn", type: "uint256" },
      { internalType: "uint256", name: "fee", type: "uint256" },
      { internalType: "uint256", name: "netReturn", type: "uint256" },
      { internalType: "uint256", name: "newPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // V3: Concentrated liquidity curve info
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getCurveInfo",
    outputs: [
      { internalType: "uint256", name: "sqrtPriceLower", type: "uint256" },
      { internalType: "uint256", name: "sqrtPriceUpper", type: "uint256" },
      { internalType: "uint256", name: "sqrtPriceCurrent", type: "uint256" },
      { internalType: "uint256", name: "currentPrice", type: "uint256" },
      { internalType: "uint256", name: "startPrice", type: "uint256" },
      { internalType: "uint256", name: "endPrice", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
      { internalType: "uint256", name: "realWass", type: "uint256" },
      { internalType: "uint256", name: "baseWassReserve", type: "uint256" },
      { internalType: "uint256", name: "maxTokens", type: "uint256" },
      { internalType: "uint256", name: "tokensSold", type: "uint256" },
      { internalType: "uint256", name: "tokensAvailable", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "getTokenInfo",
    outputs: [
      { internalType: "address", name: "creator", type: "address" },
      { internalType: "uint256", name: "presalePrice", type: "uint256" },
      { internalType: "uint256", name: "presaleSupply", type: "uint256" },
      { internalType: "uint256", name: "presaleSold", type: "uint256" },
      { internalType: "uint8", name: "phase", type: "uint8" },
      { internalType: "uint256", name: "currentPrice", type: "uint256" },
      { internalType: "uint256", name: "curveRealWass", type: "uint256" },
      { internalType: "uint256", name: "curveCirculatingSupply", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getGlobalStats",
    outputs: [
      { internalType: "uint256", name: "_totalPresaleVolume", type: "uint256" },
      { internalType: "uint256", name: "_totalCurveVolume", type: "uint256" },
      { internalType: "uint256", name: "_totalFeesCollected", type: "uint256" },
      { internalType: "uint256", name: "_totalCreatorPayouts", type: "uint256" },
      { internalType: "uint256", name: "_totalStakerRewards", type: "uint256" },
      { internalType: "uint256", name: "_totalTokens", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ERC1155 Transfers
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

  // Presale
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

  // Bonding Curve - V3: Specify token amount to buy, not wASS amount
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

  // Admin
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

  // Emergency
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

  // ERC4906 Metadata Update
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "MetadataUpdate",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint256", name: "_fromTokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "_toTokenId", type: "uint256" },
    ],
    name: "BatchMetadataUpdate",
    type: "event",
  },

  // Admin Events
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
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: "string", name: "newUri", type: "string" }],
    name: "BaseURIUpdated",
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
      { indexed: false, internalType: "uint256", name: "toCreator", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "toStakers", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "toCurve", type: "uint256" },
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
      { indexed: false, internalType: "uint256", name: "tokensSeeded", type: "uint256" },
    ],
    name: "PresaleEnded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "virtualWass", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "virtualTokens", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "initialPrice", type: "uint256" },
    ],
    name: "BondingCurveInitialized",
    type: "event",
  },

  // Trading Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "buyer", type: "address" },
      { indexed: false, internalType: "uint256", name: "tokensBought", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "wassPaid", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "fee", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newPrice", type: "uint256" },
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
      { indexed: false, internalType: "uint256", name: "newPrice", type: "uint256" },
    ],
    name: "CurveSell",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "toLiquidity", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "toCreator", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "toStakers", type: "uint256" },
    ],
    name: "FeeDistributed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "RareItemMinted",
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
  { inputs: [], name: "PresaleNotActive", type: "error" },
  { inputs: [], name: "PresaleAlreadyEnded", type: "error" },
  { inputs: [], name: "PresaleSoldOut", type: "error" },
  { inputs: [], name: "BondingCurveNotActive", type: "error" },
  { inputs: [], name: "TokenNotFound", type: "error" },
  { inputs: [], name: "RareItemNotTradeable", type: "error" },
  { inputs: [], name: "SlippageExceeded", type: "error" },
  { inputs: [], name: "InvalidAmount", type: "error" },
  { inputs: [], name: "ArrayLengthMismatch", type: "error" },
  { inputs: [], name: "NotApproved", type: "error" },
] as const;
