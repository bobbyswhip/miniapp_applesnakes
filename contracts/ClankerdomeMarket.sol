// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ClankerdomeMarket
 * @notice Prediction market for Clankerdome token launches with 5 outcome ranges
 * @dev USDC-based prediction market with AMM-style share pricing
 *
 * Outcome Ranges (for presale amount predictions):
 * 0: Under $100
 * 1: $100 - $500
 * 2: $500 - $1,000
 * 3: $1,000 - $10,000
 * 4: Over $10,000
 *
 * Fee Structure (2% total):
 * - 1.0% to AI Agent wallet (contributes to presale buys)
 * - 0.5% to market creator
 * - 0.5% to protocol
 */
contract ClankerdomeMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================
    // CONSTANTS
    // ============================================

    uint256 public constant NUM_OUTCOMES = 5;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MIN_LIQUIDITY = 1e6; // 1 USDC minimum

    // Fee basis points (100 = 1%)
    uint256 public constant TOTAL_FEE_BPS = 200;      // 2%
    uint256 public constant AI_FEE_BPS = 100;         // 1%
    uint256 public constant CREATOR_FEE_BPS = 50;     // 0.5%
    uint256 public constant PROTOCOL_FEE_BPS = 50;    // 0.5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // USDC on Base
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 public constant USDC_DECIMALS = 6;

    // ============================================
    // STATE
    // ============================================

    enum MarketStatus { Active, Paused, Resolved, Cancelled }

    struct Market {
        string launchId;          // Clankerdome launch ID
        string marketType;        // "presale_amount", "token_price_24h", etc.
        address creator;          // Market creator
        uint256 endsAt;           // When trading ends
        uint256 createdAt;        // When market was created
        MarketStatus status;
        uint8 winningOutcome;     // 0-4, set when resolved
        uint256 totalVolume;      // Total trading volume
    }

    struct OutcomeData {
        uint256 shares;           // Total shares for this outcome
        uint256 deposits;         // Total USDC deposited for this outcome
    }

    // Market data
    Market public market;
    OutcomeData[NUM_OUTCOMES] public outcomes;

    // User positions: user => outcome => shares
    mapping(address => mapping(uint8 => uint256)) public userShares;

    // Fee recipients
    address public aiWallet;
    address public protocolWallet;

    // Accumulated fees
    uint256 public accumulatedAiFees;
    uint256 public accumulatedCreatorFees;
    uint256 public accumulatedProtocolFees;

    // Outcome range labels (for reference)
    string[NUM_OUTCOMES] public outcomeLabels;

    // ============================================
    // EVENTS
    // ============================================

    event MarketCreated(
        string indexed launchId,
        string marketType,
        address creator,
        uint256 endsAt
    );

    event SharesPurchased(
        address indexed user,
        uint8 outcome,
        uint256 usdcAmount,
        uint256 sharesReceived,
        uint256 fee
    );

    event SharesSold(
        address indexed user,
        uint8 outcome,
        uint256 sharesAmount,
        uint256 usdcReceived,
        uint256 fee
    );

    event MarketResolved(uint8 winningOutcome, uint256 totalPayout);
    event WinningsClaimed(address indexed user, uint256 amount);
    event MarketCancelled();
    event FeesDistributed(uint256 aiAmount, uint256 creatorAmount, uint256 protocolAmount);
    event TimerEndedEarly(uint256 newEndTime);

    // ============================================
    // CONSTRUCTOR
    // ============================================

    constructor(
        string memory _launchId,
        string memory _marketType,
        address _creator,
        uint256 _duration,
        address _aiWallet,
        address _protocolWallet
    ) Ownable(msg.sender) {
        require(_aiWallet != address(0), "Invalid AI wallet");
        require(_protocolWallet != address(0), "Invalid protocol wallet");
        require(_creator != address(0), "Invalid creator");
        require(_duration > 0, "Invalid duration");

        market = Market({
            launchId: _launchId,
            marketType: _marketType,
            creator: _creator,
            endsAt: block.timestamp + _duration,
            createdAt: block.timestamp,
            status: MarketStatus.Active,
            winningOutcome: 0,
            totalVolume: 0
        });

        aiWallet = _aiWallet;
        protocolWallet = _protocolWallet;

        // Default presale amount ranges
        outcomeLabels[0] = "Under $100";
        outcomeLabels[1] = "$100 - $500";
        outcomeLabels[2] = "$500 - $1,000";
        outcomeLabels[3] = "$1,000 - $10,000";
        outcomeLabels[4] = "Over $10,000";

        emit MarketCreated(_launchId, _marketType, _creator, market.endsAt);
    }

    // ============================================
    // TRADING FUNCTIONS
    // ============================================

    /**
     * @notice Buy shares for a specific outcome
     * @param outcome The outcome to buy (0-4)
     * @param usdcAmount Amount of USDC to spend
     */
    function buyShares(uint8 outcome, uint256 usdcAmount) external nonReentrant {
        require(market.status == MarketStatus.Active, "Market not active");
        require(block.timestamp < market.endsAt, "Trading ended");
        require(outcome < NUM_OUTCOMES, "Invalid outcome");
        require(usdcAmount >= MIN_LIQUIDITY, "Amount too small");

        // Transfer USDC from user
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Calculate fees
        uint256 fee = (usdcAmount * TOTAL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = usdcAmount - fee;

        // Distribute fees
        _distributeFees(fee);

        // Calculate shares using constant product formula
        uint256 sharesToMint = _calculateSharesForDeposit(outcome, netAmount);
        require(sharesToMint > 0, "Zero shares");

        // Update state
        outcomes[outcome].shares += sharesToMint;
        outcomes[outcome].deposits += netAmount;
        userShares[msg.sender][outcome] += sharesToMint;
        market.totalVolume += usdcAmount;

        emit SharesPurchased(msg.sender, outcome, usdcAmount, sharesToMint, fee);
    }

    /**
     * @notice Sell shares for a specific outcome
     * @param outcome The outcome to sell (0-4)
     * @param sharesAmount Amount of shares to sell
     */
    function sellShares(uint8 outcome, uint256 sharesAmount) external nonReentrant {
        require(market.status == MarketStatus.Active, "Market not active");
        require(block.timestamp < market.endsAt, "Trading ended");
        require(outcome < NUM_OUTCOMES, "Invalid outcome");
        require(userShares[msg.sender][outcome] >= sharesAmount, "Insufficient shares");
        require(sharesAmount > 0, "Zero shares");

        // Calculate USDC to return
        uint256 usdcToReturn = _calculateUsdcForShares(outcome, sharesAmount);
        require(usdcToReturn > 0, "Zero return");

        // Calculate fees
        uint256 fee = (usdcToReturn * TOTAL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netReturn = usdcToReturn - fee;

        // Distribute fees
        _distributeFees(fee);

        // Update state
        outcomes[outcome].shares -= sharesAmount;
        outcomes[outcome].deposits -= usdcToReturn;
        userShares[msg.sender][outcome] -= sharesAmount;
        market.totalVolume += usdcToReturn;

        // Transfer USDC to user
        IERC20(USDC).safeTransfer(msg.sender, netReturn);

        emit SharesSold(msg.sender, outcome, sharesAmount, netReturn, fee);
    }

    /**
     * @notice Claim winnings after market is resolved
     */
    function claimWinnings() external nonReentrant {
        require(market.status == MarketStatus.Resolved, "Market not resolved");

        uint8 winningOutcome = market.winningOutcome;
        uint256 userWinningShares = userShares[msg.sender][winningOutcome];
        require(userWinningShares > 0, "No winning shares");

        // Calculate payout
        uint256 totalWinningShares = outcomes[winningOutcome].shares;
        uint256 totalPool = _getTotalPool();
        uint256 payout = (userWinningShares * totalPool) / totalWinningShares;

        // Clear user shares
        userShares[msg.sender][winningOutcome] = 0;

        // Transfer payout
        IERC20(USDC).safeTransfer(msg.sender, payout);

        emit WinningsClaimed(msg.sender, payout);
    }

    /**
     * @notice Claim refund if market is cancelled
     */
    function claimRefund() external nonReentrant {
        require(market.status == MarketStatus.Cancelled, "Market not cancelled");

        uint256 totalRefund = 0;

        // Calculate total deposits by user
        for (uint8 i = 0; i < NUM_OUTCOMES; i++) {
            uint256 userShareCount = userShares[msg.sender][i];
            if (userShareCount > 0 && outcomes[i].shares > 0) {
                uint256 refund = (userShareCount * outcomes[i].deposits) / outcomes[i].shares;
                totalRefund += refund;
                userShares[msg.sender][i] = 0;
            }
        }

        require(totalRefund > 0, "Nothing to refund");
        IERC20(USDC).safeTransfer(msg.sender, totalRefund);
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Resolve the market with the winning outcome
     * @param winningOutcome The winning outcome (0-4)
     */
    function resolveMarket(uint8 winningOutcome) external onlyOwner {
        require(market.status == MarketStatus.Active || market.status == MarketStatus.Paused, "Cannot resolve");
        require(winningOutcome < NUM_OUTCOMES, "Invalid outcome");

        market.status = MarketStatus.Resolved;
        market.winningOutcome = winningOutcome;

        // Distribute accumulated fees
        _flushFees();

        emit MarketResolved(winningOutcome, _getTotalPool());
    }

    /**
     * @notice Cancel the market (users can claim refunds)
     */
    function cancelMarket() external onlyOwner {
        require(market.status == MarketStatus.Active || market.status == MarketStatus.Paused, "Cannot cancel");

        market.status = MarketStatus.Cancelled;

        emit MarketCancelled();
    }

    /**
     * @notice Pause trading
     */
    function pauseTrading() external onlyOwner {
        require(market.status == MarketStatus.Active, "Not active");
        market.status = MarketStatus.Paused;
    }

    /**
     * @notice Resume trading
     */
    function resumeTrading() external onlyOwner {
        require(market.status == MarketStatus.Paused, "Not paused");
        market.status = MarketStatus.Active;
    }

    /**
     * @notice End timer early (for testing)
     */
    function endTimerEarly() external onlyOwner {
        require(market.status == MarketStatus.Active, "Not active");
        market.endsAt = block.timestamp;
        emit TimerEndedEarly(block.timestamp);
    }

    /**
     * @notice Set custom end time
     * @param newEndTime New end timestamp
     */
    function setEndTime(uint256 newEndTime) external onlyOwner {
        require(market.status == MarketStatus.Active || market.status == MarketStatus.Paused, "Cannot modify");
        market.endsAt = newEndTime;
    }

    /**
     * @notice Set outcome labels
     * @param labels Array of 5 labels
     */
    function setOutcomeLabels(string[NUM_OUTCOMES] calldata labels) external onlyOwner {
        for (uint8 i = 0; i < NUM_OUTCOMES; i++) {
            outcomeLabels[i] = labels[i];
        }
    }

    /**
     * @notice Withdraw ETH (for testing/recovery)
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @notice Withdraw ERC20 tokens (for testing/recovery)
     * @param token Token address
     */
    function withdrawERC20(address token) external onlyOwner {
        // Cannot withdraw USDC while market is active
        if (token == USDC) {
            require(
                market.status == MarketStatus.Resolved || market.status == MarketStatus.Cancelled,
                "Market still active"
            );
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(token).safeTransfer(owner(), balance);
    }

    /**
     * @notice Update AI wallet address
     */
    function setAiWallet(address _aiWallet) external onlyOwner {
        require(_aiWallet != address(0), "Invalid address");
        aiWallet = _aiWallet;
    }

    /**
     * @notice Update protocol wallet address
     */
    function setProtocolWallet(address _protocolWallet) external onlyOwner {
        require(_protocolWallet != address(0), "Invalid address");
        protocolWallet = _protocolWallet;
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Get share price for an outcome
     * @param outcome The outcome (0-4)
     * @return price Price per share in USDC (scaled by PRECISION)
     */
    function getSharePrice(uint8 outcome) external view returns (uint256 price) {
        require(outcome < NUM_OUTCOMES, "Invalid outcome");

        if (outcomes[outcome].shares == 0) {
            return PRECISION; // Default price of 1 USDC per share
        }

        return (outcomes[outcome].deposits * PRECISION) / outcomes[outcome].shares;
    }

    /**
     * @notice Get implied probability for an outcome
     * @param outcome The outcome (0-4)
     * @return probability Probability in basis points (0-10000)
     */
    function getImpliedProbability(uint8 outcome) external view returns (uint256 probability) {
        require(outcome < NUM_OUTCOMES, "Invalid outcome");

        uint256 totalDeposits = _getTotalPool();
        if (totalDeposits == 0) {
            return BPS_DENOMINATOR / NUM_OUTCOMES; // Equal probability if no deposits
        }

        return (outcomes[outcome].deposits * BPS_DENOMINATOR) / totalDeposits;
    }

    /**
     * @notice Get user's shares for all outcomes
     * @param user User address
     * @return shares Array of share counts for each outcome
     */
    function getUserShares(address user) external view returns (uint256[NUM_OUTCOMES] memory shares) {
        for (uint8 i = 0; i < NUM_OUTCOMES; i++) {
            shares[i] = userShares[user][i];
        }
    }

    /**
     * @notice Get market summary
     */
    function getMarketSummary() external view returns (
        string memory launchId,
        string memory marketType,
        MarketStatus status,
        uint256 endsAt,
        uint256 totalVolume,
        uint256 totalPool,
        uint8 winningOutcome
    ) {
        return (
            market.launchId,
            market.marketType,
            market.status,
            market.endsAt,
            market.totalVolume,
            _getTotalPool(),
            market.winningOutcome
        );
    }

    /**
     * @notice Get all outcomes data
     */
    function getAllOutcomes() external view returns (
        OutcomeData[NUM_OUTCOMES] memory outcomeData,
        string[NUM_OUTCOMES] memory labels
    ) {
        return (outcomes, outcomeLabels);
    }

    /**
     * @notice Check if trading is open
     */
    function isTradingOpen() external view returns (bool) {
        return market.status == MarketStatus.Active && block.timestamp < market.endsAt;
    }

    /**
     * @notice Get time remaining
     */
    function getTimeRemaining() external view returns (uint256) {
        if (block.timestamp >= market.endsAt) return 0;
        return market.endsAt - block.timestamp;
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    /**
     * @notice Calculate shares to mint for a deposit
     * @dev Uses constant product-like formula for price discovery
     */
    function _calculateSharesForDeposit(uint8 outcome, uint256 depositAmount) internal view returns (uint256) {
        if (outcomes[outcome].deposits == 0) {
            // First deposit: 1 USDC = 1 share
            return depositAmount;
        }

        // Existing deposits: shares proportional to deposit
        return (depositAmount * outcomes[outcome].shares) / outcomes[outcome].deposits;
    }

    /**
     * @notice Calculate USDC to return for selling shares
     */
    function _calculateUsdcForShares(uint8 outcome, uint256 sharesAmount) internal view returns (uint256) {
        if (outcomes[outcome].shares == 0) return 0;

        return (sharesAmount * outcomes[outcome].deposits) / outcomes[outcome].shares;
    }

    /**
     * @notice Get total pool across all outcomes
     */
    function _getTotalPool() internal view returns (uint256) {
        uint256 total = 0;
        for (uint8 i = 0; i < NUM_OUTCOMES; i++) {
            total += outcomes[i].deposits;
        }
        return total;
    }

    /**
     * @notice Distribute fees to fee buckets
     */
    function _distributeFees(uint256 totalFee) internal {
        uint256 aiFee = (totalFee * AI_FEE_BPS) / TOTAL_FEE_BPS;
        uint256 creatorFee = (totalFee * CREATOR_FEE_BPS) / TOTAL_FEE_BPS;
        uint256 protocolFee = totalFee - aiFee - creatorFee;

        accumulatedAiFees += aiFee;
        accumulatedCreatorFees += creatorFee;
        accumulatedProtocolFees += protocolFee;
    }

    /**
     * @notice Flush accumulated fees to recipients
     */
    function _flushFees() internal {
        if (accumulatedAiFees > 0) {
            IERC20(USDC).safeTransfer(aiWallet, accumulatedAiFees);
        }
        if (accumulatedCreatorFees > 0) {
            IERC20(USDC).safeTransfer(market.creator, accumulatedCreatorFees);
        }
        if (accumulatedProtocolFees > 0) {
            IERC20(USDC).safeTransfer(protocolWallet, accumulatedProtocolFees);
        }

        emit FeesDistributed(accumulatedAiFees, accumulatedCreatorFees, accumulatedProtocolFees);

        accumulatedAiFees = 0;
        accumulatedCreatorFees = 0;
        accumulatedProtocolFees = 0;
    }

    // Allow receiving ETH
    receive() external payable {}
}
