'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useBalance, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useRouter } from 'next/navigation';
import { base } from 'wagmi/chains';
import { formatEther, formatUnits, keccak256, encodeAbiParameters } from 'viem';
import { getContracts, getNFTMetadataUrl, getNFTImageUrl, QUOTER_ADDRESS, QUOTER_ABI, TOKEN_PAIRS, getDefaultPair, TokenPairConfig, ETH_ADDRESS, WASS_TOKEN_ADDRESS, getAllTokenAddresses, HOOK_ADDRESS, WASS_PAIR_HOOK_ADDRESS } from '@/config';
import { useMultipleTokenInfo } from '@/hooks/useTokenInfo';
import { useLaunchedTokens, LaunchedToken } from '@/hooks/useLaunchedTokens';
import { useNFTContext } from '@/contexts/NFTContext';
import { useInventory, InventoryTab } from '@/contexts/InventoryContext';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { getBasescanUrl } from '@/contexts/TransactionContext';

// Transaction overlay state type
interface TxOverlay {
  hash: `0x${string}`;
  status: 'pending' | 'success' | 'error';
  message: string;
  timestamp: number;
}
import { useBatchTransaction } from '@/hooks/useBatchTransaction';
import { UserNFT, NFTType } from '@/hooks/useUserNFTs';
import { useOpenSeaListings, OpenSeaListing } from '@/hooks/useOpenSeaListings';
import { useOpenSeaBuy } from '@/hooks/useOpenSeaBuy';
import { useWTokensNFTsCache } from '@/hooks/useWTokensNFTsCache';
import { parseEther } from 'viem';
import { SwapWrapModal } from './SwapWrapModal';
import { ChartModal } from './ChartModal';
import Link from 'next/link';
import { ListingModal } from './ListingModal';
import { TraitSwapper } from './TraitSwapper';
import { useBuyWithWass, useBuyWithEth, useQuoteEthForListing, useWassBalance, useWassAllowance, useApproveWass } from '@/hooks/useMarketplace';
import { usePoolTrades, formatRelativeTime, truncateAddress } from '@/hooks/usePoolTrades';
import { useBatchIdentities } from '@/hooks/useBatchIdentities';
import {
  useItemsWithBalances,
  useBuyPresale,
  useBuyPresaleWithEth,
  useBuyFromCurve,
  useBuyFromCurveWithEth,
  useSellToCurve,
  useBuyQuote,
  useSellQuote,
  useCurveInfo,
  useWassAllowanceForItems,
} from '@/hooks/useBondedItems';
import { useItemBridge } from '@/hooks/useItemBridge';
import { TokenPhase, BondedItem, formatWass, parseWass } from '@/types/bonded-items';

// LOCAL price formatter - DIRECT MATH, no library dependencies
// Handles both 18-decimal (presale) and 36-decimal (bonding curve) prices
function formatItemPrice(price: bigint | number | string | undefined, decimals: number = 2): string {
  if (price === undefined || price === null) return '0.00';

  // Convert to string first to preserve precision
  let priceStr: string;
  if (typeof price === 'bigint') {
    priceStr = price.toString();
  } else if (typeof price === 'number') {
    priceStr = Math.floor(price).toString();
  } else {
    priceStr = String(price).split('.')[0];
  }

  // Detect scaling: bonding curve prices have 36 digits (double-scaled by 1e36)
  // Presale prices have ~18 digits (scaled by 1e18)
  // If length > 30, it's a bonding curve price - divide by 1e36
  // Otherwise, divide by 1e18
  const PRESALE_DECIMALS = 18;
  const CURVE_DECIMALS = 36;
  const weiDecimals = priceStr.length > 30 ? CURVE_DECIMALS : PRESALE_DECIMALS;

  // Pad with leading zeros if needed
  while (priceStr.length <= weiDecimals) {
    priceStr = '0' + priceStr;
  }

  // Insert decimal point at the right position
  const integerPart = priceStr.slice(0, -weiDecimals) || '0';
  const decimalPart = priceStr.slice(-weiDecimals);

  // Combine and parse
  const result = parseFloat(`${integerPart}.${decimalPart}`);
  return result.toFixed(decimals);
}

// Extended NFT type to include staking status
interface InventoryNFT extends UserNFT {
  isStaked?: boolean;
}

// Helper function to determine NFT type from tokenId
// Snake: tokenId % 10 === 0 OR tokenId > 3000
// Egg: name contains 'Egg'
// Human: everything else (wardens are a subset but we're removing that filter)
const getLocalNFTType = (tokenId: number, name: string): 'snake' | 'egg' | 'human' => {
  // Check if egg first (based on name)
  if (name.toLowerCase().includes('egg')) {
    return 'egg';
  }
  // Check if snake (every 10th NFT OR all NFTs after 3000)
  if (tokenId % 10 === 0 || tokenId > 3000) {
    return 'snake';
  }
  // Default to human
  return 'human';
};

type SortOption = 'newest' | 'oldest' | 'id-asc' | 'id-desc' | 'price-asc' | 'price-desc';
type FilterType = 'all' | 'human' | 'snake' | 'egg';
type ExchangeSubTab = 'pool' | 'wass';

// Unified listing type for combining OpenSea (ETH) and wASS marketplace listings
type UnifiedListing = {
  type: 'opensea' | 'wass';
  tokenId: number;
  name: string;
  imageUrl: string;
  seller: string;
  priceRaw: string; // Original price in native currency
  priceUsd: number; // Calculated USD value for sorting
  nftType: 'human' | 'snake' | 'egg';
  // OpenSea specific fields
  orderHash?: string;
  protocolAddress?: string;
  openseaUrl?: string;
  priceWei?: string;
  // wASS marketplace specific fields
  collection?: string;
  active?: boolean;
};

// Extended pair type that combines static TOKEN_PAIRS with Token Wars launched tokens
interface ExtendedTokenPair extends TokenPairConfig {
  // Token Wars specific metadata (only present for launched tokens)
  tokenWarsData?: {
    name: string;
    symbol: string;
    imageUrl: string | null;
    totalRaisedUsdc: number;
    participantCount: number;
    launchedAt: number;
    dex: 'v4' | 'aerodrome' | 'hydrex';
    pairType: 'eth' | 'wass';
    dexScreenerUrl: string | null;
    basescanUrl: string | null;
    warId: string;
    poolAddress?: string; // Original pool address (for Aerodrome/Hydrex swaps)
  };
  // Flag to identify source
  isTokenWars?: boolean;
}

// Helper to convert IPFS URLs to HTTP gateway URLs
function getImageUrlFromIPFS(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('ipfs://')) {
    const hash = url.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${hash}`;
  }
  return url;
}

export function InventorySack() {
  const router = useRouter();
  const [stakedNFTs, setStakedNFTs] = useState<InventoryNFT[]>([]);
  const [isLoadingStaked, setIsLoadingStaked] = useState(false);
  const [activeTab, setActiveTab] = useState<InventoryTab>('collection');
  const [hasSetInitialTab, setHasSetInitialTab] = useState(false);
  const [selectedNFTs, setSelectedNFTs] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [currentOperation, setCurrentOperation] = useState<'approve' | 'stake' | 'unstake' | 'wrap' | 'buy' | null>(null);

  // New OpenSea-style state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('price-asc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showFilters, setShowFilters] = useState(true);
  const [gridSize, setGridSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [showBuyModal, setShowBuyModal] = useState(false);

  // Listing Modal state (for marketplace listing)
  const [selectedNFTForListing, setSelectedNFTForListing] = useState<InventoryNFT | null>(null);
  const [showListingModal, setShowListingModal] = useState(false);

  // Trait Swapper Modal state (for editing NFT traits)
  const [selectedNFTForTraits, setSelectedNFTForTraits] = useState<InventoryNFT | null>(null);
  const [showTraitSwapper, setShowTraitSwapper] = useState(false);

  const { isOpen, setIsOpen, initialTab, clearInitialTab, openBreed, setShowBreed } = useInventory();
  const { address: userAddress, isConnected, isReconnecting } = useAccount();
  const { nfts, isLoading, refetch: refetchNFTs } = useNFTContext();

  // Local transaction overlay state
  const [txOverlay, setTxOverlay] = useState<TxOverlay | null>(null);

  // Quote price for buy from pool
  const [buyQuotePrice, setBuyQuotePrice] = useState<string | null>(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const contracts = getContracts(base.id);
  const publicClient = usePublicClient({ chainId: base.id });

  // OpenSea listings for marketplace tab
  const { listings: openSeaListings, isLoading: listingsLoading, floorPrice, refetch: refetchListings } = useOpenSeaListings(100);

  // Our marketplace listings (wASS marketplace)
  const [marketplaceListings, setMarketplaceListings] = useState<Array<{
    collection: string;
    tokenId: string;
    seller: string;
    price: string;
    priceFormatted: string;
    active: boolean;
    name?: string;
    imageUrl?: string;
    nftType?: string;
  }>>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [ethPerWass, setEthPerWass] = useState<number | null>(null);

  // Fetch ETH/wASS exchange rate from V4 quoter
  const fetchEthExchangeRate = useCallback(async () => {
    if (!publicClient || !contracts) return;

    try {
      const probeAmount = parseEther('0.0001');

      // Get pool configuration from NFT contract
      const [poolIdRaw, hookAddress] = await Promise.all([
        publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'poolIdRaw',
          args: [],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'hook',
          args: [],
        }) as Promise<`0x${string}`>,
      ]);

      // Get the full PoolKey from the hook contract
      const poolKey = await publicClient.readContract({
        address: hookAddress,
        abi: [
          {
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [
              {
                components: [
                  { internalType: 'address', name: 'currency0', type: 'address' },
                  { internalType: 'address', name: 'currency1', type: 'address' },
                  { internalType: 'uint24', name: 'fee', type: 'uint24' },
                  { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
                  { internalType: 'address', name: 'hooks', type: 'address' },
                ],
                internalType: 'tuple',
                name: '',
                type: 'tuple',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        functionName: 'getPoolKey',
        args: [poolIdRaw],
      }) as unknown as {
        currency0: `0x${string}`;
        currency1: `0x${string}`;
        fee: number;
        tickSpacing: number;
        hooks: `0x${string}`;
      };

      // Get quote for probe amount (ETH -> wASS)
      const result = await publicClient.simulateContract({
        address: QUOTER_ADDRESS,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: poolKey,
            zeroForOne: true,
            exactAmount: BigInt(probeAmount.toString()),
            hookData: '0x',
          },
        ],
      });

      const [amountOut] = result.result as [bigint, bigint];
      const tokensForProbe = parseFloat(formatUnits(amountOut, 18));
      const rate = 0.0001 / tokensForProbe;
      setEthPerWass(rate);
      console.log(`📈 ETH/wASS rate: ${rate.toFixed(8)} ETH per wASS`);
    } catch (error) {
      console.error('Failed to fetch ETH exchange rate:', error);
    }
  }, [publicClient, contracts]);

  const fetchMarketplaceListings = useCallback(async () => {
    setMarketplaceLoading(true);
    try {
      const response = await fetch('/api/marketplace/listings');
      if (response.ok) {
        const data = await response.json();
        setMarketplaceListings(data.listings || []);
      }
    } catch (err) {
      console.error('Failed to fetch marketplace listings:', err);
    } finally {
      setMarketplaceLoading(false);
    }
  }, []);

  // V4 Quoter: Calculate ETH needed for a specific wASS amount
  const quoteEthForWassAmount = useCallback(async (wassAmount: bigint): Promise<{ ethNeeded: string; minWassOut: bigint }> => {
    if (!publicClient) {
      throw new Error('Public client not available');
    }

    try {
      // Use a probe amount to get current price ratio
      const probeAmount = parseEther('0.0001');

      // Step 1: Get pool configuration from NFT contract
      const [poolIdRaw, hookAddress] = await Promise.all([
        publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'poolIdRaw',
          args: [],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'hook',
          args: [],
        }) as Promise<`0x${string}`>,
      ]);

      // Step 2: Get the full PoolKey from the hook contract
      const poolKey = await publicClient.readContract({
        address: hookAddress,
        abi: [
          {
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [
              {
                components: [
                  { internalType: 'address', name: 'currency0', type: 'address' },
                  { internalType: 'address', name: 'currency1', type: 'address' },
                  { internalType: 'uint24', name: 'fee', type: 'uint24' },
                  { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
                  { internalType: 'address', name: 'hooks', type: 'address' },
                ],
                internalType: 'tuple',
                name: '',
                type: 'tuple',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        functionName: 'getPoolKey',
        args: [poolIdRaw],
      }) as unknown as {
        currency0: `0x${string}`;
        currency1: `0x${string}`;
        fee: number;
        tickSpacing: number;
        hooks: `0x${string}`;
      };

      // Step 3: Get quote for probe amount (ETH -> wASS)
      const result = await publicClient.simulateContract({
        address: QUOTER_ADDRESS,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: poolKey,
            zeroForOne: true, // ETH -> Token
            exactAmount: BigInt(probeAmount.toString()),
            hookData: '0x',
          },
        ],
      });

      // Extract token amount from quote
      const [amountOut] = result.result as [bigint, bigint];
      const tokensForProbe = parseFloat(formatUnits(amountOut, 18));

      // Calculate ETH per wASS ratio
      const ethPerWass = 0.0001 / tokensForProbe;

      // Calculate ETH needed with 10% buffer for slippage
      const wassAmountFloat = parseFloat(formatUnits(wassAmount, 18));
      const ethNeeded = ethPerWass * wassAmountFloat * 1.10;

      // Calculate minWassOut (5% slippage tolerance)
      const minWassOut = (wassAmount * 95n) / 100n;

      console.log(`💰 V4 Quote for ${wassAmountFloat.toFixed(4)} wASS:`);
      console.log(`  Probe: 0.0001 ETH → ${tokensForProbe.toFixed(4)} wASS`);
      console.log(`  Ratio: ${ethPerWass.toFixed(8)} ETH per wASS`);
      console.log(`  ETH needed (with 10% buffer): ${ethNeeded.toFixed(8)} ETH`);

      return { ethNeeded: ethNeeded.toFixed(8), minWassOut };
    } catch (error) {
      console.error('Failed to quote ETH for wASS:', error);
      throw error;
    }
  }, [publicClient, contracts]);

  // Fetch marketplace listings when listings tab is active
  useEffect(() => {
    if (isOpen && activeTab === 'listings') {
      fetchMarketplaceListings();
      fetchEthExchangeRate();
    }
  }, [isOpen, activeTab, fetchMarketplaceListings, fetchEthExchangeRate]);

  // Combined listings sorted by USD value
  const unifiedListings = useMemo((): UnifiedListing[] => {
    // Get current prices from window globals (set by Navigation.tsx)
    const ethPriceUsd = typeof window !== 'undefined' ? (window as unknown as { __ETH_PRICE_USD__?: number }).__ETH_PRICE_USD__ || 0 : 0;
    const wassPriceUsd = typeof window !== 'undefined' ? (window as unknown as { __TOKEN_PRICE_USD__?: number }).__TOKEN_PRICE_USD__ || 0 : 0;

    // Convert OpenSea listings to unified format
    const openseaUnified: UnifiedListing[] = openSeaListings.map(listing => ({
      type: 'opensea' as const,
      tokenId: listing.tokenId,
      name: listing.name,
      imageUrl: listing.imageUrl,
      seller: listing.seller,
      priceRaw: listing.price,
      priceUsd: parseFloat(listing.price) * ethPriceUsd,
      nftType: getLocalNFTType(listing.tokenId, listing.name),
      orderHash: listing.orderHash,
      protocolAddress: listing.protocolAddress,
      openseaUrl: listing.openseaUrl,
      priceWei: listing.priceWei,
    }));

    // Convert wASS marketplace listings to unified format
    const wassUnified: UnifiedListing[] = marketplaceListings.map(listing => ({
      type: 'wass' as const,
      tokenId: parseInt(listing.tokenId),
      name: listing.name || `AppleSnake #${listing.tokenId}`,
      imageUrl: listing.imageUrl || getNFTImageUrl(parseInt(listing.tokenId)),
      seller: listing.seller,
      priceRaw: listing.priceFormatted,
      priceUsd: parseFloat(listing.priceFormatted) * wassPriceUsd,
      nftType: (listing.nftType as 'human' | 'snake' | 'egg') || getLocalNFTType(parseInt(listing.tokenId), listing.name || ''),
      collection: listing.collection,
      active: listing.active,
    }));

    // Combine both
    return [...openseaUnified, ...wassUnified];
  }, [openSeaListings, marketplaceListings]);

  // Extract unique seller addresses from all listings for Basename resolution
  const sellerAddresses = useMemo(() => {
    return unifiedListings.map(listing => listing.seller);
  }, [unifiedListings]);

  // Batch fetch seller Basenames
  const { getIdentity: getSellerIdentity } = useBatchIdentities(sellerAddresses);

  // OpenSea buy functionality
  const { buyListing, isLoading: isBuyingFromOpenSea, error: openSeaBuyError, clearError: clearOpenSeaBuyError } = useOpenSeaBuy();
  const [buyingOrderHash, setBuyingOrderHash] = useState<string | null>(null);

  // wASS Marketplace buy functionality
  const { buyWithWass, isPending: isBuyingWithWass, isConfirming: isConfirmingWassBuy, isSuccess: wassBuySuccess, error: wassBuyError, reset: resetWassBuy } = useBuyWithWass();
  const { buyWithEth, isPending: isBuyingWithEth, isConfirming: isConfirmingEthBuy, isSuccess: ethBuySuccess, error: ethBuyError, reset: resetEthBuy } = useBuyWithEth();
  const { balance: wassBalance, balanceFormatted: wassBalanceFormatted, refetch: refetchWassBalance } = useWassBalance();
  const { allowance: wassAllowance, refetch: refetchWassAllowance } = useWassAllowance();
  const { approveWass, isPending: isApprovingWass, isConfirming: isConfirmingWassApproval, isSuccess: wassApprovalSuccess, error: wassApprovalError, reset: resetWassApproval } = useApproveWass();
  const [buyingMarketplaceTokenId, setBuyingMarketplaceTokenId] = useState<string | null>(null);

  // wTokens pool NFTs for "Buy from Contract" option
  const { nfts: poolNFTs, isLoading: poolNFTsLoading } = useWTokensNFTsCache(false, false);

  // BondedItems - ERC1155 items with presales + bonding curves
  const { items: bondedItems, presaleItems, tradingItems, rareItems, ownedItems, stats: itemStats, isLoading: itemsLoading, refetch: refetchItems } = useItemsWithBalances();
  const { buyPresaleWithWass, isPending: isPresaleBuying, isApproving: isPresaleApproving, reset: resetPresale } = useBuyPresale();
  const { buyPresaleWithEth, isPending: isPresaleBuyingEth, reset: resetPresaleEth } = useBuyPresaleWithEth();
  const { buyFromCurve, isPending: isCurveBuying, isApproving: isCurveApproving, reset: resetCurveBuy } = useBuyFromCurve();
  const { buyFromCurveWithEth, isPending: isCurveBuyingEth, reset: resetCurveEth } = useBuyFromCurveWithEth();
  const { sellToCurve, isPending: isCurveSelling, isApproving: isSellApproving, reset: resetCurveSell } = useSellToCurve();
  const [selectedBondedItem, setSelectedBondedItem] = useState<(BondedItem & { userBalance: bigint }) | null>(null);
  const [itemAction, setItemAction] = useState<'buy' | 'sell' | null>(null);
  const [itemAmount, setItemAmount] = useState('1');
  const [itemFilter, setItemFilter] = useState<'all' | 'presale' | 'trading' | 'owned'>('all');
  const [itemSort, setItemSort] = useState<'price-asc' | 'price-desc' | 'volume-high'>('volume-high'); // Default: highest volume first
  const [itemCategory, setItemCategory] = useState<string>('all'); // Category filter: all, shirt, pants, necklace, hat, etc.
  const [itemPaymentMethod, setItemPaymentMethod] = useState<'wass' | 'eth'>('wass');

  // Quote hooks for accurate bonding curve pricing
  const quoteTokenId = selectedBondedItem?.tokenId ?? 0;
  const quoteAmount = BigInt(parseInt(itemAmount) || 0);
  const { quote: buyQuote } = useBuyQuote(quoteTokenId, quoteAmount);
  const { quote: sellQuote } = useSellQuote(quoteTokenId, quoteAmount);

  // Curve info for pool details (only for curve phase items)
  const { curveInfo } = useCurveInfo(quoteTokenId);

  // Item category definitions (detect from item name)
  const ITEM_CATEGORIES = useMemo(() => [
    { id: 'all', label: '🏠 All', match: () => true },
    { id: 'shirt', label: '👕 Shirts', match: (name: string) => /shirt|top|tee|blouse/i.test(name) },
    { id: 'pants', label: '👖 Pants', match: (name: string) => /pants|jeans|shorts|trousers/i.test(name) },
    { id: 'hat', label: '🎩 Hats', match: (name: string) => /hat|cap|crown|helmet|headband/i.test(name) },
    { id: 'necklace', label: '📿 Necklaces', match: (name: string) => /necklace|chain|pendant|collar/i.test(name) },
    { id: 'glasses', label: '👓 Glasses', match: (name: string) => /glasses|shades|goggles|spectacles/i.test(name) },
    { id: 'weapon', label: '⚔️ Weapons', match: (name: string) => /sword|staff|wand|axe|weapon|blade/i.test(name) },
    { id: 'accessory', label: '💎 Accessories', match: (name: string) => /ring|bracelet|earring|accessory|badge/i.test(name) },
  ], []);

  // Get counts for each category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: bondedItems.length };
    ITEM_CATEGORIES.slice(1).forEach(cat => {
      counts[cat.id] = bondedItems.filter(item => cat.match(item.name || '')).length;
    });
    return counts;
  }, [bondedItems, ITEM_CATEGORIES]);

  // Normalize price for sorting - bonding curve prices are 1e36, presale are 1e18
  const normalizePrice = useCallback((price: bigint): bigint => {
    const priceStr = price.toString();
    // Bonding curve prices have ~36 digits (1e36 scale), presale have ~18 digits (1e18 scale)
    // Normalize to 1e18 scale for consistent sorting
    if (priceStr.length > 30) {
      return price / BigInt(1e18); // Scale down 1e36 to 1e18
    }
    return price;
  }, []);

  // Filtered and sorted items for display (excludes rare items - those are marketplace only)
  const displayedItems = useMemo(() => {
    // Step 1: Filter by phase (presale, trading, owned, all) - exclude rare items from trading tab
    // Combine presale + trading for 'all' to show them mixed by price
    let items = itemFilter === 'all' ? [...presaleItems, ...tradingItems]
      : itemFilter === 'presale' ? presaleItems
      : itemFilter === 'trading' ? tradingItems
      : ownedItems.filter(item => item.phase !== 3); // Exclude rare from owned too

    // Step 2: Filter by category
    if (itemCategory !== 'all') {
      const categoryDef = ITEM_CATEGORIES.find(c => c.id === itemCategory);
      if (categoryDef) {
        items = items.filter(item => categoryDef.match(item.name || ''));
      }
    }

    // Step 3: Sort by price or volume
    // Volume calculation:
    // - Presale items: presaleSold * presalePrice (total sales * cost per item)
    // - Bonding curve items: stats.totalVolume (from contract)
    const getItemVolume = (item: typeof items[0]): bigint => {
      if (item.phase === 2 && item.stats?.totalVolume) {
        // Bonding curve: use totalVolume from stats
        return item.stats.totalVolume;
      }
      // Presale: calculate volume as totalSales * totalCost
      return (item.presaleSold || 0n) * (item.presalePrice || 0n);
    };

    return [...items].sort((a, b) => {
      if (itemSort === 'volume-high') {
        // Sort by volume: highest to lowest
        const volumeA = getItemVolume(a);
        const volumeB = getItemVolume(b);
        return volumeB > volumeA ? 1 : volumeB < volumeA ? -1 : 0;
      }
      // Sort by price
      const priceA = normalizePrice(a.currentPrice || 0n);
      const priceB = normalizePrice(b.currentPrice || 0n);
      if (itemSort === 'price-asc') {
        return priceA < priceB ? -1 : priceA > priceB ? 1 : 0;
      } else {
        return priceB < priceA ? -1 : priceB > priceA ? 1 : 0;
      }
    });
  }, [presaleItems, tradingItems, ownedItems, itemFilter, itemCategory, itemSort, ITEM_CATEGORIES, normalizePrice]);

  // Close handler for item modal - resets all states and hook states
  const closeItemModal = useCallback(() => {
    setSelectedBondedItem(null);
    setItemAction(null);
    setItemAmount('1');
    setItemPaymentMethod('wass');
    // Reset all hook states to allow re-clicking buttons
    resetPresale();
    resetPresaleEth();
    resetCurveBuy();
    resetCurveEth();
    resetCurveSell();
  }, [resetPresale, resetPresaleEth, resetCurveBuy, resetCurveEth, resetCurveSell]);

  // Item Bridge v1.02 - for depositing items to trait editor (with AUTO-FULFIL)
  const {
    isApproved: isBridgeApproved,
    isLoading: isBridgePending,
    error: bridgeError,
    offChainBalance,
    totalOffChainItems,
    fulfilCooldown,
    withdrawCooldown,
    canBridge,
    canFulfil,
    canWithdraw,
    approve: approveBridge,
    bridgeIn, // Auto-handles: approval → deposit → fulfil
    fulfilDeposits: fulfilBridge, // Manual fulfil if auto-fulfil fails
    requestWithdraw,
    loadOffChainBalance: refetchBridge,
    reset: resetBridge,
  } = useItemBridge();
  // Map v1.02 state to v1.01 names for UI compatibility
  const bridgedBalance = offChainBalance;
  const totalBridgedItems = totalOffChainItems;
  // Legacy flags for UI (simplified since bridgeIn now handles approval internally)
  const isBridgeApproving = false; // Approval is handled inside bridgeIn
  const isBridgingIn = isBridgePending;
  const isFulfilling = false; // Fulfil is automatic now
  const isWithdrawing = isBridgePending;
  const [selectedForBridge, setSelectedForBridge] = useState<{ tokenId: number; amount: number }[]>([]);
  const [bridgeAction, setBridgeAction] = useState<'in' | 'out' | null>(null);

  // Compute total listings count aggregating all sources (OpenSea + Pool + wASS Marketplace)
  const totalListingsCount = useMemo(() => {
    const openSeaCount = openSeaListings.length;
    const poolCount = poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length > 0 ? 1 : 0;
    const wassMarketCount = marketplaceListings.length;
    return openSeaCount + poolCount + wassMarketCount;
  }, [openSeaListings.length, poolNFTs, marketplaceListings.length]);

  // Current pool address for trade history (updated by ChartModal when pair changes)
  const [currentPoolAddress, setCurrentPoolAddress] = useState<string | undefined>(undefined);

  // Selected pair ID for sidebar (controls ChartModal's selected pair)
  const [selectedPairId, setSelectedPairId] = useState<string>(getDefaultPair().id);

  // Clicked token from sidebar - used as fallback when pair not in combinedPairs yet
  const [clickedToken, setClickedToken] = useState<LaunchedToken | null>(null);

  // Fetch launched tokens from Token Wars for trading pairs
  const { tokens: launchedTokens, loading: launchedTokensLoading } = useLaunchedTokens({
    limit: 50,
    refreshInterval: 60000, // Refresh every minute
  });

  // Exchange tab sub-view - 'pool' for NFT ↔ Pool swap, 'wass' for NFT ↔ $wASS wrap/unwrap
  const [exchangeSubTab, setExchangeSubTab] = useState<ExchangeSubTab>('pool');

  // Unwrap amount selector state
  const [unwrapAmount, setUnwrapAmount] = useState<number>(1);

  // Wrap/Unwrap mode toggle (default to unwrap)
  const [wassMode, setWassMode] = useState<'unwrap' | 'wrap'>('unwrap');

  // Viewport dimensions for responsive scaling
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1024);

  // Price changes for all pairs (for sidebar display)
  const [allPairChanges, setAllPairChanges] = useState<Map<string, number>>(new Map());

  // Fetch token info for all pair tokens (for display names)
  const allTokenAddresses = useMemo(() => getAllTokenAddresses(), []);
  const { tokenInfos } = useMultipleTokenInfo(allTokenAddresses);

  // Helper function to compute Uniswap V4 pool ID from pool key parameters
  // Pool ID = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
  const computeV4PoolId = useCallback((
    currency0: `0x${string}`,
    currency1: `0x${string}`,
    fee: number,
    tickSpacing: number,
    hooks: `0x${string}`
  ): string => {
    // Ensure currency0 < currency1 (V4 requirement)
    const [sortedCurrency0, sortedCurrency1] = currency0.toLowerCase() < currency1.toLowerCase()
      ? [currency0, currency1]
      : [currency1, currency0];

    const encoded = encodeAbiParameters(
      [
        { type: 'address', name: 'currency0' },
        { type: 'address', name: 'currency1' },
        { type: 'uint24', name: 'fee' },
        { type: 'int24', name: 'tickSpacing' },
        { type: 'address', name: 'hooks' },
      ],
      [sortedCurrency0, sortedCurrency1, fee, tickSpacing, hooks]
    );
    return keccak256(encoded);
  }, []);

  // Combine static TOKEN_PAIRS with dynamic Token Wars launched tokens
  const combinedPairs: ExtendedTokenPair[] = useMemo(() => {
    // Start with static TOKEN_PAIRS (converted to ExtendedTokenPair)
    const staticPairs: ExtendedTokenPair[] = TOKEN_PAIRS.map(pair => ({
      ...pair,
      isTokenWars: false,
    }));

    // Convert Token Wars launched tokens to ExtendedTokenPair format
    // Include V4, Aerodrome, and Hydrex tokens - each has different pool address handling
    const tokenWarsPairs: ExtendedTokenPair[] = launchedTokens
      .map((token): ExtendedTokenPair => {
        const token0 = token.pair === 'wass' ? WASS_TOKEN_ADDRESS : ETH_ADDRESS;
        const token1 = token.tokenAddress as `0x${string}`;

        // V4 pools need computed pool ID, Aerodrome/Hydrex use poolAddress directly
        let geckoPoolAddress: string;

        // Token Wars V4 pool parameters depend on pair type:
        // - ETH pairs: Use NO HOOK (0x0), as they're direct vanilla V4 pools
        // - wASS pairs: Use WASS_PAIR_HOOK_ADDRESS, same as static wASS/TOKEN pairs
        // Both use 0.3% fee (3000) and tickSpacing 60 to match static pairs
        const isWassPair = token.pair === 'wass';
        const hook: `0x${string}` = isWassPair
          ? WASS_PAIR_HOOK_ADDRESS
          : '0x0000000000000000000000000000000000000000';
        const fee = 3000; // Token Wars V4 uses 0.3% fee (same as static pairs)
        const tickSpacing = 60; // Standard tick spacing for 0.3% pools

        if (token.dex === 'v4') {
          // V4 Token Wars: Compute pool ID with correct parameters based on pair type
          geckoPoolAddress = computeV4PoolId(token0, token1, fee, tickSpacing, hook);
          console.log(`[TokenWars V4] Computed pool ID for ${token.symbol}:`, geckoPoolAddress, { fee, tickSpacing, hook, isWassPair });
        } else {
          // Aerodrome/Hydrex: Use the poolAddress directly from API
          // GeckoTerminal can track these pools by their contract address
          geckoPoolAddress = token.poolAddress;
          console.log(`[TokenWars ${token.dex}] Using pool address for ${token.symbol}:`, geckoPoolAddress);
        }

        return {
          id: `tw-${token.warId}`, // Unique ID prefix for Token Wars
          token0,
          token1,
          hook,
          fee,
          tickSpacing,
          geckoPoolAddress,
          isDefault: false,
          isTokenWars: true,
          tokenWarsData: {
            name: token.name,
            symbol: token.symbol,
            imageUrl: token.imageUrl,
            totalRaisedUsdc: token.totalRaisedUsdc,
            participantCount: token.participantCount,
            launchedAt: token.launchedAt,
            dex: token.dex,
            pairType: token.pair,
            dexScreenerUrl: token.dexScreenerUrl,
            basescanUrl: token.basescanUrl,
            warId: token.warId,
            poolAddress: token.poolAddress, // Store original pool address for swaps
          },
        };
      });

    return [...staticPairs, ...tokenWarsPairs];
  }, [launchedTokens, computeV4PoolId]);

  // Get the currently selected pair data (for passing to ChartModal)
  // Uses clickedToken as fallback when pair isn't in combinedPairs yet (timing issue)
  const selectedPairData = useMemo((): ExtendedTokenPair | undefined => {
    const pair = combinedPairs.find(pair => pair.id === selectedPairId);
    if (selectedPairId?.startsWith('tw-') && pair) {
      console.log(`[SelectedPair] Found Token Wars pair:`, {
        id: pair.id,
        isTokenWars: pair.isTokenWars,
        geckoPoolAddress: pair.geckoPoolAddress,
        tokenWarsData: pair.tokenWarsData,
      });
      return pair;
    } else if (selectedPairId?.startsWith('tw-') && !pair && clickedToken) {
      // FALLBACK: Create pair from clickedToken when not in combinedPairs yet
      console.warn(`[SelectedPair] Token Wars pair NOT FOUND: ${selectedPairId}, using clickedToken fallback`);
      const token0 = clickedToken.pair === 'wass' ? WASS_TOKEN_ADDRESS : ETH_ADDRESS;
      const token1 = clickedToken.tokenAddress as `0x${string}`;

      // Token Wars V4 pool parameters depend on pair type:
      // - ETH pairs: Use NO HOOK, as they're direct vanilla V4 pools
      // - wASS pairs: Use WASS_PAIR_HOOK_ADDRESS, same as static wASS/TOKEN pairs
      const isWassPair = clickedToken.pair === 'wass';
      const hook: `0x${string}` = isWassPair
        ? WASS_PAIR_HOOK_ADDRESS
        : '0x0000000000000000000000000000000000000000' as `0x${string}`;
      const TW_FEE = 3000; // 0.3% fee (same as static pairs)
      const TW_TICK_SPACING = 60; // Standard tick spacing for 0.3% pools

      // Use poolAddress directly for Aerodrome/Hydrex (it's the LP contract address)
      // For V4 Token Wars: compute pool ID with correct parameters
      const geckoPoolAddress = clickedToken.dex === 'v4'
        ? computeV4PoolId(token0, token1, TW_FEE, TW_TICK_SPACING, hook)
        : clickedToken.poolAddress;

      console.log(`[SelectedPair] Created fallback pair from clickedToken:`, {
        symbol: clickedToken.symbol,
        dex: clickedToken.dex,
        poolAddress: clickedToken.poolAddress,
        geckoPoolAddress,
        fee: TW_FEE,
        tickSpacing: TW_TICK_SPACING,
        hook,
        isWassPair,
      });

      const fallbackPair: ExtendedTokenPair = {
        id: `tw-${clickedToken.warId}`,
        token0,
        token1,
        hook,
        fee: TW_FEE,
        tickSpacing: TW_TICK_SPACING,
        geckoPoolAddress,
        isDefault: false,
        isTokenWars: true,
        tokenWarsData: {
          name: clickedToken.name,
          symbol: clickedToken.symbol,
          imageUrl: clickedToken.imageUrl,
          totalRaisedUsdc: clickedToken.totalRaisedUsdc,
          participantCount: clickedToken.participantCount,
          launchedAt: clickedToken.launchedAt,
          dex: clickedToken.dex,
          pairType: clickedToken.pair,
          dexScreenerUrl: clickedToken.dexScreenerUrl,
          basescanUrl: clickedToken.basescanUrl,
          warId: clickedToken.warId,
          poolAddress: clickedToken.poolAddress,
        },
      };
      return fallbackPair;
    }
    return pair;
  }, [combinedPairs, selectedPairId, clickedToken, computeV4PoolId]);

  // Create a map of Token Wars token addresses to their image URLs
  const tokenWarsImageMap = useMemo(() => {
    const map = new Map<string, string>();
    launchedTokens.forEach(token => {
      if (token.imageUrl) {
        const imageUrl = getImageUrlFromIPFS(token.imageUrl);
        if (imageUrl) {
          map.set(token.tokenAddress.toLowerCase(), imageUrl);
        }
      }
    });
    return map;
  }, [launchedTokens]);

  // Create a map of Token Wars token addresses to their symbols
  const tokenWarsSymbolMap = useMemo(() => {
    const map = new Map<string, string>();
    launchedTokens.forEach(token => {
      map.set(token.tokenAddress.toLowerCase(), token.symbol);
    });
    return map;
  }, [launchedTokens]);

  // Helper to get token symbol from address (with Token Wars support)
  const getTokenSymbol = useCallback((address: `0x${string}`): string => {
    if (address === ETH_ADDRESS) return 'ETH';
    // Check Token Wars tokens first
    const twSymbol = tokenWarsSymbolMap.get(address.toLowerCase());
    if (twSymbol) return twSymbol;
    // Fall back to token info from RPC
    const info = tokenInfos.get(address.toLowerCase());
    return info?.symbol || `${address.slice(0, 6)}...`;
  }, [tokenInfos, tokenWarsSymbolMap]);

  // Helper to get token image - returns image path or null if no known image (with Token Wars support)
  const getTokenImage = useCallback((address: `0x${string}`): string | null => {
    if (address === ETH_ADDRESS) return '/Images/Ether.png';
    if (address.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) return '/Images/Token.png';
    // Check Token Wars tokens
    const twImage = tokenWarsImageMap.get(address.toLowerCase());
    if (twImage) return twImage;
    return null; // Unknown token, no image
  }, [tokenWarsImageMap]);

  // Helper to get display name for a pair (text only)
  const getPairDisplayName = useCallback((pair: TokenPairConfig): string => {
    const symbol0 = getTokenSymbol(pair.token0);
    const symbol1 = getTokenSymbol(pair.token1);
    return `${symbol0}/${symbol1}`;
  }, [getTokenSymbol]);

  // Memoized additionalPairs for ChartModal to prevent unnecessary re-renders
  // This prevents ChartModal from re-fetching price data when InventorySack re-renders
  const chartModalAdditionalPairs = useMemo(() => {
    return combinedPairs.filter(p => p.isTokenWars).map(p => ({
      ...p,
      tokenWarsData: p.tokenWarsData ? {
        name: p.tokenWarsData.name,
        symbol: p.tokenWarsData.symbol,
        imageUrl: p.tokenWarsData.imageUrl,
        dex: p.tokenWarsData.dex, // Pass DEX type for swap handling
        poolAddress: p.tokenWarsData.poolAddress, // Pass pool address for Aerodrome/Hydrex
        dexScreenerUrl: p.tokenWarsData.dexScreenerUrl, // Pass DEX screener URL
      } : undefined,
    }));
  }, [combinedPairs]);

  // Track viewport width for responsive scaling
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize(); // Set initial value on mount
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Always scale to fit viewport - modal designed at 900px for better mobile scaling
  // MIN_SCALE of 0.35 allows scaling down to ~315px screens (smallest phones)
  const DESIGN_WIDTH = 900;
  const MIN_SCALE = 0.35;
  const scaleFactor = Math.max(MIN_SCALE, Math.min(1, viewportWidth / DESIGN_WIDTH));

  // On first load, recommend small grid for narrow viewports (only once)
  const [hasSetInitialGridSize, setHasSetInitialGridSize] = useState(false);
  useEffect(() => {
    if (!hasSetInitialGridSize && viewportWidth < 500) {
      setGridSize('small');
      setHasSetInitialGridSize(true);
    }
  }, [viewportWidth, hasSetInitialGridSize]);

  // Fetch wASS/ETH price change on mount (for Trading tab header display)
  useEffect(() => {
    const fetchWassPrice = async () => {
      const wassEthPair = TOKEN_PAIRS.find(p => p.id === 'wass-eth');
      if (!wassEthPair?.geckoPoolAddress) return;

      try {
        const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${wassEthPair.geckoPoolAddress}/ohlcv/hour?aggregate=1&limit=24&currency=usd`;
        const response = await fetch(url);

        if (!response.ok) return;

        const json = await response.json();
        const ohlcvList = json?.data?.attributes?.ohlcv_list || [];

        if (ohlcvList.length >= 2) {
          const oldestPrice = ohlcvList[ohlcvList.length - 1]?.[1] || 0;
          const newestPrice = ohlcvList[0]?.[4] || 0;
          if (oldestPrice > 0) {
            const percentChange = ((newestPrice - oldestPrice) / oldestPrice) * 100;
            setAllPairChanges(prev => new Map(prev).set('wass-eth', percentChange));
          }
        }
      } catch {
        // Silent fail - will show 0%
      }
    };

    fetchWassPrice();
  }, []);

  // Fetch price changes for all pairs (24h) when on trading tab
  // Now fetches for ALL combinedPairs (static + Token Wars) to avoid duplicate API calls in ChartModal
  useEffect(() => {
    if (activeTab !== 'trading') return;

    const fetchAllPairChanges = async () => {
      const changes = new Map<string, number>();

      // Batch pairs into groups of 3 to avoid rate limiting
      const batchSize = 3;
      const pairs = combinedPairs.filter(p => p.geckoPoolAddress);

      for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (pair) => {
            try {
              // Use 'base' network for all pools (GeckoTerminal doesn't have separate DEX network IDs)
              const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pair.geckoPoolAddress}/ohlcv/hour?aggregate=1&limit=24&currency=usd`;
              const response = await fetch(url);

              if (!response.ok) {
                changes.set(pair.id, 0);
                return;
              }

              const json = await response.json();
              const ohlcvList = json?.data?.attributes?.ohlcv_list || [];

              if (ohlcvList.length >= 2) {
                const oldestPrice = ohlcvList[ohlcvList.length - 1]?.[1] || 0;
                const newestPrice = ohlcvList[0]?.[4] || 0;
                if (oldestPrice > 0) {
                  const percentChange = ((newestPrice - oldestPrice) / oldestPrice) * 100;
                  changes.set(pair.id, percentChange);
                } else {
                  changes.set(pair.id, 0);
                }
              } else {
                changes.set(pair.id, 0);
              }
            } catch {
              changes.set(pair.id, 0);
            }
          })
        );

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < pairs.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Also set 0 for pairs without geckoPoolAddress
      combinedPairs.forEach(pair => {
        if (!pair.geckoPoolAddress && !changes.has(pair.id)) {
          changes.set(pair.id, 0);
        }
      });

      setAllPairChanges(changes);
    };

    fetchAllPairChanges();
  }, [activeTab, combinedPairs]);

  // Handle sidebar pair selection (supports both static and Token Wars pairs)
  const handleSidebarPairSelect = useCallback((pair: ExtendedTokenPair) => {
    setSelectedPairId(pair.id);
    if (pair.geckoPoolAddress) {
      setCurrentPoolAddress(pair.geckoPoolAddress);
    }
  }, []);


  // Pool trades for transaction history in Trading tab
  const { trades: poolTrades, isLoading: tradesLoading, refetch: refetchTrades } = usePoolTrades(currentPoolAddress);

  // Get wrap fee from wrapper contract
  const { data: wrapFeeData } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getWrapFee',
    chainId: base.id,
  });
  const wrapFee = wrapFeeData ? BigInt(wrapFeeData as bigint) : 0n;
  const wrapFeeFormatted = formatEther(wrapFee);

  // Check if wrapper contract is approved to transfer NFTs
  const { data: isWrapperApproved, refetch: refetchWrapperApproval } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: userAddress ? [userAddress, contracts.wrapper.address] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // Smart wallet detection for batch transactions
  const { supportsAtomicBatch } = useSmartWallet();
  const {
    executeBatch,
    isPending: isBatchPending,
    isConfirming: isBatchConfirming,
    isSuccess: isBatchSuccess,
    reset: resetBatch,
  } = useBatchTransaction();

  // Contract write hooks
  const { writeContractAsync, data: txHash, isPending: isWritePending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Use address presence as connection indicator (more reliable than isConnected)
  const isWalletConnected = !!userAddress;

  // Get wToken balance
  const { data: wTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    chainId: base.id,
  });

  // Get ETH balance
  const { data: ethBalance } = useBalance({
    address: userAddress,
    chainId: base.id,
  });

  // Get staked token IDs
  const { data: stakedData } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'getStakedTokenIdsPaginated',
    args: userAddress ? [userAddress, BigInt(0), BigInt(100)] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // Get pending rewards
  const { data: pendingRewardsData } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'pendingRewards',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
      refetchInterval: 10000,
    },
  });

  // Get user staking stats
  const { data: userStats } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'getUserStats',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
      refetchInterval: 10000,
    },
  });

  // Get total staked across all users
  const { data: totalStakedData } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'totalStaked',
    query: {
      refetchInterval: 30000,
    },
  });

  // Check if staking contract is approved to transfer NFTs
  const { data: isApproved, refetch: refetchApproval } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: userAddress ? [userAddress, contracts.staking.address] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // Refetch staked data function
  const { refetch: refetchStaked } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'getStakedTokenIdsPaginated',
    args: userAddress ? [userAddress, BigInt(0), BigInt(100)] : undefined,
    query: {
      enabled: false,
    },
  });

  // Extract staked token IDs
  const stakedTokenIds = stakedData && Array.isArray(stakedData) && stakedData.length > 0
    ? (stakedData[0] as bigint[]).map(id => Number(id))
    : [];

  // Fetch full NFT data for staked tokens - PROGRESSIVE LOADING
  useEffect(() => {
    if (!publicClient || stakedTokenIds.length === 0) {
      setStakedNFTs([]);
      setIsLoadingStaked(false);
      return;
    }

    const fetchStakedNFTs = async () => {
      setIsLoadingStaked(true);

      try {
        interface TokenInfo {
          tokenId: bigint;
          owner: string;
          exists: boolean;
          isSnake: boolean;
          isJailed: boolean;
          jailTime: bigint;
          isEgg: boolean;
          mintTime: bigint;
          forceHatched: boolean;
          evolved: boolean;
          ownerIsWarden: boolean;
          ownerIsJailExempt: boolean;
          swapMintTime: bigint;
          canUnwrap: boolean;
        }

        const getNFTTypeFromInfo = (info: TokenInfo): NFTType => {
          if (info.isSnake) return 'snake';
          if (info.isEgg) return 'egg';
          if (info.ownerIsWarden) return 'warden';
          return 'human';
        };

        const tokenInfoResults = await publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'getTokenInfo',
          args: [stakedTokenIds.map(id => BigInt(id))],
        }) as TokenInfo[];

        const initialStakedNFTs: InventoryNFT[] = stakedTokenIds.map((tokenId, i) => {
          const tokenInfo = tokenInfoResults[i];
          return {
            tokenId,
            imageUrl: getNFTImageUrl(tokenId),
            name: `AppleSnake #${tokenId}`,
            nftType: getNFTTypeFromInfo(tokenInfo),
            owner: tokenInfo.owner,
            exists: tokenInfo.exists,
            isSnake: tokenInfo.isSnake,
            isJailed: tokenInfo.isJailed,
            jailTime: Number(tokenInfo.jailTime),
            isEgg: tokenInfo.isEgg,
            mintTime: Number(tokenInfo.mintTime),
            forceHatched: tokenInfo.forceHatched,
            evolved: tokenInfo.evolved,
            ownerIsWarden: tokenInfo.ownerIsWarden,
            ownerIsJailExempt: tokenInfo.ownerIsJailExempt,
            swapMintTime: Number(tokenInfo.swapMintTime),
            canUnwrap: tokenInfo.canUnwrap,
            metadata: {
              name: `AppleSnake #${tokenId}`,
              description: '',
              image: `${tokenId}.png`,
              attributes: [],
            },
            isStaked: true,
          };
        });

        setStakedNFTs(initialStakedNFTs);
        setIsLoadingStaked(false);

        const METADATA_BATCH_SIZE = 15;
        const metadataMap = new Map<number, any>();

        for (let i = 0; i < stakedTokenIds.length; i += METADATA_BATCH_SIZE) {
          const batch = stakedTokenIds.slice(i, i + METADATA_BATCH_SIZE);

          const batchPromises = batch.map(async (tokenId) => {
            try {
              const metadataUrl = getNFTMetadataUrl(tokenId);
              const response = await fetch(metadataUrl);
              if (response.ok) {
                const metadata = await response.json();
                return { tokenId, metadata };
              }
            } catch {
              // Use default on error
            }
            return null;
          });

          const batchResults = await Promise.all(batchPromises);

          batchResults.forEach(result => {
            if (result) {
              metadataMap.set(result.tokenId, result.metadata);
            }
          });

          const enrichedStakedNFTs: InventoryNFT[] = stakedTokenIds.map((tokenId, idx) => {
            const tokenInfo = tokenInfoResults[idx];
            const metadata = metadataMap.get(tokenId) || {
              name: `AppleSnake #${tokenId}`,
              description: '',
              image: `${tokenId}.png`,
              attributes: [],
            };

            return {
              tokenId,
              imageUrl: getNFTImageUrl(tokenId),
              name: metadata.name || `AppleSnake #${tokenId}`,
              nftType: getNFTTypeFromInfo(tokenInfo),
              owner: tokenInfo.owner,
              exists: tokenInfo.exists,
              isSnake: tokenInfo.isSnake,
              isJailed: tokenInfo.isJailed,
              jailTime: Number(tokenInfo.jailTime),
              isEgg: tokenInfo.isEgg,
              mintTime: Number(tokenInfo.mintTime),
              forceHatched: tokenInfo.forceHatched,
              evolved: tokenInfo.evolved,
              ownerIsWarden: tokenInfo.ownerIsWarden,
              ownerIsJailExempt: tokenInfo.ownerIsJailExempt,
              swapMintTime: Number(tokenInfo.swapMintTime),
              canUnwrap: tokenInfo.canUnwrap,
              metadata,
              isStaked: true,
            };
          });

          setStakedNFTs(enrichedStakedNFTs);

          if (i + METADATA_BATCH_SIZE < stakedTokenIds.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } catch (error) {
        console.error('Error fetching staked NFTs:', error);
        setStakedNFTs([]);
        setIsLoadingStaked(false);
      }
    };

    fetchStakedNFTs();
  }, [stakedTokenIds.length, publicClient, contracts.nft.address, contracts.nft.abi]);

  // Lock body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  const wTokenBalanceFormatted = wTokenBalance ? Number(wTokenBalance) / 1e18 : 0;
  const ethBalanceFormatted = ethBalance ? parseFloat(formatEther(ethBalance.value)) : 0;

  const pendingRewardsFormatted = pendingRewardsData
    ? parseFloat(formatUnits(pendingRewardsData as bigint, 18)).toFixed(4)
    : '0.0000';
  const stakedCount = userStats ? Number((userStats as [bigint])[0]) : 0;
  const totalStakedCount = totalStakedData ? Number(totalStakedData) : 0;
  const hasPendingRewards = pendingRewardsData && (pendingRewardsData as bigint) > 0n;

  // Fetch buy quote price when pool has NFTs - uses OTC contract's quoteBuyNFT
  // Uses same approach as SwapWrapModal for consistency
  useEffect(() => {
    const fetchQuote = async () => {
      if (!publicClient || poolNFTs.length === 0) return;

      setIsFetchingQuote(true);
      try {
        // Get quote from OTC contract - includes unwrap fee + tokens needed
        const quoteBuyNFTResult = await publicClient.readContract({
          address: contracts.otc.address as `0x${string}`,
          abi: contracts.otc.abi,
          functionName: 'quoteBuyNFT',
          args: [BigInt(1)], // Quote for 1 NFT
        }) as [bigint, bigint];

        const [unwrapFee, tokensNeeded] = quoteBuyNFTResult;

        // Get pool info from NFT contract (same as SwapWrapModal)
        const [poolIdRaw, hookAddress] = await Promise.all([
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'poolIdRaw',
            args: [],
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'hook',
            args: [],
          }) as Promise<`0x${string}`>,
        ]);

        // Get pool key from hook contract (not quoter - matches SwapWrapModal approach)
        const poolKey = await publicClient.readContract({
          address: hookAddress,
          abi: [{
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [{
              components: [
                { internalType: 'address', name: 'currency0', type: 'address' },
                { internalType: 'address', name: 'currency1', type: 'address' },
                { internalType: 'uint24', name: 'fee', type: 'uint24' },
                { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
                { internalType: 'address', name: 'hooks', type: 'address' },
              ],
              internalType: 'tuple',
              name: '',
              type: 'tuple',
            }],
            stateMutability: 'view',
            type: 'function',
          }],
          functionName: 'getPoolKey',
          args: [poolIdRaw],
        }) as {
          currency0: `0x${string}`;
          currency1: `0x${string}`;
          fee: number;
          tickSpacing: number;
          hooks: `0x${string}`;
        };

        // Use quoteExactOutputSingle to get ETH needed
        const result = await publicClient.readContract({
          address: QUOTER_ADDRESS,
          abi: QUOTER_ABI,
          functionName: 'quoteExactOutputSingle',
          args: [{
            poolKey: poolKey,
            zeroForOne: true, // ETH -> Token
            exactAmount: tokensNeeded,
            sqrtPriceLimitX96: 0n,
            hookData: '0x' as `0x${string}`,
          }],
        });

        const [ethRequired] = result as [bigint, bigint];

        // Add 5% buffer for price movement + unwrap fee
        const ethForTokens = parseFloat(formatEther(ethRequired)) * 1.05;
        const totalEth = ethForTokens + parseFloat(formatEther(unwrapFee));
        setBuyQuotePrice(totalEth.toFixed(6));
      } catch (error) {
        console.error('Failed to fetch quote:', error);
        setBuyQuotePrice(null);
      } finally {
        setIsFetchingQuote(false);
      }
    };

    fetchQuote();
    // Refresh quote every 30 seconds
    const interval = setInterval(fetchQuote, 30000);
    return () => clearInterval(interval);
  }, [publicClient, poolNFTs.length, contracts.otc.address, contracts.otc.abi, contracts.nft.address, contracts.nft.abi]);

  // Calculate effective floor price - use pool price if cheaper than OpenSea floor
  const effectiveFloorPrice = useMemo(() => {
    const openSeaFloor = floorPrice ? parseFloat(floorPrice) : null;
    const poolPrice = buyQuotePrice ? parseFloat(buyQuotePrice) : null;

    // If we have both, return the cheaper one
    if (openSeaFloor && poolPrice) {
      return Math.min(openSeaFloor, poolPrice).toFixed(4);
    }
    // If only one exists, return it
    if (openSeaFloor) return openSeaFloor.toFixed(4);
    if (poolPrice) return poolPrice.toFixed(4);
    return null;
  }, [floorPrice, buyQuotePrice]);

  // Check if pool price is the floor
  const isPoolFloor = useMemo(() => {
    if (!buyQuotePrice || !floorPrice) return !!buyQuotePrice;
    return parseFloat(buyQuotePrice) <= parseFloat(floorPrice);
  }, [buyQuotePrice, floorPrice]);

  // Apply local NFT type detection (snake: tokenId%10==0 OR tokenId>3000, egg: name contains 'Egg')
  const collectionNFTs: InventoryNFT[] = nfts.map(nft => {
    const localType = getLocalNFTType(nft.tokenId, nft.name);
    return {
      ...nft,
      isStaked: false,
      nftType: localType,
      isSnake: localType === 'snake',
      isEgg: localType === 'egg',
    };
  });
  const allNFTs: InventoryNFT[] = [...collectionNFTs, ...stakedNFTs];

  // Combined view: collection NFTs first, staked NFTs at the bottom (when on collection tab)
  const unifiedNFTs = useMemo(() => {
    // Also apply local type detection to staked NFTs
    const typedStakedNFTs = stakedNFTs.map(nft => {
      const localType = getLocalNFTType(nft.tokenId, nft.name);
      return {
        ...nft,
        nftType: localType,
        isSnake: localType === 'snake',
        isEgg: localType === 'egg',
      };
    });
    return [...collectionNFTs, ...typedStakedNFTs];
  }, [collectionNFTs, stakedNFTs]);

  // Filter and sort NFTs - now works on unified view for collection tab
  const displayedNFTs = useMemo(() => {
    let filtered = [...unifiedNFTs];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(nft =>
        nft.name.toLowerCase().includes(query) ||
        nft.tokenId.toString().includes(query)
      );
    }

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(nft => nft.nftType === filterType);
    }

    // Apply sort
    switch (sortBy) {
      case 'newest':
        filtered.sort((a, b) => b.mintTime - a.mintTime);
        break;
      case 'oldest':
        filtered.sort((a, b) => a.mintTime - b.mintTime);
        break;
      case 'id-asc':
        filtered.sort((a, b) => a.tokenId - b.tokenId);
        break;
      case 'id-desc':
        filtered.sort((a, b) => b.tokenId - a.tokenId);
        break;
    }

    // After all sorting, move staked NFTs to bottom if no other sort is active
    if (sortBy === 'newest' || sortBy === 'oldest') {
      const unstaked = filtered.filter(nft => !nft.isStaked);
      const staked = filtered.filter(nft => nft.isStaked);
      filtered = [...unstaked, ...staked];
    }

    return filtered;
  }, [unifiedNFTs, searchQuery, filterType, sortBy]);

  // Get NFT type counts for filters (using local type detection)
  const typeCounts = useMemo(() => {
    const counts: Record<FilterType, number> = { all: unifiedNFTs.length, human: 0, snake: 0, egg: 0 };
    unifiedNFTs.forEach(nft => {
      const type = nft.nftType as FilterType;
      if (type in counts && type !== 'all') {
        counts[type]++;
      }
    });
    return counts;
  }, [unifiedNFTs]);

  // Handle initial tab setting on first load
  // IMPORTANT: Only change tab if explicitly requested via initialTab - don't force tab changes during normal loading
  useEffect(() => {
    if (!isLoading && !isLoadingStaked && !hasSetInitialTab) {
      setHasSetInitialTab(true);
      // Only change tab if explicitly requested via initialTab from context
      // Don't force tab changes during normal loading routines
      if (initialTab) {
        setActiveTab(initialTab);
        clearInitialTab();
      }
    }
  }, [isLoading, isLoadingStaked, hasSetInitialTab, initialTab, clearInitialTab]);

  // Handle tab changes when navigating from header buttons (even if already open)
  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
      clearInitialTab();
    }
  }, [initialTab, isOpen, clearInitialTab]);

  useEffect(() => {
    if (!isOpen) {
      setHasSetInitialTab(false);
      setSearchQuery('');
      setFilterType('all');
      setShowBuyModal(false); // Close buy modal when closing inventory
    }
  }, [isOpen]);

  // Handle tab change with filter reset
  const handleTabChange = (tab: InventoryTab) => {
    setActiveTab(tab);
    setFilterType('all');
    setSearchQuery('');
  };

  // Handle buy NFT action - shows buy modal popup
  const handleBuyNFT = () => {
    setShowBuyModal(true);
  };

  // Handle buying an OpenSea listing directly
  const handleBuyOpenSeaListing = async (listing: OpenSeaListing) => {
    setBuyingOrderHash(listing.orderHash);
    clearOpenSeaBuyError();

    try {
      const result = await buyListing(listing);

      if (result.success) {
        // Show success overlay
        if (result.txHash) {
          showTxOverlay(result.txHash as `0x${string}`, `Purchased ${listing.name}!`);
          updateTxOverlay('success');
        }
        // Refresh listings after successful purchase
        refetchListings();
        refetchNFTs();
      } else {
        // Show error overlay
        console.error('[OpenSeaBuy] Failed:', result.error);
      }
    } catch (err) {
      console.error('[OpenSeaBuy] Error:', err);
    } finally {
      setBuyingOrderHash(null);
    }
  };

  // Handle buying from our wASS marketplace
  const handleBuyMarketplaceListing = async (listing: typeof marketplaceListings[0]) => {
    setBuyingMarketplaceTokenId(listing.tokenId);
    resetWassBuy();
    resetEthBuy();
    resetWassApproval();

    try {
      const priceWei = BigInt(listing.price);

      // Check if user has enough wASS balance
      if (wassBalance >= priceWei) {
        // Check if allowance is sufficient
        if (wassAllowance >= priceWei) {
          // Buy directly with wASS
          await buyWithWass(listing.collection as `0x${string}`, BigInt(listing.tokenId));
        } else {
          // Need to approve first - approve max amount
          await approveWass();
        }
      } else {
        // Insufficient wASS - use ETH instead via V4 swap
        console.log('[MarketplaceBuy] Insufficient wASS, using ETH...');

        try {
          // Get ETH quote for the wASS price using V4 quoter
          const { ethNeeded, minWassOut } = await quoteEthForWassAmount(priceWei);
          console.log(`[MarketplaceBuy] ETH quote: ${ethNeeded} ETH for ${listing.priceFormatted} wASS`);

          // Execute buyWithEth with quoted amount
          // Hook signature: (collection, tokenId, ethAmount: string, minWassOut: bigint)
          await buyWithEth(
            listing.collection as `0x${string}`,
            BigInt(listing.tokenId),
            ethNeeded,
            minWassOut
          );
        } catch (quoteErr) {
          console.error('[MarketplaceBuy] ETH quote/buy failed:', quoteErr);
          setBuyingMarketplaceTokenId(null);
        }
      }
    } catch (err) {
      console.error('[MarketplaceBuy] Error:', err);
      setBuyingMarketplaceTokenId(null);
    }
  };

  // Handle wASS approval success - wait for confirmation then proceed to buy
  useEffect(() => {
    if (wassApprovalSuccess && !isConfirmingWassApproval && buyingMarketplaceTokenId) {
      // Approval is fully confirmed on-chain, now refetch allowance and buy
      const proceedToBuy = async () => {
        // Wait a moment for chain state to propagate, then refetch allowance
        await new Promise(resolve => setTimeout(resolve, 1000));
        await refetchWassAllowance();

        // Find the listing and buy
        const listing = marketplaceListings.find(l => l.tokenId === buyingMarketplaceTokenId);
        if (listing) {
          buyWithWass(listing.collection as `0x${string}`, BigInt(listing.tokenId));
        }
      };
      proceedToBuy();
    }
  }, [wassApprovalSuccess, isConfirmingWassApproval, buyingMarketplaceTokenId, marketplaceListings, refetchWassAllowance, buyWithWass]);

  // Handle marketplace buy success (wASS)
  useEffect(() => {
    if (wassBuySuccess && buyingMarketplaceTokenId) {
      // Refresh data
      fetchMarketplaceListings();
      refetchNFTs();
      refetchWassBalance();
      setBuyingMarketplaceTokenId(null);
    }
  }, [wassBuySuccess, buyingMarketplaceTokenId, fetchMarketplaceListings, refetchNFTs, refetchWassBalance]);

  // Handle marketplace buy success (ETH)
  useEffect(() => {
    if (ethBuySuccess && buyingMarketplaceTokenId) {
      // Refresh data
      fetchMarketplaceListings();
      refetchNFTs();
      refetchWassBalance();
      setBuyingMarketplaceTokenId(null);
    }
  }, [ethBuySuccess, buyingMarketplaceTokenId, fetchMarketplaceListings, refetchNFTs, refetchWassBalance]);

  // Handle marketplace buy error (wASS) - reset loading state
  useEffect(() => {
    if (wassBuyError && buyingMarketplaceTokenId) {
      console.error('[MarketplaceBuy] wASS transaction failed:', wassBuyError);
      setBuyingMarketplaceTokenId(null);
    }
  }, [wassBuyError, buyingMarketplaceTokenId]);

  // Handle marketplace buy error (ETH) - reset loading state
  useEffect(() => {
    if (ethBuyError && buyingMarketplaceTokenId) {
      console.error('[MarketplaceBuy] ETH transaction failed:', ethBuyError);
      setBuyingMarketplaceTokenId(null);
    }
  }, [ethBuyError, buyingMarketplaceTokenId]);

  // Handle wASS approval error - reset loading state
  useEffect(() => {
    if (wassApprovalError && buyingMarketplaceTokenId) {
      console.error('[MarketplaceBuy] wASS approval failed:', wassApprovalError);
      setBuyingMarketplaceTokenId(null);
    }
  }, [wassApprovalError, buyingMarketplaceTokenId]);

  // Helper to show transaction overlay
  const showTxOverlay = (hash: `0x${string}`, message: string) => {
    setTxOverlay({
      hash,
      status: 'pending',
      message,
      timestamp: Date.now(),
    });
  };

  // Helper to update transaction status
  const updateTxOverlay = (status: 'success' | 'error') => {
    setTxOverlay(prev => prev ? { ...prev, status } : null);
    // Auto-hide after 5 seconds on success/error
    setTimeout(() => setTxOverlay(null), 5000);
  };

  // Transaction timeout effect (60s max)
  useEffect(() => {
    if (txOverlay && txOverlay.status === 'pending') {
      const timeout = setTimeout(() => {
        setTxOverlay(prev => prev ? { ...prev, status: 'error' } : null);
        setTimeout(() => setTxOverlay(null), 5000);
      }, 60000);
      return () => clearTimeout(timeout);
    }
  }, [txOverlay?.hash]);

  // Watch transaction status
  const { isLoading: txWatching, isSuccess: txSuccess, isError: txError } = useWaitForTransactionReceipt({
    hash: txOverlay?.hash,
  });

  // Update overlay on tx completion
  useEffect(() => {
    if (txSuccess && txOverlay?.status === 'pending') {
      updateTxOverlay('success');
    }
  }, [txSuccess]);

  useEffect(() => {
    if (txError && txOverlay?.status === 'pending') {
      updateTxOverlay('error');
    }
  }, [txError]);

  // Handle claim rewards
  const handleClaimRewards = async () => {
    if (!userAddress || !hasPendingRewards) return;
    setCurrentOperation('stake');
    try {
      const hash = await writeContractAsync({
        address: contracts.staking.address,
        abi: contracts.staking.abi,
        functionName: 'claimRewards',
        args: [],
      });
      showTxOverlay(hash, 'Claiming rewards');
    } catch (error) {
      console.error('Claim error:', error);
      setCurrentOperation(null);
    }
  };

  const toggleSelection = useCallback((tokenId: number) => {
    setSelectedNFTs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tokenId)) {
        newSet.delete(tokenId);
      } else {
        newSet.add(tokenId);
      }
      if (newSet.size > 0 && !isSelectionMode) {
        setIsSelectionMode(true);
      } else if (newSet.size === 0) {
        setIsSelectionMode(false);
      }
      return newSet;
    });
  }, [isSelectionMode]);

  const clearSelections = useCallback(() => {
    setSelectedNFTs(new Set());
    setIsSelectionMode(false);
  }, []);

  // Close on Escape key (placed after clearSelections is declared)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedNFTs.size > 0) {
          clearSelections();
        } else {
          setIsOpen(false);
        }
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, selectedNFTs.size, clearSelections, setIsOpen]);

  // Always toggle selection on NFT click (no detail sidebar)
  const handleNFTInteraction = useCallback((nft: InventoryNFT, _e: React.MouseEvent) => {
    toggleSelection(nft.tokenId);
  }, [toggleSelection]);

  const selectedNFTsData = displayedNFTs.filter(nft => selectedNFTs.has(nft.tokenId));
  const selectedSnakes = selectedNFTsData.filter(nft => nft.isSnake);
  const selectedEggs = selectedNFTsData.filter(nft => nft.isEgg);
  const selectedHumans = selectedNFTsData.filter(nft => !nft.isSnake && !nft.isEgg);
  // In unified view: separate staked vs unstaked for different actions
  const selectedForStake = selectedSnakes.filter(nft => !nft.isStaked);
  const selectedForUnstake = selectedSnakes.filter(nft => nft.isStaked);
  // Check if any humans are selected (to gray out stake button)
  const hasHumansSelected = selectedHumans.length > 0;
  // Can wrap any NFT that's not staked
  const selectedForWrap = selectedNFTsData.filter(nft => !nft.isStaked);

  // Contract interaction handlers
  const handleApprove = async () => {
    if (!userAddress) return;
    setCurrentOperation('approve');
    try {
      const hash = await writeContractAsync({
        address: contracts.nft.address,
        abi: contracts.nft.abi,
        functionName: 'setApprovalForAll',
        args: [contracts.staking.address, true],
      });
      showTxOverlay(hash, 'Approving staking contract');
    } catch (error) {
      console.error('Approve error:', error);
      setCurrentOperation(null);
    }
  };

  const handleStake = async () => {
    if (selectedForStake.length === 0 || !userAddress) return;
    setCurrentOperation('stake');
    try {
      const tokenIds = selectedForStake.map(nft => BigInt(nft.tokenId));
      const hash = await writeContractAsync({
        address: contracts.staking.address,
        abi: contracts.staking.abi,
        functionName: 'stake',
        args: [tokenIds],
      });
      showTxOverlay(hash, `Staking ${selectedForStake.length} snake${selectedForStake.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Stake error:', error);
      setCurrentOperation(null);
    }
  };

  const handleApproveAndStake = async () => {
    if (selectedForStake.length === 0 || !userAddress) return;
    setCurrentOperation('stake');
    const tokenIds = selectedForStake.map(nft => BigInt(nft.tokenId));
    try {
      await executeBatch([
        {
          address: contracts.nft.address,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.staking.address, true],
        },
        {
          address: contracts.staking.address,
          abi: contracts.staking.abi,
          functionName: 'stake',
          args: [tokenIds],
        },
      ]);
      // Batch transaction doesn't return individual hashes, overlay not applicable here
    } catch (error) {
      console.error('Approve and stake error:', error);
      setCurrentOperation(null);
    }
  };

  const handleUnstake = async () => {
    if (selectedForUnstake.length === 0 || !userAddress) return;
    setCurrentOperation('unstake');
    try {
      const tokenIds = selectedForUnstake.map(nft => BigInt(nft.tokenId));
      const hash = await writeContractAsync({
        address: contracts.staking.address,
        abi: contracts.staking.abi,
        functionName: 'unstake',
        args: [tokenIds],
      });
      showTxOverlay(hash, `Unstaking ${selectedForUnstake.length} snake${selectedForUnstake.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Unstake error:', error);
      setCurrentOperation(null);
    }
  };

  // Handle wrap action - directly executes wrap transaction
  const handleWrap = async () => {
    if (selectedForWrap.length === 0 || !userAddress) return;
    setCurrentOperation('wrap');

    const tokenIds = selectedForWrap.map(nft => BigInt(nft.tokenId));
    const totalFee = wrapFee * BigInt(tokenIds.length);

    try {
      if (supportsAtomicBatch && !isWrapperApproved) {
        // Smart wallet: batch approve + wrap
        await executeBatch([
          {
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'setApprovalForAll',
            args: [contracts.wrapper.address, true],
          },
          {
            address: contracts.wrapper.address,
            abi: contracts.wrapper.abi,
            functionName: 'wrapNFTs',
            args: [contracts.nft.address, tokenIds],
            value: totalFee,
          },
        ]);
      } else if (isWrapperApproved) {
        // Already approved, just wrap
        const hash = await writeContractAsync({
          address: contracts.wrapper.address,
          abi: contracts.wrapper.abi,
          functionName: 'wrapNFTs',
          args: [contracts.nft.address, tokenIds],
          value: totalFee,
        });
        showTxOverlay(hash, `Wrapping ${tokenIds.length} NFT${tokenIds.length > 1 ? 's' : ''}`);
      } else {
        // EOA: need to approve first
        const hash = await writeContractAsync({
          address: contracts.nft.address,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
        });
        showTxOverlay(hash, 'Approving wrapper contract');
      }
    } catch (error) {
      console.error('Wrap error:', error);
      setCurrentOperation(null);
    }
  };

  // Handle approve wrapper for wrapping
  const handleApproveWrapper = async () => {
    if (!userAddress) return;
    setCurrentOperation('wrap');
    try {
      const hash = await writeContractAsync({
        address: contracts.nft.address,
        abi: contracts.nft.abi,
        functionName: 'setApprovalForAll',
        args: [contracts.wrapper.address, true],
      });
      showTxOverlay(hash, 'Approving wrapper contract');
    } catch (error) {
      console.error('Approve wrapper error:', error);
      setCurrentOperation(null);
    }
  };

  // Handle hatching eggs
  const handleHatch = async () => {
    if (selectedEggs.length === 0 || !userAddress) return;
    setCurrentOperation('wrap'); // Reuse wrap operation type
    try {
      const tokenIds = selectedEggs.map(nft => BigInt(nft.tokenId));
      // Get unhatch fee from contract
      const unhatchFee = await publicClient?.readContract({
        address: contracts.nft.address,
        abi: contracts.nft.abi,
        functionName: 'unhatchFee',
        args: [],
      }) as bigint || 0n;

      // Total fee = unhatchFee * number of eggs
      const totalFee = unhatchFee * BigInt(selectedEggs.length);

      const hash = await writeContractAsync({
        address: contracts.nft.address,
        abi: contracts.nft.abi,
        functionName: 'unhatch',
        args: [tokenIds],
        value: totalFee,
      });
      showTxOverlay(hash, `Hatching ${selectedEggs.length} egg${selectedEggs.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Hatch error:', error);
      setCurrentOperation(null);
    }
  };

  useEffect(() => {
    if (isConfirmed) {
      refetchStaked();
      refetchNFTs();
      refetchApproval();
      refetchWrapperApproval();
      clearSelections();
      setCurrentOperation(null);
    }
  }, [isConfirmed, refetchStaked, refetchNFTs, refetchApproval, refetchWrapperApproval, clearSelections]);

  useEffect(() => {
    if (isBatchSuccess) {
      refetchStaked();
      refetchNFTs();
      refetchApproval();
      refetchWrapperApproval();
      clearSelections();
      setCurrentOperation(null);
      resetBatch();
    }
  }, [isBatchSuccess, refetchStaked, refetchNFTs, refetchApproval, refetchWrapperApproval, clearSelections, resetBatch]);

  useEffect(() => {
    clearSelections();
  }, [activeTab, clearSelections]);

  useEffect(() => {
    if (!isOpen) {
      clearSelections();
    }
  }, [isOpen, clearSelections]);

  const isProcessing = isWritePending || isConfirming || isBatchPending || isBatchConfirming;

  const navigateAndClose = (path: string) => {
    setIsOpen(false);
    router.push(path);
  };

  const getTypeConfig = (nft: InventoryNFT) => {
    // Use local type detection (tokenId based)
    const localType = getLocalNFTType(nft.tokenId, nft.name);
    if (localType === 'egg') return { title: 'Egg', emoji: '🥚', color: 'amber' };
    if (localType === 'snake') return { title: 'Snake', emoji: '🐍', color: 'green' };
    return { title: 'Human', emoji: '🧑', color: 'cyan' };
  };

  // Grid size classes - fewer columns to ensure NFTs stay at least 128px
  // With 900px design width and sidebar (~256px), content area is ~600px
  // So max 4 cols for 150px each minimum
  const gridClasses = {
    small: 'grid-cols-4',   // 4 items per row (~150px each)
    medium: 'grid-cols-3',  // 3 items per row (~200px each)
    large: 'grid-cols-2',   // 2 items per row (~300px each)
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Full-Screen OpenSea-Style Modal - always scales to fit viewport */}
      <div
        className="fixed inset-0 z-50 bg-[#0a0d0c] flex flex-col animate-fade-in origin-top-left"
        style={{
          transform: `scale(${scaleFactor})`,
          width: `${100 / scaleFactor}%`,
          height: `${100 / scaleFactor}%`,
        }}>
        {/* Header */}
        <header className="flex-shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#171e1d]/95 backdrop-blur-xl">
          <div className="flex items-center justify-between px-6 py-3">
            {/* Logo & Title */}
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ffd075] via-[#c5a97b] to-[#a68b5b] flex items-center justify-center">
                  <span className="text-xl">🐍</span>
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white">Applesnakes</h1>
                  <p className="text-xs text-[#8a9090]">Marketplace Hub</p>
                </div>
              </div>
            </div>

            {/* Search Bar */}
            <div className="flex flex-1 max-w-xl mx-8">
              <div className="relative w-full">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8a9090]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-xl text-white placeholder-[#8a9090] focus:outline-none focus:border-[rgba(255,208,117,0.4)] focus:ring-1 focus:ring-[rgba(255,208,117,0.3)] transition-all"
                />
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-3">
              {/* Balance Pills */}
              {isWalletConnected && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1a2221] border border-[rgba(255,255,255,0.08)]">
                    <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                    <span className="text-white text-sm font-medium">{wTokenBalanceFormatted.toFixed(2)}</span>
                    <span className="text-[#8a9090] text-xs">$wASS</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1a2221] border border-[rgba(255,255,255,0.08)]">
                    <img src="/Images/Ether.png" alt="ETH" className="w-4 h-4" />
                    <span className="text-white text-sm font-medium">{ethBalanceFormatted.toFixed(4)}</span>
                  </div>
                </div>
              )}

              {/* Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-lg bg-[#1a2221] hover:bg-[#1f2827] border border-[rgba(255,255,255,0.08)] text-[#8a9090] hover:text-white transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex items-center gap-6 px-6 border-t border-[rgba(255,255,255,0.06)] overflow-x-auto scrollbar-hide">
              <button
                onClick={() => handleTabChange('collection')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'collection'
                    ? 'border-[rgba(255,208,117,0.4)] text-[#ffd075]'
                    : 'border-transparent text-[#8a9090] hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">My NFTs</span>
                <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs rounded-full bg-[#1a2221]">{collectionNFTs.length}</span>
                {stakedCount > 0 && (
                  <span className="inline ml-1 px-1.5 py-0.5 text-[10px] rounded bg-[rgba(255,208,117,0.12)] text-[#ffd075]">
                    +{stakedCount} staked
                  </span>
                )}
              </button>
              <button
                onClick={() => handleTabChange('listings')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'listings'
                    ? 'border-[#22c55e] text-[#22c55e]'
                    : 'border-transparent text-[#8a9090] hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">Market</span>
                {totalListingsCount > 0 && (
                  <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs rounded-full bg-[#1a2221]">{totalListingsCount}</span>
                )}
                {effectiveFloorPrice && (
                  <span className={`inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 text-[10px] rounded ${isPoolFloor ? 'bg-[rgba(249,105,14,0.15)] text-[#f9690e]' : 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]'}`}>
                    {effectiveFloorPrice}
                    <img src="/Images/Ether.png" alt="ETH" className="w-3 h-3" />
                  </span>
                )}
              </button>
              {/* Items and Exchange tabs hidden */}
              <button
                onClick={() => handleTabChange('trading')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'trading'
                    ? 'border-yellow-500 text-yellow-400'
                    : 'border-transparent text-[#8a9090] hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">Trading</span>
                <span className={`ml-1 px-1.5 py-0.5 text-[10px] rounded inline-flex items-center gap-1 ${
                  (allPairChanges.get('wass-eth') || 0) >= 0
                    ? 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]'
                    : 'bg-[rgba(255,59,92,0.12)] text-[#FF3B5C]'
                }`}>
                  <img src="/Images/Token.png" alt="wASS" className="w-3 h-3" />
                  {(allPairChanges.get('wass-eth') || 0) >= 0 ? '+' : ''}{(allPairChanges.get('wass-eth') || 0).toFixed(2)}%
                </span>
              </button>

              {/* Staking Rewards - Compact display with claim button */}
              <div className="ml-auto flex items-center gap-2 text-sm flex-shrink-0">
                {stakedCount > 0 && hasPendingRewards ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[#22c55e]">
                      <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                      <span>{pendingRewardsFormatted}</span>
                    </div>
                    <button
                      onClick={handleClaimRewards}
                      disabled={isProcessing}
                      className="px-2 py-1 rounded-lg bg-[rgba(34,197,94,0.12)] text-[#22c55e] hover:bg-[rgba(34,197,94,0.18)] border border-[rgba(34,197,94,0.2)] transition-all disabled:opacity-50"
                    >
                      Claim
                    </button>
                  </>
                ) : stakedCount > 0 ? (
                  <div className="flex items-center gap-1.5 text-[#8a9090]">
                    <img src="/Images/Token.png" alt="wASS" className="w-4 h-4 opacity-50" />
                    <span>0.00</span>
                  </div>
                ) : null}
              </div>
            </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar - shows filters for NFT tabs, token pairs for trading tab (Items tab has its own sidebar) */}
          <aside className={`flex-shrink-0 border-r border-[rgba(255,255,255,0.06)] bg-[#171e1d]/50 transition-all overflow-y-auto ${showFilters && activeTab !== 'items' ? 'block w-64' : 'w-0'}`}>
            {showFilters && activeTab !== 'items' && (
              <div className="p-4 space-y-6">
                {activeTab === 'trading' ? (
                  /* ===== TRADING TAB SIDEBAR ===== */
                  <>
                    {/* ===== SWAP VIEW SIDEBAR ===== */}
                    <>
                        {/* Trading Header */}
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white">Token Pairs</h3>
                        </div>

                        {/* Token Pairs List - Combines static pairs with Token Wars launches */}
                        <div>
                          <h4 className="text-sm font-medium text-[#8a9090] mb-3">Available Pairs</h4>
                          {launchedTokensLoading && combinedPairs.length === TOKEN_PAIRS.length && (
                            <div className="text-xs text-[#6b7575] mb-2">Loading Token Wars pairs...</div>
                          )}
                          <div className="space-y-2">
                            {combinedPairs
                              .sort((a, b) => {
                                // Primary pool always first
                                if (a.isDefault && !b.isDefault) return -1;
                                if (!a.isDefault && b.isDefault) return 1;
                                // Static pairs before Token Wars
                                if (!a.isTokenWars && b.isTokenWars) return -1;
                                if (a.isTokenWars && !b.isTokenWars) return 1;
                                // Token Wars sorted by raised amount (most raised first)
                                if (a.isTokenWars && b.isTokenWars) {
                                  const aRaised = a.tokenWarsData?.totalRaisedUsdc || 0;
                                  const bRaised = b.tokenWarsData?.totalRaisedUsdc || 0;
                                  return bRaised - aRaised;
                                }
                                // Static pairs sorted by price change
                                const aChange = allPairChanges.get(a.id) || 0;
                                const bChange = allPairChanges.get(b.id) || 0;
                                return bChange - aChange;
                              })
                              .map((pair) => {
                                const pairChange = allPairChanges.get(pair.id);
                                const isSelected = selectedPairId === pair.id;
                                const twData = pair.tokenWarsData;
                                return (
                                  <button
                                    key={pair.id}
                                    onClick={() => handleSidebarPairSelect(pair)}
                                    className={`w-full block p-3 rounded-lg border transition-all text-left ${
                                      isSelected
                                        ? pair.isTokenWars
                                          ? 'bg-[rgba(255,208,117,0.12)] border-[rgba(255,208,117,0.3)]'
                                          : 'bg-[rgba(255,208,117,0.12)] border-[rgba(255,208,117,0.3)]'
                                        : pair.isTokenWars
                                          ? 'bg-[rgba(255,208,117,0.06)] border-[rgba(255,208,117,0.2)] hover:bg-[rgba(255,208,117,0.1)] hover:border-[rgba(255,208,117,0.3)]'
                                          : 'bg-[#1a2221] border-[rgba(255,255,255,0.08)] hover:bg-[#1f2827] hover:border-[rgba(255,208,117,0.15)]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`font-medium flex items-center gap-1 ${isSelected ? (pair.isTokenWars ? 'text-[#ffd075]' : 'text-[#ffd075]') : 'text-white'}`}>
                                        {(() => {
                                          const img0 = getTokenImage(pair.token0);
                                          const img1 = getTokenImage(pair.token1);
                                          const symbol0 = getTokenSymbol(pair.token0);
                                          const symbol1 = getTokenSymbol(pair.token1);
                                          return (
                                            <>
                                              {img0 ? (
                                                <img src={img0} alt={symbol0} className="w-4 h-4 rounded-full" />
                                              ) : (
                                                <span className="text-xs">{symbol0}</span>
                                              )}
                                              <span className="text-[#6b7575]">/</span>
                                              {img1 ? (
                                                <img src={img1} alt={symbol1} className="w-4 h-4 rounded-full" />
                                              ) : (
                                                <span className="text-xs">{symbol1}</span>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </span>
                                      {/* Show price change for static pairs, or DEX badge for launched tokens */}
                                      {pair.isTokenWars ? (
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                          pair.tokenWarsData?.dex === 'aerodrome'
                                            ? 'bg-[rgba(255,208,117,0.12)] text-[#ffd075]'
                                            : pair.tokenWarsData?.dex === 'hydrex'
                                              ? 'bg-[rgba(249,105,14,0.15)] text-[#f9690e]'
                                              : 'bg-[rgba(255,208,117,0.12)] text-[#ffd075]'
                                        }`}>
                                          {pair.tokenWarsData?.dex === 'aerodrome' ? 'AERO' : pair.tokenWarsData?.dex === 'hydrex' ? 'HYDREX' : 'V4'}
                                        </span>
                                      ) : pairChange !== undefined && (
                                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                          pairChange >= 0
                                            ? 'text-[#ffd075] bg-[rgba(255,208,117,0.12)]'
                                            : 'text-[#FF3B5C] bg-[rgba(255,59,92,0.12)]'
                                        }`}>
                                          {pairChange >= 0 ? '+' : ''}{pairChange.toFixed(2)}%
                                        </span>
                                      )}
                                    </div>
                                    {/* Token Wars specific info */}
                                    {twData ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="text-[#8a9090] truncate">{twData.name}</span>
                                          <span className="text-[#22c55e] font-medium">${(twData.totalRaisedUsdc ?? 0).toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] text-[#6b7575]">
                                          <span>{twData.participantCount ?? 0} participants</span>
                                          <span className="flex items-center gap-1">
                                            {twData.pairType === 'wass' ? (
                                              <img src="/Images/Token.png" alt="wASS" className="w-3 h-3" />
                                            ) : (
                                              <img src="/Images/Ether.png" alt="ETH" className="w-3 h-3" />
                                            )}
                                            <span>{(twData.pairType ?? 'ETH').toUpperCase()} pair</span>
                                          </span>
                                        </div>
                                        {/* External links for Token Wars tokens */}
                                        <div className="flex items-center gap-1 mt-1">
                                          {twData.dexScreenerUrl && (
                                            <a
                                              href={twData.dexScreenerUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-[9px] px-1.5 py-0.5 bg-[rgba(34,197,94,0.18)] text-[#22c55e] rounded hover:bg-[rgba(34,197,94,0.3)]"
                                            >
                                              Chart
                                            </a>
                                          )}
                                          {twData.basescanUrl && (
                                            <a
                                              href={twData.basescanUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-[9px] px-1.5 py-0.5 bg-[#2a3533]/30 text-[#8a9090] rounded hover:bg-[#2a3533]/50"
                                            >
                                              Scan
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between text-xs text-[#8a9090]">
                                        <span>{pair.isDefault ? 'Primary pool' : 'Trading pair'}</span>
                                        <span>1% fee</span>
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      </>
                  </>
                ) : (
                  /* ===== NFT TABS SIDEBAR ===== */
                  <>
                    {/* Filter Header */}
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-white">Filters</h3>
                      <button
                        onClick={() => {
                          setFilterType('all');
                          setSearchQuery('');
                        }}
                        className="text-xs text-[#ffd075] hover:text-[#c5a97b]"
                      >
                        Clear all
                      </button>
                    </div>

                    {/* Type Filter */}
                    <div>
                      <h4 className="text-sm font-medium text-[#8a9090] mb-3">Type</h4>
                      <div className="space-y-2">
                        {(['all', 'human', 'snake', 'egg'] as FilterType[]).map((type) => {
                          const labels: Record<FilterType, { label: string; emoji: string }> = {
                            all: { label: 'All', emoji: '🎴' },
                            human: { label: 'Human', emoji: '🧑' },
                            snake: { label: 'Snake', emoji: '🐍' },
                            egg: { label: 'Egg', emoji: '🥚' },
                          };
                          return (
                            <button
                              key={type}
                              onClick={() => setFilterType(type)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all ${
                                filterType === type
                                  ? 'bg-[rgba(255,208,117,0.12)] border border-[rgba(255,208,117,0.3)] text-[#ffd075]'
                                  : 'bg-[#1a2221] border border-[rgba(255,255,255,0.08)] text-[#cecece] hover:bg-[#1f2827] hover:border-[rgba(255,208,117,0.15)]'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span>{labels[type].emoji}</span>
                                <span className="text-sm">{labels[type].label}</span>
                              </span>
                              <span className="text-xs text-[#6b7575]">{typeCounts[type]}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sort Options */}
                    <div>
                      <h4 className="text-sm font-medium text-[#8a9090] mb-3">Sort By</h4>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="w-full px-3 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-lg text-white text-sm focus:outline-none focus:border-[rgba(255,208,117,0.4)]"
                      >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="id-asc">ID: Low to High</option>
                        <option value="id-desc">ID: High to Low</option>
                        {activeTab === 'listings' && (
                          <>
                            <option value="price-asc">Price: Low to High</option>
                            <option value="price-desc">Price: High to Low</option>
                          </>
                        )}
                      </select>
                    </div>

                    {/* Grid Size */}
                    <div>
                      <h4 className="text-sm font-medium text-[#8a9090] mb-3">Grid Size</h4>
                      <div className="flex gap-2">
                        {(['small', 'medium', 'large'] as const).map((size) => (
                          <button
                            key={size}
                            onClick={() => setGridSize(size)}
                            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                              gridSize === size
                                ? 'bg-[rgba(255,208,117,0.12)] border border-[rgba(255,208,117,0.3)] text-[#ffd075]'
                                : 'bg-[#1a2221] border border-[rgba(255,255,255,0.08)] text-[#8a9090] hover:text-white'
                            }`}
                          >
                            {size.charAt(0).toUpperCase() + size.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pool Info - only show on listings and exchange tabs */}
                    {(activeTab === 'listings' || activeTab === 'exchange') && (
                      <div className="pt-4 border-t border-[rgba(255,255,255,0.06)]">
                        <h4 className="text-sm font-medium text-[#8a9090] mb-3">Pool Info</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-[#8a9090]">Pool Size</span>
                            <span className="text-white font-medium flex items-center gap-1">
                              {poolNFTs.length}
                              <img src="/Images/MountianGuyHead.png" alt="NFTs" className="w-4 h-4" />
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#8a9090]">Wrap Fee</span>
                            <span className="text-[#f9690e] font-medium flex items-center gap-1">
                              {parseFloat(wrapFeeFormatted).toFixed(4)}
                              <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                            </span>
                          </div>
                          {buyQuotePrice && (
                            <div className="flex justify-between items-center">
                              <span className="text-[#8a9090]">Buy Price</span>
                              <span className="text-[#ffd075] font-medium flex items-center gap-1">
                                ~{parseFloat(buyQuotePrice).toFixed(4)}
                                <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>


          {/* Toggle Sidebar Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-r-lg text-[#8a9090] hover:text-white hover:bg-[#1f2827] transition-all"
            style={{ left: showFilters ? '256px' : '0' }}
          >
            <svg className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Main Content Area */}
          <main className="flex-1 overflow-y-auto p-6 relative">
            {/* ===== COLLECTION TAB ===== */}
            {activeTab === 'collection' && (
            <>
            {!isWalletConnected ? (
              /* Connect Wallet State */
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[rgba(255,208,117,0.12)] via-[rgba(197,169,123,0.12)] to-[rgba(166,139,91,0.12)] flex items-center justify-center border border-[rgba(255,208,117,0.4)]/30 mb-6">
                  <svg className="w-12 h-12 text-[#ffd075]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
                <p className="text-[#8a9090] max-w-md">Connect your wallet to view and manage your NFT collection</p>
              </div>
            ) : isLoading || isLoadingStaked ? (
              /* Loading State */
              <div className="flex flex-col items-center justify-center h-full">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-[rgba(255,208,117,0.4)]/20 border-t-[#ffd075] rounded-full animate-spin"></div>
                </div>
                <p className="mt-4 text-[#8a9090]">Loading your collection...</p>
              </div>
            ) : displayedNFTs.length === 0 ? (
              /* Empty State */
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[rgba(255,208,117,0.12)] via-[rgba(197,169,123,0.12)] to-[rgba(166,139,91,0.12)] flex items-center justify-center border border-[rgba(255,208,117,0.4)]/30 mb-6">
                  <span className="text-4xl">{searchQuery || filterType !== 'all' ? '🔍' : '🎁'}</span>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {searchQuery || filterType !== 'all' ? 'No Results Found' : 'No NFTs Yet'}
                </h2>
                <p className="text-[#8a9090] max-w-md mb-6">
                  {searchQuery || filterType !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'Start your collection today!'}
                </p>
                {!searchQuery && filterType === 'all' && (
                  <button
                    onClick={handleBuyNFT}
                    className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-[#ffd075] to-[#c5a97b] text-[#0a0d0c] hover:from-[#ffe0a0] hover:to-[#d4b88a] transition-all hover:scale-105"
                  >
                    🛒 Get Your First NFT
                  </button>
                )}
              </div>
            ) : (
              /* NFT Grid - added padding for hover scaling */
              <div className={`grid ${gridClasses[gridSize]} gap-4 p-2`}>
                {displayedNFTs.map((nft) => {
                  const isJailed = nft.isJailed;
                  const isEgg = nft.isEgg;
                  const isEvolved = nft.evolved;
                  const isStaked = nft.isStaked;
                  const isSelected = selectedNFTs.has(nft.tokenId);
                  const typeConfig = getTypeConfig(nft);

                  return (
                    <button
                      key={nft.tokenId}
                      onClick={(e) => handleNFTInteraction(nft, e)}
                      className={`group relative rounded-2xl bg-[#171e1d] border-2 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-1 text-left ${
                        isSelected
                          ? isStaked
                            ? 'border-[rgba(255,208,117,0.5)] ring-2 ring-[rgba(255,208,117,0.25)]'
                            : 'border-[rgba(255,208,117,0.4)] ring-2 ring-[rgba(255,208,117,0.2)]'
                          : isStaked
                            ? 'border-[rgba(255,208,117,0.4)] hover:border-[rgba(255,208,117,0.4)]'
                            : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,208,117,0.15)]'
                      }`}
                      style={{
                        minWidth: '128px',
                        boxShadow: isSelected
                          ? isStaked
                            ? '0 8px 32px rgba(255, 208, 117, 0.4)'
                            : '0 8px 32px rgba(255, 208, 117, 0.3)'
                          : isStaked
                            ? '0 0 20px rgba(255, 208, 117, 0.35), 0 0 40px rgba(255, 208, 117, 0.15), 0 4px 12px rgba(0, 0, 0, 0.3)'
                            : '0 4px 12px rgba(0, 0, 0, 0.3)',
                        animation: isStaked && !isSelected ? 'stakedGlow 2s ease-in-out infinite alternate' : undefined,
                      }}
                    >
                      {/* Image Container */}
                      <div className="aspect-square relative bg-[#0a0d0c] overflow-hidden rounded-t-2xl">
                        <img
                          src={nft.imageUrl}
                          alt={nft.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                        />

                        {/* Gradient Overlay on Hover */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                        {/* Selection Checkbox */}
                        {(isSelectionMode || isSelected) && (
                          <div
                            className={`absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center border-2 transition-all ${
                              isSelected
                                ? isStaked
                                  ? 'bg-[#ffd075] border-[rgba(255,208,117,0.4)]'
                                  : 'bg-[#c5a97b] border-[rgba(255,208,117,0.5)]'
                                : 'bg-[#171e1d]/80 border-[rgba(255,255,255,0.1)] backdrop-blur-sm'
                            }`}
                          >
                            {isSelected && (
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        )}

                        {/* Status Badges */}
                        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                          {isStaked && (
                            <span className="px-2 py-1 rounded-lg bg-[rgba(255,208,117,0.85)] text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1">
                              <img src="/Images/Token.png" alt="Staked" className="w-3 h-3" />
                              <span className="inline">Staked</span>
                            </span>
                          )}
                          {isEvolved && (
                            <span className="px-2 py-1 rounded-lg bg-yellow-500/90 text-white text-xs font-bold backdrop-blur-sm">
                              ⭐
                            </span>
                          )}
                          {isJailed && (
                            <span className="px-2 py-1 rounded-lg bg-[rgba(255,59,92,0.85)] text-white text-xs font-bold backdrop-blur-sm">
                              🔒
                            </span>
                          )}
                        </div>

                        {/* Quick View Button */}
                        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-md text-white text-xs font-medium border border-white/20">
                            View Details
                          </div>
                        </div>

                        {/* Edit Traits Button - only show for humans (not snakes or eggs) */}
                        {!isEgg && !isJailed && !nft.isSnake && getLocalNFTType(nft.tokenId, nft.name) === 'human' && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedNFTForTraits(nft);
                              setShowTraitSwapper(true);
                            }}
                            className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded-lg bg-[rgba(255,208,117,0.75)] hover:bg-[rgba(255,208,117,0.9)] backdrop-blur-md text-white text-xs font-medium border border-[rgba(255,208,117,0.35)] cursor-pointer"
                          >
                            ✨ Edit
                          </div>
                        )}
                      </div>

                      {/* Card Info */}
                      <div className="p-3 space-y-2">
                        {/* Name & Type */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-white truncate text-sm">{nft.name}</h3>
                            <p className="text-xs text-[#6b7575]">#{nft.tokenId}</p>
                          </div>
                          <span className={`flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium ${
                            nft.nftType === 'snake' ? 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]' :
                            nft.nftType === 'egg' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-[rgba(255,208,117,0.12)] text-[#ffd075]'
                          }`}>
                            {typeConfig.emoji} {typeConfig.title}
                          </span>
                        </div>

                        {/* Status Row */}
                        <div className="flex items-center justify-between text-xs">
                          <span className={isStaked && nft.isSnake ? 'text-[#22c55e] font-medium' : 'text-[#8a9090]'}>
                            {nft.isSnake
                              ? (isStaked ? 'Earning $wASS' : 'Ready to stake')
                              : isEgg
                                ? 'Ready to hatch'
                                : (nft.canUnwrap ? 'Ready to wrap' : 'Cooldown active')
                            }
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </>
            )}

            {/* ===== LISTINGS TAB - OpenSea Marketplace ===== */}
            {activeTab === 'listings' && (
              <>
                {listingsLoading ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-[rgba(34,197,94,0.15)] border-t-[#22c55e] rounded-full animate-spin"></div>
                    </div>
                    <p className="mt-4 text-[#8a9090]">Loading marketplace listings...</p>
                  </div>
                ) : openSeaListings.length === 0 && poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length === 0 && marketplaceListings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[rgba(255,208,117,0.12)] via-[rgba(197,169,123,0.12)] to-[rgba(139,114,69,0.12)] flex items-center justify-center border border-[rgba(34,197,94,0.2)] mb-6">
                      <span className="text-4xl">🏪</span>
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">No Active Listings</h2>
                    <p className="text-[#8a9090] max-w-md mb-6">
                      No NFTs are currently listed for sale. Check back later!
                    </p>
                    <a
                      href="https://opensea.io/collection/applesnakes"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white hover:from-[#4ade80] hover:to-[#22c55e] transition-all hover:scale-105"
                    >
                      View on OpenSea
                    </a>
                  </div>
                ) : (
                  <div>
                    {/* Listings Header */}
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h2 className="text-xl font-bold text-white">Marketplace</h2>
                        <p className="text-sm text-[#8a9090] flex items-center gap-1 flex-wrap">
                          {openSeaListings.length + (poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length > 0 ? 1 : 0) + marketplaceListings.length} listings available
                          {effectiveFloorPrice && (
                            <span className="flex items-center gap-1 ml-1">
                              • Floor: {effectiveFloorPrice}
                              <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5 inline" />
                            </span>
                          )}
                          {marketplaceListings.length > 0 && (
                            <span className="flex items-center gap-1 ml-1">
                              • {marketplaceListings.length}
                              <img src="/Images/Token.png" alt="wASS" className="w-3.5 h-3.5 inline" />
                              wASS
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          refetchListings();
                          fetchMarketplaceListings();
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1a2221] border border-[rgba(255,255,255,0.08)] text-[#cecece] hover:text-white hover:bg-[#1f2827] transition-all"
                      >
                        <span>↻</span>
                        <span>Refresh</span>
                      </button>
                    </div>

                    {/* Listings Grid */}
                    <div className={`grid ${gridClasses[gridSize]} gap-4`}>
                      {/* Contract "Buy from Pool" Option - ALWAYS shows when filter allows */}
                      {(() => {
                        // Only show pool option if human filter is active or all filter
                        if (filterType !== 'all' && filterType !== 'human') return null;

                        // Find the first human NFT from the pool that matches search (for preview image)
                        const poolHuman = poolNFTs.find(nft => {
                          const localType = getLocalNFTType(nft.tokenId, nft.name);
                          if (localType !== 'human') return false;
                          // Apply search filter
                          if (searchQuery) {
                            const query = searchQuery.toLowerCase();
                            if (!nft.name.toLowerCase().includes(query) && !nft.tokenId.toString().includes(query)) {
                              return false;
                            }
                          }
                          return true;
                        });

                        // Count available humans in pool
                        const humansInPool = poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length;

                        // Show real quote price from quoter, or loading state
                        const contractPriceDisplay = isFetchingQuote
                          ? '...'
                          : buyQuotePrice
                            ? parseFloat(buyQuotePrice).toFixed(4)
                            : '~0.001';

                        // Always show Buy from Pool card - even during loading
                        // This ensures users always see this option
                        return (
                          <button
                            key="contract-buy"
                            onClick={handleBuyNFT}
                            className="group relative rounded-2xl bg-[#171e1d] border-2 border-[rgba(255,208,117,0.3)] hover:border-[rgba(255,208,117,0.5)] transition-all duration-200 text-left hover:scale-[1.02] hover:-translate-y-1"
                            style={{
                              minWidth: '128px',
                              boxShadow: '0 4px 16px rgba(255, 208, 117, 0.2)',
                            }}
                          >
                            {/* Image Container */}
                            <div className="aspect-square relative bg-[#0a0d0c] overflow-hidden rounded-t-2xl">
                              <img
                                src="https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dm7e0kn5ud2iogv1fonqr7if8ijb9w61bpcbjxuk0cp177dv2pp/1.png"
                                alt="Buy from Pool"
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                              />

                              {/* Gradient Overlay */}
                              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(139,114,69,0.4)] via-transparent to-transparent" />

                              {/* ETH Price Badge */}
                              <div className="absolute top-2 left-2">
                                <span className="px-2 py-1 rounded-lg bg-[rgba(197,169,123,0.85)] text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1">
                                  <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                                  <span>{contractPriceDisplay}</span>
                                </span>
                              </div>

                              {/* Buy Button */}
                              <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="px-3 py-1.5 rounded-lg bg-[#c5a97b] text-white text-xs font-bold">
                                  Buy Instantly
                                </div>
                              </div>
                            </div>

                            {/* Card Info */}
                            <div className="p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-white truncate text-sm">Buy from Pool</h3>
                                  <p className="text-xs text-[#8a9090]">
                                    {`${humansInPool} humans available`}
                                  </p>
                                </div>
                                <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-[rgba(255,208,117,0.12)] text-[#ffd075]">
                                  Instant
                                </span>
                              </div>
                              <p className="text-xs text-[#6b7575]">
                                No gas fees for smart wallets • Instant delivery
                              </p>
                            </div>
                          </button>
                        );
                      })()}

                      {/* Combined Listings - Sorted by USD value */}
                      {(listingsLoading || marketplaceLoading) ? (
                        <div className="col-span-full flex items-center justify-center py-4">
                          <div className="text-[#8a9090] text-sm">Loading listings...</div>
                        </div>
                      ) : (
                        unifiedListings
                          .filter((listing) => {
                            // Apply type filter
                            if (filterType !== 'all') {
                              if (listing.nftType !== filterType) return false;
                            }
                            // Apply search filter
                            if (searchQuery) {
                              const query = searchQuery.toLowerCase();
                              if (!listing.name.toLowerCase().includes(query) && !listing.tokenId.toString().includes(query)) {
                                return false;
                              }
                            }
                            return true;
                          })
                          .sort((a, b) => {
                            // Sort by USD value for price sorting, ID for ID sorting
                            switch (sortBy) {
                              case 'price-asc':
                                return a.priceUsd - b.priceUsd;
                              case 'price-desc':
                                return b.priceUsd - a.priceUsd;
                              case 'id-asc':
                                return a.tokenId - b.tokenId;
                              case 'id-desc':
                                return b.tokenId - a.tokenId;
                              default:
                                return 0;
                            }
                          })
                          .map((listing) => {
                            // OpenSea listing card
                            if (listing.type === 'opensea') {
                              const isBuyingThis = buyingOrderHash === listing.orderHash && isBuyingFromOpenSea;
                              return (
                                <div
                                  key={listing.orderHash}
                                  className={`group relative rounded-2xl bg-[#171e1d] border-2 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-1 ${
                                    isBuyingThis ? 'border-yellow-500/70' : 'border-[rgba(255,255,255,0.06)] hover:border-[#22c55e]/50'
                                  }`}
                                  style={{
                                    minWidth: '128px',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                                  }}
                                >
                                  {/* Image Container */}
                                  <div className="aspect-square relative bg-[#0a0d0c] overflow-hidden rounded-t-2xl">
                                    <img
                                      src={listing.imageUrl}
                                      alt={listing.name}
                                      className={`w-full h-full object-cover transition-transform duration-300 ${isBuyingThis ? 'opacity-50' : 'group-hover:scale-110'}`}
                                    />

                                    {/* Loading Overlay */}
                                    {isBuyingThis && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                        <div className="text-4xl animate-bounce">🔄</div>
                                      </div>
                                    )}

                                    {/* Gradient Overlay on Hover */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                    {/* ETH Price Badge */}
                                    <div className="absolute top-2 left-2">
                                      <span className="px-2 py-1 rounded-lg bg-[rgba(197,169,123,0.85)] text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1">
                                        <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                                        <span>{parseFloat(listing.priceRaw).toFixed(4)}</span>
                                      </span>
                                    </div>
                                  </div>

                                  {/* Card Info */}
                                  <div className="p-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-white truncate text-sm">{listing.name}</h3>
                                        <p className="text-xs text-[#6b7575] truncate" title={listing.seller}>{getSellerIdentity(listing.seller).name || getSellerIdentity(listing.seller).shortAddress}</p>
                                      </div>
                                      <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-[rgba(255,208,117,0.12)] text-[#ffd075]">
                                        OpenSea
                                      </span>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => {
                                          // Find original OpenSea listing to pass to handler
                                          const originalListing = openSeaListings.find(l => l.orderHash === listing.orderHash);
                                          if (originalListing) handleBuyOpenSeaListing(originalListing);
                                        }}
                                        disabled={isBuyingFromOpenSea || !isConnected}
                                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                                          isBuyingThis
                                            ? 'bg-yellow-500/20 text-yellow-400 cursor-wait'
                                            : isConnected
                                            ? 'bg-[#c5a97b] hover:bg-[#a68b5b] text-white'
                                            : 'bg-[#1f2827] text-[#8a9090] cursor-not-allowed'
                                        }`}
                                      >
                                        {isBuyingThis ? 'Buying...' : 'Buy Now'}
                                      </button>
                                      <a
                                        href={listing.openseaUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="py-2 px-3 rounded-lg bg-[#1f2827] hover:bg-[#2a3533] text-[#cecece] text-xs font-medium transition-all"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        View
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            // wASS Marketplace listing card
                            const isBuyingThis = buyingMarketplaceTokenId === listing.tokenId.toString();
                            const isProcessing = isBuyingWithWass || isConfirmingWassBuy || isBuyingWithEth || isConfirmingEthBuy || isApprovingWass || isConfirmingWassApproval;
                            const priceNum = parseFloat(listing.priceRaw);
                            // Find original marketplace listing to get the price in wei
                            const originalListing = marketplaceListings.find(l => l.tokenId === listing.tokenId.toString());
                            const priceWei = originalListing?.price || '0';

                            return (
                              <div
                                key={`marketplace-${listing.tokenId}`}
                                className={`group relative rounded-2xl bg-[#171e1d] border-2 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-1 ${
                                  isBuyingThis ? 'border-yellow-500/70' : 'border-[rgba(255,208,117,0.5)]/30 hover:border-[rgba(255,208,117,0.5)]/70'
                                }`}
                                style={{
                                  minWidth: '128px',
                                  boxShadow: '0 4px 12px rgba(255, 208, 117, 0.2)',
                                }}
                              >
                                {/* Image Container */}
                                <div className="aspect-square relative bg-[#0a0d0c] overflow-hidden rounded-t-2xl">
                                  <img
                                    src={listing.imageUrl}
                                    alt={listing.name}
                                    className={`w-full h-full object-cover transition-transform duration-300 ${isBuyingThis ? 'opacity-50' : 'group-hover:scale-110'}`}
                                  />

                                  {/* Loading Overlay */}
                                  {isBuyingThis && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                      <div className="text-4xl animate-bounce">🔄</div>
                                    </div>
                                  )}

                                  {/* Gradient Overlay on Hover */}
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                  {/* Price Badges - wASS and ETH */}
                                  <div className="absolute top-2 left-2 flex flex-col gap-1">
                                    {/* wASS Price */}
                                    <span className="px-2 py-1 rounded-lg bg-[rgba(255,208,117,0.85)] text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1">
                                      <img src="/Images/Token.png" alt="wASS" className="w-3.5 h-3.5" />
                                      <span>{priceNum < 100 ? priceNum.toFixed(2) : priceNum.toFixed(0)}</span>
                                    </span>
                                    {/* ETH Price */}
                                    {ethPerWass && (
                                      <span className="px-2 py-1 rounded-lg bg-[rgba(197,169,123,0.85)] text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1">
                                        <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                                        <span>{(priceNum * ethPerWass * 1.10).toFixed(4)}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Card Info */}
                                <div className="p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <h3 className="font-semibold text-white truncate text-sm">{listing.name}</h3>
                                      <p className="text-xs text-[#6b7575] truncate" title={listing.seller}>{getSellerIdentity(listing.seller).name || getSellerIdentity(listing.seller).shortAddress}</p>
                                    </div>
                                    <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-[rgba(255,208,117,0.12)] text-[#ffd075]">
                                      For Sale
                                    </span>
                                  </div>

                                  {/* Action Buttons - wASS and ETH */}
                                  <div className="flex gap-2">
                                    {/* Buy with wASS Button */}
                                    <button
                                      onClick={async () => {
                                        if (!originalListing) return;
                                        setBuyingMarketplaceTokenId(originalListing.tokenId);
                                        resetWassBuy();
                                        resetWassApproval();
                                        try {
                                          const priceWeiBigInt = BigInt(originalListing.price);
                                          if (wassAllowance >= priceWeiBigInt) {
                                            await buyWithWass(originalListing.collection as `0x${string}`, BigInt(originalListing.tokenId));
                                          } else {
                                            await approveWass();
                                          }
                                        } catch (err) {
                                          console.error('[MarketplaceBuy] wASS Error:', err);
                                          setBuyingMarketplaceTokenId(null);
                                        }
                                      }}
                                      disabled={isProcessing || !isConnected || (wassBalance < BigInt(priceWei))}
                                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                                        isBuyingThis && (isBuyingWithWass || isConfirmingWassBuy || isApprovingWass || isConfirmingWassApproval)
                                          ? 'bg-yellow-500/20 text-yellow-400 cursor-wait'
                                          : !isConnected || wassBalance < BigInt(priceWei)
                                          ? 'bg-[#1f2827] text-[#8a9090] cursor-not-allowed'
                                          : 'bg-[#ffd075] hover:bg-[#a68b5b] text-white'
                                      }`}
                                      title={wassBalance < BigInt(priceWei) ? `Need ${listing.priceRaw} wASS` : 'Buy with wASS'}
                                    >
                                      <img src="/Images/Token.png" alt="wASS" className="w-3 h-3" />
                                      {isBuyingThis && (isBuyingWithWass || isConfirmingWassBuy || isApprovingWass || isConfirmingWassApproval)
                                        ? (isApprovingWass || isConfirmingWassApproval ? 'Approve' : 'Buy...')
                                        : 'wASS'}
                                    </button>
                                    {/* Buy with ETH Button */}
                                    <button
                                      onClick={async () => {
                                        if (!originalListing) return;
                                        setBuyingMarketplaceTokenId(originalListing.tokenId);
                                        resetEthBuy();
                                        try {
                                          const priceWeiBigInt = BigInt(originalListing.price);
                                          const { ethNeeded, minWassOut } = await quoteEthForWassAmount(priceWeiBigInt);
                                          console.log(`[MarketplaceBuy] ETH quote: ${ethNeeded} ETH for ${originalListing.priceFormatted} wASS`);
                                          await buyWithEth(
                                            originalListing.collection as `0x${string}`,
                                            BigInt(originalListing.tokenId),
                                            ethNeeded,
                                            minWassOut
                                          );
                                        } catch (err) {
                                          console.error('[MarketplaceBuy] ETH Error:', err);
                                          setBuyingMarketplaceTokenId(null);
                                        }
                                      }}
                                      disabled={isProcessing || !isConnected}
                                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                                        isBuyingThis && (isBuyingWithEth || isConfirmingEthBuy)
                                          ? 'bg-yellow-500/20 text-yellow-400 cursor-wait'
                                          : !isConnected
                                          ? 'bg-[#1f2827] text-[#8a9090] cursor-not-allowed'
                                          : 'bg-[#c5a97b] hover:bg-[#a68b5b] text-white'
                                      }`}
                                      title="Buy with ETH (auto-converts to wASS)"
                                    >
                                      <img src="/Images/Ether.png" alt="ETH" className="w-3 h-3" />
                                      {isBuyingThis && (isBuyingWithEth || isConfirmingEthBuy)
                                        ? 'Buy...'
                                        : 'ETH'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ===== BONDED ITEMS TAB ===== */}
            {activeTab === 'items' && (
              <div className="absolute inset-0 flex overflow-hidden">
                {/* Sidebar Filters */}
                <div className="w-48 flex-shrink-0 border-r border-[rgba(255,255,255,0.08)] bg-[#171e1d]/50 overflow-y-auto">
                  <div className="p-3 space-y-4">
                    {/* Phase Filters */}
                    <div>
                      <p className="text-[#8a9090] text-[10px] uppercase tracking-wider mb-2">Filter</p>
                      <div className="space-y-1">
                        {(['all', 'presale', 'trading', 'owned'] as const).map((filter) => (
                          <button
                            key={filter}
                            onClick={() => setItemFilter(filter)}
                            className={`w-full px-3 py-2 rounded-lg text-xs font-medium text-left transition-all ${
                              itemFilter === filter
                                ? filter === 'presale' ? 'bg-yellow-600 text-white'
                                  : filter === 'trading' ? 'bg-green-600 text-white'
                                  : filter === 'owned' ? 'bg-[#a68b5b] text-white'
                                  : 'bg-[#2a3533] text-white'
                                : 'bg-[#1a2221]/50 text-[#8a9090] hover:bg-[#1f2827]'
                            }`}
                          >
                            {filter === 'all' && `🏠 All (${bondedItems.length})`}
                            {filter === 'presale' && `🎯 Presale (${presaleItems.length})`}
                            {filter === 'trading' && `📈 Trading (${tradingItems.length})`}
                            {filter === 'owned' && `💰 Owned (${ownedItems.filter(i => i.phase !== 3).length})`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Category Filters */}
                    <div>
                      <p className="text-[#8a9090] text-[10px] uppercase tracking-wider mb-2">Category</p>
                      <div className="space-y-1">
                        {ITEM_CATEGORIES.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => setItemCategory(cat.id)}
                            className={`w-full px-2 py-1.5 rounded text-[11px] font-medium text-left transition-all ${
                              itemCategory === cat.id
                                ? 'bg-[#a68b5b] text-white'
                                : 'bg-[#1a2221]/50 text-[#8a9090] hover:bg-[#1f2827]'
                            }`}
                          >
                            {cat.label} {categoryCounts[cat.id] > 0 && cat.id !== 'all' ? `(${categoryCounts[cat.id]})` : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Sort */}
                    <div>
                      <p className="text-[#8a9090] text-[10px] uppercase tracking-wider mb-2">Sort</p>
                      <select
                        value={itemSort}
                        onChange={(e) => setItemSort(e.target.value as 'price-asc' | 'price-desc' | 'volume-high')}
                        className="w-full px-2 py-1.5 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded text-white text-xs focus:outline-none focus:border-[rgba(255,208,117,0.4)]"
                      >
                        <option value="volume-high">Volume ↓</option>
                        <option value="price-asc">Price ↑</option>
                        <option value="price-desc">Price ↓</option>
                      </select>
                    </div>

                    {/* Refresh */}
                    <button
                      onClick={() => refetchItems()}
                      className="w-full px-3 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-lg text-[#cecece] hover:bg-[#1f2827] text-xs"
                    >
                      🔄 Refresh
                    </button>

                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col overflow-hidden">

                {/* Trait Editor Sub-Header - Always visible when user has bridged items */}
                {totalBridgedItems > 0 && (
                  <div className="flex-shrink-0 px-4 py-3 bg-gradient-to-r from-[rgba(255,208,117,0.08)] to-[rgba(197,169,123,0.08)] border-b border-[rgba(255,208,117,0.2)]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[#ffd075] font-medium">🌉 Trait Editor</span>
                        <div className="flex items-center gap-1">
                          {Object.entries(bridgedBalance).slice(0, 6).map(([tokenId, amount]) => {
                            const item = bondedItems.find(i => i.tokenId.toString() === tokenId);
                            return (
                              <div key={tokenId} className="relative">
                                <img
                                  src={item?.imageUrl || `https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i/images/${tokenId}.png`}
                                  alt={item?.name || `#${tokenId}`}
                                  className="w-8 h-8 rounded object-cover border border-[rgba(255,208,117,0.3)]"
                                />
                                <span className="absolute -top-1 -right-1 bg-[#a68b5b] text-white text-[8px] px-1 rounded-full">{amount}</span>
                              </div>
                            );
                          })}
                          {Object.keys(bridgedBalance).length > 6 && (
                            <div className="w-8 h-8 rounded bg-[#1f2827] flex items-center justify-center text-[10px] text-[#8a9090]">
                              +{Object.keys(bridgedBalance).length - 6}
                            </div>
                          )}
                        </div>
                        <span className="text-[#8a9090] text-sm">({totalBridgedItems} items ready)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            try {
                              const result = await fulfilBridge();
                              if (result.success) {
                                refetchItems();
                              }
                            } catch (err) {
                              console.error('Claim failed:', err);
                            }
                          }}
                          disabled={isBridgePending || !canFulfil}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            canFulfil
                              ? 'bg-[rgba(34,197,94,0.12)] border border-[#22c55e]/50 text-green-300 hover:bg-[rgba(34,197,94,0.18)]'
                              : 'bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)]/30 text-[#8a9090]'
                          } disabled:opacity-50`}
                        >
                          {isBridgePending ? '⏳ Claiming...' : canFulfil ? '✨ Claim Items' : `⏳ ${fulfilCooldown}s`}
                        </button>
                        <button
                          onClick={() => {
                            setActiveTab('collection');
                          }}
                          className="px-4 py-2 rounded-lg text-sm font-medium bg-[rgba(255,208,117,0.12)] border border-[rgba(255,208,117,0.3)] text-[#c5a97b] hover:bg-[#c5a97b]/30 transition-all"
                        >
                          ✨ Edit NFT
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Items Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                  {itemsLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[rgba(255,208,117,0.5)] mx-auto mb-4"></div>
                        <p className="text-[#8a9090]">Loading items...</p>
                      </div>
                    </div>
                  ) : displayedItems.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <span className="text-5xl mb-4 block">📦</span>
                        <h2 className="text-xl font-bold text-white mb-2">
                          {itemFilter === 'owned' ? 'No Items Owned' : 'No Items Found'}
                        </h2>
                        <p className="text-[#8a9090] text-sm">
                          {itemFilter === 'presale' && 'No items currently in presale'}
                          {itemFilter === 'trading' && 'No items trading on bonding curves'}
                          {itemFilter === 'owned' && 'Buy some items to see them here!'}
                          {itemFilter === 'all' && itemCategory !== 'all' && 'No items match this category'}
                          {itemFilter === 'all' && itemCategory === 'all' && 'Items are being initialized...'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {displayedItems.map((item) => {
                        const isPresale = item.phase === TokenPhase.Presale;
                        const isCurve = item.phase === TokenPhase.BondingCurve;
                        const isRare = item.phase === TokenPhase.RareItem;
                        const canBuy = isPresale || isCurve;
                        const canSell = isCurve && item.userBalance > 0n;
                        const phaseColor = isPresale ? 'yellow' : isCurve ? 'green' : 'purple';

                        return (
                          <div
                            key={item.tokenId.toString()}
                            className="rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
                            style={{ background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(31, 41, 55, 0.9))', border: `1px solid rgba(${isPresale ? '234, 179, 8' : isCurve ? '34, 197, 94' : '168, 85, 247'}, 0.3)` }}
                          >
                            {/* Item Image */}
                            <div className="relative aspect-square bg-gradient-to-br from-[#1f2827] to-[#1a2221]">
                              <img
                                src={item.imageUrl || `https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i/images/${item.tokenId.toString()}.png`}
                                alt={item.name || `Item #${item.tokenId.toString()}`}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  // Fallback to emoji if image fails
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  target.parentElement!.innerHTML = `<span class="text-5xl flex items-center justify-center h-full">${isPresale ? '🎯' : isCurve ? '📈' : '💎'}</span>`;
                                }}
                              />
                              <div className={`absolute top-2 left-2 px-2 py-1 rounded text-[10px] font-medium ${
                                isPresale ? 'bg-yellow-500/30 text-yellow-400 border border-yellow-500/50' :
                                isCurve ? 'bg-green-500/30 text-[#22c55e] border border-[#22c55e]/50' :
                                'bg-[#ffd075]/30 text-[#ffd075] border border-[rgba(255,208,117,0.3)]'
                              }`}>
                                {item.phaseName}
                              </div>
                              {item.userBalance > 0n && (
                                <div className="absolute top-2 right-2 px-2 py-1 bg-[#a68b5b] rounded text-[10px] text-white font-medium">
                                  x{item.userBalance.toString()}
                                </div>
                              )}
                            </div>

                            <div className="p-3">
                              <p className="text-white font-medium text-sm">{item.name || `Item #${item.tokenId}`}</p>
                              <p className="text-[#6b7575] text-[10px]">#{item.tokenId.toString()}</p>

                              {/* Progress bar for presale */}
                              {isPresale && (
                                <div className="mt-2">
                                  <div className="flex justify-between text-[10px] mb-1">
                                    <span className="text-[#8a9090]">Progress</span>
                                    <span className="text-yellow-400">{item.presaleProgress}%</span>
                                  </div>
                                  <div className="h-1 bg-[#1f2827] rounded-full overflow-hidden">
                                    <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${item.presaleProgress}%` }} />
                                  </div>
                                </div>
                              )}

                              {/* Price */}
                              <div className="mt-2">
                                <p className="text-[#6b7575] text-[10px]">Price</p>
                                <p className={`font-bold text-sm ${isPresale ? 'text-yellow-400' : isCurve ? 'text-[#22c55e]' : 'text-[#ffd075]'}`}>{formatItemPrice(item.currentPrice, 4)} wASS</p>
                              </div>

                              {/* Curve liquidity */}
                              {isCurve && item.curve && (
                                <div className="mt-1 text-[10px] text-[#8a9090]">
                                  Liquidity: {item.curve.realWassFormatted} wASS
                                </div>
                              )}

                              {/* Actions */}
                              <div className="flex gap-2 mt-3">
                                {canBuy && (
                                  <button
                                    onClick={() => { setSelectedBondedItem(item); setItemAction('buy'); setItemAmount('1'); }}
                                    className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                                    style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))', color: 'white' }}
                                  >
                                    Buy
                                  </button>
                                )}
                                {canSell && (
                                  <button
                                    onClick={() => { setSelectedBondedItem(item); setItemAction('sell'); setItemAmount('1'); }}
                                    className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                                    style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.8), rgba(220, 38, 38, 0.8))', color: 'white' }}
                                  >
                                    Sell
                                  </button>
                                )}
                                {isRare && (
                                  <button disabled className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-[#1f2827] text-[#8a9090] cursor-not-allowed">
                                    P2P Only
                                  </button>
                                )}
                              </div>
                              {/* Bridge button for owned items - AUTO-FULFIL enabled */}
                              {item.userBalance > 0n && (
                                <button
                                  onClick={async () => {
                                    if (!canBridge) return;
                                    try {
                                      // bridgeIn now auto-handles: approval → deposit → fulfil
                                      console.log('[ItemBridge] Starting auto-fulfil bridge...');
                                      const txHash = await bridgeIn([Number(item.tokenId)], [1]);
                                      console.log('[ItemBridge] Bridge + Fulfil success:', txHash);
                                      refetchItems();
                                    } catch (err) {
                                      console.error('Bridge in failed:', err);
                                    }
                                  }}
                                  disabled={isBridgePending || !canBridge}
                                  className="w-full mt-2 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                  style={{ background: 'linear-gradient(135deg, rgba(197, 169, 123, 0.8), rgba(139, 114, 69, 0.8))', color: 'white' }}
                                >
                                  {isBridgePending ? '⏳ Bridging...' : '🌉 Bridge to Editor'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Item Buy/Sell Modal */}
                {selectedBondedItem && itemAction && (
                  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeItemModal}>
                    <div
                      className="rounded-2xl w-full max-w-sm relative"
                      style={{
                        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98), rgba(31, 41, 55, 0.98))',
                        border: `2px solid rgba(${itemAction === 'buy' ? '34, 197, 94' : '239, 68, 68'}, 0.3)`,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="rounded-t-2xl p-4" style={{ background: `linear-gradient(135deg, rgba(${itemAction === 'buy' ? '34, 197, 94' : '239, 68, 68'}, 0.3), rgba(255, 208, 117, 0.3))` }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Item preview image instead of emoji */}
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-[#1a2221]/50 border border-[rgba(255,255,255,0.08)]">
                              <img
                                src={selectedBondedItem.imageUrl || `https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i/images/${selectedBondedItem.tokenId}.png`}
                                alt={selectedBondedItem.name || `Item #${selectedBondedItem.tokenId}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div>
                              <h2 className="font-bold text-lg text-white">{itemAction === 'buy' ? (selectedBondedItem.phase === TokenPhase.Presale ? 'Buy Presale' : 'Buy from Curve') : 'Sell to Curve'}</h2>
                              <p className={`text-sm ${itemAction === 'buy' ? 'text-green-200' : 'text-red-200'}`}>{selectedBondedItem.name || `Item #${selectedBondedItem.tokenId}`}</p>
                            </div>
                          </div>
                          <button onClick={closeItemModal} className={`${itemAction === 'buy' ? 'text-green-300 hover:text-green-200' : 'text-red-300 hover:text-red-200'} text-xl`}>✕</button>
                        </div>
                      </div>

                      <div className="p-4">
                        {/* Payment Method Selector - Only for Buy */}
                        {itemAction === 'buy' && (
                          <div className="mb-4">
                            <p className="text-[#8a9090] text-sm mb-2">Payment Method</p>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => setItemPaymentMethod('wass')}
                                className={`p-3 rounded-lg border-2 transition-all ${itemPaymentMethod === 'wass' ? 'border-[#22c55e] bg-green-900/30' : 'border-[rgba(255,255,255,0.08)] bg-[#1a2221]/50'}`}
                              >
                                <div className="flex items-center justify-center gap-2">
                                  <img src="/Images/Token.png" alt="wASS" className="w-5 h-5" />
                                  <span className="font-bold text-white">wASS</span>
                                </div>
                                <p className="text-xs text-[#8a9090] mt-1">{parseFloat(wassBalanceFormatted).toFixed(2)} available</p>
                              </button>
                              <button
                                onClick={() => setItemPaymentMethod('eth')}
                                className={`p-3 rounded-lg border-2 transition-all ${itemPaymentMethod === 'eth' ? 'border-[rgba(255,208,117,0.4)] bg-[rgba(255,208,117,0.08)]' : 'border-[rgba(255,255,255,0.08)] bg-[#1a2221]/50'}`}
                              >
                                <div className="flex items-center justify-center gap-2">
                                  <img src="/Images/Ether.png" alt="ETH" className="w-5 h-5" />
                                  <span className="font-bold text-white">ETH</span>
                                </div>
                                <p className="text-xs text-[#8a9090] mt-1">{ethBalance ? parseFloat(formatEther(ethBalance.value)).toFixed(4) : '0'} available</p>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Item Info - Price formatting fix applied */}
                        <div className="mb-4 p-3 bg-[#171e1d]/50 rounded-lg">
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-[#8a9090]">Phase</span>
                            <span className={`font-medium ${selectedBondedItem.phase === TokenPhase.Presale ? 'text-yellow-400' : 'text-[#22c55e]'}`}>{selectedBondedItem.phaseName}</span>
                          </div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-[#8a9090]">Price per Item</span>
                            <span className="text-white">{formatItemPrice(selectedBondedItem.currentPrice, 4)} wASS</span>
                          </div>
                          {selectedBondedItem.phase === TokenPhase.Presale && (
                            <div className="flex justify-between text-sm">
                              <span className="text-[#8a9090]">Remaining</span>
                              <span className="text-white">{selectedBondedItem.presaleRemaining.toString()} / {selectedBondedItem.presaleSupply.toString()}</span>
                            </div>
                          )}
                          {itemAction === 'sell' && (
                            <div className="flex justify-between text-sm">
                              <span className="text-[#8a9090]">Your Balance</span>
                              <span className="text-white">{selectedBondedItem.userBalance.toString()} items</span>
                            </div>
                          )}
                        </div>

                        {/* Pool Info - Only for Bonding Curve items */}
                        {selectedBondedItem.phase === TokenPhase.BondingCurve && curveInfo && (
                          <div className="mb-4 p-3 bg-[rgba(255,208,117,0.06)] border border-[rgba(255,208,117,0.5)]/30 rounded-lg">
                            <p className="text-[#c5a97b] text-xs font-semibold mb-2">📊 Pool Info</p>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-[#6b7575]">Available</span>
                                <p className="text-white font-medium">{curveInfo.tokensAvailableFormatted} items</p>
                              </div>
                              <div>
                                <span className="text-[#6b7575]">Sold</span>
                                <p className="text-white font-medium">{curveInfo.tokensSoldFormatted} items</p>
                              </div>
                              <div>
                                <span className="text-[#6b7575]">Liquidity</span>
                                <p className="text-white font-medium">{curveInfo.realWassFormatted} wASS</p>
                              </div>
                              <div>
                                <span className="text-[#6b7575]">Volume</span>
                                <p className="text-white font-medium">{curveInfo.totalVolumeFormatted} wASS</p>
                              </div>
                              <div>
                                <span className="text-[#6b7575]">Trades</span>
                                <p className="text-white font-medium">{curveInfo.totalTrades.toString()}</p>
                              </div>
                              <div className="col-span-2">
                                <span className="text-[#6b7575]">Curve Price (full precision)</span>
                                <p className="text-white font-medium text-[10px] break-all">{formatItemPrice(curveInfo.currentPrice, 18)} wASS</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Amount Input */}
                        <div className="mb-4">
                          <label className="block text-[#8a9090] text-sm mb-2">Amount to {itemAction === 'buy' ? 'Buy' : 'Sell'}</label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              value={itemAmount}
                              onChange={(e) => setItemAmount(e.target.value)}
                              min="1"
                              max={itemAction === 'sell' ? selectedBondedItem.userBalance.toString() : (selectedBondedItem.phase === TokenPhase.Presale ? selectedBondedItem.presaleRemaining.toString() : '1000')}
                              className={`flex-1 bg-[#1a2221]/50 border ${itemAction === 'buy' ? 'border-[rgba(34,197,94,0.2)] focus:border-[#22c55e]' : 'border-red-500/30 focus:border-red-500'} rounded-lg px-4 py-3 text-white text-lg focus:outline-none`}
                            />
                            <div className="flex gap-1">
                              {['1', '5', '10'].map((qty) => (
                                <button key={qty} onClick={() => setItemAmount(qty)} className="px-3 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-lg text-[#cecece] hover:bg-[#1f2827] text-sm">
                                  {qty}
                                </button>
                              ))}
                              {itemAction === 'sell' && (
                                <button onClick={() => setItemAmount(selectedBondedItem.userBalance.toString())} className="px-3 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-lg text-[#cecece] hover:bg-[#1f2827] text-sm">
                                  Max
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Cost Summary - Use accurate quote for curve, simple math for presale */}
                        <div className="mb-4 p-3 bg-[#171e1d]/50 rounded-lg">
                          {itemAction === 'buy' ? (
                            <>
                              {/* For presale: simple price × amount, for curve: use actual quote */}
                              {selectedBondedItem.phase === TokenPhase.Presale ? (
                                <div className="flex justify-between text-sm font-bold">
                                  <span className="text-white">Total Cost</span>
                                  <span className="text-[#22c55e]">
                                    {formatWass(selectedBondedItem.presalePrice * BigInt(parseInt(itemAmount) || 0), 4)} wASS
                                  </span>
                                </div>
                              ) : buyQuote ? (
                                <>
                                  <div className="flex justify-between text-sm font-bold">
                                    <span className="text-white">Total Cost</span>
                                    <span className="text-[#22c55e]">{buyQuote.totalCostFormatted} wASS</span>
                                  </div>
                                  <div className="flex justify-between text-xs mt-1 text-[#6b7575]">
                                    <span>Base cost</span>
                                    <span>{buyQuote.wassCostFormatted} wASS</span>
                                  </div>
                                  <div className="flex justify-between text-xs text-[#6b7575]">
                                    <span>Fee ({(buyQuote.feeBps / 100).toFixed(1)}%)</span>
                                    <span>{buyQuote.feeFormatted} wASS</span>
                                  </div>
                                  {buyQuote.priceImpact > 1 && (
                                    <div className="flex justify-between text-xs mt-1 text-yellow-400">
                                      <span>Price Impact</span>
                                      <span>+{buyQuote.priceImpact.toFixed(2)}%</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between text-xs text-[#6b7575]">
                                    <span>New price after buy</span>
                                    <span>{formatItemPrice(buyQuote.newPrice, 4)} wASS</span>
                                  </div>
                                </>
                              ) : (
                                <div className="flex justify-between text-sm font-bold">
                                  <span className="text-white">Total Cost</span>
                                  <span className="text-[#6b7575]">Loading...</span>
                                </div>
                              )}
                            </>
                          ) : (
                            /* Sell - use sellQuote */
                            sellQuote ? (
                              <>
                                <div className="flex justify-between text-sm font-bold">
                                  <span className="text-white">You Receive</span>
                                  <span className="text-[#22c55e]">{sellQuote.netReturnFormatted} wASS</span>
                                </div>
                                <div className="flex justify-between text-xs mt-1 text-[#6b7575]">
                                  <span>Gross return</span>
                                  <span>{sellQuote.wassReturnFormatted} wASS</span>
                                </div>
                                <div className="flex justify-between text-xs text-[#6b7575]">
                                  <span>Fee ({(sellQuote.feeBps / 100).toFixed(1)}%)</span>
                                  <span>-{sellQuote.feeFormatted} wASS</span>
                                </div>
                                {sellQuote.priceImpact > 1 && (
                                  <div className="flex justify-between text-xs mt-1 text-yellow-400">
                                    <span>Price Impact</span>
                                    <span>-{sellQuote.priceImpact.toFixed(2)}%</span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="flex justify-between text-sm font-bold">
                                <span className="text-white">You Receive</span>
                                <span className="text-[#6b7575]">Loading...</span>
                              </div>
                            )
                          )}
                          {itemAction === 'buy' && itemPaymentMethod === 'eth' && (
                            <div className="flex justify-between text-xs mt-2 text-[#ffd075]">
                              <span>Paid via OTC Router</span>
                              <span>Auto-swap ETH → wASS</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs mt-2">
                            <span className="text-[#6b7575]">Your {itemPaymentMethod === 'wass' ? 'wASS' : 'ETH'} Balance</span>
                            <span className={
                              itemPaymentMethod === 'wass'
                                ? (Number(wassBalance) >= Number(
                                    itemAction === 'buy'
                                      ? (selectedBondedItem.phase === TokenPhase.Presale
                                          ? selectedBondedItem.presalePrice * BigInt(parseInt(itemAmount) || 0)
                                          : buyQuote?.totalCost ?? 0n)
                                      : 0n
                                  ) ? 'text-[#8a9090]' : 'text-[#FF3B5C]')
                                : 'text-[#8a9090]'
                            }>
                              {itemPaymentMethod === 'wass' ? `${wassBalanceFormatted} wASS` : `${ethBalance ? parseFloat(formatEther(ethBalance.value)).toFixed(4) : '0'} ETH`}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={async () => {
                            const amount = parseInt(itemAmount) || 0;
                            if (amount <= 0) return;
                            try {
                              if (itemAction === 'buy') {
                                if (itemPaymentMethod === 'wass') {
                                  // Pay with wASS
                                  if (selectedBondedItem.phase === TokenPhase.Presale) {
                                    await buyPresaleWithWass(Number(selectedBondedItem.tokenId), amount, selectedBondedItem.presalePrice);
                                  } else {
                                    // V3: buyFromCurve(tokenId, tokenAmount, maxWassIn)
                                    // Use ACTUAL QUOTE for accurate pricing on bonding curves
                                    const tokenAmount = BigInt(amount);
                                    if (!buyQuote) throw new Error('Quote not available');
                                    const maxWassIn = (buyQuote.totalCost * 110n) / 100n; // 10% slippage on actual quote
                                    await buyFromCurve(Number(selectedBondedItem.tokenId), tokenAmount, maxWassIn);
                                  }
                                } else {
                                  // Pay with ETH - get quote first
                                  const tokenAmount = BigInt(amount);
                                  // Use actual quote for curve, simple calc for presale
                                  const wassNeeded = selectedBondedItem.phase === TokenPhase.Presale
                                    ? selectedBondedItem.presalePrice * tokenAmount
                                    : (buyQuote?.totalCost ?? 0n);
                                  const maxWassIn = (wassNeeded * 110n) / 100n; // 10% slippage
                                  const { ethNeeded, minWassOut } = await quoteEthForWassAmount(maxWassIn);
                                  if (selectedBondedItem.phase === TokenPhase.Presale) {
                                    await buyPresaleWithEth(Number(selectedBondedItem.tokenId), amount, ethNeeded, minWassOut);
                                  } else {
                                    // V3: buyFromCurveWithEth(tokenId, ethAmount, tokenAmount, minWassFromSwap)
                                    await buyFromCurveWithEth(Number(selectedBondedItem.tokenId), ethNeeded, tokenAmount, minWassOut);
                                  }
                                }
                              } else {
                                // Sell: use actual quote for accurate minWassOut
                                if (!sellQuote) throw new Error('Quote not available');
                                const minWassOut = (sellQuote.netReturn * 90n) / 100n; // 10% slippage on actual quote
                                await sellToCurve(Number(selectedBondedItem.tokenId), BigInt(amount), minWassOut);
                              }
                              // Success - close modal and refresh
                              closeItemModal();
                              refetchItems();
                              refetchWassBalance();
                            } catch (err) {
                              console.error('Item transaction failed:', err);
                              // Reset hook states on error so user can try again
                              resetPresale();
                              resetPresaleEth();
                              resetCurveBuy();
                              resetCurveEth();
                              resetCurveSell();
                            }
                          }}
                          disabled={
                            isPresaleBuying || isPresaleBuyingEth || isCurveBuying || isCurveBuyingEth || isCurveSelling || isPresaleApproving || isCurveApproving || isSellApproving ||
                            (parseInt(itemAmount) || 0) <= 0 ||
                            // For curve items, wait for quote; for presale, use simple calc
                            (itemAction === 'buy' && selectedBondedItem.phase === TokenPhase.BondingCurve && !buyQuote) ||
                            (itemAction === 'sell' && !sellQuote) ||
                            (itemAction === 'buy' && itemPaymentMethod === 'wass' && Number(wassBalance) < Number(
                              selectedBondedItem.phase === TokenPhase.Presale
                                ? selectedBondedItem.presalePrice * BigInt(parseInt(itemAmount) || 0)
                                : buyQuote?.totalCost ?? 0n
                            )) ||
                            (itemAction === 'sell' && BigInt(parseInt(itemAmount) || 0) > selectedBondedItem.userBalance)
                          }
                          className="w-full py-3 rounded-lg font-semibold disabled:opacity-50"
                          style={{ background: `linear-gradient(135deg, rgba(${itemAction === 'buy' ? '34, 197, 94' : '239, 68, 68'}, 0.8), rgba(${itemAction === 'buy' ? '22, 163, 74' : '220, 38, 38'}, 0.8))`, color: 'white' }}
                        >
                          {isPresaleBuying || isPresaleBuyingEth || isCurveBuying || isCurveBuyingEth || isCurveSelling ? 'Processing...' : isPresaleApproving || isCurveApproving || isSellApproving ? 'Approving...' : itemAction === 'buy' ? `Buy with ${itemPaymentMethod === 'wass' ? 'wASS' : 'ETH'}` : `Sell ${itemAmount} Item${parseInt(itemAmount) > 1 ? 's' : ''}`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}

            {/* ===== NFT EXCHANGE TAB - Two Sub-tabs ===== */}
            {activeTab === 'exchange' && (
              <div className="absolute inset-0 flex flex-col overflow-hidden">
                {/* Sub-tab Navigation */}
                <div className="flex-shrink-0 border-b border-[rgba(255,255,255,0.08)] px-4 bg-[#171e1d]/50">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setExchangeSubTab('pool')}
                      className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
                        exchangeSubTab === 'pool'
                          ? 'border-orange-500 text-[#f9690e]'
                          : 'border-transparent text-[#8a9090] hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <img src="/Images/MountianGuyHead.png" alt="NFT" className="w-4 h-4" />
                        Swap NFT ↔ Pool
                      </span>
                    </button>
                    <button
                      onClick={() => setExchangeSubTab('wass')}
                      className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
                        exchangeSubTab === 'wass'
                          ? 'border-[rgba(255,208,117,0.4)] text-[#ffd075]'
                          : 'border-transparent text-[#8a9090] hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                        Swap NFT ↔ $wASS
                      </span>
                    </button>
                  </div>
                </div>

                {/* Sub-tab Content */}
                <div className="flex-1 overflow-hidden">
                  {exchangeSubTab === 'pool' ? (
                    /* ===== POOL SWAP - Original SwapWrapModal ===== */
                    <SwapWrapModal
                      isOpen={true}
                      onClose={() => setActiveTab('collection')}
                      initialMode="wrap"
                      embedded={true}
                      swapOnly={true}
                      filterType={filterType}
                      searchQuery={searchQuery}
                      gridSize={gridSize}
                    />
                  ) : (
                    /* ===== WASS SWAP - Wrap/Unwrap Interface (Tabbed) ===== */
                    <div className="h-full flex flex-col">
                      {/* Header with mode toggle */}
                      <div className="flex-shrink-0 p-4 border-b border-[rgba(255,255,255,0.08)]">
                        <div className="max-w-xl mx-auto">
                          {/* Mode Toggle Tabs */}
                          <div className="flex bg-[#1a2221] rounded-xl p-1 mb-3">
                            <button
                              onClick={() => setWassMode('unwrap')}
                              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                                wassMode === 'unwrap'
                                  ? 'bg-[#ffd075] text-white shadow-lg'
                                  : 'text-[#8a9090] hover:text-white'
                              }`}
                            >
                              <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                              Unwrap → NFT
                            </button>
                            <button
                              onClick={() => setWassMode('wrap')}
                              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                                wassMode === 'wrap'
                                  ? 'bg-[#c5a97b] text-white shadow-lg'
                                  : 'text-[#8a9090] hover:text-white'
                              }`}
                            >
                              <img src="/Images/MountianGuyHead.png" alt="NFT" className="w-4 h-4" />
                              Wrap → $wASS
                            </button>
                          </div>

                          {/* Balance & Fee Info Row */}
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                              <span className="text-[#8a9090]">Balance:</span>
                              <span className="text-white font-bold">
                                {wTokenBalance ? parseFloat(formatUnits(wTokenBalance as bigint, 18)).toFixed(2) : '0.00'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                              <span className="text-[#8a9090]">Fee:</span>
                              <span className="text-[#f9690e] font-medium">{parseFloat(wrapFeeFormatted).toFixed(4)}/NFT</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Content Area */}
                      <div className="flex-1 overflow-hidden p-4">
                        <div className="max-w-xl mx-auto h-full flex flex-col">
                          {wassMode === 'unwrap' ? (
                            /* ===== UNWRAP MODE ===== */
                            <div className="flex-1 flex flex-col">
                              {/* How it works - compact */}
                              <div className="bg-[#ffd075]/10 border border-[rgba(255,208,117,0.5)]/20 rounded-lg p-3 mb-4">
                                <p className="text-xs text-[#8a9090]">
                                  <span className="text-[#ffd075] font-medium">Unwrap:</span> Burn $wASS tokens to receive NFTs from the pool (FIFO order)
                                </p>
                              </div>

                              {/* Amount Selector */}
                              <div className="bg-[#1a2221]/50 rounded-xl p-4 border border-[rgba(255,255,255,0.08)] mb-4">
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-[#8a9090] text-sm">Amount to unwrap</span>
                                  <span className="text-[#6b7575] text-xs">
                                    Max: {wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 0}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => setUnwrapAmount(Math.max(1, unwrapAmount - 1))}
                                    disabled={unwrapAmount <= 1}
                                    className="w-10 h-10 rounded-lg bg-[#1f2827] text-white font-bold text-lg hover:bg-[#2a3533] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    max={wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 1}
                                    value={unwrapAmount}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value) || 1;
                                      const max = wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 1;
                                      setUnwrapAmount(Math.min(Math.max(1, val), Math.max(1, max)));
                                    }}
                                    className="flex-1 h-10 text-center bg-[#1a2221] border border-[rgba(255,255,255,0.08)] rounded-lg text-white font-bold text-xl focus:outline-none focus:border-[rgba(255,208,117,0.4)]"
                                  />
                                  <button
                                    onClick={() => {
                                      const max = wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 1;
                                      setUnwrapAmount(Math.min(unwrapAmount + 1, Math.max(1, max)));
                                    }}
                                    disabled={!wTokenBalance || unwrapAmount >= Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18)))}
                                    className="w-10 h-10 rounded-lg bg-[#1f2827] text-white font-bold text-lg hover:bg-[#2a3533] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    +
                                  </button>
                                  <button
                                    onClick={() => {
                                      const max = wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 1;
                                      setUnwrapAmount(Math.max(1, max));
                                    }}
                                    disabled={!wTokenBalance || parseFloat(formatUnits(wTokenBalance as bigint, 18)) < 1}
                                    className="px-4 h-10 rounded-lg bg-[rgba(255,208,117,0.12)] text-[#ffd075] font-medium hover:bg-[rgba(255,208,117,0.9)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Max
                                  </button>
                                </div>
                              </div>

                              {/* Cost Summary */}
                              <div className="bg-[#1a2221]/30 rounded-xl p-4 border border-[rgba(255,255,255,0.08)] mb-4">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[#8a9090]">You pay</span>
                                  <div className="flex items-center gap-2">
                                    <img src="/Images/Token.png" alt="wASS" className="w-5 h-5" />
                                    <span className="text-white font-bold text-lg">{unwrapAmount} $wASS</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[#8a9090]">+ Fee</span>
                                  <div className="flex items-center gap-2">
                                    <img src="/Images/Ether.png" alt="ETH" className="w-4 h-4" />
                                    <span className="text-[#f9690e] font-medium">{parseFloat(formatEther(wrapFee * BigInt(unwrapAmount))).toFixed(4)} ETH</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.08)]">
                                  <span className="text-[#cecece] font-medium">You receive</span>
                                  <div className="flex items-center gap-2">
                                    <img src="/Images/MountianGuyHead.png" alt="NFT" className="w-5 h-5" />
                                    <span className="text-[#ffd075] font-bold text-lg">{unwrapAmount} NFT{unwrapAmount !== 1 ? 's' : ''}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Unwrap Button */}
                              <button
                                onClick={async () => {
                                  const balance = wTokenBalance ? parseFloat(formatUnits(wTokenBalance as bigint, 18)) : 0;
                                  if (balance < unwrapAmount) return;

                                  await writeContractAsync({
                                    address: contracts.wrapper.address,
                                    abi: contracts.wrapper.abi,
                                    functionName: 'unwrapNFTs',
                                    args: [contracts.nft.address, BigInt(unwrapAmount)],
                                    value: wrapFee * BigInt(unwrapAmount),
                                  });
                                  refetchNFTs();
                                }}
                                disabled={!wTokenBalance || parseFloat(formatUnits(wTokenBalance as bigint, 18)) < unwrapAmount || isWritePending || isBatchPending}
                                className={`w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                                  !wTokenBalance || parseFloat(formatUnits(wTokenBalance as bigint, 18)) < unwrapAmount || isWritePending || isBatchPending
                                    ? 'bg-[#1f2827] text-[#8a9090] cursor-not-allowed'
                                    : 'bg-gradient-to-r from-[#ffd075] to-[#c5a97b] text-[#0a0d0c] hover:from-[#c5a97b] hover:to-[#a68b5b] shadow-lg shadow-[rgba(255,208,117,0.2)]'
                                }`}
                              >
                                {isWritePending || isBatchPending ? (
                                  <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    Processing...
                                  </>
                                ) : !wTokenBalance || parseFloat(formatUnits(wTokenBalance as bigint, 18)) < 1 ? (
                                  <>Insufficient $wASS Balance</>
                                ) : (
                                  <>
                                    <img src="/Images/MountianGuyHead.png" alt="NFT" className="w-5 h-5" />
                                    Unwrap {unwrapAmount} NFT{unwrapAmount !== 1 ? 's' : ''}
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            /* ===== WRAP MODE ===== */
                            <div className="flex-1 flex flex-col">
                              {/* How it works - compact */}
                              <div className="bg-[#c5a97b]/10 border border-[rgba(255,208,117,0.4)]/20 rounded-lg p-3 mb-4">
                                <p className="text-xs text-[#8a9090]">
                                  <span className="text-[#ffd075] font-medium">Wrap:</span> Lock your NFTs in the wrapper contract and receive $wASS tokens
                                </p>
                              </div>

                              {/* NFT Grid */}
                              {isLoading ? (
                                <div className="flex-1 flex items-center justify-center">
                                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[rgba(255,208,117,0.4)]"></div>
                                </div>
                              ) : nfts.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center">
                                  <p className="text-[#8a9090] mb-3">No NFTs available to wrap</p>
                                  <button
                                    onClick={() => setExchangeSubTab('pool')}
                                    className="px-4 py-2 bg-[rgba(249,105,14,0.15)] text-[#f9690e] rounded-lg hover:bg-orange-500/30 transition-colors text-sm"
                                  >
                                    Get NFTs from Pool
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex-1 overflow-y-auto mb-4">
                                    <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-7 gap-2">
                                      {nfts.map((nft) => {
                                        const isSelected = selectedNFTs.has(nft.tokenId);
                                        return (
                                          <button
                                            key={nft.tokenId}
                                            onClick={() => {
                                              const newSelected = new Set(selectedNFTs);
                                              if (isSelected) {
                                                newSelected.delete(nft.tokenId);
                                              } else {
                                                newSelected.add(nft.tokenId);
                                              }
                                              setSelectedNFTs(newSelected);
                                            }}
                                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                              isSelected
                                                ? 'border-[rgba(255,208,117,0.4)] ring-2 ring-[rgba(255,208,117,0.3)] scale-95'
                                                : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,208,117,0.35)]'
                                            }`}
                                          >
                                            <img
                                              src={nft.imageUrl}
                                              alt={nft.name}
                                              className="w-full h-full object-cover"
                                            />
                                            {isSelected && (
                                              <div className="absolute inset-0 bg-[#c5a97b]/30 flex items-center justify-center">
                                                <div className="w-5 h-5 rounded-full bg-[#c5a97b] flex items-center justify-center">
                                                  <span className="text-white text-xs">✓</span>
                                                </div>
                                              </div>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Wrap Summary & Action */}
                                  <div className="flex-shrink-0 bg-[#1a2221]/50 rounded-xl p-4 border border-[rgba(255,255,255,0.08)]">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-3">
                                        <span className="text-white font-medium">{selectedNFTs.size} NFT{selectedNFTs.size !== 1 ? 's' : ''} selected</span>
                                        {selectedNFTs.size > 0 && (
                                          <button
                                            onClick={() => setSelectedNFTs(new Set())}
                                            className="text-xs text-[#8a9090] hover:text-white"
                                          >
                                            Clear
                                          </button>
                                        )}
                                      </div>
                                      {selectedNFTs.size > 0 && (
                                        <div className="flex items-center gap-2 text-sm">
                                          <span className="text-[#8a9090]">Fee:</span>
                                          <span className="text-[#f9690e] font-medium">{parseFloat(formatEther(wrapFee * BigInt(selectedNFTs.size))).toFixed(4)} ETH</span>
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={async () => {
                                        if (selectedNFTs.size === 0) return;
                                        const tokenIds = Array.from(selectedNFTs);
                                        const totalFee = wrapFee * BigInt(tokenIds.length);

                                        if (supportsAtomicBatch && !isWrapperApproved) {
                                          await executeBatch([
                                            {
                                              address: contracts.nft.address,
                                              abi: contracts.nft.abi,
                                              functionName: 'setApprovalForAll',
                                              args: [contracts.wrapper.address, true],
                                            },
                                            {
                                              address: contracts.wrapper.address,
                                              abi: contracts.wrapper.abi,
                                              functionName: 'wrapNFTs',
                                              args: [contracts.nft.address, tokenIds],
                                              value: totalFee,
                                            },
                                          ]);
                                        } else if (!isWrapperApproved) {
                                          await writeContractAsync({
                                            address: contracts.nft.address,
                                            abi: contracts.nft.abi,
                                            functionName: 'setApprovalForAll',
                                            args: [contracts.wrapper.address, true],
                                          });
                                          await refetchWrapperApproval();
                                        } else {
                                          await writeContractAsync({
                                            address: contracts.wrapper.address,
                                            abi: contracts.wrapper.abi,
                                            functionName: 'wrapNFTs',
                                            args: [contracts.nft.address, tokenIds],
                                            value: totalFee,
                                          });
                                        }
                                        setSelectedNFTs(new Set());
                                        refetchNFTs();
                                      }}
                                      disabled={selectedNFTs.size === 0 || isWritePending || isBatchPending || isBatchConfirming}
                                      className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                                        selectedNFTs.size === 0 || isWritePending || isBatchPending || isBatchConfirming
                                          ? 'bg-[#1f2827] text-[#8a9090] cursor-not-allowed'
                                          : 'bg-gradient-to-r from-[#c5a97b] to-[#a68b5b] text-white hover:from-[#a68b5b] hover:to-[#8b7245] shadow-lg shadow-[rgba(197,169,123,0.2)]'
                                      }`}
                                    >
                                      {isWritePending || isBatchPending || isBatchConfirming ? (
                                        <>
                                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                          Processing...
                                        </>
                                      ) : !isWrapperApproved && supportsAtomicBatch ? (
                                        <>⚡ Approve & Wrap {selectedNFTs.size} NFT{selectedNFTs.size !== 1 ? 's' : ''}</>
                                      ) : !isWrapperApproved ? (
                                        <>Approve Wrapper</>
                                      ) : (
                                        <>🪙 Wrap {selectedNFTs.size} NFT{selectedNFTs.size !== 1 ? 's' : ''} → {selectedNFTs.size} $wASS</>
                                      )}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== TRADING TAB - Chart and Trading Interface ===== */}
            {activeTab === 'trading' && (
              <div className="absolute inset-0 flex flex-col overflow-hidden">
                <ChartModal
                  isOpen={true}
                  onClose={() => setActiveTab('collection')}
                  embedded={true}
                  layout="horizontal"
                  onPairChange={setCurrentPoolAddress}
                  onSwapComplete={refetchTrades}
                  trades={poolTrades}
                  tradesLoading={tradesLoading}
                  selectedPairId={selectedPairId}
                  externalPairData={selectedPairData?.isTokenWars ? selectedPairData : undefined}
                  additionalPairs={chartModalAdditionalPairs}
                  externalPairChanges={allPairChanges}
                />
              </div>
            )}
          </main>
        </div>

        {/* Selection Action Bar - shown when NFTs are selected */}
        {selectedNFTs.size > 0 && (
          <div className="flex-shrink-0 border-t border-[rgba(255,255,255,0.06)] bg-[#171e1d]/95 backdrop-blur-xl px-4 md:px-6 py-4">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-4">
                <span className="text-white font-medium">
                  {selectedNFTs.size} NFT{selectedNFTs.size > 1 ? 's' : ''} selected
                </span>
                {selectedSnakes.length > 0 && selectedSnakes.length !== selectedNFTs.size && (
                  <span className="text-sm text-[#8a9090]">
                    ({selectedSnakes.length} snake{selectedSnakes.length > 1 ? 's' : ''})
                  </span>
                )}
                <button
                  onClick={clearSelections}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a2221] border border-[rgba(255,255,255,0.08)] text-[#8a9090] hover:text-white hover:bg-[#1f2827] hover:border-[rgba(255,208,117,0.15)] transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Clear</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Hatch Button - only visible when user has eggs */}
                {activeTab === 'collection' && selectedEggs.length > 0 && (
                  <button
                    onClick={handleHatch}
                    disabled={isProcessing}
                    className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing && currentOperation === 'wrap' ? 'Hatching...' : `🥚 Hatch ${selectedEggs.length}`}
                  </button>
                )}

                {/* Breed Button - requires exactly 3 humans */}
                {activeTab === 'collection' && (
                  <div className="relative flex items-center gap-2">
                    <button
                      onClick={selectedHumans.length === 3 ? () => {
                        openBreed();
                        setIsOpen(false);
                      } : undefined}
                      disabled={isProcessing || selectedHumans.length !== 3}
                      className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                        selectedHumans.length !== 3
                          ? 'bg-[#2a3533] text-[#8a9090] cursor-not-allowed'
                          : 'bg-gradient-to-r from-[#FF3B5C] to-[#e11d48] text-white hover:from-[#ff6b84] hover:to-[#FF3B5C] disabled:opacity-50 disabled:cursor-not-allowed'
                      }`}
                      title={selectedHumans.length !== 3 ? `Select exactly 3 humans to breed (${selectedHumans.length}/3)` : 'Breed 3 humans into an AppleSnake egg'}
                    >
                      🧬 Breed
                    </button>
                    <span className={`text-xs whitespace-nowrap ${
                      selectedHumans.length === 3 ? 'text-[#22c55e]' : 'text-[#8a9090]'
                    }`}>
                      {selectedHumans.length}/3 humans
                    </span>
                  </div>
                )}

                {/* Stake Button - grayed out if humans are selected, only enabled for snakes */}
                {activeTab === 'collection' && (
                  <button
                    onClick={hasHumansSelected || selectedForStake.length === 0 ? undefined : (!isApproved && supportsAtomicBatch ? handleApproveAndStake : (!isApproved ? handleApprove : handleStake))}
                    disabled={isProcessing || hasHumansSelected || selectedForStake.length === 0}
                    className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                      hasHumansSelected || selectedForStake.length === 0
                        ? 'bg-[#2a3533] text-[#8a9090] cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#ffd075] to-[#c5a97b] text-[#0a0d0c] hover:from-[#ffe0a0] hover:to-[#d4b88a] disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    title={hasHumansSelected ? 'Cannot stake humans - only snakes can be staked' : selectedForStake.length === 0 ? 'Select snakes to stake' : undefined}
                  >
                    {isProcessing && currentOperation === 'stake' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : !isApproved && selectedForStake.length > 0 && !hasHumansSelected ? (
                      '🔓 Approve & Stake'
                    ) : (
                      `⚡ Stake${selectedForStake.length > 0 ? ` ${selectedForStake.length}` : ''}`
                    )}
                  </button>
                )}

                {/* Unstake Actions (for staked NFTs in unified view) */}
                {activeTab === 'collection' && selectedForUnstake.length > 0 && (
                  <button
                    onClick={handleUnstake}
                    disabled={isProcessing}
                    className="px-6 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-[#ffd075] to-[#c5a97b] text-[#0a0d0c] hover:from-[#ffe0a0] hover:to-[#d4b88a] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isProcessing && currentOperation === 'unstake' ? 'Unstaking...' : `🔓 Unstake ${selectedForUnstake.length} Snake${selectedForUnstake.length > 1 ? 's' : ''}`}
                  </button>
                )}

                {/* List on Marketplace Button - when 1+ non-staked, non-jailed NFTs are selected */}
                {activeTab === 'collection' && selectedNFTs.size >= 1 && (() => {
                  // Filter to only listable NFTs (non-staked, non-jailed)
                  const listableNFTs = selectedNFTsData.filter(nft => !nft.isStaked && !nft.isJailed);
                  const listCount = listableNFTs.length;
                  return listCount > 0 ? (
                    <button
                      onClick={() => {
                        // For single NFT, use legacy single-nft flow; for multiple, pass array
                        if (listCount === 1) {
                          setSelectedNFTForListing(listableNFTs[0]);
                        } else {
                          setSelectedNFTForListing(null); // Clear single selection
                        }
                        setShowListingModal(true);
                      }}
                      disabled={isProcessing}
                      className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white hover:from-[#4ade80] hover:to-[#22c55e] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      🏪 List{listCount > 1 ? ` ${listCount}` : ''}
                    </button>
                  ) : null;
                })()}

                {/* Wrap Button - enabled when non-staked NFTs selected, warning for snakes */}
                <div className="relative flex items-center gap-2">
                  <button
                    onClick={!isWrapperApproved && !supportsAtomicBatch ? handleApproveWrapper : handleWrap}
                    disabled={isProcessing || selectedForWrap.length === 0}
                    className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                      selectedForWrap.length === 0
                        ? 'bg-[#2a3533] text-[#8a9090] cursor-not-allowed'
                        : selectedSnakes.length > 0
                          ? 'bg-gradient-to-r from-red-600 to-orange-500 text-white hover:from-red-500 hover:to-orange-400 ring-2 ring-red-500/50 disabled:opacity-50'
                          : 'bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white hover:from-[#4ade80] hover:to-[#22c55e] disabled:opacity-50'
                    }`}
                    title={selectedSnakes.length > 0 ? 'Warning: AppleSnakes are rare NFTs!' : undefined}
                  >
                    {isProcessing && currentOperation === 'wrap' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : !isWrapperApproved && selectedForWrap.length > 0 && !supportsAtomicBatch ? (
                      '🔓 Approve Wrap'
                    ) : (
                      <>
                        {selectedSnakes.length > 0 ? '⚠️' : '🎁'} Wrap{selectedForWrap.length > 0 ? ` ${selectedForWrap.length}` : ''}
                      </>
                    )}
                  </button>
                  {/* Wrap Fee Display */}
                  {selectedForWrap.length > 0 && (
                    <span className="text-xs text-[#f9690e] whitespace-nowrap flex items-center gap-1">
                      Fee: {parseFloat(formatEther(wrapFee * BigInt(selectedForWrap.length))).toFixed(4)}
                      <img src="/Images/Ether.png" alt="ETH" className="w-3 h-3" />
                    </span>
                  )}
                  {selectedSnakes.length > 0 && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-1 rounded bg-red-900/90 text-red-300 text-xs border border-red-500/50">
                      Snakes are rare NFTs!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Overlay */}
      {txOverlay && (
        <div className="fixed bottom-6 right-6 z-[60] animate-slide-up">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-xl transition-all ${
              txOverlay.status === 'pending'
                ? 'bg-[rgba(139,114,69,0.85)] border-[rgba(255,208,117,0.3)] text-[#ffd075]'
                : txOverlay.status === 'success'
                  ? 'bg-green-900/90 border-[#22c55e]/50 text-green-100'
                  : 'bg-red-900/90 border-red-500/50 text-red-100'
            }`}
          >
            {/* Status Icon */}
            {txOverlay.status === 'pending' ? (
              <div className="w-6 h-6 border-2 border-[rgba(255,208,117,0.4)] border-t-transparent rounded-full animate-spin" />
            ) : txOverlay.status === 'success' ? (
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            )}

            {/* Message */}
            <div className="flex-1">
              <p className="font-medium text-sm">{txOverlay.message}</p>
              <p className="text-xs opacity-70">
                {txOverlay.status === 'pending' ? 'Transaction pending...' : txOverlay.status === 'success' ? 'Transaction confirmed!' : 'Transaction failed'}
              </p>
            </div>

            {/* Basescan Link */}
            <a
              href={getBasescanUrl(txOverlay.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-2 rounded-lg transition-all ${
                txOverlay.status === 'pending'
                  ? 'bg-[#8b7245] hover:bg-[#8b7245]'
                  : txOverlay.status === 'success'
                    ? 'bg-green-800 hover:bg-green-700'
                    : 'bg-red-800 hover:bg-red-700'
              }`}
              title="View on Basescan"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>

            {/* Close Button */}
            <button
              onClick={() => setTxOverlay(null)}
              className="p-1 rounded hover:bg-white/10 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Buy from Pool Modal Popup */}
      <SwapWrapModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        initialMode="buy"
        buyOnly={true}
      />

      {/* Listing Modal for Marketplace */}
      <ListingModal
        nft={selectedNFTForListing}
        nfts={!selectedNFTForListing && showListingModal ? selectedNFTsData.filter(nft => !nft.isStaked && !nft.isJailed) : undefined}
        isOpen={showListingModal}
        onClose={() => {
          setShowListingModal(false);
          setSelectedNFTForListing(null);
        }}
        onSuccess={() => {
          setShowListingModal(false);
          setSelectedNFTForListing(null);
          clearSelections();
          refetchNFTs();
        }}
      />

      {/* Trait Swapper Modal */}
      {selectedNFTForTraits && (
        <TraitSwapper
          nft={selectedNFTForTraits as UserNFT}
          isOpen={showTraitSwapper}
          onClose={() => {
            setShowTraitSwapper(false);
            setSelectedNFTForTraits(null);
          }}
          onSuccess={() => {
            refetchNFTs();
          }}
        />
      )}

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
