'use client';

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import {
  ITEM_TOKEN_MAPPING,
  EQUIPPABLE_TRAITS,
  getTokenIdFromTrait,
  getAvailableItemsForTrait,
  TRAIT_DISPLAY_NAMES
} from '@/lib/itemTokenMapping';

interface TraitEditorInventory {
  address: string;
  inventory: Record<number, number>;
  totalItems: number;
  availableItems: Record<string, string[]>;
  cooldowns: {
    fulfil: { canFulfil: boolean; remainingSeconds: number };
    withdraw: { canWithdraw: boolean; remainingSeconds: number };
  };
}

interface TraitChangeResult {
  success: boolean;
  error?: string;
  equipped?: { trait: string; value: string; tokenId: number }[];
  returned?: { trait: string; value: string; tokenId: number }[];
  newBalance?: Record<number, number>;
}

/**
 * Hook for managing trait editing on NFTs
 * Handles inventory, trait selection, and applying changes
 */
export function useTraitEditor(nftTokenId: number) {
  const { address } = useAccount();
  const [inventory, setInventory] = useState<TraitEditorInventory | null>(null);
  const [currentTraits, setCurrentTraits] = useState<Record<string, string>>({});
  const [pendingTraits, setPendingTraits] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch user's available items for trait editing
   */
  const fetchInventory = useCallback(async () => {
    if (!address) return;

    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/trait-editor?address=${address}`);
      const data = await response.json();

      if (data.success) {
        // Build available items per trait from inventory
        const availableItems: Record<string, string[]> = {};
        for (const trait of EQUIPPABLE_TRAITS) {
          availableItems[trait] = getAvailableItemsForTrait(trait, data.inventory || {});
        }

        const inventoryData = (data.inventory || {}) as Record<number, number>;
        const totalItems = data.totalItems ||
          (Object.values(inventoryData) as number[]).reduce((a, b) => a + b, 0);

        setInventory({
          address: data.address || address,
          inventory: inventoryData,
          totalItems,
          availableItems,
          cooldowns: data.cooldowns || {
            fulfil: { canFulfil: true, remainingSeconds: 0 },
            withdraw: { canWithdraw: true, remainingSeconds: 0 },
          },
        });
      } else {
        setError(data.error || 'Failed to fetch inventory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inventory');
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  /**
   * Set a trait change (doesn't apply yet, just stages it)
   */
  const setTrait = useCallback((trait: string, value: string) => {
    // If same as current, remove from pending
    if (currentTraits[trait] === value) {
      setPendingTraits(prev => {
        const { [trait]: _, ...rest } = prev;
        return rest;
      });
    } else {
      setPendingTraits(prev => ({ ...prev, [trait]: value }));
    }
  }, [currentTraits]);

  /**
   * Get the final traits (current + pending changes)
   */
  const getFinalTraits = useCallback((): Record<string, string> => {
    return { ...currentTraits, ...pendingTraits };
  }, [currentTraits, pendingTraits]);

  /**
   * Check if a specific item is available in inventory
   */
  const hasItem = useCallback((trait: string, value: string): boolean => {
    if (value === 'None') return true;

    const tokenId = getTokenIdFromTrait(trait, value);
    if (tokenId === null || tokenId === 0) return false;

    return (inventory?.inventory[tokenId] || 0) > 0;
  }, [inventory]);

  /**
   * Get available options for a trait (items user has + "None" + currently equipped)
   */
  const getAvailableOptions = useCallback((trait: string): string[] => {
    // Always have "None" as an option
    const options: string[] = ['None'];

    // Add items from inventory
    if (inventory?.availableItems[trait]) {
      for (const item of inventory.availableItems[trait]) {
        if (item !== 'None' && !options.includes(item)) {
          options.push(item);
        }
      }
    }

    // Add currently equipped item (even if not in inventory - it's equipped on NFT)
    const currentValue = currentTraits[trait];
    if (currentValue && currentValue !== 'None' && !options.includes(currentValue)) {
      options.push(currentValue);
    }

    return options;
  }, [inventory, currentTraits]);

  /**
   * Apply pending trait changes (updates inventory via API)
   */
  const applyTraitChanges = useCallback(async (): Promise<TraitChangeResult> => {
    if (!address) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (Object.keys(pendingTraits).length === 0) {
      return { success: false, error: 'No changes to apply' };
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/trait-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          tokenId: nftTokenId,
          currentTraits,
          newTraits: getFinalTraits(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Update local state with new traits
        setCurrentTraits(getFinalTraits());
        setPendingTraits({});

        // Refresh inventory to get updated balances
        await fetchInventory();
      } else {
        setError(result.error || 'Failed to apply changes');
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to apply changes';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [address, nftTokenId, currentTraits, pendingTraits, getFinalTraits, fetchInventory]);

  /**
   * Calculate what items will be equipped/unequipped
   */
  const calculateChanges = useCallback((): {
    toEquip: { trait: string; value: string; tokenId: number }[];
    toReturn: { trait: string; value: string; tokenId: number }[];
  } => {
    const toEquip: { trait: string; value: string; tokenId: number }[] = [];
    const toReturn: { trait: string; value: string; tokenId: number }[] = [];

    for (const [trait, newValue] of Object.entries(pendingTraits)) {
      const oldValue = currentTraits[trait] || 'None';

      // Item being returned (old equipped)
      if (oldValue !== 'None') {
        const tokenId = getTokenIdFromTrait(trait, oldValue);
        if (tokenId && tokenId > 0) {
          toReturn.push({ trait, value: oldValue, tokenId });
        }
      }

      // Item being equipped (new)
      if (newValue !== 'None') {
        const tokenId = getTokenIdFromTrait(trait, newValue);
        if (tokenId && tokenId > 0) {
          toEquip.push({ trait, value: newValue, tokenId });
        }
      }
    }

    return { toEquip, toReturn };
  }, [currentTraits, pendingTraits]);

  /**
   * Reset pending changes
   */
  const resetChanges = useCallback(() => {
    setPendingTraits({});
    setError(null);
  }, []);

  /**
   * Initialize traits from NFT metadata
   */
  const initializeFromMetadata = useCallback((metadata: { attributes?: Array<{ trait_type: string; value: string }> }) => {
    if (!metadata?.attributes) return;

    const traits: Record<string, string> = {};
    for (const attr of metadata.attributes) {
      if (EQUIPPABLE_TRAITS.includes(attr.trait_type as typeof EQUIPPABLE_TRAITS[number])) {
        traits[attr.trait_type] = attr.value || 'None';
      }
    }
    setCurrentTraits(traits);
  }, []);

  /**
   * Get display name for a trait category
   */
  const getTraitDisplayName = useCallback((trait: string): string => {
    return TRAIT_DISPLAY_NAMES[trait] || trait;
  }, []);

  return {
    // State
    inventory,
    currentTraits,
    pendingTraits,
    isLoading,
    error,
    hasChanges: Object.keys(pendingTraits).length > 0,

    // Trait categories
    equippableTraits: EQUIPPABLE_TRAITS,

    // Helpers
    hasItem,
    getAvailableOptions,
    getFinalTraits,
    calculateChanges,
    getTraitDisplayName,

    // Actions
    setTrait,
    setCurrentTraits,
    applyTraitChanges,
    resetChanges,
    fetchInventory,
    initializeFromMetadata,
  };
}

export type { TraitEditorInventory, TraitChangeResult };
