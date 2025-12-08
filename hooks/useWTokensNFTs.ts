'use client';

import { useState, useEffect, useCallback } from 'react';
import { useReadContract, usePublicClient } from 'wagmi';
import { getContracts, getNFTMetadataUrl, getNFTImageUrl } from '@/config';
import { base } from 'wagmi/chains';
import type { UserNFT } from './useUserNFTs';

/**
 * Hook to fetch NFTs held by the wTokens contract
 * This is secondary data that loads after user NFTs
 * Fetches NFT IDs from contract and loads metadata the same way as user NFTs
 */

interface WTokensNFTsResult {
  nfts: UserNFT[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  totalHeld: number;
  hasMore: boolean;
}

export function useWTokensNFTs(startAfterUserLoad = true, userNFTsLoading = false): WTokensNFTsResult {
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);

  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalHeld, setTotalHeld] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Manual trigger to refetch (used by parent components)
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Fetch metadata for all wTokens NFTs with progressive loading
  const fetchWTokensNFTs = useCallback(async () => {
    if (!publicClient) return;

    setIsLoading(true);
    setError(null);
    setNfts([]); // Clear existing NFTs to show fresh loading

    try {
      console.log(`🔄 Starting progressive fetch for wTokens pool...`);

      const allFetchedNFTs: UserNFT[] = [];
      let currentOffset = 0;
      let hasMorePages = true;
      let totalHeldCount = 0;
      let pageNumber = 0;

      // Retry logic with exponential backoff for rate limit handling
      const retryWithBackoff = async <T,>(
        operation: () => Promise<T>,
        maxRetries: number = 4,
        baseDelay: number = 2000
      ): Promise<T> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await operation();
          } catch (error: any) {
            const isRateLimitError = error?.message?.includes('rate limit') ||
                                    error?.message?.includes('429') ||
                                    error?.cause?.status === 429;

            if (isRateLimitError && attempt < maxRetries) {
              const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
              console.warn(`  ⏳ Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              throw error; // Re-throw if not rate limit or max retries reached
            }
          }
        }
        throw new Error('Max retries exceeded');
      };

      // Progressive page processing - each page is fetched and displayed immediately
      while (hasMorePages) {
        pageNumber++;
        console.log(`\n📄 Processing page ${pageNumber}...`);

        // Step 1: Fetch page of token IDs (100 at a time)
        const pageData = await publicClient.readContract({
          address: contracts.wrapper.address,
          abi: contracts.wrapper.abi,
          functionName: 'getHeldNFTs',
          args: [contracts.nft.address, BigInt(currentOffset), BigInt(100)],
        }) as {
          tokenIds: readonly bigint[];
          totalHeld: bigint;
          returned: bigint;
          hasMore: boolean;
        };

        totalHeldCount = Number(pageData.totalHeld);
        const pageTokenIds = Array.from(pageData.tokenIds);
        hasMorePages = pageData.hasMore;

        console.log(`  ✅ Got ${pageTokenIds.length} token IDs (Total: ${currentOffset + pageTokenIds.length}/${totalHeldCount})`);
        setTotalHeld(totalHeldCount);
        setHasMore(hasMorePages);

        if (pageTokenIds.length === 0) break;

        // Step 2: Fetch tokenInfo for this page (single batch call)
        console.log(`  🔄 Fetching tokenInfo for page ${pageNumber}...`);
        const pageTokenInfos = await retryWithBackoff(async () => {
          return await publicClient.readContract({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'getTokenInfo',
            args: [pageTokenIds.map(id => Number(id))],
          }) as any[];
        });
        console.log(`  ✅ TokenInfo complete for page ${pageNumber}`);

        // Step 3: Process metadata in mini-batches for this page only
        const METADATA_BATCH_SIZE = 30;
        const pageNFTs: UserNFT[] = [];

        for (let i = 0; i < pageTokenInfos.length; i += METADATA_BATCH_SIZE) {
          const batch = pageTokenInfos.slice(i, i + METADATA_BATCH_SIZE);
          const batchNum = Math.floor(i / METADATA_BATCH_SIZE) + 1;
          const pageBatches = Math.ceil(pageTokenInfos.length / METADATA_BATCH_SIZE);

          console.log(`  📦 Page ${pageNumber} metadata batch ${batchNum}/${pageBatches} (${batch.length} NFTs)...`);

          try {
            // Small delay before RPC call to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));

            // Batch tokenURI calls with multicall
            const tokenURIResults = await retryWithBackoff(async () => {
              return await publicClient.multicall({
                contracts: batch.map(tokenInfo => ({
                  address: contracts.nft.address,
                  abi: contracts.nft.abi,
                  functionName: 'tokenURI' as const,
                  args: [BigInt(tokenInfo.tokenId)],
                })),
                allowFailure: true,
              });
            });

            // Map tokenURIs
            const tokenURIMap = new Map<number, string>();
            batch.forEach((tokenInfo, index) => {
              const result = tokenURIResults[index];
              if (result.status === 'success') {
                tokenURIMap.set(Number(tokenInfo.tokenId), result.result as string);
              }
            });

            // Fetch metadata from IPNS in parallel (always gets latest version)
            const batchPromises = batch.map(async (tokenInfo) => {
              try {
                const tokenId = Number(tokenInfo.tokenId);

                // Use IPNS for metadata - always gets latest version
                const metadataUrl = getNFTMetadataUrl(tokenId);
                const response = await fetch(metadataUrl);
                const metadata = await response.json();

                let nftType: 'human' | 'snake' | 'warden' | 'egg' = 'human';
                if (tokenInfo.isEgg) nftType = 'egg';
                else if (tokenInfo.isSnake) nftType = 'snake';
                else if (tokenInfo.ownerIsWarden) nftType = 'warden';

                // Use IPNS image URL - always gets latest version
                const imageUrl = getNFTImageUrl(tokenId);

                return {
                  tokenId,
                  imageUrl,
                  name: metadata.name || `#${tokenId}`,
                  nftType,
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
                  swapMintTime: Number(tokenInfo.swapMintTime || 0),
                  canUnwrap: tokenInfo.canUnwrap,
                  metadata,
                } as UserNFT;
              } catch (err) {
                return null;
              }
            });

            const batchResults = (await Promise.all(batchPromises)).filter((nft): nft is UserNFT => nft !== null);
            pageNFTs.push(...batchResults);

            // ✨ IMMEDIATE UI UPDATE - Users see NFTs as they load!
            allFetchedNFTs.push(...batchResults);
            setNfts([...allFetchedNFTs]);
            console.log(`  ✅ Batch ${batchNum}/${pageBatches}: +${batchResults.length} NFTs (Total visible: ${allFetchedNFTs.length}/${totalHeldCount})`);

            // Delay between metadata batches to prevent rate limits
            if (batchNum < pageBatches) {
              await new Promise(resolve => setTimeout(resolve, 800));
            }
          } catch (batchError) {
            console.error(`  ❌ Metadata batch failed:`, batchError);
          }
        }

        console.log(`✅ Page ${pageNumber} complete: +${pageNFTs.length} NFTs added`);

        // Move to next page
        currentOffset += pageTokenIds.length;

        // Safety check
        if (pageNumber > 100) {
          console.error('⚠️ Pagination exceeded 100 pages, stopping');
          break;
        }

        // Delay before next page to prevent rate limits
        if (hasMorePages) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`\n✅ ALL PAGES COMPLETE: ${allFetchedNFTs.length} of ${totalHeldCount} NFTs loaded`);
    } catch (err) {
      console.error('Error fetching wTokens NFTs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch wTokens NFTs');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, contracts.wrapper.address, contracts.nft.address]);

  // Fetch NFTs when ready (after user NFTs load if configured)
  useEffect(() => {
    if (publicClient && (!startAfterUserLoad || !userNFTsLoading)) {
      fetchWTokensNFTs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, userNFTsLoading, startAfterUserLoad, refetchTrigger]);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  return {
    nfts,
    isLoading,
    error,
    refetch,
    totalHeld,
    hasMore,
  };
}
 
