// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

interface IAppleStaking {
    function addRewards(uint256 amount) external;
}

error SwapReverted(bytes data);

/**
 * @title PredictionMarketHub - V4 Fixed Claim Accounting
 * @notice The fix: Reduce total shares AND account for fees in deposit reduction
 */
contract PredictionMarketHub {
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManagerExt public constant MANAGER = IPoolManagerExt(0x498581fF718922c3f8e6A244956aF099B2652b2b);

    address public owner;
    address public token = 0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6;
    IAppleStaking public appleStaking;

    address public hook = 0x77e180e90130FA6e6A4bf4d07cf2032f5f2B70C8;
    bytes32 public poolIdRaw = 0x6a634d3c93c0b9402392bff565c8315f621558a49e2a00973922322ce19d4abb;
    address public protocolOwner;

    uint256 public constant TOTAL_FEE_BPS = 100;
    uint256 public constant CREATOR_FEE_BPS = 30;
    uint256 public constant STAKING_FEE_BPS = 65;
    uint256 public constant PROTOCOL_FEE_BPS = 5;

    uint256 public constant ETH_CREATOR_FEE_BPS = 30;
    uint256 public constant ETH_PROTOCOL_FEE_BPS = 70;

    uint256 public constant DUST_THRESHOLD = 10000000;

    bool private locked;

    enum GameResult { Pending, Win, Lose, Push }
    enum MarketStatus { None, Active, Resolved, Closed }

    struct Market {
        uint256 gameId;
        address gameContract;
        address creator;
        uint256 yesSharesTotal;
        uint256 noSharesTotal;
        uint256 yesDeposits;
        uint256 noDeposits;
        bool tradingActive;
        bool resolved;
        GameResult result;
        uint256 initialLiquidity;
        uint256 volume;
        MarketStatus status;
    }

    struct MarketDisplay {
        uint256 gameId;
        uint256 yesSharesTotal;
        uint256 noSharesTotal;
        uint256 yesDeposits;
        uint256 noDeposits;
        uint256 totalDeposits;
        uint256 yesPrice;
        uint256 noPrice;
        bool tradingActive;
        bool resolved;
        GameResult result;
        uint256 userYesShares;
        uint256 userNoShares;
        uint256 userClaimable;
        uint256 volume;
        MarketStatus status;
        uint256 creatorTokenFeesEarned;
        uint256 creatorETHFeesEarned;
    }

    struct ClaimableMarket {
        uint256 gameId;
        uint256 claimableAmount;
        uint256 userYesShares;
        uint256 userNoShares;
        GameResult result;
        uint256 yesPrice;
        uint256 noPrice;
    }

    struct UserPosition {
        uint256 gameId;
        uint256 yesShares;
        uint256 noShares;
        uint256 currentValue;
        MarketStatus status;
        bool resolved;
        GameResult result;
    }

    struct PlayerStats {
        uint256 totalVolume;
        uint256 buyVolume;
        uint256 sellVolume;
        uint256 buyCount;
        uint256 sellCount;
        uint256 gamesParticipated;
        uint256 winningsClaimed;
        uint256 claimCount;
        uint256 marketsCreated;
        uint256 creatorTokenFeesEarned;
        uint256 creatorETHFeesEarned;
    }

    struct SwapData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        address recipient;
        address payer;
        bool payC0AsNative;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesShares;
    mapping(uint256 => mapping(address => uint256)) public noShares;
    mapping(address => bool) public whitelistedGameContracts;

    mapping(address => PlayerStats) public playerStats;
    mapping(address => mapping(uint256 => bool)) private hasParticipated;

    mapping(uint256 => uint256) public creatorTokenFeesForMarket;
    mapping(uint256 => uint256) public creatorETHFeesForMarket;

    uint256[] private activeMarketIds;
    uint256[] private resolvedMarketIds;
    uint256[] private closedMarketIds;

    mapping(uint256 => uint256) private activeMarketIndex;
    mapping(uint256 => uint256) private resolvedMarketIndex;
    mapping(uint256 => uint256) private closedMarketIndex;

    uint256 public uncollectedFees;

    uint256 public totalVolumeAllTime;
    uint256 public totalMarketsCreated;
    uint256 public totalFeesCollected;

    event MarketCreated(uint256 indexed gameId, address indexed gameContract, address indexed creator, uint256 initialLiquidity);
    event SharesPurchased(uint256 indexed gameId, address indexed buyer, bool isYes, uint256 tokensIn, uint256 sharesOut, uint256 feeAmount);
    event SharesSold(uint256 indexed gameId, address indexed seller, bool isYes, uint256 sharesIn, uint256 tokensOut, uint256 feeAmount);
    event WinningsClaimed(uint256 indexed gameId, address indexed claimer, uint256 amount, uint256 feeAmount);
    event TradingPaused(uint256 indexed gameId);
    event TradingResumed(uint256 indexed gameId);
    event MarketResolved(uint256 indexed gameId, GameResult result);
    event MarketClosed(uint256 indexed gameId);
    event FeesDistributed(uint256 indexed gameId, address indexed from, uint256 creatorFee, uint256 stakingFee, uint256 protocolFee);
    event GameContractWhitelisted(address indexed gameContract, bool status);
    event FeeCollectionFailed(uint256 indexed gameId, uint256 amount, string reason);

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyWhitelistedGameContract() {
        require(whitelistedGameContracts[msg.sender], "Not whitelisted game contract");
        _;
    }

    modifier onlyMarketGameContract(uint256 gameId) {
        require(markets[gameId].gameContract == msg.sender, "Not market's game contract");
        _;
    }

    constructor() {
        owner = msg.sender;
        protocolOwner = msg.sender;
        appleStaking = IAppleStaking(0x63b2A9Bd65f516E49Cee75C9001FB5aa3588CB3c);
    }

    /* ─────────── Fee Distribution Helpers ─────────── */

    function _distributeFees(
        uint256 gameId,
        address from,
        uint256 amount
    ) internal returns (uint256 totalFee) {
        Market storage m = markets[gameId];

        uint256 creatorFee = (amount * CREATOR_FEE_BPS) / 10000;
        uint256 stakingFee = (amount * STAKING_FEE_BPS) / 10000;
        uint256 protocolFee = (amount * PROTOCOL_FEE_BPS) / 10000;
        totalFee = creatorFee + stakingFee + protocolFee;

        totalFeesCollected += totalFee;

        if (creatorFee > 0) {
            require(IERC20Minimal(token).transfer(m.creator, creatorFee), "Creator fee failed");
            playerStats[m.creator].creatorTokenFeesEarned += creatorFee;
            creatorTokenFeesForMarket[gameId] += creatorFee;
        }

        if (protocolFee > 0) {
            require(IERC20Minimal(token).transfer(protocolOwner, protocolFee), "Protocol fee failed");
        }

        if (stakingFee > 0 && address(appleStaking) != address(0)) {
            _sendToStaking(gameId, stakingFee);
        }

        emit FeesDistributed(gameId, from, creatorFee, stakingFee, protocolFee);
    }

    function _distributeETHFees(
        uint256 gameId,
        address from,
        uint256 ethAmount
    ) internal returns (uint256 totalFee) {
        Market storage m = markets[gameId];

        uint256 creatorFee = (ethAmount * ETH_CREATOR_FEE_BPS) / 10000;
        uint256 protocolFee = (ethAmount * ETH_PROTOCOL_FEE_BPS) / 10000;
        totalFee = creatorFee + protocolFee;

        totalFeesCollected += totalFee;

        if (creatorFee > 0) {
            (bool creatorSuccess, ) = payable(m.creator).call{value: creatorFee}("");
            require(creatorSuccess, "Creator ETH fee failed");
            playerStats[m.creator].creatorETHFeesEarned += creatorFee;
            creatorETHFeesForMarket[gameId] += creatorFee;
        }

        if (protocolFee > 0) {
            (bool protocolSuccess, ) = payable(protocolOwner).call{value: protocolFee}("");
            require(protocolSuccess, "Protocol ETH fee failed");
        }

        emit FeesDistributed(gameId, from, creatorFee, 0, protocolFee);
    }

    function _sendToStaking(uint256 gameId, uint256 amount) internal {
        try IERC20Minimal(token).approve(address(appleStaking), 0) {} catch {}

        try IERC20Minimal(token).approve(address(appleStaking), amount) returns (bool success) {
            if (success) {
                try appleStaking.addRewards(amount) {
                } catch {
                    uncollectedFees += amount;
                    emit FeeCollectionFailed(gameId, amount, "addRewards failed");
                }
            } else {
                uncollectedFees += amount;
                emit FeeCollectionFailed(gameId, amount, "approve returned false");
            }
        } catch {
            uncollectedFees += amount;
            emit FeeCollectionFailed(gameId, amount, "approve reverted");
        }
    }

    function _trackParticipation(address user, uint256 gameId) internal {
        if (!hasParticipated[user][gameId]) {
            hasParticipated[user][gameId] = true;
            playerStats[user].gamesParticipated++;
        }
    }

    /* ─────────── Admin Functions ─────────── */

    function setWhitelistedGameContract(address gameContract, bool status) external onlyOwner {
        whitelistedGameContracts[gameContract] = status;
        emit GameContractWhitelisted(gameContract, status);
    }

    function setAppleStaking(address _appleStaking) external onlyOwner {
        appleStaking = IAppleStaking(_appleStaking);
    }

    function setProtocolOwner(address _protocolOwner) external onlyOwner {
        protocolOwner = _protocolOwner;
    }

    function setHook(address _hook) external onlyOwner {
        hook = _hook;
    }

    function setPoolId(bytes32 _poolIdRaw) external onlyOwner {
        poolIdRaw = _poolIdRaw;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    function collectUncollectedFees() external onlyOwner nonReentrant {
        require(uncollectedFees > 0, "No uncollected fees");
        require(address(appleStaking) != address(0), "No staking contract");

        uint256 amount = uncollectedFees;
        uncollectedFees = 0;

        require(IERC20Minimal(token).approve(address(appleStaking), amount), "Approve failed");
        appleStaking.addRewards(amount);
    }

    /* ─────────── Game Contract Functions ─────────── */

    function createMarket(
        uint256 gameId,
        address creator,
        uint256 initialLiquidity
    ) external onlyWhitelistedGameContract returns (bool) {
        require(markets[gameId].status == MarketStatus.None, "Market already exists");
        require(initialLiquidity > 0, "No liquidity");

        require(IERC20Minimal(token).transferFrom(msg.sender, address(this), initialLiquidity * 2), "Transfer failed");

        Market storage m = markets[gameId];
        m.gameId = gameId;
        m.gameContract = msg.sender;
        m.creator = creator;
        m.yesSharesTotal = initialLiquidity;
        m.noSharesTotal = initialLiquidity;
        m.yesDeposits = initialLiquidity;
        m.noDeposits = initialLiquidity;
        m.tradingActive = true;
        m.resolved = false;
        m.result = GameResult.Pending;
        m.initialLiquidity = initialLiquidity;
        m.volume = initialLiquidity * 2;
        m.status = MarketStatus.Active;

        yesShares[gameId][creator] = initialLiquidity;
        noShares[gameId][creator] = initialLiquidity;

        _addToActive(gameId);

        playerStats[creator].marketsCreated++;
        _trackParticipation(creator, gameId);
        totalMarketsCreated++;
        totalVolumeAllTime += initialLiquidity * 2;

        emit MarketCreated(gameId, msg.sender, creator, initialLiquidity);
        return true;
    }

    function pauseTrading(uint256 gameId) external onlyMarketGameContract(gameId) {
        markets[gameId].tradingActive = false;
        emit TradingPaused(gameId);
    }

    function resumeTrading(uint256 gameId) external onlyMarketGameContract(gameId) {
        require(!markets[gameId].resolved, "Market resolved");
        markets[gameId].tradingActive = true;
        emit TradingResumed(gameId);
    }

    function resolveMarket(uint256 gameId, GameResult result) external onlyMarketGameContract(gameId) {
        Market storage m = markets[gameId];
        require(!m.resolved, "Already resolved");

        m.tradingActive = false;
        m.resolved = true;
        m.result = result;
        m.status = MarketStatus.Resolved;

        _moveFromActiveToResolved(gameId);

        emit MarketResolved(gameId, result);
    }

    /* ─────────── Trading Functions (Token) ─────────── */

    function buyShares(uint256 gameId, uint256 tokensIn, bool isYes) external nonReentrant {
        Market storage m = markets[gameId];
        require(m.status == MarketStatus.Active, "Market not active");
        require(m.tradingActive, "Trading not active");
        require(tokensIn > 0, "Must send tokens");

        require(IERC20Minimal(token).transferFrom(msg.sender, address(this), tokensIn), "Transfer failed");

        uint256 totalFee = _distributeFees(gameId, msg.sender, tokensIn);
        uint256 netTokens = tokensIn - totalFee;

        m.volume += tokensIn;
        totalVolumeAllTime += tokensIn;

        uint256 sharesOut;
        if (isYes) {
            sharesOut = _calculateSharesOut(m.yesSharesTotal, m.yesDeposits, netTokens);
            m.yesDeposits += netTokens;
            m.yesSharesTotal += sharesOut;
            yesShares[gameId][msg.sender] += sharesOut;
        } else {
            sharesOut = _calculateSharesOut(m.noSharesTotal, m.noDeposits, netTokens);
            m.noDeposits += netTokens;
            m.noSharesTotal += sharesOut;
            noShares[gameId][msg.sender] += sharesOut;
        }

        playerStats[msg.sender].totalVolume += tokensIn;
        playerStats[msg.sender].buyVolume += tokensIn;
        playerStats[msg.sender].buyCount++;
        _trackParticipation(msg.sender, gameId);

        emit SharesPurchased(gameId, msg.sender, isYes, netTokens, sharesOut, totalFee);
    }

    function sellShares(uint256 gameId, uint256 sharesIn, bool isYes) external nonReentrant {
        Market storage m = markets[gameId];
        require(m.status == MarketStatus.Active, "Market not active");
        require(m.tradingActive, "Trading not active");
        require(sharesIn > 0, "Must sell shares");

        uint256 tokensOut;

        if (isYes) {
            require(yesShares[gameId][msg.sender] >= sharesIn, "Insufficient shares");
            tokensOut = _calculateTokensOut(m.yesSharesTotal, m.yesDeposits, sharesIn);
            require(tokensOut <= m.yesDeposits, "Insufficient liquidity");

            yesShares[gameId][msg.sender] -= sharesIn;
            m.yesSharesTotal -= sharesIn;
            m.yesDeposits -= tokensOut;
        } else {
            require(noShares[gameId][msg.sender] >= sharesIn, "Insufficient shares");
            tokensOut = _calculateTokensOut(m.noSharesTotal, m.noDeposits, sharesIn);
            require(tokensOut <= m.noDeposits, "Insufficient liquidity");

            noShares[gameId][msg.sender] -= sharesIn;
            m.noSharesTotal -= sharesIn;
            m.noDeposits -= tokensOut;
        }

        m.volume += tokensOut;
        totalVolumeAllTime += tokensOut;

        uint256 totalFee = _distributeFees(gameId, msg.sender, tokensOut);
        uint256 netTokens = tokensOut - totalFee;

        require(IERC20Minimal(token).transfer(msg.sender, netTokens), "Transfer failed");

        playerStats[msg.sender].totalVolume += tokensOut;
        playerStats[msg.sender].sellVolume += tokensOut;
        playerStats[msg.sender].sellCount++;

        emit SharesSold(gameId, msg.sender, isYes, sharesIn, netTokens, totalFee);
    }

    /* ─────────── Trading Functions (ETH) ─────────── */

    function buyYesWithETH(uint256 gameId) external payable nonReentrant {
        Market storage m = markets[gameId];
        require(m.status == MarketStatus.Active, "Market not active");
        require(m.tradingActive, "Trading not active");
        require(msg.value > 0, "No ETH sent");

        uint256 totalFee = _distributeETHFees(gameId, msg.sender, msg.value);
        uint256 swapAmount = msg.value - totalFee;

        uint256 balanceBefore = IERC20Minimal(token).balanceOf(address(this));
        _executeSwapToContract(swapAmount);
        uint256 balanceAfter = IERC20Minimal(token).balanceOf(address(this));

        uint256 tokensIn = balanceAfter - balanceBefore;
        m.volume += tokensIn;
        totalVolumeAllTime += tokensIn;

        uint256 sharesOut = _calculateSharesOut(m.yesSharesTotal, m.yesDeposits, tokensIn);

        m.yesDeposits += tokensIn;
        m.yesSharesTotal += sharesOut;
        yesShares[gameId][msg.sender] += sharesOut;

        playerStats[msg.sender].totalVolume += tokensIn;
        playerStats[msg.sender].buyVolume += tokensIn;
        playerStats[msg.sender].buyCount++;
        _trackParticipation(msg.sender, gameId);

        emit SharesPurchased(gameId, msg.sender, true, tokensIn, sharesOut, totalFee);
    }

    function buyNoWithETH(uint256 gameId) external payable nonReentrant {
        Market storage m = markets[gameId];
        require(m.status == MarketStatus.Active, "Market not active");
        require(m.tradingActive, "Trading not active");
        require(msg.value > 0, "No ETH sent");

        uint256 totalFee = _distributeETHFees(gameId, msg.sender, msg.value);
        uint256 swapAmount = msg.value - totalFee;

        uint256 balanceBefore = IERC20Minimal(token).balanceOf(address(this));
        _executeSwapToContract(swapAmount);
        uint256 balanceAfter = IERC20Minimal(token).balanceOf(address(this));

        uint256 tokensIn = balanceAfter - balanceBefore;
        m.volume += tokensIn;
        totalVolumeAllTime += tokensIn;

        uint256 sharesOut = _calculateSharesOut(m.noSharesTotal, m.noDeposits, tokensIn);

        m.noDeposits += tokensIn;
        m.noSharesTotal += sharesOut;
        noShares[gameId][msg.sender] += sharesOut;

        playerStats[msg.sender].totalVolume += tokensIn;
        playerStats[msg.sender].buyVolume += tokensIn;
        playerStats[msg.sender].buyCount++;
        _trackParticipation(msg.sender, gameId);

        emit SharesPurchased(gameId, msg.sender, false, tokensIn, sharesOut, totalFee);
    }

    /* ─────────── Claim Winnings (PROPERLY FIXED) ─────────── */

    function claimWinnings(uint256 gameId) external nonReentrant {
        Market storage m = markets[gameId];
        require(m.resolved, "Market not resolved");

        uint256 userYes = yesShares[gameId][msg.sender];
        uint256 userNo = noShares[gameId][msg.sender];
        
        require(userYes > 0 || userNo > 0, "No shares to claim");

        // Zero user shares FIRST
        yesShares[gameId][msg.sender] = 0;
        noShares[gameId][msg.sender] = 0;

        uint256 payout = 0;

        if (m.result == GameResult.Win) {
            // Yes shareholders win, split the entire pot proportionally
            if (userYes > 0 && m.yesSharesTotal > 0) {
                uint256 totalPot = m.yesDeposits + m.noDeposits;
                payout = (userYes * totalPot) / m.yesSharesTotal;
                
                // Reduce total shares
                m.yesSharesTotal -= userYes;
            }
            // Also reduce noSharesTotal for any no shares this user had (they're worthless but need accounting)
            if (userNo > 0) {
                m.noSharesTotal -= userNo;
            }
            
        } else if (m.result == GameResult.Lose) {
            // No shareholders win, split the entire pot proportionally
            if (userNo > 0 && m.noSharesTotal > 0) {
                uint256 totalPot = m.yesDeposits + m.noDeposits;
                payout = (userNo * totalPot) / m.noSharesTotal;
                
                // Reduce total shares
                m.noSharesTotal -= userNo;
            }
            // Also reduce yesSharesTotal for any yes shares this user had
            if (userYes > 0) {
                m.yesSharesTotal -= userYes;
            }
            
        } else if (m.result == GameResult.Push) {
            // Everyone gets their proportional deposits back
            if (userYes > 0 && m.yesSharesTotal > 0) {
                payout += (userYes * m.yesDeposits) / m.yesSharesTotal;
                m.yesSharesTotal -= userYes;
            }
            if (userNo > 0 && m.noSharesTotal > 0) {
                payout += (userNo * m.noDeposits) / m.noSharesTotal;
                m.noSharesTotal -= userNo;
            }
        }

        require(payout > 0, "Nothing to claim");

        // Calculate and distribute fees
        uint256 totalFee = _distributeFees(gameId, msg.sender, payout);
        uint256 netPayout = payout - totalFee;

        // Reduce deposits by the FULL payout (including fees, since fees come from the pot)
        // For Win/Lose, reduce both deposits proportionally to what was paid out
        if (m.result == GameResult.Win || m.result == GameResult.Lose) {
            uint256 totalDeposits = m.yesDeposits + m.noDeposits;
            if (totalDeposits > 0) {
                uint256 yesReduction = (payout * m.yesDeposits) / totalDeposits;
                uint256 noReduction = payout - yesReduction; // Ensure we reduce exactly payout total
                
                m.yesDeposits = yesReduction > m.yesDeposits ? 0 : m.yesDeposits - yesReduction;
                m.noDeposits = noReduction > m.noDeposits ? 0 : m.noDeposits - noReduction;
            }
        } else {
            // Push - deposits already accounted for in payout calculation above
            // Reduce by what was actually calculated for each side
            if (userYes > 0) {
                uint256 yesReduction = (userYes * m.yesDeposits) / (m.yesSharesTotal + userYes); // Use pre-reduction total
                m.yesDeposits = yesReduction > m.yesDeposits ? 0 : m.yesDeposits - yesReduction;
            }
            if (userNo > 0) {
                uint256 noReduction = (userNo * m.noDeposits) / (m.noSharesTotal + userNo); // Use pre-reduction total
                m.noDeposits = noReduction > m.noDeposits ? 0 : m.noDeposits - noReduction;
            }
        }

        require(IERC20Minimal(token).transfer(msg.sender, netPayout), "Transfer failed");

        playerStats[msg.sender].winningsClaimed += netPayout;
        playerStats[msg.sender].claimCount++;

        emit WinningsClaimed(gameId, msg.sender, netPayout, totalFee);
        _checkAndCloseMarket(gameId);
    }

    /* ─────────── Market Tracking ─────────── */

    function _addToActive(uint256 gameId) internal {
        if (activeMarketIndex[gameId] == 0) {
            activeMarketIds.push(gameId);
            activeMarketIndex[gameId] = activeMarketIds.length;
        }
    }

    function _moveFromActiveToResolved(uint256 gameId) internal {
        uint256 idx = activeMarketIndex[gameId];
        if (idx > 0) {
            uint256 lastId = activeMarketIds[activeMarketIds.length - 1];
            activeMarketIds[idx - 1] = lastId;
            activeMarketIndex[lastId] = idx;
            activeMarketIds.pop();
            delete activeMarketIndex[gameId];
        }

        if (resolvedMarketIndex[gameId] == 0) {
            resolvedMarketIds.push(gameId);
            resolvedMarketIndex[gameId] = resolvedMarketIds.length;
        }
    }

    function _moveFromResolvedToClosed(uint256 gameId) internal {
        uint256 idx = resolvedMarketIndex[gameId];
        if (idx > 0) {
            uint256 lastId = resolvedMarketIds[resolvedMarketIds.length - 1];
            resolvedMarketIds[idx - 1] = lastId;
            resolvedMarketIndex[lastId] = idx;
            resolvedMarketIds.pop();
            delete resolvedMarketIndex[gameId];
        }

        if (closedMarketIndex[gameId] == 0) {
            closedMarketIds.push(gameId);
            closedMarketIndex[gameId] = closedMarketIds.length;
        }

        markets[gameId].status = MarketStatus.Closed;
        emit MarketClosed(gameId);
    }

    function _checkAndCloseMarket(uint256 gameId) internal {
        Market storage m = markets[gameId];
        if (m.status != MarketStatus.Resolved) return;

        uint256 remainingDeposits = m.yesDeposits + m.noDeposits;
        if (remainingDeposits <= DUST_THRESHOLD) {
            _moveFromResolvedToClosed(gameId);
        }
    }

    function closeMarketIfEmpty(uint256 gameId) external {
        Market storage m = markets[gameId];
        require(m.status == MarketStatus.Resolved, "Market not resolved");

        uint256 remainingDeposits = m.yesDeposits + m.noDeposits;
        require(remainingDeposits <= DUST_THRESHOLD, "Market still has funds");

        _moveFromResolvedToClosed(gameId);
    }

    function closeMarketsIfEmpty(uint256[] calldata gameIds) external {
        for (uint256 i = 0; i < gameIds.length; i++) {
            uint256 gameId = gameIds[i];
            Market storage m = markets[gameId];

            if (m.status == MarketStatus.Resolved) {
                uint256 remainingDeposits = m.yesDeposits + m.noDeposits;
                if (remainingDeposits <= DUST_THRESHOLD) {
                    _moveFromResolvedToClosed(gameId);
                }
            }
        }
    }

    /* ─────────── Swap Functions ─────────── */

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

    /* ─────────── Internal Helpers ─────────── */

    function _calculateClaimable(uint256 gameId, address user) internal view returns (uint256) {
        Market storage m = markets[gameId];
        if (!m.resolved) return 0;

        uint256 payout = 0;

        if (m.result == GameResult.Push) {
            uint256 userYes = yesShares[gameId][user];
            uint256 userNo = noShares[gameId][user];

            if (m.yesSharesTotal > 0 && userYes > 0) {
                payout += (userYes * m.yesDeposits) / m.yesSharesTotal;
            }
            if (m.noSharesTotal > 0 && userNo > 0) {
                payout += (userNo * m.noDeposits) / m.noSharesTotal;
            }
        } else if (m.result == GameResult.Win) {
            uint256 userYes = yesShares[gameId][user];
            if (userYes > 0 && m.yesSharesTotal > 0) {
                uint256 totalPot = m.yesDeposits + m.noDeposits;
                payout = (userYes * totalPot) / m.yesSharesTotal;
            }
        } else if (m.result == GameResult.Lose) {
            uint256 userNo = noShares[gameId][user];
            if (userNo > 0 && m.noSharesTotal > 0) {
                uint256 totalPot = m.yesDeposits + m.noDeposits;
                payout = (userNo * totalPot) / m.noSharesTotal;
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

    /* ─────────── View Functions ─────────── */

    function marketExists(uint256 gameId) external view returns (bool) {
        return markets[gameId].status != MarketStatus.None;
    }

    function isMarketActive(uint256 gameId) external view returns (bool) {
        return markets[gameId].tradingActive;
    }

    function isMarketResolved(uint256 gameId) external view returns (bool) {
        return markets[gameId].resolved;
    }

    function getMarketStatus(uint256 gameId) external view returns (MarketStatus) {
        return markets[gameId].status;
    }

    function getClaimableAmount(uint256 gameId, address user) external view returns (uint256) {
        return _calculateClaimable(gameId, user);
    }

    function getUserShares(uint256 gameId, address user) external view returns (uint256 userYesShares, uint256 userNoShares) {
        return (yesShares[gameId][user], noShares[gameId][user]);
    }

    function getRemainingDeposits(uint256 gameId) external view returns (uint256) {
        Market storage m = markets[gameId];
        return m.yesDeposits + m.noDeposits;
    }

    function getMarketCounts() external view returns (uint256 activeCount, uint256 resolvedCount, uint256 closedCount) {
        return (activeMarketIds.length, resolvedMarketIds.length, closedMarketIds.length);
    }

    function getActiveMarkets(uint256 startIndex, uint256 count) external view returns (uint256[] memory gameIds, uint256 total, bool hasMore) {
        return _getPaginatedMarkets(activeMarketIds, startIndex, count);
    }

    function getResolvedMarkets(uint256 startIndex, uint256 count) external view returns (uint256[] memory gameIds, uint256 total, bool hasMore) {
        return _getPaginatedMarkets(resolvedMarketIds, startIndex, count);
    }

    function getClosedMarkets(uint256 startIndex, uint256 count) external view returns (uint256[] memory gameIds, uint256 total, bool hasMore) {
        return _getPaginatedMarkets(closedMarketIds, startIndex, count);
    }

    function _getPaginatedMarkets(uint256[] storage arr, uint256 startIndex, uint256 count) internal view returns (uint256[] memory gameIds, uint256 total, bool hasMore) {
        require(count > 0 && count <= 100, "Count must be 1-100");
        total = arr.length;
        if (startIndex >= total) return (new uint256[](0), total, false);
        uint256 remaining = total - startIndex;
        uint256 returnCount = remaining < count ? remaining : count;
        gameIds = new uint256[](returnCount);
        for (uint256 i = 0; i < returnCount; i++) {
            gameIds[i] = arr[startIndex + i];
        }
        hasMore = startIndex + returnCount < total;
    }

    function getMarketDisplay(uint256 gameId, address user) external view returns (MarketDisplay memory) {
        Market storage m = markets[gameId];
        MarketDisplay memory display;
        display.gameId = gameId;
        display.yesSharesTotal = m.yesSharesTotal;
        display.noSharesTotal = m.noSharesTotal;
        display.yesDeposits = m.yesDeposits;
        display.noDeposits = m.noDeposits;
        display.totalDeposits = m.yesDeposits + m.noDeposits;
        if (display.totalDeposits > 0) {
            display.yesPrice = (m.yesDeposits * 10000) / display.totalDeposits;
            display.noPrice = (m.noDeposits * 10000) / display.totalDeposits;
        } else {
            display.yesPrice = 5000;
            display.noPrice = 5000;
        }
        display.tradingActive = m.tradingActive;
        display.resolved = m.resolved;
        display.result = m.result;
        display.userYesShares = yesShares[gameId][user];
        display.userNoShares = noShares[gameId][user];
        display.userClaimable = _calculateClaimable(gameId, user);
        display.volume = m.volume;
        display.status = m.status;
        display.creatorTokenFeesEarned = creatorTokenFeesForMarket[gameId];
        display.creatorETHFeesEarned = creatorETHFeesForMarket[gameId];
        return display;
    }

    function getMarket(uint256 gameId) external view returns (
        address gameContract,
        address creator,
        uint256 yesSharesTotal,
        uint256 noSharesTotal,
        uint256 yesDeposits,
        uint256 noDeposits,
        bool tradingActive,
        bool resolved,
        GameResult result,
        uint256 volume,
        MarketStatus status
    ) {
        Market storage m = markets[gameId];
        return (m.gameContract, m.creator, m.yesSharesTotal, m.noSharesTotal, m.yesDeposits, m.noDeposits, m.tradingActive, m.resolved, m.result, m.volume, m.status);
    }

    function getMarketCreatorFees(uint256 gameId) external view returns (
        address creator,
        uint256 tokenFeesEarned,
        uint256 ethFeesEarned
    ) {
        return (markets[gameId].creator, creatorTokenFeesForMarket[gameId], creatorETHFeesForMarket[gameId]);
    }

    /* ─────────── Player Stats View Functions ─────────── */

    function getPlayerStats(address player) external view returns (
        uint256 totalVolume,
        uint256 buyVolume,
        uint256 sellVolume,
        uint256 buyCount,
        uint256 sellCount,
        uint256 gamesParticipated,
        uint256 winningsClaimed,
        uint256 claimCount,
        uint256 marketsCreated,
        uint256 creatorTokenFeesEarned,
        uint256 creatorETHFeesEarned
    ) {
        PlayerStats storage s = playerStats[player];
        return (
            s.totalVolume,
            s.buyVolume,
            s.sellVolume,
            s.buyCount,
            s.sellCount,
            s.gamesParticipated,
            s.winningsClaimed,
            s.claimCount,
            s.marketsCreated,
            s.creatorTokenFeesEarned,
            s.creatorETHFeesEarned
        );
    }

    function getGlobalStats() external view returns (
        uint256 _totalVolumeAllTime,
        uint256 _totalMarketsCreated,
        uint256 _totalFeesCollected,
        uint256 _activeMarkets,
        uint256 _resolvedMarkets,
        uint256 _closedMarkets
    ) {
        return (
            totalVolumeAllTime,
            totalMarketsCreated,
            totalFeesCollected,
            activeMarketIds.length,
            resolvedMarketIds.length,
            closedMarketIds.length
        );
    }

    /* ─────────── Frontend Helper Functions ─────────── */

    function getUserClaimableMarkets(address user, uint256 maxResults) external view returns (ClaimableMarket[] memory claimable, uint256 totalClaimable) {
        if (maxResults > 50) maxResults = 50;
        uint256 claimableCount = 0;
        uint256[] memory tempGameIds = new uint256[](resolvedMarketIds.length);

        for (uint256 i = 0; i < resolvedMarketIds.length && claimableCount < maxResults; i++) {
            uint256 gameId = resolvedMarketIds[i];
            uint256 amount = _calculateClaimable(gameId, user);
            if (amount > 0) {
                tempGameIds[claimableCount] = gameId;
                totalClaimable += amount;
                claimableCount++;
            }
        }

        claimable = new ClaimableMarket[](claimableCount);
        for (uint256 i = 0; i < claimableCount; i++) {
            uint256 gameId = tempGameIds[i];
            Market storage m = markets[gameId];
            uint256 totalDeposits = m.yesDeposits + m.noDeposits;
            claimable[i] = ClaimableMarket({
                gameId: gameId,
                claimableAmount: _calculateClaimable(gameId, user),
                userYesShares: yesShares[gameId][user],
                userNoShares: noShares[gameId][user],
                result: m.result,
                yesPrice: totalDeposits > 0 ? (m.yesDeposits * 10000) / totalDeposits : 5000,
                noPrice: totalDeposits > 0 ? (m.noDeposits * 10000) / totalDeposits : 5000
            });
        }
    }

    function userHasClaimable(address user) external view returns (bool hasClaimable, uint256 firstClaimableGameId) {
        for (uint256 i = 0; i < resolvedMarketIds.length; i++) {
            uint256 gameId = resolvedMarketIds[i];
            uint256 amount = _calculateClaimable(gameId, user);
            if (amount > 0) {
                return (true, gameId);
            }
        }
        return (false, 0);
    }

    function getUserPositions(address user, uint256 maxResults) external view returns (UserPosition[] memory positions) {
        if (maxResults > 100) maxResults = 100;
        uint256 positionCount = 0;
        uint256[] memory tempGameIds = new uint256[](activeMarketIds.length + resolvedMarketIds.length);

        for (uint256 i = 0; i < activeMarketIds.length && positionCount < maxResults; i++) {
            uint256 gameId = activeMarketIds[i];
            if (yesShares[gameId][user] > 0 || noShares[gameId][user] > 0) {
                tempGameIds[positionCount] = gameId;
                positionCount++;
            }
        }

        for (uint256 i = 0; i < resolvedMarketIds.length && positionCount < maxResults; i++) {
            uint256 gameId = resolvedMarketIds[i];
            if (yesShares[gameId][user] > 0 || noShares[gameId][user] > 0) {
                tempGameIds[positionCount] = gameId;
                positionCount++;
            }
        }

        positions = new UserPosition[](positionCount);
        for (uint256 i = 0; i < positionCount; i++) {
            uint256 gameId = tempGameIds[i];
            Market storage m = markets[gameId];
            uint256 userYes = yesShares[gameId][user];
            uint256 userNo = noShares[gameId][user];
            uint256 currentValue = 0;

            if (m.resolved) {
                currentValue = _calculateClaimable(gameId, user);
            } else {
                if (userYes > 0 && m.yesSharesTotal > 0) {
                    currentValue += (userYes * m.yesDeposits) / m.yesSharesTotal;
                }
                if (userNo > 0 && m.noSharesTotal > 0) {
                    currentValue += (userNo * m.noDeposits) / m.noSharesTotal;
                }
            }

            positions[i] = UserPosition({
                gameId: gameId,
                yesShares: userYes,
                noShares: userNo,
                currentValue: currentValue,
                status: m.status,
                resolved: m.resolved,
                result: m.result
            });
        }
    }

    function batchGetClaimable(uint256[] calldata gameIds, address user) external view returns (uint256[] memory claimableAmounts) {
        require(gameIds.length <= 100, "Too many markets");
        claimableAmounts = new uint256[](gameIds.length);
        for (uint256 i = 0; i < gameIds.length; i++) {
            claimableAmounts[i] = _calculateClaimable(gameIds[i], user);
        }
    }

    function getUserPortfolioSummary(address user) external view returns (
        uint256 activePositions,
        uint256 resolvedPositions,
        uint256 totalClaimable,
        uint256 totalActiveValue
    ) {
        for (uint256 i = 0; i < activeMarketIds.length; i++) {
            uint256 gameId = activeMarketIds[i];
            if (yesShares[gameId][user] > 0 || noShares[gameId][user] > 0) {
                activePositions++;
                Market storage m = markets[gameId];
                if (yesShares[gameId][user] > 0 && m.yesSharesTotal > 0) {
                    totalActiveValue += (yesShares[gameId][user] * m.yesDeposits) / m.yesSharesTotal;
                }
                if (noShares[gameId][user] > 0 && m.noSharesTotal > 0) {
                    totalActiveValue += (noShares[gameId][user] * m.noDeposits) / m.noSharesTotal;
                }
            }
        }

        for (uint256 i = 0; i < resolvedMarketIds.length; i++) {
            uint256 gameId = resolvedMarketIds[i];
            uint256 claimable = _calculateClaimable(gameId, user);
            if (claimable > 0) {
                resolvedPositions++;
                totalClaimable += claimable;
            }
        }
    }

    receive() external payable {}
    fallback() external payable {}
}