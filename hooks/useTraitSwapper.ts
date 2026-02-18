// hooks/useTraitSwapper.ts
// Trait Swapper hook using verified-trait-swapper API from trait-swap.md
// Flow: GET data → User selects traits → POST with X402 payment → Image generated
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useX402Fetch } from './useX402Fetch';
import { getNFTMetadataUrl, getNFTImageUrl } from '@/config';

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

      // Load current NFT image from IPNS (with cache buster for fresh content)
      // This ensures we always get the latest image, not stale EC2 API data
      setImageUrl(getNFTImageUrl(tokenId));

      // Fetch fresh metadata from IPNS to REPLACE stale EC2 data
      // This is the source of truth for what's actually equipped on the NFT
      console.log('[useTraitSwapper] EC2 currentTraits BEFORE IPNS override:', data.currentTraits);
      try {
        const metadataUrl = getNFTMetadataUrl(tokenId);
        console.log('[useTraitSwapper] Fetching fresh IPNS metadata:', metadataUrl);
        const metadataRes = await fetch(metadataUrl);
        if (metadataRes.ok) {
          const metadata = await metadataRes.json();
          console.log('[useTraitSwapper] Raw IPNS metadata:', metadata);

          // Extract traits from IPNS metadata attributes
          if (metadata.attributes && Array.isArray(metadata.attributes)) {
            // Map display names (IPNS) to API names (EC2)
            const displayToApiName: Record<string, string> = {
              'Hat': 'Accessory4',
              'Weapons': 'Accessory1',
              'Hip': 'Accessory2',
              'Neck': 'Accessory3',
              'Face': 'Accessory5',
              'Shirt': 'Clothes',
            };

            // Context-aware IPNS value to item name mapping
            // Some NFTs use old format (Shirt, Weapons) others use new format (Clothes, Accessory1)
            // Need to handle BOTH formats since IPNS metadata varies per NFT
            const ipnsValueToItemName: Record<string, Record<string, string>> = {
              // Shirts - handle both 'Shirt' and 'Clothes' trait names
              'Shirt': {
                'Base': 'Base Shirt', 'Based': 'Based Shirt', 'Blue': 'Blue Shirt',
                'Cyan': 'Cyan Shirt', 'Green': 'Green Shirt', 'Grey': 'Grey Shirt',
                'Lime': 'Lime Shirt', 'Nougat': 'Nougat Shirt', 'Orange': 'Orange Shirt',
                'Pink': 'Pink Shirt', 'Plum': 'Plum Shirt', 'Red': 'Red Shirt',
                'Sun': 'Sun Shirt', 'White': 'White Shirt', 'Yellow': 'Yellow Shirt',
              },
              'Clothes': {
                'Base': 'Base Shirt', 'Based': 'Based Shirt', 'Blue': 'Blue Shirt',
                'Cyan': 'Cyan Shirt', 'Green': 'Green Shirt', 'Grey': 'Grey Shirt',
                'Lime': 'Lime Shirt', 'Nougat': 'Nougat Shirt', 'Orange': 'Orange Shirt',
                'Pink': 'Pink Shirt', 'Plum': 'Plum Shirt', 'Red': 'Red Shirt',
                'Sun': 'Sun Shirt', 'White': 'White Shirt', 'Yellow': 'Yellow Shirt',
              },
              // Pants
              'Pants': {
                'Based': 'Based Pants', 'Blue': 'Blue Pants', 'Grey': 'Grey Pants',
                'Purple': 'Purple Pants', 'Red': 'Red Pants', 'Sky': 'Sky Pants',
                'Sol': 'Sol Pants', 'White': 'White Pants',
              },
              // Hair - handle both short names and long names
              'Hair': {
                'Blonde': 'Blonde Hair', 'Brown': 'Brown Hair',
                'Buzz': 'Buzz Cut', 'BuzzCut': 'Buzz Cut',
                'BuzzAlt': 'Buzz Cut Alt', 'BuzzCutAlt': 'Buzz Cut Alt',
                'One': 'One Hair', 'OneHair': 'One Hair',
                'OneAlt': 'One Hair Alt', 'OneHairAlt': 'One Hair Alt',
                'Poop': 'Poop Hair', 'PoopHair': 'Poop Hair',
                'Three': 'Three Hair', 'ThreeHair': 'Three Hair',
                'ThreeAlt': 'Three Hair Alt', 'ThreeHairAlt': 'Three Hair Alt',
              },
              // Weapons - handle both 'Weapons' and 'Accessory1' trait names
              'Weapons': {
                'AppleShooter': 'Apple Shooter', 'BaseballBat': 'Baseball Bat',
                'EarthWand': 'Earth Wand', 'ElectricWand': 'Electric Wand',
                'FireWand': 'Fire Wand', 'WaterWand': 'Water Wand',
                'Hammer': 'Hammer', 'Knife': 'Knife', 'Mace': 'Mace',
                'Sickle': 'Sickle', 'Spear': 'Spear',
              },
              'Accessory1': {
                'AppleShooter': 'Apple Shooter', 'BaseballBat': 'Baseball Bat',
                'EarthWand': 'Earth Wand', 'ElectricWand': 'Electric Wand',
                'FireWand': 'Fire Wand', 'WaterWand': 'Water Wand',
                'Hammer': 'Hammer', 'Knife': 'Knife', 'Mace': 'Mace',
                'Sickle': 'Sickle', 'Spear': 'Spear',
              },
              // Gloves - handle both 'Hands' trait name
              'Hands': {
                'GreyGloves': 'Grey Gloves', 'PinkGloves': 'Pink Gloves',
                'PurpleGloves': 'Purple Gloves', 'RedGloves': 'Red Gloves',
                'WhiteGloves': 'White Gloves',
              },
              // Hip/Fanny Packs - handle both 'Hip' and 'Accessory2'
              'Hip': {
                'PurpleFannyPack': 'Purple Fanny Pack', 'RedFannyPack': 'Red Fanny Pack',
                'SkullFannyPack': 'Skull Fanny Pack', 'YellowFannyPack': 'Yellow Fanny Pack',
              },
              'Accessory2': {
                'PurpleFannyPack': 'Purple Fanny Pack', 'RedFannyPack': 'Red Fanny Pack',
                'SkullFannyPack': 'Skull Fanny Pack', 'YellowFannyPack': 'Yellow Fanny Pack',
              },
              // Neck/Amulets - handle both 'Neck' and 'Accessory3'
              'Neck': {
                'EtherealAmulet': 'Ethereal Amulet', 'AmuletOfApple': 'Amulet of Apple',
                'AmuletOfHealth': 'Amulet of Health', 'BaseChain': 'Base Chain',
              },
              'Accessory3': {
                'EtherealAmulet': 'Ethereal Amulet', 'AmuletOfApple': 'Amulet of Apple',
                'AmuletOfHealth': 'Amulet of Health', 'BaseChain': 'Base Chain',
              },
              // Hats - handle both 'Hat' and 'Accessory4'
              'Hat': {
                'SantaHat': 'Santa Hat', 'DougDimmadome': 'Doug Dimmadome',
                'BluePartyhat': 'Blue Partyhat',
              },
              'Accessory4': {
                'SantaHat': 'Santa Hat', 'DougDimmadome': 'Doug Dimmadome',
                'BluePartyhat': 'Blue Partyhat',
              },
              // Face - handle both 'Face' and 'Accessory5'
              'Face': {
                'WhiteBeard': 'White Beard',
              },
              'Accessory5': {
                'WhiteBeard': 'White Beard',
              },
              // Background
              'Background': {
                'Cave': 'Cave Background', 'Moon': 'Moon Background',
                'MountBlowamanjaro': 'Mount Blowamanjaro', 'Pond': 'Pond Background',
                'Sun': 'Sun Background', 'Sunny': 'Sunny Background',
                'TheLastEclipse': 'The Last Eclipse',
              },
            };

            // Helper to get normalized value with context
            const normalizeValue = (traitType: string, value: string): string => {
              // Check context-specific mapping first
              const traitMapping = ipnsValueToItemName[traitType];
              if (traitMapping && traitMapping[value]) {
                return traitMapping[value];
              }
              // Return original value if no mapping found
              return value;
            };

            // Equippable traits that should be set to "None" if not in IPNS
            // Include BOTH new format (Clothes, Accessory1-5) AND old format (Shirt, Weapons, Hat, etc.)
            // EC2 API returns both formats with conflicting data, so we must reset both
            const equippableTraits = [
              // New format (API names)
              'Clothes', 'Pants', 'Hands', 'Accessory1', 'Accessory2', 'Accessory3', 'Accessory4', 'Accessory5', 'Hair', 'Background',
              // Old format (display names) - EC2 includes these with stale/wrong values
              'Shirt', 'Weapons', 'Hat', 'Neck', 'Hip', 'Face',
            ];

            // Start with base traits from EC2, but clear all equippable traits
            const freshTraits: Record<string, string> = { ...data.currentTraits };

            // Reset all equippable traits to "None" first
            // This ensures items not in IPNS show as unequipped
            for (const trait of equippableTraits) {
              freshTraits[trait] = 'None';
            }

            // Now apply what's actually in IPNS metadata
            for (const attr of metadata.attributes) {
              if (attr.trait_type && attr.value !== undefined) {
                // Normalize trait name to EC2 format
                const apiName = displayToApiName[attr.trait_type] || attr.trait_type;
                // Normalize value to match item names using context-aware mapping
                const rawValue = String(attr.value);
                const normalizedValue = normalizeValue(attr.trait_type, rawValue);
                // Debug: Log each trait mapping
                if (rawValue !== normalizedValue || attr.trait_type !== apiName) {
                  console.log(`[useTraitSwapper] Mapping: ${attr.trait_type}:${rawValue} → ${apiName}:${normalizedValue}`);
                }
                freshTraits[apiName] = normalizedValue;
              }
            }

            console.log('[useTraitSwapper] Fresh traits from IPNS (normalized):', freshTraits);
            console.log('[useTraitSwapper] Equippable traits set:', {
              Clothes: freshTraits['Clothes'],
              Pants: freshTraits['Pants'],
              Hair: freshTraits['Hair'],
              Hands: freshTraits['Hands'],
              Accessory1: freshTraits['Accessory1'],
              Accessory2: freshTraits['Accessory2'],
              Accessory3: freshTraits['Accessory3'],
              Accessory4: freshTraits['Accessory4'],
              Accessory5: freshTraits['Accessory5'],
            });
            setCurrentTraits(freshTraits as CurrentTraits);
            setSelectedTraits(freshTraits as CurrentTraits);
          }
        }
      } catch (ipnsError) {
        console.warn('[useTraitSwapper] Could not fetch fresh IPNS metadata, using EC2 data:', ipnsError);
        // Fall back to EC2 data (already set above)
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
    console.log('[useTraitSwapper] selectTrait called:', trait, '->', value);
    setSelectedTraits(prev => {
      if (!prev) return prev;
      const newTraits = { ...prev, [trait]: value };
      console.log('[useTraitSwapper] selectedTraits updated:', newTraits);
      return newTraits;
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
