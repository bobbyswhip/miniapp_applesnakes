// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * built by kieran.base.eth - with extra love baked in <3
 * https://x.com/KieranOnBase
 *
 * ██╗    ██╗ █████╗ ███████╗███████╗    ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗ 
 * ██║    ██║██╔══██╗██╔════╝██╔════╝    ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗
 * ██║ █╗ ██║███████║███████╗███████╗    ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝
 * ██║███╗██║██╔══██║╚════██║╚════██║    ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
 * ╚███╔███╔╝██║  ██║███████║███████║    ██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║
 *  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚══════╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
 *
 * OTC + SWAP ROUTER
 * - User sends ETH
 * - ETH → wASS via OTC hybrid (50% swap, 50% OTC with 3% fee)
 * - wASS → Output Token via V4 pool swap
 * - User receives output token
 * - We collect OTC revenue = win/win
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

interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IWTokens {
    function getWrapFee() external view returns (uint256);
    function unwrapNFTs(address nftContract, uint256 count) external payable;
}

interface IPoolManagerExt is IPoolManager {
    function settle() external payable returns (uint256);
    function take(Currency currency, address to, uint256 amount) external;
    function sync(Currency currency) external;
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
error InvalidSplit();
error ReentrancyGuard();
error InvalidPoolKey();
error InsufficientTokensForNFTs();
error InsufficientETHForFees();

/**
 * @title wASSOTCRouter
 * @notice Routes ETH → wASS (OTC) → Any Token (V4)
 * @dev Two-hop swap: OTC hybrid first, then V4 pool swap
 */
contract wASSOTCRouter {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    /* ─────────── Constants ─────────── */
    uint256 private constant BPS = 10_000;
    uint256 private constant MIN_OTC_BPS = 1000;      // 10% minimum OTC
    uint256 private constant MAX_OTC_BPS = 9000;      // 90% maximum OTC
    uint256 private constant MIN_OTC_FEE = 100;       // 1% min fee
    uint256 private constant MAX_OTC_FEE = 500;       // 5% max fee
    
    IPoolManagerExt public constant MANAGER = IPoolManagerExt(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address public constant WASS = 0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6;
    address public constant WTOKENS = 0x038b70E9311D5aE12C816c32818aeec90cBe7C29;
    address public constant NFT_CONTRACT = 0xa85D49d8B7a041c339D18281a750dE3D7c15A628;
    uint256 private constant TOKEN_PER_NFT = 1e18;

    /* ─────────── State ─────────── */
    address public owner;
    address public hook;                     // ETH/wASS pool hook
    bytes32 public poolIdRaw;                // ETH/wASS pool ID
    
    uint256 public otcFeeBps = 300;          // Default 3% fee on OTC (configurable 1-5%)
    uint256 public otcBps = 5000;            // Default 50% OTC, 50% swap (configurable 10-90%)
    
    uint256 public otcBalance;               // wASS available for OTC
    uint256 public totalRevenue;             // ETH collected as revenue
    uint256 public totalSwapVolume;          // ETH sent to pool
    uint256 public totalOtcVolume;           // wASS sold via OTC
    uint256 public totalFeesCollected;       // wASS fees kept in contract
    
    // Reentrancy guard
    uint256 private _locked = 1;
    
    // Temporary storage for NFT IDs received during buyNFT
    uint256[] private _receivedTokenIds;
    bool private _receivingNFTs;

    /* ─────────── Events ─────────── */
    event Deposited(uint256 amount, uint256 newBalance);
    event Withdrawn(uint256 amount, uint256 newBalance);
    event SwapToWASS(
        address indexed buyer,
        uint256 ethIn,
        uint256 swapTokens,
        uint256 otcTokens,
        uint256 feeTokens,
        uint256 totalWass
    );
    event SwapToToken(
        address indexed buyer,
        uint256 ethIn,
        uint256 wassUsed,
        address outputToken,
        uint256 outputAmount
    );
    event RevenueWithdrawn(uint256 amount);
    event PoolUpdated(address hook, bytes32 poolId);
    event OtcSplitUpdated(uint256 newOtcBps);
    event OtcFeeUpdated(uint256 newFeeBps);
    event NFTPurchased(
        address indexed buyer,
        uint256 count,
        uint256 ethSpent,
        uint256 tokensUsed,
        uint256[] tokenIds
    );

    /* ─────────── Modifiers ─────────── */
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    modifier nonReentrant() {
        if (_locked == 2) revert ReentrancyGuard();
        _locked = 2;
        _;
        _locked = 1;
    }

    /* ─────────── Constructor ─────────── */
    constructor(address _owner, address _hook, bytes32 _poolIdRaw) {
        owner = _owner;
        hook = _hook;
        poolIdRaw = _poolIdRaw;
    }

    receive() external payable {}

    /* ─────────── Owner: Deposit wASS ─────────── */
    
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        
        if (!IERC20(WASS).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        
        otcBalance += amount;
        emit Deposited(amount, otcBalance);
    }
    
    function withdrawOTC(uint256 amount) external onlyOwner nonReentrant {
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

    /* ─────────── Owner: Set OTC Split ─────────── */
    
    function setOtcSplit(uint256 _otcBps) external onlyOwner {
        if (_otcBps < MIN_OTC_BPS || _otcBps > MAX_OTC_BPS) revert InvalidSplit();
        otcBps = _otcBps;
        emit OtcSplitUpdated(_otcBps);
    }

    /* ─────────── Owner: Set OTC Fee ─────────── */
    
    /**
     * @notice Set the OTC fee percentage
     * @param _feeBps Fee in basis points (100 = 1%, 500 = 5%)
     */
    function setOtcFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps >= MIN_OTC_FEE && _feeBps <= MAX_OTC_FEE, "Fee must be 1-5%");
        otcFeeBps = _feeBps;
        emit OtcFeeUpdated(_feeBps);
    }

    /* ─────────── Swap Data Structures ─────────── */
    
    enum SwapType { ETH_TO_WASS, WASS_TO_TOKEN }
    
    struct SwapData {
        SwapType swapType;
        PoolKey key;
        uint256 amountIn;
        address recipient;
        bool zeroForOne;
    }

    /* ─────────── Public: Swap ETH for wASS only ─────────── */
    
    function swap(uint256 minWassOut) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        
        uint256 totalWass = _swapEthToWass(msg.value, minWassOut);
        
        // Transfer wASS to buyer
        if (totalWass > 0) {
            if (!IERC20(WASS).transfer(msg.sender, totalWass)) {
                revert TransferFailed();
            }
        }
    }

    /* ─────────── Public: Swap ETH → wASS → Token ─────────── */
    
    /**
     * @notice Two-hop swap: ETH → wASS (OTC) → Output Token (V4)
     * @param outputPoolKey The V4 pool key for wASS/Token pair
     * @param minWassOut Minimum wASS from first swap (slippage protection)
     * @param minTokenOut Minimum output tokens from second swap
     * @param wassIsToken0 True if wASS is currency0 in the output pool
     */
    function swapToToken(
        PoolKey calldata outputPoolKey,
        uint256 minWassOut,
        uint256 minTokenOut,
        bool wassIsToken0
    ) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        
        // Validate pool key has wASS
        address token0 = Currency.unwrap(outputPoolKey.currency0);
        address token1 = Currency.unwrap(outputPoolKey.currency1);
        
        if (wassIsToken0) {
            require(token0 == WASS, "wASS not token0");
        } else {
            require(token1 == WASS, "wASS not token1");
        }
        
        // Get output token address
        address outputToken = wassIsToken0 ? token1 : token0;
        
        // Step 1: ETH → wASS via OTC hybrid
        uint256 wassAmount = _swapEthToWass(msg.value, minWassOut);
        
        // Step 2: wASS → Token via V4 pool
        uint256 tokenOut = _swapWassToToken(outputPoolKey, wassAmount, wassIsToken0);
        
        if (tokenOut < minTokenOut) revert Slippage();
        
        // Transfer output token to user
        if (!IERC20(outputToken).transfer(msg.sender, tokenOut)) {
            revert TransferFailed();
        }
        
        emit SwapToToken(msg.sender, msg.value, wassAmount, outputToken, tokenOut);
    }

    /* ─────────── Public: Buy NFTs directly with ETH ─────────── */
    
    /**
     * @notice Buy NFTs by swapping ETH for wASS and unwrapping
     * @param count Number of NFTs to purchase
     * @param minWassOut Minimum wASS from swap (slippage protection)
     * @dev Reserves wrap fee, swaps rest for tokens, unwraps NFTs to caller
     */
    function buyNFT(uint256 count, uint256 minWassOut) external payable nonReentrant {
        if (count == 0) revert ZeroAmount();
        if (count > 100) revert("batch too large");
        
        // Get unwrap fee from wTokens (they call it wrap fee, same for unwrap)
        uint256 unwrapFeePerNFT = IWTokens(WTOKENS).getWrapFee();
        uint256 totalUnwrapFee = unwrapFeePerNFT * count;
        
        // Need more ETH than just the fee
        if (msg.value <= totalUnwrapFee) revert InsufficientETHForFees();
        uint256 swapEth = msg.value - totalUnwrapFee;
        
        // Swap ETH for wASS tokens (kept in this contract)
        uint256 tokensOut = _swapEthToWass(swapEth, minWassOut);
        
        // Check we got enough tokens (1 token per NFT)
        uint256 requiredTokens = count * TOKEN_PER_NFT;
        if (tokensOut < requiredTokens) revert InsufficientTokensForNFTs();
        
        // Add any dust to OTC balance
        uint256 dust = tokensOut - requiredTokens;
        if (dust > 0) {
            otcBalance += dust;
        }
        
        // Enable NFT receiving mode to track incoming token IDs
        _receivingNFTs = true;
        delete _receivedTokenIds;
        
        // Unwrap NFTs - they come to this contract via onERC721Received
        IWTokens(WTOKENS).unwrapNFTs{value: totalUnwrapFee}(NFT_CONTRACT, count);
        
        // Disable receiving mode
        _receivingNFTs = false;
        
        // Verify we received the expected number of NFTs
        require(_receivedTokenIds.length == count, "NFT count mismatch");
        
        // Transfer NFTs to the original buyer
        address buyer = msg.sender;
        IERC721 nft = IERC721(NFT_CONTRACT);
        uint256[] memory tokenIds = _receivedTokenIds;
        
        for (uint256 i = 0; i < count; i++) {
            nft.safeTransferFrom(address(this), buyer, tokenIds[i]);
        }
        
        // Clear the received array
        delete _receivedTokenIds;
        
        emit NFTPurchased(buyer, count, msg.value, requiredTokens, tokenIds);
    }

    /* ─────────── Internal: ETH → wASS (OTC Hybrid) ─────────── */
    
    function _swapEthToWass(uint256 ethIn, uint256 minWassOut) internal returns (uint256 totalWass) {
        // Split based on configurable otcBps
        uint256 otcEth = (ethIn * otcBps) / BPS;
        uint256 swapEth = ethIn - otcEth;
        
        // Execute real swap for swap portion
        uint256 swapTokensOut = _executeEthToWassSwap(swapEth);
        
        // Calculate OTC tokens
        uint256 otcTokens = 0;
        uint256 feeTokens = 0;
        uint256 extraSwapTokens = 0;
        
        if (swapEth > 0 && swapTokensOut > 0) {
            uint256 fullOtcTokens = (otcEth * swapTokensOut) / swapEth;
            uint256 fee = (fullOtcTokens * otcFeeBps) / BPS;
            uint256 otcNeeded = fullOtcTokens - fee;
            
            if (otcBalance >= otcNeeded) {
                // Enough OTC - use it
                otcTokens = otcNeeded;
                feeTokens = fee;
                otcBalance -= otcNeeded;
                
                totalOtcVolume += otcNeeded;
                totalFeesCollected += fee;
                totalRevenue += otcEth;
            } else {
                // Not enough OTC - do 100% swap instead (don't dust the OTC bank)
                extraSwapTokens = _executeEthToWassSwap(otcEth);
                totalSwapVolume += otcEth;
            }
        }
        
        totalWass = swapTokensOut + otcTokens + extraSwapTokens;
        if (totalWass < minWassOut) revert Slippage();
        
        totalSwapVolume += swapEth;
        
        emit SwapToWASS(msg.sender, ethIn, swapTokensOut + extraSwapTokens, otcTokens, feeTokens, totalWass);
    }

    /* ─────────── Internal: ETH → wASS Pool Swap ─────────── */
    
    function _executeEthToWassSwap(uint256 ethAmount) internal returns (uint256 amountOut) {
        if (ethAmount == 0) return 0;
        
        PoolKey memory key = IHookView(hook).getPoolKey(PoolId.wrap(poolIdRaw));
        require(address(key.hooks) == hook, "wrong hook");
        require(Currency.unwrap(key.currency0) == address(0), "c0!=ETH");

        try MANAGER.unlock(
            abi.encode(
                SwapData({
                    swapType: SwapType.ETH_TO_WASS,
                    key: key,
                    amountIn: ethAmount,
                    recipient: address(this),
                    zeroForOne: true
                })
            )
        ) returns (bytes memory ret) {
            amountOut = abi.decode(ret, (uint256));
        } catch (bytes memory err) {
            revert SwapFailed(err);
        }
    }

    /* ─────────── Internal: wASS → Token Pool Swap ─────────── */
    
    function _swapWassToToken(
        PoolKey calldata poolKey,
        uint256 wassAmount,
        bool wassIsToken0
    ) internal returns (uint256 amountOut) {
        if (wassAmount == 0) return 0;

        try MANAGER.unlock(
            abi.encode(
                SwapData({
                    swapType: SwapType.WASS_TO_TOKEN,
                    key: poolKey,
                    amountIn: wassAmount,
                    recipient: address(this),
                    zeroForOne: wassIsToken0  // If wASS is token0, we swap 0→1
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
            zeroForOne: s.zeroForOne,
            amountSpecified: -int256(s.amountIn),
            sqrtPriceLimitX96: s.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        BalanceDelta delta = MANAGER.swap(s.key, params, hex"");
        
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (s.swapType == SwapType.ETH_TO_WASS) {
            // ETH → wASS: We pay ETH (currency0), receive wASS (currency1)
            require(amount0 < 0 && amount1 > 0, "bad delta eth->wass");
            
            uint256 payETH = uint256(uint128(-amount0));
            uint256 outWASS = uint256(uint128(amount1));
            
            // Settle ETH
            MANAGER.settle{value: payETH}();
            
            // Take wASS
            MANAGER.take(s.key.currency1, s.recipient, outWASS);
            
            return abi.encode(outWASS);
            
        } else {
            // wASS → Token
            uint256 payAmount;
            uint256 outAmount;
            Currency payCurrency;
            Currency takeCurrency;
            
            if (s.zeroForOne) {
                // wASS is token0, paying wASS, receiving token1
                require(amount0 < 0 && amount1 > 0, "bad delta wass->token");
                payAmount = uint256(uint128(-amount0));
                outAmount = uint256(uint128(amount1));
                payCurrency = s.key.currency0;
                takeCurrency = s.key.currency1;
            } else {
                // wASS is token1, paying wASS, receiving token0
                require(amount1 < 0 && amount0 > 0, "bad delta wass->token");
                payAmount = uint256(uint128(-amount1));
                outAmount = uint256(uint128(amount0));
                payCurrency = s.key.currency1;
                takeCurrency = s.key.currency0;
            }
            
            // Settle wASS: sync, transfer, settle
            MANAGER.sync(payCurrency);
            bool success = IERC20(Currency.unwrap(payCurrency)).transfer(address(MANAGER), payAmount);
            require(success, "wASS transfer failed");
            MANAGER.settle();
            
            // Take output token
            MANAGER.take(takeCurrency, s.recipient, outAmount);
            
            return abi.encode(outAmount);
        }
    }

    /* ─────────── Owner: Withdraw Revenue ─────────── */
    
    function withdrawRevenue() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();
        
        (bool ok, ) = owner.call{value: balance}("");
        if (!ok) revert TransferFailed();
        
        emit RevenueWithdrawn(balance);
    }

    /* ─────────── Emergency ─────────── */
    
    function withdrawETH(uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
    
    function withdrawToken(address token, uint256 amount) external onlyOwner nonReentrant {
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

    /* ─────────── ERC721 Receiver ─────────── */
    
    /**
     * @notice Handle receipt of ERC721 tokens (required for safeTransferFrom)
     * @dev Only accepts NFTs from NFT_CONTRACT, tracks IDs during buyNFT
     */
    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        // Only accept NFTs from the Apple Snakes contract
        require(msg.sender == NFT_CONTRACT, "Only Apple Snakes NFTs");
        
        // If we're in receiving mode (during buyNFT), track the token ID
        if (_receivingNFTs) {
            _receivedTokenIds.push(tokenId);
        }
        return this.onERC721Received.selector;
    }

    /* ─────────── View ─────────── */
    
    function getStats() external view returns (
        uint256 _otcBalance,
        uint256 _totalRevenue,
        uint256 _totalSwapVolume,
        uint256 _totalOtcVolume,
        uint256 _totalFeesCollected,
        uint256 _contractEthBalance,
        uint256 _contractWassBalance
    ) {
        return (
            otcBalance,
            totalRevenue,
            totalSwapVolume,
            totalOtcVolume,
            totalFeesCollected,
            address(this).balance,
            IERC20(WASS).balanceOf(address(this))
        );
    }
    
    function quote(uint256 ethIn) external view returns (
        uint256 swapPortion,
        uint256 otcPortion,
        uint256 otcAvailable,
        uint256 currentOtcBps,
        uint256 currentOtcFeeBps,
        bool hasOtc
    ) {
        otcPortion = (ethIn * otcBps) / BPS;
        swapPortion = ethIn - otcPortion;
        otcAvailable = otcBalance;
        currentOtcBps = otcBps;
        currentOtcFeeBps = otcFeeBps;
        hasOtc = otcBalance > 0;
    }
    
    /**
     * @notice Get the unwrap fee required for buying NFTs
     * @param count Number of NFTs to buy
     * @return unwrapFee Total ETH needed for unwrap fees
     * @return tokensNeeded Total wASS tokens needed (count * 1e18)
     */
    function quoteBuyNFT(uint256 count) external view returns (
        uint256 unwrapFee,
        uint256 tokensNeeded
    ) {
        unwrapFee = IWTokens(WTOKENS).getWrapFee() * count;
        tokensNeeded = count * TOKEN_PER_NFT;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
