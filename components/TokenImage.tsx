// components/TokenImage.tsx
// Token image component with IPNS gateway and fallback support
'use client';

import { useState, useEffect } from 'react';

// IPNS Gateway Base URL for Token Wars images
const IPNS_GATEWAY_BASE = 'https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5djw93k7hfk14jv602y3egzzw4ihkm6pykzeqp1gqd5hic0wkatp';

interface TokenImageProps {
  imageUrl?: string | null;
  warId?: string | number;  // Optional - for IPNS fallback when no imageUrl
  symbol: string;
  size?: number;
  className?: string;
}

/**
 * TokenImage - Displays token images with graceful fallback
 *
 * Features:
 * - Handles IPNS URLs (applesnakes.myfilebase.com/ipns/...)
 * - Constructs IPNS URL from warId if no imageUrl provided
 * - Tries both .png and .jpg extensions before fallback
 * - Shows gradient fallback with token initials on error
 * - Lazy loads images for performance
 */
export function TokenImage({ imageUrl, warId, symbol, size = 48, className = '' }: TokenImageProps) {
  const [currentExt, setCurrentExt] = useState<'png' | 'jpg'>('png');
  const [error, setError] = useState(false);

  // Reset state when warId or imageUrl changes
  useEffect(() => {
    setCurrentExt('png');
    setError(false);
  }, [warId, imageUrl]);

  // Generate fallback with initials
  const fallback = (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 rounded-full text-white font-bold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );

  // Resolve the image URL
  const getImageUrl = (): string | null => {
    // If we have an imageUrl, check if it needs transformation
    if (imageUrl) {
      // Already using IPNS gateway - use directly
      if (imageUrl.includes('applesnakes.myfilebase.com/ipns')) {
        return imageUrl;
      }

      // Legacy temp bucket URL - construct IPNS URL from warId
      if (imageUrl.includes('temp-images.s3.filebase.com') && warId) {
        return `${IPNS_GATEWAY_BASE}/${warId}.${currentExt}`;
      }

      // IPFS CID URL - try to use it directly
      if (imageUrl.includes('ipfs.filebase.io/ipfs') || imageUrl.includes('ipfs://')) {
        return imageUrl;
      }

      // Unknown format - try it as-is
      return imageUrl;
    }

    // No imageUrl, but we have warId - construct IPNS URL
    if (warId) {
      return `${IPNS_GATEWAY_BASE}/${warId}.${currentExt}`;
    }

    return null;
  };

  const currentUrl = getImageUrl();

  // Show fallback if all attempts failed
  if (error && currentExt === 'jpg') {
    return fallback;
  }

  if (!currentUrl) {
    return fallback;
  }

  const handleError = () => {
    if (currentExt === 'png') {
      // Try jpg extension
      setCurrentExt('jpg');
      setError(false);
    } else {
      // Both failed, show fallback
      setError(true);
    }
  };

  return (
    <img
      src={currentUrl}
      alt={symbol}
      width={size}
      height={size}
      className={`rounded-full object-cover ${className}`}
      onError={handleError}
      loading="lazy"
    />
  );
}

/**
 * Helper function to get IPNS image URL for a war
 */
export function getTokenImageUrl(warId: string | number, ext: 'png' | 'jpg' = 'png'): string {
  return `${IPNS_GATEWAY_BASE}/${warId}.${ext}`;
}

/**
 * Resolve image URL from war data, handling legacy URLs
 */
export function getResolvedImageUrl(war: { id: string; imageUrl?: string | null }): string | null {
  if (!war.imageUrl) {
    // No image URL stored, construct from war ID
    return `${IPNS_GATEWAY_BASE}/${war.id}.png`;
  }

  // Already using IPNS gateway
  if (war.imageUrl.includes('applesnakes.myfilebase.com/ipns')) {
    return war.imageUrl;
  }

  // Legacy temp bucket URL - construct IPNS URL
  if (war.imageUrl.includes('temp-images.s3.filebase.com')) {
    const ext = war.imageUrl.endsWith('.jpg') || war.imageUrl.endsWith('.jpeg') ? 'jpg' : 'png';
    return `${IPNS_GATEWAY_BASE}/${war.id}.${ext}`;
  }

  // Unknown format - return as-is
  return war.imageUrl;
}

export default TokenImage;
