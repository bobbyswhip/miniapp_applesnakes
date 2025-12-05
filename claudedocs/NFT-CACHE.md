# wTokens NFT Cache API Guide

This guide explains how to use the new wTokens NFT caching system on the EC2 server to replace slow client-side RPC calls.

## Overview

The EC2 server now caches all NFTs held by the wTokens contract. Instead of making hundreds of RPC calls to fetch NFT data (which was slow and expensive), the frontend can now fetch cached data from a single API endpoint.

### Benefits
- **Speed**: ~50ms response vs ~2-5 minutes client-side
- **Cost**: No Alchemy/RPC credits consumed per client request
- **Reliability**: Server handles RPC rate limits and retries
- **Real-time Updates**: Cache refreshes every 60 seconds when changes are detected

## API Endpoints

### Base URL
```
http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001
```

### 1. Get Cached NFTs

**GET `/api/wtokens-nfts`**

Returns all NFTs currently held by the wTokens contract.

#### Query Parameters
| Parameter | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `limit`   | number | Max NFTs to return (optional)            |
| `offset`  | number | Starting index for pagination (optional) |
| `type`    | string | Filter by nftType: human, snake, egg     |

#### Example Request
```typescript
// Fetch all NFTs
const response = await fetch('http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001/api/wtokens-nfts');
const data = await response.json();

// Fetch with pagination
const response = await fetch('http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001/api/wtokens-nfts?limit=100&offset=0');

// Filter by type
const response = await fetch('http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001/api/wtokens-nfts?type=human');
```

#### Response Format
```typescript
interface WTokensNFTsResponse {
  success: boolean;
  nfts: CachedNFT[];
  totalCount: number;       // Total NFTs matching filter
  returnedCount: number;    // NFTs in this response
  offset: number;
  hasMore: boolean;
  cacheStatus: {
    isLoopRunning: boolean;
    lastRefreshTime: string;  // ISO timestamp
    isRefreshing: boolean;
    stats: {
      totalHeld: number;
      humansCount: number;
      snakesCount: number;
      eggsCount: number;
      jailedCount: number;
    };
  };
}

interface CachedNFT {
  tokenId: number;
  imageUrl: string;           // IPFS hash (without gateway prefix)
  name: string;
  nftType: 'human' | 'snake' | 'egg' | 'warden';
  owner: string;              // wTokens contract address
  exists: boolean;
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
  metadata: {
    name: string;
    description: string;
    image: string;            // ipfs:// URL
    attributes: Array<{
      trait_type: string;
      value: string;
    }>;
  } | null;
}
```

### 2. Get Cache Status

**GET `/api/wtokens-status`**

Returns the current status of the cache polling loop.

#### Example Request
```typescript
const response = await fetch('http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001/api/wtokens-status');
const data = await response.json();
```

#### Response Format
```typescript
interface WTokensStatusResponse {
  success: boolean;
  status: {
    isLoopRunning: boolean;       // True if polling is active
    loopStartTime: string;        // When polling started
    pollIntervalMs: number;       // Polling interval (60000ms)
    totalPolls: number;           // Total poll cycles run
    totalRefreshes: number;       // Times cache was refreshed
    lastRefreshTime: string;      // Last successful refresh
    isRefreshing: boolean;        // Currently refreshing?
    refreshError: string | null;  // Last error if any
    lastFeesCollected: string;    // "0.123 ETH" - change trigger
    cachedNFTCount: number;       // NFTs in cache
    stats: {
      totalHeld: number;
      humansCount: number;
      snakesCount: number;
      eggsCount: number;
      jailedCount: number;
    };
    contracts: {
      wTokens: string;            // wTokens contract address
      nft: string;                // NFT contract address
    };
  };
}
```

### 3. Force Refresh (Admin Only)

**POST `/api/wtokens-refresh`**

Manually trigger a cache refresh. Requires admin IP.

```typescript
const response = await fetch('http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001/api/wtokens-refresh', {
  method: 'POST'
});
```

## Frontend Implementation

### Option 1: Replace useWTokensNFTs Hook

Create a new hook that uses the cached endpoint:

```typescript
// hooks/useWTokensNFTsCached.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserNFT } from './useUserNFTs';

const CACHE_API_URL = 'http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001';

interface CacheStatus {
  isLoopRunning: boolean;
  lastRefreshTime: string;
  isRefreshing: boolean;
  stats: {
    totalHeld: number;
    humansCount: number;
    snakesCount: number;
    eggsCount: number;
    jailedCount: number;
  };
}

interface WTokensNFTsCachedResult {
  nfts: UserNFT[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  totalHeld: number;
  cacheStatus: CacheStatus | null;
}

export function useWTokensNFTsCached(): WTokensNFTsCachedResult {
  const [nfts, setNfts] = useState<UserNFT[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalHeld, setTotalHeld] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);

  const fetchFromCache = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${CACHE_API_URL}/api/wtokens-nfts`);
      if (!response.ok) throw new Error('Failed to fetch cached NFTs');

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Cache fetch failed');
      }

      // Transform cached NFTs to UserNFT format
      const transformedNFTs: UserNFT[] = data.nfts.map((nft: any) => ({
        tokenId: nft.tokenId,
        imageUrl: nft.imageUrl,
        name: nft.name,
        nftType: nft.nftType,
        owner: nft.owner,
        exists: nft.exists,
        isSnake: nft.isSnake,
        isJailed: nft.isJailed,
        jailTime: nft.jailTime,
        isEgg: nft.isEgg,
        mintTime: nft.mintTime,
        forceHatched: nft.forceHatched,
        evolved: nft.evolved,
        ownerIsWarden: nft.ownerIsWarden,
        ownerIsJailExempt: nft.ownerIsJailExempt,
        swapMintTime: nft.swapMintTime,
        canUnwrap: nft.canUnwrap,
        metadata: nft.metadata,
      }));

      setNfts(transformedNFTs);
      setTotalHeld(data.totalCount);
      setCacheStatus(data.cacheStatus);

    } catch (err) {
      console.error('Cache fetch error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFromCache();
  }, [fetchFromCache]);

  return {
    nfts,
    isLoading,
    error,
    refetch: fetchFromCache,
    totalHeld,
    cacheStatus,
  };
}
```

### Option 2: Fallback Pattern

Use cached endpoint with fallback to on-chain fetching:

```typescript
// hooks/useWTokensNFTsWithFallback.ts
import { useWTokensNFTsCached } from './useWTokensNFTsCached';
import { useWTokensNFTs } from './useWTokensNFTs';

export function useWTokensNFTsWithFallback() {
  const cached = useWTokensNFTsCached();
  const onChain = useWTokensNFTs(false, false); // disabled by default

  // If cache fails, fall back to on-chain
  if (cached.error && !onChain.isLoading) {
    return onChain;
  }

  return cached;
}
```

### Option 3: Status Indicator Component

Show cache status in the UI:

```typescript
// components/WTokensCacheStatus.tsx
'use client';

import { useState, useEffect } from 'react';

const CACHE_API_URL = 'http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001';

export function WTokensCacheStatus() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${CACHE_API_URL}/api/wtokens-status`);
        const data = await res.json();
        if (data.success) setStatus(data.status);
      } catch (e) {
        console.error('Failed to fetch cache status');
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  return (
    <div className="text-sm text-gray-400 flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${
        status.isLoopRunning ? 'bg-green-500' : 'bg-red-500'
      }`} />
      <span>
        {status.cachedNFTCount} NFTs cached
        {status.isRefreshing && ' (refreshing...)'}
      </span>
    </div>
  );
}
```

## How It Works

### Change Detection
The server polls the wTokens contract every 60 seconds, checking `totalFeesCollected`:
- If fees change → wrap/unwrap occurred → refresh cache
- If fees unchanged → skip refresh (cache is still valid)

### Data Flow
1. **Server startup**: Initialize cache, fetch all NFT data
2. **Poll cycle**: Every 60s, check for changes
3. **On change**: Re-fetch token IDs, token info, and metadata
4. **Client request**: Return cached data instantly

### Metadata Source
Metadata is loaded from the EC2 database (where NFT images are stored), not from IPFS. This makes it much faster and eliminates IPFS rate limits.

## Migration Notes

1. **Replace imports**:
   ```typescript
   // Before
   import { useWTokensNFTs } from '@/hooks/useWTokensNFTs';

   // After
   import { useWTokensNFTsCached } from '@/hooks/useWTokensNFTsCached';
   ```

2. **Handle loading state**: The cached version loads much faster (~50ms), so loading spinners may flash briefly.

3. **Error handling**: If the cache server is down, consider falling back to the original on-chain method.

4. **CORS**: The EC2 server has CORS enabled for all origins.

## Troubleshooting

### Cache shows 0 NFTs
- Check `/api/wtokens-status` for errors
- Verify `isLoopRunning` is true
- Check `refreshError` for details

### Stale data
- Cache refreshes every 60s when changes occur
- Use `/api/wtokens-refresh` (admin) to force refresh
- Check `lastRefreshTime` to see when data was last updated

### Connection errors
- Verify EC2 is running: `curl http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3001/health`
- Check PM2 logs: `pm2 logs nft-generator`
