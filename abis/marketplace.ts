// Marketplace ABI - AppleSnakesMarketplace contract v3
// Contract: 0xd006C1970AAcffcCAcAf6180Ad24081CdE608e82
// V3 Change: Fees now go to stakers via AppleStaking.addRewards()

export const MARKETPLACE_ABI = [
  // View functions
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
    name: "MIN_LISTING_PRICE",
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
    inputs: [],
    name: "appleStaking",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "protocolOwner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeBps",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "approvedCollections",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "collectionList",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "collectionCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "listings",
    outputs: [
      { internalType: "address", name: "seller", type: "address" },
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalListings",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSales",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalVolumeWass",
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
    name: "totalFeesToStakers",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // getListing
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "getListing",
    outputs: [
      { internalType: "address", name: "seller", type: "address" },
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
      { internalType: "bool", name: "isApproved", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getListingsBatch
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
    ],
    name: "getListingsBatch",
    outputs: [
      { internalType: "address[]", name: "sellers", type: "address[]" },
      { internalType: "uint256[]", name: "prices", type: "uint256[]" },
      { internalType: "bool[]", name: "actives", type: "bool[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // quoteEthForListing
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "quoteEthForListing",
    outputs: [
      { internalType: "uint256", name: "ethNeeded", type: "uint256" },
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getCollections
  {
    inputs: [
      { internalType: "uint256", name: "start", type: "uint256" },
      { internalType: "uint256", name: "limit", type: "uint256" },
    ],
    name: "getCollections",
    outputs: [
      { internalType: "address[]", name: "collections", type: "address[]" },
      { internalType: "bool[]", name: "approved", type: "bool[]" },
      { internalType: "uint256", name: "total", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getStats (v3 - order matches contract)
  {
    inputs: [],
    name: "getStats",
    outputs: [
      { internalType: "uint256", name: "_totalListings", type: "uint256" },
      { internalType: "uint256", name: "_totalSales", type: "uint256" },
      { internalType: "uint256", name: "_totalVolumeWass", type: "uint256" },
      { internalType: "uint256", name: "_totalFeesCollected", type: "uint256" },
      { internalType: "uint256", name: "_totalFeesToStakers", type: "uint256" },
      { internalType: "uint256", name: "_feeBps", type: "uint256" },
      { internalType: "uint256", name: "_collectionCount", type: "uint256" },
      { internalType: "uint256", name: "_activeListingCount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // activeListingCount (v2)
  {
    inputs: [],
    name: "activeListingCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // getActiveListings (v2) - paginated view
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "offset", type: "uint256" },
      { internalType: "uint256", name: "limit", type: "uint256" },
    ],
    name: "getActiveListings",
    outputs: [
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "address[]", name: "sellers", type: "address[]" },
      { internalType: "uint256[]", name: "prices", type: "uint256[]" },
      { internalType: "uint256", name: "total", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // getActiveListingCount (v2) - count per collection
  {
    inputs: [{ internalType: "address", name: "collection", type: "address" }],
    name: "getActiveListingCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // getAllActiveListings (v2) - paginated across all collections
  {
    inputs: [
      { internalType: "uint256", name: "offset", type: "uint256" },
      { internalType: "uint256", name: "limit", type: "uint256" },
    ],
    name: "getAllActiveListings",
    outputs: [
      { internalType: "address[]", name: "collections", type: "address[]" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "address[]", name: "sellers", type: "address[]" },
      { internalType: "uint256[]", name: "prices", type: "uint256[]" },
      { internalType: "uint256", name: "total", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // cleanupStaleListings (v2)
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
    ],
    name: "cleanupStaleListings",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Write functions
  // list
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "price", type: "uint256" },
    ],
    name: "list",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // listBatch
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256[]", name: "tokenIds", type: "uint256[]" },
      { internalType: "uint256", name: "price", type: "uint256" },
    ],
    name: "listBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // unlist
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "unlist",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // updatePrice
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "newPrice", type: "uint256" },
    ],
    name: "updatePrice",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // buyWithWass
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "buyWithWass",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // buyWithEth
  {
    inputs: [
      { internalType: "address", name: "collection", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "minWassOut", type: "uint256" },
    ],
    name: "buyWithEth",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // V3 Admin functions
  {
    inputs: [{ internalType: "address", name: "_appleStaking", type: "address" }],
    name: "setAppleStaking",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_protocolOwner", type: "address" }],
    name: "setProtocolOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
    ],
    name: "CollectionApproved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
    ],
    name: "CollectionRemoved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "seller", type: "address" },
      { indexed: false, internalType: "uint256", name: "price", type: "uint256" },
    ],
    name: "Listed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "seller", type: "address" },
    ],
    name: "Unlisted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "oldSeller", type: "address" },
      { indexed: false, internalType: "address", name: "newSeller", type: "address" },
    ],
    name: "ListingOverwritten",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "oldPrice", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newPrice", type: "uint256" },
    ],
    name: "PriceUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "collection", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: true, internalType: "address", name: "buyer", type: "address" },
      { indexed: false, internalType: "address", name: "seller", type: "address" },
      { indexed: false, internalType: "uint256", name: "price", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "fee", type: "uint256" },
      { indexed: false, internalType: "bool", name: "paidWithEth", type: "bool" },
    ],
    name: "Sold",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint256", name: "oldFee", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "newFee", type: "uint256" },
    ],
    name: "FeeUpdated",
    type: "event",
  },
  // V3 Staking Events
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "StakingRewards",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "address", name: "oldStaking", type: "address" },
      { indexed: false, internalType: "address", name: "newStaking", type: "address" },
    ],
    name: "StakingContractUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "address", name: "oldOwner", type: "address" },
      { indexed: false, internalType: "address", name: "newOwner", type: "address" },
    ],
    name: "ProtocolOwnerUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "address", name: "recipient", type: "address" },
    ],
    name: "StakingFallback",
    type: "event",
  },
  // Errors
  {
    inputs: [],
    name: "NotOwner",
    type: "error",
  },
  {
    inputs: [],
    name: "NotSeller",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroAddress",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroAmount",
    type: "error",
  },
  {
    inputs: [],
    name: "CollectionNotApproved",
    type: "error",
  },
  {
    inputs: [],
    name: "CollectionAlreadyApproved",
    type: "error",
  },
  {
    inputs: [],
    name: "ListingNotActive",
    type: "error",
  },
  {
    inputs: [],
    name: "ListingExists",
    type: "error",
  },
  {
    inputs: [],
    name: "PriceTooLow",
    type: "error",
  },
  {
    inputs: [],
    name: "InsufficientPayment",
    type: "error",
  },
  {
    inputs: [],
    name: "TransferFailed",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidFee",
    type: "error",
  },
  {
    inputs: [],
    name: "NotApprovedForTransfer",
    type: "error",
  },
  {
    inputs: [],
    name: "ReentrancyGuard",
    type: "error",
  },
] as const;
