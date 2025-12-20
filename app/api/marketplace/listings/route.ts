import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { MARKETPLACE_ABI } from '@/abis/marketplace';
import { getNFTImageUrl } from '@/config/contracts';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MARKETPLACE_ADDRESS = '0xd006C1970AAcffcCAcAf6180Ad24081CdE608e82' as const;
const NFT_ADDRESS = '0xa85D49d8B7a041c339D18281a750dE3D7c15A628' as const;
const MAX_TOKEN_ID = 3000; // Max token ID to scan (AppleSnakes max supply)
const BATCH_SIZE = 100; // Batch size for getListingsBatch calls
const PAGE_SIZE = 100; // Page size for v2 getActiveListings

// NFT ABI for totalSupply and ownerOf
const NFT_ABI = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Helper to determine NFT type locally (same logic as frontend)
// Snake: tokenId % 10 === 0 OR tokenId > 3000
function getLocalNFTType(tokenId: number): 'human' | 'snake' {
  if (tokenId % 10 === 0 || tokenId > 3000) {
    return 'snake';
  }
  return 'human';
}

// Create public client for Base
function getClient() {
  const rpcUrl = process.env.NEXT_PUBLIC_COINBASE_RPC_KEY
    ? `https://api.developer.coinbase.com/rpc/v1/base/${process.env.NEXT_PUBLIC_COINBASE_RPC_KEY}`
    : process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : 'https://mainnet.base.org';

  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

// =============================================================================
// TYPES
// =============================================================================

interface ListingWithMetadata {
  collection: string;
  tokenId: string;
  seller: string;
  price: string;
  priceFormatted: string;
  active: boolean;
  name: string;
  imageUrl: string;
  nftType: 'human' | 'snake';
}

// =============================================================================
// OWNERSHIP VERIFICATION - Filter stale listings where seller != current owner
// =============================================================================

async function filterStaleListings(
  client: ReturnType<typeof getClient>,
  listings: ListingWithMetadata[],
  collection: `0x${string}`
): Promise<ListingWithMetadata[]> {
  if (listings.length === 0) return listings;

  // Batch ownership checks using multicall for efficiency
  const ownershipChecks = listings.map((listing) => ({
    address: collection,
    abi: NFT_ABI,
    functionName: 'ownerOf' as const,
    args: [BigInt(listing.tokenId)],
  }));

  try {
    const results = await client.multicall({
      contracts: ownershipChecks,
      allowFailure: true,
    });

    // Filter out listings where seller is not current owner
    return listings.filter((listing, index) => {
      const result = results[index];
      if (result.status === 'failure') {
        // Token might be burned or error - exclude it
        return false;
      }
      const currentOwner = (result.result as string).toLowerCase();
      const seller = listing.seller.toLowerCase();
      return currentOwner === seller;
    });
  } catch (error) {
    console.error('[Marketplace API] Ownership verification failed:', error);
    // If multicall fails, return all listings (fallback to old behavior)
    return listings;
  }
}

// =============================================================================
// V2 Method - Use paginated getActiveListings (efficient)
// =============================================================================

async function fetchListingsV2(
  client: ReturnType<typeof getClient>,
  collection: `0x${string}`
): Promise<ListingWithMetadata[]> {
  const allListings: ListingWithMetadata[] = [];
  let offset = 0;
  let total = 0;

  do {
    const result = await client.readContract({
      address: MARKETPLACE_ADDRESS,
      abi: MARKETPLACE_ABI,
      functionName: 'getActiveListings',
      args: [collection, BigInt(offset), BigInt(PAGE_SIZE)],
    });

    const [tokenIds, sellers, prices, totalCount] = result;
    total = Number(totalCount);

    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = Number(tokenIds[i]);
      const nftType = getLocalNFTType(tokenId);

      allListings.push({
        collection,
        tokenId: tokenId.toString(),
        seller: sellers[i],
        price: prices[i].toString(),
        priceFormatted: formatUnits(prices[i], 18),
        active: true,
        name: `AppleSnake #${tokenId}`,
        imageUrl: getNFTImageUrl(tokenId),
        nftType,
      });
    }

    offset += PAGE_SIZE;
  } while (offset < total);

  return allListings;
}

// =============================================================================
// V1 Method - Scan all token IDs with getListingsBatch (fallback for old contract)
// =============================================================================

async function fetchListingsV1(
  client: ReturnType<typeof getClient>,
  collection: `0x${string}`
): Promise<ListingWithMetadata[]> {
  // Get total supply to limit our scan
  let maxTokenId = MAX_TOKEN_ID;
  try {
    const totalSupply = await client.readContract({
      address: NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: 'totalSupply',
    });
    maxTokenId = Math.min(Number(totalSupply), MAX_TOKEN_ID);
  } catch {
    // Use default max if total supply fails
  }

  // Build all batch requests
  const batchPromises: Promise<{
    tokenIds: bigint[];
    result: readonly [readonly `0x${string}`[], readonly bigint[], readonly boolean[]] | null;
  }>[] = [];

  for (let start = 1; start <= maxTokenId; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, maxTokenId);
    const tokenIds = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));

    // Create promise for this batch
    const batchPromise = client.readContract({
      address: MARKETPLACE_ADDRESS,
      abi: MARKETPLACE_ABI,
      functionName: 'getListingsBatch',
      args: [collection, tokenIds],
    }).then(result => ({ tokenIds, result }))
      .catch(() => ({ tokenIds, result: null }));

    batchPromises.push(batchPromise);
  }

  // Execute all batch requests in parallel
  const batchResults = await Promise.all(batchPromises);

  // Process all results
  const allListings: ListingWithMetadata[] = [];

  for (const { tokenIds, result } of batchResults) {
    if (!result) continue;

    const [sellers, prices, actives] = result;

    // Process each listing in this batch - using local logic for speed
    for (let i = 0; i < tokenIds.length; i++) {
      if (actives[i] && prices[i] > 0n) {
        const tokenId = Number(tokenIds[i]);
        const nftType = getLocalNFTType(tokenId);

        allListings.push({
          collection,
          tokenId: tokenId.toString(),
          seller: sellers[i],
          price: prices[i].toString(),
          priceFormatted: formatUnits(prices[i], 18),
          active: true,
          name: `AppleSnake #${tokenId}`,
          imageUrl: getNFTImageUrl(tokenId),
          nftType,
        });
      }
    }
  }

  return allListings;
}

// =============================================================================
// GET - Fetch all active listings
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const client = getClient();
    const searchParams = request.nextUrl.searchParams;
    const collection = (searchParams.get('collection') as `0x${string}`) || NFT_ADDRESS;
    const skipOwnershipCheck = searchParams.get('skipOwnershipCheck') === 'true';

    let allListings: ListingWithMetadata[] = [];

    // Try v2 method first (efficient paginated query)
    try {
      allListings = await fetchListingsV2(client, collection);
    } catch (v2Error) {
      // V2 method failed (probably old contract), fall back to v1 scanning
      console.log('[Marketplace API] V2 getActiveListings failed, using v1 fallback:', v2Error);
      allListings = await fetchListingsV1(client, collection);
    }

    // Filter out stale listings where seller no longer owns the NFT
    // This ensures buyers don't see listings that can't be fulfilled
    if (!skipOwnershipCheck && allListings.length > 0) {
      const beforeCount = allListings.length;
      allListings = await filterStaleListings(client, allListings, collection);
      const filteredCount = beforeCount - allListings.length;
      if (filteredCount > 0) {
        console.log(`[Marketplace API] Filtered ${filteredCount} stale listings (seller != owner)`);
      }
    }

    // Sort by tokenId descending (newest first)
    allListings.sort((a, b) => Number(b.tokenId) - Number(a.tokenId));

    return NextResponse.json({
      success: true,
      listings: allListings,
      total: allListings.length,
    });
  } catch (error) {
    console.error('Error fetching marketplace listings:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch listings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Fetch listings for specific token IDs (used by useAllListings hook)
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { collection, tokenIds: tokenIdStrings } = body as {
      collection: `0x${string}`;
      tokenIds: string[];
    };

    if (!collection || !tokenIdStrings || tokenIdStrings.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing collection or tokenIds' },
        { status: 400 }
      );
    }

    const client = getClient();
    const tokenIds = tokenIdStrings.map((id) => BigInt(id));

    const result = await client.readContract({
      address: MARKETPLACE_ADDRESS,
      abi: MARKETPLACE_ABI,
      functionName: 'getListingsBatch',
      args: [collection, tokenIds],
    });

    const [sellers, prices, actives] = result;

    const listings = tokenIdStrings.map((tokenIdStr, i) => ({
      tokenId: tokenIdStr,
      seller: sellers[i],
      price: prices[i].toString(),
      active: actives[i],
    }));

    return NextResponse.json({
      success: true,
      listings,
    });
  } catch (error) {
    console.error('Error fetching batch listings:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch batch listings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
