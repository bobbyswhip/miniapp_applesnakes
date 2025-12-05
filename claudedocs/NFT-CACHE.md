# NFT Cache Implementation Guide

## Overview

This guide explains how to migrate your frontend from direct blockchain/IPFS fetching to using the new cached NFT API. The cache dramatically improves load times by:

1. **Pre-fetching all NFT data** from blockchain and IPFS
2. **Storing in SQLite database** on the server
3. **Smart cache invalidation** based on `totalFeesCollected` from wTokens contract
4. **Rate limiting** to 1 request per minute per IP

## API Endpoint

### GET `/api/nft-cache`

Returns all cached NFT holdings from the wTokens wrapper contract.

**Rate Limit**: 1 request per minute per IP

**Response**:
```json
{
  "success": true,
  "data": {
    "nfts": [
      {
        "tokenId": 123,
        "owner": "0x038b70E9311D5aE12C816c32818aeec90cBe7C29",
        "isSnake": false,
        "isJailed": false,
        "jailTime": 0,
        "isEgg": false,
        "mintTime": 1699123456,
        "forceHatched": false,
        "evolved": true,
        "ownerIsWarden": false,
        "ownerIsJailExempt": false,
        "swapMintTime": 0,
        "canUnwrap": true,
        "imageUrl": "QmXXX.../123.png",
        "name": "AppleSnake #123",
        "nftType": "human",
        "metadata": {
          "name": "AppleSnake #123",
          "description": "...",
          "attributes": [...]
        }
      }
    ],
    "totalHeld": 250,
    "cacheStatus": {
      "lastFeesCollected": "1234567890000000000",
      "lastUpdated": 1699123456789,
      "totalCached": 250,
      "isRefreshing": false
    },
    "fromCache": true
  },
  "rateLimit": {
    "limit": 1,
    "remaining": 0,
    "resetIn": 60
  },
  "contracts": {
    "wTokensAddress": "0x038b70E9311D5aE12C816c32818aeec90cBe7C29",
    "nftAddress": "0xa85D49d8B7a041c339D18281a750dE3D7c15A628",
    "ipfsGateway": "https://surrounding-amaranth-catshark.myfilebase.com/ipfs/"
  }
}
```

**Error Response (429 Rate Limited)**:
```json
{
  "error": "Rate limit exceeded",
  "message": "Rate limit exceeded: too many requests per minute",
  "retryAfter": 45,
  "limits": {
    "perSecond": { "current": 1, "max": 1 },
    "perMinute": { "current": 1, "max": 1 }
  }
}
```

## Frontend Implementation

### 1. Create the API Hook

Replace `useWTokensNFTs` with a new hook that calls the cached API:

```typescript
// hooks/useWTokensNFTsCache.ts
import { useState, useEffect, useCallback } from 'react';

export interface CachedNFT {
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
  nftType: 'human' | 'snake' | 'warden' | 'egg';
  metadata: Record<string, any>;
}

interface CacheStatus {
  lastFeesCollected: string;
  lastUpdated: number;
  totalCached: number;
  isRefreshing: boolean;
}

interface UseWTokensNFTsCacheResult {
  nfts: CachedNFT[];
  totalHeld: number;
  cacheStatus: CacheStatus | null;
  isLoading: boolean;
  error: string | null;
  rateLimitRemaining: number;
  rateLimitResetIn: number;
  refresh: () => Promise<void>;
  fromCache: boolean;
}

// IPFS gateway for displaying images
const IPFS_GATEWAY = 'https://surrounding-amaranth-catshark.myfilebase.com/ipfs/';

export function useWTokensNFTsCache(): UseWTokensNFTsCacheResult {
  const [nfts, setNfts] = useState<CachedNFT[]>([]);
  const [totalHeld, setTotalHeld] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(1);
  const [rateLimitResetIn, setRateLimitResetIn] = useState(60);
  const [fromCache, setFromCache] = useState(false);

  const fetchNFTs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/nft-cache');

      if (response.status === 429) {
        const errorData = await response.json();
        setError(`Rate limited. Try again in ${errorData.retryAfter} seconds.`);
        setRateLimitRemaining(0);
        setRateLimitResetIn(errorData.retryAfter || 60);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setNfts(data.data.nfts);
        setTotalHeld(data.data.totalHeld);
        setCacheStatus(data.data.cacheStatus);
        setFromCache(data.data.fromCache);
        setRateLimitRemaining(data.rateLimit?.remaining ?? 0);
        setRateLimitResetIn(data.rateLimit?.resetIn ?? 60);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNFTs();
  }, [fetchNFTs]);

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

  return {
    nfts,
    totalHeld,
    cacheStatus,
    isLoading,
    error,
    rateLimitRemaining,
    rateLimitResetIn,
    refresh: fetchNFTs,
    fromCache,
  };
}

/**
 * Helper to get full image URL from cached imageUrl
 */
export function getImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http')) return imageUrl;
  return `${IPFS_GATEWAY}${imageUrl}`;
}
```

### 2. Component Example

```tsx
// components/WTokensNFTGrid.tsx
import { useWTokensNFTsCache, getImageUrl } from '@/hooks/useWTokensNFTsCache';
import Image from 'next/image';

export function WTokensNFTGrid() {
  const {
    nfts,
    totalHeld,
    cacheStatus,
    isLoading,
    error,
    rateLimitRemaining,
    rateLimitResetIn,
    refresh,
    fromCache,
  } = useWTokensNFTsCache();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        <span className="ml-3">Loading NFTs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4">
        <p className="text-red-200">{error}</p>
        {rateLimitRemaining === 0 && (
          <p className="text-sm text-red-300 mt-2">
            Rate limited. Reset in {rateLimitResetIn}s
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header with cache status */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">wTokens Holdings</h2>
          <p className="text-sm text-gray-400">
            {totalHeld} NFTs in wrapper
            {fromCache && (
              <span className="ml-2 text-green-400">(cached)</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Cache status */}
          {cacheStatus && (
            <div className="text-xs text-gray-500">
              Updated: {new Date(cacheStatus.lastUpdated).toLocaleTimeString()}
            </div>
          )}

          {/* Refresh button with rate limit indicator */}
          <button
            onClick={refresh}
            disabled={rateLimitRemaining === 0 || isLoading}
            className={`px-4 py-2 rounded ${
              rateLimitRemaining > 0
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-600 cursor-not-allowed'
            }`}
          >
            {rateLimitRemaining === 0
              ? `Refresh (${rateLimitResetIn}s)`
              : 'Refresh'}
          </button>
        </div>
      </div>

      {/* NFT Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {nfts.map((nft) => (
          <NFTCard key={nft.tokenId} nft={nft} />
        ))}
      </div>
    </div>
  );
}

function NFTCard({ nft }: { nft: CachedNFT }) {
  const imageUrl = getImageUrl(nft.imageUrl);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Image */}
      <div className="aspect-square relative">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={nft.name}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full bg-gray-700 flex items-center justify-center">
            <span className="text-gray-500">No Image</span>
          </div>
        )}

        {/* Type badge */}
        <div
          className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-bold ${
            nft.nftType === 'snake'
              ? 'bg-green-600'
              : nft.nftType === 'warden'
              ? 'bg-purple-600'
              : nft.nftType === 'egg'
              ? 'bg-yellow-600'
              : 'bg-blue-600'
          }`}
        >
          {nft.nftType}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold truncate">{nft.name}</h3>
        <p className="text-xs text-gray-400">#{nft.tokenId}</p>

        {/* Status indicators */}
        <div className="flex gap-1 mt-2">
          {nft.isJailed && (
            <span className="text-xs bg-red-600 px-1 rounded">Jailed</span>
          )}
          {nft.evolved && (
            <span className="text-xs bg-green-600 px-1 rounded">Evolved</span>
          )}
          {nft.canUnwrap && (
            <span className="text-xs bg-blue-600 px-1 rounded">Unwrappable</span>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 3. Migration from Old Hook

**Before (slow)**:
```typescript
// OLD: Direct blockchain + IPFS fetching
import { useWTokensNFTs } from '@/hooks/useWTokensNFTs';

function MyComponent() {
  const { nfts, isLoading, progress } = useWTokensNFTs();
  // This fetches from blockchain + IPFS on every page load
  // Takes 30-60+ seconds for large collections
}
```

**After (fast)**:
```typescript
// NEW: Cached API
import { useWTokensNFTsCache } from '@/hooks/useWTokensNFTsCache';

function MyComponent() {
  const { nfts, isLoading, cacheStatus } = useWTokensNFTsCache();
  // This fetches from cache (instant)
  // Only refreshes when totalFeesCollected changes
}
```

## Cache Invalidation

The cache automatically refreshes when:

1. **`totalFeesCollected` changes** - This indicates wrap/unwrap/swap activity
2. **Manual refresh** - Admin can POST to `/api/nft-cache` with `{"action": "refresh"}`
3. **First request** - If cache is empty

The cache does NOT refresh on every API call. It checks `totalFeesCollected` and only refreshes if the value changed since last cache update.

## Rate Limiting

- **1 request per minute per IP**
- 429 responses include `retryAfter` header
- The hook handles countdown automatically
- Admins (whitelisted IPs) bypass rate limits

## Performance Comparison

| Metric | Old (Direct Fetch) | New (Cached API) |
|--------|-------------------|------------------|
| Initial Load | 30-60+ seconds | < 1 second |
| Subsequent Loads | 30-60+ seconds | < 100ms |
| RPC Calls | 100+ per page load | 1 per minute max |
| IPFS Fetches | 250+ per page load | 0 (pre-cached) |
| Rate Limited | No | Yes (1/min/IP) |

## Data Freshness

- Cache updates within seconds when NFT holdings change
- `fromCache: true` in response indicates data from cache
- `cacheStatus.lastUpdated` shows when cache was last refreshed
- `cacheStatus.isRefreshing` indicates if refresh is in progress

## Troubleshooting

### "Rate limit exceeded"
Wait for the countdown timer. The `retryAfter` value tells you how many seconds to wait.

### Data seems stale
Check `cacheStatus.lastFeesCollected` vs current on-chain value. If they match, cache is current.

### Cache not refreshing
1. Check if `isRefreshing: true` - refresh may be in progress
2. Verify `totalFeesCollected` changed on-chain
3. Admin can force refresh via POST endpoint

## API Admin Endpoints

### Force Refresh (Admin Only)
```bash
curl -X POST https://your-api.com/api/nft-cache \
  -H "Content-Type: application/json" \
  -d '{"action": "refresh"}'
```

### Get Status Only (Admin Only)
```bash
curl -X POST https://your-api.com/api/nft-cache \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}'
```

## Contract Addresses

- **NFT Contract**: `0xa85D49d8B7a041c339D18281a750dE3D7c15A628`
- **wTokens Wrapper**: `0x038b70E9311D5aE12C816c32818aeec90cBe7C29`
- **IPFS Gateway**: `https://surrounding-amaranth-catshark.myfilebase.com/ipfs/`
