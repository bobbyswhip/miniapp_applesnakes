// components/ParticipantIdentity.tsx
'use client';

import type { IdentityData } from '@/hooks/useBatchIdentities';

interface ParticipantIdentityProps {
  address: string;
  identity?: IdentityData; // Pre-fetched from batch hook
  className?: string;
  showAvatar?: boolean;
}

/**
 * Displays participant identity with basename and avatar
 * Uses pre-fetched batch data for performance when available
 */
export function ParticipantIdentity({
  address,
  identity,
  className = '',
  showAvatar = true
}: ParticipantIdentityProps) {
  // Use pre-fetched data or fallback to short address
  const displayName = identity?.name || identity?.shortAddress || `${address.slice(0, 6)}...${address.slice(-4)}`;
  const avatarUrl = identity?.avatar;

  return (
    <a
      href={`https://basescan.org/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 ${className}`}
    >
      {showAvatar && (
        avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-6 h-6 rounded-full object-cover bg-gray-700"
            onError={(e) => {
              // Fallback to gradient on error
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[10px] font-bold text-white">
            {address.slice(2, 4).toUpperCase()}
          </div>
        )
      )}
      <span className="text-sm font-mono text-purple-400 hover:underline">
        {displayName}
      </span>
    </a>
  );
}

// Compact version for table rows - same as above but smaller avatar
export function ParticipantIdentityCompact({
  address,
  identity
}: {
  address: string;
  identity?: IdentityData;
}) {
  const displayName = identity?.name || identity?.shortAddress || `${address.slice(0, 6)}...${address.slice(-4)}`;
  const avatarUrl = identity?.avatar;

  return (
    <a
      href={`https://basescan.org/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-5 h-5 rounded-full object-cover bg-gray-700"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[8px] font-bold text-white">
          {address.slice(2, 4).toUpperCase()}
        </div>
      )}
      <span className="text-sm font-mono text-purple-400 hover:underline">
        {displayName}
      </span>
    </a>
  );
}
