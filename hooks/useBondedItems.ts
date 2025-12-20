'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  usePublicClient,
} from 'wagmi';
import { parseUnits, formatUnits, parseEther } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts, WASS_TOKEN_ADDRESS } from '@/config/contracts';
import { BONDED_ITEMS_V7_ABI } from '@/abis/bondedItemsV7';
import { ITEM_BRIDGE_ABI, ITEM_BRIDGE_ADDRESS } from '@/abis/itemBridge';
import { ERC20_ABI } from '@/abis/erc20';
import {
  TokenPhase,
  TOKEN_PHASE_NAMES,
  BondedItem,
  UserItemBalance,
  BuyQuote,
  SellQuote,
  GlobalItemStats,
  formatWass,
  parseWass,
  processTokenInfo,
  processGlobalStats,
  calculatePriceImpact,
} from '@/types/bonded-items';

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT ADDRESS HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export const BONDED_ITEMS_ADDRESS = '0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd' as const;

// API base URL for item bridge endpoints
// Uses local proxy route to avoid CORS issues during development
const API_BASE = '';

// ═══════════════════════════════════════════════════════════════════════════
// useNextTokenId - Get total number of items
// ═══════════════════════════════════════════════════════════════════════════

export function useNextTokenId() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'nextTokenId',
    chainId: base.id,
  });

  return {
    nextTokenId: data ? Number(data) : 1,
    totalItems: data ? Number(data) - 1 : 0,
    isLoading,
    error,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useItemInfo - Get single item info
// ═══════════════════════════════════════════════════════════════════════════

export function useItemInfo(tokenId: number | bigint) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const tokenIdBigInt = BigInt(tokenId);

  // V3: Get token config
  const { data: configData, isLoading: configLoading, refetch: refetchConfig } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'tokenConfigs',
    args: [tokenIdBigInt],
    chainId: base.id,
  });

  // V7: Get current price
  const { data: priceData, refetch: refetchPrice } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getCurrentPrice',
    args: [tokenIdBigInt],
    chainId: base.id,
  });

  // V7: Get item stats (10 values)
  const { data: statsData, refetch: refetchStats } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getItemStats',
    args: [tokenIdBigInt],
    chainId: base.id,
  });

  // Get metadata URI
  const { data: uriData } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'uri',
    args: [tokenIdBigInt],
    chainId: base.id,
  });

  const item: BondedItem | null = useMemo(() => {
    if (!configData) return null;

    try {
      // V3 tokenConfigs: [creator, presalePrice, presaleSupply, presaleSold, presaleWassCollected, phase, exists]
      // Wagmi may return numbers instead of bigints for smaller values - ensure all are converted
      const config = configData as readonly [
        `0x${string}`, bigint | number, bigint | number, bigint | number, bigint | number, number, boolean
      ];
      const [creator, rawPresalePrice, rawPresaleSupply, rawPresaleSold, _presaleWassCollected, phase, exists] = config;

      if (!exists) return null;

      // Convert all numeric values to proper bigints
      const presalePrice = typeof rawPresalePrice === 'bigint' ? rawPresalePrice : BigInt(rawPresalePrice);
      const presaleSupply = typeof rawPresaleSupply === 'bigint' ? rawPresaleSupply : BigInt(rawPresaleSupply);
      const presaleSold = typeof rawPresaleSold === 'bigint' ? rawPresaleSold : BigInt(rawPresaleSold);

      // Ensure currentPrice is a proper bigint
      const rawPrice = priceData ?? presalePrice;
      const currentPrice = typeof rawPrice === 'bigint' ? rawPrice : BigInt(rawPrice as number);
      const presaleRemaining = presaleSupply > presaleSold ? presaleSupply - presaleSold : 0n;
      const presaleProgress = presaleSupply > 0n
        ? Number((presaleSold * 100n) / presaleSupply)
        : 0;

      const processed: BondedItem = {
        tokenId: tokenIdBigInt,
        creator,
        phase: phase as TokenPhase,
        phaseName: TOKEN_PHASE_NAMES[phase as TokenPhase] || 'Unknown',
        exists: true,
        presalePrice,
        presalePriceFormatted: formatWass(presalePrice, 4),
        presaleSupply,
        presaleSold,
        presaleRemaining,
        presaleProgress,
        currentPrice,
        currentPriceFormatted: formatWass(currentPrice, 4),
        metadataUri: uriData as string | undefined,
      };

      // V7: Add stats if available (10 values)
      // [totalVolume, totalBuyVolume, totalSellVolume, totalFees, totalBuys, totalSells, creatorEarnings, stakerRewards, highPrice, lowPrice]
      if (statsData) {
        const stats = statsData as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
        const [totalVolume, _totalBuyVolume, _totalSellVolume, totalFees, totalBuys, totalSells, creatorEarnings, stakerRewards] = stats;
        processed.stats = {
          totalVolume,
          totalVolumeFormatted: formatWass(totalVolume),
          totalFees,
          totalTrades: totalBuys + totalSells,
          creatorEarnings,
          stakerRewards,
          liquidityAdded: 0n, // V7: Not directly available, using 0 for compatibility
        };
      }

      return processed;
    } catch {
      return null;
    }
  }, [configData, priceData, statsData, uriData, tokenIdBigInt]);

  const refetch = useCallback(() => {
    refetchConfig();
    refetchPrice();
    refetchStats();
  }, [refetchConfig, refetchPrice, refetchStats]);

  return { item, isLoading: configLoading, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
// Metadata base URL for BondedItems
const BONDED_ITEMS_METADATA_BASE = 'https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i';

// useAllItems - Get all items with pagination
// ═══════════════════════════════════════════════════════════════════════════

export function useAllItems(maxItems: number = 100) {
  const [items, setItems] = useState<BondedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const { nextTokenId, totalItems } = useNextTokenId();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  // Build contract calls for all items
  const tokenIds = useMemo(() => {
    const ids: bigint[] = [];
    const count = Math.min(totalItems, maxItems);
    for (let i = 1; i <= count; i++) {
      ids.push(BigInt(i));
    }
    return ids;
  }, [totalItems, maxItems]);

  // V3: Use tokenConfigs instead of getTokenInfo
  const configCalls = useMemo(() => {
    return tokenIds.map(id => ({
      address: contracts.bondedItems.address as `0x${string}`,
      abi: BONDED_ITEMS_V7_ABI,
      functionName: 'tokenConfigs' as const,
      args: [id] as const,
      chainId: base.id,
    }));
  }, [tokenIds, contracts.bondedItems.address]);

  // V7: Get prices separately using getCurrentPrice
  const priceCalls = useMemo(() => {
    return tokenIds.map(id => ({
      address: contracts.bondedItems.address as `0x${string}`,
      abi: BONDED_ITEMS_V7_ABI,
      functionName: 'getCurrentPrice' as const,
      args: [id] as const,
      chainId: base.id,
    }));
  }, [tokenIds, contracts.bondedItems.address]);

  const { data: configResults, isLoading: configsLoading, refetch: refetchConfigs } = useReadContracts({
    contracts: configCalls,
    query: {
      enabled: tokenIds.length > 0,
      refetchInterval: 1000, // Auto-refresh every 1 second
      staleTime: 500,
    },
  });

  const { data: priceResults, isLoading: pricesLoading, refetch: refetchPrices } = useReadContracts({
    contracts: priceCalls,
    query: {
      enabled: tokenIds.length > 0,
      refetchInterval: 1000,
      staleTime: 500,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refetch = useCallback((): void => {
    (refetchConfigs as () => void)();
    (refetchPrices as () => void)();
  }, [refetchConfigs, refetchPrices]);

  const infosLoading = configsLoading || pricesLoading;

  // Fetch metadata for all items
  const fetchMetadata = useCallback(async (processedItems: BondedItem[]) => {
    const metadataPromises = processedItems.map(async (item) => {
      try {
        const response = await fetch(`${BONDED_ITEMS_METADATA_BASE}/${item.tokenId.toString()}.json`);
        if (response.ok) {
          const metadata = await response.json();
          return {
            tokenId: item.tokenId,
            name: metadata.name || `Item #${item.tokenId}`,
            description: metadata.description,
            imageUrl: metadata.image,
          };
        }
      } catch {
        // Silently fail - use defaults
      }
      return {
        tokenId: item.tokenId,
        name: `Item #${item.tokenId}`,
        imageUrl: `${BONDED_ITEMS_METADATA_BASE}/images/${item.tokenId}.png`,
      };
    });

    const metadataResults = await Promise.all(metadataPromises);
    const metadataMap = new Map(metadataResults.map(m => [m.tokenId.toString(), m]));

    return processedItems.map(item => {
      const meta = metadataMap.get(item.tokenId.toString());
      return {
        ...item,
        name: meta?.name || `Item #${item.tokenId}`,
        description: meta?.description,
        imageUrl: meta?.imageUrl || `${BONDED_ITEMS_METADATA_BASE}/images/${item.tokenId}.png`,
      };
    });
  }, []);

  useEffect(() => {
    if (configResults && priceResults && !infosLoading) {
      const processedItems: BondedItem[] = [];

      configResults.forEach((configResult, index) => {
        const priceResult = priceResults[index];
        if (configResult.status === 'success' && configResult.result) {
          try {
            // V3 tokenConfigs returns: [creator, presalePrice, presaleSupply, presaleSold, presaleWassCollected, phase, exists]
            // Wagmi may return numbers instead of bigints for smaller values - ensure all are converted
            const config = configResult.result as readonly [
              `0x${string}`, bigint | number, bigint | number, bigint | number, bigint | number, number, boolean
            ];
            const [creator, rawPresalePrice, rawPresaleSupply, rawPresaleSold, _presaleWassCollected, phase, exists] = config;

            if (!exists) return;

            // Convert all numeric values to proper bigints
            const presalePrice = typeof rawPresalePrice === 'bigint' ? rawPresalePrice : BigInt(rawPresalePrice);
            const presaleSupply = typeof rawPresaleSupply === 'bigint' ? rawPresaleSupply : BigInt(rawPresaleSupply);
            const presaleSold = typeof rawPresaleSold === 'bigint' ? rawPresaleSold : BigInt(rawPresaleSold);

            const tokenId = tokenIds[index];
            // Ensure currentPrice is a proper bigint
            // IMPORTANT: wagmi may return numbers OR bigints depending on value size
            // For large values, convert via string to preserve precision
            const rawPrice = priceResult?.status === 'success' && priceResult.result
              ? priceResult.result
              : presalePrice;
            let currentPrice: bigint;
            console.log('[useAllItems] rawPrice for token', tokenId.toString(), ':', rawPrice, 'type:', typeof rawPrice);
            if (typeof rawPrice === 'bigint') {
              currentPrice = rawPrice;
            } else if (typeof rawPrice === 'number') {
              // WARNING: Large numbers may have already lost precision!
              // This is a limitation of wagmi returning numbers instead of bigints
              currentPrice = BigInt(Math.floor(rawPrice));
              console.log('[useAllItems] WARNING: price was number, converted to:', currentPrice.toString());
            } else {
              currentPrice = BigInt(String(rawPrice));
            }

            const presaleRemaining = presaleSupply > presaleSold ? presaleSupply - presaleSold : 0n;
            const presaleProgress = presaleSupply > 0n
              ? Number((presaleSold * 100n) / presaleSupply)
              : 0;

            // DEBUG: Log the price formatting
            const formattedPrice = formatWass(currentPrice, 4);
            console.log('[useAllItems] tokenId:', tokenId.toString(), 'currentPrice:', currentPrice.toString(), 'formatted:', formattedPrice);

            const item: BondedItem = {
              tokenId,
              creator,
              phase: phase as TokenPhase,
              phaseName: TOKEN_PHASE_NAMES[phase as TokenPhase] || 'Unknown',
              exists: true,
              presalePrice,
              presalePriceFormatted: formatWass(presalePrice, 4),
              presaleSupply,
              presaleSold,
              presaleRemaining,
              presaleProgress,
              currentPrice,
              currentPriceFormatted: formattedPrice,
            };

            processedItems.push(item);
          } catch {
            // Skip invalid items
          }
        }
      });

      // Fetch metadata and update items
      fetchMetadata(processedItems).then(itemsWithMetadata => {
        setItems(itemsWithMetadata);
        setMetadataLoaded(true);
        setIsLoading(false);
      });
    }
  }, [configResults, priceResults, infosLoading, tokenIds, fetchMetadata]);

  return { items, isLoading: isLoading || infosLoading, totalItems, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
// useUserItemBalances - Get user's item balances
// ═══════════════════════════════════════════════════════════════════════════

export function useUserItemBalances(userAddress?: `0x${string}`) {
  const { address: connectedAddress } = useAccount();
  const address = userAddress || connectedAddress;
  const [balances, setBalances] = useState<UserItemBalance[]>([]);
  const { totalItems } = useNextTokenId();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  // Build balance calls for all items
  const tokenIds = useMemo(() => {
    const ids: bigint[] = [];
    for (let i = 1; i <= totalItems; i++) {
      ids.push(BigInt(i));
    }
    return ids;
  }, [totalItems]);

  const balanceCalls = useMemo(() => {
    if (!address || tokenIds.length === 0) return [];

    return tokenIds.map(id => ({
      address: contracts.bondedItems.address as `0x${string}`,
      abi: BONDED_ITEMS_V7_ABI,
      functionName: 'balanceOf' as const,
      args: [address, id] as const,
      chainId: base.id,
    }));
  }, [tokenIds, address, contracts.bondedItems.address]);

  const { data: balanceResults, isLoading, refetch } = useReadContracts({
    contracts: balanceCalls,
    query: {
      enabled: balanceCalls.length > 0,
      refetchInterval: 1000, // Auto-refresh every 1 second
      staleTime: 500,
    },
  });

  useEffect(() => {
    if (balanceResults && !isLoading) {
      const userBalances: UserItemBalance[] = [];

      balanceResults.forEach((result, index) => {
        if (result.status === 'success') {
          const balance = result.result as bigint;
          if (balance > 0n) {
            userBalances.push({
              tokenId: tokenIds[index],
              balance,
            });
          }
        }
      });

      setBalances(userBalances);
    }
  }, [balanceResults, isLoading, tokenIds]);

  return { balances, isLoading, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
// useBuyQuote - Quote for buying from curve (V7)
// V7: Takes tokenAmount (how many to buy), returns [wassCost, fee, totalCost, newPrice, slippageBps, feeBps]
// ═══════════════════════════════════════════════════════════════════════════

export function useBuyQuote(tokenId: number | bigint, tokenAmount: bigint) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data: currentPrice } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getCurrentPrice',
    args: [BigInt(tokenId)],
    chainId: base.id,
  });

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'quoteBuy',
    args: [BigInt(tokenId), tokenAmount],
    chainId: base.id,
    query: {
      enabled: tokenAmount > 0n,
    },
  });

  const quote: BuyQuote | null = useMemo(() => {
    if (!data) return null;

    // V7: [wassCost, fee, totalCost, newPrice, slippageBps, feeBps]
    // Ensure values are properly converted to bigint (wagmi may return numbers for smaller values)
    const rawData = data as readonly [bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number];
    const wassCost = BigInt(rawData[0]);
    const fee = BigInt(rawData[1]);
    const totalCost = BigInt(rawData[2]);
    const newPrice = BigInt(rawData[3]);
    const slippageBps = Number(rawData[4]);
    const feeBps = Number(rawData[5]);

    return {
      wassCost,
      wassCostFormatted: formatWass(wassCost, 4),
      fee,
      feeFormatted: formatWass(fee, 4),
      totalCost,
      totalCostFormatted: formatWass(totalCost, 4),
      newPrice,
      newPriceFormatted: formatWass(newPrice, 4),
      priceImpact: currentPrice ? calculatePriceImpact(BigInt(currentPrice as bigint), newPrice) : 0,
      slippageBps,
      feeBps,
    };
  }, [data, currentPrice]);

  return { quote, isLoading, error, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
// useSellQuote - Quote for selling to curve (V7)
// V7: Returns [wassReturn, fee, netReturn, newPrice, slippageBps, feeBps]
// ═══════════════════════════════════════════════════════════════════════════

export function useSellQuote(tokenId: number | bigint, tokenAmount: bigint) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data: currentPrice } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getCurrentPrice',
    args: [BigInt(tokenId)],
    chainId: base.id,
  });

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'quoteSell',
    args: [BigInt(tokenId), tokenAmount],
    chainId: base.id,
    query: {
      enabled: tokenAmount > 0n,
    },
  });

  const quote: SellQuote | null = useMemo(() => {
    if (!data) return null;

    // V7: [wassReturn, fee, netReturn, newPrice, slippageBps, feeBps]
    // Ensure values are properly converted to bigint (wagmi may return numbers for smaller values)
    const rawData = data as readonly [bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number];
    const wassReturn = BigInt(rawData[0]);
    const fee = BigInt(rawData[1]);
    const netReturn = BigInt(rawData[2]);
    const newPrice = BigInt(rawData[3]);
    const slippageBps = Number(rawData[4]);
    const feeBps = Number(rawData[5]);

    return {
      wassReturn,
      wassReturnFormatted: formatWass(wassReturn, 4),
      fee,
      feeFormatted: formatWass(fee, 4),
      netReturn,
      netReturnFormatted: formatWass(netReturn, 4),
      newPrice,
      newPriceFormatted: formatWass(newPrice, 4),
      priceImpact: currentPrice ? calculatePriceImpact(BigInt(currentPrice as bigint), newPrice) : 0,
      slippageBps,
      feeBps,
    };
  }, [data, currentPrice]);

  return { quote, isLoading, error, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
// useCurveInfo - Get bonding curve pool details for a token
// V7: Uses CPMM (x * y = k) bonding curve with dynamic fees
// ═══════════════════════════════════════════════════════════════════════════

export interface CurveInfo {
  // V7 CPMM Pool state from getCurveInfo
  virtualTokenReserve: bigint;
  wassReserve: bigint;
  k: bigint;                    // Constant product (x * y)
  currentPrice: bigint;
  position: bigint;             // Current position on curve
  initialTokenReserve: bigint;
  initialWassReserve: bigint;
  minTokenReserve: bigint;
  minWassReserve: bigint;
  adminMinted: bigint;
  active: boolean;
  // Derived values
  tokensAvailable: bigint;      // Tokens that can still be bought
  tokensSold: bigint;           // Tokens already sold from curve
  // Formatted for display
  wassReserveFormatted: string;
  realWassFormatted: string;    // Alias for wassReserveFormatted (compatibility)
  currentPriceFormatted: string;
  virtualTokensFormatted: string;
  tokensAvailableFormatted: string;
  tokensSoldFormatted: string;
  // Stats
  totalVolume: bigint;
  totalVolumeFormatted: string;
  totalTrades: bigint;
  totalFees: bigint;
  totalFeesFormatted: string;
  // Dynamic fee info
  currentFeeBps: number;
}

export function useCurveInfo(tokenId: number | bigint) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  // V7: Use getCurveInfo which returns CPMM curve data
  const { data: curveData, isLoading: curveLoading } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getCurveInfo',
    args: [BigInt(tokenId)],
    chainId: base.id,
    query: {
      refetchInterval: 5000,
    },
  });

  // V7: Fetch item stats (10 values)
  const { data: statsData, isLoading: statsLoading } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getItemStats',
    args: [BigInt(tokenId)],
    chainId: base.id,
    query: {
      refetchInterval: 5000,
    },
  });

  // V7: Fetch dynamic fee info
  const { data: feeData } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getFeeInfo',
    args: [BigInt(tokenId)],
    chainId: base.id,
    query: {
      refetchInterval: 5000,
    },
  });

  const curveInfo: CurveInfo | null = useMemo(() => {
    if (!curveData) return null;

    // V7 getCurveInfo returns 11 values:
    // [virtualTokenReserve, wassReserve, k, currentPrice, position,
    //  initialTokenReserve, initialWassReserve, minTokenReserve, minWassReserve, adminMinted, active]
    // Ensure values are properly converted to bigint (wagmi may return numbers for smaller values)
    const rawData = curveData as readonly [bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, boolean];
    const virtualTokenReserve = BigInt(rawData[0]);
    const wassReserve = BigInt(rawData[1]);
    const k = BigInt(rawData[2]);
    const currentPrice = BigInt(rawData[3]);
    const position = BigInt(rawData[4]);
    const initialTokenReserve = BigInt(rawData[5]);
    const initialWassReserve = BigInt(rawData[6]);
    const minTokenReserve = BigInt(rawData[7]);
    const minWassReserve = BigInt(rawData[8]);
    const adminMinted = BigInt(rawData[9]);
    const active = rawData[10] as boolean;

    // V7: getItemStats returns 10 values:
    // [totalVolume, totalBuyVolume, totalSellVolume, totalFees, totalBuys, totalSells, creatorEarnings, stakerRewards, highPrice, lowPrice]
    let totalVolume = 0n, totalFees = 0n, totalTrades = 0n;
    if (statsData) {
      const stats = statsData as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
      totalVolume = stats[0];
      totalFees = stats[3];
      totalTrades = stats[4] + stats[5]; // totalBuys + totalSells
    }

    // V7: getFeeInfo returns [currentFeeBps, reserveRatio, creatorShareBps, stakerShareBps] (all uint256)
    let currentFeeBps = 100; // Default 1%
    if (feeData) {
      const fee = feeData as readonly [bigint, bigint, bigint, bigint];
      currentFeeBps = Number(fee[0]);
    }

    // Calculate derived values
    const tokensAvailable = virtualTokenReserve > minTokenReserve
      ? virtualTokenReserve - minTokenReserve
      : 0n;
    const tokensSold = initialTokenReserve > virtualTokenReserve
      ? initialTokenReserve - virtualTokenReserve
      : 0n;
    const wassReserveFormatted = formatWass(wassReserve, 2);

    // DEBUG: Log curve price formatting
    const curvePriceFormatted = formatWass(currentPrice, 4);
    console.log('[useCurveInfo] currentPrice:', currentPrice.toString(), 'formatted:', curvePriceFormatted, 'wassReserve:', wassReserve.toString(), 'wassFormatted:', wassReserveFormatted);

    return {
      virtualTokenReserve,
      wassReserve,
      k,
      currentPrice,
      position,
      initialTokenReserve,
      initialWassReserve,
      minTokenReserve,
      minWassReserve,
      adminMinted,
      active,
      tokensAvailable,
      tokensSold,
      wassReserveFormatted,
      realWassFormatted: wassReserveFormatted, // Alias for compatibility
      currentPriceFormatted: curvePriceFormatted,
      virtualTokensFormatted: Number(virtualTokenReserve).toString(),
      tokensAvailableFormatted: Number(tokensAvailable).toString(),
      tokensSoldFormatted: Number(tokensSold).toString(),
      totalVolume,
      totalVolumeFormatted: formatWass(totalVolume, 2),
      totalTrades,
      totalFees,
      totalFeesFormatted: formatWass(totalFees, 2),
      currentFeeBps,
    };
  }, [curveData, statsData, feeData]);

  return {
    curveInfo,
    isLoading: curveLoading || statsLoading,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useGlobalStats - Get global item stats
// ═══════════════════════════════════════════════════════════════════════════

export function useGlobalStats() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'getGlobalStats',
    chainId: base.id,
  });

  const stats: GlobalItemStats | null = useMemo(() => {
    if (!data) return null;
    // V7: getGlobalStats returns 10 values
    return processGlobalStats(data as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]);
  }, [data]);

  return { stats, isLoading, error, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
// useWassAllowanceForItems - Check wASS allowance for BondedItems contract
// ═══════════════════════════════════════════════════════════════════════════

export function useWassAllowanceForItems() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, contracts.bondedItems.address],
    chainId: base.id,
    query: {
      enabled: !!address,
      refetchInterval: 5000, // Refetch every 5 seconds to catch approval changes
      staleTime: 0, // Always consider data stale
    },
  });

  const allowance = (data as bigint | undefined) ?? 0n;

  // Debug logging
  console.log('[Allowance Check] address:', address, 'spender:', contracts.bondedItems.address, 'allowance:', allowance.toString());

  return {
    allowance,
    allowanceFormatted: formatWass(allowance),
    isLoading,
    error,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useApproveWassForItems - Approve wASS for BondedItems contract
// ═══════════════════════════════════════════════════════════════════════════

export function useApproveWassForItems() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();

  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const approveWass = useCallback(
    async (_amount?: bigint): Promise<`0x${string}` | null> => {
      try {
        // Always use max approval to avoid repeated approvals
        const approvalAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        // NO chainId - let wagmi use wallet's current chain (fixes MetaMask issues)
        const txHash = await writeContractAsync({
          address: WASS_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [contracts.bondedItems.address, approvalAmount],
        });

        // Wait for confirmation - match prediction market pattern (no timeout)
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: txHash });
        }

        return txHash;
      } catch (err) {
        console.error('Approval failed:', err);
        return null;
      }
    },
    [writeContractAsync, publicClient, contracts.bondedItems.address]
  );

  return {
    approveWass,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useBuyPresale - Buy items during presale with wASS
// SIMPLE: check allowance → approve if needed → buy. That's it.
// ═══════════════════════════════════════════════════════════════════════════

export function useBuyPresale() {
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const [isApproving, setIsApproving] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<Error | null>(null);

  // Single writeContract hook for ALL writes (approval + buy)
  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // MATCH PREDICTION MARKET PATTERN: Use useReadContract for allowance with refetch
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, BONDED_ITEMS_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const reset = useCallback(() => {
    setIsApproving(false);
    setIsBuying(false);
    setHash(undefined);
    setError(null);
  }, []);

  const buyPresaleWithWass = useCallback(
    async (tokenId: number | bigint, amount: number | bigint, price: bigint) => {
      reset();

      if (!publicClient) throw new Error('Public client not available');
      if (!address) throw new Error('Wallet not connected');

      const totalCost = price * BigInt(amount);
      const spender = BONDED_ITEMS_ADDRESS;

      try {
        // MATCH PREDICTION MARKET: Use hook allowance value
        const currentAllowance = (allowanceData as bigint) || 0n;
        console.log('[BuyPresale] Allowance:', currentAllowance.toString(), 'Cost:', totalCost.toString());

        // Step 2: Approve if needed
        if (currentAllowance < totalCost) {
          setIsApproving(true);
          console.log('[BuyPresale] Need approval. Allowance:', currentAllowance.toString(), 'Cost:', totalCost.toString());
          console.log('[BuyPresale] Token:', WASS_TOKEN_ADDRESS, 'Spender:', spender);

          // MATCH PREDICTION MARKET EXACTLY: writeContractAsync with NO extra options
          const approveHash = await writeContractAsync({
            address: WASS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
          });
          console.log('[BuyPresale] Approval tx submitted:', approveHash);

          // MATCH PREDICTION MARKET: Wait for receipt
          if (publicClient) {
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
          console.log('[BuyPresale] Approval confirmed');

          // MATCH PREDICTION MARKET: Refetch allowance to confirm
          await refetchAllowance();
          console.log('[BuyPresale] Allowance refetched');

          setIsApproving(false);
        }

        // Step 3: Buy
        setIsBuying(true);
        console.log('[BuyPresale] Buying tokenId:', tokenId, 'amount:', amount);

        const buyHash = await writeContractAsync({
          address: spender,
          abi: BONDED_ITEMS_V7_ABI,
          functionName: 'buyPresaleWithWass',
          args: [BigInt(tokenId), BigInt(amount)],
        });

        console.log('[BuyPresale] Buy tx:', buyHash);
        setHash(buyHash);

        // Wait for buy confirmation
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: buyHash });
        }
        console.log('[BuyPresale] Buy confirmed');

        return buyHash;
      } catch (err) {
        console.error('[BuyPresale] Error:', err);
        setError(err as Error);
        throw err;
      } finally {
        setIsApproving(false);
        setIsBuying(false);
      }
    },
    [publicClient, address, reset, writeContractAsync, allowanceData, refetchAllowance]
  );

  return {
    buyPresaleWithWass,
    hash,
    isPending: isApproving || isBuying,
    isApproving,
    isBuying,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useBuyPresaleWithEth - Buy items during presale with ETH
// ═══════════════════════════════════════════════════════════════════════════

export function useBuyPresaleWithEth() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();

  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const buyPresaleWithEth = useCallback(
    async (tokenId: number | bigint, amount: number | bigint, ethAmount: string, minWassOut: bigint = 0n) => {
      const ethWei = parseEther(ethAmount);

      const txHash = await writeContractAsync({
        address: contracts.bondedItems.address,
        abi: BONDED_ITEMS_V7_ABI,
        functionName: 'buyPresaleWithEth',
        args: [BigInt(tokenId), BigInt(amount), minWassOut],
        value: ethWei,
      });

      // Wait for confirmation
      if (publicClient && txHash) {
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      return txHash;
    },
    [writeContractAsync, publicClient, contracts.bondedItems.address]
  );

  return {
    buyPresaleWithEth,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useBuyFromCurve - Buy items from bonding curve with wASS
// SIMPLE: check allowance → approve if needed → buy. That's it.
// ═══════════════════════════════════════════════════════════════════════════

export function useBuyFromCurve() {
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const [isApproving, setIsApproving] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<Error | null>(null);

  // Single writeContract hook for ALL writes (approval + buy)
  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // MATCH PREDICTION MARKET PATTERN: Use useReadContract for allowance with refetch
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, BONDED_ITEMS_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const reset = useCallback(() => {
    setIsApproving(false);
    setIsBuying(false);
    setHash(undefined);
    setError(null);
  }, []);

  const buyFromCurve = useCallback(
    async (tokenId: number | bigint, tokenAmount: bigint, maxWassIn: bigint) => {
      reset();

      if (!publicClient) throw new Error('Public client not available');
      if (!address) throw new Error('Wallet not connected');

      const spender = BONDED_ITEMS_ADDRESS;

      try {
        // MATCH PREDICTION MARKET: Use hook allowance value
        const currentAllowance = (allowanceData as bigint) || 0n;
        console.log('[BuyFromCurve] Allowance:', currentAllowance.toString(), 'MaxWassIn:', maxWassIn.toString());

        // Step 2: Approve if needed
        if (currentAllowance < maxWassIn) {
          setIsApproving(true);
          console.log('[BuyFromCurve] Need approval. Allowance:', currentAllowance.toString(), 'MaxWassIn:', maxWassIn.toString());
          console.log('[BuyFromCurve] Token:', WASS_TOKEN_ADDRESS, 'Spender:', spender);

          // MATCH PREDICTION MARKET EXACTLY: writeContractAsync with NO extra options
          const approveHash = await writeContractAsync({
            address: WASS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
          });
          console.log('[BuyFromCurve] Approval tx submitted:', approveHash);

          // MATCH PREDICTION MARKET: Wait for receipt
          if (publicClient) {
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
          console.log('[BuyFromCurve] Approval confirmed');

          // MATCH PREDICTION MARKET: Refetch allowance to confirm
          await refetchAllowance();
          console.log('[BuyFromCurve] Allowance refetched');

          setIsApproving(false);
        }

        // Step 3: Buy
        setIsBuying(true);
        console.log('[BuyFromCurve] Buying tokenId:', tokenId, 'amount:', tokenAmount.toString());

        const buyHash = await writeContractAsync({
          address: spender,
          abi: BONDED_ITEMS_V7_ABI,
          functionName: 'buyFromCurve',
          args: [BigInt(tokenId), tokenAmount, maxWassIn],
        });

        console.log('[BuyFromCurve] Buy tx:', buyHash);
        setHash(buyHash);

        // Wait for buy confirmation
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: buyHash });
        }
        console.log('[BuyFromCurve] Buy confirmed');

        return buyHash;
      } catch (err) {
        console.error('[BuyFromCurve] Error:', err);
        setError(err as Error);
        throw err;
      } finally {
        setIsApproving(false);
        setIsBuying(false);
      }
    },
    [publicClient, address, reset, writeContractAsync, allowanceData, refetchAllowance]
  );

  return {
    buyFromCurve,
    hash,
    isPending: isApproving || isBuying,
    isApproving,
    isBuying,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useBuyFromCurveWithEth - Buy items from bonding curve with ETH (V3)
// V3: buyFromCurveWithEth(tokenId, tokenAmount, minWassFromSwap) payable
// Specify how many tokens to buy, sends ETH which is swapped to wASS
// ═══════════════════════════════════════════════════════════════════════════

export function useBuyFromCurveWithEth() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();

  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // V3: tokenAmount = how many tokens to buy, minWassFromSwap = min wASS from ETH swap
  const buyFromCurveWithEth = useCallback(
    async (tokenId: number | bigint, ethAmount: string, tokenAmount: bigint, minWassFromSwap: bigint = 0n) => {
      const ethWei = parseEther(ethAmount);

      const txHash = await writeContractAsync({
        address: contracts.bondedItems.address,
        abi: BONDED_ITEMS_V7_ABI,
        functionName: 'buyFromCurveWithEth',
        args: [BigInt(tokenId), tokenAmount, minWassFromSwap],
        value: ethWei,
      });

      // Wait for confirmation
      if (publicClient && txHash) {
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      return txHash;
    },
    [writeContractAsync, publicClient, contracts.bondedItems.address]
  );

  return {
    buyFromCurveWithEth,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useItemApprovalForSelling - Check/set approval for selling items to curve
// ═══════════════════════════════════════════════════════════════════════════

export function useItemApprovalForSelling() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();

  // Check if approved for BondedItems contract (needed for selling)
  const { data: isApproved, isLoading, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'isApprovedForAll',
    args: address ? [address, contracts.bondedItems.address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const { writeContractAsync, isPending, error, reset } = useWriteContract();

  const approveForSelling = useCallback(
    async (): Promise<`0x${string}` | null> => {
      try {
        if (!publicClient) throw new Error('Public client not available');

        const txHash = await writeContractAsync({
          address: contracts.bondedItems.address,
          abi: BONDED_ITEMS_V7_ABI,
          functionName: 'setApprovalForAll',
          args: [contracts.bondedItems.address, true],
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
        await refetch();

        return txHash;
      } catch (err) {
        console.error('Approval for selling failed:', err);
        return null;
      }
    },
    [writeContractAsync, publicClient, contracts.bondedItems.address, refetch]
  );

  return {
    isApproved: isApproved ?? false,
    isLoading,
    approveForSelling,
    isPending,
    error,
    reset,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useSellToCurve - Sell items back to bonding curve
// ═══════════════════════════════════════════════════════════════════════════

export function useSellToCurve() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();
  const { isApproved, approveForSelling, refetch: refetchApproval } = useItemApprovalForSelling();

  const [isApproving, setIsApproving] = useState(false);
  const [isSelling, setIsSelling] = useState(false);

  const { writeContractAsync, data: hash, isPending, error, reset: wagmiReset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Reset ALL states including internal ones - fixes stuck button issue
  const reset = useCallback(() => {
    setIsApproving(false);
    setIsSelling(false);
    wagmiReset();
  }, [wagmiReset]);

  const sellToCurve = useCallback(
    async (tokenId: number | bigint, tokenAmount: bigint, minWassOut: bigint) => {
      setIsApproving(false);
      setIsSelling(false);

      if (!publicClient) {
        throw new Error('Public client not available');
      }

      // Check if approval needed for selling
      if (!isApproved) {
        setIsApproving(true);
        try {
          const approvalHash = await approveForSelling();
          if (!approvalHash) {
            throw new Error('Approval failed or was rejected');
          }
          // Wait for approval to sync
          await new Promise(resolve => setTimeout(resolve, 1000));
          await refetchApproval();
        } finally {
          setIsApproving(false);
        }
      }

      // Execute sell
      setIsSelling(true);
      try {
        const txHash = await writeContractAsync({
          address: contracts.bondedItems.address,
          abi: BONDED_ITEMS_V7_ABI,
          functionName: 'sellToCurve',
          args: [BigInt(tokenId), tokenAmount, minWassOut],
        });

        await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
        });

        return txHash;
      } finally {
        setIsSelling(false);
      }
    },
    [writeContractAsync, publicClient, contracts.bondedItems.address, isApproved, approveForSelling, refetchApproval]
  );

  return {
    sellToCurve,
    hash,
    isPending: isPending || isApproving || isSelling,
    isApproving,
    isSelling,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useItemApprovalForMarketplace - Check/set approval for marketplace
// ═══════════════════════════════════════════════════════════════════════════

export function useItemApprovalForMarketplace() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();

  // Check if approved for marketplace
  const { data: isApproved, isLoading, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'isApprovedForAll',
    args: [address!, contracts.marketplace.address],
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const setApprovalForAll = useCallback(
    async (approved: boolean = true) => {
      const txHash = await writeContractAsync({
        address: contracts.bondedItems.address,
        abi: BONDED_ITEMS_V7_ABI,
        functionName: 'setApprovalForAll',
        args: [contracts.marketplace.address, approved],
      });

      // Wait for confirmation
      if (publicClient && txHash) {
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      return txHash;
    },
    [writeContractAsync, publicClient, contracts.bondedItems.address, contracts.marketplace.address]
  );

  return {
    isApproved: isApproved ?? false,
    isLoading,
    setApprovalForAll,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED HOOK - useItemsWithBalances
// ═══════════════════════════════════════════════════════════════════════════

export function useItemsWithBalances() {
  const { items, isLoading: itemsLoading, refetch: refetchItems } = useAllItems();
  const { balances, isLoading: balancesLoading, refetch: refetchBalances } = useUserItemBalances();
  const { stats, isLoading: statsLoading, refetch: refetchStats } = useGlobalStats();

  // Merge items with user balances
  const itemsWithBalances = useMemo(() => {
    return items.map(item => {
      const userBalance = balances.find(b => b.tokenId === item.tokenId);
      return {
        ...item,
        userBalance: userBalance?.balance || 0n,
      };
    });
  }, [items, balances]);

  // Filter by phase
  const presaleItems = useMemo(() =>
    itemsWithBalances.filter(i => i.phase === TokenPhase.Presale),
    [itemsWithBalances]
  );

  const tradingItems = useMemo(() =>
    itemsWithBalances.filter(i => i.phase === TokenPhase.BondingCurve),
    [itemsWithBalances]
  );

  const rareItems = useMemo(() =>
    itemsWithBalances.filter(i => i.phase === TokenPhase.RareItem),
    [itemsWithBalances]
  );

  const ownedItems = useMemo(() =>
    itemsWithBalances.filter(i => i.userBalance > 0n),
    [itemsWithBalances]
  );

  const refetch = useCallback(() => {
    refetchItems();
    refetchBalances();
    refetchStats();
  }, [refetchItems, refetchBalances, refetchStats]);

  return {
    items: itemsWithBalances,
    presaleItems,
    tradingItems,
    rareItems,
    ownedItems,
    stats,
    isLoading: itemsLoading || balancesLoading || statsLoading,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ITEM BRIDGE HOOKS - Bridge items to/from trait editor (v1.01)
// ═══════════════════════════════════════════════════════════════════════════
// ITEM_BRIDGE_ADDRESS is imported from @/abis/itemBridge

// Check if user has approved ItemBridge for BondedItems
export function useItemBridgeApproval() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);
  const publicClient = usePublicClient();

  const { data: isApproved, isLoading, refetch } = useReadContract({
    address: contracts.bondedItems.address,
    abi: BONDED_ITEMS_V7_ABI,
    functionName: 'isApprovedForAll',
    args: address ? [address, ITEM_BRIDGE_ADDRESS] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const { writeContractAsync, isPending, error, reset } = useWriteContract();

  const approve = useCallback(async () => {
    if (!publicClient) throw new Error('Public client not available');

    const txHash = await writeContractAsync({
      address: contracts.bondedItems.address,
      abi: BONDED_ITEMS_V7_ABI,
      functionName: 'setApprovalForAll',
      args: [ITEM_BRIDGE_ADDRESS, true],
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    await refetch();

    return txHash;
  }, [writeContractAsync, publicClient, contracts.bondedItems.address, refetch]);

  return {
    isApproved: isApproved ?? false,
    isLoading,
    approve,
    isPending,
    error,
    reset,
    refetch,
  };
}

// Get bridge cooldowns from API (fulfil and withdraw have 60s cooldowns)
export function useItemBridgeCooldown() {
  const { address } = useAccount();
  const [fulfilCooldown, setFulfilCooldown] = useState(0);
  const [withdrawCooldown, setWithdrawCooldown] = useState(0);
  const [canFulfil, setCanFulfil] = useState(true);
  const [canWithdraw, setCanWithdraw] = useState(true);

  const fetchCooldowns = useCallback(async () => {
    if (!address) return;

    try {
      // Fetch from inventory endpoint which includes cooldowns
      const res = await fetch(`${API_BASE}/api/item-bridge?action=inventory&address=${address}`);
      const data = await res.json();

      if (data.success && data.inventory) {
        setCanFulfil(data.inventory.fulfilCooldown?.canFulfil ?? true);
        setFulfilCooldown(data.inventory.fulfilCooldown?.remainingSeconds ?? 0);
        setCanWithdraw(data.inventory.withdrawCooldown?.canWithdraw ?? true);
        setWithdrawCooldown(data.inventory.withdrawCooldown?.remainingSeconds ?? 0);
      }
    } catch (err) {
      console.error('Failed to fetch cooldowns:', err);
    }
  }, [address]);

  useEffect(() => {
    fetchCooldowns();
  }, [fetchCooldowns]);

  // Countdown timer for cooldowns
  useEffect(() => {
    if (fulfilCooldown <= 0 && withdrawCooldown <= 0) return;

    const timer = setInterval(() => {
      setFulfilCooldown(prev => {
        const newVal = Math.max(0, prev - 1);
        if (newVal === 0) setCanFulfil(true);
        return newVal;
      });
      setWithdrawCooldown(prev => {
        const newVal = Math.max(0, prev - 1);
        if (newVal === 0) setCanWithdraw(true);
        return newVal;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [fulfilCooldown, withdrawCooldown]);

  return {
    fulfilCooldown,
    withdrawCooldown,
    cooldownRemaining: Math.max(fulfilCooldown, withdrawCooldown), // Backwards compat
    cooldownPeriod: 60,
    canFulfil,
    canWithdraw,
    canBridge: canFulfil, // Backwards compat
    isLoading: false,
    refetch: fetchCooldowns,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// useBridgeFee - Get ETH fee required for bridging items
// ═══════════════════════════════════════════════════════════════════════════

export function useBridgeFee(itemCount: number) {
  const { data: feeWei, isLoading, error, refetch } = useReadContract({
    address: ITEM_BRIDGE_ADDRESS,
    abi: ITEM_BRIDGE_ABI,
    functionName: 'getBridgeFee',
    args: [BigInt(Math.max(1, itemCount))],
    chainId: base.id,
    query: {
      enabled: itemCount > 0,
    },
  });

  // Add 2% buffer for price volatility (as recommended in docs)
  const feeWithBuffer = feeWei ? (feeWei * 102n) / 100n : 0n;

  return {
    feeWei: feeWei ?? 0n,
    feeWithBuffer,
    feeEth: feeWei ? Number(feeWei) / 1e18 : 0,
    feeEthWithBuffer: feeWithBuffer ? Number(feeWithBuffer) / 1e18 : 0,
    isLoading,
    error,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Bridge items in (deposit to trait editor) - v1.01: bridgeIn(tokenIds, amounts) payable
// ═══════════════════════════════════════════════════════════════════════════

export function useBridgeIn() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const bridgeIn = useCallback(
    async (tokenIds: number[], amounts: number[], feeWei: bigint) => {
      if (!publicClient) throw new Error('Public client not available');
      if (!address) throw new Error('Wallet not connected');
      if (tokenIds.length === 0) throw new Error('No items to deposit');
      if (tokenIds.length > 32) throw new Error('Max 32 items per deposit');
      if (tokenIds.length !== amounts.length) throw new Error('Arrays must match');

      // Add 2% buffer for price volatility
      const feeWithBuffer = (feeWei * 102n) / 100n;

      console.log('[useBridgeIn] Depositing items:', {
        tokenIds,
        amounts,
        feeWei: feeWei.toString(),
        feeWithBuffer: feeWithBuffer.toString(),
        feeEth: Number(feeWithBuffer) / 1e18,
      });

      // v1.01: bridgeIn(tokenIds, amounts) payable - MUST send ETH fee
      const txHash = await writeContractAsync({
        address: ITEM_BRIDGE_ADDRESS,
        abi: ITEM_BRIDGE_ABI,
        functionName: 'bridgeIn',
        args: [tokenIds.map(BigInt), amounts.map(BigInt)],
        value: feeWithBuffer, // <-- CRITICAL: Send ETH fee with transaction
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

      return txHash;
    },
    [writeContractAsync, publicClient, address]
  );

  return {
    bridgeIn,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// Fulfil bridge deposits - claim deposited items to server inventory via API
export function useFulfilBridge() {
  const { address } = useAccount();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fulfil = useCallback(async () => {
    if (!address) return { success: false, error: 'Wallet not connected' };

    setIsPending(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/item-bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fulfil', address }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Fulfil failed');
        return data;
      }

      return data;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Fulfil failed';
      setError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setIsPending(false);
    }
  }, [address]);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    fulfil,
    isPending,
    error,
    reset,
  };
}

// Request withdrawal from bridge - now via API (server executes on-chain bridgeOut)
export function useRequestWithdraw() {
  const { address } = useAccount();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestWithdraw = useCallback(
    async (tokenIds: number[], amounts: number[]) => {
      if (!address) throw new Error('Wallet not connected');
      if (tokenIds.length !== amounts.length) throw new Error('Array length mismatch');

      setIsPending(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/item-bridge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'withdraw',
            address,
            tokenIds,
            amounts,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          setError(data.error || 'Withdraw failed');
          if (data.cooldownError) {
            throw new Error(`Please wait ${data.remainingSeconds} seconds`);
          }
          throw new Error(data.error || 'Withdraw failed');
        }

        return data;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Withdraw failed';
        setError(errMsg);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [address]
  );

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    requestWithdraw,
    isPending,
    isWithdrawing: isPending, // Backwards compat alias
    error,
    reset,
  };
}

// Get user's bridged inventory from API
export interface BridgedBalance {
  address: string;
  balances: Record<number, number>;
  totalItems: number;
  fulfilCooldown?: { canFulfil: boolean; remainingSeconds: number };
  withdrawCooldown?: { canWithdraw: boolean; remainingSeconds: number };
}

export function useBridgedBalance() {
  const { address } = useAccount();
  const [balance, setBalance] = useState<BridgedBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!address) {
      setBalance(null);
      setIsLoading(false);
      return;
    }

    try {
      // Use the inventory endpoint as per itembridge.md
      const res = await fetch(`${API_BASE}/api/item-bridge?action=inventory&address=${address}`);
      const data = await res.json();
      if (data.success && data.inventory) {
        setBalance({
          address: data.inventory.address,
          balances: data.inventory.balances || {},
          totalItems: data.inventory.totalItems || 0,
          fulfilCooldown: data.inventory.fulfilCooldown,
          withdrawCooldown: data.inventory.withdrawCooldown,
        });
      }
    } catch (err) {
      console.error('Failed to fetch bridged balance:', err);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchBalance();
    // Refresh every 15 seconds (reduced from 10s to ease API load)
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  return {
    balance,
    isLoading,
    refetch: fetchBalance,
    hasItem: (tokenId: number, amount: number = 1) =>
      (balance?.balances[tokenId] ?? 0) >= amount,
  };
}

// Combined hook for item bridge
export function useItemBridge() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { isApproved, approve, isPending: isApproving, refetch: refetchApproval } = useItemBridgeApproval();
  const {
    cooldownRemaining,
    canBridge,
    canFulfil,
    canWithdraw,
    fulfilCooldown,
    withdrawCooldown,
    refetch: refetchCooldown,
  } = useItemBridgeCooldown();
  const { bridgeIn: bridgeInRaw, isPending: isBridgingIn, reset: resetBridgeIn } = useBridgeIn();
  const { fulfil, isPending: isFulfilling, reset: resetFulfil } = useFulfilBridge();
  const { requestWithdraw, isPending: isWithdrawing, reset: resetWithdraw } = useRequestWithdraw();
  const { balance: bridgedBalance, isLoading: balanceLoading, refetch: refetchBalance, hasItem } = useBridgedBalance();

  // Wrapper function that fetches the fee on-demand and passes it to bridgeIn
  const bridgeIn = useCallback(
    async (tokenIds: number[], amounts: number[]) => {
      if (!publicClient) throw new Error('Public client not available');

      // Calculate total item count (sum of all amounts)
      const totalItems = amounts.reduce((sum, amt) => sum + amt, 0);

      // Fetch the ETH fee from the contract
      const feeWei = await publicClient.readContract({
        address: ITEM_BRIDGE_ADDRESS,
        abi: ITEM_BRIDGE_ABI,
        functionName: 'getBridgeFee',
        args: [BigInt(totalItems)],
      }) as bigint;

      console.log('[useItemBridge] Fee for', totalItems, 'items:', {
        feeWei: feeWei.toString(),
        feeEth: Number(feeWei) / 1e18,
      });

      // Call the underlying bridgeIn with the fee
      return bridgeInRaw(tokenIds, amounts, feeWei);
    },
    [publicClient, bridgeInRaw]
  );

  const refetch = useCallback(() => {
    refetchApproval();
    refetchCooldown();
    refetchBalance();
  }, [refetchApproval, refetchCooldown, refetchBalance]);

  const reset = useCallback(() => {
    resetBridgeIn();
    resetFulfil();
    resetWithdraw();
  }, [resetBridgeIn, resetFulfil, resetWithdraw]);

  return {
    // State
    address,
    isApproved,
    canBridge,
    canFulfil,
    canWithdraw,
    cooldownRemaining,
    fulfilCooldown,
    withdrawCooldown,
    bridgedBalance: bridgedBalance?.balances ?? {},
    totalBridgedItems: bridgedBalance?.totalItems ?? 0,
    balanceLoading,

    // Actions
    approve,
    bridgeIn, // Now automatically fetches and sends the ETH fee
    fulfil, // Claim deposited items to server inventory
    requestWithdraw,
    refetch,
    reset,

    // Status
    isApproving,
    isBridgingIn,
    isFulfilling,
    isWithdrawing,
    isPending: isApproving || isBridgingIn || isFulfilling || isWithdrawing,

    // Helpers
    hasItem,
  };
}
