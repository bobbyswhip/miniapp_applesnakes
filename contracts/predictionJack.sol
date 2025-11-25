// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
 
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
 
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
 
interface IPoolManagerExt is IPoolManager {
    function settle(Currency currency) external;
}
 
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}
 
interface ISuperStratView {
    function getPoolKey(PoolId id) external view returns (PoolKey memory);
}
 
interface IPredictionMarketHub {
    enum GameResult { Pending, Win, Lose, Push }
 
    function createMarket(uint256 gameId, address creator, uint256 initialLiquidity) external returns (bool);
    function pauseTrading(uint256 gameId) external;
    function resumeTrading(uint256 gameId) external;
    function resolveMarket(uint256 gameId, GameResult result) external;
    function marketExists(uint256 gameId) external view returns (bool);
    function isMarketActive(uint256 gameId) external view returns (bool);
    function isMarketResolved(uint256 gameId) external view returns (bool);
    function getClaimableAmount(uint256 gameId, address user) external view returns (uint256);
}
 
error SwapReverted(bytes data);
 
/**
 * @title PredictionJack - OPTIMIZED FOR VRF GAS
 * @notice Gas optimizations:
 * 1. Removed redundant checks in callback
 * 2. Simplified market creation path
 * 3. Reduced storage reads
 * 4. Permanent approval set once
 */
contract PredictionJack is VRFConsumerBaseV2Plus {
    using BalanceDeltaLibrary for BalanceDelta;
 
    address public constant COORDINATOR = 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634;
    bytes32 public constant KEY_HASH = 0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab;
    uint32 public constant NUM_WORDS = 1;
    bool public constant NATIVE_PAYMENT = true;
 
    IPoolManagerExt public constant MANAGER = IPoolManagerExt(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    IPredictionMarketHub public marketHub;
 
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
 
    address public hook = 0x77e180e90130FA6e6A4bf4d07cf2032f5f2B70C8;
    bytes32 public poolIdRaw = 0x6a634d3c93c0b9402392bff565c8315f621558a49e2a00973922322ce19d4abb;
    address public token1 = 0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6;
    address public protocolOwner;
 
    uint256 public constant START_GAME_PROTOCOL_FEE_BPS = 2000;
    uint256 public constant NO_MARKET_RAKE_BPS = 500;
 
    uint256 public startGameFee = 0.00069 ether;
    uint256 public nextGameId = 1;
    
    // NEW: Track if we've approved hub (do once)
    bool private hubApproved;
 
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
        bool marketCreated;
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
        bool marketCreated;
    }
 
    struct SwapData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        address recipient;
        address payer;
        bool payC0AsNative;
    }
 
    struct GameInfo {
        uint256 gameId;
        address player;
        HandState state;
        uint256 startedAt;
        uint256 lastActionAt;
        uint8 playerTotal;
        uint8 dealerTotal;
        bool marketCreated;
    }
 
    mapping(address => Game) public games;
    mapping(address => PlayerStats) public playerStats;
    mapping(uint256 => address) public vrfToPlayer;
 
    uint256[] private activeGameIds;
    uint256[] private inactiveGameIds;
    mapping(uint256 => uint256) private activeGameIndex;
    mapping(uint256 => uint256) private inactiveGameIndex;
    mapping(uint256 => address) public gameIdToPlayer;
 
    event GameStarted(address indexed player, uint256 gameId, uint256 feeIn, uint256 tokensReceived, uint256 protocolFee);
    event GameStartedWithTokens(address indexed player, uint256 gameId, uint256 tokensIn, uint256 tokensForGame, uint256 protocolFee);
    event MarketCreated(uint256 indexed gameId, address indexed player, uint256 initialLiquidityYes, uint256 initialLiquidityNo);
    event PlayerHit(address indexed player, uint256 indexed gameId, uint8 cardId, string rank, string suit);
    event PlayerStood(address indexed player, uint256 indexed gameId);
    event GameResolved(address indexed player, uint256 indexed gameId, string result, uint8 playerValue, uint8 dealerValue, GameResult marketResult);
    event PlayerBusted(address indexed player, uint256 indexed gameId, uint8 playerValue);
    event GameCancelled(address indexed player, uint256 indexed gameId, string reason, uint256 tokensRefunded);
    event GameForceResolved(address indexed player, uint256 indexed gameId, address indexed admin, string reason);
    event TradingPeriodStarted(address indexed player, uint256 indexed gameId, uint256 endsAt);
    event NoMarketRefund(address indexed player, uint256 indexed gameId, uint256 tokensRefunded, uint256 rakeTaken, string reason);
 
    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }
 
    constructor(address _marketHub) VRFConsumerBaseV2Plus(COORDINATOR) {
        isAdmin[msg.sender] = true;
        protocolOwner = msg.sender;
        marketHub = IPredictionMarketHub(_marketHub);
 
        poolIdRaw = 0x6a634d3c93c0b9402392bff565c8315f621558a49e2a00973922322ce19d4abb;
 
        vrfConfig = VrfConfig({
            subscriptionId: 88998617156719755233131168053267278275887903458817697624281142359274673133163,
            callbackGasLimit: 2500000, // SET TO MAX
            requestConfirmations: 3,
            vrfFee: 0
        });
 
        bjConfig.gameExpiryDelay = 5 minutes;
        bjConfig.minActionDelay = 0;
        bjConfig.vrfTimeout = 5 minutes;
        bjConfig.tradingDelay = 1 minutes;
        bjConfig.gameAbandonmentPeriod = 24 hours;
        
        // OPTIMIZATION: Approve hub once with max amount
        IERC20Minimal(token1).approve(_marketHub, type(uint256).max);
        hubApproved = true;
    }
 
    /* ─────────── Game Start Functions ─────────── */
 
    function startGame() external payable nonReentrant {
        require(msg.value >= startGameFee, "Insufficient start game fee");
 
        Game storage g = games[msg.sender];
 
        if (g.gameId > 0 && g.marketCreated) {
            if (marketHub.isMarketResolved(g.gameId)) {
                uint256 unclaimed = marketHub.getClaimableAmount(g.gameId, msg.sender);
                require(unclaimed == 0, "Claim previous winnings first");
            }
        }
 
        require(
            g.state == HandState.Inactive || 
            g.state == HandState.Busted || 
            g.state == HandState.Finished,
            "Game already active"
        );
 
        uint256 protocolFee = (msg.value * START_GAME_PROTOCOL_FEE_BPS) / 10000;
        uint256 swapAmount = msg.value - protocolFee;
 
        (bool success, ) = payable(protocolOwner).call{value: protocolFee}("");
        require(success, "Protocol fee transfer failed");
 
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
        g.marketCreated = false;
 
        delete g.playerHand;
        delete g.dealerHand;
        delete g.usedCards;
 
        vrfToPlayer[requestId] = msg.sender;
        gameIdToPlayer[gameId] = msg.sender;
 
        _addToActiveGames(gameId);
 
        emit GameStarted(msg.sender, gameId, msg.value, tokensReceived, protocolFee);
    }
 
    function startGameWithTokens(uint256 tokenAmount) external nonReentrant {
        require(tokenAmount > 0, "Must send tokens");
 
        Game storage g = games[msg.sender];
 
        if (g.gameId > 0 && g.marketCreated) {
            if (marketHub.isMarketResolved(g.gameId)) {
                uint256 unclaimed = marketHub.getClaimableAmount(g.gameId, msg.sender);
                require(unclaimed == 0, "Claim previous winnings first");
            }
        }
 
        require(
            g.state == HandState.Inactive || 
            g.state == HandState.Busted || 
            g.state == HandState.Finished,
            "Game already active"
        );
 
        require(IERC20Minimal(token1).transferFrom(msg.sender, address(this), tokenAmount), "Transfer failed");
 
        uint256 protocolFee = (tokenAmount * START_GAME_PROTOCOL_FEE_BPS) / 10000;
        uint256 gameTokens = tokenAmount - protocolFee;
 
        require(IERC20Minimal(token1).transfer(protocolOwner, protocolFee), "Protocol fee transfer failed");
 
        uint256 requestId = _requestVrf();
        uint256 gameId = nextGameId++;
 
        g.player = msg.sender;
        g.gameId = gameId;
        g.startedAt = block.timestamp;
        g.lastActionAt = block.timestamp;
        g.vrfRequestTime = block.timestamp;
        g.tradingPeriodEnds = 0;
        g.tokensHeld = gameTokens;
        g.state = HandState.PendingInitialDeal;
        g.marketCreated = false;
 
        delete g.playerHand;
        delete g.dealerHand;
        delete g.usedCards;
 
        vrfToPlayer[requestId] = msg.sender;
        gameIdToPlayer[gameId] = msg.sender;
 
        _addToActiveGames(gameId);
 
        emit GameStartedWithTokens(msg.sender, gameId, tokenAmount, gameTokens, protocolFee);
    }
 
    /* ─────────── Player Actions ─────────── */
 
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
 
        if (g.marketCreated) {
            marketHub.pauseTrading(g.gameId);
        }
 
        uint256 requestId = _requestVrf();
        vrfToPlayer[requestId] = msg.sender;
 
        g.state = HandState.PendingStand;
        g.lastActionAt = block.timestamp;
        g.vrfRequestTime = block.timestamp;
 
        emit PlayerStood(msg.sender, g.gameId);
    }
 
    /* ─────────── Cancel / Recovery Functions ─────────── */
 
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
        uint256 refundAmount = 0;
 
        if (previousState == HandState.PendingInitialDeal && g.tokensHeld > 0) {
            refundAmount = g.tokensHeld;
            g.tokensHeld = 0;
            require(IERC20Minimal(token1).transfer(msg.sender, refundAmount), "Refund failed");
        }
 
        g.state = HandState.Finished;
 
        if (g.marketCreated && !marketHub.isMarketResolved(g.gameId)) {
            marketHub.resolveMarket(g.gameId, IPredictionMarketHub.GameResult.Push);
        }
 
        _moveToInactiveGames(g.gameId);
 
        emit GameCancelled(msg.sender, g.gameId, _getStateName(previousState), refundAmount);
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
 
        if (g.marketCreated && !marketHub.isMarketResolved(g.gameId)) {
            marketHub.resolveMarket(g.gameId, IPredictionMarketHub.GameResult.Push);
        }
 
        _moveToInactiveGames(g.gameId);
 
        emit GameForceResolved(player, g.gameId, msg.sender, "Abandoned game resolved as push");
        emit GameResolved(player, g.gameId, "Push - Abandoned", playerValue, dealerValue, GameResult.Push);
    }
 
    /* ─────────── Guaranteed Outcome Detection ─────────── */
 
    function _isDealerHandFinal(uint8 dealerValue) internal pure returns (bool) {
        return dealerValue >= 17;
    }
 
    function _checkGuaranteedOutcome(uint8 playerValue, uint8 dealerValue) 
        internal 
        pure 
        returns (bool isGuaranteed, GameResult result) 
    {
        if (playerValue > 21) {
            return (true, GameResult.Lose);
        }
 
        if (dealerValue > 21) {
            return (true, GameResult.Win);
        }
 
        if (_isDealerHandFinal(dealerValue)) {
            if (playerValue > dealerValue) {
                return (true, GameResult.Win);
            }
            if (playerValue == dealerValue) {
                return (true, GameResult.Push);
            }
        }
 
        return (false, GameResult.Pending);
    }
 
    function _refundWithRake(Game storage g, string memory reason) internal {
        uint256 totalTokens = g.tokensHeld;
        g.tokensHeld = 0;
 
        if (totalTokens == 0) return;
 
        uint256 rake = (totalTokens * NO_MARKET_RAKE_BPS) / 10000;
        uint256 refund = totalTokens - rake;
 
        if (rake > 0) {
            require(IERC20Minimal(token1).transfer(protocolOwner, rake), "Rake transfer failed");
        }
 
        if (refund > 0) {
            require(IERC20Minimal(token1).transfer(g.player, refund), "Refund failed");
        }
 
        emit NoMarketRefund(g.player, g.gameId, refund, rake, reason);
    }
 
    function _resolveGuaranteedOutcome(
        Game storage g, 
        uint8 playerValue, 
        uint8 dealerValue, 
        GameResult result,
        string memory reason
    ) internal {
        PlayerStats storage stats = playerStats[g.player];
        stats.gamesPlayed++;
 
        if (result == GameResult.Win) {
            stats.wins++;
        } else if (result == GameResult.Lose) {
            stats.losses++;
            if (playerValue > 21) {
                stats.busts++;
            }
        } else {
            stats.pushes++;
        }
 
        _refundWithRake(g, reason);
 
        g.state = HandState.Finished;
        _moveToInactiveGames(g.gameId);
 
        emit GameResolved(g.player, g.gameId, reason, playerValue, dealerValue, result);
    }
 
    function _closeMarketWithGuaranteedOutcome(
        Game storage g,
        uint8 playerValue,
        uint8 dealerValue,
        GameResult result,
        string memory reason
    ) internal {
        PlayerStats storage stats = playerStats[g.player];
        stats.gamesPlayed++;
 
        if (result == GameResult.Win) {
            stats.wins++;
        } else if (result == GameResult.Lose) {
            stats.losses++;
            if (playerValue > 21) {
                stats.busts++;
            }
        } else {
            stats.pushes++;
        }
 
        g.state = HandState.Finished;
 
        if (g.marketCreated) {
            marketHub.resolveMarket(g.gameId, IPredictionMarketHub.GameResult(uint8(result)));
        }
 
        _moveToInactiveGames(g.gameId);
 
        emit GameResolved(g.player, g.gameId, reason, playerValue, dealerValue, result);
    }
 
    /* ─────────── Game Tracking ─────────── */
 
    function _addToActiveGames(uint256 gameId) internal {
        if (activeGameIndex[gameId] == 0) {
            activeGameIds.push(gameId);
            activeGameIndex[gameId] = activeGameIds.length;
        }
    }
 
    function _moveToInactiveGames(uint256 gameId) internal {
        uint256 activeIdx = activeGameIndex[gameId];
        if (activeIdx > 0) {
            activeIdx--;
 
            uint256 lastGameId = activeGameIds[activeGameIds.length - 1];
            activeGameIds[activeIdx] = lastGameId;
            activeGameIndex[lastGameId] = activeIdx + 1;
 
            activeGameIds.pop();
            delete activeGameIndex[gameId];
        }
 
        if (inactiveGameIndex[gameId] == 0) {
            inactiveGameIds.push(gameId);
            inactiveGameIndex[gameId] = inactiveGameIds.length;
        }
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
 
    /**
     * @notice Handle initial deal - GAS OPTIMIZED
     * @dev CRITICAL OPTIMIZATIONS:
     * 1. No redundant approve (done in constructor)
     * 2. Simplified market creation
     * 3. Reduced storage operations
     */
    function _handleInitialDeal(Game storage g, uint256 randomness) internal {
        // Deal 4 cards - OPTIMIZED: fewer storage writes
        uint8[4] memory cards;
        for (uint8 i = 0; i < 4; i++) {
            cards[i] = _drawUniqueCard(g, randomness);
            randomness = uint256(keccak256(abi.encodePacked(randomness, i)));
        }
        
        g.playerHand.push(cards[0]);
        g.dealerHand.push(cards[1]);
        g.playerHand.push(cards[2]);
        g.dealerHand.push(cards[3]);
 
        uint8 playerValue = _calculateHandValue(g.playerHand);
        uint8 dealerValue = _calculateHandValue(g.dealerHand);
 
        bool playerBlackjack = (playerValue == 21 && g.playerHand.length == 2);
        bool dealerBlackjack = (dealerValue == 21 && g.dealerHand.length == 2);
 
        // Case 1: Blackjack scenarios - LOW GAS PATH
        if (playerBlackjack || dealerBlackjack) {
            PlayerStats storage stats = playerStats[g.player];
            stats.gamesPlayed++;
 
            GameResult result;
            if (playerBlackjack && dealerBlackjack) {
                stats.pushes++;
                result = GameResult.Push;
            } else if (playerBlackjack) {
                stats.wins++;
                result = GameResult.Win;
            } else {
                stats.losses++;
                result = GameResult.Lose;
            }
 
            _refundWithRake(g, playerBlackjack && dealerBlackjack ? "Push - Both Blackjack" : (playerBlackjack ? "Blackjack!" : "Dealer Blackjack"));
 
            g.state = HandState.Finished;
            g.lastActionAt = block.timestamp;
            _moveToInactiveGames(g.gameId);
 
            emit GameResolved(g.player, g.gameId, "Blackjack", playerValue, dealerValue, result);
            return;
        }
 
        // Case 2: Guaranteed outcomes - LOW GAS PATH
        (bool isGuaranteed, GameResult guaranteedResult) = _checkGuaranteedOutcome(playerValue, dealerValue);
 
        if (isGuaranteed) {
            _resolveGuaranteedOutcome(
                g, 
                playerValue, 
                dealerValue, 
                guaranteedResult, 
                guaranteedResult == GameResult.Win ? "Guaranteed Win" : (guaranteedResult == GameResult.Push ? "Guaranteed Push" : "Guaranteed Loss")
            );
            g.lastActionAt = block.timestamp;
            return;
        }
 
        // Case 3: Normal game - OPTIMIZED MARKET CREATION
        uint256 halfTokens = g.tokensHeld / 2;
        
        // OPTIMIZATION: No approve needed (already approved in constructor with max)
        // Just call createMarket directly
        bool success = marketHub.createMarket(g.gameId, g.player, halfTokens);
        
        if (!success) {
            // Market creation failed - refund with rake
            _refundWithRake(g, "Market creation failed");
            g.state = HandState.Finished;
            _moveToInactiveGames(g.gameId);
            return;
        }
        
        // ONLY set to 0 after successful market creation
        g.tokensHeld = 0;
        g.marketCreated = true;
        g.state = HandState.Active;
        g.tradingPeriodEnds = block.timestamp + bjConfig.tradingDelay;
        g.lastActionAt = block.timestamp;
 
        emit MarketCreated(g.gameId, g.player, halfTokens, halfTokens);
        emit TradingPeriodStarted(g.player, g.gameId, g.tradingPeriodEnds);
    }
 
    function _handleHit(Game storage g, uint256 randomness) internal {
        uint8 card = _drawUniqueCard(g, randomness);
        g.playerHand.push(card);
 
        (string memory rank, string memory suit) = _getCardDisplay(card);
        emit PlayerHit(g.player, g.gameId, card, rank, suit);
 
        uint8 playerValue = _calculateHandValue(g.playerHand);
        uint8 dealerValue = _calculateHandValue(g.dealerHand);
 
        (bool isGuaranteed, GameResult guaranteedResult) = _checkGuaranteedOutcome(playerValue, dealerValue);
 
        if (isGuaranteed) {
            if (playerValue > 21) {
                emit PlayerBusted(g.player, g.gameId, playerValue);
            }
            
            _closeMarketWithGuaranteedOutcome(
                g, 
                playerValue, 
                dealerValue, 
                guaranteedResult, 
                playerValue > 21 ? "Bust" : (guaranteedResult == GameResult.Win ? "Win - Guaranteed" : (guaranteedResult == GameResult.Push ? "Push - Guaranteed" : "Lose - Guaranteed"))
            );
            return;
        }
 
        g.state = HandState.Active;
        g.tradingPeriodEnds = block.timestamp + bjConfig.tradingDelay;
        g.lastActionAt = block.timestamp;
 
        emit TradingPeriodStarted(g.player, g.gameId, g.tradingPeriodEnds);
    }
 
    function _handleStand(Game storage g, uint256 randomness) internal {
        // Dealer draws to 17
        while (_calculateHandValue(g.dealerHand) < 17) {
            uint8 card = _drawUniqueCard(g, randomness);
            g.dealerHand.push(card);
            randomness = uint256(keccak256(abi.encodePacked(randomness, g.dealerHand.length)));
        }
 
        uint8 playerValue = _calculateHandValue(g.playerHand);
        uint8 dealerValue = _calculateHandValue(g.dealerHand);
 
        // Determine result
        GameResult marketResult;
        PlayerStats storage stats = playerStats[g.player];
        stats.gamesPlayed++;
 
        if (playerValue > 21) {
            stats.losses++;
            stats.busts++;
            marketResult = GameResult.Lose;
        } else if (dealerValue > 21 || playerValue > dealerValue) {
            stats.wins++;
            marketResult = GameResult.Win;
        } else if (playerValue == dealerValue) {
            stats.pushes++;
            marketResult = GameResult.Push;
        } else {
            stats.losses++;
            marketResult = GameResult.Lose;
        }
 
        g.state = HandState.Finished;
 
        if (g.marketCreated) {
            marketHub.resolveMarket(g.gameId, IPredictionMarketHub.GameResult(uint8(marketResult)));
        }
 
        _moveToInactiveGames(g.gameId);
 
        emit GameResolved(
            g.player, 
            g.gameId, 
            marketResult == GameResult.Win ? (dealerValue > 21 ? "Win - Dealer Bust" : "Win") : (marketResult == GameResult.Push ? "Push" : "Lose"),
            playerValue, 
            dealerValue, 
            marketResult
        );
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
 
    /* ─────────── View Functions (keeping existing ones) ─────────── */
 
    function getActiveGames(uint256 startIndex, uint256 count) external view returns (uint256[] memory gameIds, uint256 totalActive, bool hasMore) {
        require(count > 0 && count <= 100, "Count must be 1-100");
        totalActive = activeGameIds.length;
        if (startIndex >= totalActive) return (new uint256[](0), totalActive, false);
        uint256 remaining = totalActive - startIndex;
        uint256 returnCount = remaining < count ? remaining : count;
        gameIds = new uint256[](returnCount);
        for (uint256 i = 0; i < returnCount; i++) gameIds[i] = activeGameIds[startIndex + i];
        hasMore = startIndex + returnCount < totalActive;
    }
 
    function getInactiveGames(uint256 startIndex, uint256 count) external view returns (uint256[] memory gameIds, uint256 totalInactive, bool hasMore) {
        require(count > 0 && count <= 100, "Count must be 1-100");
        totalInactive = inactiveGameIds.length;
        if (startIndex >= totalInactive) return (new uint256[](0), totalInactive, false);
        uint256 remaining = totalInactive - startIndex;
        uint256 returnCount = remaining < count ? remaining : count;
        gameIds = new uint256[](returnCount);
        for (uint256 i = 0; i < returnCount; i++) gameIds[i] = inactiveGameIds[startIndex + i];
        hasMore = startIndex + returnCount < totalInactive;
    }
 
    function getGameCounts() external view returns (uint256 activeCount, uint256 inactiveCount) {
        return (activeGameIds.length, inactiveGameIds.length);
    }
 
    function getGameInfo(uint256 gameId) public view returns (GameInfo memory) {
        address player = gameIdToPlayer[gameId];
        require(player != address(0), "Game does not exist");
        Game storage g = games[player];
        return GameInfo({
            gameId: gameId,
            player: player,
            state: g.state,
            startedAt: g.startedAt,
            lastActionAt: g.lastActionAt,
            playerTotal: _calculateHandValue(g.playerHand),
            dealerTotal: _calculateHandValue(g.dealerHand),
            marketCreated: g.marketCreated
        });
    }
 
    function getGameDisplay(address player) external view returns (GameDisplay memory) {
        Game storage g = games[player];
        GameDisplay memory display;
        display.gameId = g.gameId;
        display.marketCreated = g.marketCreated;
 
        if (g.state == HandState.Inactive) display.status = "No active game";
        else if (g.state == HandState.PendingInitialDeal) display.status = "Dealing cards...";
        else if (g.state == HandState.Active && block.timestamp < g.tradingPeriodEnds) display.status = "Trading period - Cannot act yet";
        else if (g.state == HandState.Active) display.status = "Your turn";
        else if (g.state == HandState.PendingHit) display.status = "Drawing card...";
        else if (g.state == HandState.PendingStand) display.status = "Dealer playing...";
        else if (g.state == HandState.Busted) display.status = "Busted!";
        else display.status = "Game finished";
 
        display.playerCards = new CardDisplay[](g.playerHand.length);
        for (uint256 i = 0; i < g.playerHand.length; i++) {
            uint8 cardId = g.playerHand[i];
            (string memory rank, string memory suit) = _getCardDisplay(cardId);
            display.playerCards[i] = CardDisplay({ rank: rank, suit: suit, value: _cardValue(cardId) });
        }
 
        display.dealerCards = new CardDisplay[](g.dealerHand.length);
        for (uint256 i = 0; i < g.dealerHand.length; i++) {
            uint8 cardId = g.dealerHand[i];
            (string memory rank, string memory suit) = _getCardDisplay(cardId);
            display.dealerCards[i] = CardDisplay({ rank: rank, suit: suit, value: _cardValue(cardId) });
        }
 
        display.playerTotal = _calculateHandValue(g.playerHand);
        display.dealerTotal = _calculateHandValue(g.dealerHand);
 
        bool tradingPeriodOver = block.timestamp >= g.tradingPeriodEnds;
        bool cooledDown = block.timestamp >= g.lastActionAt + bjConfig.minActionDelay;
        bool hasCards = g.playerHand.length > 0;
        bool notAt21 = display.playerTotal < 21;
 
        display.canHit = g.state == HandState.Active && tradingPeriodOver && cooledDown && hasCards && notAt21;
        display.canStand = g.state == HandState.Active && tradingPeriodOver && hasCards;
        display.canStartNew = g.state == HandState.Inactive || g.state == HandState.Busted || g.state == HandState.Finished;
        display.canCancelStuck = (g.state == HandState.PendingInitialDeal || g.state == HandState.PendingHit || g.state == HandState.PendingStand) && block.timestamp >= g.vrfRequestTime + bjConfig.vrfTimeout;
        display.canAdminResolve = (g.state == HandState.Active || g.state == HandState.PendingHit || g.state == HandState.PendingStand) && block.timestamp >= g.lastActionAt + bjConfig.gameAbandonmentPeriod;
 
        display.startedAt = g.startedAt;
        display.lastActionAt = g.lastActionAt;
        display.tradingPeriodEnds = g.tradingPeriodEnds;
        display.secondsUntilCanAct = (g.state == HandState.Active && block.timestamp < g.tradingPeriodEnds) ? g.tradingPeriodEnds - block.timestamp : 0;
 
        return display;
    }
 
    function getPlayerGameIds(address player) external view returns (uint256[] memory gameIds) {
        Game storage g = games[player];
        if (g.gameId > 0) {
            gameIds = new uint256[](1);
            gameIds[0] = g.gameId;
        } else {
            gameIds = new uint256[](0);
        }
    }
 
    function getStats(address player) external view returns (uint256 gamesPlayed, uint256 wins, uint256 losses, uint256 pushes, uint256 busts, uint256 winRate) {
        PlayerStats storage stats = playerStats[player];
        uint256 rate = stats.gamesPlayed > 0 ? (stats.wins * 100) / stats.gamesPlayed : 0;
        return (stats.gamesPlayed, stats.wins, stats.losses, stats.pushes, stats.busts, rate);
    }
 
    function getPlayerHand(address player) external view returns (uint8[] memory) { return games[player].playerHand; }
    function getDealerHand(address player) external view returns (uint8[] memory) { return games[player].dealerHand; }
 
    /* ─────────── Admin Functions ─────────── */
 
    function setMarketHub(address _marketHub) external {
        require(isAdmin[msg.sender], "Not admin");
        require(_marketHub != address(0), "zero address");
        marketHub = IPredictionMarketHub(_marketHub);
        
        // Re-approve new hub with max
        IERC20Minimal(token1).approve(_marketHub, type(uint256).max);
    }
 
    function setVrfConfig(uint256 subscriptionId, uint32 callbackGasLimit, uint16 requestConfirmations) external {
        require(isAdmin[msg.sender], "Not admin");
        vrfConfig.subscriptionId = subscriptionId;
        vrfConfig.callbackGasLimit = callbackGasLimit;
        vrfConfig.requestConfirmations = requestConfirmations;
    }
 
    function setBjConfig(uint256 gameExpiryDelay, uint256 minActionDelay, uint256 vrfTimeout, uint256 tradingDelay, uint256 gameAbandonmentPeriod) external {
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
 
    function setAdmin(address admin, bool status) external {
        require(isAdmin[msg.sender], "Not admin");
        isAdmin[admin] = status;
    }
 
    function setProtocolOwner(address _protocolOwner) external {
        require(isAdmin[msg.sender], "Not admin");
        require(_protocolOwner != address(0), "zero address");
        protocolOwner = _protocolOwner;
    }
 
    /* ─────────── Emergency Recovery ─────────── */
 
    function emergencyWithdrawTokens(address token, uint256 amount) external {
        require(isAdmin[msg.sender], "Not admin");
        require(IERC20Minimal(token).transfer(protocolOwner, amount), "Transfer failed");
    }
 
    function emergencyWithdrawETH(uint256 amount) external {
        require(isAdmin[msg.sender], "Not admin");
        (bool success, ) = payable(protocolOwner).call{value: amount}("");
        require(success, "ETH transfer failed");
    }
 
    receive() external payable {}
    fallback() external payable {}
}