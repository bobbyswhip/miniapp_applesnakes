// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/* ─── Uniswap v4 Core ─── */
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

/* ─── Local shim to settle ERC20 ─── */
interface IPoolManagerExt is IPoolManager {
    function settle(Currency currency) external;
}

/* ─── ERC-20 minimal ─── */
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/* ─── Hook view for pool lookup ─── */
interface ISuperStratView {
    function getPoolKey(PoolId id) external view returns (PoolKey memory);
}

/* ─── Staking interface ─── */
interface IAppleStaking {
    function addRewards(uint256 amount) external;
}

/* ─── Errors ─── */
error SwapReverted(bytes data);

contract PredictionJack is VRFConsumerBaseV2Plus {
    using BalanceDeltaLibrary for BalanceDelta;

    address public constant COORDINATOR = 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634;
    bytes32 public constant KEY_HASH = 0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab;
    uint32 public constant NUM_WORDS = 1;
    bool public constant NATIVE_PAYMENT = true;

    IPoolManagerExt public constant MANAGER = IPoolManagerExt(0x498581fF718922c3f8e6A244956aF099B2652b2b);

    struct VrfConfig {
        uint256 subscriptionId;
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        uint256 vrfFee;
    }
    VrfConfig public vrfConfig;

    struct BjConfig {
        uint256 gameExpiryDelay;
        uint256 minActionDelay;
        uint256 vrfTimeout;
        uint256 tradingDelay;
        uint256 gameAbandonmentPeriod;
    }
    BjConfig public bjConfig;

    mapping(address => bool) public isAdmin;
    bool private locked;

    /* ─────────── Uniswap Pool Config ─────────── */
    address public hook   = 0x77e180e90130FA6e6A4bf4d07cf2032f5f2B70C8;
    bytes32 public poolIdRaw = 0x6a634d3c93c0b9402392bff565c8315f621558a49e2a00973922322ce19d4abb;
    address public token1 = 0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6;
    address public protocolOwner;
    
    /* ─────────── Fee & Staking Config ─────────── */
    IAppleStaking public appleStaking;
    uint256 public constant TRADING_FEE_BPS = 100; // 1% = 100 basis points
    uint256 public constant START_GAME_PROTOCOL_FEE_BPS = 2000; // 20% = 2000 basis points

    uint256 public startGameFee = 0.00069 ether;
    uint256 public nextGameId = 1;

    enum HandState { 
        Inactive,
        PendingInitialDeal,
        Active,
        PendingHit,
        PendingStand,
        Busted,
        Finished
    }

    enum GameResult { 
        Pending,
        Win,
        Lose,
        Push
    }

    struct Game {
        address player;
        uint256 gameId;
        uint256 startedAt;
        uint256 lastActionAt;
        uint256 vrfRequestTime;
        uint256 tradingPeriodEnds;
        uint256 tokensHeld;
        HandState state;
        uint8[] playerHand;
        uint8[] dealerHand;
        uint8[] usedCards;
    }

    struct PredictionMarket {
        uint256 gameId;
        uint256 yesSharesTotal;
        uint256 noSharesTotal;
        uint256 yesDeposits;
        uint256 noDeposits;
        uint256 maxTotalDeposits;
        bool tradingActive;
        bool resolved;
        GameResult result;
        uint256 initialLiquidity;
        bool marketCreated;
        uint256 volume;
    }

    struct PlayerStats {
        uint256 gamesPlayed;
        uint256 wins;
        uint256 losses;
        uint256 pushes;
        uint256 busts;
    }

    struct CardDisplay {
        string rank;
        string suit;
        uint8 value;
    }

    struct GameDisplay {
        string status;
        CardDisplay[] playerCards;
        uint8 playerTotal;
        CardDisplay[] dealerCards;
        uint8 dealerTotal;
        bool canHit;
        bool canStand;
        bool canStartNew;
        bool canCancelStuck;
        bool canAdminResolve;
        uint256 startedAt;
        uint256 lastActionAt;
        uint256 tradingPeriodEnds;
        uint256 secondsUntilCanAct;
        uint256 gameId;
    }

    struct MarketDisplay {
        uint256 gameId;
        uint256 yesSharesTotal;
        uint256 noSharesTotal;
        uint256 yesDeposits;
        uint256 noDeposits;
        uint256 totalDeposits;
        uint256 maxTotalDeposits;
        uint256 yesPrice;
        uint256 noPrice;
        bool tradingActive;
        bool resolved;
        GameResult result;
        uint256 userYesShares;
        uint256 userNoShares;
        uint256 userClaimable;
        bool marketCreated;
        uint256 volume;
    }

    struct SwapData {
        PoolKey key;
        bool    zeroForOne;
        uint256 amountIn;
        address recipient;
        address payer;
        bool    payC0AsNative;
    }

    mapping(address => Game) public games;
    mapping(uint256 => PredictionMarket) public predictionMarkets;
    mapping(uint256 => mapping(address => uint256)) public yesShares;
    mapping(uint256 => mapping(address => uint256)) public noShares;
    mapping(address => PlayerStats) public playerStats;
    mapping(uint256 => address) public vrfToPlayer;

    event GameStarted(address indexed player, uint256 gameId, uint256 feeIn, uint256 tokensReceived, uint256 protocolFee);
    event MarketCreated(uint256 indexed gameId, address indexed player, uint256 initialLiquidityYes, uint256 initialLiquidityNo, uint256 maxDeposits);
    event PlayerHit(address indexed player, uint256 indexed gameId, uint8 cardId, string rank, string suit);
    event PlayerStood(address indexed player, uint256 indexed gameId);
    event GameResolved(address indexed player, uint256 indexed gameId, string result, uint8 playerValue, uint8 dealerValue, GameResult marketResult);
    event PlayerBusted(address indexed player, uint256 indexed gameId, uint8 playerValue);
    event GameCancelled(address indexed player, uint256 indexed gameId, string reason);
    event TradingPeriodStarted(address indexed player, uint256 indexed gameId, uint256 endsAt);
    event YesPurchased(uint256 indexed gameId, address indexed buyer, uint256 tokensIn, uint256 sharesOut, uint256 feeAmount);
    event NoPurchased(uint256 indexed gameId, address indexed buyer, uint256 tokensIn, uint256 sharesOut, uint256 feeAmount);
    event YesSold(uint256 indexed gameId, address indexed seller, uint256 sharesIn, uint256 tokensOut, uint256 feeAmount);
    event NoSold(uint256 indexed gameId, address indexed seller, uint256 sharesIn, uint256 tokensOut, uint256 feeAmount);
    event WinningsClaimed(uint256 indexed gameId, address indexed claimer, uint256 amount, uint256 feeAmount);
    event TradingFeeCollected(uint256 indexed gameId, address indexed from, uint256 amount, string feeType);

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor() VRFConsumerBaseV2Plus(COORDINATOR) {
        isAdmin[msg.sender] = true;
        protocolOwner = msg.sender;
        appleStaking = IAppleStaking(0x63b2A9Bd65f516E49Cee75C9001FB5aa3588CB3c);
        
        poolIdRaw = 0x6a634d3c93c0b9402392bff565c8315f621558a49e2a00973922322ce19d4abb;

        vrfConfig = VrfConfig({
            subscriptionId: 88998617156719755233131168053267278275887903458817697624281142359274673133163,
            callbackGasLimit: 600_000,
            requestConfirmations: 3,
            vrfFee: 0
        });

        bjConfig.gameExpiryDelay = 5 minutes;
        bjConfig.minActionDelay  = 0;
        bjConfig.vrfTimeout = 5 minutes;
        bjConfig.tradingDelay = 1 minutes;
        bjConfig.gameAbandonmentPeriod = 24 hours;
    }

    function startGame() external payable nonReentrant {
        require(msg.value >= startGameFee, "Insufficient start game fee");
        
        Game storage g = games[msg.sender];
        
        // Check for unclaimed winnings from previous game
        if (g.gameId > 0) {
            PredictionMarket storage oldMarket = predictionMarkets[g.gameId];
            if (oldMarket.resolved) {
                uint256 unclaimed = _calculateClaimable(g.gameId, msg.sender);
                require(unclaimed == 0, "Claim previous winnings first");
            }
        }
        
        require(
            g.state == HandState.Inactive || 
            g.state == HandState.Busted || 
            g.state == HandState.Finished,
            "Game already active"
        );

        // Take 20% protocol fee from ETH payment
        uint256 protocolFee = (msg.value * START_GAME_PROTOCOL_FEE_BPS) / 10000;
        uint256 swapAmount = msg.value - protocolFee;
        
        // Send protocol fee
        (bool success, ) = payable(protocolOwner).call{value: protocolFee}("");
        require(success, "Protocol fee transfer failed");
        
        // Swap remaining 80%
        uint256 tokensReceived = _executeSwapToContract(swapAmount);
        
        uint256 requestId = _requestVrf();
        
        uint256 gameId = nextGameId++;

        g.player = msg.sender;
        g.gameId = gameId;
        g.startedAt = block.timestamp;
        g.lastActionAt = block.timestamp;
        g.vrfRequestTime = block.timestamp;
        g.tradingPeriodEnds = 0;
        g.tokensHeld = tokensReceived;
        g.state = HandState.PendingInitialDeal;
        
        delete g.playerHand;
        delete g.dealerHand;
        delete g.usedCards;

        vrfToPlayer[requestId] = msg.sender;

        emit GameStarted(msg.sender, gameId, msg.value, tokensReceived, protocolFee);
    }

    function hit() external nonReentrant {
        Game storage g = games[msg.sender];
        
        require(g.state == HandState.Active, "Cannot hit: game not active");
        require(g.playerHand.length > 0, "Cannot hit: no cards dealt yet");
        require(block.timestamp >= g.tradingPeriodEnds, "Cannot hit: trading period active");
        require(block.timestamp >= g.lastActionAt + bjConfig.minActionDelay, "Cannot hit: cooldown active");
        
        uint8 currentValue = _calculateHandValue(g.playerHand);
        require(currentValue < 21, "Cannot hit: already at 21");

        uint256 requestId = _requestVrf();
        vrfToPlayer[requestId] = msg.sender;
        
        g.state = HandState.PendingHit;
        g.lastActionAt = block.timestamp;
        g.vrfRequestTime = block.timestamp;
    }

    function stand() external nonReentrant {
        Game storage g = games[msg.sender];
        
        require(g.state == HandState.Active, "Cannot stand: game not active");
        require(g.playerHand.length > 0, "Cannot stand: no cards dealt yet");
        require(block.timestamp >= g.tradingPeriodEnds, "Cannot stand: trading period active");

        PredictionMarket storage pm = predictionMarkets[g.gameId];
        pm.tradingActive = false;

        uint256 requestId = _requestVrf();
        vrfToPlayer[requestId] = msg.sender;
        
        g.state = HandState.PendingStand;
        g.lastActionAt = block.timestamp;
        g.vrfRequestTime = block.timestamp;
        
        emit PlayerStood(msg.sender, g.gameId);
    }

    function cancelStuckGame() external nonReentrant {
        Game storage g = games[msg.sender];
        
        require(
            g.state == HandState.PendingInitialDeal || 
            g.state == HandState.PendingHit || 
            g.state == HandState.PendingStand,
            "Game not waiting for VRF"
        );
        
        require(
            block.timestamp >= g.vrfRequestTime + bjConfig.vrfTimeout,
            "VRF timeout not reached yet"
        );

        HandState previousState = g.state;
        g.state = HandState.Inactive;
        
        emit GameCancelled(msg.sender, g.gameId, _getStateName(previousState));
    }

    function forceResolvePush(address player) external nonReentrant {
        require(isAdmin[msg.sender], "Not admin");
        
        Game storage g = games[player];
        
        require(
            g.state == HandState.Active || 
            g.state == HandState.PendingHit || 
            g.state == HandState.PendingStand,
            "Game not in resolvable state"
        );
        
        require(
            block.timestamp >= g.lastActionAt + bjConfig.gameAbandonmentPeriod,
            "Game not abandoned yet"
        );

        uint8 playerValue = _calculateHandValue(g.playerHand);
        uint8 dealerValue = _calculateHandValue(g.dealerHand);

        PlayerStats storage stats = playerStats[player];
        stats.gamesPlayed++;
        stats.pushes++;

        g.state = HandState.Finished;
        
        PredictionMarket storage pm = predictionMarkets[g.gameId];
        pm.tradingActive = false;
        pm.resolved = true;
        pm.result = GameResult.Push;
        
        emit GameResolved(player, g.gameId, "Push - Abandoned", playerValue, dealerValue, GameResult.Push);
    }

    /* ─────────── Prediction Market Functions ─────────── */
    
    /**
     * @notice Buy YES shares with token approval (1% fee to staking)
     */
    function buyYes(uint256 gameId, uint256 tokensIn) external nonReentrant {
        PredictionMarket storage pm = predictionMarkets[gameId];
        require(pm.marketCreated, "Market not created");
        require(pm.tradingActive, "Trading not active");
        require(tokensIn > 0, "Must send tokens");
        
        pm.volume += tokensIn;
        
        // Calculate 1% fee
        uint256 feeAmount = (tokensIn * TRADING_FEE_BPS) / 10000;
        uint256 netTokens = tokensIn - feeAmount;
        
        // Transfer tokens from user
        require(IERC20Minimal(token1).transferFrom(msg.sender, address(this), tokensIn), "Transfer failed");
        
        // Send fee to staking contract
        if (feeAmount > 0 && address(appleStaking) != address(0)) {
            require(IERC20Minimal(token1).approve(address(appleStaking), feeAmount), "Approve failed");
            appleStaking.addRewards(feeAmount);
            emit TradingFeeCollected(gameId, msg.sender, feeAmount, "buyYes");
        }
        
        uint256 currentTotal = pm.yesDeposits + pm.noDeposits;
        uint256 allowedAmount = netTokens;
        
        // Cap at max deposits and refund excess to protocol owner
        if (currentTotal + netTokens > pm.maxTotalDeposits) {
            allowedAmount = pm.maxTotalDeposits - currentTotal;
            uint256 excess = netTokens - allowedAmount;
            require(IERC20Minimal(token1).transfer(protocolOwner, excess), "Excess transfer failed");
        }
        
        uint256 sharesOut = _calculateSharesOut(pm.yesSharesTotal, pm.yesDeposits, allowedAmount);
        
        pm.yesDeposits += allowedAmount;
        pm.yesSharesTotal += sharesOut;
        yesShares[gameId][msg.sender] += sharesOut;
        
        emit YesPurchased(gameId, msg.sender, allowedAmount, sharesOut, feeAmount);
    }

    /**
     * @notice Buy NO shares with token approval (1% fee to staking)
     */
    function buyNo(uint256 gameId, uint256 tokensIn) external nonReentrant {
        PredictionMarket storage pm = predictionMarkets[gameId];
        require(pm.marketCreated, "Market not created");
        require(pm.tradingActive, "Trading not active");
        require(tokensIn > 0, "Must send tokens");
        
        pm.volume += tokensIn;
        
        // Calculate 1% fee
        uint256 feeAmount = (tokensIn * TRADING_FEE_BPS) / 10000;
        uint256 netTokens = tokensIn - feeAmount;
        
        // Transfer tokens from user
        require(IERC20Minimal(token1).transferFrom(msg.sender, address(this), tokensIn), "Transfer failed");
        
        // Send fee to staking contract
        if (feeAmount > 0 && address(appleStaking) != address(0)) {
            require(IERC20Minimal(token1).approve(address(appleStaking), feeAmount), "Approve failed");
            appleStaking.addRewards(feeAmount);
            emit TradingFeeCollected(gameId, msg.sender, feeAmount, "buyNo");
        }
        
        uint256 currentTotal = pm.yesDeposits + pm.noDeposits;
        uint256 allowedAmount = netTokens;
        
        // Cap at max deposits and refund excess to protocol owner
        if (currentTotal + netTokens > pm.maxTotalDeposits) {
            allowedAmount = pm.maxTotalDeposits - currentTotal;
            uint256 excess = netTokens - allowedAmount;
            require(IERC20Minimal(token1).transfer(protocolOwner, excess), "Excess transfer failed");
        
        }
        
        uint256 sharesOut = _calculateSharesOut(pm.noSharesTotal, pm.noDeposits, allowedAmount);
        
        pm.noDeposits += allowedAmount;
        pm.noSharesTotal += sharesOut;
        noShares[gameId][msg.sender] += sharesOut;
        
        emit NoPurchased(gameId, msg.sender, allowedAmount, sharesOut, feeAmount);
    }

    /**
     * @notice Buy YES shares by swapping ETH to tokens (1% ETH fee to protocol owner)
     */
    function buyYesWithETH(uint256 gameId) external payable nonReentrant {
        PredictionMarket storage pm = predictionMarkets[gameId];
        require(pm.marketCreated, "Market not created");
        require(pm.tradingActive, "Trading not active");
        require(msg.value > 0, "No ETH sent");
        
        // Take 1% ETH fee to protocol owner
        uint256 feeAmount = (msg.value * TRADING_FEE_BPS) / 10000;
        uint256 swapAmount = msg.value - feeAmount;
        
        // Send fee to protocol owner
        (bool success, ) = payable(protocolOwner).call{value: feeAmount}("");
        require(success, "Fee transfer failed");
        
        // Swap remaining ETH
        uint256 balanceBefore = IERC20Minimal(token1).balanceOf(address(this));
        _executeSwapToContract(swapAmount);
        uint256 balanceAfter = IERC20Minimal(token1).balanceOf(address(this));
        
        uint256 tokensIn = balanceAfter - balanceBefore;
        
        pm.volume += tokensIn;
        
        uint256 currentTotal = pm.yesDeposits + pm.noDeposits;
        uint256 allowedAmount = tokensIn;
        
        // Cap at max deposits
        if (currentTotal + tokensIn > pm.maxTotalDeposits) {
            allowedAmount = pm.maxTotalDeposits - currentTotal;
            uint256 excess = tokensIn - allowedAmount;
            require(IERC20Minimal(token1).transfer(protocolOwner, excess), "Excess transfer failed");
        }
        
        uint256 sharesOut = _calculateSharesOut(pm.yesSharesTotal, pm.yesDeposits, allowedAmount);
        
        pm.yesDeposits += allowedAmount;
        pm.yesSharesTotal += sharesOut;
        yesShares[gameId][msg.sender] += sharesOut;
        
        emit TradingFeeCollected(gameId, msg.sender, feeAmount, "buyYesWithETH");
        emit YesPurchased(gameId, msg.sender, allowedAmount, sharesOut, feeAmount);
    }

    /**
     * @notice Buy NO shares by swapping ETH to tokens (1% ETH fee to protocol owner)
     */
    function buyNoWithETH(uint256 gameId) external payable nonReentrant {
        PredictionMarket storage pm = predictionMarkets[gameId];
        require(pm.marketCreated, "Market not created");
        require(pm.tradingActive, "Trading not active");
        require(msg.value > 0, "No ETH sent");
        
        // Take 1% ETH fee to protocol owner
        uint256 feeAmount = (msg.value * TRADING_FEE_BPS) / 10000;
        uint256 swapAmount = msg.value - feeAmount;
        
        // Send fee to protocol owner
        (bool success, ) = payable(protocolOwner).call{value: feeAmount}("");
        require(success, "Fee transfer failed");
        
        // Swap remaining ETH
        uint256 balanceBefore = IERC20Minimal(token1).balanceOf(address(this));
        _executeSwapToContract(swapAmount);
        uint256 balanceAfter = IERC20Minimal(token1).balanceOf(address(this));
        
        uint256 tokensIn = balanceAfter - balanceBefore;
        
        pm.volume += tokensIn;
        
        uint256 currentTotal = pm.yesDeposits + pm.noDeposits;
        uint256 allowedAmount = tokensIn;
        
        // Cap at max deposits
        if (currentTotal + tokensIn > pm.maxTotalDeposits) {
            allowedAmount = pm.maxTotalDeposits - currentTotal;
            uint256 excess = tokensIn - allowedAmount;
            require(IERC20Minimal(token1).transfer(protocolOwner, excess), "Excess transfer failed");
        }
        
        uint256 sharesOut = _calculateSharesOut(pm.noSharesTotal, pm.noDeposits, allowedAmount);
        
        pm.noDeposits += allowedAmount;
        pm.noSharesTotal += sharesOut;
        noShares[gameId][msg.sender] += sharesOut;
        
        emit TradingFeeCollected(gameId, msg.sender, feeAmount, "buyNoWithETH");
        emit NoPurchased(gameId, msg.sender, allowedAmount, sharesOut, feeAmount);
    }

    /**
     * @notice Sell YES shares for tokens (1% fee to staking)
     */
    function sellYes(uint256 gameId, uint256 sharesIn) external nonReentrant {
        PredictionMarket storage pm = predictionMarkets[gameId];
        require(pm.tradingActive, "Trading not active");
        require(yesShares[gameId][msg.sender] >= sharesIn, "Insufficient shares");
        require(sharesIn > 0, "Must sell shares");
        
        uint256 tokensOut = _calculateTokensOut(pm.yesSharesTotal, pm.yesDeposits, sharesIn);
        require(tokensOut <= pm.yesDeposits, "Insufficient liquidity");
        
        pm.volume += tokensOut;
        
        // Calculate 1% fee
        uint256 feeAmount = (tokensOut * TRADING_FEE_BPS) / 10000;
        uint256 netTokens = tokensOut - feeAmount;
        
        yesShares[gameId][msg.sender] -= sharesIn;
        pm.yesSharesTotal -= sharesIn;
        pm.yesDeposits -= tokensOut;
        
        // Send net tokens to user
        require(IERC20Minimal(token1).transfer(msg.sender, netTokens), "Transfer failed");
        
        // Send fee to staking contract
        if (feeAmount > 0 && address(appleStaking) != address(0)) {
            require(IERC20Minimal(token1).approve(address(appleStaking), feeAmount), "Approve failed");
            appleStaking.addRewards(feeAmount);
            emit TradingFeeCollected(gameId, msg.sender, feeAmount, "sellYes");
        }
        
        emit YesSold(gameId, msg.sender, sharesIn, netTokens, feeAmount);
    }

    /**
     * @notice Sell NO shares for tokens (1% fee to staking)
     */
    function sellNo(uint256 gameId, uint256 sharesIn) external nonReentrant {
        PredictionMarket storage pm = predictionMarkets[gameId];
        require(pm.tradingActive, "Trading not active");
        require(noShares[gameId][msg.sender] >= sharesIn, "Insufficient shares");
        require(sharesIn > 0, "Must sell shares");
        
        uint256 tokensOut = _calculateTokensOut(pm.noSharesTotal, pm.noDeposits, sharesIn);
        require(tokensOut <= pm.noDeposits, "Insufficient liquidity");
        
        pm.volume += tokensOut;
        
        // Calculate 1% fee
        uint256 feeAmount = (tokensOut * TRADING_FEE_BPS) / 10000;
        uint256 netTokens = tokensOut - feeAmount;
        
        noShares[gameId][msg.sender] -= sharesIn;
        pm.noSharesTotal -= sharesIn;
        pm.noDeposits -= tokensOut;
        
        // Send net tokens to user
        require(IERC20Minimal(token1).transfer(msg.sender, netTokens), "Transfer failed");
        
        // Send fee to staking contract
        if (feeAmount > 0 && address(appleStaking) != address(0)) {
            require(IERC20Minimal(token1).approve(address(appleStaking), feeAmount), "Approve failed");
            appleStaking.addRewards(feeAmount);
            emit TradingFeeCollected(gameId, msg.sender, feeAmount, "sellNo");
        }
        
        emit NoSold(gameId, msg.sender, sharesIn, netTokens, feeAmount);
    }

    /**
     * @notice Claim winnings or refund after game resolves (1% fee to staking)
     */
    function claimWinnings(uint256 gameId) external nonReentrant {
        uint256 payout = _calculateClaimable(gameId, msg.sender);
        require(payout > 0, "Nothing to claim");
        
        // Calculate 1% fee
        uint256 feeAmount = (payout * TRADING_FEE_BPS) / 10000;
        uint256 netPayout = payout - feeAmount;
        
        // Zero out shares
        yesShares[gameId][msg.sender] = 0;
        noShares[gameId][msg.sender] = 0;
        
        // Send net payout to user
        require(IERC20Minimal(token1).transfer(msg.sender, netPayout), "Transfer failed");
        
        // Send fee to staking contract
        if (feeAmount > 0 && address(appleStaking) != address(0)) {
            require(IERC20Minimal(token1).approve(address(appleStaking), feeAmount), "Approve failed");
            appleStaking.addRewards(feeAmount);
            emit TradingFeeCollected(gameId, msg.sender, feeAmount, "claimWinnings");
        }
        
        emit WinningsClaimed(gameId, msg.sender, netPayout, feeAmount);
    }

    /**
     * @notice Internal function to calculate claimable amount
     */
    function _calculateClaimable(uint256 gameId, address user) internal view returns (uint256) {
        PredictionMarket storage pm = predictionMarkets[gameId];
        if (!pm.resolved) return 0;
        
        uint256 payout = 0;
        
        if (pm.result == GameResult.Push) {
            uint256 userYesSharesAmount = yesShares[gameId][user];
            uint256 userNoSharesAmount = noShares[gameId][user];
            
            if (pm.yesSharesTotal > 0 && userYesSharesAmount > 0) {
                payout += (userYesSharesAmount * pm.yesDeposits) / pm.yesSharesTotal;
            }
            if (pm.noSharesTotal > 0 && userNoSharesAmount > 0) {
                payout += (userNoSharesAmount * pm.noDeposits) / pm.noSharesTotal;
            }
        } else if (pm.result == GameResult.Win) {
            uint256 userYesSharesAmount = yesShares[gameId][user];
            if (userYesSharesAmount > 0 && pm.yesSharesTotal > 0) {
                uint256 totalPot = pm.yesDeposits + pm.noDeposits;
                payout = (userYesSharesAmount * totalPot) / pm.yesSharesTotal;
            }
        } else {
            uint256 userNoSharesAmount = noShares[gameId][user];
            if (userNoSharesAmount > 0 && pm.noSharesTotal > 0) {
                uint256 totalPot = pm.yesDeposits + pm.noDeposits;
                payout = (userNoSharesAmount * totalPot) / pm.noSharesTotal;
            }
        }
        
        return payout;
    }

    function _calculateSharesOut(uint256 currentShares, uint256 currentDeposits, uint256 tokensIn) internal pure returns (uint256) {
        if (currentShares == 0 || currentDeposits == 0) {
            return tokensIn;
        }
        return (tokensIn * currentShares) / currentDeposits;
    }

    function _calculateTokensOut(uint256 currentShares, uint256 currentDeposits, uint256 sharesIn) internal pure returns (uint256) {
        require(currentShares > 0, "No shares");
        return (sharesIn * currentDeposits) / currentShares;
    }

    /* ─────────── VRF Callbacks ─────────── */

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        address player = vrfToPlayer[requestId];
        if (player == address(0)) return;
        
        Game storage g = games[player];

        uint256 randomness = randomWords[0];

        if (g.state == HandState.PendingInitialDeal) {
            _handleInitialDeal(g, randomness);
        } else if (g.state == HandState.PendingHit) {
            _handleHit(g, randomness);
        } else if (g.state == HandState.PendingStand) {
            _handleStand(g, randomness);
        }

        delete vrfToPlayer[requestId];
    }

    function _handleInitialDeal(Game storage g, uint256 randomness) internal {
        for (uint8 i = 0; i < 4; i++) {
            uint8 card = _drawUniqueCard(g, randomness);
            randomness = uint256(keccak256(abi.encodePacked(randomness, i)));
            
            if (i % 2 == 0) {
                g.playerHand.push(card);
            } else {
                g.dealerHand.push(card);
            }
        }

        uint8 playerValue = _calculateHandValue(g.playerHand);
        
        if (playerValue == 21 && g.playerHand.length == 2) {
            uint8 dealerValue = _calculateHandValue(g.dealerHand);
            
            PlayerStats storage stats = playerStats[g.player];
            stats.gamesPlayed++;
            
            uint256 refundAmount = g.tokensHeld;
            g.tokensHeld = 0;
            
            require(IERC20Minimal(token1).transfer(g.player, refundAmount), "Refund failed");
            
            if (dealerValue == 21 && g.dealerHand.length == 2) {
                g.state = HandState.Finished;
                stats.pushes++;

                emit GameResolved(g.player, g.gameId, "Push - Both Blackjack (No Market)", 21, 21, GameResult.Push);
            } else {
                g.state = HandState.Finished;
                stats.wins++;

                emit GameResolved(g.player, g.gameId, "Blackjack! (No Market)", 21, dealerValue, GameResult.Win);
            }
        } else {
            uint256 halfTokens = g.tokensHeld / 2;
            g.tokensHeld = 0;
            
            PredictionMarket storage pm = predictionMarkets[g.gameId];
            pm.gameId = g.gameId;
            pm.yesSharesTotal = halfTokens;
            pm.noSharesTotal = halfTokens;
            pm.yesDeposits = halfTokens;
            pm.noDeposits = halfTokens;
            pm.maxTotalDeposits = halfTokens * 100;
            pm.tradingActive = true;
            pm.resolved = false;
            pm.result = GameResult.Pending;
            pm.initialLiquidity = halfTokens;
            pm.marketCreated = true;
            pm.volume = halfTokens * 2;
            
            yesShares[g.gameId][g.player] = halfTokens;
            noShares[g.gameId][g.player] = halfTokens;
            
            g.state = HandState.Active;
            g.tradingPeriodEnds = block.timestamp + bjConfig.tradingDelay;
            
            emit MarketCreated(g.gameId, g.player, halfTokens, halfTokens, pm.maxTotalDeposits);
            emit TradingPeriodStarted(g.player, g.gameId, g.tradingPeriodEnds);
        }
        
        g.lastActionAt = block.timestamp;
    }

    function _handleHit(Game storage g, uint256 randomness) internal {
        uint8 card = _drawUniqueCard(g, randomness);
        g.playerHand.push(card);

        (string memory rank, string memory suit) = _getCardDisplay(card);
        emit PlayerHit(g.player, g.gameId, card, rank, suit);

        uint8 playerValue = _calculateHandValue(g.playerHand);
        
        if (playerValue > 21) {
            g.state = HandState.Busted;
            playerStats[g.player].gamesPlayed++;
            playerStats[g.player].busts++;
            playerStats[g.player].losses++;
            
            PredictionMarket storage pm = predictionMarkets[g.gameId];
            pm.tradingActive = false;
            pm.resolved = true;
            pm.result = GameResult.Lose;
            
            emit PlayerBusted(g.player, g.gameId, playerValue);
            emit GameResolved(g.player, g.gameId, "Bust", playerValue, _calculateHandValue(g.dealerHand), GameResult.Lose);
        } else {
            g.state = HandState.Active;
            g.tradingPeriodEnds = block.timestamp + bjConfig.tradingDelay;
            emit TradingPeriodStarted(g.player, g.gameId, g.tradingPeriodEnds);
        }
    }

    function _handleStand(Game storage g, uint256 randomness) internal {
        while (_calculateHandValue(g.dealerHand) < 17) {
            uint8 card = _drawUniqueCard(g, randomness);
            g.dealerHand.push(card);
            randomness = uint256(keccak256(abi.encodePacked(randomness, g.dealerHand.length)));
        }

        uint8 playerValue = _calculateHandValue(g.playerHand);
        uint8 dealerValue = _calculateHandValue(g.dealerHand);

        string memory result;
        GameResult marketResult;
        PlayerStats storage stats = playerStats[g.player];
        stats.gamesPlayed++;

        if (playerValue > 21) {
            result = "Bust";
            stats.losses++;
            stats.busts++;
            marketResult = GameResult.Lose;
        } else if (dealerValue > 21 || playerValue > dealerValue) {
            result = playerValue > dealerValue ? "Win" : "Win - Dealer Bust";
            stats.wins++;
            marketResult = GameResult.Win;
        } else if (playerValue == dealerValue) {
            result = "Push";
            stats.pushes++;
            marketResult = GameResult.Push;
        } else {
            result = "Lose";
            stats.losses++;
            marketResult = GameResult.Lose;
        }

        g.state = HandState.Finished;
        
        PredictionMarket storage pm = predictionMarkets[g.gameId];
        pm.resolved = true;
        pm.result = marketResult;
        
        emit GameResolved(g.player, g.gameId, result, playerValue, dealerValue, marketResult);
    }

    /* ─────────── Internal Helpers ─────────── */

    function _executeSwapToContract(uint256 ethAmount) internal returns (uint256 amountOut) {
        PoolKey memory key = ISuperStratView(hook).getPoolKey(PoolId.wrap(poolIdRaw));
        require(address(key.hooks) == hook, "wrong hook");
        require(Currency.unwrap(key.currency0) == address(0), "c0!=ETH");

        try MANAGER.unlock(
            abi.encode(
                SwapData({
                    key: key,
                    zeroForOne: true,
                    amountIn: ethAmount,
                    recipient: address(this),
                    payer: msg.sender,
                    payC0AsNative: true
                })
            )
        ) returns (bytes memory ret) {
            amountOut = abi.decode(ret, (uint256));
        } catch (bytes memory err) {
            revert SwapReverted(err);
        }
        
        return amountOut;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(MANAGER), "unauthorized");
        SwapData memory s = abi.decode(data, (SwapData));

        if (s.zeroForOne) {
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
        revert("unsupported path");
    }

    function _drawUniqueCard(Game storage g, uint256 randomness) internal returns (uint8) {
        uint8 card;
        bool isUnique = false;
        uint256 attempts = 0;
        
        while (!isUnique && attempts < 52) {
            card = uint8(randomness % 52);
            randomness = uint256(keccak256(abi.encodePacked(randomness, attempts)));
            
            isUnique = true;
            for (uint256 i = 0; i < g.usedCards.length; i++) {
                if (g.usedCards[i] == card) {
                    isUnique = false;
                    break;
                }
            }
            attempts++;
        }
        
        g.usedCards.push(card);
        return card;
    }

    function _getCardDisplay(uint8 cardId) internal pure returns (string memory rank, string memory suit) {
        string[13] memory ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
        string[4] memory suits = ["Clubs", "Diamonds", "Hearts", "Spades"];
        
        rank = ranks[cardId % 13];
        suit = suits[cardId / 13];
    }

    function _cardValue(uint8 cardId) internal pure returns (uint8) {
        uint8 rank = cardId % 13;
        if (rank == 0) return 11;
        if (rank >= 9) return 10;
        return rank + 1;
    }

    function _calculateHandValue(uint8[] storage hand) internal view returns (uint8) {
        if (hand.length == 0) return 0;
        
        uint8 total = 0;
        uint8 aces = 0;

        for (uint8 i = 0; i < hand.length; i++) {
            uint8 value = _cardValue(hand[i]);
            total += value;
            if (value == 11) aces++;
        }

        while (total > 21 && aces > 0) {
            total -= 10;
            aces--;
        }

        return total;
    }

    function _getStateName(HandState state) internal pure returns (string memory) {
        if (state == HandState.PendingInitialDeal) return "waiting for initial deal";
        if (state == HandState.PendingHit) return "waiting for hit card";
        if (state == HandState.PendingStand) return "waiting for dealer cards";
        return "unknown state";
    }

    function _requestVrf() internal returns (uint256) {
        return s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: KEY_HASH,
                subId: vrfConfig.subscriptionId,
                requestConfirmations: vrfConfig.requestConfirmations,
                callbackGasLimit: vrfConfig.callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: NATIVE_PAYMENT})
                )
            })
        );
    }

    /* ─────────── View Functions ─────────── */

    function getQuickStatus(address player) external view returns (
        string memory status,
        uint8 playerTotal,
        uint8 dealerTotal,
        bool canAct,
        uint256 tradingPeriodEnds,
        uint256 gameId
    ) {
        Game storage g = games[player];
        
        string memory statusStr;
        if (g.state == HandState.Inactive) statusStr = "Inactive";
        else if (g.state == HandState.PendingInitialDeal) statusStr = "Dealing";
        else if (g.state == HandState.Active) statusStr = "Active";
        else if (g.state == HandState.PendingHit) statusStr = "Hitting";
        else if (g.state == HandState.PendingStand) statusStr = "Standing";
        else if (g.state == HandState.Busted) statusStr = "Busted";
        else statusStr = "Finished";
        
        bool tradingOver = block.timestamp >= g.tradingPeriodEnds;
        
        return (
            statusStr,
            _calculateHandValue(g.playerHand),
            _calculateHandValue(g.dealerHand),
            g.state == HandState.Active && tradingOver,
            g.tradingPeriodEnds,
            g.gameId
        );
    }

    function getQuickMarketStatus(uint256 gameId) external view returns (
        uint256 totalYesShares,
        uint256 totalNoShares,
        uint256 totalDeposits,
        uint256 maxDeposits,
        uint256 yesPrice,
        uint256 noPrice,
        bool tradingActive,
        bool resolved,
        string memory resultString,
        bool marketCreated
    ) {
        PredictionMarket storage pm = predictionMarkets[gameId];
        
        string memory result;
        if (pm.result == GameResult.Pending) result = "Pending";
        else if (pm.result == GameResult.Win) result = "Yes Wins";
        else if (pm.result == GameResult.Lose) result = "No Wins";
        else result = "Push";
        
        uint256 totalDep = pm.yesDeposits + pm.noDeposits;
        uint256 yesPriceBps = totalDep > 0 ? (pm.yesDeposits * 10000) / totalDep : 5000;
        uint256 noPriceBps = totalDep > 0 ? (pm.noDeposits * 10000) / totalDep : 5000;
        
        return (
            pm.yesSharesTotal,
            pm.noSharesTotal,
            totalDep,
            pm.maxTotalDeposits,
            yesPriceBps,
            noPriceBps,
            pm.tradingActive,
            pm.resolved,
            result,
            pm.marketCreated
        );
    }

    function getGameDisplay(address player) external view returns (GameDisplay memory) {
        Game storage g = games[player];
        
        GameDisplay memory display;
        display.gameId = g.gameId;
        
        if (g.state == HandState.Inactive) display.status = "No active game";
        else if (g.state == HandState.PendingInitialDeal) display.status = "Dealing cards...";
        else if (g.state == HandState.Active && block.timestamp < g.tradingPeriodEnds) {
            display.status = "Trading period - Cannot act yet";
        } else if (g.state == HandState.Active) {
            display.status = "Your turn";
        } else if (g.state == HandState.PendingHit) display.status = "Drawing card...";
        else if (g.state == HandState.PendingStand) display.status = "Dealer playing...";
        else if (g.state == HandState.Busted) display.status = "Busted!";
        else display.status = "Game finished";
        
        display.playerCards = new CardDisplay[](g.playerHand.length);
        for (uint256 i = 0; i < g.playerHand.length; i++) {
            uint8 cardId = g.playerHand[i];
            (string memory rank, string memory suit) = _getCardDisplay(cardId);
            display.playerCards[i] = CardDisplay({
                rank: rank,
                suit: suit,
                value: _cardValue(cardId)
            });
        }
        
        display.dealerCards = new CardDisplay[](g.dealerHand.length);
        for (uint256 i = 0; i < g.dealerHand.length; i++) {
            uint8 cardId = g.dealerHand[i];
            (string memory rank, string memory suit) = _getCardDisplay(cardId);
            display.dealerCards[i] = CardDisplay({
                rank: rank,
                suit: suit,
                value: _cardValue(cardId)
            });
        }
        
        display.playerTotal = _calculateHandValue(g.playerHand);
        display.dealerTotal = _calculateHandValue(g.dealerHand);
        
        bool tradingPeriodOver = block.timestamp >= g.tradingPeriodEnds;
        bool cooledDown = block.timestamp >= g.lastActionAt + bjConfig.minActionDelay;
        bool hasCards = g.playerHand.length > 0;
        bool notAt21 = display.playerTotal < 21;
        
        display.canHit = g.state == HandState.Active && tradingPeriodOver && cooledDown && hasCards && notAt21;
        display.canStand = g.state == HandState.Active && tradingPeriodOver && hasCards;
        display.canStartNew = g.state == HandState.Inactive || 
                             g.state == HandState.Busted || 
                             g.state == HandState.Finished;
        display.canCancelStuck = (g.state == HandState.PendingInitialDeal || 
                                  g.state == HandState.PendingHit || 
                                  g.state == HandState.PendingStand) &&
                                 block.timestamp >= g.vrfRequestTime + bjConfig.vrfTimeout;
        display.canAdminResolve = (g.state == HandState.Active || 
                                   g.state == HandState.PendingHit || 
                                   g.state == HandState.PendingStand) &&
                                  block.timestamp >= g.lastActionAt + bjConfig.gameAbandonmentPeriod;
        
        display.startedAt = g.startedAt;
        display.lastActionAt = g.lastActionAt;
        display.tradingPeriodEnds = g.tradingPeriodEnds;
        
        if (g.state == HandState.Active && block.timestamp < g.tradingPeriodEnds) {
            display.secondsUntilCanAct = g.tradingPeriodEnds - block.timestamp;
        } else {
            display.secondsUntilCanAct = 0;
        }
        
        return display;
    }

    function getMarketDisplay(uint256 gameId, address user) external view returns (MarketDisplay memory) {
        PredictionMarket storage pm = predictionMarkets[gameId];
        
        MarketDisplay memory display;
        display.gameId = gameId;
        display.yesSharesTotal = pm.yesSharesTotal;
        display.noSharesTotal = pm.noSharesTotal;
        display.yesDeposits = pm.yesDeposits;
        display.noDeposits = pm.noDeposits;
        display.totalDeposits = pm.yesDeposits + pm.noDeposits;
        display.maxTotalDeposits = pm.maxTotalDeposits;
        
        if (display.totalDeposits > 0) {
            display.yesPrice = (pm.yesDeposits * 10000) / display.totalDeposits;
            display.noPrice = (pm.noDeposits * 10000) / display.totalDeposits;
        } else {
            display.yesPrice = 5000;
            display.noPrice = 5000;
        }
        
        display.tradingActive = pm.tradingActive;
        display.resolved = pm.resolved;
        display.result = pm.result;
        display.userYesShares = yesShares[gameId][user];
        display.userNoShares = noShares[gameId][user];
        display.marketCreated = pm.marketCreated;
        display.userClaimable = _calculateClaimable(gameId, user);
        display.volume = pm.volume;
        
        return display;
    }

    function getClaimableAmount(uint256 gameId, address user) external view returns (uint256) {
        return _calculateClaimable(gameId, user);
    }

    function getPlayerGameIds(address player) external view returns (uint256[] memory activeGameIds) {
        Game storage g = games[player];
        if (g.gameId > 0) {
            activeGameIds = new uint256[](1);
            activeGameIds[0] = g.gameId;
        } else {
            activeGameIds = new uint256[](0);
        }
        return activeGameIds;
    }

    function getUnclaimedTokensInMarket(uint256 gameId) external view returns (uint256) {
        PredictionMarket storage pm = predictionMarkets[gameId];
        if (!pm.resolved) return 0;
        
        return pm.yesDeposits + pm.noDeposits;
    }

    function getStats(address player) external view returns (
        uint256 gamesPlayed,
        uint256 wins,
        uint256 losses,
        uint256 pushes,
        uint256 busts,
        uint256 winRate
    ) {
        PlayerStats storage stats = playerStats[player];
        
        uint256 rate = 0;
        if (stats.gamesPlayed > 0) {
            rate = (stats.wins * 100) / stats.gamesPlayed;
        }
        
        return (
            stats.gamesPlayed,
            stats.wins,
            stats.losses,
            stats.pushes,
            stats.busts,
            rate
        );
    }

    function getMinStartGameFee() external view returns (uint256) {
        return startGameFee;
    }

    /* ─────────── Admin Functions ─────────── */

    function setVrfConfig(
        uint256 subscriptionId,
        uint32 callbackGasLimit,
        uint16 requestConfirmations
    ) external {
        require(isAdmin[msg.sender], "Not admin");
        vrfConfig.subscriptionId = subscriptionId;
        vrfConfig.callbackGasLimit = callbackGasLimit;
        vrfConfig.requestConfirmations = requestConfirmations;
    }

    function setBjConfig(
        uint256 gameExpiryDelay,
        uint256 minActionDelay,
        uint256 vrfTimeout,
        uint256 tradingDelay,
        uint256 gameAbandonmentPeriod
    ) external {
        require(isAdmin[msg.sender], "Not admin");
        bjConfig.gameExpiryDelay = gameExpiryDelay;
        bjConfig.minActionDelay = minActionDelay;
        bjConfig.vrfTimeout = vrfTimeout;
        bjConfig.tradingDelay = tradingDelay;
        bjConfig.gameAbandonmentPeriod = gameAbandonmentPeriod;
    }

    function setStartGameFee(uint256 fee) external {
        require(isAdmin[msg.sender], "Not admin");
        require(fee <= 0.1 ether, "Fee too high");
        startGameFee = fee;
    }

    function setHook(address h) external {
        require(isAdmin[msg.sender], "Not admin");
        require(h != address(0), "zero hook");
        hook = h;
    }

    function setPoolId(bytes32 id) external {
        require(isAdmin[msg.sender], "Not admin");
        poolIdRaw = id;
    }

    function setProtocolOwner(address newOwner) external {
        require(isAdmin[msg.sender], "Not admin");
        require(newOwner != address(0), "zero address");
        protocolOwner = newOwner;
    }

    function setStakingContract(address newStaking) external {
        require(isAdmin[msg.sender], "Not admin");
        require(newStaking != address(0), "zero address");
        appleStaking = IAppleStaking(newStaking);
    }

    function setAdmin(address admin, bool status) external {
        require(isAdmin[msg.sender], "Not admin");
        isAdmin[admin] = status;
    }

    receive() external payable {}
    fallback() external payable {}
}