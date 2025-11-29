/**
 * wASS OTC Contract ABI
 * Hybrid OTC + Swap contract - 50% real swap, 50% OTC at 1% discount
 * Contract: 0x005B9ADac22eDf5Da3068974281593A9e6b8646F
 */
export const WASSOTC_ABI = [
  // Constants
  {
    inputs: [],
    name: 'OTC_DISCOUNT_BPS',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'SPLIT_BPS',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
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
  // Main swap function
  {
    inputs: [{ internalType: 'uint256', name: 'minTokensOut', type: 'uint256' }],
    name: 'swap',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // Quote function
  {
    inputs: [{ internalType: 'uint256', name: 'ethIn', type: 'uint256' }],
    name: 'quote',
    outputs: [
      { internalType: 'uint256', name: 'swapPortion', type: 'uint256' },
      { internalType: 'uint256', name: 'revenuePortion', type: 'uint256' },
      { internalType: 'uint256', name: 'otcAvailable', type: 'uint256' },
      { internalType: 'bool', name: 'hasOtc', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Stats function
  {
    inputs: [],
    name: 'getStats',
    outputs: [
      { internalType: 'uint256', name: '_otcBalance', type: 'uint256' },
      { internalType: 'uint256', name: '_totalRevenue', type: 'uint256' },
      { internalType: 'uint256', name: '_totalSwapVolume', type: 'uint256' },
      { internalType: 'uint256', name: '_totalOtcVolume', type: 'uint256' },
      { internalType: 'uint256', name: '_contractEthBalance', type: 'uint256' },
      { internalType: 'uint256', name: '_contractWassBalance', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'buyer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'ethIn', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'swapEth', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'revenueEth', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'swapTokens', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'otcTokens', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'totalTokens', type: 'uint256' },
    ],
    name: 'Swap',
    type: 'event',
  },
  // Receive ETH
  {
    stateMutability: 'payable',
    type: 'receive',
  },
] as const;
