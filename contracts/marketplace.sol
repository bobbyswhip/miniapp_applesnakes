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
 * Apple Snakes NFT Marketplace v2
 * - List NFTs for sale in wASS
 * - Buy with wASS directly or ETH (auto-converts via wASSOTC router)
 * - Multi-collection support (NFTs, Items, future collections)
 * - Configurable seller fee (1-10%, default 5%)
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
 * @title AppleSnakesMarketplace
 * @notice Multi-collection NFT marketplace for trading NFTs in wASS
 * @dev Supports direct wASS purchases and ETH purchases via wASSOTC router
 */
contract AppleSnakesMarketplace {
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
    address public feeRecipient;
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
    uint256 public activeListingCount; // Current number of active listings across all collections

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
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

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
    constructor(address _wass, address _otcRouter, address _feeRecipient) {
        if (_wass == address(0)) revert ZeroAddress();
        if (_otcRouter == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();

        WASS = _wass;
        OTC_ROUTER = _otcRouter;
        owner = msg.sender;
        feeRecipient = _feeRecipient;
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
        // Note: We don't remove from collectionList to preserve history
        // Use isApproved check for active status

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
     * @dev Requires prior approval for this marketplace
     * @dev If NFT is already listed by a different owner (stale listing), it will be overwritten
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
            // If listed by same owner, revert (use updatePrice instead)
            if (listing.seller == msg.sender) {
                revert PriceTooLow(); // Use updatePrice for price changes
            }
            // If listed by different owner (stale listing), overwrite it
            // This happens when NFT was transferred without unlisting
            address oldSeller = listing.seller;
            emit ListingOverwritten(collection, tokenId, oldSeller, msg.sender);
            // Note: No need to remove from _activeListings since we're replacing
        } else {
            // New listing - add to active listings tracking
            _addToActiveListings(collection, tokenId);
            totalListings++;
            activeListingCount++;
        }

        // Create/update listing
        listing.seller = msg.sender;
        listing.price = price;
        listing.active = true;

        emit Listed(collection, tokenId, msg.sender, price);
    }

    /**
     * @notice List multiple NFTs for sale at the same price
     * @param collection The NFT collection address
     * @param tokenIds Array of token IDs to list
     * @param price Price in wASS for each (must be >= 1 wASS)
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

            // Verify ownership
            if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();

            // Verify approval
            if (!_isApprovedForTransfer(nft, msg.sender, tokenId)) {
                revert NotApprovedForTransfer();
            }

            Listing storage listing = listings[collection][tokenId];

            if (listing.active) {
                if (listing.seller == msg.sender) {
                    // Already listed by same owner, skip or could update price
                    continue;
                }
                // Stale listing by different owner - overwrite
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
     * @param collection The NFT collection address
     * @param tokenId The token ID to unlist
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
     * @param collection The NFT collection address
     * @param tokenId The token ID
     * @param newPrice New price in wASS (must be >= 1 wASS)
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
     * @param collection The NFT collection address
     * @param tokenId The token ID to buy
     * @dev Requires prior wASS approval for this marketplace
     */
    function buyWithWass(
        address collection,
        uint256 tokenId
    ) external nonReentrant {
        Listing storage listing = listings[collection][tokenId];

        if (!listing.active) revert ListingNotActive();

        address seller = listing.seller;
        uint256 price = listing.price;

        // Remove listing completely (before transfers for reentrancy protection)
        _removeListing(collection, tokenId);

        // Calculate fee
        uint256 fee = (price * feeBps) / BPS;
        uint256 sellerProceeds = price - fee;

        // Transfer wASS from buyer
        IERC20 wass = IERC20(WASS);

        // Transfer fee to protocol
        if (fee > 0) {
            if (!wass.transferFrom(msg.sender, feeRecipient, fee)) {
                revert TransferFailed();
            }
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
     * @param collection The NFT collection address
     * @param tokenId The token ID to buy
     * @param minWassOut Minimum wASS to receive from swap (slippage protection)
     * @dev Any excess wASS is returned to buyer
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

        // Remove listing completely (before external calls for reentrancy protection)
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

        // Transfer fee to protocol
        if (fee > 0) {
            if (!wass.transfer(feeRecipient, fee)) {
                revert TransferFailed();
            }
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
     * @notice Set the fee recipient address
     * @param newRecipient Address to receive fees
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();

        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;

        emit FeeRecipientUpdated(oldRecipient, newRecipient);
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
     * @param collection The NFT collection address
     * @param tokenIds Array of token IDs to check and clean
     * @dev Removes listings where the seller no longer owns the NFT
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
                // Check if seller still owns the NFT
                try nft.ownerOf(tokenId) returns (address currentOwner) {
                    if (currentOwner != listing.seller) {
                        // NFT was transferred - remove stale listing
                        _removeListing(collection, tokenId);
                        emit Unlisted(collection, tokenId, listing.seller);
                    }
                } catch {
                    // Token doesn't exist or other error - remove listing
                    _removeListing(collection, tokenId);
                }
            }
        }
    }

    /**
     * @notice Emergency withdraw ETH
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawETH(uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /**
     * @notice Emergency withdraw ERC20
     * @param token Token address
     * @param amount Amount to withdraw
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
     * @param collection The NFT collection address
     * @param tokenId The token ID
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

        // Check if still approved (seller may have revoked)
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
     * @param collection The NFT collection address
     * @param tokenIds Array of token IDs
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
     * @param collection The NFT collection address
     * @param offset Starting index (0-based)
     * @param limit Maximum number of listings to return (max 100)
     * @return tokenIds Array of active token IDs
     * @return sellers Array of seller addresses
     * @return prices Array of prices in wASS
     * @return total Total number of active listings for this collection
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
     * @param collection The NFT collection address
     */
    function getActiveListingCount(address collection) external view returns (uint256) {
        return _activeListings[collection].length;
    }

    /**
     * @notice Get all active listings across all collections with pagination
     * @param offset Starting index (0-based)
     * @param limit Maximum number of listings to return (max 100)
     * @return collections Array of collection addresses
     * @return tokenIds Array of token IDs
     * @return sellers Array of seller addresses
     * @return prices Array of prices in wASS
     * @return total Total number of active listings
     * @dev More expensive to call - use per-collection pagination when possible
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

        // Count how many to return
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        collections = new address[](count);
        tokenIds = new uint256[](count);
        sellers = new address[](count);
        prices = new uint256[](count);

        // Iterate through collections to find listings at offset
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
     * @param collection The NFT collection address
     * @param tokenId The token ID
     * @return ethNeeded Estimated ETH needed (with buffer for slippage)
     * @return price The listing price in wASS
     * @return active Whether listing is active
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
            // Get quote from OTC router (this is an estimate)
            // Add 5% buffer for slippage
            (uint256 swapPortion,,,,, ) = IwASSOTCRouter(OTC_ROUTER).quote(1 ether);
            if (swapPortion > 0) {
                // Rough estimate: ethNeeded ≈ (price * 1 ether) / swapPortion * 1.05
                ethNeeded = (price * 1 ether * 105) / (swapPortion * 100);
            }
        }
    }

    /**
     * @notice Get all approved collections with pagination
     * @param start Start index
     * @param limit Maximum number to return
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
     * @notice Get marketplace stats
     */
    function getStats() external view returns (
        uint256 _totalListings,
        uint256 _totalSales,
        uint256 _totalVolumeWass,
        uint256 _totalFeesCollected,
        uint256 _feeBps,
        uint256 _collectionCount,
        uint256 _activeListingCount
    ) {
        return (
            totalListings,
            totalSales,
            totalVolumeWass,
            totalFeesCollected,
            feeBps,
            collectionCount,
            activeListingCount
        );
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *                           INTERNAL FUNCTIONS
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * @notice Add token to active listings tracking
     */
    function _addToActiveListings(address collection, uint256 tokenId) internal {
        _activeListings[collection].push(tokenId);
        _listingIndex[collection][tokenId] = _activeListings[collection].length; // 1-indexed
    }

    /**
     * @notice Remove token from active listings tracking and clear listing data
     */
    function _removeListing(address collection, uint256 tokenId) internal {
        // Get current index (1-indexed)
        uint256 index = _listingIndex[collection][tokenId];

        if (index > 0) {
            // Convert to 0-indexed
            uint256 arrayIndex = index - 1;
            uint256[] storage activeTokenIds = _activeListings[collection];
            uint256 lastIndex = activeTokenIds.length - 1;

            // If not the last element, swap with last
            if (arrayIndex != lastIndex) {
                uint256 lastTokenId = activeTokenIds[lastIndex];
                activeTokenIds[arrayIndex] = lastTokenId;
                _listingIndex[collection][lastTokenId] = index; // Update moved element's index
            }

            // Remove last element
            activeTokenIds.pop();
            _listingIndex[collection][tokenId] = 0;

            // Decrement global counter
            if (activeListingCount > 0) {
                activeListingCount--;
            }
        }

        // Clear the listing data
        delete listings[collection][tokenId];
    }

    /**
     * @notice Check if marketplace is approved to transfer NFT
     */
    function _isApprovedForTransfer(
        IERC721 nft,
        address tokenOwner,
        uint256 tokenId
    ) internal view returns (bool) {
        return nft.getApproved(tokenId) == address(this) ||
               nft.isApprovedForAll(tokenOwner, address(this));
    }

    /**
     * @notice ERC721 receiver hook
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
