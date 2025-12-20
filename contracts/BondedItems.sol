// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ██████╗  ██████╗ ███╗   ██╗██████╗ ███████╗██████╗     ██╗████████╗███████╗███╗   ███╗███████╗
 * ██╔══██╗██╔═══██╗████╗  ██║██╔══██╗██╔════╝██╔══██╗    ██║╚══██╔══╝██╔════╝████╗ ████║██╔════╝
 * ██████╔╝██║   ██║██╔██╗ ██║██║  ██║█████╗  ██║  ██║    ██║   ██║   █████╗  ██╔████╔██║███████╗
 * ██╔══██╗██║   ██║██║╚██╗██║██║  ██║██╔══╝  ██║  ██║    ██║   ██║   ██╔══╝  ██║╚██╔╝██║╚════██║
 * ██████╔╝╚██████╔╝██║ ╚████║██████╔╝███████╗██████╔╝    ██║   ██║   ███████╗██║ ╚═╝ ██║███████║
 * ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═════╝     ╚═╝   ╚═╝   ╚══════╝╚═╝     ╚═╝╚══════╝
 *
 * V7: DYNAMIC INTERPOLATED FEES WITH CPMM
 *
 * NEW IN V7:
 * - Dynamic fees based on curve position (1% to 20%)
 * - Fee distribution: 30% creator, 70% stakers
 * - Fees interpolate based on token reserve ratio
 *
 * FEE SCHEDULE:
 * - Low price (ratio >= 2.0): 1% fee (encourages buying)
 * - Equilibrium (ratio = 1.0): 10% fee (balanced)
 * - High price (ratio <= 0.1): 20% fee (discourages speculation)
 *
 * Built by kieran.base.eth
 */

/* ═══════════════════════════════════════════════════════════════════════════
 *                              INTERFACES
 * ═══════════════════════════════════════════════════════════════════════════ */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IwASSOTCRouter {
    function swap(uint256 minWassOut) external payable;
}

interface IAppleStaking {
    function addRewards(uint256 amount) external;
}

interface IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4);
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *                              ERRORS
 * ═══════════════════════════════════════════════════════════════════════════ */

error NotOwner();
error NotAdmin();
error ZeroAddress();
error ZeroAmount();
error ReentrancyGuard();
error TransferFailed();
error InsufficientBalance();
error InsufficientPayment();
error InsufficientLiquidity();
error PresaleNotActive();
error PresaleSoldOut();
error BondingCurveNotActive();
error TokenNotFound();
error SlippageExceeded();
error ArrayLengthMismatch();
error NotApproved();
error CurveExhausted();
error ExceedsAvailable();
error MaxTradeExceeded();
error MinReserveViolation();

/* ═══════════════════════════════════════════════════════════════════════════
 *                              MATH LIBRARY
 * ═══════════════════════════════════════════════════════════════════════════ */

library CPMMMath {
    uint256 internal constant PRECISION = 1e18;

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return (a * b) / c;
    }

    function calcBuyCost(
        uint256 tokenReserve,
        uint256 wassReserve,
        uint256 tokenAmount
    ) internal pure returns (uint256 wassCost, uint256 newTokenReserve, uint256 newWassReserve) {
        require(tokenAmount < tokenReserve, "Cannot buy more than reserve");
        uint256 k = tokenReserve * wassReserve;
        newTokenReserve = tokenReserve - tokenAmount;
        newWassReserve = k / newTokenReserve;
        wassCost = newWassReserve - wassReserve;
    }

    function calcSellReturn(
        uint256 tokenReserve,
        uint256 wassReserve,
        uint256 tokenAmount
    ) internal pure returns (uint256 wassReturn, uint256 newTokenReserve, uint256 newWassReserve) {
        uint256 k = tokenReserve * wassReserve;
        newTokenReserve = tokenReserve + tokenAmount;
        newWassReserve = k / newTokenReserve;
        wassReturn = wassReserve - newWassReserve;
    }

    function getSpotPrice(uint256 tokenReserve, uint256 wassReserve) internal pure returns (uint256) {
        if (tokenReserve == 0) return type(uint256).max;
        return mulDiv(wassReserve, PRECISION, tokenReserve);
    }

    function priceImpact(uint256 oldPrice, uint256 newPrice) internal pure returns (uint256) {
        if (oldPrice == 0) return 0;
        if (newPrice > oldPrice) {
            return ((newPrice - oldPrice) * 10000) / oldPrice;
        } else {
            return ((oldPrice - newPrice) * 10000) / oldPrice;
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *                              MAIN CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════ */

contract BondedItems_v7_dynamic_fees {
    using CPMMMath for uint256;

    /* ─────────── Constants ─────────── */
    uint256 private constant BPS = 10_000;
    uint256 private constant PRECISION = 1e18;

    // Fee distribution (presale) - unchanged
    uint256 private constant PRESALE_LIQUIDITY_BPS = 7000;    // 70% seeds AMM liquidity
    uint256 private constant PRESALE_CREATOR_BPS = 2000;       // 20% to creator
    uint256 private constant PRESALE_STAKER_BPS = 1000;        // 10% to stakers

    // NEW: Dynamic fee distribution (trading)
    // 30% to creator, 70% to stakers (no liquidity cut - all distributed)
    uint256 private constant FEE_CREATOR_BPS = 3000;           // 30% of fee to creator
    uint256 private constant FEE_STAKER_BPS = 7000;            // 70% of fee to stakers

    // NEW: Dynamic fee bounds (in BPS)
    uint256 public constant MIN_FEE_BPS = 100;                 // 1% minimum fee
    uint256 public constant MAX_FEE_BPS = 2000;                // 20% maximum fee
    uint256 public constant MID_FEE_BPS = 1000;                // 10% at equilibrium

    // AMM parameters
    uint256 public constant VIRTUAL_SUPPLY_MULTIPLIER = 10;
    uint256 public constant MIN_RESERVE_BPS = 100;
    uint256 public constant MAX_TRADE_PERCENT = 2000;

    /* ─────────── Immutables ─────────── */
    address public immutable WASS;
    address public immutable OTC_ROUTER;
    IAppleStaking public immutable STAKING;

    /* ─────────── State ─────────── */
    address public owner;
    string public name;
    string public symbol;
    string private _baseUri;

    uint256 private _locked = 1;
    mapping(address => bool) public admins;
    uint256 public nextTokenId = 1;

    /* ─────────── Token Data ─────────── */

    enum TokenPhase { None, Presale, BondingCurve, RareItem }

    struct TokenConfig {
        address creator;
        uint256 presalePrice;
        uint256 presaleSupply;
        uint256 presaleSold;
        uint256 presaleWassCollected;
        TokenPhase phase;
        bool exists;
    }

    struct CPMMCurve {
        uint256 virtualTokenReserve;
        uint256 wassReserve;
        uint256 k;
        uint256 initialTokenReserve;
        uint256 initialWassReserve;
        uint256 minTokenReserve;
        uint256 minWassReserve;
        int256 position;
        uint256 adminMinted;
        bool active;
    }

    mapping(uint256 => TokenConfig) public tokenConfigs;
    mapping(uint256 => CPMMCurve) public curves;

    // ERC1155 storage
    mapping(uint256 => mapping(address => uint256)) private _balances;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    /* ─────────── Enhanced Stats ─────────── */
    struct ItemStats {
        uint256 totalVolume;
        uint256 totalBuyVolume;
        uint256 totalSellVolume;
        uint256 totalFees;
        uint256 totalBuys;
        uint256 totalSells;
        uint256 creatorEarnings;
        uint256 stakerRewards;
        uint256 highPrice;
        uint256 lowPrice;
    }
    mapping(uint256 => ItemStats) public itemStats;

    struct GlobalStats {
        uint256 totalPresaleVolume;
        uint256 totalCurveVolume;
        uint256 totalBuyVolume;
        uint256 totalSellVolume;
        uint256 totalFeesCollected;
        uint256 totalCreatorPayouts;
        uint256 totalStakerRewards;
        uint256 totalBuys;
        uint256 totalSells;
    }
    GlobalStats public globalStats;

    /* ─────────── Events ─────────── */
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);

    event TokenCreated(uint256 indexed tokenId, address indexed creator, uint256 presalePrice, uint256 presaleSupply, bool isRareItem);
    event PresalePurchase(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 wassSpent);
    event PresaleEnded(uint256 indexed tokenId, uint256 totalSold, uint256 wassSeeded);

    event CPMMInitialized(
        uint256 indexed tokenId,
        uint256 virtualTokenReserve,
        uint256 wassReserve,
        uint256 k,
        uint256 initialPrice
    );

    // NEW: Enhanced buy event with dynamic fee info
    event CurveBuy(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 tokensBought,
        uint256 wassPaid,
        uint256 fee,
        uint256 feeRateBps,      // NEW: actual fee rate applied
        uint256 creatorShare,    // NEW: creator's share of fee
        uint256 stakerShare,     // NEW: staker's share of fee
        uint256 newPrice,
        int256 newPosition,
        uint256 newTokenReserve,
        uint256 newWassReserve
    );

    // NEW: Enhanced sell event with dynamic fee info
    event CurveSell(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 tokensSold,
        uint256 wassReceived,
        uint256 fee,
        uint256 feeRateBps,
        uint256 creatorShare,
        uint256 stakerShare,
        uint256 newPrice,
        int256 newPosition,
        uint256 newTokenReserve,
        uint256 newWassReserve
    );

    event LiquidityAdded(uint256 indexed tokenId, uint256 wassAdded, uint256 tokensAdded, uint256 newK);
    event AdminMint(uint256 indexed tokenId, address indexed to, uint256 amount);
    event AdminUpdated(address indexed admin, bool status);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    /* ─────────── Modifiers ─────────── */
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAdmin() { if (!admins[msg.sender] && msg.sender != owner) revert NotAdmin(); _; }
    modifier nonReentrant() { if (_locked == 2) revert ReentrancyGuard(); _locked = 2; _; _locked = 1; }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              CONSTRUCTOR
     * ═══════════════════════════════════════════════════════════════════════════ */

    constructor(
        string memory _name,
        string memory _symbol,
        string memory baseUri_,
        address _wass,
        address _otcRouter,
        address _staking
    ) {
        if (_wass == address(0) || _otcRouter == address(0) || _staking == address(0)) revert ZeroAddress();

        name = _name;
        symbol = _symbol;
        _baseUri = baseUri_;
        owner = msg.sender;
        admins[msg.sender] = true;

        WASS = _wass;
        OTC_ROUTER = _otcRouter;
        STAKING = IAppleStaking(_staking);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                     DYNAMIC FEE CALCULATION
     * ═══════════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Calculate dynamic fee based on curve position
     * @dev Fee interpolates linearly based on reserve ratio:
     *      - ratio >= 2.0: 1% (low price, encourages buying)
     *      - ratio = 1.0: 10% (equilibrium)
     *      - ratio <= 0.1: 20% (high price, discourages speculation)
     * @param tokenId The token to calculate fee for
     * @return feeBps The fee in basis points (100 = 1%)
     */
    function calculateDynamicFee(uint256 tokenId) public view returns (uint256 feeBps) {
        CPMMCurve memory curve = curves[tokenId];

        // If curve not active, return mid fee
        if (!curve.active || curve.initialTokenReserve == 0) {
            return MID_FEE_BPS;
        }

        // Calculate ratio: currentReserve / initialReserve (scaled by PRECISION)
        uint256 ratio = (curve.virtualTokenReserve * PRECISION) / curve.initialTokenReserve;

        // Clamp ratio to [0.1, 2.0] range (scaled: 0.1e18 to 2e18)
        uint256 minRatio = PRECISION / 10;    // 0.1
        uint256 maxRatio = 2 * PRECISION;      // 2.0
        uint256 midRatio = PRECISION;          // 1.0

        if (ratio <= minRatio) {
            // At or below 0.1: maximum fee (20%)
            return MAX_FEE_BPS;
        } else if (ratio >= maxRatio) {
            // At or above 2.0: minimum fee (1%)
            return MIN_FEE_BPS;
        } else if (ratio <= midRatio) {
            // Between 0.1 and 1.0: interpolate from 20% to 10%
            // Linear: fee = MAX - (ratio - minRatio) * (MAX - MID) / (midRatio - minRatio)
            uint256 range = midRatio - minRatio;  // 0.9e18
            uint256 feeRange = MAX_FEE_BPS - MID_FEE_BPS;  // 1000 bps
            uint256 reduction = ((ratio - minRatio) * feeRange) / range;
            return MAX_FEE_BPS - reduction;
        } else {
            // Between 1.0 and 2.0: interpolate from 10% to 1%
            // Linear: fee = MID - (ratio - midRatio) * (MID - MIN) / (maxRatio - midRatio)
            uint256 range = maxRatio - midRatio;  // 1.0e18
            uint256 feeRange = MID_FEE_BPS - MIN_FEE_BPS;  // 900 bps
            uint256 reduction = ((ratio - midRatio) * feeRange) / range;
            return MID_FEE_BPS - reduction;
        }
    }

    /**
     * @notice Get fee breakdown for a token
     * @return currentFeeBps Current fee in basis points
     * @return reserveRatio Current reserve ratio (scaled by 1e18)
     * @return creatorShareBps Creator's share of fee (30%)
     * @return stakerShareBps Staker's share of fee (70%)
     */
    function getFeeInfo(uint256 tokenId) external view returns (
        uint256 currentFeeBps,
        uint256 reserveRatio,
        uint256 creatorShareBps,
        uint256 stakerShareBps
    ) {
        CPMMCurve memory curve = curves[tokenId];

        currentFeeBps = calculateDynamicFee(tokenId);

        if (curve.initialTokenReserve > 0) {
            reserveRatio = (curve.virtualTokenReserve * PRECISION) / curve.initialTokenReserve;
        } else {
            reserveRatio = PRECISION;
        }

        creatorShareBps = FEE_CREATOR_BPS;
        stakerShareBps = FEE_STAKER_BPS;
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              ADMIN
     * ═══════════════════════════════════════════════════════════════════════════ */

    function setAdmin(address admin, bool status) external onlyOwner {
        if (admin == address(0)) revert ZeroAddress();
        admins[admin] = status;
        emit AdminUpdated(admin, status);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        admins[newOwner] = true;
        emit OwnershipTransferred(old, newOwner);
    }

    function setBaseURI(string calldata newUri) external onlyOwner {
        _baseUri = newUri;
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              TOKEN CREATION
     * ═══════════════════════════════════════════════════════════════════════════ */

    function createToken(
        address creator,
        uint256 presalePrice,
        uint256 presaleSupply
    ) external onlyAdmin returns (uint256 tokenId) {
        if (creator == address(0)) revert ZeroAddress();
        if (presalePrice == 0 || presaleSupply == 0) revert ZeroAmount();

        tokenId = nextTokenId++;
        tokenConfigs[tokenId] = TokenConfig({
            creator: creator,
            presalePrice: presalePrice,
            presaleSupply: presaleSupply,
            presaleSold: 0,
            presaleWassCollected: 0,
            phase: TokenPhase.Presale,
            exists: true
        });

        itemStats[tokenId].highPrice = presalePrice;
        itemStats[tokenId].lowPrice = presalePrice;

        emit TokenCreated(tokenId, creator, presalePrice, presaleSupply, false);
        emit URI(uri(tokenId), tokenId);
    }

    function createRareItem(address creator) external onlyAdmin returns (uint256 tokenId) {
        if (creator == address(0)) revert ZeroAddress();

        tokenId = nextTokenId++;
        tokenConfigs[tokenId] = TokenConfig({
            creator: creator,
            presalePrice: 0,
            presaleSupply: 0,
            presaleSold: 0,
            presaleWassCollected: 0,
            phase: TokenPhase.RareItem,
            exists: true
        });

        emit TokenCreated(tokenId, creator, 0, 0, true);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              PRESALE
     * ═══════════════════════════════════════════════════════════════════════════ */

    function buyPresaleWithWass(uint256 tokenId, uint256 amount) external nonReentrant {
        TokenConfig storage config = tokenConfigs[tokenId];
        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.Presale) revert PresaleNotActive();
        if (amount == 0) revert ZeroAmount();
        if (config.presaleSold + amount > config.presaleSupply) revert PresaleSoldOut();

        uint256 totalCost = config.presalePrice * amount;

        if (!IERC20(WASS).transferFrom(msg.sender, address(this), totalCost)) revert TransferFailed();

        _distributePresaleFunds(tokenId, totalCost);
        _mint(msg.sender, tokenId, amount);

        config.presaleSold += amount;
        globalStats.totalPresaleVolume += totalCost;
        itemStats[tokenId].totalVolume += totalCost;

        emit PresalePurchase(tokenId, msg.sender, amount, totalCost);

        if (config.presaleSold >= config.presaleSupply) {
            _endPresale(tokenId);
        }
    }

    function buyPresaleWithEth(uint256 tokenId, uint256 amount, uint256 minWassOut) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        TokenConfig storage config = tokenConfigs[tokenId];
        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.Presale) revert PresaleNotActive();
        if (amount == 0) revert ZeroAmount();
        if (config.presaleSold + amount > config.presaleSupply) revert PresaleSoldOut();

        uint256 totalCost = config.presalePrice * amount;

        uint256 wassBefore = IERC20(WASS).balanceOf(address(this));
        IwASSOTCRouter(OTC_ROUTER).swap{value: msg.value}(minWassOut);
        uint256 wassReceived = IERC20(WASS).balanceOf(address(this)) - wassBefore;

        if (wassReceived < totalCost) revert InsufficientPayment();

        if (wassReceived > totalCost) {
            IERC20(WASS).transfer(msg.sender, wassReceived - totalCost);
        }

        _distributePresaleFunds(tokenId, totalCost);
        _mint(msg.sender, tokenId, amount);

        config.presaleSold += amount;
        globalStats.totalPresaleVolume += totalCost;
        itemStats[tokenId].totalVolume += totalCost;

        emit PresalePurchase(tokenId, msg.sender, amount, totalCost);

        if (config.presaleSold >= config.presaleSupply) {
            _endPresale(tokenId);
        }
    }

    function endPresaleEarly(uint256 tokenId) external onlyAdmin {
        TokenConfig storage config = tokenConfigs[tokenId];
        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.Presale) revert PresaleNotActive();
        if (config.presaleSold == 0) revert ZeroAmount();
        _endPresale(tokenId);
    }

    function _distributePresaleFunds(uint256 tokenId, uint256 totalWass) internal {
        TokenConfig storage config = tokenConfigs[tokenId];

        uint256 toLiquidity = (totalWass * PRESALE_LIQUIDITY_BPS) / BPS;
        uint256 toCreator = (totalWass * PRESALE_CREATOR_BPS) / BPS;
        uint256 toStakers = totalWass - toLiquidity - toCreator;

        config.presaleWassCollected += toLiquidity;

        if (toCreator > 0) {
            IERC20(WASS).transfer(config.creator, toCreator);
            globalStats.totalCreatorPayouts += toCreator;
            itemStats[tokenId].creatorEarnings += toCreator;
        }

        if (toStakers > 0) {
            _sendToStakers(toStakers);
            globalStats.totalStakerRewards += toStakers;
            itemStats[tokenId].stakerRewards += toStakers;
        }
    }

    function _endPresale(uint256 tokenId) internal {
        TokenConfig storage config = tokenConfigs[tokenId];

        _initializeCPMM(
            tokenId,
            config.presalePrice,
            config.presaleSold,
            config.presaleWassCollected
        );

        config.phase = TokenPhase.BondingCurve;

        emit PresaleEnded(tokenId, config.presaleSold, config.presaleWassCollected);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                     CPMM INITIALIZATION
     * ═══════════════════════════════════════════════════════════════════════════ */

    function _initializeCPMM(
        uint256 tokenId,
        uint256 /* presalePrice */,
        uint256 presaleSold,
        uint256 baseWass
    ) internal {
        uint256 virtualTokenReserve = presaleSold * VIRTUAL_SUPPLY_MULTIPLIER;
        uint256 wassReserve = baseWass;
        uint256 k = virtualTokenReserve * wassReserve;

        uint256 minTokenReserve = (virtualTokenReserve * MIN_RESERVE_BPS) / BPS;
        uint256 minWassReserve = (wassReserve * MIN_RESERVE_BPS) / BPS;

        if (minTokenReserve == 0) minTokenReserve = 1;
        if (minWassReserve == 0) minWassReserve = 1;

        curves[tokenId] = CPMMCurve({
            virtualTokenReserve: virtualTokenReserve,
            wassReserve: wassReserve,
            k: k,
            initialTokenReserve: virtualTokenReserve,
            initialWassReserve: wassReserve,
            minTokenReserve: minTokenReserve,
            minWassReserve: minWassReserve,
            position: 0,
            adminMinted: 0,
            active: true
        });

        uint256 initialPrice = CPMMMath.getSpotPrice(virtualTokenReserve, wassReserve);

        emit CPMMInitialized(tokenId, virtualTokenReserve, wassReserve, k, initialPrice);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                     CPMM TRADING WITH DYNAMIC FEES
     * ═══════════════════════════════════════════════════════════════════════════ */

    function buyFromCurve(
        uint256 tokenId,
        uint256 tokenAmount,
        uint256 maxWassIn
    ) external nonReentrant {
        TokenConfig storage config = tokenConfigs[tokenId];
        CPMMCurve storage curve = curves[tokenId];

        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.BondingCurve) revert BondingCurveNotActive();
        if (!curve.active) revert BondingCurveNotActive();
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 maxTrade = (curve.virtualTokenReserve * MAX_TRADE_PERCENT) / BPS;
        if (tokenAmount > maxTrade) revert MaxTradeExceeded();
        if (curve.virtualTokenReserve - tokenAmount < curve.minTokenReserve) revert MinReserveViolation();

        (uint256 wassCost, uint256 newTokenReserve, uint256 newWassReserve) =
            CPMMMath.calcBuyCost(curve.virtualTokenReserve, curve.wassReserve, tokenAmount);

        // Calculate dynamic fee
        uint256 feeBps = calculateDynamicFee(tokenId);
        uint256 fee = (wassCost * feeBps) / BPS;
        uint256 totalCost = wassCost + fee;

        if (totalCost > maxWassIn) revert SlippageExceeded();

        if (!IERC20(WASS).transferFrom(msg.sender, address(this), totalCost)) revert TransferFailed();

        // Update curve state (fee stays in contract for distribution)
        curve.virtualTokenReserve = newTokenReserve;
        curve.wassReserve = newWassReserve;
        curve.position += int256(tokenAmount);
        curve.k = curve.virtualTokenReserve * curve.wassReserve;

        // Distribute fee: 30% creator, 70% stakers
        (uint256 creatorShare, uint256 stakerShare) = _distributeTradeFee(tokenId, fee);

        _mint(msg.sender, tokenId, tokenAmount);

        uint256 newPrice = getCurrentPrice(tokenId);
        _updateBuyStats(tokenId, totalCost, fee, newPrice);

        emit CurveBuy(
            tokenId,
            msg.sender,
            tokenAmount,
            totalCost,
            fee,
            feeBps,
            creatorShare,
            stakerShare,
            newPrice,
            curve.position,
            curve.virtualTokenReserve,
            curve.wassReserve
        );
    }

    function buyFromCurveWithEth(
        uint256 tokenId,
        uint256 tokenAmount,
        uint256 minWassFromSwap
    ) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        TokenConfig storage config = tokenConfigs[tokenId];
        CPMMCurve storage curve = curves[tokenId];

        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.BondingCurve) revert BondingCurveNotActive();
        if (!curve.active) revert BondingCurveNotActive();
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 wassBefore = IERC20(WASS).balanceOf(address(this));
        IwASSOTCRouter(OTC_ROUTER).swap{value: msg.value}(minWassFromSwap);
        uint256 wassReceived = IERC20(WASS).balanceOf(address(this)) - wassBefore;

        uint256 maxTrade = (curve.virtualTokenReserve * MAX_TRADE_PERCENT) / BPS;
        if (tokenAmount > maxTrade) revert MaxTradeExceeded();
        if (curve.virtualTokenReserve - tokenAmount < curve.minTokenReserve) revert MinReserveViolation();

        (uint256 wassCost, uint256 newTokenReserve, uint256 newWassReserve) =
            CPMMMath.calcBuyCost(curve.virtualTokenReserve, curve.wassReserve, tokenAmount);

        uint256 feeBps = calculateDynamicFee(tokenId);
        uint256 fee = (wassCost * feeBps) / BPS;
        uint256 totalCost = wassCost + fee;

        if (wassReceived < totalCost) revert InsufficientPayment();

        if (wassReceived > totalCost) {
            IERC20(WASS).transfer(msg.sender, wassReceived - totalCost);
        }

        curve.virtualTokenReserve = newTokenReserve;
        curve.wassReserve = newWassReserve;
        curve.position += int256(tokenAmount);
        curve.k = curve.virtualTokenReserve * curve.wassReserve;

        (uint256 creatorShare, uint256 stakerShare) = _distributeTradeFee(tokenId, fee);

        _mint(msg.sender, tokenId, tokenAmount);

        uint256 newPrice = getCurrentPrice(tokenId);
        _updateBuyStats(tokenId, totalCost, fee, newPrice);

        emit CurveBuy(
            tokenId,
            msg.sender,
            tokenAmount,
            totalCost,
            fee,
            feeBps,
            creatorShare,
            stakerShare,
            newPrice,
            curve.position,
            curve.virtualTokenReserve,
            curve.wassReserve
        );
    }

    function sellToCurve(
        uint256 tokenId,
        uint256 tokenAmount,
        uint256 minWassOut
    ) external nonReentrant {
        TokenConfig storage config = tokenConfigs[tokenId];
        CPMMCurve storage curve = curves[tokenId];

        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.BondingCurve) revert BondingCurveNotActive();
        if (!curve.active) revert BondingCurveNotActive();
        if (tokenAmount == 0) revert ZeroAmount();
        if (_balances[tokenId][msg.sender] < tokenAmount) revert InsufficientBalance();

        (uint256 wassReturn, uint256 newTokenReserve, uint256 newWassReserve) =
            CPMMMath.calcSellReturn(curve.virtualTokenReserve, curve.wassReserve, tokenAmount);

        if (newWassReserve < curve.minWassReserve) revert MinReserveViolation();

        // Calculate dynamic fee
        uint256 feeBps = calculateDynamicFee(tokenId);
        uint256 fee = (wassReturn * feeBps) / BPS;
        uint256 netReturn = wassReturn - fee;

        if (netReturn < minWassOut) revert SlippageExceeded();

        _burn(msg.sender, tokenId, tokenAmount);

        curve.virtualTokenReserve = newTokenReserve;
        curve.wassReserve = newWassReserve;
        curve.position -= int256(tokenAmount);
        curve.k = curve.virtualTokenReserve * curve.wassReserve;

        // Distribute fee: 30% creator, 70% stakers
        (uint256 creatorShare, uint256 stakerShare) = _distributeTradeFee(tokenId, fee);

        if (!IERC20(WASS).transfer(msg.sender, netReturn)) revert TransferFailed();

        uint256 newPrice = getCurrentPrice(tokenId);
        _updateSellStats(tokenId, wassReturn, fee, newPrice);

        emit CurveSell(
            tokenId,
            msg.sender,
            tokenAmount,
            netReturn,
            fee,
            feeBps,
            creatorShare,
            stakerShare,
            newPrice,
            curve.position,
            curve.virtualTokenReserve,
            curve.wassReserve
        );
    }

    /**
     * @notice Distribute trade fee: 30% to creator, 70% to stakers
     * @return creatorShare Amount sent to creator
     * @return stakerShare Amount sent to stakers
     */
    function _distributeTradeFee(uint256 tokenId, uint256 fee) internal returns (uint256 creatorShare, uint256 stakerShare) {
        TokenConfig storage config = tokenConfigs[tokenId];

        // 30% to creator
        creatorShare = (fee * FEE_CREATOR_BPS) / BPS;
        // 70% to stakers
        stakerShare = fee - creatorShare;

        if (creatorShare > 0) {
            IERC20(WASS).transfer(config.creator, creatorShare);
            globalStats.totalCreatorPayouts += creatorShare;
            itemStats[tokenId].creatorEarnings += creatorShare;
        }

        if (stakerShare > 0) {
            _sendToStakers(stakerShare);
            globalStats.totalStakerRewards += stakerShare;
            itemStats[tokenId].stakerRewards += stakerShare;
        }
    }

    function _updateBuyStats(uint256 tokenId, uint256 volume, uint256 fee, uint256 price) internal {
        ItemStats storage stats = itemStats[tokenId];
        stats.totalVolume += volume;
        stats.totalBuyVolume += volume;
        stats.totalFees += fee;
        stats.totalBuys++;
        if (price > stats.highPrice) stats.highPrice = price;

        globalStats.totalCurveVolume += volume;
        globalStats.totalBuyVolume += volume;
        globalStats.totalFeesCollected += fee;
        globalStats.totalBuys++;
    }

    function _updateSellStats(uint256 tokenId, uint256 volume, uint256 fee, uint256 price) internal {
        ItemStats storage stats = itemStats[tokenId];
        stats.totalVolume += volume;
        stats.totalSellVolume += volume;
        stats.totalFees += fee;
        stats.totalSells++;
        if (price < stats.lowPrice || stats.lowPrice == 0) stats.lowPrice = price;

        globalStats.totalCurveVolume += volume;
        globalStats.totalSellVolume += volume;
        globalStats.totalFeesCollected += fee;
        globalStats.totalSells++;
    }

    function _sendToStakers(uint256 amount) internal {
        if (amount == 0) return;
        IERC20(WASS).approve(address(STAKING), amount);
        try STAKING.addRewards(amount) {} catch {
            IERC20(WASS).approve(address(STAKING), 0);
            IERC20(WASS).transfer(owner, amount);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              ADMIN LIQUIDITY
     * ═══════════════════════════════════════════════════════════════════════════ */

    function addLiquidity(uint256 tokenId, uint256 wassAmount) external onlyAdmin nonReentrant {
        TokenConfig storage config = tokenConfigs[tokenId];
        CPMMCurve storage curve = curves[tokenId];

        if (!config.exists) revert TokenNotFound();
        if (config.phase != TokenPhase.BondingCurve) revert BondingCurveNotActive();
        if (wassAmount == 0) revert ZeroAmount();

        if (!IERC20(WASS).transferFrom(msg.sender, address(this), wassAmount)) revert TransferFailed();

        uint256 tokenIncrease = (wassAmount * curve.virtualTokenReserve) / curve.wassReserve;

        curve.wassReserve += wassAmount;
        curve.virtualTokenReserve += tokenIncrease;
        curve.k = curve.virtualTokenReserve * curve.wassReserve;

        curve.minWassReserve = (curve.wassReserve * MIN_RESERVE_BPS) / BPS;
        curve.minTokenReserve = (curve.virtualTokenReserve * MIN_RESERVE_BPS) / BPS;

        emit LiquidityAdded(tokenId, wassAmount, tokenIncrease, curve.k);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              ADMIN MINTING
     * ═══════════════════════════════════════════════════════════════════════════ */

    function adminMint(address to, uint256 tokenId, uint256 amount) external onlyAdmin nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!tokenConfigs[tokenId].exists) revert TokenNotFound();

        _mint(to, tokenId, amount);

        if (tokenConfigs[tokenId].phase == TokenPhase.BondingCurve) {
            CPMMCurve storage curve = curves[tokenId];
            curve.adminMinted += amount;
            curve.virtualTokenReserve += amount;
            curve.k = curve.virtualTokenReserve * curve.wassReserve;
        }

        emit AdminMint(tokenId, to, amount);
    }

    function adminMintBatch(
        address[] calldata tos,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external onlyAdmin nonReentrant {
        if (tos.length != tokenIds.length || tokenIds.length != amounts.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < tos.length; i++) {
            if (tos[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            if (!tokenConfigs[tokenIds[i]].exists) revert TokenNotFound();

            _mint(tos[i], tokenIds[i], amounts[i]);

            if (tokenConfigs[tokenIds[i]].phase == TokenPhase.BondingCurve) {
                CPMMCurve storage curve = curves[tokenIds[i]];
                curve.adminMinted += amounts[i];
                curve.virtualTokenReserve += amounts[i];
                curve.k = curve.virtualTokenReserve * curve.wassReserve;
            }

            emit AdminMint(tokenIds[i], tos[i], amounts[i]);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              VIEW FUNCTIONS
     * ═══════════════════════════════════════════════════════════════════════════ */

    function getCurrentPrice(uint256 tokenId) public view returns (uint256) {
        TokenConfig memory config = tokenConfigs[tokenId];
        if (!config.exists) return 0;

        if (config.phase == TokenPhase.Presale) {
            return config.presalePrice;
        } else if (config.phase == TokenPhase.BondingCurve) {
            CPMMCurve memory curve = curves[tokenId];
            return CPMMMath.getSpotPrice(curve.virtualTokenReserve, curve.wassReserve);
        }
        return 0;
    }

    function quoteBuy(uint256 tokenId, uint256 tokenAmount) external view returns (
        uint256 wassCost,
        uint256 fee,
        uint256 totalCost,
        uint256 newPrice,
        uint256 slippageBps,
        uint256 feeBps
    ) {
        TokenConfig memory config = tokenConfigs[tokenId];
        if (!config.exists || config.phase != TokenPhase.BondingCurve) return (0, 0, 0, 0, 0, 0);

        CPMMCurve memory curve = curves[tokenId];

        if (tokenAmount >= curve.virtualTokenReserve - curve.minTokenReserve) return (0, 0, 0, 0, 0, 0);

        (uint256 cost, uint256 newTokenReserve, uint256 newWassReserve) =
            CPMMMath.calcBuyCost(curve.virtualTokenReserve, curve.wassReserve, tokenAmount);

        feeBps = calculateDynamicFee(tokenId);
        fee = (cost * feeBps) / BPS;
        wassCost = cost;
        totalCost = cost + fee;

        newPrice = CPMMMath.getSpotPrice(newTokenReserve, newWassReserve);

        uint256 currentPrice = CPMMMath.getSpotPrice(curve.virtualTokenReserve, curve.wassReserve);
        slippageBps = CPMMMath.priceImpact(currentPrice, newPrice);
    }

    function quoteSell(uint256 tokenId, uint256 tokenAmount) external view returns (
        uint256 wassReturn,
        uint256 fee,
        uint256 netReturn,
        uint256 newPrice,
        uint256 slippageBps,
        uint256 feeBps
    ) {
        TokenConfig memory config = tokenConfigs[tokenId];
        if (!config.exists || config.phase != TokenPhase.BondingCurve) return (0, 0, 0, 0, 0, 0);

        CPMMCurve memory curve = curves[tokenId];

        (uint256 grossReturn, uint256 newTokenReserve, uint256 newWassReserve) =
            CPMMMath.calcSellReturn(curve.virtualTokenReserve, curve.wassReserve, tokenAmount);

        if (newWassReserve < curve.minWassReserve) return (0, 0, 0, 0, 0, 0);

        feeBps = calculateDynamicFee(tokenId);
        fee = (grossReturn * feeBps) / BPS;
        wassReturn = grossReturn;
        netReturn = grossReturn - fee;

        newPrice = CPMMMath.getSpotPrice(newTokenReserve, newWassReserve);

        uint256 currentPrice = CPMMMath.getSpotPrice(curve.virtualTokenReserve, curve.wassReserve);
        slippageBps = CPMMMath.priceImpact(currentPrice, newPrice);
    }

    function getCurveInfo(uint256 tokenId) external view returns (
        uint256 virtualTokenReserve,
        uint256 wassReserve,
        uint256 k,
        uint256 currentPrice,
        int256 position,
        uint256 initialTokenReserve,
        uint256 initialWassReserve,
        uint256 minTokenReserve,
        uint256 minWassReserve,
        uint256 adminMinted,
        bool active
    ) {
        CPMMCurve memory curve = curves[tokenId];

        virtualTokenReserve = curve.virtualTokenReserve;
        wassReserve = curve.wassReserve;
        k = curve.k;
        currentPrice = getCurrentPrice(tokenId);
        position = curve.position;
        initialTokenReserve = curve.initialTokenReserve;
        initialWassReserve = curve.initialWassReserve;
        minTokenReserve = curve.minTokenReserve;
        minWassReserve = curve.minWassReserve;
        adminMinted = curve.adminMinted;
        active = curve.active;
    }

    function getPoolReserves(uint256 tokenId) external view returns (
        uint256 tokensInPool,
        uint256 wassInPool,
        uint256 pricePerToken
    ) {
        CPMMCurve memory curve = curves[tokenId];
        tokensInPool = curve.virtualTokenReserve;
        wassInPool = curve.wassReserve;
        pricePerToken = getCurrentPrice(tokenId);
    }

    function getItemStats(uint256 tokenId) external view returns (
        uint256 totalVolume,
        uint256 totalBuyVolume,
        uint256 totalSellVolume,
        uint256 totalFees,
        uint256 totalBuys,
        uint256 totalSells,
        uint256 creatorEarnings,
        uint256 stakerRewards,
        uint256 highPrice,
        uint256 lowPrice
    ) {
        ItemStats memory stats = itemStats[tokenId];
        return (
            stats.totalVolume,
            stats.totalBuyVolume,
            stats.totalSellVolume,
            stats.totalFees,
            stats.totalBuys,
            stats.totalSells,
            stats.creatorEarnings,
            stats.stakerRewards,
            stats.highPrice,
            stats.lowPrice
        );
    }

    function getGlobalStats() external view returns (
        uint256 totalPresaleVolume,
        uint256 totalCurveVolume,
        uint256 totalBuyVolume,
        uint256 totalSellVolume,
        uint256 totalFeesCollected,
        uint256 totalCreatorPayouts,
        uint256 totalStakerRewards,
        uint256 totalBuys,
        uint256 totalSells,
        uint256 totalTokens
    ) {
        GlobalStats memory g = globalStats;
        return (
            g.totalPresaleVolume,
            g.totalCurveVolume,
            g.totalBuyVolume,
            g.totalSellVolume,
            g.totalFeesCollected,
            g.totalCreatorPayouts,
            g.totalStakerRewards,
            g.totalBuys,
            g.totalSells,
            nextTokenId - 1
        );
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              ERC1155 CORE
     * ═══════════════════════════════════════════════════════════════════════════ */

    function uri(uint256 tokenId) public view returns (string memory) {
        return string(abi.encodePacked(_baseUri, _toString(tokenId), ".json"));
    }

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory balances) {
        if (accounts.length != ids.length) revert ArrayLengthMismatch();
        balances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            balances[i] = _balances[ids[i]][accounts[i]];
        }
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external nonReentrant {
        if (from != msg.sender && !_operatorApprovals[from][msg.sender]) revert NotApproved();
        if (to == address(0)) revert ZeroAddress();
        if (tokenConfigs[id].phase == TokenPhase.Presale) revert PresaleNotActive();

        _transfer(from, to, id, amount);

        if (_isContract(to)) {
            require(
                IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data) == IERC1155Receiver.onERC1155Received.selector,
                "ERC1155: transfer rejected"
            );
        }
    }

    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external nonReentrant {
        if (from != msg.sender && !_operatorApprovals[from][msg.sender]) revert NotApproved();
        if (to == address(0)) revert ZeroAddress();
        if (ids.length != amounts.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < ids.length; i++) {
            if (tokenConfigs[ids[i]].phase == TokenPhase.Presale) revert PresaleNotActive();
            _transfer(from, to, ids[i], amounts[i]);
        }

        if (_isContract(to)) {
            require(
                IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, amounts, data) == IERC1155Receiver.onERC1155BatchReceived.selector,
                "ERC1155: batch transfer rejected"
            );
        }
    }

    function _transfer(address from, address to, uint256 id, uint256 amount) internal {
        if (_balances[id][from] < amount) revert InsufficientBalance();
        _balances[id][from] -= amount;
        _balances[id][to] += amount;
        emit TransferSingle(msg.sender, from, to, id, amount);
    }

    function _mint(address to, uint256 id, uint256 amount) internal {
        _balances[id][to] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
    }

    function _burn(address from, uint256 id, uint256 amount) internal {
        if (_balances[id][from] < amount) revert InsufficientBalance();
        _balances[id][from] -= amount;
        emit TransferSingle(msg.sender, from, address(0), id, amount);
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     *                              EMERGENCY
     * ═══════════════════════════════════════════════════════════════════════════ */

    function emergencyPauseCurve(uint256 tokenId) external onlyOwner {
        curves[tokenId].active = false;
    }

    function resumeCurve(uint256 tokenId) external onlyOwner {
        if (tokenConfigs[tokenId].phase == TokenPhase.BondingCurve) {
            curves[tokenId].active = true;
        }
    }

    function emergencyWithdrawETH(uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function emergencyWithdrawToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (!IERC20(token).transfer(owner, amount)) revert TransferFailed();
    }

    /* ─────────── Helpers ─────────── */

    function _isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly { size := extcodesize(account) }
        return size > 0;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(buffer);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0xd9b67a26 || interfaceId == 0x0e89341c;
    }

    receive() external payable {}
}
