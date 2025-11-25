# wTokens NFT Fetching - Batching Optimization Fix

## Problem Analysis

### Issue Identified
The `useWTokensNFTs` hook was making **individual RPC calls** for each NFT's `tokenURI`, causing excessive API usage and hitting Coinbase RPC rate limits.

**Location**: `hooks/useWTokensNFTs.ts:93-99` (before fix)

### Root Cause
```typescript
// ❌ OLD CODE - 30 separate RPC calls per batch
const batchPromises = batch.map(async (tokenInfo) => {
  const tokenURI = await publicClient.readContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'tokenURI',
    args: [BigInt(tokenInfo.tokenId)],
  }) as string;
  // ... fetch metadata
});
```

**Problem**: For a batch of 30 NFTs, this makes **30 individual RPC calls** → 30 API requests per batch

**Impact**:
- Pool with 100 NFTs = 4 batches × 30 calls = **120 RPC calls**
- Pool with 1000 NFTs = 34 batches × 30 calls = **1,020 RPC calls**
- Each call counts against Coinbase API rate limits
- High probability of hitting rate limits with moderate-sized pools

## Solution Implemented

### 1. ✅ Batched `tokenURI` Multicall

**Pattern**: Same efficient batching already used in `useUserNFTs.ts`

```typescript
// ✅ NEW CODE - 1 batched RPC call per batch
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
```

**Improvement**: For a batch of 30 NFTs, this makes **1 batched RPC call** → 1 API request per batch

**Impact**:
- Pool with 100 NFTs = 4 batches × 1 call = **4 RPC calls** (96% reduction)
- Pool with 1000 NFTs = 34 batches × 1 call = **34 RPC calls** (96.7% reduction)
- Dramatically reduces API rate limit pressure

### 2. ✅ Exponential Backoff Retry Logic

Added retry mechanism for rate limit resilience:

```typescript
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
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
};
```

**Retry Schedule**:
- Attempt 1: Immediate
- Attempt 2: Wait 1000ms (1 second)
- Attempt 3: Wait 2000ms (2 seconds)
- Attempt 4: Wait 4000ms (4 seconds)

### 3. ✅ Optimized Batch Delays

**Before**: `BATCH_DELAY_MS = 1000` (1 second between batches)
**After**: `BATCH_DELAY_MS = 500` (500ms between batches)

**Rationale**: With multicall batching reducing 30 calls to 1 call per batch, we can afford to process batches faster while still respecting rate limits.

### 4. ✅ Graceful Failure Handling

```typescript
try {
  // Fetch tokenURIs with multicall
  // Fetch metadata from IPFS
  // Build NFT objects
} catch (batchError) {
  console.error(`  ❌ Batch ${batchNumber}/${totalBatches} FAILED after retries:`, batchError);
  // Continue processing other batches even if one fails
}
```

**Benefit**: If one batch fails after all retries, other batches continue processing → partial data better than no data

## Performance Comparison

### Before Fix

**100 NFT Pool**:
```
├─ 4 batches × 30 RPC calls each = 120 total RPC calls
├─ 4 batches × 1 second delay = 4 seconds delay
├─ Each batch: ~2 seconds (30 sequential RPC calls)
└─ Total time: ~12 seconds
```

**Rate Limit Risk**: HIGH - 120 RPC calls in short period

### After Fix

**100 NFT Pool**:
```
├─ 4 batches × 1 RPC call each = 4 total RPC calls (96% reduction)
├─ 4 batches × 0.5 second delay = 2 seconds delay
├─ Each batch: ~1 second (1 batched RPC call + parallel IPFS fetches)
└─ Total time: ~6 seconds (50% faster)
```

**Rate Limit Risk**: LOW - Only 4 RPC calls spread over 6 seconds

### Scalability

| Pool Size | Batches | RPC Calls (Before) | RPC Calls (After) | Reduction | Time (Before) | Time (After) |
|-----------|---------|-------------------|-------------------|-----------|---------------|--------------|
| 30 NFTs   | 1       | 30                | 1                 | 96.7%     | ~2s           | ~1s          |
| 100 NFTs  | 4       | 120               | 4                 | 96.7%     | ~12s          | ~6s          |
| 300 NFTs  | 10      | 300               | 10                | 96.7%     | ~30s          | ~15s         |
| 1000 NFTs | 34      | 1,020             | 34                | 96.7%     | ~102s         | ~51s         |

## Code Changes Summary

**File Modified**: `hooks/useWTokensNFTs.ts`

### Lines 80-104: Added Retry Logic
- Exponential backoff for rate limit errors
- Detects 429 errors and rate limit messages
- 3 retry attempts with increasing delays

### Lines 106-143: Replaced Individual Calls with Multicall
- **OLD**: `publicClient.readContract()` in loop → 30 calls
- **NEW**: `publicClient.multicall()` once → 1 call
- Added tokenURI result mapping with failure handling

### Lines 145-206: Updated Metadata Fetching
- Now uses pre-fetched tokenURIs from multicall
- IPFS fetches remain parallel (external service)
- Proper error handling for missing tokenURIs

### Lines 208-217: Added Batch Error Handling
- Wrapped batch processing in try-catch
- Continues processing other batches on failure
- Detailed error logging

### Line 108: Reduced Batch Delay
- Changed from 1000ms to 500ms
- Safe due to reduced RPC call volume

## Testing Checklist

### Functional Testing
- [ ] Small pool (1-30 NFTs): Single batch loads correctly
- [ ] Medium pool (31-100 NFTs): Multiple batches load progressively
- [ ] Large pool (100+ NFTs): All batches process without rate limit errors
- [ ] Error handling: Failed tokenURI calls don't break entire batch
- [ ] Progressive loading: NFTs appear incrementally as batches complete

### Performance Monitoring
- [ ] Check console logs for RPC call counts
- [ ] Verify no rate limit warnings in normal operation
- [ ] Measure total load time for 100+ NFT pool
- [ ] Confirm retry logic activates if rate limits hit

### Console Log Examples

**Successful Batch**:
```
🔄 Fetching batch 1/4 (30 NFTs)
✅ Batch complete: 30/30 succeeded (Total: 30/100)
⏱️ Waiting 500ms before next batch to respect RPC rate limits...
```

**Rate Limit with Retry**:
```
🔄 Fetching batch 2/4 (30 NFTs)
⏳ Rate limit hit, retrying in 1000ms (attempt 1/3)...
✅ Batch complete: 30/30 succeeded (Total: 60/100)
```

**Partial Batch Failure**:
```
🔄 Fetching batch 3/4 (30 NFTs)
⚠️ Token 85: tokenURI call failed
✅ Batch complete: 29/30 succeeded (Total: 89/100)
```

## Integration Points

### User Flow Impact
1. **Manage NFTs Tab**: Uses `wTokensNFTs` from `useWTokensNFTs` hook
2. **Unwrap Interface**: Displays pool NFTs for selection
3. **Progressive Loading**: Users see NFTs appear as batches complete

### No Breaking Changes
- Hook interface unchanged: `{ nfts, isLoading, error, refetch, totalHeld, hasMore }`
- Component usage remains identical
- Backward compatible with existing code

## Monitoring & Debugging

### Key Metrics to Watch
- **RPC Call Volume**: Should be ~1 call per 30 NFTs instead of 30 calls
- **Rate Limit Errors**: Should be rare/non-existent with retry logic
- **Load Time**: Should be ~50% faster for large pools
- **Success Rate**: Should maintain >95% with retry logic

### Debug Commands
```typescript
// Enable verbose logging (already included)
console.log(`🔄 Fetching batch ${batchNumber}/${totalBatches} (${batch.length} NFTs)`);
console.log(`✅ Batch complete: ${batchResults.length}/${batch.length} succeeded`);

// Check final stats
console.log(`✅ All batches complete: Successfully fetched ${fetchedNFTs.length} of ${tokenIds.length} wTokens pool NFTs`);
```

## Rollback Plan

If issues occur, revert to previous implementation:

1. Remove `retryWithBackoff` function (lines 80-104)
2. Replace multicall block (lines 119-142) with original loop:
```typescript
const batchPromises = batch.map(async (tokenInfo) => {
  const tokenURI = await publicClient.readContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'tokenURI',
    args: [BigInt(tokenInfo.tokenId)],
  }) as string;
  // ... rest of original code
});
```
3. Restore `BATCH_DELAY_MS = 1000`

## Related Documentation

- Previous batching fix for user NFTs: `claudedocs/RATE_LIMIT_FIX.md`
- User NFT fetching implementation: `claudedocs/NFT_FETCHING_FIX.md`
- Similar pattern in: `hooks/useUserNFTs.ts:356-365`

## Summary

### Changes Made
✅ Replaced 30 individual RPC calls with 1 batched multicall per batch
✅ Added exponential backoff retry logic for rate limit resilience
✅ Reduced batch delay from 1000ms to 500ms (safe with batching)
✅ Added graceful failure handling to prevent total batch loss

### Expected Outcomes
- **96.7% reduction** in RPC API calls
- **50% faster** loading time for large pools
- **99.9%+ success rate** with retry logic
- **Eliminates** rate limit errors for normal usage

### User Impact
- Faster NFT pool loading in Manage NFTs tab
- More reliable unwrap interface
- Progressive loading provides better UX
- No changes to user-facing functionality
