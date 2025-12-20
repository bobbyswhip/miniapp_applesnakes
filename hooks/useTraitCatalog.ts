// hooks/useTraitCatalog.ts
// Hook for loading the full trait catalog from /api/trait-editor/traits
'use client';

import { useState, useEffect, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface CategoryMetadata {
  id: string;
  name: string;
  slot: string;
  layer: string;
  description: string;
}

export interface ItemData {
  id: number;
  name: string;
  category: string;
  slot: string;
  traitCategory: string;
  file: string;
  imageUrl: string;
  metadataUrl: string;
  traitLayerUrl: string;
  rarity: string | null;
  weight?: number;
}

export interface ItemOption {
  value: string;
  tokenId: number;
  imageUrl: string;
  rarity: string | null;
}

export interface TraitData {
  category: CategoryMetadata;
  items: ItemData[];
  options: ItemOption[];
}

export interface IPNSConfig {
  items: {
    gateway: string;
    networkKey: string;
  };
  traits: {
    gateway: string;
    networkKey: string;
  };
  contract: string;
}

export interface TraitCatalog {
  success: boolean;
  ipns: IPNSConfig;
  categories: CategoryMetadata[];
  traits: Record<string, TraitData>;
  allItems: ItemData[];
  itemsBySlot: Record<string, ItemData[]>;
  lookups: {
    tokenIdToTrait: Record<number, { category: string; name: string; slot: string }>;
    nameToTokenId: Record<string, Record<string, number>>;
  };
  stats: {
    totalItems: number;
    totalCategories: number;
    itemsByCategory: Record<string, number>;
  };
}

// =============================================================================
// Hook
// =============================================================================

export function useTraitCatalog() {
  const [catalog, setCatalog] = useState<TraitCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/trait-editor/traits');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load trait catalog');
      }

      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Get item image URL by token ID
   */
  const getItemImage = useCallback((tokenId: number): string => {
    if (!catalog || tokenId === 0) return '';
    return `${catalog.ipns.items.gateway}/images/${tokenId}.png`;
  }, [catalog]);

  /**
   * Get item by token ID
   */
  const getItemByTokenId = useCallback((tokenId: number): ItemData | null => {
    if (!catalog) return null;
    return catalog.allItems.find(i => i.id === tokenId) || null;
  }, [catalog]);

  /**
   * Get token ID by category and item name
   */
  const getTokenIdByName = useCallback((category: string, name: string): number => {
    if (!catalog) return 0;
    return catalog.lookups.nameToTokenId[category]?.[name] || 0;
  }, [catalog]);

  /**
   * Get all items for a category
   */
  const getItemsForCategory = useCallback((category: string): ItemData[] => {
    if (!catalog) return [];
    return catalog.traits[category]?.items || [];
  }, [catalog]);

  /**
   * Get options for a category (includes None option)
   */
  const getOptionsForCategory = useCallback((category: string): ItemOption[] => {
    if (!catalog) return [{ value: 'None', tokenId: 0, imageUrl: '', rarity: null }];
    return catalog.traits[category]?.options || [{ value: 'None', tokenId: 0, imageUrl: '', rarity: null }];
  }, [catalog]);

  /**
   * Get category metadata by ID
   */
  const getCategoryById = useCallback((categoryId: string): CategoryMetadata | null => {
    if (!catalog) return null;
    return catalog.categories.find(c => c.id === categoryId) || null;
  }, [catalog]);

  /**
   * Get items by slot
   */
  const getItemsBySlot = useCallback((slot: string): ItemData[] => {
    if (!catalog) return [];
    return catalog.itemsBySlot[slot] || [];
  }, [catalog]);

  /**
   * Get trait layer URL from IPNS
   */
  const getTraitLayerUrl = useCallback((category: string, filename: string): string => {
    if (!catalog) return '';
    return `${catalog.ipns.traits.gateway}/${category}/${filename}`;
  }, [catalog]);

  /**
   * Get available options based on inventory
   * Filters items to only include ones the user owns + currently equipped
   */
  const getAvailableOptions = useCallback((
    category: string,
    inventory: Record<number, number>,
    currentEquipped?: string
  ): ItemOption[] => {
    if (!catalog) return [{ value: 'None', tokenId: 0, imageUrl: '', rarity: null }];

    const allOptions = catalog.traits[category]?.options || [];
    const available: ItemOption[] = [{ value: 'None', tokenId: 0, imageUrl: '', rarity: null }];

    for (const option of allOptions) {
      if (option.tokenId === 0) continue; // Skip None, already added

      // Include if in inventory
      if ((inventory[option.tokenId] || 0) > 0) {
        available.push(option);
        continue;
      }

      // Include if currently equipped
      if (option.value === currentEquipped) {
        available.push(option);
      }
    }

    return available;
  }, [catalog]);

  /**
   * Check if an item is owned
   */
  const isItemOwned = useCallback((tokenId: number, inventory: Record<number, number>): boolean => {
    return (inventory[tokenId] || 0) > 0;
  }, []);

  /**
   * Get item count from inventory
   */
  const getItemCount = useCallback((tokenId: number, inventory: Record<number, number>): number => {
    return inventory[tokenId] || 0;
  }, []);

  return {
    // State
    catalog,
    loading,
    error,

    // Actions
    refresh: fetchCatalog,

    // Item Helpers
    getItemImage,
    getItemByTokenId,
    getTokenIdByName,
    getItemsForCategory,
    getOptionsForCategory,
    getAvailableOptions,
    isItemOwned,
    getItemCount,

    // Category Helpers
    getCategoryById,
    getItemsBySlot,
    getTraitLayerUrl,

    // Convenience accessors
    categories: catalog?.categories || [],
    allItems: catalog?.allItems || [],
    stats: catalog?.stats || null,
    ipns: catalog?.ipns || null,
  };
}

export default useTraitCatalog;
