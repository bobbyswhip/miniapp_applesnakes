// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * If you're on OpenZeppelin v4.9, change constructors that call Ownable(msg.sender)
 * to `constructor() Ownable() {}`. Everything else is compatible.
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

/* =======================================================================
 *                           UNISWAP V2 INTERFACES
 * ======================================================================= */
interface IUniswapV2Router {
    function getAmountsIn(uint amountOut, address[] memory path) external view returns (uint[] memory amounts);
}

/* =======================================================================
 *                           FEE MANAGER INTERFACE
 * ======================================================================= */
interface IFeeManager {
    function addETHFor(address user) external payable;
    function addETHForBatch(address[] calldata users, uint256[] calldata amounts) external payable;
    function addTokenFor(address token, address user, uint256 amount) external;
}

/* =======================================================================
 *                           WRAPPED ERC20
 * ======================================================================= */
contract WrappedERC20 is ERC20, ERC20Burnable, Ownable {
    address public immutable launcher;

    uint256 public totalMinted;
    uint256 public totalBurned;

    uint256 public constant TOKEN_AMOUNT = 1e18;

    event NFTWrapped(uint256 indexed nftId, address indexed to);
    event NFTUnwrapped(uint256 indexed nftId, address indexed from);

    modifier onlyLauncher() {
        require(msg.sender == launcher, "Only launcher");
        _;
    }

    constructor(string memory name_, string memory symbol_, address _launcher)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        require(_launcher != address(0), "launcher=0");
        launcher = _launcher;
    }

    function mint(address to, uint256 nftId) external onlyLauncher {
        _mint(to, TOKEN_AMOUNT);
        unchecked { totalMinted++; }
        emit NFTWrapped(nftId, to);
    }

    function burnForNFT(address from, uint256 nftId) external onlyLauncher {
        _burn(from, TOKEN_AMOUNT);
        unchecked { totalBurned++; }
        emit NFTUnwrapped(nftId, from);
    }
}

/* =======================================================================
 *                           NFT LAUNCHER
 * ======================================================================= */
contract wTokens is Ownable, ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    // Uniswap V2 integration
    IUniswapV2Router public immutable UNISWAP_ROUTER;
    address public immutable WETH;
    address public immutable USDC;

    // One "collection" = one ERC721 contract + its WrappedERC20
    struct NFTCollection {
        address nftContract;
        address wrappedToken;
        uint256 wrappedCount; // number currently held by this contract
        
        // FIFO queue: O(1) enqueue and dequeue regardless of size
        mapping(uint256 => uint256) queuedTokenIds; // queueIndex => tokenId
        mapping(uint256 => uint256) tokenIdToQueueIndex; // tokenId => queueIndex (for O(1) swaps)
        uint256 headIndex; // next position to dequeue from (oldest NFT)
        uint256 tailIndex; // next position to enqueue to (newest NFT)
        
        // O(1) duplicate checking
        mapping(uint256 => bool) isTokenHeld;

    }

    // light-weight stats view
    struct MintBurnStats {
        uint256 totalMinted;
        uint256 totalBurned;
        uint256 netWrapped;
    }

    // simple page for tokenIds
    struct NFTPage {
        uint256[] tokenIds;
        uint256 totalHeld;
        uint256 returned;
        bool hasMore;
    }

    // collection registry
    mapping(address => NFTCollection) private collections; // key = nftContract
    mapping(address => bool) public isValidNFT;

    uint256 public collectionCount;
    address[] public collectionList;

    // Fee management (fees denominated in USDC with 6 decimals)
    IFeeManager public feeManager;
    address public feeReceiver;
    uint256 public wrapFeeUSDC = 0.1e6;  // Default 0.1 USDC (6 decimals)
    uint256 public swapFeeUSDC = 1e6;    // Default 1 USDC (6 decimals)
    uint256 public launchFeeUSDC = 10e6;    // Default 10 USDC (6 decimals)
    uint256 public totalFeesCollected;

    event CollectionLaunched(address indexed nftContract, address indexed wrappedToken, string name, string symbol);
    event NFTWrapped(address indexed nftContract, uint256 indexed tokenId, address indexed owner);
    event NFTUnwrapped(address indexed nftContract, uint256 indexed tokenId, address indexed owner);
    event NFTSwapped(address indexed nftContract, uint256 indexed tokenIdIn, uint256 indexed tokenIdOut, address owner);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event FeeManagerUpdated(address indexed oldManager, address indexed newManager);
    event WrapFeeUpdated(uint256 oldFee, uint256 newFee);
    event SwapFeeUpdated(uint256 oldFee, uint256 newFee);
    event LaunchFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeCollected(address indexed payer, uint256 amount, string feeType);

    constructor() Ownable(msg.sender) {
        // Base network addresses (hardcoded for testing)
        feeManager = IFeeManager(0xb8bC9a263f7d43aC07Ff47D9541bdDC40e4E2638);
        UNISWAP_ROUTER = IUniswapV2Router(0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24); // BaseSwap Router on Base
        WETH = 0x4200000000000000000000000000000000000006;
        USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        
        feeReceiver = msg.sender; // Initially set fee receiver to owner
    }


    /* -----------------------------------------------------------------------
     *                           WRAP / UNWRAP (FIFO)
     * --------------------------------------------------------------------- */

    /// @notice View function to get wrap fee in ETH based on current Uniswap V2 price
    /// @dev Queries Uniswap V2 Router for how much ETH needed to get wrapFeeUSDC
    function getWrapFee() public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = USDC;
        
        try UNISWAP_ROUTER.getAmountsIn(wrapFeeUSDC, path) returns (uint[] memory amounts) {
            return amounts[0]; // Amount of WETH needed
        } catch {
            revert("Unable to fetch ETH price from Uniswap");
        }
    }

    /// @notice View function to get swap fee in ETH based on current Uniswap V2 price
    /// @dev Queries Uniswap V2 Router for how much ETH needed to get swapFeeUSDC
    function getSwapFee() public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = USDC;
        
        try UNISWAP_ROUTER.getAmountsIn(swapFeeUSDC, path) returns (uint[] memory amounts) {
            return amounts[0]; // Amount of WETH needed
        } catch {
            revert("Unable to fetch ETH price from Uniswap");
        }
    }

    /// @notice View function to get launch fee in ETH based on current Uniswap V2 price
    /// @dev Queries Uniswap V2 Router for how much ETH needed to get launchFeeUSDC
    function getLaunchFee() public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = USDC;
        
        try UNISWAP_ROUTER.getAmountsIn(launchFeeUSDC, path) returns (uint[] memory amounts) {
            return amounts[0]; // Amount of WETH needed
        } catch {
            revert("Unable to fetch ETH price from Uniswap");
        }
    }

    /// @notice View function to check if contract is erc721 standard
    /// @dev this is mostly for internal use
    function isERC721(address contractAddress) public view returns (bool) {
        IERC721 nftContract = IERC721(contractAddress);
        bytes4 ERC721_INTERFACE_ID = 0x80ac58cd;
        return nftContract.supportsInterface(ERC721_INTERFACE_ID);
    }

    /// @notice Launch a Wrapped Token for any 721NFT
    /// Anyone can launch a wrapped token for any NFT as ownership is based on the NFT it's self
    /// @dev Payable - must send ETH equal to launch fee
    /// @param nftContract Array of token IDs to wrap
    function launch(address nftContract) external payable nonReentrant returns (address wrappedToken) {
        require(nftContract != address(0), "nft=0");
        require(isERC721(nftContract), "Not an ERC721 contract");
        require(!isValidNFT[nftContract], "Already launched");
        


        uint256 requiredFee = getLaunchFee();
        uint256 minAcceptableFee = (requiredFee * 99) / 100; // Accept 1% less incase of volitility
        require(msg.value >= minAcceptableFee, "Insufficient wrap fee");

        // Route fee through FeeManager
        if (requiredFee > 0) {
            _routeFee(msg.value, "launch");
        }


        // Get name and symbol from the NFT contract itself
        IERC721Metadata nftMetadata = IERC721Metadata(nftContract);
        string memory nftName;
        string memory nftSymbol;
        
        try nftMetadata.name() returns (string memory _name) {
            nftName = _name;
        } catch {
            nftName = "Unknown NFT";
        }
        
        try nftMetadata.symbol() returns (string memory _symbol) {
            nftSymbol = _symbol;
        } catch {
            nftSymbol = "UNKNOWN";
        }

        require(bytes(nftName).length > 0, "name empty");
        require(bytes(nftSymbol).length > 0, "symbol empty");

        string memory wrappedName = string(abi.encodePacked("Wrapped ", nftName));
        string memory wrappedSymbol = string(abi.encodePacked("w", nftSymbol));

        WrappedERC20 token = new WrappedERC20(wrappedName, wrappedSymbol, address(this));

        NFTCollection storage col = collections[nftContract];
        col.nftContract = nftContract;
        col.wrappedToken = address(token);
        // headIndex and tailIndex start at 0 by default

        isValidNFT[nftContract] = true;
        collectionList.push(nftContract);
        collectionCount++;

        emit CollectionLaunched(nftContract, address(token), wrappedName, wrappedSymbol);
        return address(token);
    }


    /// @notice Batch wrap multiple NFTs → mint 1e18 ERC20 per NFT to sender. O(n) gas cost.
    /// Requires prior approval for this contract to transfer the NFTs.
    /// @dev Payable - must send ETH equal to wrap fee multiplied by count
    /// @param tokenIds Array of token IDs to wrap
    function wrapNFTs(address nftContract, uint256[] calldata tokenIds) external payable nonReentrant {
        require(isValidNFT[nftContract], "Invalid collection");
        uint256 count = tokenIds.length;
        require(count > 0, "Count must be > 0");
        require(count <= 100, "batch too large");
        // Check and collect wrap fee (scales with count)
        uint256 feePerNFT = getWrapFee();
        uint256 requiredFee = feePerNFT * count;
        uint256 minAcceptableFee = (requiredFee * 99) / 100; // Accept 1% less incase of volitility
        require(msg.value >= minAcceptableFee, "Insufficient wrap fee");

        // Route fee through FeeManager
        if (requiredFee > 0) {
            _routeFee(msg.value, "batch-wrap");
        }


        NFTCollection storage col = collections[nftContract];
        IERC721 nft = IERC721(nftContract);
        WrappedERC20 wrapped = WrappedERC20(col.wrappedToken);

        // Process each wrap
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            
            // Prevent double-wrapping
            require(!col.isTokenHeld[tokenId], "Already wrapped");

            // Transfer the NFT into custody of this contract (safe variant)
            // User must have approved this contract or setApprovalForAll.
            nft.safeTransferFrom(msg.sender, address(this), tokenId);

            // Add to FIFO queue (O(1))
            col.queuedTokenIds[col.tailIndex] = tokenId;
            col.tokenIdToQueueIndex[tokenId] = col.tailIndex;
            col.tailIndex++;
            col.isTokenHeld[tokenId] = true;
            
            unchecked {
                col.wrappedCount++;
            }

            // Mint the wrapped token to the sender
            wrapped.mint(msg.sender, tokenId);

            emit NFTWrapped(nftContract, tokenId, msg.sender);
        }
    }

    /// @notice Batch unwrap (redeem) multiple OLDEST NFTs from the pool (FIFO). O(n) gas cost.
    /// This ensures fair, predictable redemption regardless of collection size.
    /// @dev Payable - must send ETH equal to unwrap fee multiplied by count
    /// @param count Number of NFTs to unwrap (must have enough wrapped tokens)
    function unwrapNFTs(address nftContract, uint256 count) external payable nonReentrant {
        require(isValidNFT[nftContract], "Invalid collection");
        require(count > 0, "Count must be > 0");
        require(count <= 100, "batch too large");


        NFTCollection storage col = collections[nftContract];
        require(col.wrappedCount >= count, "Not enough wrapped NFTs");
        require(col.headIndex + count <= col.tailIndex, "Queue insufficient");

        // Check and collect unwrap fee (scales with count)
        uint256 feePerNFT = getWrapFee();
        uint256 requiredFee = feePerNFT * count;
        uint256 minAcceptableFee = (requiredFee * 99) / 100; // Accept 1% less incase of volitility
        require(msg.value >= minAcceptableFee, "Insufficient unwrap fee");

        // Route fee through FeeManager
        if (requiredFee > 0) {
            _routeFee(msg.value, "batch-unwrap");
        }


        WrappedERC20 wrapped = WrappedERC20(col.wrappedToken);
        IERC721 nft = IERC721(nftContract);

        // Check user has enough wrapped tokens for batch unwrap
        uint256 requiredBalance = count * WrappedERC20(col.wrappedToken).TOKEN_AMOUNT();
        require(wrapped.balanceOf(msg.sender) >= requiredBalance, "Insufficient wrapped token balance");

        // Process each unwrap in FIFO order
        for (uint256 i = 0; i < count; i++) {
            // Get the oldest tokenId (FIFO)
            uint256 tokenId = col.queuedTokenIds[col.headIndex];

            // Send the NFT to the redeemer
            nft.safeTransferFrom(address(this), msg.sender, tokenId);
            
            // Burn wrapped token
            wrapped.burnForNFT(msg.sender, tokenId);

            // Remove from queue
            delete col.queuedTokenIds[col.headIndex];
            delete col.tokenIdToQueueIndex[tokenId];
            col.headIndex++;
            col.isTokenHeld[tokenId] = false;
            
            unchecked { col.wrappedCount--; }



            emit NFTUnwrapped(nftContract, tokenId, msg.sender);
        }
    }

    /// @notice Swap your NFT for a SPECIFIC NFT in the pool. No wrapped tokens needed. O(1) gas cost.
    /// Useful for collectors who want a specific tokenId from the same collection.
    /// Your NFT takes the same position in the queue as the NFT you receive.
    /// @dev Payable - must send ETH equal to swap fee. Accepts 1% less for volatility protection.
    /// @param nftContract The collection address
    /// @param tokenIdToDeposit Your tokenId that you're trading in
    /// @param tokenIdToReceive The specific tokenId you want from the pool
    function swapNFT(address nftContract, uint256 tokenIdToDeposit, uint256 tokenIdToReceive) external payable nonReentrant {
        require(isValidNFT[nftContract], "Invalid collection");
        NFTCollection storage col = collections[nftContract];

        require(col.wrappedCount > 0, "No wrapped NFTs");
        require(!col.isTokenHeld[tokenIdToDeposit], "Token already in pool");
        require(col.isTokenHeld[tokenIdToReceive], "Desired token not in pool");

        // Calculate required fee and accept 99% to handle volatility
        uint256 requiredFee = getSwapFee();
        uint256 minAcceptableFee = (requiredFee * 99) / 100; // Accept 1% less incase of volitility
        
        require(msg.value >= minAcceptableFee, "Insufficient swap fee");

        // Route fee through FeeManager
        if (requiredFee > 0) {
            _routeFee(msg.value, "swap");
        }


        IERC721 nft = IERC721(nftContract);

        // Get the queue index of the desired NFT (O(1) lookup)
        uint256 queueIndex = col.tokenIdToQueueIndex[tokenIdToReceive];
        
        // Replace the token in the same slot (O(1))
        col.queuedTokenIds[queueIndex] = tokenIdToDeposit;
        col.tokenIdToQueueIndex[tokenIdToDeposit] = queueIndex;
        
        // Update held status
        delete col.tokenIdToQueueIndex[tokenIdToReceive];
        col.isTokenHeld[tokenIdToReceive] = false;
        col.isTokenHeld[tokenIdToDeposit] = true;

        // wrappedCount stays the same (1 out, 1 in)

        // Transfer user's NFT to this contract
        nft.safeTransferFrom(msg.sender, address(this), tokenIdToDeposit);

        // Transfer pool NFT to user
        nft.safeTransferFrom(address(this), msg.sender, tokenIdToReceive);

        emit NFTSwapped(nftContract, tokenIdToDeposit, tokenIdToReceive, msg.sender);
    }

    /* -----------------------------------------------------------------------
     *                           VIEWS / PAGINATION
     * --------------------------------------------------------------------- */

    /// @notice Paginated high-level stats for all collections.
    /// @param start offset from the beginning of the collection list
    /// @param limit max number to return (capped at 50)
    function getCollectionStats(uint256 start, uint256 limit)
        external
        view
        returns (
            address[] memory nftContracts,
            address[] memory wrappedTokens,
            MintBurnStats[] memory stats,
            uint256[] memory currentlyHeld,
            uint256 totalCount
        )
    {
        totalCount = collectionCount;
        if (start >= totalCount) {
            return (
                new address[](0),
                new address[](0),
                new MintBurnStats[](0),
                new uint256[](0),
                totalCount
            );
        }

        // Cap limit to prevent gas issues
        if (limit > 50) limit = 50;
        uint256 end = start + limit;
        if (end > totalCount) end = totalCount;

        uint256 resultSize = end - start;
        nftContracts = new address[](resultSize);
        wrappedTokens = new address[](resultSize);
        stats = new MintBurnStats[](resultSize);
        currentlyHeld = new uint256[](resultSize);

        for (uint256 i = start; i < end; i++) {
            address nftContract = collectionList[i];
            WrappedERC20 w = WrappedERC20(collections[nftContract].wrappedToken);
            
            uint256 idx = i - start;
            nftContracts[idx] = nftContract;
            wrappedTokens[idx] = collections[nftContract].wrappedToken;
            stats[idx] = MintBurnStats({
                totalMinted: w.totalMinted(),
                totalBurned: w.totalBurned(),
                netWrapped: w.totalMinted() - w.totalBurned()
            });
            currentlyHeld[idx] = collections[nftContract].wrappedCount;
        }
    }

    /// @notice Returns a page of tokenIds currently held by the pool for a collection (in FIFO order).
    /// @param startIndex offset from the head of the queue (0 = oldest NFT)
    /// @param limit max number to return (capped at 100)
    function getHeldNFTs(address nftContract, uint256 startIndex, uint256 limit)
        external
        view
        returns (NFTPage memory page)
    {
        require(isValidNFT[nftContract], "Invalid collection");
        NFTCollection storage col = collections[nftContract];

        // Cap limit to prevent gas issues
        if (limit > 100) limit = 100;

        uint256 total = col.wrappedCount;
        if (total == 0 || startIndex >= total) {
            return NFTPage(new uint256[](0), total, 0, false);
        }

        uint256 actualStart = col.headIndex + startIndex;
        uint256 end = actualStart + limit;
        if (end > col.tailIndex) end = col.tailIndex;

        uint256 resultSize = end - actualStart;
        uint256[] memory ids = new uint256[](resultSize);
        
        for (uint256 i = 0; i < resultSize; i++) {
            ids[i] = col.queuedTokenIds[actualStart + i];
        }

        bool hasMore = (startIndex + resultSize) < total;
        page = NFTPage({ tokenIds: ids, totalHeld: total, returned: resultSize, hasMore: hasMore });
    }

    /// @notice Get the next tokenId that will be unwrapped (oldest in queue).
    function getNextUnwrapTokenId(address nftContract) external view returns (uint256) {
        require(isValidNFT[nftContract], "Invalid collection");
        NFTCollection storage col = collections[nftContract];
        require(col.wrappedCount > 0, "No wrapped NFTs");
        return col.queuedTokenIds[col.headIndex];
    }

    /// @notice Check if a specific tokenId is currently held in the pool.
    function isTokenIdHeld(address nftContract, uint256 tokenId) external view returns (bool) {
        require(isValidNFT[nftContract], "Invalid collection");
        return collections[nftContract].isTokenHeld[tokenId];
    }

    /// @notice Paginated list of all launched collections.
    function getCollections(uint256 start, uint256 limit)
        external
        view
        returns (
            address[] memory nftContracts,
            address[] memory wrappedTokens,
            uint256 totalCount
        )
    {
        totalCount = collectionCount;
        if (start >= totalCount) {
            return (
                new address[](0),
                new address[](0),
                totalCount
            );
        }

        // Cap limit to prevent gas issues
        if (limit > 50) limit = 50;
        uint256 end = start + limit;
        if (end > totalCount) end = totalCount;

        uint256 resultSize = end - start;
        nftContracts = new address[](resultSize);
        wrappedTokens = new address[](resultSize);

        for (uint256 i = start; i < end; i++) {
            address nftContract = collectionList[i];
            uint256 idx = i - start;
            nftContracts[idx] = nftContract;
            wrappedTokens[idx] = collections[nftContract].wrappedToken;
        }
    }

    /* -----------------------------------------------------------------------
     *                           FEE MANAGEMENT
     * --------------------------------------------------------------------- */

    /// @notice Route collected fees to fee receiver via FeeManager
    function _routeFee(uint256 amount, string memory feeType) internal {
        try feeManager.addETHFor{value: amount}(feeReceiver) {
            totalFeesCollected += amount;
            emit FeeCollected(msg.sender, amount, feeType);
        } catch {
            // Fallback: send ETH directly to fee receiver if FeeManager fails
            (bool success, ) = payable(feeReceiver).call{value: amount}("");
            require(success, "Fee transfer failed");
            totalFeesCollected += amount;
            emit FeeCollected(msg.sender, amount, feeType);
        }
    }

    /// @notice Owner-only: Set the fee receiver address
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "Invalid fee receiver");
        address oldReceiver = feeReceiver;
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(oldReceiver, _feeReceiver);
    }

    /// @notice Owner-only: Update the FeeManager contract
    function setFeeManager(address _feeManager) external onlyOwner {
        require(_feeManager != address(0), "Invalid FeeManager");
        address oldManager = address(feeManager);
        feeManager = IFeeManager(_feeManager);
        emit FeeManagerUpdated(oldManager, _feeManager);
    }

    /// @notice Owner-only: Set wrap fee in USDC (6 decimals)
    function setWrapFee(uint256 _wrapFeeUSDC) external onlyOwner {
        require(_wrapFeeUSDC <= 5e6, "fee too large");
        uint256 oldFee = wrapFeeUSDC;
        wrapFeeUSDC = _wrapFeeUSDC;
        emit WrapFeeUpdated(oldFee, _wrapFeeUSDC);
    }

    /// @notice Owner-only: Set swap fee in USDC (6 decimals)
    function setSwapFee(uint256 _swapFeeUSDC) external onlyOwner {
        require(_swapFeeUSDC <= 30e6, "fee too large");
        uint256 oldFee = swapFeeUSDC;
        swapFeeUSDC = _swapFeeUSDC;
        emit SwapFeeUpdated(oldFee, _swapFeeUSDC);
    }

    /// @notice Owner-only: Set launch fee in USDC (6 decimals)
    function setLaunchFee(uint256 _launchFeeUSDC) external onlyOwner {
        require(_launchFeeUSDC <= 300e6, "fee too large");
        uint256 oldFee = launchFeeUSDC;
        launchFeeUSDC = _launchFeeUSDC;
        emit LaunchFeeUpdated(oldFee, _launchFeeUSDC);
    }   

    /* -----------------------------------------------------------------------
     *                           EMERGENCY RECOVERY
     * --------------------------------------------------------------------- */

    /// @notice Owner-only: withdraw arbitrary ERC20 mistakenly sent to this contract (not the wrapped token).
    function emergencyWithdrawERC20(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Owner-only: withdraw ETH mistakenly sent to this contract.
    function emergencyWithdrawETH(uint256 amount, address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    /// @notice Receive ETH
    receive() external payable {}
}