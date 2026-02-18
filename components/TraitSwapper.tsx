// components/TraitSwapper.tsx
// Game-Style Trait Editor with Visual Inventory
// Allows users to change NFT appearance by clicking items in inventory grid
'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { UserNFT } from '@/hooks/useUserNFTs';
import { useTraitSwapper } from '@/hooks/useTraitSwapper';
import { useTraitCatalog } from '@/hooks/useTraitCatalog';
import { TOKEN_ID_TO_ITEM, ITEM_TOKEN_MAPPING } from '@/lib/itemTokenMapping';

// EC2 API endpoint for preview generation
const NFT_GENERATOR_URL = 'https://api.applesnakes.com';

// Bonded Items metadata base for item images
const ITEMS_IMAGE_BASE = 'https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i/images';

// Reverse: EC2 OLD names → Frontend NEW names for display
const OLD_TO_NEW_TRAIT_NAMES: Record<string, string> = {
  'Accessory4': 'Hat',
  'Accessory1': 'Weapons',
  'Accessory2': 'Hip',
  'Accessory3': 'Neck',
  'Accessory5': 'Face',
  'Clothes': 'Shirt',
};

// Category icons for the inventory tabs
const CATEGORY_ICONS: Record<string, string> = {
  'All': '🎒',
  'Clothes': '👕',
  'Shirt': '👕',
  'Pants': '👖',
  'Hands': '🧤',
  'Weapons': '⚔️',
  'Accessory1': '⚔️',
  'Hip': '👛',
  'Accessory2': '👛',
  'Neck': '📿',
  'Accessory3': '📿',
  'Hat': '🎩',
  'Accessory4': '🎩',
  'Face': '🧔',
  'Accessory5': '🧔',
  'Hair': '💇',
  'Background': '🌄',
};

// Display names for categories
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  'Clothes': 'Shirts',
  'Shirt': 'Shirts',
  'Pants': 'Pants',
  'Hands': 'Gloves',
  'Weapons': 'Weapons',
  'Accessory1': 'Weapons',
  'Hip': 'Hip',
  'Accessory2': 'Hip',
  'Neck': 'Neck',
  'Accessory3': 'Neck',
  'Hat': 'Hats',
  'Accessory4': 'Hats',
  'Face': 'Face',
  'Accessory5': 'Face',
  'Hair': 'Hair',
  'Background': 'Backgrounds',
};

// Inventory category order
const INVENTORY_CATEGORIES = [
  'All',
  'Clothes',
  'Pants',
  'Hands',
  'Accessory1', // Weapons
  'Accessory2', // Hip
  'Accessory3', // Neck
  'Accessory4', // Hat
  'Accessory5', // Face
  'Hair',
  'Background',
];

interface TraitSwapperProps {
  nft: UserNFT;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface InventoryItem {
  tokenId: number;
  name: string;
  trait: string;
  count: number;
  imageUrl: string;
  isEquipped: boolean;
}

export function TraitSwapper({ nft, isOpen, onClose, onSuccess }: TraitSwapperProps) {
  const {
    currentTraits,
    selectedTraits,
    imageUrl,
    inventory,
    totalInventoryItems,
    result,
    loading,
    error,
    statusMessage,
    fetchData,
    selectTrait,
    submitChanges,
    resetChanges,
    hasChanges,
    hasHatHairClash,
  } = useTraitSwapper(nft.tokenId);

  // Load trait catalog for item images and metadata
  const { loading: catalogLoading } = useTraitCatalog();

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [refreshedPreview, setRefreshedPreview] = useState<string | null>(null);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Determine NFT type (humans are tokens 1-2697, snakes are 2698+)
  const nftType: 'human' | 'snake' = nft.tokenId <= 2697 ? 'human' : 'snake';

  // Build inventory items from the inventory object
  const inventoryItems: InventoryItem[] = useMemo(() => {
    if (!inventory || !selectedTraits) return [];

    console.log('[TraitSwapper] Building inventory items, selectedTraits:', selectedTraits);

    const items: InventoryItem[] = [];

    for (const [tokenIdStr, count] of Object.entries(inventory)) {
      const tokenId = Number(tokenIdStr);
      if (tokenId === 0 || count <= 0) continue;

      const itemInfo = TOKEN_ID_TO_ITEM[tokenId];
      if (!itemInfo) continue;

      // Check if this item is currently equipped
      const traitValue = selectedTraits[itemInfo.trait];
      const isEquipped = traitValue === itemInfo.name;

      items.push({
        tokenId,
        name: itemInfo.name,
        trait: itemInfo.trait,
        count: Number(count),
        imageUrl: `${ITEMS_IMAGE_BASE}/${tokenId}.png`,
        isEquipped,
      });
    }

    // Also add currently equipped items that might not be in inventory (on NFT)
    // Use selectedTraits as source of truth for what's equipped (not currentTraits)
    if (selectedTraits) {
      for (const [trait, value] of Object.entries(selectedTraits)) {
        if (!value || value === 'None') continue;

        // Find the token ID for this equipped item
        const traitMapping = ITEM_TOKEN_MAPPING[trait];
        if (!traitMapping) continue;

        const tokenId = traitMapping[value];
        if (!tokenId || tokenId === 0) continue;

        // Check if already in inventory
        const existingItem = items.find(i => i.tokenId === tokenId);
        if (existingItem) {
          // Already in inventory, isEquipped already set correctly by first loop
          // Don't overwrite - first loop already checked selectedTraits
        } else {
          // Add as equipped item (not in inventory, currently on NFT)
          items.push({
            tokenId,
            name: value,
            trait,
            count: 0, // Not in inventory
            imageUrl: `${ITEMS_IMAGE_BASE}/${tokenId}.png`,
            isEquipped: true, // It's equipped because selectedTraits says so
          });
        }
      }
    }

    return items;
  }, [inventory, selectedTraits]);

  // Filter items by selected category
  const filteredItems = useMemo(() => {
    if (selectedCategory === 'All') return inventoryItems;
    return inventoryItems.filter(item => item.trait === selectedCategory);
  }, [inventoryItems, selectedCategory]);

  // Get categories that have items
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    categories.add('All');
    for (const item of inventoryItems) {
      categories.add(item.trait);
    }
    return INVENTORY_CATEGORIES.filter(cat => categories.has(cat));
  }, [inventoryItems]);

  // Handle clicking an inventory item to equip/unequip
  const handleItemClick = useCallback((item: InventoryItem) => {
    console.log('[TraitSwapper] Item clicked:', item.name, 'isEquipped:', item.isEquipped, 'trait:', item.trait);
    if (item.isEquipped) {
      // Unequip - set to None
      console.log('[TraitSwapper] Unequipping:', item.trait, '-> None');
      selectTrait(item.trait, 'None');
    } else {
      // Equip the item
      console.log('[TraitSwapper] Equipping:', item.trait, '->', item.name);
      selectTrait(item.trait, item.name);
    }
  }, [selectTrait]);

  // Refresh preview from EC2 after successful update
  const refreshPreviewFromEC2 = useCallback(async () => {
    if (!nft.tokenId) return;

    try {
      console.log('[TraitSwapper] Fetching fresh preview from EC2...');

      const availableRes = await fetch(
        `${NFT_GENERATOR_URL}/api/customize/${nft.tokenId}/available`
      );
      const availableData = await availableRes.json();

      if (!availableData.success) {
        console.error('[TraitSwapper] Failed to fetch current traits from EC2');
        return;
      }

      const NEW_TRAIT_NAMES = ['Hat', 'Weapons', 'Hip', 'Neck', 'Face', 'Shirt'];
      const cleanTraits: Record<string, string> = {};

      for (const [key, value] of Object.entries(availableData.currentTraits || {})) {
        if (!NEW_TRAIT_NAMES.includes(key)) {
          cleanTraits[key] = value as string;
        }
      }

      const previewRes = await fetch(
        `${NFT_GENERATOR_URL}/api/customize/${nft.tokenId}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ traits: cleanTraits }),
        }
      );

      const previewData = await previewRes.json();

      if (previewData.success && previewData.preview) {
        setRefreshedPreview(previewData.preview);
        console.log('[TraitSwapper] Preview refreshed successfully from EC2!');
      }
    } catch (error) {
      console.error('[TraitSwapper] Failed to refresh preview from EC2:', error);
    }
  }, [nft.tokenId]);

  // Fetch data when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchData();
      setUpdateSuccess(false);
      setRefreshedPreview(null);
      setLivePreviewUrl(null);
      setIsUpdating(false);
      setSelectedCategory('All');
    }
  }, [isOpen, fetchData]);

  // Fetch live preview from EC2 when traits change (debounced)
  useEffect(() => {
    if (!isOpen || !selectedTraits || !hasChanges) return;

    const timeoutId = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        // Build traits object for preview
        const traitsForPreview: Record<string, string> = {};
        for (const [key, value] of Object.entries(selectedTraits)) {
          // Skip "None" values for preview
          if (value && value !== 'None') {
            traitsForPreview[key] = value;
          }
        }

        console.log('[TraitSwapper] Fetching live preview from EC2...', traitsForPreview);

        const previewRes = await fetch(
          `${NFT_GENERATOR_URL}/api/customize/${nft.tokenId}/preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              traits: traitsForPreview,
              type: nftType === 'snake' ? 'snake' : 'human'
            }),
          }
        );

        const previewData = await previewRes.json();

        if (previewData.success && previewData.preview) {
          setLivePreviewUrl(previewData.preview);
          console.log('[TraitSwapper] Live preview loaded from EC2');
        }
      } catch (error) {
        console.error('[TraitSwapper] Failed to fetch live preview:', error);
      } finally {
        setPreviewLoading(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [isOpen, selectedTraits, hasChanges, nft.tokenId, nftType]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle trait swap submission
  const handleSubmit = async () => {
    const type = nft.isSnake ? 'snake' : 'apple';

    setIsUpdating(true);
    setUpdateSuccess(false);

    try {
      console.log('[TraitSwapper] Submitting trait changes with x402 payment...');
      const swapResult = await submitChanges(type);

      if (swapResult.success) {
        console.log('[TraitSwapper] x402 payment successful, refreshing preview from EC2...');
        await refreshPreviewFromEC2();
        setUpdateSuccess(true);
        onSuccess?.();
      } else {
        console.error('[TraitSwapper] Swap failed:', swapResult.error);
      }
    } catch (error) {
      console.error('[TraitSwapper] Error during swap:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const displayImageUrl = imageUrl || nft.imageUrl;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full relative flex flex-col"
        style={{
          maxWidth: 'min(95vw, 900px)',
          maxHeight: '95vh',
          background: 'linear-gradient(135deg, rgba(23, 30, 29, 0.98), rgba(26, 34, 33, 0.98))',
          border: '2px solid rgba(255, 208, 117, 0.2)',
          boxShadow: '0 0 50px rgba(255, 208, 117, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="rounded-t-2xl flex-shrink-0 px-4 py-3"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.15), rgba(197, 169, 123, 0.1))',
            borderBottom: '1px solid rgba(255, 208, 117, 0.15)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={refreshedPreview || displayImageUrl}
                alt={nft.name}
                className="w-10 h-10 rounded-lg object-cover"
              />
              <div>
                <h2 className="font-bold text-lg text-white">
                  ✨ Trait Editor
                </h2>
                <p className="text-sm text-[#8a9090]">
                  {nft.name} • Click items to equip
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#8a9090] hover:text-white transition-colors text-xl p-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Main Content - Split Layout */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Left: Preview Panel */}
          <div className="lg:w-1/2 p-4 flex flex-col border-b lg:border-b-0 lg:border-r border-[rgba(255,255,255,0.08)]">
            {/* Live Preview */}
            <div className="flex-1 flex flex-col items-center justify-center">
              <h3 className="text-sm font-medium text-[#8a9090] mb-2 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${hasChanges ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
                Live Preview
                {hasChanges && <span className="text-yellow-400 text-xs">(unsaved)</span>}
              </h3>

              <div className="w-full max-w-[280px] aspect-square relative">
                {/* Show EC2 preview when traits change, otherwise show IPNS image */}
                {refreshedPreview ? (
                  // After successful update - show refreshed preview
                  <img
                    src={refreshedPreview}
                    alt="Updated NFT"
                    className="w-full h-full rounded-xl border-2 border-green-500 object-cover"
                  />
                ) : livePreviewUrl && hasChanges ? (
                  // When traits changed - show EC2 live preview
                  <img
                    src={livePreviewUrl}
                    alt="Preview with changes"
                    className="w-full h-full rounded-xl border-2 border-yellow-500 object-cover"
                  />
                ) : imageUrl ? (
                  // No changes - show current IPNS image
                  <img
                    src={imageUrl}
                    alt={nft.name}
                    className="w-full h-full rounded-xl border-2 border-[rgba(255,255,255,0.1)] object-cover"
                  />
                ) : (
                  // Loading state
                  <div className="w-full h-full rounded-xl border-2 border-[rgba(255,255,255,0.1)] bg-[#1a2221] flex items-center justify-center">
                    <div className="animate-spin w-8 h-8 border-2 border-[#ffd075] border-t-transparent rounded-full" />
                  </div>
                )}

                {/* Loading overlay when fetching preview */}
                {previewLoading && (
                  <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <div className="animate-spin w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full mx-auto mb-2" />
                      <span className="text-yellow-400 text-xs">Generating preview...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Hat/Hair Clash Warning */}
              {hasHatHairClash && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <p className="text-yellow-400 text-xs text-center">
                    ⚠️ Hair will be hidden when wearing a hat
                  </p>
                </div>
              )}

              {/* Success Message */}
              {updateSuccess && result?.success && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30">
                  <p className="text-green-400 text-sm text-center font-medium">
                    ✨ NFT Updated Successfully!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Inventory Panel */}
          <div className="lg:w-1/2 p-4 flex flex-col overflow-hidden">
            {/* Loading State */}
            {(loading || catalogLoading) && !currentTraits && (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 border-4 border-[rgba(255,208,117,0.2)] border-t-[#ffd075] rounded-full animate-spin mb-3" />
                <p className="text-[#8a9090] text-sm">Loading inventory...</p>
              </div>
            )}

            {/* Error State */}
            {error && !loading && (
              <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/30 mb-4">
                <p className="text-red-400 text-sm">{error}</p>
                <button
                  onClick={fetchData}
                  className="text-xs text-[#ffd075] hover:text-[#ffe0a0] mt-2"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Inventory Content */}
            {currentTraits && selectedTraits && (
              <>
                {/* Category Tabs */}
                <div className="flex-shrink-0 mb-3">
                  <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-thin">
                    {availableCategories.map((cat) => {
                      const displayName = cat === 'All' ? 'All' : CATEGORY_DISPLAY_NAMES[cat] || cat;
                      const icon = CATEGORY_ICONS[cat] || '📦';
                      const isActive = selectedCategory === cat;
                      const count = cat === 'All'
                        ? inventoryItems.length
                        : inventoryItems.filter(i => i.trait === cat).length;

                      return (
                        <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            isActive
                              ? 'bg-[rgba(255,208,117,0.15)] text-[#ffd075] border border-[rgba(255,208,117,0.3)]'
                              : 'bg-[#1a2221]/50 text-[#8a9090] border border-[rgba(255,255,255,0.08)] hover:bg-[#1f2827]/50'
                          }`}
                        >
                          <span className="mr-1">{icon}</span>
                          {displayName}
                          <span className="ml-1 opacity-60">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Inventory Grid */}
                <div className="flex-1 overflow-y-auto">
                  {filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#6b7575]">
                      <span className="text-4xl mb-2">📦</span>
                      <p className="text-sm">No items in this category</p>
                      <p className="text-xs mt-1">Bridge items to your inventory first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {filteredItems.map((item) => (
                        <button
                          key={`${item.tokenId}-${item.trait}`}
                          onClick={() => handleItemClick(item)}
                          className={`relative aspect-square rounded-xl overflow-hidden transition-all transform hover:scale-105 ${
                            item.isEquipped
                              ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-[#171e1d]'
                              : 'hover:ring-2 hover:ring-[rgba(255,208,117,0.4)]'
                          }`}
                          style={{
                            background: item.isEquipped
                              ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(22, 163, 74, 0.2))'
                              : 'rgba(26, 34, 33, 0.8)',
                            border: item.isEquipped
                              ? '2px solid rgba(34, 197, 94, 0.5)'
                              : '1px solid rgba(255, 255, 255, 0.08)',
                          }}
                          title={`${item.name}${item.isEquipped ? ' (Equipped)' : ''}`}
                        >
                          {/* Item Image */}
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/placeholder-item.png';
                            }}
                          />

                          {/* Equipped Badge */}
                          {item.isEquipped && (
                            <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                              <span className="text-white text-xs">✓</span>
                            </div>
                          )}

                          {/* Count Badge */}
                          {item.count > 1 && (
                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs font-bold">
                              x{item.count}
                            </div>
                          )}

                          {/* Category Icon */}
                          <div className="absolute top-1 left-1 w-5 h-5 rounded bg-black/50 flex items-center justify-center">
                            <span className="text-xs">{CATEGORY_ICONS[item.trait] || '📦'}</span>
                          </div>

                          {/* Item Name Tooltip on Hover */}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 hover:opacity-100 transition-opacity">
                            <p className="text-white text-[10px] font-medium truncate text-center">
                              {item.name}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Inventory Summary */}
                <div className="flex-shrink-0 mt-3 pt-3 border-t border-[rgba(255,255,255,0.08)]">
                  <div className="flex items-center justify-between text-xs text-[#8a9090]">
                    <span>📦 {totalInventoryItems} items in inventory</span>
                    <span>
                      {inventoryItems.filter(i => i.isEquipped).length} equipped
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className="flex-shrink-0 px-4 py-3 border-t border-[rgba(255,255,255,0.08)]"
          style={{
            background: 'rgba(23, 30, 29, 0.8)',
          }}
        >
          {/* Status Message */}
          {statusMessage && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-[rgba(255,208,117,0.08)] border border-[rgba(255,208,117,0.2)]">
              <p className="text-[#ffd075] text-xs text-center">{statusMessage}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={resetChanges}
              disabled={!hasChanges || loading || isUpdating}
              className="flex-1 py-2.5 px-4 rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'rgba(31, 40, 39, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              Reset
            </button>
            <button
              onClick={handleSubmit}
              disabled={!hasChanges || loading || isUpdating}
              className="flex-[2] py-2.5 px-4 rounded-lg text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: hasChanges && !loading && !isUpdating
                  ? 'linear-gradient(135deg, rgba(255, 208, 117, 0.6), rgba(197, 169, 123, 0.5))'
                  : 'rgba(31, 40, 39, 0.6)',
                border: hasChanges && !loading && !isUpdating
                  ? '1px solid rgba(255, 208, 117, 0.4)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: hasChanges && !loading && !isUpdating
                  ? '0 0 20px rgba(255, 208, 117, 0.2)'
                  : 'none',
              }}
            >
              {isUpdating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span>
                  Updating...
                </span>
              ) : loading ? (
                '⏳ Loading...'
              ) : (
                `✨ Apply Changes ($0.05)`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TraitSwapper;
