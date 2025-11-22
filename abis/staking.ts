/**
 * Apple Staking Contract ABI
 *
 * Contract Address: 0x63b2A9Bd65f516E49Cee75C9001FB5aa3588CB3c
 *
 * Features:
 * - Stake/Unstake NFTs with O(1) operations
 * - Masterchef-style reward distribution
 * - Claim rewards
 * - View staking stats and user info
 */
export const STAKING_ABI = [
  // Core Staking Functions
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // Reward Distribution
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'addRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // View Functions - User Staking Info
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getStakedCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'user', type: 'address' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
    ],
    name: 'isTokenStakedByUser',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'pendingRewards',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Pagination
  {
    inputs: [
      { internalType: 'address', name: 'user', type: 'address' },
      { internalType: 'uint256', name: 'offset', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'getStakedTokenIdsPaginated',
    outputs: [
      { internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
      { internalType: 'uint256', name: 'total', type: 'uint256' },
      { internalType: 'bool', name: 'hasMore', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'offset', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'getStakersPaginated',
    outputs: [
      { internalType: 'address[]', name: 'stakerAddresses', type: 'address[]' },
      { internalType: 'uint256[]', name: 'stakedCounts', type: 'uint256[]' },
      { internalType: 'uint256', name: 'total', type: 'uint256' },
      { internalType: 'bool', name: 'hasMore', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Pool Stats
  {
    inputs: [],
    name: 'getPoolStats',
    outputs: [
      { internalType: 'uint256', name: '_totalStaked', type: 'uint256' },
      { internalType: 'uint256', name: '_rewardPerNFTStored', type: 'uint256' },
      { internalType: 'uint256', name: '_totalRewardsAdded', type: 'uint256' },
      { internalType: 'uint256', name: '_totalRewardsClaimed', type: 'uint256' },
      { internalType: 'uint256', name: '_availableRewards', type: 'uint256' },
      { internalType: 'uint256', name: '_totalUniqueStakers', type: 'uint256' },
      { internalType: 'uint256', name: '_averageStakePerUser', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getUserStats',
    outputs: [
      { internalType: 'uint256', name: 'stakedCount', type: 'uint256' },
      { internalType: 'uint256', name: 'pendingRewardsAmount', type: 'uint256' },
      { internalType: 'uint256', name: 'totalClaimedAmount', type: 'uint256' },
      { internalType: 'uint256', name: 'currentRewardDebt', type: 'uint256' },
      { internalType: 'uint256', name: 'firstStakeTimestamp', type: 'uint256' },
      { internalType: 'uint256', name: 'lastStakeTimestamp', type: 'uint256' },
      { internalType: 'uint256', name: 'lastUnstakeTimestamp', type: 'uint256' },
      { internalType: 'uint256', name: 'lastClaimTimestamp', type: 'uint256' },
      { internalType: 'uint256', name: 'stakeDuration', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // View Functions - Token Checks
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'getTokenInfoBatch',
    outputs: [
      { internalType: 'bool[]', name: 'isSnake', type: 'bool[]' },
      { internalType: 'bool[]', name: 'isStaked', type: 'bool[]' },
      { internalType: 'address[]', name: 'stakedBy', type: 'address[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'checkIsSnake',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'isTokenStaked',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'getTokenStaker',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Public State Variables
  {
    inputs: [],
    name: 'stakingNFT',
    outputs: [{ internalType: 'contract IERC721', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'rewardToken',
    outputs: [{ internalType: 'contract IERC20', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalStaked',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalRewardsAdded',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalRewardsClaimed',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalUniqueStakers',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'tokenIdToStaker',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },

  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
      { indexed: false, internalType: 'uint256', name: 'newTotalStaked', type: 'uint256' },
    ],
    name: 'Staked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
      { indexed: false, internalType: 'uint256', name: 'newTotalStaked', type: 'uint256' },
    ],
    name: 'Unstaked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'RewardsClaimed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'from', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'newRewardPerNFT', type: 'uint256' },
    ],
    name: 'RewardsAdded',
    type: 'event',
  },
] as const;
