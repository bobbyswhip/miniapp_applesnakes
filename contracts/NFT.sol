// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ─── OpenZeppelin ─── */
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/token/ERC721/ERC721.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/access/Ownable.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/utils/ReentrancyGuard.sol";

/* ─── Uniswap v4 Core ─── */
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

/* ─── ERC-4906: Metadata Update ─── */
interface IERC4906 {
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
}

/* ─── Local shim to settle ERC20 ─── */
interface IPoolManagerExt is IPoolManager {
    function settle(Currency currency) external;
}

/* ─── ERC-20 minimal ─── */
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function allowance(address o, address s) external view returns (uint256);
}

/* ─── Hook view for pool lookup ─── */
interface ISuperStratView {
    function getPoolKey(PoolId id) external view returns (PoolKey memory);
}

/* ─── Old NFT Interface ─── */
interface IOldApplesnakes {
    function ownerOf(uint256 tokenId) external view returns (address);
}


/* ─── Errors ─── */
error SwapReverted(bytes data);

/**
 * @title Applesnakes
 * @notice Swaps ETH→token1 on a fixed v4 pool, vests ALL token output, and mints NFTs
 *         based on whole tokens received (2 tokens = 2 NFT mints). Max 3000 swap mints.
 *         Breeding: Burn 3 humans to create 1 snake (IDs 3001+ are all snakes from breeding).
 *         Vesting: 1% per 24h claim, full after 90 days.
 *         Jail: Wardens can jail/unjail for free. Users pay fee to jail/unjail (swaps & vests).
 *         Eggs: All snakes start as eggs for 7 days. Pay to instant hatch or auto-hatch after 1 week.
 */
contract Applesnakes is ERC721, ERC721Burnable, Ownable, ReentrancyGuard {
    using BalanceDeltaLibrary for BalanceDelta;

    /* ─────────── Constants ─────────── */
    IPoolManagerExt public constant MANAGER = IPoolManagerExt(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    uint256 public constant MAX_SWAP_MINTS = 3000;
    uint256 public constant BREED_START_ID = 3001;
    uint256 public constant DAY         = 1 days;
    uint256 public constant FULL_UNLOCK = 90 days;
    uint256 public constant JAIL_DURATION = 7 days;
    uint256 public constant EGG_DURATION = 7 days;

    /* ─────────── Configurable ─────────── */
    address public constant OLD_NFT = 0x424f2d63D32122431412394317DA55a317354692;
    address public hook   = 0xca51C787E7136dB1cbFd92a24287ea8E9363b0c8;
    bytes32 public poolIdRaw =
        0xca1949b882f9dffa947e95ffc8c1a2b76e8c68ec957392fd0ad88b4831c1f358;
    address public token1 = 0xcc3440d13e1A7805e45b1Bde3376DA5d90d95d55;
    string  public baseUri =
        "ipfs://Qmc1vJ1BQ4rWiwZhyEDFkFrWBKe4XdPr2d4dogQr9HKmYc/";

    /* ─────────── NFT state ─────────── */
    uint256 private _swapMintId = 1;      // IDs 1-3000 from swaps
    uint256 private _breedId = BREED_START_ID; // IDs 3001+ from breeding
    mapping(uint256 => bool) public Snake; // true if snake, false if human

    /* ─────────── Vesting ─────────── */
    struct Vest {
        uint256 vestBalance;
        uint256 lastMint;
        uint256 lastClaim;
    }
    mapping(address => Vest) public vesting;

    /* ─────────── Jail System ─────────── */
    bool public jailEnabled = true;
    uint256 public jailFee = 0.00111 ether;
    mapping(address => bool) public warden;
    mapping(uint256 => uint256) public jailTime;
    mapping(address => bool) public jailExempt;

    /* ─────────── Egg/Hatching System ─────────── */
    uint256 public unhatchFee = 0.00333 ether;
    mapping(uint256 => uint256) public mintTime;
    mapping(uint256 => bool) public forceHatched;
    uint256 public breedFee = 0.01 ether;  

    /* ─────────── Evolution System ─────────── */
    string public evolvedBaseUri = "";
    uint256 public evolveFee = 0.06942 ether;

    mapping(uint256 => bool) public evolved;

    address public wTokens = 0x038b70E9311D5aE12C816c32818aeec90cBe7C29;


    /* ─────────── Events ─────────── */
    event SwapMint(address indexed user, uint256 ethIn, uint256 tokenOut, uint256 nftsMinted);
    event Bred(address indexed breeder, uint256 human1, uint256 human2, uint256 human3, uint256 snakeId);
    event Claimed(address indexed user, uint256 amount);
    event HookUpdated(address hook);
    event PoolUpdated(bytes32 poolId);
    event TokenUpdated(address token);
    event URIUpdated(string newUri);
    event Jailed(uint256 indexed tokenId, address indexed by, uint256 ethIn, uint256 tokenOut);
    event Released(uint256 indexed tokenId, address indexed by, uint256 ethIn, uint256 tokenOut);
    event WardenJailed(uint256 indexed tokenId, address indexed warden);
    event WardenReleased(uint256 indexed tokenId, address indexed warden);
    event WardenUpdated(address indexed warden, bool status);
    event JailExemptUpdated(address indexed account, bool status);
    event JailToggled(bool enabled);
    event JailFeeUpdated(uint256 newFee);
    event Hatched(uint256 indexed tokenId, address indexed by, uint256 ethIn, uint256 tokenOut);
    event UnhatchFeeUpdated(uint256 newFee);
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event BreedFeeUpdated(uint256 newFee);
    event Evolved(uint256 indexed tokenId, address indexed by, uint256 ethIn, uint256 tokenOut);
    event EvolvedURIUpdated(string newUri);
    event EvolveFeeUpdated(uint256 newFee);




    struct TokenInfo {
        uint256 tokenId;
        address owner;
        bool exists;
        bool isSnake;
        bool isJailed;
        uint256 jailTime;
        bool isEgg;
        uint256 mintTime;
        bool forceHatched;
        bool evolved;
        bool ownerIsWarden;
        bool ownerIsJailExempt;
    }


    /* ─────────── Constructor ─────────── */
    constructor() ERC721("Applesnakes", "ASS") Ownable(msg.sender) {
        warden[msg.sender] = true;  
        jailExempt[msg.sender] = true;
        jailExempt[wTokens] = true;  // ERC 20 Wrapper needs exemption
    }




    /* ─────────── Owner controls ─────────── */
    function setHook(address h) external onlyOwner {
        require(h != address(0), "zero hook");
        hook = h; emit HookUpdated(h);
    }
    function setPoolId(bytes32 id) external onlyOwner {
        poolIdRaw = id; emit PoolUpdated(id);
    }
    function setToken1(address t) external onlyOwner {
        require(t != address(0), "zero token");
        token1 = t; emit TokenUpdated(t);
    }
    function setBaseURI(string calldata u) external onlyOwner { 
        baseUri = u; 
        emit URIUpdated(u); 
    }
    function setWarden(address w, bool status) external onlyOwner {
        warden[w] = status;
        jailExempt[w] = status;
        emit JailExemptUpdated(w, status);
        emit WardenUpdated(w, status);
    }
    function setBreedFee(uint256 fee) external onlyOwner {
    require(fee <= 0.06969 ether, "Fee too high");
    breedFee = fee;
    emit BreedFeeUpdated(fee);
    }
    function setEvolvedBaseURI(string calldata u) external onlyOwner {
        evolvedBaseUri = u;
        emit EvolvedURIUpdated(u);
    }

    function setEvolveFee(uint256 fee) external onlyOwner {
        require(fee <= 0.1 ether, "Fee exceeds maximum");
        evolveFee = fee;
        emit EvolveFeeUpdated(fee);
    }    
    function setJailExempt(address account, bool status) external onlyOwner {
        jailExempt[account] = status;
        emit JailExemptUpdated(account, status);
    }
    function toggleJail(bool enabled) external onlyOwner {
        jailEnabled = enabled;
        emit JailToggled(enabled);
    }
    function setJailFee(uint256 fee) external onlyOwner {
        require(fee <= 0.01 ether, "Fee too high");
        jailFee = fee;
        emit JailFeeUpdated(fee);
    }
    function setUnhatchFee(uint256 fee) external onlyOwner {
        require(fee <= 0.03 ether, "Fee too high");
        unhatchFee = fee;
        emit UnhatchFeeUpdated(fee);
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= address(this).balance, "Insufficient balance");
        (bool ok, ) = payable(owner()).call{value: amount}("");
        require(ok, "eth fail");
    }
    function rescueERC20(address t, uint256 a) external onlyOwner nonReentrant {
        require(IERC20Minimal(t).transfer(owner(), a), "erc20 fail");
    }

    /* ─────────── Swap + Mint entry ─────────── */
    struct SwapData {
        PoolKey key;
        bool    zeroForOne;
        uint256 amountIn;
        address recipient;
        address payer;
        bool    payC0AsNative;
    }

    /**
    * @notice Migrate holders from old NFT collection (tokens 1-90)
    * @dev Mints tokens 1-90 to their original owners from the old collection
    */
    function migrateOldHolders() external onlyOwner nonReentrant {
        require(_swapMintId == 1, "Migration already started");
        
        IOldApplesnakes oldNFT = IOldApplesnakes(OLD_NFT);
        
        // Migrate tokens 1-90 to their old owners
        for (uint256 id = 1; id <= 90; id++) {
            address oldOwner;
            
            // Try to get old owner, skip if token doesn't exist or reverts
            try oldNFT.ownerOf(id) returns (address owner) {
                oldOwner = owner;
            } catch {
                oldOwner = owner();
            }
            
            // Mint burned/unminted tokens to contract owner
            if (oldOwner == address(0)) {
                oldOwner = owner();  
            }
                        
            // Mint to old owner
            _safeMint(oldOwner, id);
            
            // Every 10th is a snake (10, 20, 30, etc.)
            Snake[id] = (id % 10 == 0);
            
            // Track mint time for eggs
            if (Snake[id]) {
                mintTime[id] = block.timestamp;
            }
            
            _swapMintId++;
        }
        
        emit SwapMint(msg.sender, 0, 0, 90);
    }

    /**
    * @notice Allows owner to premint any number of NFTs (up to MAX_SWAP_MINTS)
    * @param quantity Number of NFTs to mint
    */
    function preMint(uint256 quantity) external onlyOwner nonReentrant {
        require(quantity > 0, "quantity must be > 0");
        require(_swapMintId + quantity - 1 <= MAX_SWAP_MINTS, "exceeds MAX_SWAP_MINTS");

        uint256 mintedCount = 0;
        for (uint256 i = 0; i < quantity; i++) {
            uint256 id = _swapMintId++;
            _safeMint(msg.sender, id);
            
            // Every 10th NFT is a snake (10, 20, 30, etc.)
            Snake[id] = (id % 10 == 0);
            
            // Track mint time for eggs
            if (Snake[id]) {
                mintTime[id] = block.timestamp;
            }
            
            mintedCount++;
        }

        emit SwapMint(msg.sender, 0, 0, mintedCount);
    }

    function swapMint() external payable nonReentrant {
        require(msg.value > 0, "no eth");

        PoolKey memory key = ISuperStratView(hook).getPoolKey(PoolId.wrap(poolIdRaw));
        require(address(key.hooks) == hook, "wrong hook");
        require(Currency.unwrap(key.currency0) == address(0), "c0!=ETH");
        token1 = Currency.unwrap(key.currency1);

        uint256 amountOut;
        try MANAGER.unlock(
            abi.encode(
                SwapData({
                    key: key,
                    zeroForOne: true,
                    amountIn: msg.value,
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

        require(amountOut >= 1e18, "swap output too low");

        // Update vest
        Vest storage v = vesting[msg.sender];
        v.vestBalance += amountOut;
        v.lastMint = block.timestamp;
        v.lastClaim = block.timestamp;

        // Calculate whole tokens
        uint256 numWholeTokens = amountOut / 1e18;
        
        // Mint NFTs (up to 3000 cap)
        uint256 mintedCount = 0;
        for (uint256 i = 0; i < numWholeTokens && _swapMintId <= MAX_SWAP_MINTS; i++) {
            uint256 id = _swapMintId++;
            _safeMint(msg.sender, id);
            
            // Every 10th is a snake (10, 20, 30, etc.)
            Snake[id] = (id % 10 == 0);
            
            // Track mint time for eggs
            if (Snake[id]) {
                mintTime[id] = block.timestamp;
            }
            
            mintedCount++;
        }

        emit SwapMint(msg.sender, msg.value, amountOut, mintedCount);
    }

    /* ─────────── Uniswap unlock callback ─────────── */
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


    /* ─────────── Jail System ─────────── */
    /**
    * @notice Jail multiple NFTs by paying ETH fee (swaps to tokens → vesting, resets 90 day timer)
    * @param tokenIds Array of NFT IDs to jail
    */
    function jail(uint256[] calldata tokenIds) external payable nonReentrant {
        uint256 count = tokenIds.length;
        require(count > 0, "Empty array");
        require(msg.value >= jailFee * count, "Insufficient jail fee");
        
        // Validate all tokens first
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            require(ownerOf(tokenId) != address(0), "Token does not exist");
            require(!Snake[tokenId], "Snakes cannot be jailed");
            require(!jailExempt[ownerOf(tokenId)], "Owner is jail-exempt");
            require(!warden[ownerOf(tokenId)], "Wardens cannot be jailed");
            require(!isJailed(tokenId), "Already jailed");
        }
        
        // Swap ETH for tokens (single swap for all)
        uint256 amountOut = _executeSwap(msg.value);
        
        // Add to caller's vesting and reset their 90-day timer
        Vest storage v = vesting[msg.sender];
        v.vestBalance += amountOut;
        v.lastMint = block.timestamp;
        
        // Jail all tokens
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            jailTime[tokenId] = block.timestamp + JAIL_DURATION;
            emit Jailed(tokenId, msg.sender, msg.value / count, amountOut / count);
            emit MetadataUpdate(tokenId);
        }
    }
    /**
    * @notice Release multiple NFTs from jail by paying ETH fee (swaps to tokens → vesting, resets 90 day timer)
    * @param tokenIds Array of NFT IDs to release
    */
    function unjail(uint256[] calldata tokenIds) external payable nonReentrant {
        uint256 count = tokenIds.length;
        require(count > 0, "Empty array");
        require(msg.value >= jailFee * count, "Insufficient unjail fee");
        
        // Validate all tokens first
        for (uint256 i = 0; i < count; i++) {
            require(isJailed(tokenIds[i]), "Not jailed");
        }
        
        // Swap ETH for tokens (single swap for all)
        uint256 amountOut = _executeSwap(msg.value);
        
        // Add to caller's vesting and reset their 90-day timer
        Vest storage v = vesting[msg.sender];
        v.vestBalance += amountOut;
        v.lastMint = block.timestamp;
        
        // Release all tokens
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            jailTime[tokenId] = 0;
            emit Released(tokenId, msg.sender, msg.value / count, amountOut / count);
            emit MetadataUpdate(tokenId);
        }
    }

    /**
    * @notice Warden jails multiple NFTs for free
    * @param tokenIds Array of NFT IDs to jail
    */
    function wardenJail(uint256[] calldata tokenIds) external {
        require(warden[msg.sender], "Not a warden");
        uint256 count = tokenIds.length;
        require(count > 0, "Empty array");
        
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            require(ownerOf(tokenId) != address(0), "Token does not exist");
            require(!Snake[tokenId], "Snakes cannot be jailed");
            require(!jailExempt[ownerOf(tokenId)], "Owner is jail-exempt");
            require(!warden[ownerOf(tokenId)], "Wardens cannot be jailed");
            require(!isJailed(tokenId), "Already jailed");
            
            jailTime[tokenId] = block.timestamp + JAIL_DURATION;
            emit WardenJailed(tokenId, msg.sender);
            emit MetadataUpdate(tokenId);
        }
    }

    /**
    * @notice Warden releases multiple NFTs from jail for free
    * @param tokenIds Array of NFT IDs to release
    */
    function wardenUnjail(uint256[] calldata tokenIds) external {
        require(warden[msg.sender], "Not a warden");
        uint256 count = tokenIds.length;
        require(count > 0, "Empty array");
        
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            require(isJailed(tokenId), "Not jailed");
            
            jailTime[tokenId] = 0;
            emit WardenReleased(tokenId, msg.sender);
            emit MetadataUpdate(tokenId);
        }
    }

    /**
     * @notice Check if an NFT is currently jailed
     */
    function isJailed(uint256 tokenId) public view returns (bool) {
        if (!jailEnabled) return false;
        return jailTime[tokenId] > block.timestamp;
    }

    /* ─────────── Egg Hatching System ─────────── */
    /**
    * @notice Instantly hatch multiple eggs by paying ETH (swaps to tokens → vesting)
    * @param tokenIds Array of snake NFT IDs to hatch
    */
    function unhatch(uint256[] calldata tokenIds) external payable nonReentrant {
        uint256 count = tokenIds.length;
        require(count > 0, "Empty array");
        require(msg.value >= unhatchFee * count, "Insufficient unhatch fee");
        
        // Validate all tokens first
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            require(ownerOf(tokenId) == msg.sender, "Not token owner");
            require(Snake[tokenId], "Not a snake");
            require(isEgg(tokenId), "Already hatched");
        }
        
        // Swap ETH for tokens (single swap for all)
        uint256 amountOut = _executeSwap(msg.value);
        
        // Add to vesting and reset 90-day timer
        Vest storage v = vesting[msg.sender];
        v.vestBalance += amountOut;
        v.lastMint = block.timestamp;
        
        // Hatch all eggs
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenIds[i];
            forceHatched[tokenId] = true;
            emit Hatched(tokenId, msg.sender, msg.value / count, amountOut / count);
            emit MetadataUpdate(tokenId);
        }
    }

    /**
     * @notice Check if a snake is still an egg
     * @param tokenId Snake NFT to check
     * @return bool true if still in egg form
     */
    function isEgg(uint256 tokenId) public view returns (bool) {
        if (!Snake[tokenId]) return false;
        if (forceHatched[tokenId]) return false;
        return block.timestamp < mintTime[tokenId] + EGG_DURATION;
    }

    /**
     * @notice Auto-hatch eggs after 7 days (callable by anyone for metadata refresh)
     * @param tokenIds Array of snake NFTs to check and hatch
     */
    function autoHatchBatch(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            
            if (!Snake[tokenId] || forceHatched[tokenId]) continue;
            
            if (block.timestamp >= mintTime[tokenId] + EGG_DURATION) {
                emit MetadataUpdate(tokenId);
            }
        }
    }

    /**
     * @notice Internal function to execute swap (reused from swapMint logic)
     */
    function _executeSwap(uint256 ethAmount) internal returns (uint256 amountOut) {
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

    /**
    * @notice Breed 3 humans to create 1 snake (pays ETH fee, swaps to vesting)
    * @param human1 First human to burn
    * @param human2 Second human to burn
    * @param human3 Third human to burn
    * @dev Burns 3 humans, mints 1 snake with ID 3001+
    */
    function breed(uint256 human1, uint256 human2, uint256 human3) external payable nonReentrant {
        require(msg.value >= breedFee, "Insufficient breed fee");
        require(ownerOf(human1) == msg.sender, "Not owner of human1");
        require(ownerOf(human2) == msg.sender, "Not owner of human2");
        require(ownerOf(human3) == msg.sender, "Not owner of human3");
        
        require(human1 != human2 && human2 != human3 && human1 != human3, "Must be different NFTs");
        
        require(!Snake[human1], "human1 is a snake");
        require(!Snake[human2], "human2 is a snake");
        require(!Snake[human3], "human3 is a snake");
        
        // Swap ETH for tokens
        uint256 amountOut = _executeSwap(msg.value);
        
        // Add to vesting and reset 90-day timer
        Vest storage v = vesting[msg.sender];
        v.vestBalance += amountOut;
        v.lastMint = block.timestamp;
        
        // Burn the 3 humans
        _burn(human1);
        _burn(human2);
        _burn(human3);
        
        // Mint the snake egg
        uint256 snakeId = _breedId++;
        _safeMint(msg.sender, snakeId);
        Snake[snakeId] = true;
        mintTime[snakeId] = block.timestamp;
        
        emit Bred(msg.sender, human1, human2, human3, snakeId);
    }

    /* ─────────── Evolution System ─────────── */
    /**
    * @notice Evolve an NFT by paying ETH (swaps to tokens → vesting)
    * @param tokenId NFT to evolve
    */
    function evolve(uint256 tokenId) external payable nonReentrant {
        require(bytes(evolvedBaseUri).length > 0, "Evolution URI not set");
        require(msg.value >= evolveFee, "Insufficient evolve fee");
        require(ownerOf(tokenId) == msg.sender, "Not token owner");
        require(!evolved[tokenId], "Already evolved");
        
        // Swap ETH for tokens
        uint256 amountOut = _executeSwap(msg.value);
        
        // Add to vesting and reset 90-day timer
        Vest storage v = vesting[msg.sender];
        v.vestBalance += amountOut;
        v.lastMint = block.timestamp;
        
        // Mark as evolved
        evolved[tokenId] = true;
        
        emit Evolved(tokenId, msg.sender, msg.value, amountOut);
        emit MetadataUpdate(tokenId);
    }

    /* ─────────── Claiming ─────────── */
    function claimVested() external nonReentrant {
        Vest storage v = vesting[msg.sender];
        require(v.vestBalance > 0, "nothing vested");
        require(block.timestamp >= v.lastClaim + DAY, "claim too soon");

        uint256 pay;
        if (block.timestamp - v.lastMint >= FULL_UNLOCK) {
            pay = v.vestBalance;
            v.vestBalance = 0;
        } else {
            pay = v.vestBalance / 100;
            v.vestBalance -= pay;
        }
        v.lastClaim = block.timestamp;

        require(pay > 0, "zero pay");
        require(IERC20Minimal(token1).transfer(msg.sender, pay), "token fail");
        emit Claimed(msg.sender, pay);
    }

    function claimable(address u) external view returns (uint256) {
        Vest memory v = vesting[u];
        if (v.vestBalance == 0) return 0;
        if (block.timestamp < v.lastClaim + DAY) return 0;
        if (block.timestamp - v.lastMint >= FULL_UNLOCK) return v.vestBalance;
        return v.vestBalance / 100;
    }

    /* ─────────── NFT metadata ─────────── */
    function tokenURI(uint256 id) public view override returns (string memory) {
        require(ownerOf(id) != address(0), "Token does not exist");
        
        // Determine which base URI to use
        string memory uri = baseUri;
        if (evolved[id]) {
            uri = evolvedBaseUri;
        }
        
        // Priority 1: Show warden badge if human owned by warden
        address owner = ownerOf(id);
        if (!Snake[id] && warden[owner]) {
            return string(abi.encodePacked(uri, "Wardens", _toString(id), ".json"));
        }
        
        // Priority 2: Show egg if snake and still in egg form
        if (Snake[id] && isEgg(id)) {
            return string(abi.encodePacked(uri, "Egg.json"));
        }
        
        // Priority 3: Show jail overlay if human and jailed 
        if (!Snake[id] && isJailed(id)) {
            return string(abi.encodePacked(uri, "Jailed", _toString(id), ".json"));
        }

        // Priority 4: Show normal metadata
        return string(abi.encodePacked(uri, _toString(id), ".json"));
    }

    /**
    * @notice Get comprehensive information for multiple tokens
    * @param tokenIds Array of token IDs to query
    * @return infos Array of TokenInfo structs
    */
    function getTokenInfo(uint256[] calldata tokenIds) external view returns (TokenInfo[] memory infos) {
        infos = new TokenInfo[](tokenIds.length);
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            address owner = _ownerOf(tokenId);
            bool exists = owner != address(0);
            
            infos[i] = TokenInfo({
                tokenId: tokenId,
                owner: owner,
                exists: exists,
                isSnake: Snake[tokenId],
                isJailed: exists ? isJailed(tokenId) : false,
                jailTime: jailTime[tokenId],
                isEgg: exists ? isEgg(tokenId) : false,
                mintTime: mintTime[tokenId],
                forceHatched: forceHatched[tokenId],
                evolved: evolved[tokenId],
                ownerIsWarden: exists ? warden[owner] : false,
                ownerIsJailExempt: exists ? jailExempt[owner] : false
            });
        }
    }

    /**
     * @notice Owner can manually trigger metadata refresh for OpenSea
     * @param fromId Start token ID
     * @param toId End token ID
     */
    function refreshMetadata(uint256 fromId, uint256 toId) external onlyOwner {
        emit BatchMetadataUpdate(fromId, toId);
    }

    /* ─────────── Override for jail check ─────────── */
    function _update(address to, uint256 tokenId, address auth) 
        internal 
        override 
        returns (address) 
    {
        address from = _ownerOf(tokenId);
        
        // Skip jail check if transferring to/from jail-exempt addresses
        if (jailEnabled && from != address(0) && to != address(0)) {
            if (!jailExempt[from] && !jailExempt[to]) {
                require(!isJailed(tokenId), "NFT is in jail");
            }
        }
        
        emit MetadataUpdate(tokenId);
        return super._update(to, tokenId, auth);
    }

    /* ─────────── View functions ─────────── */
    function totalSwapMinted() external view returns (uint256) {
        return _swapMintId - 1;
    }
    
    function totalBred() external view returns (uint256) {
        return _breedId - BREED_START_ID;
    }

    /* ─────────── Utils ─────────── */
    function _toString(uint256 x) internal pure returns (string memory s) {
        if (x == 0) return "0";
        uint256 t = x; uint256 d;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (x != 0) { d--; b[d] = bytes1(uint8(48 + x % 10)); x /= 10; }
        s = string(b);
    }

    receive() external payable {}
    fallback() external payable {}
}