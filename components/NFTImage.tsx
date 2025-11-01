'use client';

import Image from 'next/image';
import { useState, useEffect, memo } from 'react';

/**
 * NFTImage Component
 *
 * Optimized for rendering IPFS-hosted NFT images with:
 * - Dynamic base URI from contract
 * - Multiple gateway fallbacks for reliability
 * - Automatic retry on failure
 * - Loading states and placeholders
 * - Jailed variant support
 * - Next.js automatic optimization
 */

// Multiple IPFS gateways for redundancy and speed
const IPFS_GATEWAYS = [
  'https://surrounding-amaranth-catshark.myfilebase.com/ipfs/', // Project-specific gateway
  'https://cloudflare-ipfs.com/ipfs/', // Usually fastest
  'https://ipfs.io/ipfs/',              // Most reliable
  'https://gateway.pinata.cloud/ipfs/', // Good CDN
  'https://dweb.link/ipfs/',            // Protocol Labs
];

interface NFTImageProps {
  tokenId: number;            // NFT token ID
  imageUrl: string;           // IPFS path (without gateway prefix)
  isJailed?: boolean;         // Whether to show jailed variant
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;         // Set true for above-fold images
  thumbnail?: boolean;        // Use smaller size for gallery views
}

const NFTImageComponent = function NFTImage({
  tokenId,
  imageUrl: ipfsPath,
  isJailed = false,
  alt,
  width = 400,
  height = 400,
  className = '',
  priority = false,
  thumbnail = false,
}: NFTImageProps) {
  const [gatewayIndex, setGatewayIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Reset state when tokenId or ipfsPath changes
  useEffect(() => {
    setGatewayIndex(0);
    setIsLoading(true);
    setHasError(false);
  }, [tokenId, ipfsPath]);

  // Build full URL - handle both full URLs from Alchemy and IPFS paths
  const fullImageUrl = (() => {
    if (!ipfsPath) return '';

    // If it's already a full URL (from Alchemy), use it directly
    if (ipfsPath.startsWith('http://') || ipfsPath.startsWith('https://')) {
      return ipfsPath;
    }

    // Otherwise, treat as IPFS path and use gateway
    return `${IPFS_GATEWAYS[gatewayIndex]}${ipfsPath}`;
  })();

  // Default alt text if not provided
  const imageAlt = alt || `AppleSnake #${tokenId}${isJailed ? ' (Jailed)' : ''}`;

  // Use smaller dimensions for thumbnails
  const displayWidth = thumbnail ? Math.min(width, 200) : width;
  const displayHeight = thumbnail ? Math.min(height, 200) : height;

  const handleError = () => {
    // Try next gateway if available
    if (gatewayIndex < IPFS_GATEWAYS.length - 1) {
      console.log(`Gateway ${gatewayIndex} failed for token ${tokenId}, trying next...`);
      setGatewayIndex(gatewayIndex + 1);
      setIsLoading(true);
    } else {
      // All gateways failed
      console.error('All IPFS gateways failed for:', ipfsPath);
      setHasError(true);
      setIsLoading(false);
    }
  };

  // Show loading placeholder if no image URL
  if (!ipfsPath) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-800 rounded ${className}`}
        style={{ width: displayWidth, height: displayHeight }}
      >
        <div className="text-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-xs text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-800 rounded ${className}`}
        style={{ width: displayWidth, height: displayHeight }}
      >
        <div className="text-center p-4">
          <span className="text-4xl mb-2">{isJailed ? '⛓️' : '🐍'}</span>
          <p className="text-xs text-gray-400">#{tokenId}</p>
          <p className="text-xs text-gray-500 mt-1">Image unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ width: '100%', height: '100%' }}>
      {/* Loading placeholder */}
      {isLoading && (
        <div
          className="absolute inset-0 bg-gray-800 animate-pulse rounded flex items-center justify-center"
        >
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-xs text-gray-400 mt-2">Loading...</p>
          </div>
        </div>
      )}

      {/* Actual image */}
      <Image
        src={fullImageUrl}
        alt={imageAlt}
        width={displayWidth}
        height={displayHeight}
        onLoad={() => setIsLoading(false)}
        onError={handleError}
        className={`rounded object-cover ${isJailed ? 'grayscale' : ''}`}
        style={{ width: '100%', height: '100%' }}
        priority={priority}
        loading={priority ? 'eager' : 'lazy'}
        quality={thumbnail ? 75 : 90}
        unoptimized={true}
      />

      {/* Jailed indicator badge */}
      {isJailed && !isLoading && (
        <div className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
          ⛓️ JAILED
        </div>
      )}
    </div>
  );
};

// Memoize component to prevent unnecessary re-renders
export const NFTImage = memo(NFTImageComponent);

/**
 * NFTGallery Component
 *
 * Optimized grid for rendering many NFT images with:
 * - Thumbnail mode for performance
 * - Responsive grid layout
 * - Jailed state indicators
 */
import { UserNFT } from '@/hooks/useUserNFTs';

interface NFTGalleryProps {
  nfts: UserNFT[];
  onNFTClick?: (nft: UserNFT) => void;
  showJailedBadge?: boolean;
}

export function NFTGallery({
  nfts,
  onNFTClick,
  showJailedBadge = true
}: NFTGalleryProps) {
  // Get emoji for NFT type
  const getTypeEmoji = (type: string) => {
    switch (type) {
      case 'human': return '🧑';
      case 'snake': return '🐍';
      case 'warden': return '⚔️';
      case 'egg': return '🥚';
      default: return '';
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {nfts.map((nft) => (
        <button
          key={nft.tokenId}
          onClick={() => onNFTClick?.(nft)}
          className="group relative transition-all duration-200 hover:scale-105 hover:shadow-xl flex flex-col bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50 hover:border-blue-500/50"
        >
          {/* Square Image Container */}
          <div className="relative aspect-square w-full overflow-hidden">
            <NFTImage
              tokenId={nft.tokenId}
              imageUrl={nft.imageUrl}
              isJailed={nft.isJailed && showJailedBadge}
              width={200}
              height={200}
              thumbnail={true}
              className="w-full h-full"
            />

            {/* Type Badge */}
            <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full text-xs">
              <span>{getTypeEmoji(nft.nftType)}</span>
            </div>

            {/* Token ID Badge */}
            <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full text-xs text-white font-mono">
              #{nft.tokenId}
            </div>
          </div>

          {/* Name and Status */}
          <div className="p-3 bg-gray-900/80 backdrop-blur-sm">
            <p className="text-white text-sm font-semibold text-center truncate">
              {nft.name}
            </p>
            {nft.isJailed && (
              <p className="text-red-400 text-xs text-center mt-1 flex items-center justify-center gap-1">
                ⛓️ Jailed
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
