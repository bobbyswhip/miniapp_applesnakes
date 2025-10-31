'use client';

import { useName } from '@coinbase/onchainkit/identity';
import { base } from 'wagmi/chains';
import { Address } from 'viem';

/**
 * Hook to resolve Basename for a given address
 * Falls back to shortened address if no Basename found
 */
export function useBasename(address: Address | undefined) {
  const { data: basename, isLoading } = useName({
    address: address as Address,
    chain: base,
  });

  // Format address as fallback: 0x1234...5678
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  return {
    displayName: basename || shortAddress,
    basename,
    isLoading,
    hasBasename: !!basename,
  };
}
