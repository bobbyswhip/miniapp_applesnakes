# Token Wars Image Upload - Frontend Implementation Guide

## Bug Fixed

**Issue**: The `uploadToIPFS` function was imported but didn't exist, causing all image uploads to silently fail.

**Fix Deployed**: Added the missing `uploadToIPFS` function to `lib/filebase-ipfs.ts` on December 14, 2025.

---

## Image Upload Flow

### Option 1: Create Token War with Image (Multipart Form)

The main `/api/token-wars` endpoint supports image upload via multipart/form-data.

```typescript
// Frontend: Create Token War with Image
async function createTokenWar(
  name: string,
  symbol: string,
  description: string,
  dexVote: 'v4' | 'aerodrome' | 'hydrex',
  pairVote: 'eth' | 'wass',
  imageFile: File,
  x402PaymentHeader: string  // From x402 payment flow
) {
  const formData = new FormData();

  // Required fields
  formData.append('name', name);
  formData.append('symbol', symbol);
  formData.append('dexVote', dexVote);
  formData.append('pairVote', pairVote);

  // Optional fields
  formData.append('description', description);
  formData.append('targetAmount', '1000');  // Optional: sellout target in USDC
  formData.append('durationHours', '24');   // Default: 24 hours

  // Image file (IMPORTANT: field name must be "image")
  formData.append('image', imageFile);

  const response = await fetch('/api/token-wars', {
    method: 'POST',
    headers: {
      'X-PAYMENT': x402PaymentHeader,  // x402 payment proof
      // DO NOT set Content-Type - browser sets it automatically with boundary
    },
    body: formData,
  });

  return response.json();
}
```

### Response on Success

```json
{
  "success": true,
  "message": "Token War created!",
  "war": {
    "id": "war-1765737438128-abc123",
    "name": "My Token",
    "symbol": "MTK",
    "imageUrl": "https://ipfs.filebase.io/ipfs/QmXxx...",
    "tokenAddress": "0x1234...5678",
    ...
  },
  "tokenAddress": "0x1234...5678",
  "predictionMarkets": {
    "dexMarketId": "...",
    "pairMarketId": "...",
    "selloutMarketId": "..."
  }
}
```

---

## Frontend Component Example

```tsx
// components/CreateTokenWar.tsx
import { useState, useRef } from 'react';

export function CreateTokenWar() {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [dexVote, setDexVote] = useState<'v4' | 'aerodrome' | 'hydrex'>('aerodrome');
  const [pairVote, setPairVote] = useState<'eth' | 'wass'>('eth');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle image selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
        setError('Please select a PNG, JPEG, GIF, or WebP image');
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB');
        return;
      }

      setImageFile(file);
      setError(null);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove selected image
  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Submit form
  const handleSubmit = async (x402PaymentHeader: string) => {
    if (!name || !symbol) {
      setError('Name and symbol are required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('symbol', symbol.toUpperCase());
      formData.append('description', description);
      formData.append('dexVote', dexVote);
      formData.append('pairVote', pairVote);

      // IMPORTANT: Include image if selected
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const response = await fetch('/api/token-wars', {
        method: 'POST',
        headers: {
          'X-PAYMENT': x402PaymentHeader,
        },
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create token war');
      }

      console.log('Token War Created:', data);
      console.log('Image URL:', data.war.imageUrl);
      console.log('Token Address:', data.tokenAddress);

      // Handle success (redirect, show success message, etc.)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token war');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="space-y-4">
      {/* Token Name */}
      <div>
        <label className="block text-sm font-medium">Token Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Awesome Token"
          className="mt-1 block w-full rounded-md border p-2"
          required
        />
      </div>

      {/* Token Symbol */}
      <div>
        <label className="block text-sm font-medium">Symbol</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          placeholder="MTK"
          maxLength={10}
          className="mt-1 block w-full rounded-md border p-2"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us about your token..."
          className="mt-1 block w-full rounded-md border p-2"
          rows={3}
        />
      </div>

      {/* Image Upload */}
      <div>
        <label className="block text-sm font-medium">Token Image</label>
        <div className="mt-1 flex items-center gap-4">
          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt="Token preview"
                className="h-24 w-24 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400"
            >
              <span className="text-gray-400">+ Add</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={handleImageChange}
            className="hidden"
          />
          <div className="text-sm text-gray-500">
            <p>PNG, JPEG, GIF, or WebP</p>
            <p>Max 5MB</p>
          </div>
        </div>
      </div>

      {/* DEX Vote */}
      <div>
        <label className="block text-sm font-medium">Launch DEX</label>
        <div className="mt-1 flex gap-4">
          {(['v4', 'aerodrome', 'hydrex'] as const).map((dex) => (
            <label key={dex} className="flex items-center gap-2">
              <input
                type="radio"
                name="dexVote"
                value={dex}
                checked={dexVote === dex}
                onChange={(e) => setDexVote(e.target.value as typeof dexVote)}
              />
              <span className="capitalize">{dex === 'v4' ? 'Uniswap V4' : dex}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Pair Vote */}
      <div>
        <label className="block text-sm font-medium">Trading Pair</label>
        <div className="mt-1 flex gap-4">
          {(['eth', 'wass'] as const).map((pair) => (
            <label key={pair} className="flex items-center gap-2">
              <input
                type="radio"
                name="pairVote"
                value={pair}
                checked={pairVote === pair}
                onChange={(e) => setPairVote(e.target.value as typeof pairVote)}
              />
              <span className="uppercase">{pair}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      {/* Submit Button (integrate with your x402 payment flow) */}
      <button
        type="button"
        onClick={() => {
          // Your x402 payment flow should call handleSubmit with the payment header
          // handleSubmit(x402PaymentHeader);
        }}
        disabled={isSubmitting || !name || !symbol}
        className="w-full rounded-md bg-blue-500 py-2 text-white hover:bg-blue-600 disabled:bg-gray-400"
      >
        {isSubmitting ? 'Creating...' : 'Create Token War ($1 USDC)'}
      </button>
    </form>
  );
}
```

---

## API Endpoints Reference

### Create Token War (with image)

```
POST /api/token-wars
Content-Type: multipart/form-data
X-PAYMENT: <x402-payment-header>

FormData:
- name: string (required)
- symbol: string (required, 2-10 chars)
- description: string (optional)
- image: File (optional, max 5MB, PNG/JPEG/GIF/WebP)
- dexVote: "v4" | "aerodrome" | "hydrex" (required)
- pairVote: "eth" | "wass" (required)
- targetAmount: number (optional, USDC sellout target)
- durationHours: number (optional, default 24)
```

### Get Launched Tokens (with images)

```
GET /api/token-wars/tokens

Response:
{
  "success": true,
  "tokens": [
    {
      "tokenAddress": "0x...",
      "symbol": "MTK",
      "name": "My Token",
      "imageUrl": "https://ipfs.filebase.io/ipfs/Qm...",  // Now populated!
      "poolAddress": "0x...",
      "dex": "aerodrome",
      "pair": "eth",
      ...
    }
  ]
}
```

---

## Image Storage Flow

1. **User uploads image** via multipart form
2. **Backend receives image** buffer
3. **`uploadToIPFS()`** uploads to Filebase S3 bucket (`token-images`)
4. **Filebase pins to IPFS** and returns CID
5. **imageUrl stored** in database and on-chain contract
6. **API returns** IPFS gateway URL: `https://ipfs.filebase.io/ipfs/{CID}`

---

## Troubleshooting

### Image not showing in frontend

1. **Check API response**: The `imageUrl` field should contain an IPFS URL
2. **Check browser console**: Look for fetch errors or CORS issues
3. **Test IPFS gateway**: Try opening the imageUrl directly in browser

### Image upload fails silently

1. **Check file size**: Must be under 5MB
2. **Check file type**: Must be PNG, JPEG, GIF, or WebP
3. **Check server logs**: SSH into EC2 and run `pm2 logs jack-ai`

### Old tokens have no images

Old tokens created before this fix have `imageUrl: null`. The API now reads from the on-chain contract as a fallback, but if the token was deployed without an image, it will still be null.

**To fix existing tokens**: The token owner can call `setImageUrl(newImage)` on the contract to set an image retroactively.

---

## Environment Variables (Server)

Required in `.env` for image uploads to work:

```bash
# Filebase S3 credentials for token-images bucket
FILEBASE_ROOTKEY_KEY=your_access_key
FILEBASE_ROOTKEY_SECRET=your_secret_key
```
