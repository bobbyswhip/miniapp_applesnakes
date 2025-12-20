// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ██╗    ██╗ █████╗ ███████╗███████╗    ██████╗ ██╗      █████╗ ███████╗████████╗███████╗██████╗ 
 * ██║    ██║██╔══██╗██╔════╝██╔════╝    ██╔══██╗██║     ██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗
 * ██║ █╗ ██║███████║███████╗███████╗    ██████╔╝██║     ███████║███████╗   ██║   █████╗  ██████╔╝
 * ██║███╗██║██╔══██║╚════██║╚════██║    ██╔══██╗██║     ██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗
 * ╚███╔███╔╝██║  ██║███████║███████║    ██████╔╝███████╗██║  ██║███████║   ██║   ███████╗██║  ██║
 *  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚══════╝    ╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
 *
 * built by kieran.base.eth - with extra love baked in <3
 * https://x.com/KieranOnBase
 *
 * wASSBLASTER v4 - In-Swap OTC Edition
 * 
 * DESIGN:
 * - ONLY wASS/memecoin pairs (no ETH/WETH/USDC)
 * - 1% total fee: 0.3% LPs + 0.7% hook
 * 
 * FEE FLOW:
 * - wASS fees → stakers immediately
 * - Memecoin fees → stored for in-swap OTC
 * 
 * IN-SWAP OTC:
 * - When user buys memecoin (wASS → meme), if we have ENOUGH meme inventory:
 * - Route portion through OTC at ACTUAL pool rate (from swap output)
 * - User gets same rate as pool, we convert meme inventory → wASS
 * - OTC only triggers when inventory covers the full OTC amount (no partial fills)
 * - All in single atomic transaction
 * 
 * QUOTER COMPATIBLE:
 * - Uses afterSwapReturnDelta to include OTC in quoted output
 * - Quoter sees full output (pool + OTC)
 *
 * feel free to use this contract to wassblast your own coins
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";


struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}


interface IAppleStaking {
    function addRewards(uint256 amount) external;
}

error OnlyPoolManager();
error OnlyAdmin();
error InvalidPool();
error NotWASSPair();
error InvalidFeeTier();
error ZeroAddress();
error TransferFailed();
error BlacklistedToken();
error ZeroAmount();
error IndexOutOfBounds();

contract wASSBLASTER is Ownable {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;

    /* ─────────── Constants ─────────── */
    uint256 public constant HOOK_FEE_BPS = 70;        // 0.70% hook fee
    uint256 public constant OTC_FEE_BPS = 100;        // 1% OTC fee (protocol revenue)
    uint256 private constant BPS = 10_000;

    uint24 public constant REQUIRED_POOL_FEE = 3000;
    address public constant WASS = 0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /* ─────────── Immutables ─────────── */
    IPoolManager public immutable manager;

    /* ─────────── State ─────────── */
    IAppleStaking public appleStaking;
    address public protocolOwner;

    /* ─────────── Access Control ─────────── */
    mapping(address => bool) public admin;
    mapping(address => bool) public marketMaker;
    mapping(address => bool) public blacklisted;

    /* ─────────── Pool Registry ─────────── */
    mapping(PoolId => bool) public registered;
    mapping(PoolId => PoolKey) private _poolKeys;
    mapping(PoolId => bool) public wassIsToken0;
    mapping(PoolId => address) public pairedToken;
    PoolId[] private _poolList;

    /* ─────────── OTC Config ─────────── */
    uint256 public otcSplitBps = 3000;    // 30% of trade routes through OTC when available
    uint256 public minOtcBalance = 1e6;  // Minimum meme balance to trigger OTC
    
    // Per-pool memecoin balances from fees (available for OTC)
    mapping(PoolId => uint256) public poolTokenBalance;

    /* ─────────── Swap Scratch ─────────── */
    struct SwapScratch {
        uint256 hookFee;          // 0.7% fee
        uint256 otcWassAmount;    // wASS reserved for OTC
        uint256 poolWassInput;    // wASS that went to pool (for rate calc)
        bool isWassInput;         // Direction of swap
        bool doOtc;               // Whether OTC is active
        bool zeroForOne;          // Swap direction for afterSwap
    }
    mapping(bytes32 => SwapScratch) private _scratch;
    
    /* ─────────── Stats ─────────── */
    uint256 public totalWASSToStakers;
    uint256 public totalTokensCollected;
    uint256 public totalOtcVolume;
    uint256 public totalOtcWassToStakers;

    /* ─────────── Events ─────────── */
    event PoolRegistered(PoolId indexed id, bool wassIsToken0, address indexed pairedToken);
    event WassFeesCollected(PoolId indexed poolId, uint256 amount);
    event MemeFeesCollected(PoolId indexed poolId, address token, uint256 amount);
    event OTCExecuted(PoolId indexed poolId, address indexed recipient, uint256 wassIn, uint256 memeOut, uint256 wassToStakers);
    event StakingRewards(uint256 amount);
    event PoolDonation(PoolId indexed poolId, address indexed donor, uint256 amount);
    event AdminSet(address indexed account, bool status);
    event MarketMakerSet(address indexed account, bool status);
    event OtcConfigUpdated(uint256 splitBps, uint256 minBalance);
    event OTCDebug(PoolId indexed poolId, uint256 poolMemeOut, uint256 poolWassInput, uint256 otcMemeOwed, uint256 inventory, bool executed);
    event DeltaDebug(PoolId indexed poolId, int128 amount0, int128 amount1, bool wassIsToken0, bool zeroForOne);

    /* ─────────── Modifiers ─────────── */
    modifier onlyManager() {
        if (msg.sender != address(manager)) revert OnlyPoolManager();
        _;
    }

    modifier onlyAdmin() {
        if (!admin[msg.sender] && msg.sender != owner()) revert OnlyAdmin();
        _;
    }

    constructor(
        IPoolManager _manager,
        address _protocolOwner,
        address _appleStaking
    ) Ownable(_protocolOwner) {
        manager = _manager;
        protocolOwner = _protocolOwner;
        appleStaking = IAppleStaking(_appleStaking);
        admin[_protocolOwner] = true;
        
        blacklisted[WETH] = true;
        blacklisted[USDC] = true;
        blacklisted[address(0)] = true;
    }

    receive() external payable {}

    /* ═══════════════════════════════════════════════════════════════════════════
                                    ADMIN FUNCTIONS
       ═══════════════════════════════════════════════════════════════════════════ */

    function setAdmin(address account, bool status) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        admin[account] = status;
        emit AdminSet(account, status);
    }

    function setMarketMaker(address account, bool status) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        marketMaker[account] = status;
        emit MarketMakerSet(account, status);
    }

    function setAppleStaking(address _appleStaking) external onlyOwner {
        if (_appleStaking == address(0)) revert ZeroAddress();
        appleStaking = IAppleStaking(_appleStaking);
    }

    function setProtocolOwner(address _protocolOwner) external onlyOwner {
        if (_protocolOwner == address(0)) revert ZeroAddress();
        protocolOwner = _protocolOwner;
    }

    function setBlacklisted(address token, bool status) external onlyOwner {
        blacklisted[token] = status;
    }

    function setOtcConfig(uint256 _splitBps, uint256 _minBalance) external onlyAdmin {
        require(_splitBps >= 1000 && _splitBps <= 9000, "Split 10-90%");
        otcSplitBps = _splitBps;
        minOtcBalance = _minBalance;
        emit OtcConfigUpdated(_splitBps, _minBalance);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                  HOOK PERMISSIONS
       ═══════════════════════════════════════════════════════════════════════════ */

    function getHookPermissions() external pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,  // For quoter compatibility
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                    INITIALIZE
       ═══════════════════════════════════════════════════════════════════════════ */

    function beforeInitialize(
        address,
        PoolKey calldata key,
        uint160
    ) external onlyManager returns (bytes4) {
        if (key.fee != REQUIRED_POOL_FEE) revert InvalidFeeTier();

        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);

        if (blacklisted[token0] || blacklisted[token1]) revert BlacklistedToken();

        bool isToken0Wass = token0 == WASS;
        bool isToken1Wass = token1 == WASS;

        if (!isToken0Wass && !isToken1Wass) revert NotWASSPair();

        PoolId id = key.toId();

        if (!registered[id]) {
            registered[id] = true;
            _poolKeys[id] = key;
            _poolList.push(id);
            wassIsToken0[id] = isToken0Wass;
            pairedToken[id] = isToken0Wass ? token1 : token0;

            emit PoolRegistered(id, isToken0Wass, isToken0Wass ? token1 : token0);
        }

        return this.beforeInitialize.selector;
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                      SWAP
       ═══════════════════════════════════════════════════════════════════════════ */

    /**
     * @dev Pack BeforeSwapDelta - SPECIFIED is always first param
     *      specified = input token delta (what hook takes from input)
     *      unspecified = output token delta (what hook takes from output)
     */
    function _packBeforeSwapDelta(int128 specified, int128 unspecified) private pure returns (BeforeSwapDelta) {
        int256 s = int256(specified);
        int256 u = int256(unspecified) & ((int256(1) << 128) - 1);
        return BeforeSwapDelta.wrap((s << 128) | u);
    }

    /**
     * @notice beforeSwap - Calculate fees and reserve OTC budget
     * @dev OTC triggers when user buys meme (wASS input) and we have inventory
     *      Rate is determined in afterSwap from actual pool output
     */
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) external onlyManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();
        if (!registered[id]) revert InvalidPool();
        
        bytes32 swapKey = keccak256(abi.encodePacked(tx.origin, block.number, id));

        // Market makers = zero fees, no OTC
        if (marketMaker[sender]) {
            _scratch[swapKey] = SwapScratch(0, 0, 0, false, false, params.zeroForOne);
            return (this.beforeSwap.selector, _packBeforeSwapDelta(0, 0), 0);
        }

        bool _wassIsToken0 = wassIsToken0[id];
        // zeroForOne=true means selling token0. If wASS is token0, that's wASS input
        bool isWassInput = _wassIsToken0 ? params.zeroForOne : !params.zeroForOne;

        uint256 inputAmount = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        // Calculate 0.7% hook fee (always on input)
        uint256 hookFee = (inputAmount * HOOK_FEE_BPS) / BPS;
        
        // Check for OTC opportunity (only when buying meme with wASS AND enough inventory)
        uint256 otcWassAmount = 0;
        bool doOtc = false;

        if (isWassInput && poolTokenBalance[id] >= minOtcBalance) {
            // Calculate potential OTC amount
            uint256 potentialOtc = (inputAmount * otcSplitBps) / BPS;

            // Only do OTC if we have enough inventory to cover it
            // Rough estimate: assume ~1:1 rate for check, actual rate in afterSwap
            // If inventory >= potentialOtc, we're safe (conservative)
            if (poolTokenBalance[id] >= potentialOtc) {
                otcWassAmount = potentialOtc;
                doOtc = true;
            }
        }

        // NOTE: Pool receives FULL inputAmount (minus fee only for accounting)
        // The beforeSwap delta affects accounting, NOT what pool receives
        // So poolWassInput should be the actual amount that went to pool swap = inputAmount
        // The OTC portion is taken from user's extra payment, not from pool

        _scratch[swapKey] = SwapScratch({
            hookFee: hookFee,
            otcWassAmount: otcWassAmount,
            poolWassInput: inputAmount,  // Full amount goes to pool
            isWassInput: isWassInput,
            doOtc: doOtc,
            zeroForOne: params.zeroForOne
        });

        // Total delta on SPECIFIED (input) currency
        int128 specifiedDelta = int128(uint128(hookFee + otcWassAmount));

        return (this.beforeSwap.selector, _packBeforeSwapDelta(specifiedDelta, 0), 0);
    }

    /**
     * @notice afterSwap - Execute fee collection and OTC at actual pool rate
     * @dev Uses actual swap output to determine fair OTC rate
     *      Returns delta so quoter sees full output (pool + OTC)
     */
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        BalanceDelta delta,
        bytes calldata
    ) external onlyManager returns (bytes4, int128) {
        PoolId id = key.toId();
        bytes32 swapKey = keccak256(abi.encodePacked(tx.origin, block.number, id));
        
        SwapScratch memory s = _scratch[swapKey];
        delete _scratch[swapKey];

        // Market maker or no activity
        if (s.hookFee == 0 && !s.doOtc) {
            return (this.afterSwap.selector, 0);
        }

        bool _wassIsToken0 = wassIsToken0[id];
        address memeToken = pairedToken[id];
        Currency wassCurrency = _wassIsToken0 ? key.currency0 : key.currency1;

        // Determine input currency based on swap direction stored in scratch
        Currency inputCurrency = s.zeroForOne ? key.currency0 : key.currency1;

        // Take hook fee from PoolManager (always from input currency)
        if (s.hookFee > 0) {
            manager.take(inputCurrency, address(this), s.hookFee);
            
            if (s.isWassInput) {
                // wASS fee → stakers
                _sendToStakers(s.hookFee);
                emit WassFeesCollected(id, s.hookFee);
            } else {
                // Meme fee → store for OTC
                poolTokenBalance[id] += s.hookFee;
                totalTokensCollected += s.hookFee;
                emit MemeFeesCollected(id, memeToken, s.hookFee);
            }
        }

        // Handle OTC (only on buys - wASS input)
        int128 otcDelta = 0;

        if (s.doOtc && s.otcWassAmount > 0) {
            // MUST take the OTC wASS we claimed in beforeSwap - otherwise delta won't settle
            manager.take(wassCurrency, address(this), s.otcWassAmount);

            // Get pool meme output from delta
            int128 amount0 = delta.amount0();
            int128 amount1 = delta.amount1();

            // Emit raw delta values for debugging
            emit DeltaDebug(id, amount0, amount1, _wassIsToken0, s.zeroForOne);

            // Get meme output amount (use absolute value - sign depends on delta perspective)
            int128 memeAmount = _wassIsToken0 ? amount1 : amount0;

            uint256 poolMemeOut = 0;
            if (memeAmount > 0) {
                poolMemeOut = uint256(uint128(memeAmount));
            } else if (memeAmount < 0) {
                poolMemeOut = uint256(uint128(-memeAmount));
            }

            // Calculate OTC meme at actual pool rate
            uint256 otcMemeOwed = 0;
            if (poolMemeOut > 0 && s.poolWassInput > 0) {
                otcMemeOwed = Math.mulDiv(s.otcWassAmount, poolMemeOut, s.poolWassInput);
            }

            uint256 currentInventory = poolTokenBalance[id];

            // Emit debug event for tracing
            emit OTCDebug(id, poolMemeOut, s.poolWassInput, otcMemeOwed, currentInventory, otcMemeOwed > 0 && otcMemeOwed <= currentInventory);

            // Execute OTC if we have enough inventory AND valid output
            if (otcMemeOwed > 0 && otcMemeOwed <= currentInventory) {
                // Update inventory
                poolTokenBalance[id] -= otcMemeOwed;

                // OTC fee (1%) stays as protocol revenue
                uint256 otcFee = (s.otcWassAmount * OTC_FEE_BPS) / BPS;
                uint256 wassToStakers = s.otcWassAmount - otcFee;

                // Send wASS to stakers
                _sendToStakers(wassToStakers);
                totalOtcWassToStakers += wassToStakers;

                // Transfer OTC meme directly to user (bypasses V4 delta system)
                // This is simpler and avoids accounting complexity
                IERC20(memeToken).transfer(tx.origin, otcMemeOwed);

                // No delta return needed - direct transfer handles it
                totalOtcVolume += otcMemeOwed;

                emit OTCExecuted(id, tx.origin, s.otcWassAmount, otcMemeOwed, wassToStakers);
            } else {
                // OTC couldn't execute - send the wASS we took to stakers anyway
                _sendToStakers(s.otcWassAmount);
            }
        }

        return (this.afterSwap.selector, otcDelta);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                  INTERNAL
       ═══════════════════════════════════════════════════════════════════════════ */

    function _sendToStakers(uint256 amount) internal {
        if (amount == 0) return;
        
        if (address(appleStaking) != address(0)) {
            IERC20(WASS).approve(address(appleStaking), amount);
            try appleStaking.addRewards(amount) {
                totalWASSToStakers += amount;
                emit StakingRewards(amount);
            } catch {
                IERC20(WASS).transfer(protocolOwner, amount);
            }
        } else {
            IERC20(WASS).transfer(protocolOwner, amount);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                    VIEW FUNCTIONS
       ═══════════════════════════════════════════════════════════════════════════ */

    function poolCount() external view returns (uint256) { 
        return _poolList.length; 
    }

    function poolIdAt(uint256 index) external view returns (PoolId) {
        if (index >= _poolList.length) revert IndexOutOfBounds();
        return _poolList[index];
    }

    function getPoolKey(PoolId id) external view returns (PoolKey memory) {
        if (!registered[id]) revert InvalidPool();
        return _poolKeys[id];
    }

    function getPoolInfo(PoolId id) external view returns (
        address token,
        uint256 tokenBalance,
        bool isWassToken0,
        bool isRegistered
    ) {
        return (
            pairedToken[id],
            poolTokenBalance[id],
            wassIsToken0[id],
            registered[id]
        );
    }

    function getStats() external view returns (
        uint256 pools,
        uint256 wassToStakers,
        uint256 tokensCollected,
        uint256 otcVolume,
        uint256 otcWassToStakers,
        uint256 wassBalance
    ) {
        return (
            _poolList.length,
            totalWASSToStakers,
            totalTokensCollected,
            totalOtcVolume,
            totalOtcWassToStakers,
            IERC20(WASS).balanceOf(address(this))
        );
    }

    function isMarketMaker(address a) external view returns (bool) { 
        return marketMaker[a]; 
    }
    
    function isAdmin(address a) external view returns (bool) { 
        return admin[a] || a == owner(); 
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                    EMERGENCY
       ═══════════════════════════════════════════════════════════════════════════ */

    function withdrawETH(uint256 amount) external onlyAdmin {
        (bool ok, ) = protocolOwner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawToken(address token, uint256 amount) external onlyAdmin {
        if (!IERC20(token).transfer(protocolOwner, amount)) revert TransferFailed();
    }

    function emergencyWithdrawPool(PoolId id) external onlyAdmin {
        if (!registered[id]) revert InvalidPool();

        address token = pairedToken[id];
        uint256 balance = poolTokenBalance[id];

        if (balance > 0) {
            poolTokenBalance[id] = 0;
            IERC20(token).transfer(protocolOwner, balance);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════════
                                    PUBLIC FUNCTIONS
       ═══════════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Donate tokens to a pool's OTC inventory
     * @dev Anyone can donate to increase OTC liquidity
     * @param id The pool ID to donate to
     * @param amount The amount of tokens to donate
     */
    function donateToPool(PoolId id, uint256 amount) external {
        if (!registered[id]) revert InvalidPool();
        if (amount == 0) revert ZeroAmount();

        address memeToken = pairedToken[id];

        // Transfer tokens from sender to this contract
        uint256 balBefore = IERC20(memeToken).balanceOf(address(this));
        bool success = IERC20(memeToken).transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
        uint256 balAfter = IERC20(memeToken).balanceOf(address(this));

        // Handle fee-on-transfer tokens
        uint256 received = balAfter - balBefore;

        // Add to pool inventory
        poolTokenBalance[id] += received;
        totalTokensCollected += received;

        emit PoolDonation(id, msg.sender, received);
    }
}