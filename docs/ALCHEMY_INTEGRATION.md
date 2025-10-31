# Alchemy API Integration

## Overview

AppleSnakes NFT uses Alchemy's powerful NFT API to quickly fetch all NFTs owned by a user, filtered by our specific contract address. This provides near-instant loading compared to scanning blockchain events.

## Configuration

### API Key Setup

The Alchemy API key is already configured in `.env.local`:

```bash
NEXT_PUBLIC_ALCHEMY_API_KEY=XXMfam2qTkDnjRNwlDvQaGkelOLSCVSu
```

**Security**: `.env.local` is in `.gitignore` and will never be committed to git.

### Network Configuration

- **Network**: Base Mainnet
- **Chain ID**: 8453
- **Alchemy Endpoint**: `https://base-mainnet.g.alchemy.com/nft/v3/`

## How It Works

### 1. **User Connects Wallet**
When a user connects their wallet to the dApp, the `useUserNFTs` hook is triggered.

### 2. **Alchemy API Call**
```typescript
GET https://base-mainnet.g.alchemy.com/nft/v3/{apiKey}/getNFTsForOwner
  ?owner={userAddress}
  &contractAddresses[]={nftContractAddress}
  &withMetadata=false
```

**Parameters:**
- `owner`: User's wallet address
- `contractAddresses[]`: Our NFT contract (`0x18DC7E175465673f8d57d68FD19bd3E5577343A1`)
- `withMetadata`: `false` (we only need token IDs, saves bandwidth)

### 3. **Response Processing**
Alchemy returns all NFTs owned by the user for our contract:

```json
{
  "ownedNfts": [
    {
      "contract": { "address": "0x18DC..." },
      "tokenId": "0x1", // Hex format
      "tokenType": "ERC721"
    }
  ],
  "totalCount": 5
}
```

### 4. **Jailed Status Check**
For each NFT, we read the `isJailed` state from the contract:

```typescript
const isJailed = await publicClient.readContract({
  address: contracts.nft.address,
  abi: contracts.nft.abi,
  functionName: 'isJailed',
  args: [BigInt(tokenId)],
});
```

This is done in **parallel** for all NFTs (batch processing).

### 5. **Image URL Construction**
Based on jailed status, we construct the correct image filename:

```typescript
// Regular NFT: "1.png"
// Jailed NFT: "Jailed1.png"
const filename = isJailed ? `Jailed${tokenId}.png` : `${tokenId}.png`;
```

## Performance

### Speed Comparison

| Method | Time | Notes |
|--------|------|-------|
| **Alchemy API** | ~200-500ms | ✅ Recommended |
| Event Indexing | ~2-5 seconds | Fallback method |
| Contract Enumeration | ~1-3 seconds | Requires contract upgrade |

### Alchemy Free Tier Limits

- **Compute Units**: 100M per month (free)
- **Requests**: ~300k getNFTsForOwner calls/month
- **Rate Limit**: 660 requests/second (burst)

**Our Usage**: Each user page load = 1 API call + N contract reads (N = number of NFTs owned)

For a user with 10 NFTs:
- 1 Alchemy API call (~100 CU)
- 10 contract reads for isJailed status

**Monthly capacity**: ~1M users with 10 NFTs each (well within free tier)

## Code Implementation

### Hook Usage

```typescript
import { useUserNFTs } from '@/hooks/useUserNFTs';

function MyNFTsPage() {
  const { nfts, isLoading, error } = useUserNFTs();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return <NFTGallery nfts={nfts} />;
}
```

### Return Value

```typescript
{
  nfts: Array<{
    tokenId: number;       // e.g., 1234
    isJailed: boolean;     // true or false
    imageUrl: string;      // "1234.png" or "Jailed1234.png"
  }>,
  isLoading: boolean,      // true while fetching
  error: string | null     // error message if failed
}
```

## Fallback Strategy

If Alchemy API fails, the system automatically falls back to event indexing:

1. **Primary**: Alchemy API (fast, requires API key)
2. **Fallback**: Event indexing (slower, no API required)
3. **Future**: Contract enumeration (requires contract upgrade)

To force event indexing:

```typescript
import { useUserNFTs_EventIndexing } from '@/hooks/useUserNFTs';

const { nfts } = useUserNFTs_EventIndexing();
```

## Security Considerations

### API Key Security

✅ **Secure**:
- API key in `.env.local` (not committed to git)
- `NEXT_PUBLIC_*` prefix means client-side only
- Alchemy keys are low-risk (read-only, rate-limited)

⚠️ **Note**:
- This is an Alchemy API key, not a private key
- It can only read NFT data, cannot perform transactions
- Rate limits prevent abuse

### Best Practices

1. **Never commit `.env.local`** - It's in `.gitignore`
2. **Rotate keys periodically** - Update in Alchemy dashboard
3. **Monitor usage** - Check Alchemy dashboard for unusual activity
4. **Use environment variables** - Never hardcode keys

## Troubleshooting

### Issue: "Alchemy API key not configured"

**Solution**: Ensure `.env.local` exists with the API key:

```bash
NEXT_PUBLIC_ALCHEMY_API_KEY=XXMfam2qTkDnjRNwlDvQaGkelOLSCVSu
```

Then restart the dev server:

```bash
npm run dev
```

### Issue: "Alchemy API error: 401"

**Cause**: Invalid API key

**Solution**:
1. Check the API key is correct in `.env.local`
2. Verify the key is for Base Mainnet in Alchemy dashboard
3. Restart dev server after changing `.env.local`

### Issue: "No NFTs found for this contract"

**Possible causes**:
1. User doesn't own any NFTs from this contract
2. Wrong contract address in `config/contracts.ts`
3. User connected to wrong network

**Debug**:
1. Check console logs for contract address
2. Verify contract address matches deployed contract
3. Ensure user is connected to Base Mainnet (chainId: 8453)

### Issue: NFTs load but images don't show

**Cause**: IPFS base URI not configured

**Solution**: Set IPFS base hash in `.env.local`:

```bash
NEXT_PUBLIC_IPFS_BASE_URI=QmYourActualIPFSHashHere
```

## API Reference

### Alchemy getNFTsForOwner

**Endpoint**: `GET /nft/v3/{apiKey}/getNFTsForOwner`

**Parameters**:
- `owner` (required): Wallet address
- `contractAddresses[]` (optional): Filter by contract
- `withMetadata` (optional): Include metadata (default: true)
- `pageKey` (optional): Pagination cursor
- `pageSize` (optional): Results per page (default: 100, max: 100)

**Response**:
```json
{
  "ownedNfts": [
    {
      "contract": {
        "address": "0x..."
      },
      "tokenId": "0x1",
      "tokenType": "ERC721",
      "balance": "1"
    }
  ],
  "totalCount": 5,
  "pageKey": "..."
}
```

**Documentation**: https://docs.alchemy.com/reference/getnftsforowner

## Next Steps

### Optimization Ideas

1. **Cache Results**: Cache NFT ownership in localStorage for 5 minutes
2. **Pagination**: For users with 100+ NFTs, implement pagination
3. **Real-time Updates**: Use Alchemy webhooks for instant updates when NFTs transfer
4. **Metadata Caching**: Cache IPFS metadata to reduce gateway calls

### Advanced Features

1. **NFT Activity Feed**: Use `getAssetTransfers` to show NFT history
2. **Floor Price**: Use `getFloorPrice` to show collection stats
3. **Sales Data**: Use `getNFTSales` to show recent sales
4. **Traits/Rarity**: Fetch and display NFT attributes

## Resources

- [Alchemy Dashboard](https://dashboard.alchemy.com/)
- [Alchemy NFT API Docs](https://docs.alchemy.com/docs/nft-api-overview)
- [Base Network Info](https://docs.base.org/)
- [IPFS Gateways](https://docs.ipfs.tech/concepts/ipfs-gateway/)
