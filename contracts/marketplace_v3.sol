// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ███╗   ███╗ █████╗ ██████╗ ██╗  ██╗███████╗████████╗██████╗ ██╗      █████╗  ██████╗███████╗
 * ████╗ ████║██╔══██╗██╔══██╗██║ ██╔╝██╔════╝╚══██╔══╝██╔══██╗██║     ██╔══██╗██╔════╝██╔════╝
 * ██╔████╔██║███████║██████╔╝█████╔╝ █████╗     ██║   ██████╔╝██║     ███████║██║     █████╗
 * ██║╚██╔╝██║██╔══██║██╔══██╗██╔═██╗ ██╔══╝     ██║   ██╔═══╝ ██║     ██╔══██║██║     ██╔══╝
 * ██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██╗███████╗   ██║   ██║     ███████╗██║  ██║╚██████╗███████╗
 * ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝
 *
 * Apple Snakes NFT Marketplace v3 - STAKER REWARDS EDITION
 *
 * KEY CHANGE FROM V2:
 * - ALL marketplace fees now go to stakers via addRewards()
 * - No more feeRecipient wallet - everything flows to AppleStaking
 * - Fees are already in wASS, so no conversion needed
 *
 * FEATURES:
 * - List NFTs for sale in wASS
 * - Buy with wASS directly or ETH (auto-converts via wASSOTC router)
 * - Multi-collection support (NFTs, Items, future collections)
 * - Configurable seller fee (1-10%, default 5%)
 * - ALL FEES → STAKERS via AppleStaking.addRewards()
 * - Minimum listing price: 1 wASS (prevents wrapper arbitrage)
 * - Auto-cleanup of sold/invalid listings
 * - Stale listing overwrite (if owner changed)
 * - Paginated active listings enumeration
 *
 * Built by kieran.base.eth
 */

/* ─────────── Interfaces ─────────── */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IwASSOTCRouter {
    function swap(uint256 minWassOut) external payable;
    function quote(uint256 ethIn) external view returns (
        uint256 swapPortion,
        uint256 otcPortion,
        uint256 otcAvailable,
        uint256 currentOtcBps,
        uint256 currentOtcFeeBps,
        bool hasOtc
    );
}

/**
 * @notice AppleStaking interface for sending rewards to stakers
 * @dev This is the same interface used by wASSBLASTER
 */
interface IAppleStaking {
    function addRewards(uint256 amount) external;
}

/* ─────────── Errors ─────────── */

error NotOwner();
error NotSeller();
error ZeroAddress();
error ZeroAmount();
error CollectionNotApproved();
error CollectionAlreadyApproved();
error ListingNotActive();
error PriceTooLow();
error InsufficientPayment();
error TransferFailed();
error InvalidFee();
error NotApprovedForTransfer();
error ReentrancyGuard();
error SlippageExceeded();
error InvalidPagination();

/**
 * @title AppleSnakesMarketplaceV3
 * @notice Multi-collection NFT marketplace for trading NFTs in wASS
 * @dev V3 sends all fees to stakers via AppleStaking.addRewards()
 */
contract AppleSnakesMarketplaceV3 {
    /* ─────────── Constants ─────────── */
    uint256 private constant BPS = 10_000;
    uint256 private constant MIN_FEE_BPS = 100;      // 1% minimum fee
    uint256 private constant MAX_FEE_BPS = 1000;     // 10% maximum fee
    uint256 private constant DEFAULT_FEE_BPS = 500;  // 5% default fee
    uint256 public constant MIN_LISTING_PRICE = 1e18; // 1 wASS minimum (prevents wrapper arbitrage)
    uint256 private constant MAX_PAGE_SIZE = 100;    // Max items per page for pagination

    /* ─────────── Immutables ─────────── */
    address public immutable WASS;
    address public immutable OTC_ROUTER;

    /* ─────────── State ─────────── */
    address public owner;
    IAppleStaking public appleStaking;    // V3: Staking contract for rewards
    address public protocolOwner;          // V3: Fallback if staking fails
    uint256 public feeBps;

    // Reentrancy guard
    uint256 private _locked = 1;

    // Approved collections
    mapping(address => bool) public approvedCollections;
    address[] public collectionList;
    uint256 public collectionCount;

    // Listings: collection => tokenId => Listing
    struct Listing {
        address seller;
        uint256 price;      // in wASS (18 decimals)
        bool active;
    }
    mapping(address => mapping(uint256 => Listing)) public listings;

    // Active listings tracking for enumeration (O(1) add/remove)
    // collection => array of active tokenIds
    mapping(address => uint256[]) private _activeListings;
    // collection => tokenId => index in _activeListings array (1-indexed, 0 = not in array)
    mapping(address => mapping(uint256 => uint256)) private _listingIndex;

    // Stats
    uint256 public totalListings;
    uint256 public totalSales;
    uint256 public totalVolumeWass;
    uint256 public totalFeesCollected;
    uint256 public totalFeesToStakers;    // V3: Track fees sent to stakers
    uint256 public activeListingCount;

    /* ─────────── Events ─────────── */
    event CollectionApproved(address indexed collection);
    event CollectionRemoved(address indexed collection);
    event Listed(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );
    event Unlisted(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed seller
    );
    event ListingOverwritten(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed oldSeller,
        address newSeller
    );
    event PriceUpdated(
        address indexed collection,
        uint256 indexed tokenId,
        uint256 oldPrice,
        uint256 newPrice
    );
    event Sold(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed buyer,
        address seller,
        uint256 price,
        uint256 fee,
        bool paidWithEth
    );
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // V3: New events for staking integration
    event StakingRewards(uint256 amount);
    event StakingContractUpdated(address indexed oldStaking, address indexed newStaking);
    event ProtocolOwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event StakingFallback(uint256 amount, address recipient);

    /* ─────────── Modifiers ─────────── */
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 2) revert ReentrancyGuard();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier validCollection(address collection) {
        if (!approvedCollections[collection]) revert CollectionNotApproved();
        _;
    }

    /* ─────────── Constructor ─────────── */
    /**
     * @notice Initialize marketplace with staking integration
     * @param _wass wASS token address
     * @param _otcRouter OTC router for ETH→wASS swaps
     * @param _appleStaking AppleStaking contract for rewards
     * @param _protocolOwner Fallback address if staking fails
     */
    constructor(
        address _wass,
        address _otcRouter,
        address _appleStaking,
        address _protocolOwner
    ) {
        if (_wass == address(0)) revert ZeroAddress();
        if (_otcRouter == address(0)) revert ZeroAddress();
        if (_appleStaking == address(0)) revert ZeroAddress();
        if (_protocolOwner == address(0)) revert ZeroAddress();

        WASS = _wass;
        OTC_ROUTER = _otcRouter;
        owner = msg.sender;
        appleStaking = IAppleStaking(_appleStaking);
        protocolOwner = _protocolOwner;
        feeBps = DEFAULT_FEE_BPS;
    }

    receive() external payable {}

    /* ═══════════════════════════════════════════════════════════════════════
     *                           COLLECTION MANAGEMENT
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Approve a new NFT collection for trading
     * @param collection The ERC721 contract address
     */
    function approveCollection(address collection) external onlyOwner {
        if (collection == address(0)) revert ZeroAddress();
        if (approvedCollections[collection]) revert CollectionAlreadyApproved();

        approvedCollections[collection] = true;
        collectionList.push(collection);
        collectionCount++;

        emit CollectionApproved(collection);
    }

    /**
     * @notice Remove a collection from approved list
     * @param collection The ERC721 contract address
     * @dev Does NOT cancel existing listings - sellers must cancel manually
     */
    function removeCollection(address collection) external onlyOwner {
        if (!approvedCollections[collection]) revert CollectionNotApproved();

        approvedCollections[collection] = false;

        emit CollectionRemoved(collection);
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                           LISTING MANAGEMENT
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice List an NFT for sale
     * @param collection The NFT collection address
     * @param tokenId The token ID to list
     * @param price Price in wASS (must be >= 1 wASS)
     */
    function list(
        address collection,
        uint256 tokenId,
        uint256 price
    ) external nonReentrant validCollection(collection) {
        if (price < MIN_LISTING_PRICE) revert PriceTooLow();

        IERC721 nft = IERC721(collection);

        // Verify ownership
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();

        // Verify approval
        if (!_isApprovedForTransfer(nft, msg.sender, tokenId)) {
            revert NotApprovedForTransfer();
        }

        Listing storage listing = listings[collection][tokenId];

        // Check if already listed
        if (listing.active) {
            if (listing.seller == msg.sender) {
                revert PriceTooLow(); // Use updatePrice for price changes
            }
            // Stale listing by different owner - overwrite
            address oldSeller = listing.seller;
            emit ListingOverwritten(collection, tokenId, oldSeller, msg.sender);
        } else {
            _addToActiveListings(collection, tokenId);
            totalListings++;
            activeListingCount++;
        }

        listing.seller = msg.sender;
        listing.price = price;
        listing.active = true;

        emit Listed(collection, tokenId, msg.sender, price);
    }

    /**
     * @notice List multiple NFTs for sale at the same price
     */
    function listBatch(
        address collection,
        uint256[] calldata tokenIds,
        uint256 price
    ) external nonReentrant validCollection(collection) {
        if (price < MIN_LISTING_PRICE) revert PriceTooLow();

        IERC721 nft = IERC721(collection);
        uint256 count = tokenIds.length;

        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];

            if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
            if (!_isApprovedForTransfer(nft, msg.sender, tokenId)) {
                revert NotApprovedForTransfer();
            }

            Listing storage listing = listings[collection][tokenId];

            if (listing.active) {
                if (listing.seller == msg.sender) continue;
                emit ListingOverwritten(collection, tokenId, listing.seller, msg.sender);
            } else {
                _addToActiveListings(collection, tokenId);
                totalListings++;
                activeListingCount++;
            }

            listing.seller = msg.sender;
            listing.price = price;
            listing.active = true;

            emit Listed(collection, tokenId, msg.sender, price);
        }
    }

    /**
     * @notice Cancel a listing
     */
    function unlist(
        address collection,
        uint256 tokenId
    ) external nonReentrant {
        Listing storage listing = listings[collection][tokenId];

        if (!listing.active) revert ListingNotActive();
        if (listing.seller != msg.sender) revert NotSeller();

        _removeListing(collection, tokenId);

        emit Unlisted(collection, tokenId, msg.sender);
    }

    /**
     * @notice Update the price of a listing
     */
    function updatePrice(
        address collection,
        uint256 tokenId,
        uint256 newPrice
    ) external nonReentrant {
        if (newPrice < MIN_LISTING_PRICE) revert PriceTooLow();

        Listing storage listing = listings[collection][tokenId];

        if (!listing.active) revert ListingNotActive();
        if (listing.seller != msg.sender) revert NotSeller();

        uint256 oldPrice = listing.price;
        listing.price = newPrice;

        emit PriceUpdated(collection, tokenId, oldPrice, newPrice);
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                           BUYING
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Buy an NFT with wASS
     * @dev V3: Fees go to stakers via addRewards()
     */
    function buyWithWass(
        address collection,
        uint256 tokenId
    ) external nonReentrant {
        Listing storage listing = listings[collection][tokenId];

        if (!listing.active) revert ListingNotActive();

        address seller = listing.seller;
        uint256 price = listing.price;

        // Remove listing before transfers (reentrancy protection)
        _removeListing(collection, tokenId);

        // Calculate fee
        uint256 fee = (price * feeBps) / BPS;
        uint256 sellerProceeds = price - fee;

        IERC20 wass = IERC20(WASS);

        // V3: Send fee to stakers
        if (fee > 0) {
            // Transfer fee from buyer to this contract first
            if (!wass.transferFrom(msg.sender, address(this), fee)) {
                revert TransferFailed();
            }
            // Then send to stakers
            _sendToStakers(fee);
            totalFeesCollected += fee;
        }

        // Transfer proceeds to seller
        if (!wass.transferFrom(msg.sender, seller, sellerProceeds)) {
            revert TransferFailed();
        }

        // Transfer NFT to buyer
        IERC721(collection).safeTransferFrom(seller, msg.sender, tokenId);

        // Update stats
        totalSales++;
        totalVolumeWass += price;

        emit Sold(collection, tokenId, msg.sender, seller, price, fee, false);
    }

    /**
     * @notice Buy an NFT with ETH (auto-converts to wASS via OTC router)
     * @dev V3: Fees go to stakers via addRewards()
     */
    function buyWithEth(
        address collection,
        uint256 tokenId,
        uint256 minWassOut
    ) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        Listing storage listing = listings[collection][tokenId];

        if (!listing.active) revert ListingNotActive();

        address seller = listing.seller;
        uint256 price = listing.price;

        // Remove listing before external calls (reentrancy protection)
        _removeListing(collection, tokenId);

        // Swap ETH for wASS via OTC router
        uint256 wassBefore = IERC20(WASS).balanceOf(address(this));
        IwASSOTCRouter(OTC_ROUTER).swap{value: msg.value}(minWassOut);
        uint256 wassReceived = IERC20(WASS).balanceOf(address(this)) - wassBefore;

        // Ensure we got enough wASS
        if (wassReceived < price) revert InsufficientPayment();

        // Calculate fee
        uint256 fee = (price * feeBps) / BPS;
        uint256 sellerProceeds = price - fee;

        IERC20 wass = IERC20(WASS);

        // V3: Send fee to stakers (already in contract from swap)
        if (fee > 0) {
            _sendToStakers(fee);
            totalFeesCollected += fee;
        }

        // Transfer proceeds to seller
        if (!wass.transfer(seller, sellerProceeds)) {
            revert TransferFailed();
        }

        // Return any excess wASS to buyer
        uint256 excess = wassReceived - price;
        if (excess > 0) {
            if (!wass.transfer(msg.sender, excess)) {
                revert TransferFailed();
            }
        }

        // Transfer NFT to buyer
        IERC721(collection).safeTransferFrom(seller, msg.sender, tokenId);

        // Update stats
        totalSales++;
        totalVolumeWass += price;

        emit Sold(collection, tokenId, msg.sender, seller, price, fee, true);
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                     V3: STAKING REWARDS DISTRIBUTION
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Send wASS fees to stakers via AppleStaking.addRewards()
     * @dev Same pattern as wASSBLASTER - approve then addRewards with fallback
     * @param amount Amount of wASS to send to stakers
     */
    function _sendToStakers(uint256 amount) internal {
        if (amount == 0) return;

        IERC20 wass = IERC20(WASS);

        if (address(appleStaking) != address(0)) {
            // Approve staking contract to spend our wASS
            wass.approve(address(appleStaking), amount);

            // Try to add rewards to staking contract
            try appleStaking.addRewards(amount) {
                totalFeesToStakers += amount;
                emit StakingRewards(amount);
            } catch {
                // Staking failed - send to protocol owner as fallback
                wass.approve(address(appleStaking), 0); // Reset approval
                if (!wass.transfer(protocolOwner, amount)) {
                    revert TransferFailed();
                }
                emit StakingFallback(amount, protocolOwner);
            }
        } else {
            // No staking contract set - send to protocol owner
            if (!wass.transfer(protocolOwner, amount)) {
                revert TransferFailed();
            }
            emit StakingFallback(amount, protocolOwner);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                           ADMIN FUNCTIONS
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Set the marketplace fee (seller pays)
     * @param newFeeBps Fee in basis points (100 = 1%, 1000 = 10%)
     */
    function setFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps < MIN_FEE_BPS || newFeeBps > MAX_FEE_BPS) {
            revert InvalidFee();
        }

        uint256 oldFee = feeBps;
        feeBps = newFeeBps;

        emit FeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @notice V3: Update the staking contract address
     * @param _appleStaking New AppleStaking contract address
     */
    function setAppleStaking(address _appleStaking) external onlyOwner {
        if (_appleStaking == address(0)) revert ZeroAddress();

        address oldStaking = address(appleStaking);
        appleStaking = IAppleStaking(_appleStaking);

        emit StakingContractUpdated(oldStaking, _appleStaking);
    }

    /**
     * @notice V3: Update the protocol owner (fallback recipient)
     * @param _protocolOwner New protocol owner address
     */
    function setProtocolOwner(address _protocolOwner) external onlyOwner {
        if (_protocolOwner == address(0)) revert ZeroAddress();

        address oldOwner = protocolOwner;
        protocolOwner = _protocolOwner;

        emit ProtocolOwnerUpdated(oldOwner, _protocolOwner);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        address oldOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @notice Admin function to clean up stale listings
     */
    function cleanupStaleListings(
        address collection,
        uint256[] calldata tokenIds
    ) external {
        IERC721 nft = IERC721(collection);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            Listing storage listing = listings[collection][tokenId];

            if (listing.active) {
                try nft.ownerOf(tokenId) returns (address currentOwner) {
                    if (currentOwner != listing.seller) {
                        _removeListing(collection, tokenId);
                        emit Unlisted(collection, tokenId, listing.seller);
                    }
                } catch {
                    _removeListing(collection, tokenId);
                }
            }
        }
    }

    /**
     * @notice Emergency withdraw ETH
     */
    function emergencyWithdrawETH(uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /**
     * @notice Emergency withdraw ERC20
     */
    function emergencyWithdrawERC20(address token, uint256 amount) external onlyOwner nonReentrant {
        if (!IERC20(token).transfer(owner, amount)) {
            revert TransferFailed();
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                           VIEW FUNCTIONS
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Get listing details
     */
    function getListing(
        address collection,
        uint256 tokenId
    ) external view returns (
        address seller,
        uint256 price,
        bool active,
        bool isApproved
    ) {
        Listing memory listing = listings[collection][tokenId];
        seller = listing.seller;
        price = listing.price;
        active = listing.active;

        if (active && seller != address(0)) {
            try IERC721(collection).ownerOf(tokenId) returns (address currentOwner) {
                if (currentOwner == seller) {
                    IERC721 nft = IERC721(collection);
                    isApproved = _isApprovedForTransfer(nft, seller, tokenId);
                }
            } catch {
                isApproved = false;
            }
        }
    }

    /**
     * @notice Get batch listing details
     */
    function getListingsBatch(
        address collection,
        uint256[] calldata tokenIds
    ) external view returns (
        address[] memory sellers,
        uint256[] memory prices,
        bool[] memory actives
    ) {
        uint256 count = tokenIds.length;
        sellers = new address[](count);
        prices = new uint256[](count);
        actives = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            Listing memory listing = listings[collection][tokenIds[i]];
            sellers[i] = listing.seller;
            prices[i] = listing.price;
            actives[i] = listing.active;
        }
    }

    /**
     * @notice Get active listings for a collection with pagination
     */
    function getActiveListings(
        address collection,
        uint256 offset,
        uint256 limit
    ) external view returns (
        uint256[] memory tokenIds,
        address[] memory sellers,
        uint256[] memory prices,
        uint256 total
    ) {
        if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

        uint256[] storage activeTokenIds = _activeListings[collection];
        total = activeTokenIds.length;

        if (offset >= total) {
            return (new uint256[](0), new address[](0), new uint256[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        tokenIds = new uint256[](count);
        sellers = new address[](count);
        prices = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = activeTokenIds[offset + i];
            Listing memory listing = listings[collection][tokenId];

            tokenIds[i] = tokenId;
            sellers[i] = listing.seller;
            prices[i] = listing.price;
        }
    }

    /**
     * @notice Get count of active listings for a collection
     */
    function getActiveListingCount(address collection) external view returns (uint256) {
        return _activeListings[collection].length;
    }

    /**
     * @notice Get all active listings across all collections with pagination
     */
    function getAllActiveListings(
        uint256 offset,
        uint256 limit
    ) external view returns (
        address[] memory collections,
        uint256[] memory tokenIds,
        address[] memory sellers,
        uint256[] memory prices,
        uint256 total
    ) {
        if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

        total = activeListingCount;

        if (offset >= total) {
            return (
                new address[](0),
                new uint256[](0),
                new address[](0),
                new uint256[](0),
                total
            );
        }

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        collections = new address[](count);
        tokenIds = new uint256[](count);
        sellers = new address[](count);
        prices = new uint256[](count);

        uint256 currentIndex = 0;
        uint256 resultIndex = 0;

        for (uint256 c = 0; c < collectionCount && resultIndex < count; c++) {
            address collection = collectionList[c];
            uint256[] storage activeTokenIds = _activeListings[collection];
            uint256 collectionListingCount = activeTokenIds.length;

            for (uint256 i = 0; i < collectionListingCount && resultIndex < count; i++) {
                if (currentIndex >= offset) {
                    uint256 tokenId = activeTokenIds[i];
                    Listing memory listing = listings[collection][tokenId];

                    collections[resultIndex] = collection;
                    tokenIds[resultIndex] = tokenId;
                    sellers[resultIndex] = listing.seller;
                    prices[resultIndex] = listing.price;
                    resultIndex++;
                }
                currentIndex++;
            }
        }
    }

    /**
     * @notice Quote ETH needed to buy an NFT
     */
    function quoteEthForListing(
        address collection,
        uint256 tokenId
    ) external view returns (
        uint256 ethNeeded,
        uint256 price,
        bool active
    ) {
        Listing memory listing = listings[collection][tokenId];
        price = listing.price;
        active = listing.active;

        if (active && price > 0) {
            (uint256 swapPortion,,,,, ) = IwASSOTCRouter(OTC_ROUTER).quote(1 ether);
            if (swapPortion > 0) {
                ethNeeded = (price * 1 ether * 105) / (swapPortion * 100);
            }
        }
    }

    /**
     * @notice Get all approved collections with pagination
     */
    function getCollections(
        uint256 start,
        uint256 limit
    ) external view returns (
        address[] memory collections,
        bool[] memory approved,
        uint256 total
    ) {
        total = collectionCount;

        if (start >= total) {
            return (new address[](0), new bool[](0), total);
        }

        uint256 end = start + limit;
        if (end > total) end = total;

        uint256 count = end - start;
        collections = new address[](count);
        approved = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            address collection = collectionList[start + i];
            collections[i] = collection;
            approved[i] = approvedCollections[collection];
        }
    }

    /**
     * @notice Get marketplace stats (V3: includes staker stats)
     */
    function getStats() external view returns (
        uint256 _totalListings,
        uint256 _totalSales,
        uint256 _totalVolumeWass,
        uint256 _totalFeesCollected,
        uint256 _totalFeesToStakers,
        uint256 _feeBps,
        uint256 _collectionCount,
        uint256 _activeListingCount
    ) {
        return (
            totalListings,
            totalSales,
            totalVolumeWass,
            totalFeesCollected,
            totalFeesToStakers,
            feeBps,
            collectionCount,
            activeListingCount
        );
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                           INTERNAL FUNCTIONS
     * ═══════════════════════════════════════════════════════════════════════ */

    function _addToActiveListings(address collection, uint256 tokenId) internal {
        _activeListings[collection].push(tokenId);
        _listingIndex[collection][tokenId] = _activeListings[collection].length;
    }

    function _removeListing(address collection, uint256 tokenId) internal {
        uint256 index = _listingIndex[collection][tokenId];

        if (index > 0) {
            uint256 arrayIndex = index - 1;
            uint256[] storage activeTokenIds = _activeListings[collection];
            uint256 lastIndex = activeTokenIds.length - 1;

            if (arrayIndex != lastIndex) {
                uint256 lastTokenId = activeTokenIds[lastIndex];
                activeTokenIds[arrayIndex] = lastTokenId;
                _listingIndex[collection][lastTokenId] = index;
            }

            activeTokenIds.pop();
            _listingIndex[collection][tokenId] = 0;

            if (activeListingCount > 0) {
                activeListingCount--;
            }
        }

        delete listings[collection][tokenId];
    }

    function _isApprovedForTransfer(
        IERC721 nft,
        address tokenOwner,
        uint256 tokenId
    ) internal view returns (bool) {
        return nft.getApproved(tokenId) == address(this) ||
               nft.isApprovedForAll(tokenOwner, address(this));
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
