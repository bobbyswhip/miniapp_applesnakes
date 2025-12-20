// components/TraitSwapper.tsx
// Trait Swapper Modal - refactored to follow trait-swap.md architecture
// Allows users to change NFT appearance using inventory items with $0.05 USDC payment
// After successful x402 payment, fetches fresh base64 preview from EC2 to bypass IPFS caching
'use client';

import { useEffect, useState, useCallback } from 'react';
import { UserNFT } from '@/hooks/useUserNFTs';
import { useTraitSwapper } from '@/hooks/useTraitSwapper';
import { useTraitCatalog } from '@/hooks/useTraitCatalog';
import { TraitEditorPreview } from '@/components/LayerPreview';

// EC2 API endpoint for preview generation
const NFT_GENERATOR_URL = 'https://api.applesnakes.com';

// Trait name conversion: Frontend NEW names → EC2 OLD names
// EC2 backend uses the old Accessory naming convention
const NEW_TO_OLD_TRAIT_NAMES: Record<string, string> = {
  'Hat': 'Accessory4',
  'Weapons': 'Accessory1',
  'Hip': 'Accessory2',
  'Neck': 'Accessory3',
  'Face': 'Accessory5',
  'Shirt': 'Clothes',
};

// Reverse: EC2 OLD names → Frontend NEW names for display
const OLD_TO_NEW_TRAIT_NAMES: Record<string, string> = {
  'Accessory4': 'Hat',
  'Accessory1': 'Weapons',
  'Accessory2': 'Hip',
  'Accessory3': 'Neck',
  'Accessory5': 'Face',
  'Clothes': 'Shirt',
};

// Convert frontend traits to EC2 format
function convertToEC2Format(traits: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(traits)) {
    const ec2Key = NEW_TO_OLD_TRAIT_NAMES[key] || key;
    result[ec2Key] = value;
  }
  return result;
}

// Convert EC2 traits back to frontend display format
function normalizeTraitsForDisplay(ec2Traits: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(ec2Traits)) {
    const displayKey = OLD_TO_NEW_TRAIT_NAMES[key] || key;
    result[displayKey] = value;
  }
  return result;
}

// Per trait-swap.md lines 983-996: ALL 13 trait dropdowns for humans
// Display order matches HUMAN_LAYER_ORDER from trait-swap.md lines 44-59
const HUMAN_DISPLAY_ORDER = [
  'Background',  // 1. Scene background
  'Skin',        // 2. Body appearance
  'Pants',       // 3. Lower body clothing
  'Shirt',       // 4. Upper body clothing (maps from "Clothes")
  'Eyes',        // 5. Eye appearance
  'Mouth',       // 6. Mouth appearance
  'Hair',        // 7. Hair style
  'Hands',       // 8. Gloves
  'Neck',        // 9. Amulets, chains (Accessory3)
  'Hip',         // 10. Fanny packs (Accessory2)
  'Face',        // 11. Beards (Accessory5)
  'Hat',         // 12. Headwear (Accessory4)
  'Weapons',     // 13. Held items (Accessory1)
];

// Trait categories for organized display - ALL traits per trait-swap.md
const TRAIT_CATEGORIES = {
  'Core Appearance': ['Background', 'Skin', 'Eyes', 'Mouth'],
  'Clothing': ['Pants', 'Shirt', 'Hair'],
  'Accessories': ['Hands', 'Neck', 'Hip', 'Face', 'Hat', 'Weapons'],
};

// Required traits that cannot be "None" (per trait-swap.md line 146)
const REQUIRED_TRAITS = ['Background', 'Skin', 'Eyes', 'Mouth'];

// Equippable traits that use inventory items
const EQUIPPABLE_TRAITS = [
  'Shirt', 'Pants', 'Hands', 'Weapons',
  'Hip', 'Neck', 'Face', 'Hat',
  'Hair', 'Background'
];

// Map frontend display names to API names (for traits that differ)
const DISPLAY_TO_API_MAP: Record<string, string> = {
  'Shirt': 'Clothes',      // API uses "Clothes", display uses "Shirt"
  'Weapons': 'Accessory1',
  'Hip': 'Accessory2',
  'Neck': 'Accessory3',
  'Hat': 'Accessory4',
  'Face': 'Accessory5',
};

// Reverse map for API to display names
const API_TO_DISPLAY_MAP: Record<string, string> = {
  'Clothes': 'Shirt',
  'Accessory1': 'Weapons',
  'Accessory2': 'Hip',
  'Accessory3': 'Neck',
  'Accessory4': 'Hat',
  'Accessory5': 'Face',
};

interface TraitSwapperProps {
  nft: UserNFT;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function TraitSwapper({ nft, isOpen, onClose, onSuccess }: TraitSwapperProps) {
  const {
    nftData,
    currentTraits,
    selectedTraits,
    imageUrl,
    availableItems,
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

  // Load trait catalog for item images and metadata enhancement
  const {
    catalog,
    loading: catalogLoading,
    getCategoryById,
    isItemOwned,
    getItemCount,
  } = useTraitCatalog();

  const [showSuccess, setShowSuccess] = useState(false);
  const [showLayerPreview, setShowLayerPreview] = useState(true);

  // State for x402 update flow and EC2 preview refresh
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [refreshedPreview, setRefreshedPreview] = useState<string | null>(null);

  // Determine NFT type (humans are tokens 1-2697, snakes are 2698+)
  const nftType: 'human' | 'snake' = nft.tokenId <= 2697 ? 'human' : 'snake';

  // ═══════════════════════════════════════════════════════════════════════════
  // Refresh preview from EC2 after successful x402 payment
  // This bypasses IPFS caching by generating fresh base64 image from current DB state
  // ═══════════════════════════════════════════════════════════════════════════
  const refreshPreviewFromEC2 = useCallback(async () => {
    if (!nft.tokenId) return;

    try {
      console.log('[TraitSwapper] Fetching fresh preview from EC2...');

      // Step 1: Get CURRENT traits from EC2 database
      const availableRes = await fetch(
        `${NFT_GENERATOR_URL}/api/customize/${nft.tokenId}/available`
      );
      const availableData = await availableRes.json();

      if (!availableData.success) {
        console.error('[TraitSwapper] Failed to fetch current traits from EC2');
        return;
      }

      // Step 2: Filter to only OLD trait names (remove duplicate NEW names from response)
      // The API returns BOTH old and new names, we need only the OLD names for EC2
      const NEW_TRAIT_NAMES = ['Hat', 'Weapons', 'Hip', 'Neck', 'Face', 'Shirt'];
      const cleanTraits: Record<string, string> = {};

      for (const [key, value] of Object.entries(availableData.currentTraits || {})) {
        if (!NEW_TRAIT_NAMES.includes(key)) {
          cleanTraits[key] = value as string;
        }
      }

      console.log('[TraitSwapper] Clean traits for preview:', cleanTraits);

      // Step 3: Fetch fresh base64 preview from EC2
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
        // Update the refreshed preview state with fresh base64 data
        setRefreshedPreview(previewData.preview);
        console.log('[TraitSwapper] Preview refreshed successfully from EC2!');
      } else {
        console.error('[TraitSwapper] EC2 preview failed:', previewData);
      }
    } catch (error) {
      console.error('[TraitSwapper] Failed to refresh preview from EC2:', error);
    }
  }, [nft.tokenId]);

  // Fetch data when modal opens and reset states
  useEffect(() => {
    if (isOpen) {
      fetchData();
      setShowSuccess(false);
      setUpdateSuccess(false);
      setRefreshedPreview(null);
      setIsUpdating(false);
    }
  }, [isOpen, fetchData]);

  // Handle successful swap
  useEffect(() => {
    if (result?.success) {
      setShowSuccess(true);
    }
  }, [result]);

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

  // ═══════════════════════════════════════════════════════════════════════════
  // Handle trait swap submission with x402 payment
  // After success, immediately fetch fresh preview from EC2 to bypass IPFS caching
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSubmit = async () => {
    const type = nft.isSnake ? 'snake' : 'apple';

    setIsUpdating(true);
    setUpdateSuccess(false);

    try {
      console.log('[TraitSwapper] Submitting trait changes with x402 payment...');
      const swapResult = await submitChanges(type);

      if (swapResult.success) {
        console.log('[TraitSwapper] x402 payment successful, refreshing preview from EC2...');

        // CRITICAL: Immediately fetch fresh preview from EC2 to bypass IPFS cache
        // This ensures the user sees the updated NFT instantly
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

  // Convert display trait name to API trait name
  const toApiName = (displayName: string): string => {
    return DISPLAY_TO_API_MAP[displayName] || displayName;
  };

  // Convert API trait name to display trait name
  const toDisplayName = (apiName: string): string => {
    return API_TO_DISPLAY_MAP[apiName] || apiName;
  };

  const getTraitDisplayName = (displayTrait: string): string => {
    // Use the display name directly (already human-readable)
    return displayTrait;
  };

  // Build options for a trait using availableItems from the verified-trait-swapper API
  // The API returns only items the user owns + currently equipped items
  const getOptionsForTrait = (displayTrait: string): Array<{ value: string; tokenId: number; imageUrl: string; rarity: string | null }> => {
    // Convert display name to API name for lookup
    const apiTrait = toApiName(displayTrait);

    // Get options from the API (already filtered to owned items)
    const apiOptions = availableItems[apiTrait] || ['None'];

    // Enhance with catalog data for images and rarity if available
    return apiOptions.map(name => {
      if (name === 'None') {
        return { value: 'None', tokenId: 0, imageUrl: '', rarity: null };
      }

      // Try to get enhanced data from catalog
      if (catalog) {
        const categoryData = catalog.traits[apiTrait];
        if (categoryData) {
          const option = categoryData.options.find(opt => opt.value === name);
          if (option) {
            return option;
          }
        }
      }

      // Fallback to basic option without enhancement
      return { value: name, tokenId: 0, imageUrl: '', rarity: null };
    });
  };

  const renderTraitSelector = (displayTrait: string) => {
    // Convert display name to API name for data lookup
    const apiTrait = toApiName(displayTrait);

    const options = getOptionsForTrait(displayTrait);
    const currentValue = selectedTraits?.[apiTrait] || 'None';
    const originalValue = currentTraits?.[apiTrait] || 'None';
    const isChanged = currentValue !== originalValue;
    const isEquippable = EQUIPPABLE_TRAITS.includes(displayTrait);
    const isRequired = REQUIRED_TRAITS.includes(displayTrait);

    // Find the currently selected option for image preview
    const selectedOption = options.find(opt => opt.value === currentValue);

    return (
      <div
        key={displayTrait}
        className="flex flex-col gap-1"
        style={{
          padding: 'clamp(0.5rem, 1.5vh, 0.75rem)',
          background: isChanged
            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(147, 51, 234, 0.15))'
            : 'rgba(31, 41, 55, 0.5)',
          borderRadius: '0.5rem',
          border: isChanged
            ? '1px solid rgba(59, 130, 246, 0.5)'
            : '1px solid rgba(75, 85, 99, 0.3)',
        }}
      >
        <div className="flex items-center justify-between">
          <label
            className="font-semibold text-white flex items-center gap-1"
            style={{ fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)' }}
          >
            {/* Show item image preview if available */}
            {selectedOption?.imageUrl && (
              <img
                src={selectedOption.imageUrl}
                alt={selectedOption.value}
                className="w-5 h-5 rounded object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            {getTraitDisplayName(displayTrait)}
            {isRequired && (
              <span className="text-red-400 ml-1" title="Required trait">*</span>
            )}
            {isEquippable && (
              <span className="text-yellow-400" title="Uses inventory items">
                🎒
              </span>
            )}
          </label>
          {isChanged && (
            <span
              className="px-2 py-0.5 rounded text-blue-400 bg-blue-500/20"
              style={{ fontSize: 'clamp(0.625rem, 1.4vh, 0.75rem)' }}
            >
              Changed
            </span>
          )}
        </div>
        <select
          value={currentValue}
          onChange={(e) => {
            // Don't allow required traits to be set to "None"
            if (isRequired && e.target.value === 'None') return;
            // Use API trait name for the hook
            selectTrait(apiTrait, e.target.value);
          }}
          disabled={loading || catalogLoading}
          className="w-full rounded-lg text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
          style={{
            padding: 'clamp(0.375rem, 1.2vh, 0.5rem) clamp(0.5rem, 1.5vw, 0.75rem)',
            fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)',
            background: 'rgba(17, 24, 39, 0.8)',
            border: '1px solid rgba(75, 85, 99, 0.5)',
          }}
        >
          {options.map((option) => {
            const owned = option.tokenId > 0 ? isItemOwned(option.tokenId, inventory) : true;
            const count = option.tokenId > 0 ? getItemCount(option.tokenId, inventory) : 0;
            const isEquipped = option.value === originalValue;
            // Disable "None" option for required traits
            const isDisabledNone = isRequired && option.value === 'None';

            return (
              <option
                key={option.value}
                value={option.value}
                disabled={isDisabledNone}
              >
                {option.value}
                {option.rarity ? ` [${option.rarity}]` : ''}
                {isEquipped && option.value !== 'None' ? ' (equipped)' : ''}
                {owned && count > 0 && !isEquipped ? ` (x${count})` : ''}
              </option>
            );
          })}
        </select>
      </div>
    );
  };

  // Per trait-swap.md: Show ALL traits, don't filter
  // Previously this filtered out traits with no options - now we show all 13
  const getDisplayableTraits = (category: string[]): string[] => {
    // Return all traits in the category - don't filter
    return category;
  };

  // Use NFT's image URL or the one from hook (if updated)
  const displayImageUrl = imageUrl || nft.imageUrl;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div
        className="rounded-2xl w-full relative flex flex-col"
        style={{
          maxWidth: 'clamp(22rem, 95vw, 32rem)',
          maxHeight: 'clamp(32rem, 90vh, 48rem)',
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(147, 51, 234, 0.08), rgba(236, 72, 153, 0.05))',
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          border: '2px solid rgba(59, 130, 246, 0.3)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 50px rgba(59, 130, 246, 0.3), 0 0 100px rgba(147, 51, 234, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="rounded-t-2xl flex-shrink-0"
          style={{
            padding: 'clamp(0.75rem, 2.5vh, 1rem)',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(147, 51, 234, 0.3))',
            borderBottom: '1px solid rgba(59, 130, 246, 0.3)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Show refreshed base64 preview from EC2 when available (no IPFS cache) */}
              <div className="relative">
                <img
                  src={refreshedPreview || displayImageUrl}
                  alt={nft.name}
                  className={`rounded-lg object-cover transition-opacity ${isUpdating ? 'opacity-50' : 'opacity-100'}`}
                  style={{
                    width: 'clamp(2.5rem, 6vh, 3.5rem)',
                    height: 'clamp(2.5rem, 6vh, 3.5rem)',
                  }}
                />
                {isUpdating && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div>
                <h2
                  className="font-bold"
                  style={{
                    fontSize: 'clamp(1rem, 2.5vh, 1.25rem)',
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 1), rgba(147, 51, 234, 1))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Edit Traits
                </h2>
                <p
                  className="text-blue-200"
                  style={{ fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)' }}
                >
                  {nft.name} • $0.05 USDC per change
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-blue-300/80 hover:text-blue-200 transition-colors"
              style={{ fontSize: 'clamp(1.25rem, 3vh, 1.5rem)' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: 'clamp(0.75rem, 2vh, 1rem)' }}>
          {/* Loading State */}
          {loading && !currentTraits && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3" />
              <p className="text-gray-400 text-sm">Loading traits...</p>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div
              className="rounded-lg mb-4"
              style={{
                padding: 'clamp(0.75rem, 2vh, 1rem)',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={fetchData}
                className="text-xs text-blue-400 hover:text-blue-300 mt-2"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Success State - Shows fresh base64 preview from EC2 (no IPFS caching!) */}
          {(showSuccess || updateSuccess) && result?.success && (
            <div
              className="rounded-lg mb-4"
              style={{
                padding: 'clamp(0.75rem, 2vh, 1rem)',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}
            >
              <div className="flex items-start gap-3">
                {/* Show refreshed base64 preview from EC2 (preferred - no cache) */}
                {refreshedPreview ? (
                  <img
                    src={refreshedPreview}
                    alt="Updated NFT"
                    className="rounded-lg"
                    style={{ width: '80px', height: '80px', objectFit: 'cover' }}
                  />
                ) : result.image?.url ? (
                  <img
                    src={result.image.url}
                    alt="Updated NFT"
                    className="rounded-lg"
                    style={{ width: '80px', height: '80px', objectFit: 'cover' }}
                  />
                ) : null}
                <div>
                  <p className="text-green-400 font-semibold text-sm mb-1">
                    ✨ NFT Updated Successfully!
                  </p>
                  {refreshedPreview && (
                    <p className="text-green-300 text-xs mb-1">
                      Image refreshed instantly (no IPFS delay)
                    </p>
                  )}
                  {result.equipped && result.equipped.length > 0 && (
                    <p className="text-green-300 text-xs">
                      Equipped: {result.equipped.map(e => e.value).join(', ')}
                    </p>
                  )}
                  {result.returned && result.returned.length > 0 && (
                    <p className="text-blue-300 text-xs">
                      Returned: {result.returned.map(r => r.value).join(', ')}
                    </p>
                  )}
                  {result.hatHairClash?.applied && (
                    <p className="text-yellow-300 text-xs mt-1">
                      Note: {result.hatHairClash.reason}
                    </p>
                  )}
                  {result.image?.ipfs?.url && (
                    <a
                      href={result.image.ipfs.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
                    >
                      View on IPFS →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Hat/Hair Clash Warning */}
          {hasHatHairClash && (
            <div
              className="rounded-lg mb-4"
              style={{
                padding: 'clamp(0.5rem, 1.5vh, 0.75rem)',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              <p className="text-yellow-400 text-xs">
                <strong>Note:</strong> Hair will be hidden when wearing a hat. The hair item will be returned to your inventory.
              </p>
            </div>
          )}

          {/* Live Preview Section - Side by Side Comparison */}
          {currentTraits && selectedTraits && (
            <div className="mb-4">
              {/* Toggle Button */}
              <button
                onClick={() => setShowLayerPreview(!showLayerPreview)}
                className="w-full mb-3 flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-sm"
                style={{
                  background: showLayerPreview
                    ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2))'
                    : 'rgba(31, 41, 55, 0.5)',
                  border: showLayerPreview
                    ? '1px solid rgba(59, 130, 246, 0.4)'
                    : '1px solid rgba(75, 85, 99, 0.3)',
                }}
              >
                <span className="text-gray-300 flex items-center gap-2">
                  <span>🎨</span>
                  Live Preview
                  {hasChanges && (
                    <span className="text-yellow-400 text-xs">(changes pending)</span>
                  )}
                </span>
                <span className="text-blue-400">{showLayerPreview ? '▼' : '▶'}</span>
              </button>

              {/* Preview Content */}
              {showLayerPreview && (
                <TraitEditorPreview
                  tokenId={nft.tokenId}
                  currentTraits={currentTraits}
                  pendingTraits={selectedTraits}
                  nftType={nftType}
                  className="mb-2"
                />
              )}
            </div>
          )}

          {/* Inventory Summary */}
          {currentTraits && (
            <div
              className="rounded-lg mb-4"
              style={{
                padding: 'clamp(0.5rem, 1.5vh, 0.75rem)',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}
            >
              <p className="text-blue-300 text-xs">
                📦 Your Inventory: <span className="font-bold text-white">{totalInventoryItems}</span> items
              </p>
            </div>
          )}

          {/* Trait Selectors */}
          {currentTraits && selectedTraits && (
            <div className="space-y-4">
              {Object.entries(TRAIT_CATEGORIES).map(([category, traits]) => {
                const displayableTraits = getDisplayableTraits(traits);
                if (displayableTraits.length === 0) return null;

                return (
                  <div key={category}>
                    <h3
                      className="text-gray-400 font-semibold mb-2"
                      style={{ fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)' }}
                    >
                      {category}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {displayableTraits.map(trait => renderTraitSelector(trait))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Status Message */}
          {statusMessage && (
            <div
              className="rounded-lg mt-4"
              style={{
                padding: 'clamp(0.5rem, 1.5vh, 0.75rem)',
                background: 'rgba(147, 51, 234, 0.1)',
                border: '1px solid rgba(147, 51, 234, 0.3)',
              }}
            >
              <p className="text-purple-300 text-xs text-center">{statusMessage}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="flex-shrink-0 border-t border-blue-500/20"
          style={{ padding: 'clamp(0.75rem, 2vh, 1rem)' }}
        >
          <div className="flex gap-2">
            <button
              onClick={resetChanges}
              disabled={!hasChanges || loading}
              className="flex-1 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                padding: 'clamp(0.5rem, 1.5vh, 0.75rem)',
                fontSize: 'clamp(0.875rem, 2vh, 1rem)',
                background: 'rgba(75, 85, 99, 0.8)',
                border: '1px solid rgba(75, 85, 99, 0.5)',
              }}
            >
              Reset
            </button>
            <button
              onClick={handleSubmit}
              disabled={!hasChanges || loading || isUpdating}
              className="flex-[2] text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                padding: 'clamp(0.5rem, 1.5vh, 0.75rem)',
                fontSize: 'clamp(0.875rem, 2vh, 1rem)',
                background: hasChanges && !loading && !isUpdating
                  ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.8), rgba(147, 51, 234, 0.8))'
                  : 'rgba(75, 85, 99, 0.5)',
                border: hasChanges && !loading && !isUpdating
                  ? '1px solid rgba(59, 130, 246, 0.5)'
                  : '1px solid rgba(75, 85, 99, 0.3)',
                boxShadow: hasChanges && !loading && !isUpdating
                  ? '0 0 20px rgba(59, 130, 246, 0.3)'
                  : 'none',
              }}
            >
              {isUpdating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span>
                  Updating NFT...
                </span>
              ) : loading ? (
                '⏳ Processing...'
              ) : (
                `Apply Changes ($0.05)`
              )}
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full mt-2 text-gray-400 hover:text-white transition-colors"
            style={{
              padding: 'clamp(0.5rem, 1.5vh, 0.625rem)',
              fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default TraitSwapper;
