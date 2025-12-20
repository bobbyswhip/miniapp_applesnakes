// hooks/useTraitSwapper.ts
// Trait Swapper hook using verified-trait-swapper API from trait-swap.md
// Flow: GET data → User selects traits → POST with X402 payment → Image generated
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useX402Fetch } from './useX402Fetch';

// =============================================================================
// Types
// =============================================================================

export interface CurrentTraits {
  Background: string;
  Skin: string;
  Clothes: string;
  Pants: string;
  Eyes: string;
  Mouth: string;
  Hair: string;
  Hands: string;
  Accessory1: string;
  Accessory2: string;
  Accessory3: string;
  Accessory4: string;
  Accessory5: string;
  [key: string]: string;
}

export interface AvailableItems {
  [trait: string]: string[];
}

export interface Inventory {
  [tokenId: number]: number;
}

export interface OwnershipInfo {
  isOwner: boolean;
  actualOwner: string;
  verified: boolean;
  message: string;
}

export interface VerifiedTraitSwapperData {
  success: boolean;
  address: string;
  tokenId: number;
  ownership?: OwnershipInfo;
  currentTraits: CurrentTraits;
  inventory: Inventory;
  totalItems: number;
  availableItems: AvailableItems;
  requiredTraits?: string[];
  cooldowns: {
    fulfil: { canFulfil: boolean; remainingSeconds: number };
    withdraw: { canWithdraw: boolean; remainingSeconds: number };
  };
  price: string;
  paymentInfo?: {
    price: string;
    recipient: string;
    description: string;
  };
  error?: string;
}

export interface EquippedItem {
  trait: string;
  value: string;
  tokenId: number;
}

export interface HatHairClash {
  applied: boolean;
  hairHidden: string;
  reason: string;
}

export interface SwapResult {
  success: boolean;
  message?: string;
  tokenId?: number;
  newTraits?: CurrentTraits;
  equipped?: EquippedItem[];
  returned?: EquippedItem[];
  hatHairClash?: HatHairClash;
  image?: {
    url: string;
    ipfs?: {
      cid: string;
      url: string;
    };
  };
  inventory?: {
    balances: { [tokenId: number]: number };
    totalItems: number;
  };
  payment?: {
    price: string;
    status: string;
  };
  error?: string;
  missingItems?: EquippedItem[];
  details?: unknown;
}

// =============================================================================
// Hook
// =============================================================================

export function useTraitSwapper(tokenId: number) {
  const { address } = useAccount();
  const { x402Fetch, isLoading: isX402Loading, statusMessage, setStatusMessage } = useX402Fetch();

  // Data from verified-trait-swapper GET
  const [swapperData, setSwapperData] = useState<VerifiedTraitSwapperData | null>(null);
  const [currentTraits, setCurrentTraits] = useState<CurrentTraits | null>(null);
  const [selectedTraits, setSelectedTraits] = useState<CurrentTraits | null>(null);
  const [availableItems, setAvailableItems] = useState<AvailableItems>({});
  const [inventory, setInventory] = useState<Inventory>({});
  const [totalInventoryItems, setTotalInventoryItems] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<OwnershipInfo | null>(null);

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);

  // =============================================================================
  // Reset all state when tokenId changes to prevent stale data from previous NFT
  // This ensures traits always match the currently displayed NFT
  // =============================================================================
  useEffect(() => {
    // Clear all data when switching to a different NFT
    setSwapperData(null);
    setCurrentTraits(null);
    setSelectedTraits(null);
    setAvailableItems({});
    setInventory({});
    setTotalInventoryItems(0);
    setImageUrl(null);
    setOwnership(null);
    setError(null);
    setResult(null);
  }, [tokenId]);

  // =============================================================================
  // Fetch data from verified-trait-swapper GET endpoint
  // =============================================================================
  const fetchData = useCallback(async () => {
    if (!address || !tokenId) {
      setError('Wallet not connected or no token ID');
      return;
    }

    // Clear previous data IMMEDIATELY to prevent showing stale traits
    // This ensures the UI shows loading state, not old NFT data
    setCurrentTraits(null);
    setSelectedTraits(null);
    setSwapperData(null);

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Use local proxy to avoid CORS
      const response = await fetch(
        `/api/verified-trait-swapper?address=${address}&tokenId=${tokenId}`
      );
      const data: VerifiedTraitSwapperData = await response.json();

      if (!data.success) {
        setError(data.error || 'Failed to fetch NFT data');
        return;
      }

      // Store all data
      setSwapperData(data);
      setCurrentTraits(data.currentTraits);
      setSelectedTraits(data.currentTraits);
      setAvailableItems(data.availableItems);
      setInventory(data.inventory);
      setTotalInventoryItems(data.totalItems);

      if (data.ownership) {
        setOwnership(data.ownership);
      }

      // Load current NFT image
      try {
        const nftRes = await fetch(`https://api.applesnakes.com/api/nft/${tokenId}`);
        const nftInfo = await nftRes.json();
        if (nftInfo.success && nftInfo.nft?.imageCid) {
          setImageUrl(`https://ipfs.io/ipfs/${nftInfo.nft.imageCid}`);
        }
      } catch {
        // Image fetch is optional
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [address, tokenId]);

  // =============================================================================
  // Handle trait selection
  // =============================================================================
  const selectTrait = useCallback((trait: string, value: string) => {
    setSelectedTraits(prev => {
      if (!prev) return prev;
      return { ...prev, [trait]: value };
    });
    setResult(null);
  }, []);

  // =============================================================================
  // Check if there are changes
  // =============================================================================
  const hasChanges = useCallback(() => {
    if (!currentTraits || !selectedTraits) return false;
    return Object.keys(selectedTraits).some(
      trait => selectedTraits[trait] !== currentTraits[trait]
    );
  }, [currentTraits, selectedTraits]);

  // =============================================================================
  // Get changed traits only
  // =============================================================================
  const getChangedTraits = useCallback((): Record<string, string> => {
    if (!currentTraits || !selectedTraits) return {};
    const changes: Record<string, string> = {};
    for (const [trait, value] of Object.entries(selectedTraits)) {
      if (value !== currentTraits[trait]) {
        changes[trait] = value;
      }
    }
    return changes;
  }, [currentTraits, selectedTraits]);

  // =============================================================================
  // Check for hat/hair clash
  // =============================================================================
  const hasHatHairClash = useCallback(() => {
    if (!selectedTraits) return false;
    return (
      selectedTraits.Accessory4 &&
      selectedTraits.Accessory4 !== 'None' &&
      selectedTraits.Hair &&
      selectedTraits.Hair !== 'None'
    );
  }, [selectedTraits]);

  // =============================================================================
  // Submit changes with X402 payment
  // =============================================================================
  const submitChanges = useCallback(async (nftType: 'apple' | 'snake' = 'apple'): Promise<SwapResult> => {
    if (!address || !hasChanges()) {
      return { success: false, error: 'No changes to submit' };
    }

    if (!currentTraits || !selectedTraits) {
      return { success: false, error: 'Trait data not loaded' };
    }

    // Check ownership
    if (ownership && !ownership.isOwner) {
      return {
        success: false,
        error: `You do not own this NFT. Owner: ${ownership.actualOwner}`,
      };
    }

    setError(null);
    setResult(null);

    try {
      const changedTraits = getChangedTraits();

      // Validate we have at least one trait change (per trait-swap.md)
      // The EC2 backend returns "New traits are required" if no changes detected
      if (Object.keys(changedTraits).length === 0) {
        setError('No trait changes detected');
        return { success: false, error: 'No trait changes detected. Please select different values.' };
      }

      setStatusMessage('Submitting trait changes...');

      // Send both full traits and changed traits - the proxy/fallback will use what it needs
      // EC2 verified-trait-swapper expects full "newTraits"
      // Fallback customize endpoint expects partial "traits"
      const response = await x402Fetch<SwapResult>('/api/verified-trait-swapper', {
        method: 'POST',
        body: {
          address,
          tokenId,
          newTraits: selectedTraits,     // Full traits for verified-trait-swapper
          traits: changedTraits,         // Partial traits for customize fallback
          type: nftType,
        },
        useLocalProxy: true,
      });

      if (response.success && response.data) {
        const swapResult = response.data;
        setResult(swapResult);

        if (swapResult.success && swapResult.newTraits) {
          // Update local state with new traits
          setCurrentTraits(swapResult.newTraits);
          setSelectedTraits(swapResult.newTraits);

          // Update image if returned
          if (swapResult.image?.url) {
            setImageUrl(swapResult.image.url);
          }

          // Update inventory if returned
          if (swapResult.inventory) {
            setInventory(swapResult.inventory.balances);
            setTotalInventoryItems(swapResult.inventory.totalItems);
          }
        }

        return swapResult;
      } else {
        const errorMsg = response.error || 'Swap failed';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to submit changes';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }, [address, tokenId, currentTraits, selectedTraits, ownership, hasChanges, getChangedTraits, x402Fetch, setStatusMessage]);

  // =============================================================================
  // Reset to current traits
  // =============================================================================
  const resetChanges = useCallback(() => {
    setSelectedTraits(currentTraits);
    setResult(null);
    setError(null);
  }, [currentTraits]);

  return {
    // Data from API
    swapperData,
    currentTraits,
    selectedTraits,
    availableItems,
    inventory,
    totalInventoryItems,
    imageUrl,
    ownership,

    // For backwards compatibility with old component
    nftData: swapperData ? {
      success: swapperData.success,
      tokenId: swapperData.tokenId,
      type: 'apple',
      isHuman: tokenId >= 1 && tokenId <= 2697,
      currentTraits: swapperData.currentTraits,
      availableOptions: Object.fromEntries(
        Object.entries(swapperData.availableItems).map(([trait, options]) => [
          trait,
          { current: swapperData.currentTraits[trait] || 'None', options }
        ])
      ),
    } : null,

    // State
    result,
    loading: loading || isX402Loading,
    error,
    statusMessage,

    // Actions
    fetchData,
    selectTrait,
    submitChanges,
    resetChanges,

    // Helpers
    hasChanges: hasChanges(),
    hasHatHairClash: hasHatHairClash(),
    getChangedTraits,
  };
}

export default useTraitSwapper;
