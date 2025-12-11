// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ClankerdomeMarket.sol";

/**
 * @title ClankerdomeHub
 * @notice Factory and registry for Clankerdome prediction markets
 * @dev Manages creation and resolution of multiple prediction markets
 *
 * Features:
 * - Create markets for Clankerdome launches
 * - Multiple market types per launch (presale amount, token price, etc.)
 * - Admin resolution system
 * - Fee configuration
 */
contract ClankerdomeHub is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================
    // CONSTANTS
    // ============================================

    // USDC on Base
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Default market duration (24 hours)
    uint256 public constant DEFAULT_DURATION = 24 hours;

    // ============================================
    // STATE
    // ============================================

    // AI wallet that receives fees (used for presale buys)
    address public aiWallet;

    // Protocol wallet for protocol fees
    address public protocolWallet;

    // Market registry
    mapping(address => bool) public isMarket;
    address[] public allMarkets;

    // Launch ID => Market type => Market address
    mapping(string => mapping(string => address)) public launchMarkets;

    // Launch ID => All market addresses for that launch
    mapping(string => address[]) public marketsByLaunch;

    // Authorized market creators
    mapping(address => bool) public authorizedCreators;

    // Default market duration
    uint256 public defaultDuration;

    // ============================================
    // EVENTS
    // ============================================

    event MarketCreated(
        address indexed marketAddress,
        string indexed launchId,
        string marketType,
        address creator,
        uint256 endsAt
    );

    event MarketResolved(
        address indexed marketAddress,
        string indexed launchId,
        uint8 winningOutcome
    );

    event MarketCancelled(
        address indexed marketAddress,
        string indexed launchId
    );

    event CreatorAuthorized(address indexed creator, bool authorized);
    event WalletUpdated(string walletType, address newAddress);

    // ============================================
    // CONSTRUCTOR
    // ============================================

    constructor(
        address _aiWallet,
        address _protocolWallet
    ) Ownable(msg.sender) {
        require(_aiWallet != address(0), "Invalid AI wallet");
        require(_protocolWallet != address(0), "Invalid protocol wallet");

        aiWallet = _aiWallet;
        protocolWallet = _protocolWallet;
        defaultDuration = DEFAULT_DURATION;

        // Owner is authorized by default
        authorizedCreators[msg.sender] = true;
    }

    // ============================================
    // MARKET CREATION
    // ============================================

    /**
     * @notice Create a new prediction market for a Clankerdome launch
     * @param launchId The Clankerdome launch ID
     * @param marketType Type of market ("presale_amount", "token_price_24h", etc.)
     * @param duration Market duration in seconds (0 = default)
     * @param customLabels Custom outcome labels (empty array = default labels)
     */
    function createMarket(
        string calldata launchId,
        string calldata marketType,
        uint256 duration,
        string[5] calldata customLabels
    ) external returns (address marketAddress) {
        require(authorizedCreators[msg.sender] || msg.sender == owner(), "Not authorized");
        require(bytes(launchId).length > 0, "Invalid launch ID");
        require(bytes(marketType).length > 0, "Invalid market type");
        require(launchMarkets[launchId][marketType] == address(0), "Market exists");

        uint256 marketDuration = duration > 0 ? duration : defaultDuration;

        // Deploy new market
        ClankerdomeMarket market = new ClankerdomeMarket(
            launchId,
            marketType,
            msg.sender,
            marketDuration,
            aiWallet,
            protocolWallet
        );

        marketAddress = address(market);

        // Set custom labels if provided
        if (bytes(customLabels[0]).length > 0) {
            market.setOutcomeLabels(customLabels);
        }

        // Transfer ownership to this hub (so hub can resolve)
        market.transferOwnership(address(this));

        // Register market
        isMarket[marketAddress] = true;
        allMarkets.push(marketAddress);
        launchMarkets[launchId][marketType] = marketAddress;
        marketsByLaunch[launchId].push(marketAddress);

        emit MarketCreated(
            marketAddress,
            launchId,
            marketType,
            msg.sender,
            block.timestamp + marketDuration
        );
    }

    /**
     * @notice Create a presale amount prediction market (convenience function)
     * @param launchId The Clankerdome launch ID
     * @param duration Market duration in seconds (0 = default)
     */
    function createPresaleMarket(
        string calldata launchId,
        uint256 duration
    ) external returns (address) {
        string[5] memory defaultLabels = [
            "Under $100",
            "$100 - $500",
            "$500 - $1,000",
            "$1,000 - $10,000",
            "Over $10,000"
        ];

        return this.createMarket(launchId, "presale_amount", duration, defaultLabels);
    }

    /**
     * @notice Create a token price prediction market (convenience function)
     * @param launchId The Clankerdome launch ID
     * @param duration Market duration in seconds (0 = default)
     * @param priceLabels Custom price range labels
     */
    function createPriceMarket(
        string calldata launchId,
        uint256 duration,
        string[5] calldata priceLabels
    ) external returns (address) {
        return this.createMarket(launchId, "token_price_24h", duration, priceLabels);
    }

    // ============================================
    // MARKET RESOLUTION
    // ============================================

    /**
     * @notice Resolve a market with the winning outcome
     * @param marketAddress Market address to resolve
     * @param winningOutcome Winning outcome (0-4)
     */
    function resolveMarket(
        address marketAddress,
        uint8 winningOutcome
    ) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");

        ClankerdomeMarket market = ClankerdomeMarket(payable(marketAddress));
        (string memory launchId, , , , , , ) = market.getMarketSummary();

        market.resolveMarket(winningOutcome);

        emit MarketResolved(marketAddress, launchId, winningOutcome);
    }

    /**
     * @notice Resolve market by launch ID and type
     * @param launchId Launch ID
     * @param marketType Market type
     * @param winningOutcome Winning outcome (0-4)
     */
    function resolveMarketByLaunch(
        string calldata launchId,
        string calldata marketType,
        uint8 winningOutcome
    ) external onlyOwner {
        address marketAddress = launchMarkets[launchId][marketType];
        require(marketAddress != address(0), "Market not found");

        ClankerdomeMarket(payable(marketAddress)).resolveMarket(winningOutcome);

        emit MarketResolved(marketAddress, launchId, winningOutcome);
    }

    /**
     * @notice Cancel a market
     * @param marketAddress Market address to cancel
     */
    function cancelMarket(address marketAddress) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");

        ClankerdomeMarket market = ClankerdomeMarket(payable(marketAddress));
        (string memory launchId, , , , , , ) = market.getMarketSummary();

        market.cancelMarket();

        emit MarketCancelled(marketAddress, launchId);
    }

    /**
     * @notice Batch resolve multiple markets
     * @param marketAddresses Array of market addresses
     * @param winningOutcomes Array of winning outcomes
     */
    function batchResolveMarkets(
        address[] calldata marketAddresses,
        uint8[] calldata winningOutcomes
    ) external onlyOwner {
        require(marketAddresses.length == winningOutcomes.length, "Length mismatch");

        for (uint256 i = 0; i < marketAddresses.length; i++) {
            if (isMarket[marketAddresses[i]]) {
                ClankerdomeMarket market = ClankerdomeMarket(payable(marketAddresses[i]));
                (string memory launchId, , ClankerdomeMarket.MarketStatus status, , , , ) = market.getMarketSummary();

                if (status == ClankerdomeMarket.MarketStatus.Active ||
                    status == ClankerdomeMarket.MarketStatus.Paused) {
                    market.resolveMarket(winningOutcomes[i]);
                    emit MarketResolved(marketAddresses[i], launchId, winningOutcomes[i]);
                }
            }
        }
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Authorize or revoke a market creator
     * @param creator Creator address
     * @param authorized Authorization status
     */
    function setCreatorAuthorization(address creator, bool authorized) external onlyOwner {
        authorizedCreators[creator] = authorized;
        emit CreatorAuthorized(creator, authorized);
    }

    /**
     * @notice Update AI wallet address
     * @param _aiWallet New AI wallet address
     */
    function setAiWallet(address _aiWallet) external onlyOwner {
        require(_aiWallet != address(0), "Invalid address");
        aiWallet = _aiWallet;
        emit WalletUpdated("ai", _aiWallet);
    }

    /**
     * @notice Update protocol wallet address
     * @param _protocolWallet New protocol wallet address
     */
    function setProtocolWallet(address _protocolWallet) external onlyOwner {
        require(_protocolWallet != address(0), "Invalid address");
        protocolWallet = _protocolWallet;
        emit WalletUpdated("protocol", _protocolWallet);
    }

    /**
     * @notice Update default market duration
     * @param _duration New default duration in seconds
     */
    function setDefaultDuration(uint256 _duration) external onlyOwner {
        require(_duration > 0, "Invalid duration");
        defaultDuration = _duration;
    }

    /**
     * @notice End market timer early (for testing)
     * @param marketAddress Market address
     */
    function endMarketTimerEarly(address marketAddress) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");
        ClankerdomeMarket(payable(marketAddress)).endTimerEarly();
    }

    /**
     * @notice Pause trading on a market
     * @param marketAddress Market address
     */
    function pauseMarket(address marketAddress) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");
        ClankerdomeMarket(payable(marketAddress)).pauseTrading();
    }

    /**
     * @notice Resume trading on a market
     * @param marketAddress Market address
     */
    function resumeMarket(address marketAddress) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");
        ClankerdomeMarket(payable(marketAddress)).resumeTrading();
    }

    /**
     * @notice Update outcome labels for a market
     * @param marketAddress Market address
     * @param labels New outcome labels
     */
    function setMarketLabels(
        address marketAddress,
        string[5] calldata labels
    ) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");
        ClankerdomeMarket(payable(marketAddress)).setOutcomeLabels(labels);
    }

    /**
     * @notice Emergency withdraw ETH from a market
     * @param marketAddress Market address
     */
    function emergencyWithdrawETH(address marketAddress) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");
        ClankerdomeMarket(payable(marketAddress)).withdrawETH();
    }

    /**
     * @notice Emergency withdraw ERC20 from a market
     * @param marketAddress Market address
     * @param token Token address
     */
    function emergencyWithdrawERC20(address marketAddress, address token) external onlyOwner {
        require(isMarket[marketAddress], "Unknown market");
        ClankerdomeMarket(payable(marketAddress)).withdrawERC20(token);
    }

    /**
     * @notice Withdraw ETH from hub
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Withdraw ERC20 from hub
     * @param token Token address
     */
    function withdrawERC20(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(token).safeTransfer(owner(), balance);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Get market address for a launch and type
     * @param launchId Launch ID
     * @param marketType Market type
     */
    function getMarket(
        string calldata launchId,
        string calldata marketType
    ) external view returns (address) {
        return launchMarkets[launchId][marketType];
    }

    /**
     * @notice Get all markets for a launch
     * @param launchId Launch ID
     */
    function getMarketsByLaunch(string calldata launchId) external view returns (address[] memory) {
        return marketsByLaunch[launchId];
    }

    /**
     * @notice Get total number of markets
     */
    function getTotalMarkets() external view returns (uint256) {
        return allMarkets.length;
    }

    /**
     * @notice Get all markets (paginated)
     * @param offset Start index
     * @param limit Max results
     */
    function getAllMarkets(uint256 offset, uint256 limit) external view returns (address[] memory) {
        if (offset >= allMarkets.length) {
            return new address[](0);
        }

        uint256 end = offset + limit;
        if (end > allMarkets.length) {
            end = allMarkets.length;
        }

        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allMarkets[i];
        }

        return result;
    }

    /**
     * @notice Get active markets
     */
    function getActiveMarkets() external view returns (address[] memory) {
        // Count active markets
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            ClankerdomeMarket market = ClankerdomeMarket(payable(allMarkets[i]));
            try market.isTradingOpen() returns (bool isOpen) {
                if (isOpen) activeCount++;
            } catch {}
        }

        // Build array
        address[] memory active = new address[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            ClankerdomeMarket market = ClankerdomeMarket(payable(allMarkets[i]));
            try market.isTradingOpen() returns (bool isOpen) {
                if (isOpen) {
                    active[index] = allMarkets[i];
                    index++;
                }
            } catch {}
        }

        return active;
    }

    /**
     * @notice Get market summary data
     * @param marketAddress Market address
     */
    function getMarketSummary(address marketAddress) external view returns (
        string memory launchId,
        string memory marketType,
        ClankerdomeMarket.MarketStatus status,
        uint256 endsAt,
        uint256 totalVolume,
        uint256 totalPool,
        uint8 winningOutcome
    ) {
        require(isMarket[marketAddress], "Unknown market");
        return ClankerdomeMarket(payable(marketAddress)).getMarketSummary();
    }

    /**
     * @notice Check if address is authorized creator
     * @param creator Creator address
     */
    function isAuthorizedCreator(address creator) external view returns (bool) {
        return authorizedCreators[creator] || creator == owner();
    }

    // Allow receiving ETH
    receive() external payable {}
}
