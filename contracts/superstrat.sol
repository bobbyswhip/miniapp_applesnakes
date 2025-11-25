// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ─────────── External Deps ─────────── */
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/* ─────────── Minimal ERCs ─────────── */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function transfer(address to, uint256 amt) external returns (bool);
    function approve(address spender, uint256 amt) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

interface IFeeManager {
    function addETHFor(address user) external payable;
    function addETHForBatch(address[] calldata users, uint256[] calldata amounts) external payable;
    function addTokenFor(address token, address user, uint256 amount) external;
}

/* ─────────── Permit2 Interface ─────────── */
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/* ─────────── PositionManager Interface ─────────── */
interface IPositionManager {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
}

/* ─────────── StateView Interface ─────────── */
interface IStateView {
    function getSlot0(PoolId poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/* ─────────── Errors ─────────── */
error OnlyPM();
error InvalidPool();

/**
 * SUPERSTRAT v3 (With Integrated Liquidity Manager + Auto-Compound)
 *
 * - Made by kieran.base.eth with love <3
 * - https://x.com/KieranOnBase
 *
 * - Hook collects 2.00% fees per pool into reserves
 * - Protocol gets 0.30% forwarded to FeeManager
 * - LPs earn 0.70% on the pool
 * 
 * FEATURES:
 * - Multi-pool liquidity management (each pool has own NFT position)
 * - Uses accumulated hook balances to add liquidity
 * - AUTO-COMPOUND: Anyone can mint/add liquidity when threshold met to enable auto compounding
 * - Supports both ETH and ERC20 pools universally
 */
contract SuperStrat is ReentrancyGuard, Pausable, Ownable, IERC721Receiver {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using Math for uint256;

    /* ─────────── Fee constants ─────────── */
    uint256 public constant HOOK_SHARE_BPS     = 200;    // 2.00%
    uint256 public constant PROTO_SHARE_BPS    = 30;     // 0.30%
    uint256 private constant SKIM_BPS          = HOOK_SHARE_BPS + PROTO_SHARE_BPS;
    uint256 private constant BPS_DENOM         = 10_000;

    mapping(PoolId => uint256) public lastLiquidityAddTime;
    uint256 public addLiquidityCooldown = 3600; // 1 hour in seconds, configurable by owner


    /* ─────────── Immutables ─────────── */
    IPoolManager public immutable manager;
    address public immutable weth;
    IPositionManager public immutable positionManager;
    IStateView public immutable stateView;
    IPermit2 public immutable permit2;

    /* ─────────── External deps ─────────── */
    IFeeManager public feeManager;

    /* ─────────── Pool registry + keys ─────────── */
    mapping(PoolId => bool) public registered;
    PoolId[] private _poolList;
    mapping(PoolId => PoolKey) private _poolKeys;

    /* ─────────── Hook fee reserves (tracked by pool ID) ─────────── */
    mapping(PoolId => mapping(Currency => uint256)) private _hookBalances;

    /* ─────────── Liquidity positions per pool ─────────── */
    mapping(PoolId => uint256) public poolPositionTokenId;
    mapping(PoolId => uint128) public poolTotalLiquidity;
    
    /* ─────────── Liquidity config ─────────── */
    uint16 public useBalanceBps = 9500; // Use 95% of available balances
    int24 public constant TICK_LOWER = -887180;
    int24 public constant TICK_UPPER = 887180;
    

    /* ─────────── One-swap scratch (per pool) ─────────── */
    struct SwapScratch {
        uint256 hookFee;
        uint256 protoFee;
        Currency feeCurrency;
    }


    struct PoolInfoComplete {
        // Pool identification
        PoolId poolId;
        bool isRegistered;
        
        // Pool key details
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        
        // Hook balances
        uint256 hookBalance0;
        uint256 hookBalance1;
        
        // Incentive amounts (1% of hook balance)
        uint256 totalIncentive0;      // Total 1% incentive for currency0
        uint256 totalIncentive1;      // Total 1% incentive for currency1
        uint256 callerIncentive0;     // 0.1% for caller (currency0)
        uint256 callerIncentive1;     // 0.1% for caller (currency1)
        uint256 ownerIncentive0;      // 0.9% for owner (currency0)
        uint256 ownerIncentive1;      // 0.9% for owner (currency1)
        
        // Position details
        uint256 positionTokenId;
        uint128 totalLiquidity;
        bool hasPosition;
        
        // Cooldown info
        uint256 lastAddTime;          // Timestamp of last liquidity add
        uint256 cooldownRemaining;    // Seconds until next add allowed (0 if ready)
        bool canAddLiquidity;         // True if cooldown expired and ready to add
    }



    mapping(bytes32 => SwapScratch) private _scratch;

    /* ─────────── Events ─────────── */
    event PoolRegistered(PoolId indexed id);
    event HookFeesAccrued(PoolId indexed id, Currency currency, uint256 amount);
    event ProtocolFeesSent(address indexed feeManager, Currency currency, uint256 amount);
    event FeeManagerUpdated(address indexed fm);
    event LiquidityMinted(PoolId indexed id, uint256 tokenId, uint256 amount0, uint256 amount1, uint128 liquidity);
    event LiquidityAdded(PoolId indexed id, uint256 tokenId, uint256 amount0, uint256 amount1, uint128 liquidity);
    event FeesClaimed(PoolId indexed id, uint256 tokenId, uint256 amount0, uint256 amount1);
    event Donation(PoolId indexed id, Currency indexed currency, address indexed donor, uint256 amount); 
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);

    event IncentivePaid(
        PoolId indexed id,
        address indexed caller,
        uint256 callerAmount0,
        uint256 callerAmount1,
        address indexed owner,
        uint256 ownerAmount0,
        uint256 ownerAmount1
    );

    /* ─────────── Modifiers ─────────── */
    modifier onlyManager() {
        if (msg.sender != address(manager)) revert OnlyPM();
        _;
    }

    constructor(
        IPoolManager _manager,
        address _weth,
        address _feeManager,
        address _owner,
        address _positionManager,
        address _stateView,
        address _permit2
    ) Ownable(_owner) {
        require(
            address(_manager) != address(0) &&
            _weth != address(0) &&
            _feeManager != address(0) &&
            _owner != address(0) &&
            _positionManager != address(0) &&
            _stateView != address(0) &&
            _permit2 != address(0),
            "zero addr"
        );
        manager = _manager;
        weth = _weth;
        feeManager = IFeeManager(_feeManager);
        positionManager = IPositionManager(_positionManager);
        stateView = IStateView(_stateView);
        permit2 = IPermit2(_permit2);
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) 
        external pure override returns (bytes4) 
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    /* ─────────── Admin ─────────── */
    function setFeeManager(address newFM) external onlyOwner {
        require(newFM != address(0), "zero");
        feeManager = IFeeManager(newFM);
        emit FeeManagerUpdated(newFM);
    }
    
    function setBalanceBps(uint16 newBps) external onlyOwner {
        require(newBps >= 5_000 && newBps <= 10_000, "Invalid BPS");
        useBalanceBps = newBps;
    }
    /**
    * @notice Update the cooldown period for adding liquidity
    * @param newCooldown New cooldown period in seconds
    * @dev Owner only. Max 24 hours (3600 seconds) to prevent excessive times
    */
    function setAddLiquidityCooldown(uint256 newCooldown) external onlyOwner {
        require(newCooldown <= 3600, "Max 1 hour"); // Prevent setting too high
        uint256 oldCooldown = addLiquidityCooldown;
        addLiquidityCooldown = newCooldown;
        emit CooldownUpdated(oldCooldown, newCooldown);
    }
    
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /* ─────────── Indexing getters ─────────── */
    function poolCount() external view returns (uint256) { return _poolList.length; }
    function poolIdAt(uint256 index) external view returns (PoolId) {
        require(index < _poolList.length, "index oob"); 
        return _poolList[index];
    }

    /**
    * @notice Get multiple pool IDs at once (paginated)
    * @param startIndex Starting index in the pool list
    * @param count Number of pool IDs to return (max 100)
    * @return poolIds Array of pool IDs
    * @return hasMore Whether there are more pools after this batch
    */
    function getPoolIdsBatch(uint256 startIndex, uint256 count) 
        external 
        view 
        returns (PoolId[] memory poolIds, bool hasMore) 
    {
        require(count > 0 && count <= 100, "Count must be 1-100");
        require(startIndex < _poolList.length, "Start index out of bounds");
        
        // Calculate actual count (don't go past array end)
        uint256 remaining = _poolList.length - startIndex;
        uint256 actualCount = count < remaining ? count : remaining;
        
        poolIds = new PoolId[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            poolIds[i] = _poolList[startIndex + i];
        }
        
        hasMore = (startIndex + actualCount) < _poolList.length;
    }

    function getPoolKey(PoolId id) external view returns (PoolKey memory) {
        if (!registered[id]) revert InvalidPool(); 
        return _poolKeys[id];
    }
    function getHookBalance(PoolId id, Currency currency) external view returns (uint256) {
        if (!registered[id]) revert InvalidPool(); 
        return _hookBalances[id][currency];
    }


    /**
    * @notice Get time remaining until next add liquidity is allowed
    * @param id Pool ID to check
    * @return remainingTime Seconds until cooldown expires (0 if ready)
    */
    function getAddLiquidityCooldown(PoolId id) external view returns (uint256 remainingTime) {
        uint256 lastAdd = lastLiquidityAddTime[id];
        uint256 nextAllowedTime = lastAdd + addLiquidityCooldown;
        
        if (block.timestamp >= nextAllowedTime) {
            return 0;
        }
        
        return nextAllowedTime - block.timestamp;
    }

    /**
    * @notice Get complete information for a pool in a single call
    * @param id The pool ID to query
    * @return info Complete pool information struct
    */
    function getCompletePoolInfo(PoolId id) 
        external 
        view 
        returns (PoolInfoComplete memory info) 
    {
        if (!registered[id]) revert InvalidPool();
        
        PoolKey memory key = _poolKeys[id];
        uint256 tokenId = poolPositionTokenId[id];
        
        uint256 balance0 = _hookBalances[id][key.currency0];
        uint256 balance1 = _hookBalances[id][key.currency1];
        
        // Calculate incentives (1% total from 5% buffer)
        uint256 incentive0Total = balance0 / 100;
        uint256 incentive1Total = balance1 / 100;
        
        uint256 owner0 = (incentive0Total * 90) / 100;  // 0.9%
        uint256 caller0 = incentive0Total - owner0;      // 0.1%
        
        uint256 owner1 = (incentive1Total * 90) / 100;  // 0.9%
        uint256 caller1 = incentive1Total - owner1;      // 0.1%
        
        // Calculate cooldown info
        uint256 lastAdd = lastLiquidityAddTime[id];
        uint256 nextAllowedTime = lastAdd + addLiquidityCooldown;

        bool canAdd = block.timestamp >= nextAllowedTime;
        uint256 cooldownRemaining = canAdd ? 0 : nextAllowedTime - block.timestamp;
        
        if (block.timestamp < nextAllowedTime) {
            cooldownRemaining = nextAllowedTime - block.timestamp;
            canAdd = false;
        }
        
        info = PoolInfoComplete({
            poolId: id,
            isRegistered: true,
            currency0: Currency.unwrap(key.currency0),
            currency1: Currency.unwrap(key.currency1),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: address(key.hooks),
            hookBalance0: balance0,
            hookBalance1: balance1,
            totalIncentive0: incentive0Total,
            totalIncentive1: incentive1Total,
            callerIncentive0: caller0,
            callerIncentive1: caller1,
            ownerIncentive0: owner0,
            ownerIncentive1: owner1,
            positionTokenId: tokenId,
            totalLiquidity: poolTotalLiquidity[id],
            hasPosition: tokenId != 0,
            lastAddTime: lastAdd,
            cooldownRemaining: cooldownRemaining,
            canAddLiquidity: canAdd
        });
    }




    /**
    * @notice Get complete information for multiple pools at once
    * @param ids Array of pool IDs to query
    * @return infos Array of complete pool information (same order as input)
    */
    function getCompletePoolInfoBatch(PoolId[] calldata ids)
        external
        view
        returns (PoolInfoComplete[] memory infos)
    {
        require(ids.length <= 50, "Max 50 pools per call");
        
        infos = new PoolInfoComplete[](ids.length);
        
        for (uint256 i = 0; i < ids.length; i++) {
            if (!registered[ids[i]]) revert InvalidPool();
            
            PoolKey memory key = _poolKeys[ids[i]];
            uint256 tokenId = poolPositionTokenId[ids[i]];
            
            uint256 balance0 = _hookBalances[ids[i]][key.currency0];
            uint256 balance1 = _hookBalances[ids[i]][key.currency1];
            
            // Calculate incentives
            uint256 incentive0Total = balance0 / 100;
            uint256 incentive1Total = balance1 / 100;
            
            uint256 owner0 = (incentive0Total * 90) / 100;
            uint256 caller0 = incentive0Total - owner0;
            
            uint256 owner1 = (incentive1Total * 90) / 100;
            uint256 caller1 = incentive1Total - owner1;
            
            // Calculate cooldown info
            uint256 lastAdd = lastLiquidityAddTime[ids[i]];
            uint256 nextAllowedTime = lastAdd + addLiquidityCooldown;

            bool canAdd = block.timestamp >= nextAllowedTime;
            uint256 cooldownRemaining = canAdd ? 0 : nextAllowedTime - block.timestamp;
            
            if (block.timestamp < nextAllowedTime) {
                cooldownRemaining = nextAllowedTime - block.timestamp;
                canAdd = false;
            }
            
            infos[i] = PoolInfoComplete({
                poolId: ids[i],
                isRegistered: true,
                currency0: Currency.unwrap(key.currency0),
                currency1: Currency.unwrap(key.currency1),
                fee: key.fee,
                tickSpacing: key.tickSpacing,
                hooks: address(key.hooks),
                hookBalance0: balance0,
                hookBalance1: balance1,
                totalIncentive0: incentive0Total,
                totalIncentive1: incentive1Total,
                callerIncentive0: caller0,
                callerIncentive1: caller1,
                ownerIncentive0: owner0,
                ownerIncentive1: owner1,
                positionTokenId: tokenId,
                totalLiquidity: poolTotalLiquidity[ids[i]],
                hasPosition: tokenId != 0,
                lastAddTime: lastAdd,
                cooldownRemaining: cooldownRemaining,
                canAddLiquidity: canAdd
            });
        }
    }


    /* ─────────── Utils ─────────── */
    function _pid(PoolKey calldata key) private pure returns (bytes32) {
        return PoolId.unwrap(key.toId());
    }
    
    function _isEthLike(Currency c) private view returns (bool) {
        address a = Currency.unwrap(c);
        return (a == address(0) || a == weth);
    }
    
    function _packBeforeSwapDelta(int128 specified, int128 unspecified) private pure returns (BeforeSwapDelta) {
        int256 s = int256(specified);
        int256 u = int256(unspecified) & ((int256(1) << 128) - 1);
        int256 packed = (s << 128) | u;
        return BeforeSwapDelta.wrap(packed);
    }

    /* ─────────── Permissions ─────────── */
    function getHookPermissions() external pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize:  true,
            beforeAddLiquidity:        false,
            afterAddLiquidity:         false,
            beforeRemoveLiquidity:     false,
            afterRemoveLiquidity:      false,
            beforeSwap: true,
            afterSwap:  true,
            beforeDonate: false,
            afterDonate:  false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta:            false,
            afterAddLiquidityReturnDelta:    false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /* ─────────── Initialize ─────────── */
    function beforeInitialize(address, PoolKey calldata key, uint160)
        external onlyManager returns (bytes4)
    {
        PoolId id = key.toId();
        require((key.fee & LPFeeLibrary.DYNAMIC_FEE_FLAG) == 0, "static fee required");

        if (!registered[id]) {
            registered[id] = true;
            _poolList.push(id);
            _poolKeys[id] = key;
            
            // Setup token approvals for this pool
            _setupPoolApprovals(key);
            
            emit PoolRegistered(id);
        }
        return this.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24)
        external view onlyManager returns (bytes4)
    {
        if (!registered[key.toId()]) revert InvalidPool();
        return this.afterInitialize.selector;
    }

    function _setupPoolApprovals(PoolKey memory key) private {
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);
        
        // Approve TOKEN0 if it's ERC20
        if (token0 != address(0)) {
            IERC20(token0).approve(address(permit2), type(uint256).max);
            permit2.approve(token0, address(positionManager), type(uint160).max, type(uint48).max);
        }
        
        // Approve TOKEN1 if it's ERC20
        if (token1 != address(0)) {
            IERC20(token1).approve(address(permit2), type(uint256).max);
            permit2.approve(token1, address(positionManager), type(uint160).max, type(uint48).max);
        }
    }

    /* ─────────── Swap Path ─────────── */
    function beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) external onlyManager whenNotPaused returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();
        if (!registered[id]) revert InvalidPool();

        Currency feeCurrency = params.zeroForOne ? key.currency0 : key.currency1;

        uint256 inputAmount = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        uint256 hookFee  = (inputAmount * HOOK_SHARE_BPS)  / BPS_DENOM;
        uint256 protoFee = (inputAmount * PROTO_SHARE_BPS) / BPS_DENOM;
        uint256 toSkim   = hookFee + protoFee;

        bytes32 pid = _pid(key);
        _scratch[pid] = SwapScratch({ 
            hookFee: hookFee, 
            protoFee: protoFee, 
            feeCurrency: feeCurrency 
        });

        BeforeSwapDelta d = (toSkim != 0)
            ? _packBeforeSwapDelta(int128(uint128(toSkim)), 0)
            : _packBeforeSwapDelta(0, 0);

        return (this.beforeSwap.selector, d, 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external onlyManager returns (bytes4, int128) {
        PoolId id = key.toId();

        bytes32 pid = _pid(key);
        SwapScratch memory s = _scratch[pid];
        delete _scratch[pid];

        if (s.hookFee != 0 || s.protoFee != 0) {
            uint256 pull = s.hookFee + s.protoFee;
            manager.take(s.feeCurrency, address(this), uint128(pull));

            if (s.hookFee != 0) {
                _hookBalances[id][s.feeCurrency] += s.hookFee;
                emit HookFeesAccrued(id, s.feeCurrency, s.hookFee);
            }

            if (s.protoFee != 0) {
                _forwardProtocolFee(s.feeCurrency, s.protoFee);
                emit ProtocolFeesSent(address(feeManager), s.feeCurrency, s.protoFee);
            }
        }

        // REMOVED: Auto-compound cannot work here due to PoolManager lock
        // Users must manually call mintPositionForPool() or addLiquidityToPool()

        return (this.afterSwap.selector, 0);
    }


    /* ─────────── Protocol fee forwarding ─────────── */
    function _forwardProtocolFee(Currency currency, uint256 amount) private {
        address a = Currency.unwrap(currency);
        if (_isEthLike(currency)) {
            if (a == weth) IWETH(weth).withdraw(amount);
            feeManager.addETHFor{value: amount}(owner());
        } else {
            IERC20(a).approve(address(feeManager), amount);
            feeManager.addTokenFor(a, owner(), amount);
        }
    }

    /* ─────────── Liquidity Management (Multi-Pool) ─────────── */

    function _getBalance(Currency currency) private view returns (uint256) {
        address token = Currency.unwrap(currency);
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    function _calculateEthValue(PoolKey memory key, uint256 amount0Max, uint256 amount1Max) 
        private 
        pure  // Changed from 'view' to 'pure'
        returns (uint256) 
    {
        uint256 ethValue = 0;
        if (Currency.unwrap(key.currency0) == address(0)) {
            ethValue += amount0Max;
        }
        if (Currency.unwrap(key.currency1) == address(0)) {
            ethValue += amount1Max;
        }
        return ethValue;
    }

    function _calculateLiquidityAndAmounts(
        PoolId id,
        uint256 balance0,
        uint256 balance1
    )
        private
        view
        returns (uint128 liquidity, uint256 amount0Max, uint256 amount1Max)
    {
        uint256 maxAmount0 = (balance0 * useBalanceBps) / 10_000;
        uint256 maxAmount1 = (balance1 * useBalanceBps) / 10_000;
        require(maxAmount0 > 0 && maxAmount1 > 0, "Insufficient amounts");

        (uint160 sqrtPriceX96,,,) = stateView.getSlot0(id);
        uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(TICK_LOWER);
        uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        uint256 liquidity0;
        uint256 liquidity1;

        if (sqrtPriceUpper > sqrtPriceX96) {
            liquidity0 = FullMath.mulDiv(
                maxAmount0,
                FullMath.mulDiv(uint256(sqrtPriceX96), sqrtPriceUpper, 1 << 96),
                uint256(sqrtPriceUpper - sqrtPriceX96)
            );
        }

        if (sqrtPriceX96 > sqrtPriceLower) {
            liquidity1 = FullMath.mulDiv(maxAmount1, 1 << 96, uint256(sqrtPriceX96 - sqrtPriceLower));
        }

        require(liquidity0 > 0 && liquidity1 > 0, "Invalid liquidity calculation");
        liquidity = uint128(Math.min(liquidity0, liquidity1));
        require(liquidity > 0, "Zero liquidity");

        if (sqrtPriceX96 < sqrtPriceUpper) {
            amount0Max = FullMath.mulDiv(
                uint256(liquidity),
                sqrtPriceUpper - sqrtPriceX96,
                FullMath.mulDiv(sqrtPriceX96, sqrtPriceUpper, 1 << 96)
            );
        }

        if (sqrtPriceX96 > sqrtPriceLower) {
            amount1Max = FullMath.mulDiv(uint256(liquidity), sqrtPriceX96 - sqrtPriceLower, 1 << 96);
        }

        require(amount0Max > 0 && amount1Max > 0, "Zero amounts calculated");
    }

    /**
    * @notice Mint initial LP position for a pool using accumulated hook balances
    * @param id The pool ID to create position for
    * @dev Anyone can call - receives 0.1% incentive, owner receives 0.9%
    */
    function mintPositionForPool(PoolId id)
        external
        nonReentrant
        whenNotPaused
    {
        _mintPositionForPool(id, msg.sender);
    }


    /**
    * @notice Internal implementation of position minting with caller incentive
    * @dev No cooldown applied to initial position creation
    */
    function _mintPositionForPool(PoolId id, address caller) private {
        if (!registered[id]) revert InvalidPool();
        require(poolPositionTokenId[id] == 0, "Position already exists");

        PoolKey memory poolKey = _poolKeys[id];

        // Use TRACKED hook balance for THIS POOL
        uint256 poolBalance0 = _hookBalances[id][poolKey.currency0];
        uint256 poolBalance1 = _hookBalances[id][poolKey.currency1];

        // Calculate liquidity from pool-specific balance
        (uint128 liquidity, ,) = _calculateLiquidityAndAmounts(id, poolBalance0, poolBalance1);

        // Calculate max amounts from pool-specific balance
        uint256 amount0Max = (poolBalance0 * useBalanceBps) / 10_000;
        uint256 amount1Max = (poolBalance1 * useBalanceBps) / 10_000;

        require(amount0Max <= type(uint128).max && amount1Max <= type(uint128).max, "Amount too large");

        // Measure TOTAL contract balance before (for accurate usage tracking)
        uint256 contractBalance0Before = _getBalance(poolKey.currency0);
        uint256 contractBalance1Before = _getBalance(poolKey.currency1);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE_PAIR),
            uint8(Actions.SWEEP)
        );

        bytes[] memory params = new bytes[](3);
        
        params[0] = abi.encode(
            poolKey,
            TICK_LOWER,
            TICK_UPPER,
            liquidity,
            uint128(amount0Max),
            uint128(amount1Max),
            address(this),
            bytes("")
        );
        
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        
        // Sweep both currencies back to this contract
        params[2] = abi.encode(poolKey.currency0, address(this));

        uint256 balanceBefore = IERC721(address(positionManager)).balanceOf(address(this));
        uint256 expectedTokenId = positionManager.nextTokenId();

        uint256 ethValue = _calculateEthValue(poolKey, amount0Max, amount1Max);
        
        positionManager.modifyLiquidities{value: ethValue}(
            abi.encode(actions, params),
            block.timestamp + 60
        );

        uint256 balanceAfter = IERC721(address(positionManager)).balanceOf(address(this));
        require(balanceAfter == balanceBefore + 1, "NFT not received");
        require(
            IERC721(address(positionManager)).ownerOf(expectedTokenId) == address(this),
            "Token ID mismatch"
        );

        poolPositionTokenId[id] = expectedTokenId;

        // Measure ACTUAL usage from total contract balance change
        uint256 amount0Used = contractBalance0Before - _getBalance(poolKey.currency0);
        uint256 amount1Used = contractBalance1Before - _getBalance(poolKey.currency1);
        
        // Calculate potential incentives (1% of pool's hook balance)
        uint256 incentive0Total = poolBalance0 / 100;
        uint256 incentive1Total = poolBalance1 / 100;
        
        // Only pay incentives if incentive <= liquidity added for BOTH tokens
        // Prevents paying more in incentives than value added to pool
        bool shouldPayIncentives = (incentive0Total <= amount0Used) && 
                                (incentive1Total <= amount1Used);
        
        if (shouldPayIncentives) {
            uint256 owner0 = (incentive0Total * 90) / 100;  // 0.9%
            uint256 caller0 = incentive0Total - owner0;      // 0.1%
            
            uint256 owner1 = (incentive1Total * 90) / 100;  // 0.9%
            uint256 caller1 = incentive1Total - owner1;      // 0.1%

            // Deduct incentives from accounting
            _hookBalances[id][poolKey.currency0] -= incentive0Total;
            _hookBalances[id][poolKey.currency1] -= incentive1Total;

            // Pay incentives
            address ownerAddr = owner();
            _sendToken(poolKey.currency0, ownerAddr, owner0);
            _sendToken(poolKey.currency0, caller, caller0);
            _sendToken(poolKey.currency1, ownerAddr, owner1);
            _sendToken(poolKey.currency1, caller, caller1);
            
            emit IncentivePaid(id, caller, caller0, caller1, ownerAddr, owner0, owner1);
        }
        
        // Deduct liquidity used from accounting
        _hookBalances[id][poolKey.currency0] -= amount0Used;
        _hookBalances[id][poolKey.currency1] -= amount1Used;
        
        poolTotalLiquidity[id] += liquidity;
        
        emit LiquidityMinted(id, expectedTokenId, amount0Used, amount1Used, liquidity);
    }



    /**
    * @notice Helper function to send tokens (handles ETH and ERC20)
    * @param currency The currency to send
    * @param recipient Recipient address
    * @param amount Amount to send
    */
    function _sendToken(Currency currency, address recipient, uint256 amount) private {
        if (amount == 0) return;
        
        address token = Currency.unwrap(currency);
        if (token == address(0)) {
            // Send ETH
            (bool success, ) = recipient.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            // Send ERC20
            require(IERC20(token).transfer(recipient, amount), "Token transfer failed");
        }
    }



    /**
    * @notice Add liquidity to existing pool position using accumulated hook balances
    * @param id The pool ID to add liquidity to
    * @dev Anyone can call - receives 0.1% incentive, owner receives 0.9%
    * @dev Rate limited to once per hour per pool
    */
    function addLiquidityToPool(PoolId id)
        external
        nonReentrant
        whenNotPaused
    {
        // Check cooldown
        require(
            block.timestamp >= lastLiquidityAddTime[id] + addLiquidityCooldown,
            "Cooldown active"
        );
        
        _addLiquidityToPool(id, msg.sender);
        
        // Update last add time
        lastLiquidityAddTime[id] = block.timestamp;
    }


    function _addLiquidityToPool(PoolId id, address caller) private {
        if (!registered[id]) revert InvalidPool();
        uint256 tokenId = poolPositionTokenId[id];
        require(tokenId != 0, "No position exists");

        PoolKey memory poolKey = _poolKeys[id];

        // Use TRACKED hook balance for THIS POOL
        uint256 poolBalance0 = _hookBalances[id][poolKey.currency0];
        uint256 poolBalance1 = _hookBalances[id][poolKey.currency1];
        
        // Calculate liquidity from pool-specific balance
        (uint128 liquidity, ,) = _calculateLiquidityAndAmounts(id, poolBalance0, poolBalance1);

        // Calculate max amounts from pool-specific balance
        uint256 amount0Max = (poolBalance0 * useBalanceBps) / 10_000;
        uint256 amount1Max = (poolBalance1 * useBalanceBps) / 10_000;

        require(amount0Max <= type(uint128).max && amount1Max <= type(uint128).max, "Amount too large");

        // Measure TOTAL contract balance before (for accurate usage tracking)
        uint256 contractBalance0Before = _getBalance(poolKey.currency0);
        uint256 contractBalance1Before = _getBalance(poolKey.currency1);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.INCREASE_LIQUIDITY),
            uint8(Actions.SETTLE_PAIR),
            uint8(Actions.SWEEP)
        );

        bytes[] memory params = new bytes[](3);
        
        params[0] = abi.encode(
            tokenId,
            liquidity,
            uint128(amount0Max),
            uint128(amount1Max),
            bytes("")
        );
        
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        params[2] = abi.encode(poolKey.currency0, address(this));

        uint256 ethValue = _calculateEthValue(poolKey, amount0Max, amount1Max);

        positionManager.modifyLiquidities{value: ethValue}(
            abi.encode(actions, params),
            block.timestamp + 60
        );

        // Measure ACTUAL usage from total contract balance change
        uint256 amount0Used = contractBalance0Before - _getBalance(poolKey.currency0);
        uint256 amount1Used = contractBalance1Before - _getBalance(poolKey.currency1);
        
        // Calculate potential incentives (1% of pool's hook balance)
        uint256 incentive0Total = poolBalance0 / 100;
        uint256 incentive1Total = poolBalance1 / 100;
        
        // Only pay incentives if incentive <= liquidity added for BOTH tokens
        // Prevents paying more in incentives than value added to pool
        bool shouldPayIncentives = (incentive0Total <= amount0Used) && 
                                (incentive1Total <= amount1Used);
        
        if (shouldPayIncentives) {
            uint256 owner0 = (incentive0Total * 90) / 100;  // 0.9%
            uint256 caller0 = incentive0Total - owner0;      // 0.1%
            
            uint256 owner1 = (incentive1Total * 90) / 100;  // 0.9%
            uint256 caller1 = incentive1Total - owner1;      // 0.1%

            // Deduct incentives from accounting
            _hookBalances[id][poolKey.currency0] -= incentive0Total;
            _hookBalances[id][poolKey.currency1] -= incentive1Total;

            // Pay incentives
            address ownerAddr = owner();
            _sendToken(poolKey.currency0, ownerAddr, owner0);
            _sendToken(poolKey.currency0, caller, caller0);
            _sendToken(poolKey.currency1, ownerAddr, owner1);
            _sendToken(poolKey.currency1, caller, caller1);
            
            emit IncentivePaid(id, caller, caller0, caller1, ownerAddr, owner0, owner1);
        }
        
        // Deduct liquidity used from accounting
        _hookBalances[id][poolKey.currency0] -= amount0Used;
        _hookBalances[id][poolKey.currency1] -= amount1Used;
        
        poolTotalLiquidity[id] += liquidity;
        
        emit LiquidityAdded(id, tokenId, amount0Used, amount1Used, liquidity);
    }







    function donateToPool(PoolId id, Currency currency, uint256 amount) 
        external 
        payable 
        nonReentrant 
    {
        if (!registered[id]) revert InvalidPool();
        require(amount > 0, "Zero amount");
        
        address token = Currency.unwrap(currency);
        
        if (token == address(0)) {
            // ETH donation
            require(msg.value == amount, "ETH amount mismatch");
        } else {
            // ERC20 donation
            require(msg.value == 0, "No ETH for ERC20 donation");
            require(
                IERC20(token).transferFrom(msg.sender, address(this), amount), 
                "Transfer failed"
            );
        }
        
        // Credit the pool's hook balance
        _hookBalances[id][currency] += amount;
        
        emit Donation(id, currency, msg.sender, amount);
    }

    /**
    * @notice Claim accumulated LP fees for a pool position and send to owner
    * @param id The pool ID to claim fees from
    */
    function claimPoolFees(PoolId id) 
        external 
        onlyOwner 
        nonReentrant 
        whenNotPaused 
    {
        if (!registered[id]) revert InvalidPool();
        uint256 tokenId = poolPositionTokenId[id];
        require(tokenId != 0, "No position exists");

        PoolKey memory poolKey = _poolKeys[id];
        
        address token0 = Currency.unwrap(poolKey.currency0);
        address token1 = Currency.unwrap(poolKey.currency1);

        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        try positionManager.modifyLiquidities(
            abi.encode(
                abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)),
                params
            ),
            block.timestamp + 900
        ) {
            // Success - calculate collected amounts
            uint256 collected0 = _getBalance(poolKey.currency0) - balance0Before;
            uint256 collected1 = _getBalance(poolKey.currency1) - balance1Before;

            address recipient = owner();

            // Send token0 fees to owner
            if (collected0 > 0) {
                if (token0 == address(0)) {
                    // Native ETH
                    (bool success, ) = recipient.call{value: collected0}("");
                    require(success, "ETH transfer failed");
                } else {
                    // ERC20 token
                    require(IERC20(token0).transfer(recipient, collected0), "Token0 transfer failed");
                }
            }

            // Send token1 fees to owner
            if (collected1 > 0) {
                if (token1 == address(0)) {
                    // Native ETH
                    (bool success, ) = recipient.call{value: collected1}("");
                    require(success, "ETH transfer failed");
                } else {
                    // ERC20 token
                    require(IERC20(token1).transfer(recipient, collected1), "Token1 transfer failed");
                }
            }

            emit FeesClaimed(id, tokenId, collected0, collected1);
        } catch {
            // Fee claim failed - non-critical, don't revert
            emit FeesClaimed(id, tokenId, 0, 0);
        }
    }





}