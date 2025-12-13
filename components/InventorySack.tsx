'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useBalance, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useRouter } from 'next/navigation';
import { base } from 'wagmi/chains';
import { formatEther, formatUnits } from 'viem';
import { getContracts, getNFTMetadataUrl, getNFTImageUrl, QUOTER_ADDRESS, QUOTER_ABI, TOKEN_PAIRS, getDefaultPair, TokenPairConfig, ETH_ADDRESS, WASS_TOKEN_ADDRESS, getAllTokenAddresses } from '@/config';
import { useMultipleTokenInfo } from '@/hooks/useTokenInfo';
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
import { useWTokensNFTsCache } from '@/hooks/useWTokensNFTsCache';
import { parseEther } from 'viem';
import { SwapWrapModal } from './SwapWrapModal';
import { ChartModal } from './ChartModal';
import { VerifiedTokenLauncher } from './VerifiedTokenLauncher';
import { Clankerdome } from './Clankerdome';
import { usePoolTrades, formatRelativeTime, truncateAddress } from '@/hooks/usePoolTrades';

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
type TradingView = 'swap' | 'launch';
type LaunchTab = 'instant' | 'clankerdome';
type ExchangeSubTab = 'pool' | 'wass';

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
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showFilters, setShowFilters] = useState(true);
  const [gridSize, setGridSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [showBuyModal, setShowBuyModal] = useState(false);

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
  const { listings: openSeaListings, isLoading: listingsLoading, floorPrice, totalListings, refetch: refetchListings } = useOpenSeaListings(100);

  // wTokens pool NFTs for "Buy from Contract" option
  const { nfts: poolNFTs, isLoading: poolNFTsLoading } = useWTokensNFTsCache(false, false);

  // Current pool address for trade history (updated by ChartModal when pair changes)
  const [currentPoolAddress, setCurrentPoolAddress] = useState<string | undefined>(undefined);

  // Selected pair ID for sidebar (controls ChartModal's selected pair)
  const [selectedPairId, setSelectedPairId] = useState<string>(getDefaultPair().id);

  // Trading tab view mode - 'swap' for trading interface, 'launch' for token launcher
  const [tradingView, setTradingView] = useState<TradingView>('swap');

  // Launch tab view - 'instant' for VerifiedTokenLauncher, 'clankerdome' for 24-hour presale parties
  const [launchTab, setLaunchTab] = useState<LaunchTab>('instant');

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

  // Helper to get token symbol from address
  const getTokenSymbol = useCallback((address: `0x${string}`): string => {
    if (address === ETH_ADDRESS) return 'ETH';
    const info = tokenInfos.get(address.toLowerCase());
    return info?.symbol || `${address.slice(0, 6)}...`;
  }, [tokenInfos]);

  // Helper to get token image - returns image path or null if no known image
  const getTokenImage = useCallback((address: `0x${string}`): string | null => {
    if (address === ETH_ADDRESS) return '/Images/Ether.png';
    if (address.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) return '/Images/Token.png';
    return null; // Unknown token, no image
  }, []);

  // Helper to get display name for a pair (text only)
  const getPairDisplayName = useCallback((pair: TokenPairConfig): string => {
    const symbol0 = getTokenSymbol(pair.token0);
    const symbol1 = getTokenSymbol(pair.token1);
    return `${symbol0}/${symbol1}`;
  }, [getTokenSymbol]);

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
  useEffect(() => {
    if (activeTab !== 'trading') return;

    const fetchAllPairChanges = async () => {
      const changes = new Map<string, number>();

      await Promise.all(
        TOKEN_PAIRS.map(async (pair) => {
          if (!pair.geckoPoolAddress) {
            changes.set(pair.id, 0);
            return;
          }

          try {
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

      setAllPairChanges(changes);
    };

    fetchAllPairChanges();
  }, [activeTab]);

  // Handle sidebar pair selection
  const handleSidebarPairSelect = useCallback((pair: TokenPairConfig) => {
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
        className="fixed inset-0 z-50 bg-gray-950 flex flex-col animate-fade-in origin-top-left"
        style={{
          transform: `scale(${scaleFactor})`,
          width: `${100 / scaleFactor}%`,
          height: `${100 / scaleFactor}%`,
        }}>
        {/* Header */}
        <header className="flex-shrink-0 border-b border-gray-800 bg-gray-900/95 backdrop-blur-xl">
          <div className="flex items-center justify-between px-6 py-3">
            {/* Logo & Title */}
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-purple-500 to-pink-500 flex items-center justify-center">
                  <span className="text-xl">🐍</span>
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white">Applesnakes</h1>
                  <p className="text-xs text-gray-400">Marketplace Hub</p>
                </div>
              </div>
            </div>

            {/* Search Bar */}
            <div className="flex flex-1 max-w-xl mx-8">
              <div className="relative w-full">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                />
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-3">
              {/* Balance Pills */}
              {isWalletConnected && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700">
                    <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                    <span className="text-white text-sm font-medium">{wTokenBalanceFormatted.toFixed(2)}</span>
                    <span className="text-gray-400 text-xs">$wASS</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700">
                    <img src="/Images/Ether.png" alt="ETH" className="w-4 h-4" />
                    <span className="text-white text-sm font-medium">{ethBalanceFormatted.toFixed(4)}</span>
                  </div>
                </div>
              )}

              {/* Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex items-center gap-6 px-6 border-t border-gray-800 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => handleTabChange('collection')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'collection'
                    ? 'border-cyan-500 text-cyan-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">My NFTs</span>
                <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs rounded-full bg-gray-800">{collectionNFTs.length}</span>
                {stakedCount > 0 && (
                  <span className="inline ml-1 px-1.5 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-400">
                    +{stakedCount} staked
                  </span>
                )}
              </button>
              <button
                onClick={() => handleTabChange('listings')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'listings'
                    ? 'border-green-500 text-green-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">Market</span>
                {totalListings > 0 && (
                  <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs rounded-full bg-gray-800">{totalListings}</span>
                )}
                {effectiveFloorPrice && (
                  <span className={`inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 text-[10px] rounded ${isPoolFloor ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
                    {effectiveFloorPrice}
                    <img src="/Images/Ether.png" alt="ETH" className="w-3 h-3" />
                  </span>
                )}
              </button>
              <button
                onClick={() => handleTabChange('exchange')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'exchange'
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">Exchange</span>
                {poolNFTs.length > 0 && (
                  <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs rounded-full bg-gray-800">{poolNFTs.length}</span>
                )}
              </button>
              <button
                onClick={() => handleTabChange('trading')}
                className={`py-3 border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'trading'
                    ? 'border-yellow-500 text-yellow-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                <span className="font-medium text-sm sm:text-base">Trading</span>
                <span className={`ml-1 px-1.5 py-0.5 text-[10px] rounded inline-flex items-center gap-1 ${
                  (allPairChanges.get('wass-eth') || 0) >= 0
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  <img src="/Images/Token.png" alt="wASS" className="w-3 h-3" />
                  {(allPairChanges.get('wass-eth') || 0) >= 0 ? '+' : ''}{(allPairChanges.get('wass-eth') || 0).toFixed(2)}%
                </span>
              </button>

              {/* Staking Rewards - Compact display with claim button */}
              <div className="ml-auto flex items-center gap-2 text-sm flex-shrink-0">
                {stakedCount > 0 && hasPendingRewards ? (
                  <>
                    <div className="flex items-center gap-1.5 text-green-400">
                      <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                      <span>{pendingRewardsFormatted}</span>
                    </div>
                    <button
                      onClick={handleClaimRewards}
                      disabled={isProcessing}
                      className="px-2 py-1 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all disabled:opacity-50"
                    >
                      Claim
                    </button>
                  </>
                ) : stakedCount > 0 ? (
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <img src="/Images/Token.png" alt="wASS" className="w-4 h-4 opacity-50" />
                    <span>0.00</span>
                  </div>
                ) : null}
              </div>
            </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar - shows filters for NFT tabs, token pairs for trading tab */}
          <aside className={`flex-shrink-0 border-r border-gray-800 bg-gray-900/50 transition-all overflow-y-auto ${showFilters ? 'block w-64' : 'w-0'}`}>
            {showFilters && (
              <div className="p-4 space-y-6">
                {activeTab === 'trading' ? (
                  /* ===== TRADING TAB SIDEBAR ===== */
                  <>
                    {/* View Toggle - Swap vs Launch */}
                    <div className="flex gap-2 p-1 bg-gray-800 rounded-lg">
                      <button
                        onClick={() => setTradingView('swap')}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                          tradingView === 'swap'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <span>Swap</span>
                      </button>
                      <button
                        onClick={() => setTradingView('launch')}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                          tradingView === 'launch'
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Launch</span>
                      </button>
                    </div>

                    {/* Conditional Sidebar Content based on view */}
                    {tradingView === 'swap' ? (
                      /* ===== SWAP VIEW SIDEBAR ===== */
                      <>
                        {/* Trading Header */}
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white">Token Pairs</h3>
                        </div>

                        {/* Token Pairs List - Dynamic from TOKEN_PAIRS config */}
                        <div>
                          <h4 className="text-sm font-medium text-gray-400 mb-3">Available Pairs</h4>
                          <div className="space-y-2">
                            {TOKEN_PAIRS
                              .sort((a, b) => {
                                if (a.isDefault && !b.isDefault) return -1;
                                if (!a.isDefault && b.isDefault) return 1;
                                const aChange = allPairChanges.get(a.id) || 0;
                                const bChange = allPairChanges.get(b.id) || 0;
                                return bChange - aChange;
                              })
                              .map((pair) => {
                                const pairChange = allPairChanges.get(pair.id);
                                const isSelected = selectedPairId === pair.id;
                                return (
                                  <button
                                    key={pair.id}
                                    onClick={() => handleSidebarPairSelect(pair)}
                                    className={`w-full block p-3 rounded-lg border transition-all text-left ${
                                      isSelected
                                        ? 'bg-emerald-500/20 border-emerald-500/50'
                                        : 'bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`font-medium flex items-center gap-1 ${isSelected ? 'text-emerald-400' : 'text-white'}`}>
                                        {(() => {
                                          const img0 = getTokenImage(pair.token0);
                                          const img1 = getTokenImage(pair.token1);
                                          const symbol0 = getTokenSymbol(pair.token0);
                                          const symbol1 = getTokenSymbol(pair.token1);
                                          return (
                                            <>
                                              {img0 ? (
                                                <img src={img0} alt={symbol0} className="w-4 h-4" />
                                              ) : (
                                                <span className="text-xs">{symbol0}</span>
                                              )}
                                              <span className="text-gray-500">/</span>
                                              {img1 ? (
                                                <img src={img1} alt={symbol1} className="w-4 h-4" />
                                              ) : (
                                                <span className="text-xs">{symbol1}</span>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </span>
                                      {pairChange !== undefined && (
                                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                          pairChange >= 0
                                            ? 'text-emerald-400 bg-emerald-500/20'
                                            : 'text-red-400 bg-red-500/20'
                                        }`}>
                                          {pairChange >= 0 ? '+' : ''}{pairChange.toFixed(2)}%
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-gray-400">
                                      <span>{pair.isDefault ? 'Primary pool' : 'Trading pair'}</span>
                                      <span>1% fee</span>
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      </>
                    ) : (
                      /* ===== LAUNCH VIEW SIDEBAR ===== */
                      <>
                        {/* Launch Header */}
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white">Verified Launcher</h3>
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">AI Verified</span>
                        </div>

                        {/* 2-Step Flow */}
                        <div className="p-3 bg-purple-950/30 border border-purple-500/30 rounded-lg">
                          <div className="flex items-center gap-2 mb-3">
                            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <span className="text-sm font-medium text-purple-400">2-Step Launch</span>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-5 h-5 flex items-center justify-center bg-blue-500/20 text-blue-400 rounded-full text-xs font-bold">1</span>
                              <span className="text-gray-300">Verify & upload image</span>
                              <span className="ml-auto text-blue-400">$0.50</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-5 h-5 flex items-center justify-center bg-purple-500/20 text-purple-400 rounded-full text-xs font-bold">2</span>
                              <span className="text-gray-300">Launch token</span>
                              <span className="ml-auto text-purple-400">$5+</span>
                            </div>
                          </div>
                        </div>

                        {/* Token Info */}
                        <div className="p-3 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">Starting MCap</span>
                            <span className="text-white font-medium">~$10</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">Pool Fee</span>
                            <span className="text-white font-medium">0.3% + 0.7% hook</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">Paired With</span>
                            <span className="text-emerald-400 font-medium">WASS</span>
                          </div>
                          <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-700">
                            <span className="text-gray-400">Payment</span>
                            <span className="text-blue-400 font-medium">USDC on Base</span>
                          </div>
                        </div>

                        {/* Art Style Requirement */}
                        <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-lg">
                          <div className="flex items-start gap-2">
                            <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <div>
                              <p className="text-xs text-amber-400 font-medium mb-1">AppleSnakes Art Style</p>
                              <p className="text-xs text-gray-400 leading-relaxed">
                                Images must match AppleSnakes art style to pass AI verification.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Dev Buy Info */}
                        <div className="p-3 bg-green-950/30 border border-green-500/30 rounded-lg">
                          <div className="flex items-start gap-2">
                            <svg className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div>
                              <p className="text-xs text-green-400 font-medium mb-1">Dev Buy Budget</p>
                              <p className="text-xs text-gray-400 leading-relaxed">
                                Launch payment ($5+ USDC) becomes your dev buy automatically.
                              </p>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
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
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        Clear all
                      </button>
                    </div>

                    {/* Type Filter */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-3">Type</h4>
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
                                  ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                                  : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750 hover:border-gray-600'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span>{labels[type].emoji}</span>
                                <span className="text-sm">{labels[type].label}</span>
                              </span>
                              <span className="text-xs text-gray-500">{typeCounts[type]}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sort Options */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-3">Sort By</h4>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
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
                      <h4 className="text-sm font-medium text-gray-400 mb-3">Grid Size</h4>
                      <div className="flex gap-2">
                        {(['small', 'medium', 'large'] as const).map((size) => (
                          <button
                            key={size}
                            onClick={() => setGridSize(size)}
                            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                              gridSize === size
                                ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                                : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                            }`}
                          >
                            {size.charAt(0).toUpperCase() + size.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pool Info - only show on listings and exchange tabs */}
                    {(activeTab === 'listings' || activeTab === 'exchange') && (
                      <div className="pt-4 border-t border-gray-800">
                        <h4 className="text-sm font-medium text-gray-400 mb-3">Pool Info</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Pool Size</span>
                            <span className="text-white font-medium flex items-center gap-1">
                              {poolNFTs.length}
                              <img src="/Images/MountianGuyHead.png" alt="NFTs" className="w-4 h-4" />
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Wrap Fee</span>
                            <span className="text-orange-400 font-medium flex items-center gap-1">
                              {parseFloat(wrapFeeFormatted).toFixed(4)}
                              <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                            </span>
                          </div>
                          {buyQuotePrice && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-400">Buy Price</span>
                              <span className="text-cyan-400 font-medium flex items-center gap-1">
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
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-gray-800 border border-gray-700 rounded-r-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all"
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
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center border border-cyan-500/30 mb-6">
                  <svg className="w-12 h-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
                <p className="text-gray-400 max-w-md">Connect your wallet to view and manage your NFT collection</p>
              </div>
            ) : isLoading || isLoadingStaked ? (
              /* Loading State */
              <div className="flex flex-col items-center justify-center h-full">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
                </div>
                <p className="mt-4 text-gray-400">Loading your collection...</p>
              </div>
            ) : displayedNFTs.length === 0 ? (
              /* Empty State */
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center border border-cyan-500/30 mb-6">
                  <span className="text-4xl">{searchQuery || filterType !== 'all' ? '🔍' : '🎁'}</span>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {searchQuery || filterType !== 'all' ? 'No Results Found' : 'No NFTs Yet'}
                </h2>
                <p className="text-gray-400 max-w-md mb-6">
                  {searchQuery || filterType !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'Start your collection today!'}
                </p>
                {!searchQuery && filterType === 'all' && (
                  <button
                    onClick={handleBuyNFT}
                    className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-400 hover:to-purple-400 transition-all hover:scale-105"
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
                      className={`group relative rounded-2xl bg-gray-900 border-2 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-1 text-left ${
                        isSelected
                          ? isStaked
                            ? 'border-purple-500 ring-2 ring-purple-500/30'
                            : 'border-cyan-500 ring-2 ring-cyan-500/30'
                          : isStaked
                            ? 'border-purple-500/60 hover:border-purple-400'
                            : 'border-gray-800 hover:border-gray-600'
                      }`}
                      style={{
                        minWidth: '128px',
                        boxShadow: isSelected
                          ? isStaked
                            ? '0 8px 32px rgba(168, 85, 247, 0.4)'
                            : '0 8px 32px rgba(6, 182, 212, 0.3)'
                          : isStaked
                            ? '0 0 20px rgba(168, 85, 247, 0.35), 0 0 40px rgba(168, 85, 247, 0.15), 0 4px 12px rgba(0, 0, 0, 0.3)'
                            : '0 4px 12px rgba(0, 0, 0, 0.3)',
                        animation: isStaked && !isSelected ? 'stakedGlow 2s ease-in-out infinite alternate' : undefined,
                      }}
                    >
                      {/* Image Container */}
                      <div className="aspect-square relative bg-gray-950 overflow-hidden rounded-t-2xl">
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
                                  ? 'bg-purple-500 border-purple-400'
                                  : 'bg-cyan-500 border-cyan-400'
                                : 'bg-gray-900/80 border-gray-500 backdrop-blur-sm'
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
                            <span className="px-2 py-1 rounded-lg bg-purple-500/90 text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1">
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
                            <span className="px-2 py-1 rounded-lg bg-red-500/90 text-white text-xs font-bold backdrop-blur-sm">
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
                      </div>

                      {/* Card Info */}
                      <div className="p-3 space-y-2">
                        {/* Name & Type */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-white truncate text-sm">{nft.name}</h3>
                            <p className="text-xs text-gray-500">#{nft.tokenId}</p>
                          </div>
                          <span className={`flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium ${
                            nft.nftType === 'snake' ? 'bg-green-500/20 text-green-400' :
                            nft.nftType === 'egg' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-cyan-500/20 text-cyan-400'
                          }`}>
                            {typeConfig.emoji} {typeConfig.title}
                          </span>
                        </div>

                        {/* Status Row */}
                        <div className="flex items-center justify-between text-xs">
                          <span className={isStaked && nft.isSnake ? 'text-green-400 font-medium' : 'text-gray-400'}>
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
                      <div className="w-16 h-16 border-4 border-green-500/20 border-t-green-500 rounded-full animate-spin"></div>
                    </div>
                    <p className="mt-4 text-gray-400">Loading marketplace listings...</p>
                  </div>
                ) : openSeaListings.length === 0 && poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-green-500/20 via-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-green-500/30 mb-6">
                      <span className="text-4xl">🏪</span>
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">No Active Listings</h2>
                    <p className="text-gray-400 max-w-md mb-6">
                      No NFTs are currently listed for sale on OpenSea or in the pool. Check back later!
                    </p>
                    <a
                      href="https://opensea.io/collection/applesnakes"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-400 hover:to-emerald-400 transition-all hover:scale-105"
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
                        <p className="text-sm text-gray-400 flex items-center gap-1">
                          {openSeaListings.length + (poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length > 0 ? 1 : 0)} listings available
                          {effectiveFloorPrice && (
                            <span className="flex items-center gap-1 ml-1">
                              • Floor: {effectiveFloorPrice}
                              <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5 inline" />
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => refetchListings()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 transition-all"
                      >
                        <span>↻</span>
                        <span>Refresh</span>
                      </button>
                    </div>

                    {/* Listings Grid */}
                    <div className={`grid ${gridClasses[gridSize]} gap-4`}>
                      {/* Contract "Buy from Pool" Option - shows a human from wTokens pool */}
                      {(() => {
                        // Only show pool option if human filter is active or all filter
                        if (filterType !== 'all' && filterType !== 'human') return null;

                        // Find the first human NFT from the pool that matches search
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

                        if (!poolHuman) return null;

                        // Show real quote price from quoter, or loading state
                        const contractPriceDisplay = isFetchingQuote
                          ? '...'
                          : buyQuotePrice
                            ? parseFloat(buyQuotePrice).toFixed(4)
                            : '~0.001';

                        return (
                          <button
                            key="contract-buy"
                            onClick={handleBuyNFT}
                            className="group relative rounded-2xl bg-gray-900 border-2 border-cyan-500/50 hover:border-cyan-400 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-1 text-left"
                            style={{
                              minWidth: '128px',
                              boxShadow: '0 4px 16px rgba(6, 182, 212, 0.2)',
                            }}
                          >
                            {/* Image Container */}
                            <div className="aspect-square relative bg-gray-950 overflow-hidden rounded-t-2xl">
                              <img
                                src={poolHuman.imageUrl}
                                alt={poolHuman.name}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                              />

                              {/* Gradient Overlay */}
                              <div className="absolute inset-0 bg-gradient-to-t from-cyan-900/60 via-transparent to-transparent" />

                              {/* Contract Badge */}
                              <div className="absolute top-3 left-3">
                                <span className="px-2.5 py-1.5 rounded-lg bg-cyan-500/90 text-white text-sm font-bold backdrop-blur-sm flex items-center gap-1.5">
                                  <img src="/Images/Ether.png" alt="ETH" className="w-4 h-4" />
                                  <span>Instant</span>
                                </span>
                              </div>

                              {/* "Featured" Badge */}
                              <div className="absolute top-3 right-3">
                                <span className="px-2 py-1 rounded-lg bg-purple-500/90 text-white text-xs font-bold backdrop-blur-sm">
                                  🏆 Contract
                                </span>
                              </div>

                              {/* Buy Button */}
                              <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="px-3 py-1.5 rounded-lg bg-cyan-500 text-white text-xs font-bold">
                                  Buy Instantly
                                </div>
                              </div>
                            </div>

                            {/* Card Info */}
                            <div className="p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-white truncate text-sm">Buy from Pool</h3>
                                  <p className="text-xs text-gray-400">{poolNFTs.filter(nft => !nft.isSnake && !nft.isEgg).length} humans available</p>
                                </div>
                                <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-cyan-500/20 text-cyan-400">
                                  Ξ {contractPriceDisplay}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">
                                No gas fees for smart wallets • Instant delivery
                              </p>
                            </div>
                          </button>
                        );
                      })()}

                      {openSeaListings
                        .filter((listing) => {
                          // Apply type filter
                          if (filterType !== 'all') {
                            const listingType = getLocalNFTType(listing.tokenId, listing.name);
                            if (listingType !== filterType) return false;
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
                          // Apply sort
                          switch (sortBy) {
                            case 'price-asc':
                              return parseFloat(a.price) - parseFloat(b.price);
                            case 'price-desc':
                              return parseFloat(b.price) - parseFloat(a.price);
                            case 'id-asc':
                              return a.tokenId - b.tokenId;
                            case 'id-desc':
                              return b.tokenId - a.tokenId;
                            default:
                              return 0;
                          }
                        })
                        .map((listing) => (
                        <a
                          key={listing.orderHash}
                          href={listing.openseaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative rounded-2xl bg-gray-900 border-2 border-gray-800 hover:border-green-500/50 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-1"
                          style={{
                            minWidth: '128px',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                          }}
                        >
                          {/* Image Container */}
                          <div className="aspect-square relative bg-gray-950 overflow-hidden rounded-t-2xl">
                            <img
                              src={listing.imageUrl}
                              alt={listing.name}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                            />

                            {/* Gradient Overlay on Hover */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                            {/* Price Badge */}
                            <div className="absolute top-3 left-3">
                              <span className="px-2.5 py-1.5 rounded-lg bg-green-500/90 text-white text-sm font-bold backdrop-blur-sm flex items-center gap-1.5">
                                <span>Ξ</span>
                                <span>{parseFloat(listing.price).toFixed(4)}</span>
                              </span>
                            </div>

                            {/* Buy Button on Hover */}
                            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-bold">
                                Buy on OpenSea
                              </div>
                            </div>
                          </div>

                          {/* Card Info */}
                          <div className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-white truncate text-sm">{listing.name}</h3>
                                <p className="text-xs text-gray-500">#{listing.tokenId}</p>
                              </div>
                              <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-green-500/20 text-green-400">
                                For Sale
                              </span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ===== NFT EXCHANGE TAB - Two Sub-tabs ===== */}
            {activeTab === 'exchange' && (
              <div className="absolute inset-0 flex flex-col overflow-hidden">
                {/* Sub-tab Navigation */}
                <div className="flex-shrink-0 border-b border-gray-700 px-4 bg-gray-900/50">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setExchangeSubTab('pool')}
                      className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
                        exchangeSubTab === 'pool'
                          ? 'border-orange-500 text-orange-400'
                          : 'border-transparent text-gray-400 hover:text-white'
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
                          ? 'border-blue-500 text-blue-400'
                          : 'border-transparent text-gray-400 hover:text-white'
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
                      <div className="flex-shrink-0 p-4 border-b border-gray-700">
                        <div className="max-w-xl mx-auto">
                          {/* Mode Toggle Tabs */}
                          <div className="flex bg-gray-800 rounded-xl p-1 mb-3">
                            <button
                              onClick={() => setWassMode('unwrap')}
                              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                                wassMode === 'unwrap'
                                  ? 'bg-purple-500 text-white shadow-lg'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              <img src="/Images/Token.png" alt="wASS" className="w-4 h-4" />
                              Unwrap → NFT
                            </button>
                            <button
                              onClick={() => setWassMode('wrap')}
                              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                                wassMode === 'wrap'
                                  ? 'bg-blue-500 text-white shadow-lg'
                                  : 'text-gray-400 hover:text-white'
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
                              <span className="text-gray-400">Balance:</span>
                              <span className="text-white font-bold">
                                {wTokenBalance ? parseFloat(formatUnits(wTokenBalance as bigint, 18)).toFixed(2) : '0.00'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <img src="/Images/Ether.png" alt="ETH" className="w-3.5 h-3.5" />
                              <span className="text-gray-400">Fee:</span>
                              <span className="text-orange-400 font-medium">{parseFloat(wrapFeeFormatted).toFixed(4)}/NFT</span>
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
                              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 mb-4">
                                <p className="text-xs text-gray-400">
                                  <span className="text-purple-400 font-medium">Unwrap:</span> Burn $wASS tokens to receive NFTs from the pool (FIFO order)
                                </p>
                              </div>

                              {/* Amount Selector */}
                              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 mb-4">
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-gray-400 text-sm">Amount to unwrap</span>
                                  <span className="text-gray-500 text-xs">
                                    Max: {wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 0}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => setUnwrapAmount(Math.max(1, unwrapAmount - 1))}
                                    disabled={unwrapAmount <= 1}
                                    className="w-10 h-10 rounded-lg bg-gray-700 text-white font-bold text-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                                    className="flex-1 h-10 text-center bg-gray-800 border border-gray-600 rounded-lg text-white font-bold text-xl focus:outline-none focus:border-purple-500"
                                  />
                                  <button
                                    onClick={() => {
                                      const max = wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 1;
                                      setUnwrapAmount(Math.min(unwrapAmount + 1, Math.max(1, max)));
                                    }}
                                    disabled={!wTokenBalance || unwrapAmount >= Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18)))}
                                    className="w-10 h-10 rounded-lg bg-gray-700 text-white font-bold text-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    +
                                  </button>
                                  <button
                                    onClick={() => {
                                      const max = wTokenBalance ? Math.floor(parseFloat(formatUnits(wTokenBalance as bigint, 18))) : 1;
                                      setUnwrapAmount(Math.max(1, max));
                                    }}
                                    disabled={!wTokenBalance || parseFloat(formatUnits(wTokenBalance as bigint, 18)) < 1}
                                    className="px-4 h-10 rounded-lg bg-purple-500/20 text-purple-400 font-medium hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Max
                                  </button>
                                </div>
                              </div>

                              {/* Cost Summary */}
                              <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700 mb-4">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-gray-400">You pay</span>
                                  <div className="flex items-center gap-2">
                                    <img src="/Images/Token.png" alt="wASS" className="w-5 h-5" />
                                    <span className="text-white font-bold text-lg">{unwrapAmount} $wASS</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-gray-400">+ Fee</span>
                                  <div className="flex items-center gap-2">
                                    <img src="/Images/Ether.png" alt="ETH" className="w-4 h-4" />
                                    <span className="text-orange-400 font-medium">{parseFloat(formatEther(wrapFee * BigInt(unwrapAmount))).toFixed(4)} ETH</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                                  <span className="text-gray-300 font-medium">You receive</span>
                                  <div className="flex items-center gap-2">
                                    <img src="/Images/MountianGuyHead.png" alt="NFT" className="w-5 h-5" />
                                    <span className="text-purple-400 font-bold text-lg">{unwrapAmount} NFT{unwrapAmount !== 1 ? 's' : ''}</span>
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
                                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:from-purple-600 hover:to-purple-700 shadow-lg shadow-purple-500/25'
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
                              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4">
                                <p className="text-xs text-gray-400">
                                  <span className="text-blue-400 font-medium">Wrap:</span> Lock your NFTs in the wrapper contract and receive $wASS tokens
                                </p>
                              </div>

                              {/* NFT Grid */}
                              {isLoading ? (
                                <div className="flex-1 flex items-center justify-center">
                                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
                                </div>
                              ) : nfts.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center">
                                  <p className="text-gray-400 mb-3">No NFTs available to wrap</p>
                                  <button
                                    onClick={() => setExchangeSubTab('pool')}
                                    className="px-4 py-2 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors text-sm"
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
                                                ? 'border-blue-500 ring-2 ring-blue-500/50 scale-95'
                                                : 'border-gray-700 hover:border-blue-400'
                                            }`}
                                          >
                                            <img
                                              src={nft.imageUrl}
                                              alt={nft.name}
                                              className="w-full h-full object-cover"
                                            />
                                            {isSelected && (
                                              <div className="absolute inset-0 bg-blue-500/30 flex items-center justify-center">
                                                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
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
                                  <div className="flex-shrink-0 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-3">
                                        <span className="text-white font-medium">{selectedNFTs.size} NFT{selectedNFTs.size !== 1 ? 's' : ''} selected</span>
                                        {selectedNFTs.size > 0 && (
                                          <button
                                            onClick={() => setSelectedNFTs(new Set())}
                                            className="text-xs text-gray-400 hover:text-white"
                                          >
                                            Clear
                                          </button>
                                        )}
                                      </div>
                                      {selectedNFTs.size > 0 && (
                                        <div className="flex items-center gap-2 text-sm">
                                          <span className="text-gray-400">Fee:</span>
                                          <span className="text-orange-400 font-medium">{parseFloat(formatEther(wrapFee * BigInt(selectedNFTs.size))).toFixed(4)} ETH</span>
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
                                          ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                          : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/25'
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

            {/* ===== TRADING TAB - Chart and Trading Interface OR Token Launcher ===== */}
            {activeTab === 'trading' && (
              <div className="absolute inset-0 flex flex-col overflow-hidden">
                {tradingView === 'swap' ? (
                  /* ===== SWAP VIEW - Chart and Trading Interface ===== */
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
                  />
                ) : (
                  /* ===== LAUNCH VIEW - Two Tab Experience ===== */
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Tab Navigation */}
                    <div className="flex-shrink-0 border-b border-gray-700 px-4">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setLaunchTab('instant')}
                          className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
                            launchTab === 'instant'
                              ? 'border-purple-500 text-purple-400'
                              : 'border-transparent text-gray-400 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Instant Launch
                          </span>
                        </button>
                        <button
                          onClick={() => setLaunchTab('clankerdome')}
                          className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
                            launchTab === 'clankerdome'
                              ? 'border-pink-500 text-pink-400'
                              : 'border-transparent text-gray-400 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-base">🎪</span>
                            Clankerdome
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 overflow-y-auto">
                      {launchTab === 'instant' ? (
                        /* ===== INSTANT LAUNCH - Token Launcher Form ===== */
                        <div className="flex items-start justify-center py-6 px-4">
                          <div className="w-full max-w-lg">
                            {/* Header */}
                            <div className="flex items-center gap-3 mb-6">
                              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                              </div>
                              <div>
                                <h2 className="text-xl font-bold text-white">Launch a Token</h2>
                                <p className="text-sm text-gray-400">Deploy your token paired with WASS on Uniswap V4</p>
                              </div>
                            </div>

                            {/* Verified Token Launcher - 2-step x402 USDC Payment */}
                            <VerifiedTokenLauncher />
                          </div>
                        </div>
                      ) : (
                        /* ===== CLANKERDOME - 24-hour Presale Parties ===== */
                        <div className="p-4">
                          <Clankerdome />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* Selection Action Bar - shown when NFTs are selected */}
        {selectedNFTs.size > 0 && (
          <div className="flex-shrink-0 border-t border-gray-800 bg-gray-900/95 backdrop-blur-xl px-4 md:px-6 py-4">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-4">
                <span className="text-white font-medium">
                  {selectedNFTs.size} NFT{selectedNFTs.size > 1 ? 's' : ''} selected
                </span>
                {selectedSnakes.length > 0 && selectedSnakes.length !== selectedNFTs.size && (
                  <span className="text-sm text-gray-400">
                    ({selectedSnakes.length} snake{selectedSnakes.length > 1 ? 's' : ''})
                  </span>
                )}
                <button
                  onClick={clearSelections}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 hover:border-gray-600 transition-all"
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
                          ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:from-pink-400 hover:to-rose-400 disabled:opacity-50 disabled:cursor-not-allowed'
                      }`}
                      title={selectedHumans.length !== 3 ? `Select exactly 3 humans to breed (${selectedHumans.length}/3)` : 'Breed 3 humans into an AppleSnake egg'}
                    >
                      🧬 Breed
                    </button>
                    <span className={`text-xs whitespace-nowrap ${
                      selectedHumans.length === 3 ? 'text-green-400' : 'text-gray-400'
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
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed'
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
                    className="px-6 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isProcessing && currentOperation === 'unstake' ? 'Unstaking...' : `🔓 Unstake ${selectedForUnstake.length} Snake${selectedForUnstake.length > 1 ? 's' : ''}`}
                  </button>
                )}

                {/* Wrap Button - enabled when non-staked NFTs selected, warning for snakes */}
                <div className="relative flex items-center gap-2">
                  <button
                    onClick={!isWrapperApproved && !supportsAtomicBatch ? handleApproveWrapper : handleWrap}
                    disabled={isProcessing || selectedForWrap.length === 0}
                    className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                      selectedForWrap.length === 0
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : selectedSnakes.length > 0
                          ? 'bg-gradient-to-r from-red-600 to-orange-500 text-white hover:from-red-500 hover:to-orange-400 ring-2 ring-red-500/50 disabled:opacity-50'
                          : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-400 hover:to-emerald-400 disabled:opacity-50'
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
                    <span className="text-xs text-orange-400 whitespace-nowrap flex items-center gap-1">
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
                ? 'bg-purple-900/90 border-purple-500/50 text-purple-100'
                : txOverlay.status === 'success'
                  ? 'bg-green-900/90 border-green-500/50 text-green-100'
                  : 'bg-red-900/90 border-red-500/50 text-red-100'
            }`}
          >
            {/* Status Icon */}
            {txOverlay.status === 'pending' ? (
              <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
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
                  ? 'bg-purple-800 hover:bg-purple-700'
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
