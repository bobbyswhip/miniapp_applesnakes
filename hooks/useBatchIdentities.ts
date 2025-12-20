// hooks/useBatchIdentities.ts
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { keccak256, namehash, encodePacked, toBytes } from 'viem';
import { base } from 'viem/chains';
import { usePublicClient } from 'wagmi';

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

// L2 Resolver contract on Base mainnet
const L2_RESOLVER_ADDRESS = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as const;

// Minimal ABI for the name() function
const L2_RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Global cache for resolved names (persists across hook instances)
const nameCache = new Map<string, string | null>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

// Helper to get short address
const getShortAddress = (address: string): string =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

// Check if cache entry is still valid
const isCacheValid = (address: string): boolean => {
  const timestamp = cacheTimestamps.get(address.toLowerCase());
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_DURATION;
};

// Convert address to reverse node bytes for Base chain
// Based on OnchainKit's convertReverseNodeToBytes
const convertAddressToReverseNode = (address: string): `0x${string}` => {
  const addressFormatted = address.toLowerCase();
  // Hash the address string (without 0x) as UTF-8 bytes
  // e.g., "d1ec8245..." -> hash the ASCII bytes of this 40-char string
  const addressWithout0x = addressFormatted.substring(2);
  const addressNode = keccak256(toBytes(addressWithout0x));

  // Base chainId = 8453, coinType = (0x80000000 | 8453) = 0x80002105 = "80002105"
  const coinType = '80002105';
  const baseReverseNode = namehash(`${coinType}.reverse`);

  const addressReverseNode = keccak256(
    encodePacked(['bytes32', 'bytes32'], [baseReverseNode, addressNode])
  );

  return addressReverseNode;
};

/**
 * Ultra-fast hook to batch fetch Basenames using a single multicall
 *
 * Performance optimizations:
 * - Single RPC multicall (no forward verification, no ENS fallback)
 * - Global in-memory cache with 5-min TTL
 * - Immediate short address fallback (non-blocking UI)
 * - Only fetches uncached addresses
 * - 100ms debounce to batch rapid changes
 */
export function useBatchIdentities(addresses: string[]): BatchIdentitiesResult {
  const [identities, setIdentities] = useState<Map<string, IdentityData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInProgress = useRef(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const publicClient = usePublicClient({ chainId: base.id });

  // Memoize and dedupe addresses
  const addressList = useMemo(() => {
    const unique = [...new Set(addresses.map(a => a?.toLowerCase()).filter(Boolean))];
    return unique.filter(a => a.startsWith('0x') && a.length === 42);
  }, [addresses.join(',')]);

  // Immediately build identity map with cached values or short addresses
  const immediateIdentities = useMemo(() => {
    const map = new Map<string, IdentityData>();
    addressList.forEach(address => {
      const normalized = address.toLowerCase();
      const cachedName = isCacheValid(normalized) ? nameCache.get(normalized) : null;
      map.set(normalized, {
        name: cachedName ?? null,
        avatar: null,
        address,
        shortAddress: getShortAddress(address),
      });
    });
    return map;
  }, [addressList]);

  // Set immediate identities on mount/change
  useEffect(() => {
    setIdentities(immediateIdentities);
  }, [immediateIdentities]);

  // Fetch only uncached addresses using single multicall
  const fetchIdentities = useCallback(async () => {
    if (addressList.length === 0 || fetchInProgress.current || !publicClient) return;

    // Filter to only addresses not in cache
    const uncachedAddresses = addressList.filter(addr => !isCacheValid(addr.toLowerCase()));

    if (uncachedAddresses.length === 0) {
      return; // All cached, nothing to fetch
    }

    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Build multicall contracts array
      const contracts = uncachedAddresses.map(address => ({
        address: L2_RESOLVER_ADDRESS,
        abi: L2_RESOLVER_ABI,
        functionName: 'name' as const,
        args: [convertAddressToReverseNode(address)] as const,
      }));

      // Single multicall to fetch all names at once
      const results = await publicClient.multicall({
        contracts,
        allowFailure: true,
      });

      // Update cache with results
      const now = Date.now();
      uncachedAddresses.forEach((address, index) => {
        const normalized = address.toLowerCase();
        const result = results[index];
        const name = result.status === 'success' && result.result ? (result.result as string) : null;
        nameCache.set(normalized, name);
        cacheTimestamps.set(normalized, now);
      });

      // Update state with all addresses (cached + newly fetched)
      setIdentities(prev => {
        const newMap = new Map(prev);
        addressList.forEach(address => {
          const normalized = address.toLowerCase();
          const name = nameCache.get(normalized) ?? null;
          newMap.set(normalized, {
            name,
            avatar: null,
            address,
            shortAddress: getShortAddress(address),
          });
        });
        return newMap;
      });

    } catch (err) {
      console.error('[BatchIdentities] Multicall failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch identities');

      // Cache null results to prevent refetching on error
      const now = Date.now();
      uncachedAddresses.forEach(address => {
        const normalized = address.toLowerCase();
        nameCache.set(normalized, null);
        cacheTimestamps.set(normalized, now);
      });
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, [addressList, publicClient]);

  // Debounced fetch effect
  useEffect(() => {
    if (addressList.length === 0) return;

    // Clear any pending debounce
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Check if we need to fetch at all
    const needsFetch = addressList.some(addr => !isCacheValid(addr.toLowerCase()));
    if (!needsFetch) return;

    // Debounce the fetch by 100ms to batch rapid address changes
    debounceTimer.current = setTimeout(() => {
      fetchIdentities();
    }, 100);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [addressList, fetchIdentities]);

  // Helper to get identity for a specific address (stable reference)
  const getIdentity = useCallback((address: string): IdentityData => {
    const normalized = address?.toLowerCase();
    if (!normalized) {
      return { name: null, avatar: null, address: '', shortAddress: '' };
    }

    const existing = identities.get(normalized);
    if (existing) return existing;

    // Check cache as fallback
    const cachedName = isCacheValid(normalized) ? nameCache.get(normalized) : null;

    return {
      name: cachedName ?? null,
      avatar: null,
      address,
      shortAddress: getShortAddress(address),
    };
  }, [identities]);

  return {
    identities,
    isLoading,
    error,
    getIdentity,
  };
}
