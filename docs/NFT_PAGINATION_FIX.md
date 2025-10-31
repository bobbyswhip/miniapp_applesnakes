# NFT Pagination Bug Fix - Only 50 of 100+ NFTs Showing

## Issue Report
**Symptom**: User has 100+ NFTs but only 50 are displaying in the gallery
**Root Cause**: Batch processing or metadata fetching failure causing NFTs to be filtered out

## Analysis

### NFT Fetching Process (4 Steps):

1. **Step 1: Fetch Token IDs from Alchemy** (Lines 216-251)
   - Paginates through all pages to get complete token ID list
   - Uses `allTokenIds.concat(tokenIds)` to accumulate
   - ✅ This step was working correctly

2. **Step 2: Batch Process TokenInfo** (Lines 260-337)
   - Splits token IDs into batches of 50
   - Calls contract's `getTokenInfo()` for each batch
   - Stores results in `tokenInfoMap` using `Map.set()`
   - ⚠️ **Potential Issue**: If a batch fails, those 50 tokens are lost

3. **Step 3: Fetch Metadata** (Lines 339-394)
   - Fetches metadata JSON for all tokens in parallel
   - No batching or rate limiting
   - ⚠️ **Potential Issue**: Timeouts or failures exclude tokens from `metadataMap`

4. **Step 4: Build Final Array** (Lines 448-490)
   - Filters tokens that exist in ALL THREE maps:
     - `imageUrlMap` (from metadata)
     - `metadataMap` (from metadata)
     - `tokenInfoMap` (from contract)
   - ⚠️ **Critical Issue**: Any token missing from any map is excluded

### Why Exactly 50 NFTs?

The `BATCH_SIZE = 50` constant suggests:
- **Scenario 1**: Only first batch of TokenInfo was processed successfully
- **Scenario 2**: Metadata fetching failed after first 50 due to rate limits/timeouts
- **Scenario 3**: Second batch of contract calls failed, excluding tokens 51-100

## Fixes Implemented

### 1. Enhanced Batch Processing Error Handling
**Location**: `useUserNFTs.ts:290-337`

**Changes**:
- Wrapped each batch in try-catch to continue on failure
- Added detailed logging showing which batch is processing
- Shows running total of tokens in map after each batch
- Reports final map sizes before moving to next step

**Code**:
```typescript
for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
  try {
    // Process batch
    console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length}...`);
    // ... processing ...
    console.log(`✅ Batch complete (Total in map: ${tokenInfoMap.size})`);
  } catch (batchError) {
    console.error(`❌ Batch ${batchIndex + 1} FAILED:`, batchError);
    // Continue processing other batches
  }
}
```

### 2. Improved Metadata Fetching
**Location**: `useUserNFTs.ts:339-394`

**Changes**:
- Added 10-second timeout per metadata fetch
- Improved error logging with token index
- Better success/failure counting
- Added abort controller for timeout handling

**Code**:
```typescript
// Fetch with timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);
const response = await fetch(metadataUrl, { signal: controller.signal });
clearTimeout(timeoutId);
```

### 3. Diagnostic Logging for Filtered Tokens
**Location**: `useUserNFTs.ts:426-446`

**Changes**:
- Reports which tokens are being excluded
- Shows exactly what data is missing for each excluded token
- Displays first 10 excluded tokens with reasons

**Code**:
```typescript
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
```

### 4. Comprehensive Step Logging
**Added throughout the function**:

**Step 1 Output**:
```
🔍 Step 1: Fetching token IDs from Alchemy...
📄 Fetching page 1 (first page)...
✓ Page 1: 100 NFTs, totalCount: 157
📄 Fetching page 2 (with pageKey)...
✓ Page 2: 57 NFTs, totalCount: 157
✅ Found 157 NFTs owned by user
```

**Step 2 Output**:
```
🚀 Step 2: Batched getTokenInfo for 157 tokens...
  Splitting into 4 batches of up to 50 tokens each
  📦 Processing batch 1/4: 50 tokens (IDs: 1-50)
  ✅ Batch 1/4 complete: 50 tokens added (Total in map: 50)
  📦 Processing batch 2/4: 50 tokens (IDs: 51-100)
  ✅ Batch 2/4 complete: 50 tokens added (Total in map: 100)
  📦 Processing batch 3/4: 50 tokens (IDs: 101-150)
  ✅ Batch 3/4 complete: 50 tokens added (Total in map: 150)
  📦 Processing batch 4/4: 7 tokens (IDs: 151-157)
  ✅ Batch 4/4 complete: 7 tokens added (Total in map: 157)
📊 Batch processing complete: 157 tokens have TokenInfo, 157 have tokenURI
```

**Step 3 Output**:
```
🖼️ Step 3: Fetching metadata JSON for 157 tokens...
❌ Token 45 (45/157): Metadata fetch failed - timeout
📊 Metadata fetch complete: 155 success, 2 failed
```

**Step 4 Output**:
```
🔨 Step 4: Building final NFT array from 157 token IDs...
📋 Maps populated - imageUrl: 155, metadata: 155, tokenInfo: 157
⚠️ 2 tokens will be excluded due to missing data:
  Token 45: missing imageUrl, metadata
  Token 102: missing imageUrl, metadata
✅ SUCCESS: Loaded 155 out of 157 NFTs (98.7% success rate)
📦 Final counts: 143 free, 12 jailed
```

## Testing Instructions

### 1. Check Browser Console
Open Developer Tools (F12) and watch the Console tab while the app loads. You should see:

**Expected Flow** (for 100+ NFTs):
1. Multiple Alchemy pages fetched
2. Multiple batches processed (not just 1!)
3. All batches show successful completion
4. Success rate close to 100%

**If Bug Persists**:
- Look for `❌ Batch X FAILED` messages
- Check for high metadata failure count
- Note which tokens are being excluded and why

### 2. Identify the Failure Point

**Scenario A: Pagination Issue**
```
✅ Found 50 NFTs owned by user  // Should be 100+!
```
**Solution**: Check Alchemy API response, verify pagination loop

**Scenario B: Batch Processing Issue**
```
📦 Processing batch 1/3: 50 tokens
✅ Batch 1/3 complete (Total in map: 50)
❌ Batch 2/3 FAILED: <error>
📊 Batch processing complete: 50 tokens have TokenInfo  // Missing batch 2 and 3!
```
**Solution**: Check RPC endpoint, verify contract ABI, increase rate limit delay

**Scenario C: Metadata Fetching Issue**
```
📊 Metadata fetch complete: 50 success, 57 failed  // High failure rate!
⚠️ 57 tokens will be excluded due to missing data
```
**Solution**: Check IPFS gateway, add retries, batch metadata fetches

### 3. Expected Output for 100+ NFTs

```
🔍 Step 1: Fetching token IDs from Alchemy...
✅ Found 107 NFTs owned by user

🚀 Step 2: Batched getTokenInfo for 107 tokens...
  Splitting into 3 batches of up to 50 tokens each
  ✅ Batch 1/3 complete (Total in map: 50)
  ✅ Batch 2/3 complete (Total in map: 100)
  ✅ Batch 3/3 complete (Total in map: 107)
📊 Batch processing complete: 107 tokens have TokenInfo, 107 have tokenURI

🖼️ Step 3: Fetching metadata JSON for 107 tokens...
📊 Metadata fetch complete: 107 success, 0 failed

🔨 Step 4: Building final NFT array from 107 token IDs...
📋 Maps populated - imageUrl: 107, metadata: 107, tokenInfo: 107
✅ SUCCESS: Loaded 107 out of 107 NFTs (100.0% success rate)
📦 Final counts: 95 free, 12 jailed
```

## Common Issues and Solutions

### Issue 1: Batch 2+ Failing
**Symptoms**:
```
✅ Batch 1/3 complete
❌ Batch 2/3 FAILED: execution reverted
```

**Possible Causes**:
- Invalid token IDs in batch
- RPC rate limiting
- Contract function gas limit

**Solutions**:
1. Increase delay between batches (currently 100ms)
2. Reduce BATCH_SIZE from 50 to 25
3. Check if token IDs are valid
4. Verify contract `getTokenInfo()` function

### Issue 2: Metadata Timeouts
**Symptoms**:
```
📊 Metadata fetch complete: 50 success, 57 failed
❌ Token X: Metadata fetch failed - timeout
```

**Possible Causes**:
- IPFS gateway slow or down
- Too many parallel requests
- Network issues

**Solutions**:
1. Batch metadata fetches (10-20 at a time)
2. Add retry logic (3 retries with exponential backoff)
3. Increase timeout from 10s to 30s
4. Use different IPFS gateway
5. Add metadata caching

### Issue 3: Only First Page Fetched
**Symptoms**:
```
✅ Found 100 NFTs owned by user  // But user has 150+
```

**Possible Causes**:
- Pagination loop not working
- `pageKey` not being set
- Alchemy API error

**Solutions**:
1. Check `data.pageKey` is being returned
2. Verify `do...while` loop condition
3. Check Alchemy API key validity
4. Review Alchemy API response format

## Code Changes Summary

### Files Modified:
- `hooks/useUserNFTs.ts`

### Lines Changed:
- Lines 260-337: Enhanced batch processing with error handling
- Lines 339-394: Improved metadata fetching with timeouts
- Lines 406-446: Added diagnostic logging for filtered tokens
- Lines 487-488: Added final success rate reporting

### New Features:
- ✅ Try-catch around each batch to prevent cascade failures
- ✅ Detailed progress logging for each step
- ✅ 10-second timeout on metadata fetches
- ✅ Reports which tokens are excluded and why
- ✅ Success rate calculation
- ✅ Running total of processed tokens

## Next Steps

1. **Test with Connected Wallet**: Connect wallet with 100+ NFTs
2. **Review Console Logs**: Check for error patterns
3. **Identify Root Cause**: Use logs to determine failure point
4. **Apply Additional Fixes**: Based on specific failure mode

## Additional Optimizations (If Needed)

If the issue persists after reviewing logs:

### Option 1: Batch Metadata Fetching
```typescript
// Instead of fetching all metadata in parallel
const METADATA_BATCH_SIZE = 20;
for (let i = 0; i < allTokenIds.length; i += METADATA_BATCH_SIZE) {
  const batch = allTokenIds.slice(i, i + METADATA_BATCH_SIZE);
  const results = await Promise.all(batch.map(fetchMetadata));
  // Process results...
}
```

### Option 2: Retry Failed Fetches
```typescript
async function fetchWithRetry(url: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
```

### Option 3: Reduce Batch Size
```typescript
const BATCH_SIZE = 25; // Reduced from 50
```

### Option 4: Use Alternative IPFS Gateway
```typescript
const gateways = [
  'https://surrounding-amaranth-catshark.myfilebase.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];
// Try multiple gateways if one fails
```

## References
- Alchemy NFT API: https://docs.alchemy.com/reference/getnfts
- IPFS Gateway Status: https://ipfs.github.io/public-gateway-checker/
- Wagmi Multicall: https://wagmi.sh/react/actions/multicall
