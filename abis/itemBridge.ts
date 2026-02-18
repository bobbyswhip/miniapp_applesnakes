// ItemBridge v1.01 ABI
// Contract: 0x374Aa24edAE24982eAB22d8994E8c1de9AF7A4A7
// Network: Base Mainnet (Chain ID: 8453)

export const ITEM_BRIDGE_ABI = [
  // User functions
  {
    inputs: [
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    name: 'bridgeIn',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'depositId', type: 'uint256' }],
    name: 'cancelDeposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    name: 'requestWithdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getCooldownRemaining',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // View functions
  {
    inputs: [{ name: 'itemCount', type: 'uint256' }],
    name: 'getBridgeFee',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'bridgeFeeUSDC',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_ITEMS_PER_BRIDGE',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getBridgeBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'depositId', type: 'uint256' }],
    name: 'getDeposit',
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'processed', type: 'bool' },
      { name: 'cancelled', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserDeposits',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'depositId', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'tokenIds', type: 'uint256[]' },
      { indexed: false, name: 'amounts', type: 'uint256[]' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
      { indexed: false, name: 'feeEth', type: 'uint256' },
      { indexed: false, name: 'feeWass', type: 'uint256' },
    ],
    name: 'BridgedIn',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'depositId', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'tokenIds', type: 'uint256[]' },
      { indexed: false, name: 'amounts', type: 'uint256[]' },
    ],
    name: 'DepositCancelled',
    type: 'event',
  },
] as const;

// Contract address for ItemBridge v1.04
export const ITEM_BRIDGE_ADDRESS = '0xc92adf6B4A55b9f58AcCb4EC07b5728473e4533c' as const;

// BondedItems V7 address (for approval)
export const BONDED_ITEMS_ADDRESS = '0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd' as const;
