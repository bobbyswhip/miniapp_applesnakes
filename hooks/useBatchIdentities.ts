// hooks/useBatchIdentities.ts
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getNames, getAvatars } from '@coinbase/onchainkit/identity';
import { base } from 'viem/chains';
import type { Address } from 'viem';

export interface IdentityData {
  name: string | null;
  avatar: string | null;
  address: string;
  shortAddress: string;
}

export interface BatchIdentitiesResult {
  identities: Map<string, IdentityData>;
  isLoading: boolean;
  error: string | null;
  getIdentity: (address: string) => IdentityData;
}

/**
 * Hook to batch fetch basenames and avatars for multiple addresses
 * Uses OnchainKit's getNames and getAvatars batch utilities for performance
 */
export function useBatchIdentities(addresses: string[]): BatchIdentitiesResult {
  const [identities, setIdentities] = useState<Map<string, IdentityData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize addresses array to prevent unnecessary refetches
  const addressList = useMemo(() => {
    // Dedupe and normalize addresses
    const unique = [...new Set(addresses.map(a => a.toLowerCase()))];
    return unique.filter(a => a && a.startsWith('0x') && a.length === 42);
  }, [addresses.join(',')]);

  const fetchIdentities = useCallback(async () => {
    if (addressList.length === 0) {
      setIdentities(new Map());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Batch fetch names using OnchainKit's getNames
      const namesPromise = getNames({
        addresses: addressList as Address[],
        chain: base,
      });

      // Wait for names first (we need them for avatar lookups)
      const names = await namesPromise;

      // Build initial identity map with names
      const identityMap = new Map<string, IdentityData>();

      addressList.forEach((address, index) => {
        const name = names?.[index] || null;
        const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

        identityMap.set(address.toLowerCase(), {
          name,
          avatar: null, // Will be filled in by avatar fetch
          address,
          shortAddress,
        });
      });

      // Batch fetch avatars for addresses that have names
      const namesWithValues = addressList
        .map((addr, i) => ({ address: addr, name: names?.[i] }))
        .filter(item => item.name);

      if (namesWithValues.length > 0) {
        try {
          const avatars = await getAvatars(
            namesWithValues.map(item => ({
              ensName: item.name as string,
              chain: base,
            }))
          );

          // Update identity map with avatars
          namesWithValues.forEach((item, index) => {
            const existing = identityMap.get(item.address.toLowerCase());
            if (existing && avatars?.[index]) {
              existing.avatar = avatars[index];
            }
          });
        } catch (avatarError) {
          // Avatar fetch failed, continue with names only
          console.warn('[BatchIdentities] Avatar fetch failed:', avatarError);
        }
      }

      setIdentities(identityMap);
    } catch (err) {
      console.error('[BatchIdentities] Batch fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch identities');

      // Fallback: create map with just short addresses
      const fallbackMap = new Map<string, IdentityData>();
      addressList.forEach(address => {
        fallbackMap.set(address.toLowerCase(), {
          name: null,
          avatar: null,
          address,
          shortAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
        });
      });
      setIdentities(fallbackMap);
    } finally {
      setIsLoading(false);
    }
  }, [addressList]);

  // Fetch when addresses change
  useEffect(() => {
    fetchIdentities();
  }, [fetchIdentities]);

  // Helper to get identity for a specific address
  const getIdentity = useCallback((address: string): IdentityData => {
    const normalized = address.toLowerCase();
    const existing = identities.get(normalized);

    if (existing) {
      return existing;
    }

    // Return fallback if not in map
    return {
      name: null,
      avatar: null,
      address,
      shortAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
    };
  }, [identities]);

  return {
    identities,
    isLoading,
    error,
    getIdentity,
  };
}
