'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserNFT, NFTType } from './useUserNFTs';

/**
 * Cached NFT data from the backend API
 * Matches the structure from /api/nft-cache
 */
interface CachedNFT {
  tokenId: number;
  owner: string;
  isSnake: boolean;
  isJailed: boolean;
  jailTime: number;
  isEgg: boolean;
  mintTime: number;
  forceHatched: boolean;
  evolved: boolean;
  ownerIsWarden: boolean;
  ownerIsJailExempt: boolean;
  swapMintTime: number;
  canUnwrap: boolean;
  imageUrl: string;
  name: string;
  nftType: NFTType;
  metadata: Record<string, any>;
}

interface CacheStatus {
  lastFeesCollected: string;
  lastUpdated: number;
  totalCached: number;
  isRefreshing: boolean;
}

interface NFTCacheResponse {
  success: boolean;
  data: {
    nfts: CachedNFT[];
    totalHeld: number;
    cacheStatus: CacheStatus;
    fromCache: boolean;
  };
  rateLimit?: {
    limit: number;
    remaining: number;
    resetIn: number;
  };
  contracts?: {
    wTokensAddress: string;
    nftAddress: string;
    ipfsGateway: string;
  };
}

interface UseWTokensNFTsCacheResult {
  nfts: UserNFT[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  totalHeld: number;
  hasMore: boolean; // Always false for cache (all data in one response)
  cacheStatus: CacheStatus | null;
  rateLimitRemaining: number;
  rateLimitResetIn: number;
  fromCache: boolean;
}

/**
 * Hook to fetch wTokens NFTs from the cached API
 *
 * This is MUCH faster than the direct blockchain fetching approach:
 * - Old: 30-60+ seconds (multiple RPC calls + IPFS fetches)
 * - New: < 1 second (single cached API call)
 *
 * The cache automatically refreshes when totalFeesCollected changes on-chain.
 * Rate limited to 1 request per minute per IP.
 */
export function useWTokensNFTsCache(
  startAfterUserLoad = true,
  userNFTsLoading = false
): UseWTokensNFTsCacheResult {
  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalHeld, setTotalHeld] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(1);
  const [rateLimitResetIn, setRateLimitResetIn] = useState(60);
  const [fromCache, setFromCache] = useState(false);

  // Manual trigger to refetch
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Track if fetch is in progress to prevent duplicate requests
  const isFetchingRef = useRef(false);

  /**
   * Convert cached NFT format to UserNFT format for component compatibility
   */
  const convertToUserNFT = useCallback((cached: CachedNFT): UserNFT => {
    return {
      tokenId: cached.tokenId,
      imageUrl: cached.imageUrl,
      name: cached.name,
      nftType: cached.nftType,
      owner: cached.owner,
      exists: true, // If in cache, it exists
      isSnake: cached.isSnake,
      isJailed: cached.isJailed,
      jailTime: cached.jailTime,
      isEgg: cached.isEgg,
      mintTime: cached.mintTime,
      forceHatched: cached.forceHatched,
      evolved: cached.evolved,
      ownerIsWarden: cached.ownerIsWarden,
      ownerIsJailExempt: cached.ownerIsJailExempt,
      swapMintTime: cached.swapMintTime,
      canUnwrap: cached.canUnwrap,
      metadata: {
        name: cached.metadata?.name || cached.name,
        image: cached.metadata?.image || cached.imageUrl,
        description: cached.metadata?.description,
        attributes: cached.metadata?.attributes,
        ...cached.metadata,
      },
    };
  }, []);

  /**
   * Fetch NFTs from cached API
   */
  const fetchCachedNFTs = useCallback(async () => {
    if (isFetchingRef.current) {
      console.log('⏳ Cache fetch already in progress, skipping...');
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      console.log('🚀 Fetching wTokens NFTs from cache API...');
      const startTime = Date.now();

      const response = await fetch('/api/nft-cache');

      // Handle rate limiting
      if (response.status === 429) {
        const errorData = await response.json();
        const retryAfter = errorData.retryAfter || 60;
        setError(`Rate limited. Try again in ${retryAfter} seconds.`);
        setRateLimitRemaining(0);
        setRateLimitResetIn(retryAfter);
        console.log(`⏳ Rate limited, retry in ${retryAfter}s`);
        return;
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data: NFTCacheResponse = await response.json();

      if (data.success && data.data) {
        // Convert cached NFTs to UserNFT format
        const userNFTs = data.data.nfts.map(convertToUserNFT);

        setNfts(userNFTs);
        setTotalHeld(data.data.totalHeld);
        setCacheStatus(data.data.cacheStatus);
        setFromCache(data.data.fromCache);

        // Update rate limit info
        if (data.rateLimit) {
          setRateLimitRemaining(data.rateLimit.remaining);
          setRateLimitResetIn(data.rateLimit.resetIn);
        }

        const elapsed = Date.now() - startTime;
        console.log(`✅ Cache loaded ${userNFTs.length} NFTs in ${elapsed}ms (fromCache: ${data.data.fromCache})`);
      } else {
        throw new Error(data.data ? 'Unknown error' : 'No data returned');
      }
    } catch (err) {
      console.error('❌ Error fetching cached NFTs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [convertToUserNFT]);

  // Fetch NFTs when ready (after user NFTs load if configured)
  useEffect(() => {
    if (!startAfterUserLoad || !userNFTsLoading) {
      fetchCachedNFTs();
    }
  }, [userNFTsLoading, startAfterUserLoad, refetchTrigger, fetchCachedNFTs]);

  // Countdown for rate limit reset
  useEffect(() => {
    if (rateLimitResetIn > 0 && rateLimitRemaining === 0) {
      const timer = setInterval(() => {
        setRateLimitResetIn(prev => {
          if (prev <= 1) {
            setRateLimitRemaining(1);
            return 60;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [rateLimitResetIn, rateLimitRemaining]);

  const refetch = useCallback(() => {
    if (rateLimitRemaining > 0) {
      setRefetchTrigger(prev => prev + 1);
    } else {
      console.log(`⏳ Rate limited, wait ${rateLimitResetIn}s before refetching`);
    }
  }, [rateLimitRemaining, rateLimitResetIn]);

  return {
    nfts,
    isLoading,
    error,
    refetch,
    totalHeld,
    hasMore: false, // Cache returns all data at once
    cacheStatus,
    rateLimitRemaining,
    rateLimitResetIn,
    fromCache,
  };
}

/**
 * Helper to get full image URL from cached imageUrl
 * Handles both full URLs and IPFS hashes
 */
export function getWTokensImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http')) return imageUrl;
  // Prepend IPFS gateway for hash-only URLs
  return `https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${imageUrl}`;
}
