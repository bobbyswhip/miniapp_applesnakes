'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserNFT, NFTType } from './useUserNFTs';

// Direct API URL for wTokens status
const WTOKENS_API_URL = 'https://api.applesnakes.com/api/wtokens-status';

/**
 * NFT data from the wtokens-status API endpoint
 */
interface WTokensNFT {
  tokenId: number;
  imageUrl: string | null;
  imageCid: string;
  name: string;
  nftType: string;
  isSnake: boolean;
  isEgg: boolean;
  isJailed: boolean;
  canUnwrap: boolean;
}

/**
 * Response from wtokens-status endpoint
 */
interface WTokensStatusResponse {
  success: boolean;
  nfts: WTokensNFT[];
}

/**
 * Legacy cached NFT data format (for backwards compatibility)
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
   * Convert wTokens API NFT format to UserNFT format for component compatibility
   */
  const convertWTokensNFTToUserNFT = useCallback((nft: WTokensNFT): UserNFT => {
    // Use imageUrl directly if available (already full URL from applesnakes.myfilebase.com)
    // Fall back to imageCid with the correct gateway
    let imageUrl = '';
    if (nft.imageUrl) {
      imageUrl = nft.imageUrl;
    } else if (nft.imageCid) {
      imageUrl = `https://applesnakes.myfilebase.com/ipfs/${nft.imageCid}`;
    }

    return {
      tokenId: nft.tokenId,
      imageUrl: imageUrl,
      name: nft.name,
      nftType: nft.nftType as NFTType,
      owner: '', // wTokens contract owns these
      exists: true,
      isSnake: nft.isSnake,
      isJailed: nft.isJailed,
      jailTime: 0,
      isEgg: nft.isEgg,
      mintTime: 0,
      forceHatched: false,
      evolved: false,
      ownerIsWarden: false,
      ownerIsJailExempt: false,
      swapMintTime: 0,
      canUnwrap: nft.canUnwrap,
      metadata: {
        name: nft.name,
        image: imageUrl,
      },
    };
  }, []);

  /**
   * Convert legacy cached NFT format to UserNFT format (for backwards compatibility)
   */
  const convertToUserNFT = useCallback((cached: CachedNFT): UserNFT => {
    return {
      tokenId: cached.tokenId,
      imageUrl: cached.imageUrl,
      name: cached.name,
      nftType: cached.nftType,
      owner: cached.owner,
      exists: true,
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
   * Fetch NFTs from wTokens status API (primary) or fallback to nft-cache
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
      console.log('🚀 Fetching wTokens NFTs from wtokens-status API...');
      const startTime = Date.now();

      // Try the new direct API first
      const response = await fetch(WTOKENS_API_URL);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data: WTokensStatusResponse = await response.json();

      if (data.success && data.nfts) {
        // Convert wTokens NFTs to UserNFT format
        const userNFTs = data.nfts.map(convertWTokensNFTToUserNFT);

        setNfts(userNFTs);
        setTotalHeld(userNFTs.length);
        setCacheStatus({
          lastFeesCollected: '',
          lastUpdated: Date.now(),
          totalCached: userNFTs.length,
          isRefreshing: false,
        });
        setFromCache(true);

        const elapsed = Date.now() - startTime;
        console.log(`✅ wTokens API loaded ${userNFTs.length} NFTs in ${elapsed}ms`);
      } else {
        throw new Error('No NFTs returned from wtokens-status API');
      }
    } catch (err) {
      console.error('❌ Error fetching from wtokens-status, trying fallback...', err);

      // Fallback to legacy nft-cache endpoint
      try {
        const fallbackResponse = await fetch('/api/nft-cache');

        if (fallbackResponse.status === 429) {
          const errorData = await fallbackResponse.json();
          const retryAfter = errorData.retryAfter || 60;
          setError(`Rate limited. Try again in ${retryAfter} seconds.`);
          setRateLimitRemaining(0);
          setRateLimitResetIn(retryAfter);
          return;
        }

        if (!fallbackResponse.ok) {
          throw new Error(`Fallback API error: ${fallbackResponse.status}`);
        }

        const fallbackData: NFTCacheResponse = await fallbackResponse.json();

        if (fallbackData.success && fallbackData.data) {
          const userNFTs = fallbackData.data.nfts.map(convertToUserNFT);
          setNfts(userNFTs);
          setTotalHeld(fallbackData.data.totalHeld);
          setCacheStatus(fallbackData.data.cacheStatus);
          setFromCache(fallbackData.data.fromCache);

          if (fallbackData.rateLimit) {
            setRateLimitRemaining(fallbackData.rateLimit.remaining);
            setRateLimitResetIn(fallbackData.rateLimit.resetIn);
          }

          console.log(`✅ Fallback loaded ${userNFTs.length} NFTs`);
        } else {
          throw new Error('No data from fallback');
        }
      } catch (fallbackErr) {
        console.error('❌ Both APIs failed:', fallbackErr);
        setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
      }
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [convertWTokensNFTToUserNFT, convertToUserNFT]);

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
