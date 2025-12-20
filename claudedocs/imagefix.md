# Token Wars Image Frontend Integration Guide

## Overview

This guide explains how to properly display Token Wars images on the frontend. Images are uploaded to Filebase (S3-compatible IPFS storage) and served via IPFS gateway URLs.

## API Response Structure

When fetching wars from the API, the response includes an `imageUrl` field:

```typescript
// GET /api/token-wars
// GET /api/token-wars?all=true
// GET /api/token-wars/{warId}

interface TokenWarResponse {
  id: string;                    // e.g., "war-1765993081751-is6z3f"
  name: string;                  // Token name
  symbol: string;                // Token symbol
  imageUrl: string | undefined;  // Image URL (see formats below)
  status: "active" | "launching" | "launched" | "failed" | "cancelled";
  // ... other fields
}
```

## Image URL Formats

The `imageUrl` field can be in different formats depending on upload status:

### 1. IPFS CID Gateway URL (Preferred - New Format)
```
https://ipfs.filebase.io/ipfs/QmXxx...
```
This is a content-addressed URL. If you see this format, the image is permanently stored on IPFS and will always be available.

### 2. Temp Bucket URL (Legacy/Fallback)
```
https://temp-images.s3.filebase.com/token-wars-0x...png
```
**Note:** This URL is NOT publicly accessible. If you see this format, the permanent upload may have failed.

### 3. Undefined/Empty
If `imageUrl` is undefined or empty, display a placeholder image.

## Frontend Implementation

### React/TypeScript Example

```typescript
import { useState, useEffect } from 'react';

interface TokenWar {
  id: string;
  name: string;
  symbol: string;
  imageUrl?: string;
}

// Helper function to validate and normalize image URLs
function getDisplayImageUrl(imageUrl: string | undefined): string {
  const PLACEHOLDER = '/images/token-placeholder.png'; // Your placeholder image

  if (!imageUrl) {
    return PLACEHOLDER;
  }

  // IPFS CID URL - preferred format, always works
  if (imageUrl.includes('ipfs.filebase.io/ipfs/')) {
    return imageUrl;
  }

  // Alternative IPFS gateways (if you want redundancy)
  if (imageUrl.startsWith('ipfs://')) {
    const cid = imageUrl.replace('ipfs://', '');
    return `https://ipfs.filebase.io/ipfs/${cid}`;
  }

  // Temp bucket URL - NOT publicly accessible, use placeholder
  if (imageUrl.includes('temp-images.s3.filebase.com')) {
    console.warn(`[TokenWars] War has temp URL (not accessible): ${imageUrl}`);
    return PLACEHOLDER;
  }

  // S3 bucket URL - may work if bucket is public
  if (imageUrl.includes('.s3.filebase.com')) {
    return imageUrl;
  }

  // Unknown format - try to use it
  return imageUrl;
}

// Token War Card Component
function TokenWarCard({ war }: { war: TokenWar }) {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageSrc(getDisplayImageUrl(war.imageUrl));
    setImageError(false);
  }, [war.imageUrl]);

  const handleImageError = () => {
    console.warn(`[TokenWars] Image failed to load for ${war.id}: ${war.imageUrl}`);
    setImageError(true);
    setImageSrc('/images/token-placeholder.png');
  };

  return (
    <div className="token-war-card">
      <div className="token-image-container">
        <img
          src={imageSrc}
          alt={`${war.name} (${war.symbol})`}
          onError={handleImageError}
          loading="lazy"
          className={imageError ? 'image-error' : ''}
        />
        {imageError && (
          <span className="image-error-badge">Image unavailable</span>
        )}
      </div>
      <h3>{war.name}</h3>
      <span className="symbol">${war.symbol}</span>
    </div>
  );
}
```

### Image Loading with Fallbacks

```typescript
// More robust image component with multiple fallback options
function TokenWarImage({
  imageUrl,
  name,
  symbol,
  size = 'medium'
}: {
  imageUrl?: string;
  name: string;
  symbol: string;
  size?: 'small' | 'medium' | 'large';
}) {
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const [fallbackIndex, setFallbackIndex] = useState(0);

  // Generate fallback URLs
  const getFallbackUrls = (url: string | undefined): string[] => {
    const fallbacks: string[] = [];

    if (url) {
      // Extract CID if it's an IPFS URL
      const cidMatch = url.match(/ipfs\/([a-zA-Z0-9]+)/);
      if (cidMatch) {
        const cid = cidMatch[1];
        // Try multiple IPFS gateways
        fallbacks.push(`https://ipfs.filebase.io/ipfs/${cid}`);
        fallbacks.push(`https://cloudflare-ipfs.com/ipfs/${cid}`);
        fallbacks.push(`https://ipfs.io/ipfs/${cid}`);
      } else if (!url.includes('temp-images')) {
        // Not a temp URL, try using it directly
        fallbacks.push(url);
      }
    }

    // Always add placeholder as final fallback
    fallbacks.push('/images/token-placeholder.png');

    return fallbacks;
  };

  const fallbackUrls = getFallbackUrls(imageUrl);

  useEffect(() => {
    setCurrentSrc(fallbackUrls[0] || '/images/token-placeholder.png');
    setFallbackIndex(0);
  }, [imageUrl]);

  const handleError = () => {
    const nextIndex = fallbackIndex + 1;
    if (nextIndex < fallbackUrls.length) {
      console.log(`[TokenWars] Trying fallback ${nextIndex}: ${fallbackUrls[nextIndex]}`);
      setFallbackIndex(nextIndex);
      setCurrentSrc(fallbackUrls[nextIndex]);
    }
  };

  const sizeClasses = {
    small: 'w-12 h-12',
    medium: 'w-24 h-24',
    large: 'w-48 h-48'
  };

  return (
    <img
      src={currentSrc}
      alt={`${name} (${symbol})`}
      onError={handleError}
      className={`${sizeClasses[size]} object-cover rounded-lg`}
      loading="lazy"
    />
  );
}
```

### Fetching Wars from API

```typescript
const API_BASE = 'https://api.applesnakes.com'; // Your API base URL

// Fetch all active wars
async function fetchActiveWars(): Promise<TokenWar[]> {
  const response = await fetch(`${API_BASE}/api/token-wars`);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch wars');
  }

  return data.wars;
}

// Fetch single war by ID
async function fetchWar(warId: string): Promise<TokenWar> {
  const response = await fetch(`${API_BASE}/api/token-wars/${warId}`);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'War not found');
  }

  return data.war;
}

// Example usage with React Query
import { useQuery } from '@tanstack/react-query';

function useTokenWars() {
  return useQuery({
    queryKey: ['token-wars'],
    queryFn: fetchActiveWars,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

function useTokenWar(warId: string) {
  return useQuery({
    queryKey: ['token-war', warId],
    queryFn: () => fetchWar(warId),
    enabled: !!warId,
  });
}
```

## CSS Styling

```css
/* Token war card styles */
.token-war-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 12px;
  background: #1a1a1a;
  border: 1px solid #333;
}

.token-image-container {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 8px;
  background: #0a0a0a;
}

.token-image-container img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
}

.token-image-container img.image-error {
  opacity: 0.5;
}

.image-error-badge {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: rgba(255, 0, 0, 0.8);
  color: white;
  font-size: 10px;
  border-radius: 4px;
}

/* Loading skeleton */
.token-image-skeleton {
  width: 100%;
  aspect-ratio: 1;
  background: linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

## Debugging Image Issues

### Check Image URL in Console

```typescript
// Add this to your war list component for debugging
useEffect(() => {
  wars.forEach(war => {
    console.log(`[TokenWars Debug] ${war.id}:`, {
      imageUrl: war.imageUrl,
      isIPFS: war.imageUrl?.includes('ipfs'),
      isTemp: war.imageUrl?.includes('temp-images'),
    });
  });
}, [wars]);
```

### Test Image URL Manually

```bash
# Test if an IPFS URL is accessible
curl -I "https://ipfs.filebase.io/ipfs/QmXxx..."

# Expected: HTTP/2 200 (success) or HTTP/2 404 (not found)
```

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Image shows placeholder | `imageUrl` is undefined or empty | Check if image was uploaded during war creation |
| 403 Forbidden | Using temp bucket URL | Temp bucket isn't public - this is a backend issue |
| 404 Not Found | CID doesn't exist on IPFS | File may not have been uploaded correctly |
| Slow loading | IPFS propagation delay | Use multiple gateway fallbacks |
| CORS error | Gateway doesn't allow cross-origin | Use a different IPFS gateway |

## Full Example: Token Wars List Page

```tsx
import { useTokenWars } from './hooks/useTokenWars';
import { TokenWarImage } from './components/TokenWarImage';

export function TokenWarsList() {
  const { data: wars, isLoading, error } = useTokenWars();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="token-war-card">
            <div className="token-image-skeleton" />
            <div className="h-4 bg-gray-700 rounded mt-4 w-3/4" />
            <div className="h-3 bg-gray-800 rounded mt-2 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500">Error loading wars: {error.message}</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {wars?.map(war => (
        <div key={war.id} className="token-war-card">
          <TokenWarImage
            imageUrl={war.imageUrl}
            name={war.name}
            symbol={war.symbol}
            size="medium"
          />
          <h3 className="mt-4 font-bold text-white">{war.name}</h3>
          <span className="text-gray-400">${war.symbol}</span>
          <div className="mt-2 text-sm text-green-400">
            ${war.totalRaised?.toFixed(2)} raised
          </div>
        </div>
      ))}
    </div>
  );
}
```

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/token-wars` | GET | List active wars |
| `/api/token-wars?all=true` | GET | List all wars (any status) |
| `/api/token-wars?status=active` | GET | Filter by status |
| `/api/token-wars/{warId}` | GET | Get single war details |

## Image URL Expected Format

After successful war creation with image, the `imageUrl` should be:
```
https://ipfs.filebase.io/ipfs/Qm... (IPFS CID hash)
```

If you're seeing temp bucket URLs (`temp-images.s3.filebase.com`), please report this to the backend team as it indicates the permanent upload failed.

## Contact

If images are consistently failing to load or you're getting temp bucket URLs, check:
1. Backend logs for `[TokenWarsImage]` entries
2. Whether the CID was returned from Filebase
3. Whether the war's `imageUrl` was updated after upload
