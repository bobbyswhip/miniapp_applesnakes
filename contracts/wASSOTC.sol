// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * built by kieran.base.eth - with extra love baked in <3
 * https://x.com/KieranOnBase
 *
 * ██╗    ██╗ █████╗ ███████╗███████╗     ██████╗ ████████╗ ██████╗
 * ██║    ██║██╔══██╗██╔════╝██╔════╝    ██╔═══██╗╚══██╔══╝██╔════╝
 * ██║ █╗ ██║███████║███████╗███████╗    ██║   ██║   ██║   ██║     
 * ██║███╗██║██╔══██║╚════██║╚════██║    ██║   ██║   ██║   ██║     
 * ╚███╔███╔╝██║  ██║███████║███████║    ╚██████╔╝   ██║   ╚██████╗
 *  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚══════╝     ╚═════╝    ╚═╝    ╚═════╝
 *
 * OTC + SWAP HYBRID
 * - User sends ETH to swap for wASS
 * - 50% of ETH buys wASS from pool (real swap)
 * - 50% of ETH goes to owner as revenue
 * - User receives: pool tokens + OTC tokens (priced at 1% discount)
 * - OTC portion priced based on real swap rate minus 1% fee (better for buyer)
 */

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPoolManagerExt is IPoolManager {
    function settle(Currency currency) external;
}

interface IHookView {
    function getPoolKey(PoolId id) external view returns (PoolKey memory);
}

error OnlyOwner();
error ZeroAmount();
error InsufficientOTC();
error TransferFailed();
error SwapFailed(bytes data);
error Slippage();

/**
 * @title wASSOTC
 * @notice Hybrid OTC + Swap contract
 * @dev 50% real swap, 50% OTC at 1% discount to swap price
 */
contract wASSOTC {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    /* ─────────── Constants ─────────── */
    uint256 public constant OTC_DISCOUNT_BPS = 100;   // 1% discount on OTC portion
    uint256 public constant SPLIT_BPS = 5000;         // 50% to swap, 50% to OTC
    uint256 private constant BPS = 10_000;
    
    IPoolManagerExt public constant MANAGER = IPoolManagerExt(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address public constant WASS = 0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6;

    /* ─────────── State ─────────── */
    address public owner;
    address public hook;
    bytes32 public poolIdRaw;
    
    uint256 public otcBalance;           // wASS available for OTC
    uint256 public totalRevenue;         // ETH collected as revenue
    uint256 public totalSwapVolume;      // ETH sent to pool
    uint256 public totalOtcVolume;       // wASS sold via OTC

    /* ─────────── Events ─────────── */
    event Deposited(uint256 amount, uint256 newBalance);
    event Withdrawn(uint256 amount, uint256 newBalance);
    event Swap(
        address indexed buyer,
        uint256 ethIn,
        uint256 swapEth,
        uint256 revenueEth,
        uint256 swapTokens,
        uint256 otcTokens,
        uint256 totalTokens
    );
    event RevenueWithdrawn(uint256 amount);
    event PoolUpdated(address hook, bytes32 poolId);

    /* ─────────── Modifiers ─────────── */
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /* ─────────── Constructor ─────────── */
    constructor(address _owner, address _hook, bytes32 _poolIdRaw) {
        owner = _owner;
        hook = _hook;
        poolIdRaw = _poolIdRaw;
    }

    receive() external payable {}

    /* ─────────── Owner: Deposit wASS ─────────── */
    
    function deposit(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        
        if (!IERC20(WASS).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        
        otcBalance += amount;
        emit Deposited(amount, otcBalance);
    }
    
    function withdrawOTC(uint256 amount) external onlyOwner {
        if (amount > otcBalance) revert InsufficientOTC();
        
        otcBalance -= amount;
        
        if (!IERC20(WASS).transfer(owner, amount)) {
            revert TransferFailed();
        }
        
        emit Withdrawn(amount, otcBalance);
    }

    /* ─────────── Owner: Set Pool ─────────── */
    
    function setPool(address _hook, bytes32 _poolIdRaw) external onlyOwner {
        hook = _hook;
        poolIdRaw = _poolIdRaw;
        emit PoolUpdated(_hook, _poolIdRaw);
    }

    /* ─────────── Swap Data for Callback ─────────── */
    struct SwapData {
        PoolKey key;
        uint256 amountIn;
        address recipient;
    }

    /* ─────────── Public: Swap ETH for wASS ─────────── */
    
    /**
     * @notice Swap ETH for wASS - 50% from pool, 50% OTC at 1% discount
     * @param minTokensOut Minimum total tokens to receive (slippage protection)
     */
    function swap(uint256 minTokensOut) external payable {
        if (msg.value == 0) revert ZeroAmount();
        
        uint256 ethIn = msg.value;
        
        // Split: 50% to swap, 50% as revenue (for OTC pricing)
        uint256 swapEth = (ethIn * SPLIT_BPS) / BPS;
        uint256 revenueEth = ethIn - swapEth;
        
        // Execute real swap for first 50%
        uint256 swapTokensOut = _executeSwap(swapEth);
        
        // Calculate OTC tokens based on swap rate minus 1% fee
        // Rate = swapTokensOut / swapEth
        // OTC tokens = revenueEth * rate * (1 - 1%) 
        uint256 otcTokens = 0;
        uint256 extraSwapTokens = 0;
        
        if (swapEth > 0 && swapTokensOut > 0) {
            uint256 otcNeeded = (revenueEth * swapTokensOut * (BPS - OTC_DISCOUNT_BPS)) / (swapEth * BPS);
            
            if (otcBalance >= otcNeeded) {
                // Enough OTC - use it all
                otcTokens = otcNeeded;
                otcBalance -= otcNeeded;
                totalOtcVolume += otcNeeded;
                totalRevenue += revenueEth;
            } else if (otcBalance > 0) {
                // Partial OTC available - use what we have, swap the rest
                otcTokens = otcBalance;
                
                // Calculate how much ETH the OTC covers
                uint256 otcEthValue = (otcTokens * swapEth * BPS) / (swapTokensOut * (BPS - OTC_DISCOUNT_BPS));
                uint256 remainingEth = revenueEth - otcEthValue;
                
                otcBalance = 0;
                totalOtcVolume += otcTokens;
                totalRevenue += otcEthValue;
                
                // Swap the remaining ETH
                if (remainingEth > 0) {
                    extraSwapTokens = _executeSwap(remainingEth);
                    totalSwapVolume += remainingEth;
                }
            } else {
                // No OTC - swap all the revenue ETH
                extraSwapTokens = _executeSwap(revenueEth);
                totalSwapVolume += revenueEth;
            }
        }
        
        uint256 totalTokens = swapTokensOut + otcTokens + extraSwapTokens;
        if (totalTokens < minTokensOut) revert Slippage();
        
        // Transfer all tokens to buyer
        if (totalTokens > 0) {
            if (!IERC20(WASS).transfer(msg.sender, totalTokens)) {
                revert TransferFailed();
            }
        }
        
        totalSwapVolume += swapEth;
        
        emit Swap(
            msg.sender,
            ethIn,
            swapEth,
            revenueEth,
            swapTokensOut + extraSwapTokens,
            otcTokens,
            totalTokens
        );
    }

    /* ─────────── Internal: Execute Swap via PoolManager ─────────── */
    
    function _executeSwap(uint256 ethAmount) internal returns (uint256 amountOut) {
        PoolKey memory key = IHookView(hook).getPoolKey(PoolId.wrap(poolIdRaw));
        require(address(key.hooks) == hook, "wrong hook");
        require(Currency.unwrap(key.currency0) == address(0), "c0!=ETH");

        try MANAGER.unlock(
            abi.encode(
                SwapData({
                    key: key,
                    amountIn: ethAmount,
                    recipient: address(this)
                })
            )
        ) returns (bytes memory ret) {
            amountOut = abi.decode(ret, (uint256));
        } catch (bytes memory err) {
            revert SwapFailed(err);
        }
    }

    /* ─────────── Uniswap Unlock Callback ─────────── */
    
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(MANAGER), "unauthorized");
        SwapData memory s = abi.decode(data, (SwapData));

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(s.amountIn),
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });

        BalanceDelta d = MANAGER.swap(s.key, params, hex"");
        require(d.amount0() < 0 && d.amount1() > 0, "bad delta");

        uint256 payC0 = uint256(uint128(-d.amount0()));
        uint256 outC1 = uint256(uint128(d.amount1()));
        
        MANAGER.settle{value: payC0}();
        MANAGER.take(s.key.currency1, s.recipient, outC1);
        
        return abi.encode(outC1);
    }

    /* ─────────── Owner: Withdraw Revenue ─────────── */
    
    function withdrawRevenue() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();
        
        (bool ok, ) = owner.call{value: balance}("");
        if (!ok) revert TransferFailed();
        
        emit RevenueWithdrawn(balance);
    }

    /* ─────────── Emergency ─────────── */
    
    function withdrawETH(uint256 amount) external onlyOwner {
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
    
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        if (token == WASS) {
            if (amount <= otcBalance) {
                otcBalance -= amount;
            } else {
                otcBalance = 0;
            }
        }
        if (!IERC20(token).transfer(owner, amount)) {
            revert TransferFailed();
        }
    }

    /* ─────────── View ─────────── */
    
    function getStats() external view returns (
        uint256 _otcBalance,
        uint256 _totalRevenue,
        uint256 _totalSwapVolume,
        uint256 _totalOtcVolume,
        uint256 _contractEthBalance,
        uint256 _contractWassBalance
    ) {
        return (
            otcBalance,
            totalRevenue,
            totalSwapVolume,
            totalOtcVolume,
            address(this).balance,
            IERC20(WASS).balanceOf(address(this))
        );
    }
    
    /**
     * @notice Estimate output for a given ETH input
     * @dev Returns 0 for swap estimate - use quoter for accurate swap quote
     */
    function quote(uint256 ethIn) external view returns (
        uint256 swapPortion,
        uint256 revenuePortion,
        uint256 otcAvailable,
        bool hasOtc
    ) {
        swapPortion = (ethIn * SPLIT_BPS) / BPS;
        revenuePortion = ethIn - swapPortion;
        otcAvailable = otcBalance;
        hasOtc = otcBalance > 0;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
