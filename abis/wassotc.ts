/**
 * wASS OTC Router Contract ABI
 * Two-hop router: ETH → wASS (OTC hybrid) → Token (V4)
 * Contract: 0xD39bcE42ad5Cf7704e74206aD9551206fa0aD98a
 */
export const WASSOTC_ABI = [
  // Constants
  {
    inputs: [],
    name: 'MANAGER',
    outputs: [{ internalType: 'contract IPoolManagerExt', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WASS',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WTOKENS',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'NFT_CONTRACT',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // State variables
  {
    inputs: [],
    name: 'owner',
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
    name: 'otcFeeBps',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'otcBps',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'otcBalance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalRevenue',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSwapVolume',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalOtcVolume',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalFeesCollected',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Main swap function (ETH → wASS only)
  {
    inputs: [{ internalType: 'uint256', name: 'minWassOut', type: 'uint256' }],
    name: 'swap',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // Two-hop swap (ETH → wASS → Token)
  {
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'currency0', type: 'address' },
          { internalType: 'Currency', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'contract IHooks', name: 'hooks', type: 'address' },
        ],
        internalType: 'struct PoolKey',
        name: 'outputPoolKey',
        type: 'tuple',
      },
      { internalType: 'uint256', name: 'minWassOut', type: 'uint256' },
      { internalType: 'uint256', name: 'minTokenOut', type: 'uint256' },
      { internalType: 'bool', name: 'wassIsToken0', type: 'bool' },
    ],
    name: 'swapToToken',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // Buy NFTs directly with ETH
  {
    inputs: [
      { internalType: 'uint256', name: 'count', type: 'uint256' },
      { internalType: 'uint256', name: 'minWassOut', type: 'uint256' },
    ],
    name: 'buyNFT',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // Quote function (updated return values)
  {
    inputs: [{ internalType: 'uint256', name: 'ethIn', type: 'uint256' }],
    name: 'quote',
    outputs: [
      { internalType: 'uint256', name: 'swapPortion', type: 'uint256' },
      { internalType: 'uint256', name: 'otcPortion', type: 'uint256' },
      { internalType: 'uint256', name: 'otcAvailable', type: 'uint256' },
      { internalType: 'uint256', name: 'currentOtcBps', type: 'uint256' },
      { internalType: 'uint256', name: 'currentOtcFeeBps', type: 'uint256' },
      { internalType: 'bool', name: 'hasOtc', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Quote for NFT purchase
  {
    inputs: [{ internalType: 'uint256', name: 'count', type: 'uint256' }],
    name: 'quoteBuyNFT',
    outputs: [
      { internalType: 'uint256', name: 'unwrapFee', type: 'uint256' },
      { internalType: 'uint256', name: 'tokensNeeded', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Stats function (updated return values)
  {
    inputs: [],
    name: 'getStats',
    outputs: [
      { internalType: 'uint256', name: '_otcBalance', type: 'uint256' },
      { internalType: 'uint256', name: '_totalRevenue', type: 'uint256' },
      { internalType: 'uint256', name: '_totalSwapVolume', type: 'uint256' },
      { internalType: 'uint256', name: '_totalOtcVolume', type: 'uint256' },
      { internalType: 'uint256', name: '_totalFeesCollected', type: 'uint256' },
      { internalType: 'uint256', name: '_contractEthBalance', type: 'uint256' },
      { internalType: 'uint256', name: '_contractWassBalance', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Owner functions
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'withdrawOTC',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'withdrawRevenue',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'withdrawETH',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'withdrawToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: '_hook', type: 'address' },
      { internalType: 'bytes32', name: '_poolIdRaw', type: 'bytes32' },
    ],
    name: 'setPool',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_otcBps', type: 'uint256' }],
    name: 'setOtcSplit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_feeBps', type: 'uint256' }],
    name: 'setOtcFee',
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
  // ERC721 Receiver
  {
    inputs: [
      { internalType: 'address', name: '', type: 'address' },
      { internalType: 'address', name: '', type: 'address' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'bytes', name: '', type: 'bytes' },
    ],
    name: 'onERC721Received',
    outputs: [{ internalType: 'bytes4', name: '', type: 'bytes4' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Unlock callback (V4 integration)
  {
    inputs: [{ internalType: 'bytes', name: 'data', type: 'bytes' }],
    name: 'unlockCallback',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'newBalance', type: 'uint256' },
    ],
    name: 'Deposited',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'newBalance', type: 'uint256' },
    ],
    name: 'Withdrawn',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'ethIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'swapTokens', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'otcTokens', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'feeTokens', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'totalWass', type: 'uint256' },
    ],
    name: 'SwapToWASS',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'ethIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'wassUsed', type: 'uint256' },
      { indexed: false, internalType: 'address', name: 'outputToken', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'outputAmount', type: 'uint256' },
    ],
    name: 'SwapToToken',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'RevenueWithdrawn',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'address', name: 'hook', type: 'address' },
      { indexed: false, internalType: 'bytes32', name: 'poolId', type: 'bytes32' },
    ],
    name: 'PoolUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: 'uint256', name: 'newOtcBps', type: 'uint256' }],
    name: 'OtcSplitUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: 'uint256', name: 'newFeeBps', type: 'uint256' }],
    name: 'OtcFeeUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'count', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'ethSpent', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'tokensUsed', type: 'uint256' },
      { indexed: false, internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
    ],
    name: 'NFTPurchased',
    type: 'event',
  },
  // Receive ETH
  {
    stateMutability: 'payable',
    type: 'receive',
  },
] as const;
