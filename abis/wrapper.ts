/**
 * wTokens Wrapper Contract ABI
 *
 * Contract Address: 0x038b70E9311D5aE12C816c32818aeec90cBe7C29
 *
 * Features:
 * - Wrap/Unwrap NFTs to/from ERC20 tokens (FIFO queue system)
 * - Multi-batch wrapping and unwrapping
 * - Dynamic fee calculation based on Uniswap V2 pricing
 * - Collection launch system for any ERC721
 */
export const WRAPPER_ABI = [
  // View Functions
  {
    inputs: [],
    name: 'getWrapFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'isValidNFT',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'start', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'getCollections',
    outputs: [
      { internalType: 'address[]', name: 'nftContracts', type: 'address[]' },
      { internalType: 'address[]', name: 'wrappedTokens', type: 'address[]' },
      { internalType: 'uint256', name: 'totalCount', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // Write Functions
  {
    inputs: [
      { internalType: 'address', name: 'nftContract', type: 'address' },
      { internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
    ],
    name: 'wrapNFTs',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'nftContract', type: 'address' },
      { internalType: 'uint256', name: 'count', type: 'uint256' },
    ],
    name: 'unwrapNFTs',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'nftContract', type: 'address' }],
    name: 'launch',
    outputs: [{ internalType: 'address', name: 'wrappedToken', type: 'address' }],
    stateMutability: 'payable',
    type: 'function',
  },

  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'nftContract', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
    ],
    name: 'NFTWrapped',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'nftContract', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
    ],
    name: 'NFTUnwrapped',
    type: 'event',
  },
] as const;
