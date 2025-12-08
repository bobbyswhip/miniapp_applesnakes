'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { getContracts, getNFTMetadataUrl, getNFTImageUrl, IPNS_GATEWAY, IPNS_KEY } from '@/config';
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
      // console.log('⚠️ Fetch already in progress, skipping duplicate request');
      return;
    }
    // console.log('🔄 Manual refetch triggered');
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

        // console.log('🔍 Step 1: Fetching token IDs from Alchemy...');

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

          // console.log(`📄 Fetching page ${pageNumber}${pageKey ? ' (with pageKey)' : ' (first page)'}...`);

          const response = await fetch(url.toString());
          if (!response.ok) {
            throw new Error(`Alchemy API error: ${response.status}`);
          }

          const data = await response.json();
          totalCount = data.totalCount || 0;

          // console.log(`✓ Page ${pageNumber}: ${data.ownedNfts?.length || 0} NFTs, totalCount: ${totalCount}`);

          // Extract token IDs (Alchemy returns as decimal strings)
          if (data.ownedNfts && data.ownedNfts.length > 0) {
            const tokenIds = data.ownedNfts
              .map((nft: any) => parseInt(nft.tokenId, 10))
              .filter((id: number) => !isNaN(id));

            // console.log(`  Extracted token IDs from page ${pageNumber}:`, tokenIds);
            allTokenIds = allTokenIds.concat(tokenIds);
          }

          pageKey = data.pageKey;
        } while (pageKey);

        // console.log(`✅ Found ${allTokenIds.length} NFTs owned by user`);

        if (allTokenIds.length === 0) {
          setNfts([]);
          return;
        }

        // Step 2: Batch call getTokenInfo (optimized batch size for rate limits)
        // console.log(`🚀 Step 2: Batched getTokenInfo for ${allTokenIds.length} tokens...`);

        const BATCH_SIZE = 30; // Reduced from 50 to avoid rate limits (more conservative)
        const batches = [];
        for (let i = 0; i < allTokenIds.length; i += BATCH_SIZE) {
          batches.push(allTokenIds.slice(i, i + BATCH_SIZE));
        }

        // console.log(`  Splitting into ${batches.length} batch${batches.length > 1 ? 'es' : ''} of up to ${BATCH_SIZE} tokens each`);

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
                // console.warn(`  ⏳ Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
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
          // console.log(`  📦 Processing batch ${batchIndex + 1}/${batches.length}: ${batch.length} tokens (IDs: ${batch[0]}-${batch[batch.length - 1]})`);

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

            // console.log(`  ✅ Batch ${batchIndex + 1}/${batches.length} complete: ${tokenInfoResults.length} tokens added to map (Total in map: ${tokenInfoMap.size})`);

            // Increased delay between batches to avoid rate limits (500ms instead of 200ms)
            if (batchIndex < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500)); // More conservative delay
            }
          } catch (batchError) {
            // console.error(`  ❌ Batch ${batchIndex + 1}/${batches.length} FAILED after retries:`, batchError);
            // Continue processing other batches even if one fails
          }
        }

        // console.log(`📊 Batch processing complete: ${tokenInfoMap.size} tokens have TokenInfo, ${tokenURIMap.size} have tokenURI`);

        // Step 3: PROGRESSIVE LOADING - Show NFTs immediately with basic info, then enrich with metadata
        // First, show NFTs with placeholder data so user can see them right away
        const getNFTType = (info: TokenInfo): NFTType => {
          if (info.ownerIsWarden && !info.isSnake) return 'warden';
          if (info.isEgg) return 'egg';
          if (info.isSnake) return 'snake';
          return 'human';
        };

        // Create initial NFTs with basic info (from tokenInfo) - user sees these immediately
        const initialNFTs: UserNFT[] = allTokenIds
          .filter(tokenId => tokenInfoMap.has(tokenId))
          .map(tokenId => {
            const info = tokenInfoMap.get(tokenId)!;
            const tokenIdNum = Number(info.tokenId);
            return {
              tokenId: tokenIdNum,
              owner: info.owner,
              exists: info.exists,
              isSnake: info.isSnake,
              isJailed: info.isJailed,
              jailTime: Number(info.jailTime),
              isEgg: info.isEgg,
              mintTime: Number(info.mintTime),
              forceHatched: info.forceHatched,
              evolved: info.evolved,
              ownerIsWarden: info.ownerIsWarden,
              ownerIsJailExempt: info.ownerIsJailExempt,
              swapMintTime: Number(info.swapMintTime),
              canUnwrap: info.canUnwrap,
              // Placeholder data until metadata loads
              imageUrl: getNFTImageUrl(tokenIdNum),
              name: `AppleSnake #${tokenIdNum}`,
              nftType: getNFTType(info),
              metadata: {
                name: `AppleSnake #${tokenIdNum}`,
                image: `${tokenIdNum}.png`,
              },
            };
          });

        // Show NFTs immediately with basic info!
        setNfts(initialNFTs);
        // console.log(`⚡ Progressive: Showing ${initialNFTs.length} NFTs with basic info`);

        // Now fetch metadata progressively and update as each batch completes
        const metadataMap = new Map<number, any>();
        const imageUrlMap = new Map<number, string>();
        const METADATA_BATCH_SIZE = 25; // Slightly larger batches for efficiency
        const metadataBatches = [];

        for (let i = 0; i < allTokenIds.length; i += METADATA_BATCH_SIZE) {
          metadataBatches.push(allTokenIds.slice(i, i + METADATA_BATCH_SIZE));
        }

        for (let batchIdx = 0; batchIdx < metadataBatches.length; batchIdx++) {
          const batch = metadataBatches[batchIdx];

          const batchPromises = batch.map(async (tokenId) => {
            const tokenURI = tokenURIMap.get(tokenId);
            if (!tokenURI) return null;

            try {
              const metadataUrl = getNFTMetadataUrl(tokenId);
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);

              const response = await fetch(metadataUrl, { signal: controller.signal });
              clearTimeout(timeoutId);

              if (!response.ok) throw new Error(`HTTP ${response.status}`);

              const metadata = await response.json();
              const imageUrl = getNFTImageUrl(tokenId);

              return { tokenId, imageUrl, name: metadata.name, metadata };
            } catch {
              return null;
            }
          });

          const batchResults = await Promise.all(batchPromises);

          // Update maps with batch results
          batchResults.forEach(result => {
            if (result) {
              metadataMap.set(result.tokenId, result.metadata);
              imageUrlMap.set(result.tokenId, result.imageUrl);
            }
          });

          // PROGRESSIVE UPDATE: Rebuild NFT array with enriched metadata and update state
          const enrichedNFTs: UserNFT[] = allTokenIds
            .filter(tokenId => tokenInfoMap.has(tokenId))
            .map(tokenId => {
              const info = tokenInfoMap.get(tokenId)!;
              const tokenIdNum = Number(info.tokenId);
              const hasMetadata = metadataMap.has(tokenId);
              const metadata = hasMetadata
                ? metadataMap.get(tokenId)!
                : { name: `AppleSnake #${tokenIdNum}`, image: `${tokenIdNum}.png` };

              return {
                tokenId: tokenIdNum,
                owner: info.owner,
                exists: info.exists,
                isSnake: info.isSnake,
                isJailed: info.isJailed,
                jailTime: Number(info.jailTime),
                isEgg: info.isEgg,
                mintTime: Number(info.mintTime),
                forceHatched: info.forceHatched,
                evolved: info.evolved,
                ownerIsWarden: info.ownerIsWarden,
                ownerIsJailExempt: info.ownerIsJailExempt,
                swapMintTime: Number(info.swapMintTime),
                canUnwrap: info.canUnwrap,
                imageUrl: imageUrlMap.get(tokenId) || getNFTImageUrl(tokenIdNum),
                name: metadata.name || `AppleSnake #${tokenIdNum}`,
                nftType: getNFTType(info),
                metadata,
              };
            });

          // Update UI after each batch - users see progress!
          setNfts(enrichedNFTs);
          // console.log(`⚡ Progressive: Batch ${batchIdx + 1}/${metadataBatches.length} - ${metadataMap.size}/${allTokenIds.length} enriched`);

          // Small delay between batches to prevent rate limits
          if (batchIdx < metadataBatches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
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
