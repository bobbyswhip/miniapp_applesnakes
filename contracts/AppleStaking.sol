// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

interface IAppleSnakes {
    function Snake(uint256 tokenId) external view returns (bool);
}

/**
 * @title Apple Staking
 * @notice NO UNBOUNDED LOOPS - All operations are O(1) or O(batch_size)
 * @dev Uses Masterchef accounting - zero risk of state lock from large arrays
 */
contract AppleStaking is Ownable, ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    IERC721 public immutable stakingNFT;
    IAppleSnakes public immutable appleSnakes;
    IERC20 public immutable rewardToken;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_BATCH_SIZE = 100; // Prevent gas issues

    // Global staking state (O(1) operations only)
    uint256 public totalStaked;
    uint256 public rewardPerNFTStored;
    uint256 public totalRewardsAdded;
    uint256 public totalRewardsClaimed;
    uint256 public totalUniqueStakers;

    // Per-user staking info
    struct StakeInfo {
        uint256 stakedCount;              // Track count directly (O(1) access)
        mapping(uint256 => bool) isStaked; // O(1) lookup
        uint256 rewardDebt;
        uint256 pendingRewards;
        uint256 totalRewardsClaimed;
        uint256 firstStakeTime;
        uint256 lastStakeTime;
        uint256 lastUnstakeTime;
        uint256 lastClaimTime;
    }

    mapping(address => StakeInfo) private stakes;
    mapping(uint256 => address) public tokenIdToStaker;
    mapping(address => bool) private hasStaked;

    // Staker tracking for pagination
    address[] public stakers;
    mapping(address => uint256) public stakerIndex;

    // Per-user token tracking for pagination (separate from critical state)
    mapping(address => uint256[]) private userTokenIds;
    mapping(address => mapping(uint256 => uint256)) private userTokenIndex;

    // Events
    event Staked(address indexed user, uint256[] tokenIds, uint256 newTotalStaked);
    event Unstaked(address indexed user, uint256[] tokenIds, uint256 newTotalStaked);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardsAdded(address indexed from, uint256 amount, uint256 newRewardPerNFT);

    constructor() Ownable(msg.sender) {
        stakingNFT = IERC721(0xa85D49d8B7a041c339D18281a750dE3D7c15A628);
        appleSnakes = IAppleSnakes(0xa85D49d8B7a041c339D18281a750dE3D7c15A628);
        rewardToken = IERC20(0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6);
    }

    /* -----------------------------------------------------------------------
     *                           STAKING FUNCTIONS
     * --------------------------------------------------------------------- */

    /**
     * @notice Stake NFTs - GAS SAFE: O(batch_size), capped at MAX_BATCH_SIZE
     */
    function stake(uint256[] calldata tokenIds) external nonReentrant {
        uint256 length = tokenIds.length;
        require(length > 0, "No tokens provided");
        require(length <= MAX_BATCH_SIZE, "Batch too large");

        StakeInfo storage userStake = stakes[msg.sender];
        
        // Track first-time stakers (O(1))
        if (!hasStaked[msg.sender]) {
            hasStaked[msg.sender] = true;
            userStake.firstStakeTime = block.timestamp;
            stakerIndex[msg.sender] = stakers.length;
            stakers.push(msg.sender);
            totalUniqueStakers++;
        }

        // Update rewards BEFORE changing stake count (critical for fair distribution)
        _updateRewards(msg.sender);

        // Process stakes - O(batch_size)
        for (uint256 i = 0; i < length; i++) {
            uint256 tokenId = tokenIds[i];

            require(appleSnakes.Snake(tokenId), "Not a snake");
            require(stakingNFT.ownerOf(tokenId) == msg.sender, "Not owner");
            require(tokenIdToStaker[tokenId] == address(0), "Already staked");
            require(!userStake.isStaked[tokenId], "Already staked by you");

            // Transfer NFT
            stakingNFT.safeTransferFrom(msg.sender, address(this), tokenId);

            // Update mappings (all O(1))
            tokenIdToStaker[tokenId] = msg.sender;
            userStake.isStaked[tokenId] = true;
            
            // Add to pagination array
            userTokenIndex[msg.sender][tokenId] = userTokenIds[msg.sender].length;
            userTokenIds[msg.sender].push(tokenId);
            
            // Update counts
            userStake.stakedCount++;
            totalStaked++;
        }

        // Update reward debt (O(1))
        userStake.rewardDebt = (userStake.stakedCount * rewardPerNFTStored) / PRECISION;
        userStake.lastStakeTime = block.timestamp;
        
        emit Staked(msg.sender, tokenIds, totalStaked);
    }

    /**
     * @notice Unstake NFTs - GAS SAFE: O(batch_size), capped at MAX_BATCH_SIZE
     */
    function unstake(uint256[] calldata tokenIds) external nonReentrant {
        uint256 length = tokenIds.length;
        require(length > 0, "No tokens");
        require(length <= MAX_BATCH_SIZE, "Batch too large");

        StakeInfo storage userStake = stakes[msg.sender];
        
        // Update and claim rewards BEFORE changing stake count
        _updateRewards(msg.sender);
        _claimRewards(msg.sender);

        // Process unstakes - O(batch_size)
        for (uint256 i = 0; i < length; i++) {
            uint256 tokenId = tokenIds[i];
            require(tokenIdToStaker[tokenId] == msg.sender, "Not your token");
            require(userStake.isStaked[tokenId], "Not staked");

            // Remove from pagination array using swap-and-pop (O(1))
            uint256 index = userTokenIndex[msg.sender][tokenId];
            uint256 lastIndex = userTokenIds[msg.sender].length - 1;
            
            if (index != lastIndex) {
                uint256 lastTokenId = userTokenIds[msg.sender][lastIndex];
                userTokenIds[msg.sender][index] = lastTokenId;
                userTokenIndex[msg.sender][lastTokenId] = index;
            }
            userTokenIds[msg.sender].pop();
            
            // Update mappings (all O(1))
            delete userTokenIndex[msg.sender][tokenId];
            delete tokenIdToStaker[tokenId];
            delete userStake.isStaked[tokenId];
            
            // Update counts
            userStake.stakedCount--;
            totalStaked--;

            // Transfer NFT back
            stakingNFT.safeTransferFrom(address(this), msg.sender, tokenId);
        }

        // Update reward debt (O(1))
        userStake.rewardDebt = (userStake.stakedCount * rewardPerNFTStored) / PRECISION;
        userStake.lastUnstakeTime = block.timestamp;

        emit Unstaked(msg.sender, tokenIds, totalStaked);
    }

    /**
     * @notice Claim rewards - GAS SAFE: O(1) operation
     */
    function claimRewards() external nonReentrant {
        _updateRewards(msg.sender);
        _claimRewards(msg.sender);
    }

    /* -----------------------------------------------------------------------
     *                           REWARD DISTRIBUTION
     * --------------------------------------------------------------------- */

    /**
     * @notice Add rewards - GAS SAFE: O(1) operation
     * @dev No loops - just updates global accumulator
     */
    function addRewards(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount > 0");
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        if (totalStaked > 0) {
            // O(1) distribution to ALL stakers
            // No matter if 1 user or 10,000 users are staking
            rewardPerNFTStored += (amount * PRECISION) / totalStaked;
        }
        
        totalRewardsAdded += amount;
        emit RewardsAdded(msg.sender, amount, rewardPerNFTStored);
    }

    /**
     * @notice Update user rewards - GAS SAFE: O(1) operation (pure math, no loops)
     */
    function _updateRewards(address user) internal {
        StakeInfo storage userStake = stakes[user];
        if (userStake.stakedCount == 0) return;

        // Calculate pending rewards using Masterchef formula (O(1))
        uint256 accumulated = (userStake.stakedCount * rewardPerNFTStored) / PRECISION;
        uint256 pending = accumulated - userStake.rewardDebt;
        
        if (pending > 0) {
            userStake.pendingRewards += pending;
        }
        
        userStake.rewardDebt = accumulated;
    }

    /**
     * @notice Claim rewards - GAS SAFE: O(1) operation
     */
    function _claimRewards(address user) internal {
        StakeInfo storage userStake = stakes[user];
        uint256 rewards = userStake.pendingRewards;
        
        if (rewards > 0) {
            userStake.pendingRewards = 0;
            userStake.totalRewardsClaimed += rewards;
            userStake.lastClaimTime = block.timestamp;
            totalRewardsClaimed += rewards;
            rewardToken.safeTransfer(user, rewards);
            emit RewardsClaimed(user, rewards);
        }
    }

    /* -----------------------------------------------------------------------
     *                           VIEW FUNCTIONS - GAS SAFE
     * --------------------------------------------------------------------- */

    /**
     * @notice Get staked count - GAS SAFE: O(1)
     */
    function getStakedCount(address user) external view returns (uint256) {
        return stakes[user].stakedCount;
    }

    /**
     * @notice Check if specific token is staked by user - GAS SAFE: O(1)
     */
    function isTokenStakedByUser(address user, uint256 tokenId) external view returns (bool) {
        return stakes[user].isStaked[tokenId];
    }

    /**
     * @notice Get pending rewards - GAS SAFE: O(1)
     */
    function pendingRewards(address user) external view returns (uint256) {
        StakeInfo storage userStake = stakes[user];
        if (userStake.stakedCount == 0) return userStake.pendingRewards;

        uint256 accumulated = (userStake.stakedCount * rewardPerNFTStored) / PRECISION;
        return userStake.pendingRewards + (accumulated - userStake.rewardDebt);
    }

    /**
     * @notice Get paginated token IDs - GAS SAFE: O(limit)
     * @dev Uses separate array for pagination, doesn't affect staking operations
     */
    function getStakedTokenIdsPaginated(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (
        uint256[] memory tokenIds,
        uint256 total,
        bool hasMore
    ) {
        uint256[] storage userTokens = userTokenIds[user];
        total = userTokens.length;

        if (offset >= total) {
            return (new uint256[](0), total, false);
        }

        // Cap limit to prevent gas issues
        if (limit > 500) limit = 500;

        uint256 end = offset + limit;
        if (end > total) end = total;
        
        uint256 size = end - offset;
        tokenIds = new uint256[](size);

        for (uint256 i = 0; i < size; i++) {
            tokenIds[i] = userTokens[offset + i];
        }

        hasMore = end < total;
    }

    /**
     * @notice Get paginated stakers - GAS SAFE: O(limit)
     */
    function getStakersPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (
        address[] memory stakerAddresses,
        uint256[] memory stakedCounts,
        uint256 total,
        bool hasMore
    ) {
        total = stakers.length;

        if (offset >= total) {
            return (new address[](0), new uint256[](0), total, false);
        }

        // Cap limit
        if (limit > 500) limit = 500;

        uint256 end = offset + limit;
        if (end > total) end = total;
        
        uint256 size = end - offset;
        stakerAddresses = new address[](size);
        stakedCounts = new uint256[](size);

        for (uint256 i = 0; i < size; i++) {
            address staker = stakers[offset + i];
            stakerAddresses[i] = staker;
            stakedCounts[i] = stakes[staker].stakedCount;
        }

        hasMore = end < total;
    }

    /**
     * @notice Get pool stats - GAS SAFE: O(1)
     */
    function getPoolStats() external view returns (
        uint256 _totalStaked,
        uint256 _rewardPerNFTStored,
        uint256 _totalRewardsAdded,
        uint256 _totalRewardsClaimed,
        uint256 _availableRewards,
        uint256 _totalUniqueStakers,
        uint256 _averageStakePerUser
    ) {
        _totalStaked = totalStaked;
        _rewardPerNFTStored = rewardPerNFTStored;
        _totalRewardsAdded = totalRewardsAdded;
        _totalRewardsClaimed = totalRewardsClaimed;
        _availableRewards = rewardToken.balanceOf(address(this));
        _totalUniqueStakers = totalUniqueStakers;
        _averageStakePerUser = totalUniqueStakers > 0 ? totalStaked / totalUniqueStakers : 0;
    }

    /**
     * @notice Get user stats - GAS SAFE: O(1)
     */
    function getUserStats(address user) external view returns (
        uint256 stakedCount,
        uint256 pendingRewardsAmount,
        uint256 totalClaimedAmount,
        uint256 currentRewardDebt,
        uint256 firstStakeTimestamp,
        uint256 lastStakeTimestamp,
        uint256 lastUnstakeTimestamp,
        uint256 lastClaimTimestamp,
        uint256 stakeDuration
    ) {
        StakeInfo storage userStake = stakes[user];
        
        stakedCount = userStake.stakedCount;
        totalClaimedAmount = userStake.totalRewardsClaimed;
        currentRewardDebt = userStake.rewardDebt;
        firstStakeTimestamp = userStake.firstStakeTime;
        lastStakeTimestamp = userStake.lastStakeTime;
        lastUnstakeTimestamp = userStake.lastUnstakeTime;
        lastClaimTimestamp = userStake.lastClaimTime;
        
        // Calculate pending
        if (stakedCount == 0) {
            pendingRewardsAmount = userStake.pendingRewards;
        } else {
            uint256 accumulated = (stakedCount * rewardPerNFTStored) / PRECISION;
            pendingRewardsAmount = userStake.pendingRewards + (accumulated - userStake.rewardDebt);
        }
        
        stakeDuration = firstStakeTimestamp > 0 ? block.timestamp - firstStakeTimestamp : 0;
    }

    /**
     * @notice Batch check tokens - GAS SAFE: O(batch_size), capped at 500
     */
    function getTokenInfoBatch(uint256[] calldata tokenIds) external view returns (
        bool[] memory isSnake,
        bool[] memory isStaked,
        address[] memory stakedBy
    ) {
        uint256 length = tokenIds.length;
        require(length <= 500, "Batch too large");
        
        isSnake = new bool[](length);
        isStaked = new bool[](length);
        stakedBy = new address[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 tokenId = tokenIds[i];
            isSnake[i] = appleSnakes.Snake(tokenId);
            stakedBy[i] = tokenIdToStaker[tokenId];
            isStaked[i] = stakedBy[i] != address(0);
        }
    }

    /**
     * @notice Simple checks - GAS SAFE: O(1)
     */
    function checkIsSnake(uint256 tokenId) external view returns (bool) {
        return appleSnakes.Snake(tokenId);
    }

    function isTokenStaked(uint256 tokenId) external view returns (bool) {
        return tokenIdToStaker[tokenId] != address(0);
    }

    function getTokenStaker(uint256 tokenId) external view returns (address) {
        return tokenIdToStaker[tokenId];
    }

    /* -----------------------------------------------------------------------
     *                           EMERGENCY RECOVERY
     * --------------------------------------------------------------------- */

    function withdrawETH(uint256 amount, address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid addr");
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }


    receive() external payable {}
}