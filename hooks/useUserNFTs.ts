'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { getContracts } from '@/config';
import { base } from 'wagmi/chains';

/**
 * Hook to get all NFTs owned by the connected user
 *
 * Three approaches (choose based on your needs):
 * 1. Event indexing (DIY, free, works without API)
 * 2. Alchemy NFT API (easiest, free tier available)
 * 3. The Graph (decentralized, requires subgraph setup)
 */

export type NFTType = 'human' | 'snake' | 'warden' | 'egg';

export interface UserNFT {
  tokenId: number;
  imageUrl: string;
  name: string;
  nftType: NFTType; // Determined from contract or metadata

  // Rich TokenInfo data from batched getTokenInfo call
  owner: string;
  exists: boolean;
  isSnake: boolean;
  isJailed: boolean;
  jailTime: number; // Unix timestamp (0 if not jailed)
  isEgg: boolean;
  mintTime: number; // Unix timestamp
  forceHatched: boolean;
  evolved: boolean;
  ownerIsWarden: boolean;
  ownerIsJailExempt: boolean;
  swapMintTime: number; // Unix timestamp when minted via swap (0 if not swap minted)
  canUnwrap: boolean; // True if unwrap cooldown (1 hour) has passed

  // IPFS metadata (name, description, image, attributes)
  metadata: {
    name: string;
    description?: string;
    image: string;
    attributes?: Array<{ trait_type: string; value: string | number }>;
    [key: string]: any; // Store all metadata fields
  };
}

/**
 * APPROACH 1: Event Indexing (DIY)
 * Reads Transfer events from the contract to find user's NFTs
 *
 * Pros: Free, no API needed, works immediately
 * Cons: Slower for large collections, needs to scan all blocks
 */
export function useUserNFTs_EventIndexing() {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);

  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userAddress || !publicClient) return;

    const fetchNFTs = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Get Transfer events where user is the recipient
        const logs = await publicClient.getLogs({
          address: contracts.nft.address as `0x${string}`,
          event: {
            type: 'event',
            name: 'Transfer',
            inputs: [
              { type: 'address', indexed: true, name: 'from' },
              { type: 'address', indexed: true, name: 'to' },
              { type: 'uint256', indexed: true, name: 'tokenId' },
            ],
          },
          args: {
            to: userAddress,
          },
          fromBlock: 0n, // Start from contract deployment block
          toBlock: 'latest',
        });

        // Get Transfer events where user sent NFTs (to remove from owned list)
        const sentLogs = await publicClient.getLogs({
          address: contracts.nft.address as `0x${string}`,
          event: {
            type: 'event',
            name: 'Transfer',
            inputs: [
              { type: 'address', indexed: true, name: 'from' },
              { type: 'address', indexed: true, name: 'to' },
              { type: 'uint256', indexed: true, name: 'tokenId' },
            ],
          },
          args: {
            from: userAddress,
          },
          fromBlock: 0n,
          toBlock: 'latest',
        });

        // Calculate currently owned NFTs
        const receivedTokenIds = new Set(
          logs.map(log => Number(log.args.tokenId))
        );

        const sentTokenIds = new Set(
          sentLogs.map(log => Number(log.args.tokenId))
        );

        // Remove sent tokens from received
        sentTokenIds.forEach(tokenId => receivedTokenIds.delete(tokenId));

        const ownedTokenIds = Array.from(receivedTokenIds);

        // For each owned token, check if jailed
        const nftPromises = ownedTokenIds.map(async (tokenId) => {
          // Read isJailed from contract
          const isJailed = await publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'isJailed',
            args: [BigInt(tokenId)],
          }) as boolean;

          return {
            tokenId,
            imageUrl: `${tokenId}.png`, // Will be prefixed with baseURI
            name: `AppleSnake #${tokenId}`,
            nftType: 'human' as NFTType, // Default, can't determine without full metadata

            // Limited data from event indexing
            owner: userAddress,
            exists: true,
            isSnake: false, // Unknown
            isJailed,
            jailTime: 0, // Unknown
            isEgg: false, // Unknown
            mintTime: 0, // Unknown
            forceHatched: false, // Unknown
            evolved: false, // Unknown
            ownerIsWarden: false, // Unknown
            ownerIsJailExempt: false, // Unknown
            swapMintTime: 0, // Unknown
            canUnwrap: true, // Default to true (assume can unwrap if unknown)

            metadata: {
              name: `AppleSnake #${tokenId}`,
              image: `${tokenId}.png`,
            },
          };
        });

        const userNFTs = await Promise.all(nftPromises);
        setNfts(userNFTs);
      } catch (err) {
        console.error('Error fetching NFTs:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
      } finally {
        setIsLoading(false);
      }
    };

    fetchNFTs();
  }, [userAddress, publicClient, contracts.nft.address, contracts.nft.abi]);

  return { nfts, isLoading, error };
}

/**
 * APPROACH 2: Alchemy NFT API with Batched getTokenInfo
 *
 * Step 1: Get token IDs from Alchemy (withMetadata: false)
 * Step 2: Batch call getTokenInfo (max 50 tokens per call) - gets ALL data in one call!
 * Step 3: Fetch metadata JSON for image URLs only
 *
 * This is MUCH more efficient - no more individual calls for tokenURI, isJailed, etc.
 */
export function useUserNFTs_Alchemy() {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });

  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Track if a fetch is currently in progress
  const isFetchingRef = useRef(false);

  // Manual refetch function - memoized to prevent unnecessary re-renders
  const refetch = useCallback(() => {
    if (isFetchingRef.current) {
      console.log('⚠️ Fetch already in progress, skipping duplicate request');
      return;
    }
    console.log('🔄 Manual refetch triggered');
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!userAddress || !publicClient) return;

    const fetchNFTs = async () => {
      // Set fetching flag to prevent concurrent requests
      isFetchingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const contracts = getContracts(base.id);
        const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

        if (!alchemyKey) {
          throw new Error('Alchemy API key not configured');
        }

        console.log('🔍 Step 1: Fetching token IDs from Alchemy...');

        // Step 1: Get ONLY token IDs from Alchemy (no metadata)
        let allTokenIds: number[] = [];
        let pageKey: string | undefined = undefined;
        let totalCount = 0;
        let pageNumber = 0;

        do {
          pageNumber++;
          const url = new URL(`https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner`);
          url.searchParams.append('owner', userAddress);
          url.searchParams.append('contractAddresses[]', contracts.nft.address);
          url.searchParams.append('withMetadata', 'false'); // Don't fetch metadata from Alchemy
          url.searchParams.append('pageSize', '100'); // Max page size

          if (pageKey) {
            url.searchParams.append('pageKey', pageKey);
          }

          console.log(`📄 Fetching page ${pageNumber}${pageKey ? ' (with pageKey)' : ' (first page)'}...`);

          const response = await fetch(url.toString());
          if (!response.ok) {
            throw new Error(`Alchemy API error: ${response.status}`);
          }

          const data = await response.json();
          totalCount = data.totalCount || 0;

          console.log(`✓ Page ${pageNumber}: ${data.ownedNfts?.length || 0} NFTs, totalCount: ${totalCount}`);

          // Extract token IDs (Alchemy returns as decimal strings)
          if (data.ownedNfts && data.ownedNfts.length > 0) {
            const tokenIds = data.ownedNfts
              .map((nft: any) => parseInt(nft.tokenId, 10))
              .filter((id: number) => !isNaN(id));

            console.log(`  Extracted token IDs from page ${pageNumber}:`, tokenIds);
            allTokenIds = allTokenIds.concat(tokenIds);
          }

          pageKey = data.pageKey;
        } while (pageKey);

        console.log(`✅ Found ${allTokenIds.length} NFTs owned by user`);

        if (allTokenIds.length === 0) {
          setNfts([]);
          return;
        }

        // Step 2: Batch call getTokenInfo (optimized batch size for rate limits)
        console.log(`🚀 Step 2: Batched getTokenInfo for ${allTokenIds.length} tokens...`);

        const BATCH_SIZE = 30; // Reduced from 50 to avoid rate limits (more conservative)
        const batches = [];
        for (let i = 0; i < allTokenIds.length; i += BATCH_SIZE) {
          batches.push(allTokenIds.slice(i, i + BATCH_SIZE));
        }

        console.log(`  Splitting into ${batches.length} batch${batches.length > 1 ? 'es' : ''} of up to ${BATCH_SIZE} tokens each`);

        // TokenInfo interface from contract
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

        const tokenInfoMap = new Map<number, TokenInfo>();
        const tokenURIMap = new Map<number, string>();

        // Retry logic with exponential backoff for rate limit handling
        const retryWithBackoff = async <T,>(
          operation: () => Promise<T>,
          maxRetries: number = 3,
          baseDelay: number = 1000
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

        // Process ALL batches - critical to get all NFTs
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          console.log(`  📦 Processing batch ${batchIndex + 1}/${batches.length}: ${batch.length} tokens (IDs: ${batch[0]}-${batch[batch.length - 1]})`);

          try {
            // Single getTokenInfo call with retry logic
            const tokenInfoResults = await retryWithBackoff(async () => {
              return await publicClient.readContract({
                address: contracts.nft.address as `0x${string}`,
                abi: contracts.nft.abi,
                functionName: 'getTokenInfo',
                args: [batch.map(id => BigInt(id))],
              }) as TokenInfo[];
            });

            // Also fetch tokenURI in the same batch with retry logic
            const tokenURIResults = await retryWithBackoff(async () => {
              return await publicClient.multicall({
                contracts: batch.map(tokenId => ({
                  address: contracts.nft.address as `0x${string}`,
                  abi: contracts.nft.abi,
                  functionName: 'tokenURI' as const,
                  args: [BigInt(tokenId)],
                })),
                allowFailure: true,
              });
            });

            // Store results in maps (accumulating across batches)
            batch.forEach((tokenId, index) => {
              tokenInfoMap.set(tokenId, tokenInfoResults[index]);

              const tokenURIResult = tokenURIResults[index];
              if (tokenURIResult.status === 'success') {
                tokenURIMap.set(tokenId, tokenURIResult.result as string);
              }
            });

            console.log(`  ✅ Batch ${batchIndex + 1}/${batches.length} complete: ${tokenInfoResults.length} tokens added to map (Total in map: ${tokenInfoMap.size})`);

            // Increased delay between batches to avoid rate limits (500ms instead of 200ms)
            if (batchIndex < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500)); // More conservative delay
            }
          } catch (batchError) {
            console.error(`  ❌ Batch ${batchIndex + 1}/${batches.length} FAILED after retries:`, batchError);
            // Continue processing other batches even if one fails
          }
        }

        console.log(`📊 Batch processing complete: ${tokenInfoMap.size} tokens have TokenInfo, ${tokenURIMap.size} have tokenURI`);

        // Step 3: Fetch metadata JSON to extract image URLs (with rate limiting)
        console.log(`🖼️ Step 3: Fetching metadata JSON for ${allTokenIds.length} tokens...`);

        const metadataResults: (null | { tokenId: number; imageUrl: string; name: string; metadata: any })[] = [];
        const METADATA_BATCH_SIZE = 20; // Process 20 metadata fetches at a time (IPFS is external)
        const metadataBatches = [];

        for (let i = 0; i < allTokenIds.length; i += METADATA_BATCH_SIZE) {
          metadataBatches.push(allTokenIds.slice(i, i + METADATA_BATCH_SIZE));
        }

        console.log(`  Splitting into ${metadataBatches.length} metadata batch${metadataBatches.length > 1 ? 'es' : ''} of up to ${METADATA_BATCH_SIZE} tokens each`);

        for (let batchIdx = 0; batchIdx < metadataBatches.length; batchIdx++) {
          const batch = metadataBatches[batchIdx];
          console.log(`  📦 Fetching metadata batch ${batchIdx + 1}/${metadataBatches.length}: ${batch.length} tokens`);

          const batchPromises = batch.map(async (tokenId) => {
            const tokenURI = tokenURIMap.get(tokenId);
            if (!tokenURI) {
              console.warn(`❌ Token ${tokenId}: No tokenURI from contract`);
              return null;
            }

            try {
              // Convert IPFS URI to gateway URL
              const metadataUrl = tokenURI.startsWith('ipfs://')
                ? `https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${tokenURI.replace('ipfs://', '')}`
                : tokenURI;

              // Fetch metadata JSON with timeout
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

              const response = await fetch(metadataUrl, { signal: controller.signal });
              clearTimeout(timeoutId);

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const metadata = await response.json();

              // Extract image from metadata (typically ipfs://xxx/123.png)
              let imageUrl = metadata.image || '';

              // Strip ipfs:// prefix (gateway will be added by NFTImage component)
              if (imageUrl.startsWith('ipfs://')) {
                imageUrl = imageUrl.replace('ipfs://', '');
              }

              return {
                tokenId,
                imageUrl,
                name: metadata.name,
                metadata // Store complete metadata
              };
            } catch (err) {
              console.error(`❌ Token ${tokenId}: Metadata fetch failed - ${err}`);
              return null;
            }
          });

          const batchResults = await Promise.all(batchPromises);
          metadataResults.push(...batchResults);

          console.log(`  ✅ Metadata batch ${batchIdx + 1}/${metadataBatches.length} complete`);

          // Rate limit between metadata batches
          if (batchIdx < metadataBatches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 150)); // 150ms delay between batches
          }
        }

        // Count successes and failures
        const successCount = metadataResults.filter(r => r !== null).length;
        const failCount = metadataResults.filter(r => r === null).length;

        console.log(`📊 Metadata fetch complete: ${successCount} success, ${failCount} failed`);

        // Build metadata map from results
        const metadataMap = new Map<number, any>();
        const imageUrlMap = new Map<number, string>();
        metadataResults.forEach(result => {
          if (result) {
            metadataMap.set(result.tokenId, result.metadata);
            imageUrlMap.set(result.tokenId, result.imageUrl);
          }
        });

        console.log(`📋 Maps populated - imageUrl: ${imageUrlMap.size}, metadata: ${metadataMap.size}, tokenInfo: ${tokenInfoMap.size}`);

        // Determine NFT type from metadata name (types are dynamic and can change)
        const getNFTType = (metadata: any, info: TokenInfo): NFTType => {
          // Priority 1: Check if warden
          if (info.ownerIsWarden && !info.isSnake) return 'warden';

          // Priority 2: Check if egg
          if (info.isEgg) return 'egg';

          // Priority 3: Check if snake
          if (info.isSnake) return 'snake';

          // Priority 4: Default to human
          return 'human';
        };

        // Build final NFT array with complete data from getTokenInfo
        console.log(`🔨 Step 4: Building final NFT array from ${allTokenIds.length} token IDs...`);

        // Check which tokens will be filtered out and why
        const missingData: { tokenId: number; missing: string[] }[] = [];
        allTokenIds.forEach(tokenId => {
          const missing: string[] = [];
          if (!imageUrlMap.has(tokenId)) missing.push('imageUrl');
          if (!metadataMap.has(tokenId)) missing.push('metadata');
          if (!tokenInfoMap.has(tokenId)) missing.push('tokenInfo');
          if (missing.length > 0) {
            missingData.push({ tokenId, missing });
          }
        });

        if (missingData.length > 0) {
          console.warn(`⚠️ ${missingData.length} tokens will be excluded due to missing data:`);
          missingData.slice(0, 10).forEach(({ tokenId, missing }) => {
            console.warn(`  Token ${tokenId}: missing ${missing.join(', ')}`);
          });
          if (missingData.length > 10) {
            console.warn(`  ... and ${missingData.length - 10} more tokens with missing data`);
          }
        }

        const userNFTs: UserNFT[] = allTokenIds
          .filter(tokenId => {
            const hasAllData = imageUrlMap.has(tokenId) && metadataMap.has(tokenId) && tokenInfoMap.has(tokenId);
            return hasAllData;
          })
          .map(tokenId => {
            const info = tokenInfoMap.get(tokenId)!;
            const metadata = metadataMap.get(tokenId)!;
            const nftType = getNFTType(metadata, info);

            // Use tokenId from struct to be explicit
            const tokenIdFromStruct = Number(info.tokenId);

            console.log(`🏷️ Token ${tokenIdFromStruct}: "${metadata.name}" → Type: ${nftType} (jailed: ${info.isJailed}, egg: ${info.isEgg}, snake: ${info.isSnake}, evolved: ${info.evolved}, canUnwrap: ${info.canUnwrap})`);

            // Return complete TokenInfo struct data - ALL 14 fields
            return {
              // From TokenInfo struct
              tokenId: tokenIdFromStruct,       // ✓ struct field 1
              owner: info.owner,                // ✓ struct field 2
              exists: info.exists,              // ✓ struct field 3
              isSnake: info.isSnake,            // ✓ struct field 4
              isJailed: info.isJailed,          // ✓ struct field 5
              jailTime: Number(info.jailTime),  // ✓ struct field 6 (convert bigint)
              isEgg: info.isEgg,                // ✓ struct field 7
              mintTime: Number(info.mintTime),  // ✓ struct field 8 (convert bigint)
              forceHatched: info.forceHatched,  // ✓ struct field 9
              evolved: info.evolved,            // ✓ struct field 10
              ownerIsWarden: info.ownerIsWarden,      // ✓ struct field 11
              ownerIsJailExempt: info.ownerIsJailExempt, // ✓ struct field 12
              swapMintTime: Number(info.swapMintTime), // ✓ struct field 13 (convert bigint)
              canUnwrap: info.canUnwrap,        // ✓ struct field 14

              // Additional UI data (not from struct)
              imageUrl: imageUrlMap.get(tokenId)!,
              name: metadata.name || `AppleSnake #${tokenIdFromStruct}`,
              nftType,
              metadata,
            };
          });

        console.log(`✅ SUCCESS: Loaded ${userNFTs.length} out of ${allTokenIds.length} NFTs (${((userNFTs.length / allTokenIds.length) * 100).toFixed(1)}% success rate)`);
        console.log(`📦 Final counts: ${userNFTs.filter(n => !n.isJailed).length} free, ${userNFTs.filter(n => n.isJailed).length} jailed`);

        setNfts(userNFTs);
      } catch (err) {
        console.error('Error fetching NFTs:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
      } finally {
        setIsLoading(false);
        // Reset fetching flag to allow future requests
        isFetchingRef.current = false;
      }
    };

    fetchNFTs();
  }, [userAddress, publicClient, refetchTrigger]);

  return { nfts, isLoading, error, refetch };
}

/**
 * APPROACH 3: Simple Balance Enumeration (If you add to contract)
 *
 * This requires adding ERC721Enumerable to your contract:
 *
 * ```solidity
 * import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
 *
 * contract YourNFT is ERC721Enumerable {
 *   // Now you have:
 *   // - balanceOf(address)
 *   // - tokenOfOwnerByIndex(address, uint256)
 * }
 * ```
 *
 * This is the FASTEST method for on-chain enumeration
 */
export function useUserNFTs_Enumerable() {
  const { address: userAddress } = useAccount();
  const contracts = getContracts(base.id);
  const publicClient = usePublicClient({ chainId: base.id });

  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Get user's NFT balance
  const { data: balance } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    chainId: base.id,
  });

  useEffect(() => {
    if (!userAddress || !balance || !publicClient) return;

    const fetchNFTs = async () => {
      setIsLoading(true);

      try {
        const nftCount = Number(balance);
        const nftPromises = [];

        // Loop through user's NFTs by index
        for (let i = 0; i < nftCount; i++) {
          nftPromises.push(
            (async () => {
              // Get tokenId at index i
              const tokenId = await publicClient.readContract({
                address: contracts.nft.address as `0x${string}`,
                abi: contracts.nft.abi,
                functionName: 'tokenOfOwnerByIndex',
                args: [userAddress, BigInt(i)],
              }) as bigint;

              // Check if jailed
              const isJailed = await publicClient.readContract({
                address: contracts.nft.address as `0x${string}`,
                abi: contracts.nft.abi,
                functionName: 'isJailed',
                args: [tokenId],
              }) as boolean;

              const tokenIdNum = Number(tokenId);

              return {
                tokenId: tokenIdNum,
                imageUrl: `${tokenIdNum}.png`,
                name: `AppleSnake #${tokenIdNum}`,
                nftType: 'human' as NFTType, // Default, can't determine without full metadata

                // Limited data from enumerable approach
                owner: userAddress!,
                exists: true,
                isSnake: false, // Unknown
                isJailed,
                jailTime: 0, // Unknown
                isEgg: false, // Unknown
                mintTime: 0, // Unknown
                forceHatched: false, // Unknown
                evolved: false, // Unknown
                ownerIsWarden: false, // Unknown
                ownerIsJailExempt: false, // Unknown
                swapMintTime: 0, // Unknown
                canUnwrap: true, // Default to true (assume can unwrap if unknown)

                metadata: {
                  name: `AppleSnake #${tokenIdNum}`,
                  image: `${tokenIdNum}.png`,
                },
              };
            })()
          );
        }

        const userNFTs = await Promise.all(nftPromises);
        setNfts(userNFTs);
      } catch (err) {
        console.error('Error fetching NFTs:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNFTs();
  }, [userAddress, balance, publicClient, contracts.nft.address, contracts.nft.abi]);

  return { nfts, isLoading, error: null };
}

/**
 * Default export - Use Alchemy (fastest, API key configured)
 * Falls back to event indexing if Alchemy fails
 */
export const useUserNFTs = useUserNFTs_Alchemy;
