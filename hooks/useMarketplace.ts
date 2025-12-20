'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
} from 'wagmi';
import { parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts, WASS_TOKEN_ADDRESS } from '@/config/contracts';
import { MARKETPLACE_ABI } from '@/abis/marketplace';
import { ERC20_ABI } from '@/abis/erc20';

// =============================================================================
// TYPES
// =============================================================================

export interface MarketplaceListing {
  collection: `0x${string}`;
  tokenId: bigint;
  seller: `0x${string}`;
  price: bigint; // in wASS (18 decimals)
  priceFormatted: string;
  active: boolean;
  isApproved: boolean;
}

export interface MarketplaceStats {
  totalListings: bigint;
  totalSales: bigint;
  totalVolumeWass: bigint;
  totalVolumeFormatted: string;
  totalFeesCollected: bigint;
  feeBps: bigint;
  feePercent: number;
  collectionCount: bigint;
  activeListingCount: bigint;
  // V3 - Staking rewards
  totalFeesToStakers: bigint;
  totalFeesToStakersFormatted: string;
}

// =============================================================================
// MARKETPLACE ADDRESS (V3 - Staking Rewards)
// =============================================================================

export const MARKETPLACE_ADDRESS = '0xd006C1970AAcffcCAcAf6180Ad24081CdE608e82' as const;

// =============================================================================
// useMarketplaceStats - Get marketplace statistics
// =============================================================================

export function useMarketplaceStats() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.marketplace.address,
    abi: MARKETPLACE_ABI,
    functionName: 'getStats',
    chainId: base.id,
  });

  // V3 order: totalListings, totalSales, totalVolumeWass, totalFeesCollected,
  //           totalFeesToStakers, feeBps, collectionCount, activeListingCount
  const stats: MarketplaceStats | null = data ? {
    totalListings: data[0],
    totalSales: data[1],
    totalVolumeWass: data[2],
    totalVolumeFormatted: formatUnits(data[2], 18),
    totalFeesCollected: data[3],
    // V3 - Staking rewards at position 4
    totalFeesToStakers: data[4],
    totalFeesToStakersFormatted: formatUnits(data[4], 18),
    feeBps: data[5],
    feePercent: Number(data[5]) / 100,
    collectionCount: data[6],
    activeListingCount: data[7],
  } : null;

  return { stats, isLoading, error, refetch };
}

// =============================================================================
// useListing - Get single listing details
// =============================================================================

export function useListing(collection: `0x${string}`, tokenId: bigint | number) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.marketplace.address,
    abi: MARKETPLACE_ABI,
    functionName: 'getListing',
    args: [collection, BigInt(tokenId)],
    chainId: base.id,
  });

  const listing: MarketplaceListing | null = data ? {
    collection,
    tokenId: BigInt(tokenId),
    seller: data[0],
    price: data[1],
    priceFormatted: formatUnits(data[1], 18),
    active: data[2],
    isApproved: data[3],
  } : null;

  return { listing, isLoading, error, refetch };
}

// =============================================================================
// useListingsBatch - Get multiple listings at once
// =============================================================================

export function useListingsBatch(collection: `0x${string}`, tokenIds: (bigint | number)[]) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.marketplace.address,
    abi: MARKETPLACE_ABI,
    functionName: 'getListingsBatch',
    args: [collection, tokenIds.map(id => BigInt(id))],
    chainId: base.id,
    query: {
      enabled: tokenIds.length > 0,
    },
  });

  const listings: MarketplaceListing[] = data ? tokenIds.map((tokenId, i) => ({
    collection,
    tokenId: BigInt(tokenId),
    seller: data[0][i],
    price: data[1][i],
    priceFormatted: formatUnits(data[1][i], 18),
    active: data[2][i],
    isApproved: true, // batch doesn't return approval status
  })).filter(l => l.active) : [];

  return { listings, isLoading, error, refetch };
}

// =============================================================================
// useAllListings - Get all active listings for a collection
// =============================================================================

export function useAllListings(collection: `0x${string}`, maxTokenId: number = 3000) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const fetchListings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch in batches of 100
      const batchSize = 100;
      const allListings: MarketplaceListing[] = [];

      for (let start = 1; start <= maxTokenId; start += batchSize) {
        const end = Math.min(start + batchSize - 1, maxTokenId);
        const tokenIds = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));

        // Use multicall to fetch batch
        const response = await fetch('/api/marketplace/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection,
            tokenIds: tokenIds.map(id => id.toString()),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.listings) {
            allListings.push(...data.listings.map((l: { tokenId: string; seller: string; price: string; active: boolean }) => ({
              collection,
              tokenId: BigInt(l.tokenId),
              seller: l.seller as `0x${string}`,
              price: BigInt(l.price),
              priceFormatted: formatUnits(BigInt(l.price), 18),
              active: l.active,
              isApproved: true,
            })).filter((l: MarketplaceListing) => l.active));
          }
        }
      }

      setListings(allListings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch listings');
    } finally {
      setIsLoading(false);
    }
  }, [collection, maxTokenId]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  return { listings, isLoading, error, refetch: fetchListings };
}

// =============================================================================
// useQuoteEthForListing - Get ETH needed to buy a listing
// =============================================================================

export function useQuoteEthForListing(collection: `0x${string}`, tokenId: bigint | number) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data, isLoading, error, refetch } = useReadContract({
    address: contracts.marketplace.address,
    abi: MARKETPLACE_ABI,
    functionName: 'quoteEthForListing',
    args: [collection, BigInt(tokenId)],
    chainId: base.id,
  });

  return {
    ethNeeded: data ? data[0] : 0n,
    ethNeededFormatted: data ? formatEther(data[0]) : '0',
    price: data ? data[1] : 0n,
    priceFormatted: data ? formatUnits(data[1], 18) : '0',
    active: data ? data[2] : false,
    isLoading,
    error,
    refetch,
  };
}

// =============================================================================
// useWassAllowance - Check wASS allowance for marketplace
// =============================================================================

export function useWassAllowance() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data: allowanceData, isLoading, error, refetch } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, contracts.marketplace.address],
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const allowance = (allowanceData as bigint | undefined) ?? 0n;

  return {
    allowance,
    allowanceFormatted: allowance > 0n ? formatUnits(allowance, 18) : '0',
    isLoading,
    error,
    refetch,
  };
}

// =============================================================================
// useWassBalance - Get user's wASS balance
// =============================================================================

export function useWassBalance() {
  const { address } = useAccount();

  const { data: balanceData, isLoading, error, refetch } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address!],
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const balance = (balanceData as bigint | undefined) ?? 0n;

  return {
    balance,
    balanceFormatted: balance > 0n ? formatUnits(balance, 18) : '0',
    isLoading,
    error,
    refetch,
  };
}

// =============================================================================
// useIsApprovedForAll - Check if user has approved marketplace for all NFTs
// =============================================================================

export function useIsApprovedForAll(collection: `0x${string}`) {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data: isApprovedForAll, isLoading, error, refetch } = useReadContract({
    address: collection,
    abi: [
      {
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'operator', type: 'address' },
        ],
        name: 'isApprovedForAll',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'isApprovedForAll',
    args: [address!, contracts.marketplace.address],
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  return {
    isApprovedForAll: isApprovedForAll ?? false,
    isLoading,
    error,
    refetch,
  };
}

// =============================================================================
// useSetApprovalForAll - Set approval for all NFTs (one-time approval)
// =============================================================================

export function useSetApprovalForAll() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const setApprovalForAll = useCallback(
    async (collection: `0x${string}`, approved: boolean = true) => {
      writeContract({
        address: collection,
        abi: [
          {
            inputs: [
              { name: 'operator', type: 'address' },
              { name: 'approved', type: 'bool' },
            ],
            name: 'setApprovalForAll',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
          },
        ],
        functionName: 'setApprovalForAll',
        args: [contracts.marketplace.address, approved],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    setApprovalForAll,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useNFTApproval - Check if NFT is approved for marketplace
// =============================================================================

export function useNFTApproval(collection: `0x${string}`, tokenId: bigint | number) {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  // Check if approved for all (preferred - one-time approval)
  const { data: isApprovedForAll, refetch: refetchApprovalForAll } = useReadContract({
    address: collection,
    abi: [
      {
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'operator', type: 'address' },
        ],
        name: 'isApprovedForAll',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'isApprovedForAll',
    args: [address!, contracts.marketplace.address],
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  // Check specific token approval (fallback - per-token approval)
  const { data: approvedAddress, refetch: refetchTokenApproval } = useReadContract({
    address: collection,
    abi: [
      {
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        name: 'getApproved',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'getApproved',
    args: [BigInt(tokenId)],
    chainId: base.id,
  });

  const isApproved = isApprovedForAll || approvedAddress === contracts.marketplace.address;

  const refetchApproval = useCallback(() => {
    refetchApprovalForAll();
    refetchTokenApproval();
  }, [refetchApprovalForAll, refetchTokenApproval]);

  return {
    isApproved,
    isApprovedForAll: isApprovedForAll ?? false,
    refetchApproval
  };
}

// =============================================================================
// useListNFT - List an NFT for sale
// =============================================================================

export function useListNFT() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const list = useCallback(
    async (collection: `0x${string}`, tokenId: bigint | number, priceWass: string) => {
      const priceWei = parseUnits(priceWass, 18);

      writeContract({
        address: contracts.marketplace.address,
        abi: MARKETPLACE_ABI,
        functionName: 'list',
        args: [collection, BigInt(tokenId), priceWei],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    list,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useListBatch - List multiple NFTs for sale at the same price
// =============================================================================

export function useListBatch() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const listBatch = useCallback(
    async (collection: `0x${string}`, tokenIds: (bigint | number)[], priceWass: string) => {
      const priceWei = parseUnits(priceWass, 18);
      const tokenIdsBigInt = tokenIds.map(id => BigInt(id));

      writeContract({
        address: contracts.marketplace.address,
        abi: MARKETPLACE_ABI,
        functionName: 'listBatch',
        args: [collection, tokenIdsBigInt, priceWei],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    listBatch,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useUnlistNFT - Cancel a listing
// =============================================================================

export function useUnlistNFT() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const unlist = useCallback(
    async (collection: `0x${string}`, tokenId: bigint | number) => {
      writeContract({
        address: contracts.marketplace.address,
        abi: MARKETPLACE_ABI,
        functionName: 'unlist',
        args: [collection, BigInt(tokenId)],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    unlist,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useUpdatePrice - Update listing price
// =============================================================================

export function useUpdatePrice() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const updatePrice = useCallback(
    async (collection: `0x${string}`, tokenId: bigint | number, newPriceWass: string) => {
      const priceWei = parseUnits(newPriceWass, 18);

      writeContract({
        address: contracts.marketplace.address,
        abi: MARKETPLACE_ABI,
        functionName: 'updatePrice',
        args: [collection, BigInt(tokenId), priceWei],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    updatePrice,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useBuyWithWass - Buy with wASS
// =============================================================================

export function useBuyWithWass() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const buyWithWass = useCallback(
    async (collection: `0x${string}`, tokenId: bigint | number) => {
      writeContract({
        address: contracts.marketplace.address,
        abi: MARKETPLACE_ABI,
        functionName: 'buyWithWass',
        args: [collection, BigInt(tokenId)],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    buyWithWass,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useBuyWithEth - Buy with ETH (auto-converts to wASS)
// =============================================================================

export function useBuyWithEth() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const buyWithEth = useCallback(
    async (
      collection: `0x${string}`,
      tokenId: bigint | number,
      ethAmount: string,
      minWassOut: bigint = 0n
    ) => {
      const ethWei = parseEther(ethAmount);

      writeContract({
        address: contracts.marketplace.address,
        abi: MARKETPLACE_ABI,
        functionName: 'buyWithEth',
        args: [collection, BigInt(tokenId), minWassOut],
        value: ethWei,
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    buyWithEth,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useApproveWass - Approve wASS spending
// =============================================================================

export function useApproveWass() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const approveWass = useCallback(
    async (amount: bigint = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) => {
      writeContract({
        address: WASS_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [contracts.marketplace.address, amount],
        chainId: base.id,
      });
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    approveWass,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useApproveNFT - Approve NFT for marketplace
// =============================================================================

export function useApproveNFT() {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const approveNFT = useCallback(
    async (collection: `0x${string}`, tokenId?: bigint | number) => {
      if (tokenId !== undefined) {
        // Approve single token
        writeContract({
          address: collection,
          abi: [
            {
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'tokenId', type: 'uint256' },
              ],
              name: 'approve',
              outputs: [],
              stateMutability: 'nonpayable',
              type: 'function',
            },
          ],
          functionName: 'approve',
          args: [contracts.marketplace.address, BigInt(tokenId)],
          chainId: base.id,
        });
      } else {
        // Approve all
        writeContract({
          address: collection,
          abi: [
            {
              inputs: [
                { name: 'operator', type: 'address' },
                { name: 'approved', type: 'bool' },
              ],
              name: 'setApprovalForAll',
              outputs: [],
              stateMutability: 'nonpayable',
              type: 'function',
            },
          ],
          functionName: 'setApprovalForAll',
          args: [contracts.marketplace.address, true],
          chainId: base.id,
        });
      }
    },
    [writeContract, contracts.marketplace.address]
  );

  return {
    approveNFT,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// =============================================================================
// useIsCollectionApproved - Check if collection is approved for marketplace
// =============================================================================

export function useIsCollectionApproved(collection: `0x${string}`) {
  const chainId = useChainId();
  const contracts = getContracts(chainId || base.id);

  const { data: isApproved, isLoading, error, refetch } = useReadContract({
    address: contracts.marketplace.address,
    abi: MARKETPLACE_ABI,
    functionName: 'approvedCollections',
    args: [collection],
    chainId: base.id,
  });

  return {
    isApproved: isApproved ?? false,
    isLoading,
    error,
    refetch,
  };
}
