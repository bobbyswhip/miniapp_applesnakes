// components/CanvasPreview.tsx
// Client-side canvas compositing for NFT trait preview
// Uses the Layer API from trait-swap.md for proper layer rendering
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// =============================================================================
// Constants
// =============================================================================

// Local layers path (from /public/layers/)
const LAYERS_BASE = '/layers';

// NFT images IPNS (for "Current" display)
const NFT_IPNS_BASE = 'https://ipfs.filebase.io/ipns/k51qzi5uqu5dm7e0kn5ud2iogv1fonqr7if8ijb9w61bpcbjxuk0cp177dv2pp';

// Base traits that use simple {Value}.png format (no weight suffix)
const BASE_TRAIT_LAYERS = ['Skin', 'Eyes', 'Mouth', 'Outline'];

// Required traits that cannot be "None" - these are permanent NFT traits
// They should NEVER be overwritten with "None" values from pendingTraits
// because the API might return "None" for these even though they exist on the NFT
const PROTECTED_BASE_TRAITS = ['Skin', 'Eyes', 'Mouth'];

// Layers that should ALWAYS be rendered with a default value if not specified
// These are essential structural layers that every NFT needs
const REQUIRED_DEFAULT_LAYERS: Record<string, Record<string, string>> = {
  human: {
    Outline: 'Outline',  // Human outline is always needed
  },
  snake: {
    OutlineSnake: 'Snake', // Snake outline is always needed
  },
};

// =============================================================================
// Layer File Path Mapping
// Maps layer name + value to the correct file path in /public/layers/
// =============================================================================

// Complete mapping of layer values to their file paths
const LAYER_FILE_MAP: Record<string, Record<string, string>> = {
  // Base traits - simple {Value}.png in their own folders
  Skin: {
    'Pale': 'Skin/Pale.png',
    'Pink': 'Skin/Pink.png',
    'Tan': 'Skin/Tan.png',
  },
  Eyes: {
    'Alien': 'Eyes/Alien.png',
    'High': 'Eyes/High.png',
    'Normal': 'Eyes/Normal.png',
    'Wide': 'Eyes/Wide.png',
  },
  Mouth: {
    'HighSad': 'Mouth/HighSad.png',
    'HighSmile': 'Mouth/HighSmile.png',
    'HighFlat': 'Mouth/HighFlat.png',
    'LowFlat': 'Mouth/LowFlat.png',
    'LowSmile': 'Mouth/LowSmile.png',
    'LowSad': 'Mouth/LowSad.png',
    'MidSad': 'Mouth/MidSad.png',
    'MidSmile': 'Mouth/MidSmile.png',
    // Note: MidFlat does not exist in layer files
  },
  Outline: {
    'Outline': 'Outline/Outline.png',
    'Black': 'Outline/Outline.png', // Alias - some APIs return "Black"
  },
  // Shirt - simple {Value}.png (NO "None" entry - skip rendering when None)
  Shirt: {
    'Base': 'Shirt/Base.png',
    'Based': 'Shirt/Based.png',
    'Blue': 'Shirt/Blue.png',
    'Cyan': 'Shirt/Cyan.png',
    'Green': 'Shirt/Green.png',
    'Grey': 'Shirt/Grey.png',
    'Lime': 'Shirt/Lime.png',
    'Nougat': 'Shirt/Nougat.png',
    'Orange': 'Shirt/Orange.png',
    'Pink': 'Shirt/Pink.png',
    'Plum': 'Shirt/Plum.png',
    'Red': 'Shirt/Red.png',
    'Sun': 'Shirt/Sun.png',
    'White': 'Shirt/White.png',
    'Yellow': 'Shirt/Yellow.png',
    // "None" is intentionally NOT mapped - skip rendering entirely
  },
  // Pants - simple {Value}.png (NO "None" entry - skip rendering when None)
  Pants: {
    'Based': 'Pants/Based.png',
    'Blue': 'Pants/Blue.png',
    'Grey': 'Pants/Grey.png',
    'Purple': 'Pants/Purple.png',
    'Red': 'Pants/Red.png',
    'Sky': 'Pants/Sky.png',
    'Sol': 'Pants/Sol.png',
    'White': 'Pants/White.png',
    // "None" is intentionally NOT mapped - skip rendering entirely
  },
  // Background - with weight suffixes
  Background: {
    'Cave': 'Background/Cave#15.png',
    'Moon': 'Background/Moon#15.png',
    'MountBlowamanjaro': 'Background/MountBlowamanjaro#15.png',
    'Pond': 'Background/Pond#15.png',
    'Sun': 'Background/Sun#15.png',
    'Sunny': 'Background/Sunny#65.png',
    'TheLastEclipse': 'Background/TheLastEclipse#5.png',
  },
  // Hair - with weight suffixes (None variants for bald characters)
  Hair: {
    'Blonde': 'Hair/Blonde#5.png',
    'Brown': 'Hair/Brown#5.png',
    'Buzz': 'Hair/Buzz#5.png',
    'One': 'Hair/One#5.png',
    'Poop': 'Hair/Poop#5.png',
    'Three': 'Hair/Three#5.png',
    'None': 'Hair/None#100.png',
    'None2': 'Hair/None2#20.png',
    'None3': 'Hair/None3#30.png',
  },
  // Weapons - with weight suffixes
  Weapons: {
    'AppleShooter': 'Weapons/AppleShooter#10.png',
    'Baseball': 'Weapons/Baseball#30.png',
    'EarthWand': 'Weapons/EarthWand#10.png',
    'ElectricWand': 'Weapons/ElectricWand#10.png',
    'FireWand': 'Weapons/FireWand#10.png',
    'Hammer': 'Weapons/Hammer#30.png',
    'Knife': 'Weapons/Knife#30.png',
    'Mace': 'Weapons/Mace#30.png',
    'Sickle': 'Weapons/Sickle#30.png',
    'Spear': 'Weapons/Spear#60.png',
    'WaterWand': 'Weapons/WaterWand#10.png',
  },
  // Hands (Gloves) - in Accessories folder with weight
  Hands: {
    'GreyGloves': 'Accessories/GreyGloves#7.png',
    'PinkGloves': 'Accessories/PinkGloves#7.png',
    'PurpleGloves': 'Accessories/PurpleGloves#7.png',
    'RedGloves': 'Accessories/RedGloves#7.png',
    'WhiteGloves': 'Accessories/WhiteGloves#7.png',
  },
  // Hip (Fanny packs) - in Accessories folder
  Hip: {
    'PurpleFannyPack': 'Accessories/PurpleFannyPack#5.png',
    'RedFannyPack': 'Accessories/RedFannyPack#5.png',
    'YellowFannyPack': 'Accessories/YellowFannyPack#5.png',
  },
  // Neck (Amulets) - in Neck folder at root, some also in Accessories
  Neck: {
    'AmuletOfApple': 'Neck/AmuletOfApple#1.png',
    'AmuletOfHealth': 'Neck/AmuletOfHealth#2.png',
    'EtherealAmulet': 'Neck/EtherealAmulet#5.png',
    'BaseChain': 'Neck/BaseChain.png',
  },
  // Face (Beard) - in Accessories folder
  Face: {
    'WhiteBeard': 'Accessories/WhiteBeard#3.png',
  },
  // Hat - in Hat folder at root level (also duplicated in Items/Hats)
  Hat: {
    'SantaHat': 'Hat/SantaHat.png',
    'DougDimmadome': 'Hat/DougDimmadome.png',
    'BluePartyhat': 'Hat/BluePartyhat.png',
    'warden': 'Hat/warden.png',
  },
};


// =============================================================================
// Layer Order - CRITICAL: Draw in this exact order (back to front)
// From trait-swap.md
// =============================================================================

const HUMAN_LAYER_ORDER = [
  'Background',  // 1. Background scene (always first)
  'Skin',        // 2. Body/skin base
  'Pants',       // 3. Pants
  'Shirt',       // 4. Shirt (from "Clothes" trait)
  'Eyes',        // 5. Eyes
  'Mouth',       // 6. Mouth
  'Hair',        // 7. Hair (SKIP if hat equipped!)
  'Outline',     // 8. Character outline
  'Hands',       // 9. Gloves
  'Neck',        // 10. Necklaces/amulets
  'Hip',         // 11. Fanny packs/belts
  'Face',        // 12. Beards/masks
  'Hat',         // 13. Hats
  'Weapons',     // 14. Weapons (always on top)
];

const SNAKE_LAYER_ORDER = [
  'Background',
  'Belly2',
  'Back2',
  'Head2',
  'Mouth2',
  'Eyes2',
  'Leaf2',
  'OutlineSnake',
];

// =============================================================================
// Trait to Layer Mapping (from trait-swap.md)
// Maps trait category names to layer folder names
// =============================================================================

const TRAIT_TO_LAYER: Record<string, string> = {
  // Direct mappings
  Background: 'Background',
  Skin: 'Skin',
  Pants: 'Pants',
  Eyes: 'Eyes',
  Mouth: 'Mouth',
  Hair: 'Hair',
  Outline: 'Outline',
  Hands: 'Hands',
  Weapons: 'Weapons',
  Hip: 'Hip',
  Neck: 'Neck',
  Hat: 'Hat',
  Face: 'Face',
  // Alternative names (trait category -> layer folder)
  Clothes: 'Shirt',      // "Clothes" trait maps to "Shirt" layer
  Shirt: 'Shirt',        // Also accept "Shirt" directly
  Accessory1: 'Weapons',
  Accessory2: 'Hip',
  Accessory3: 'Neck',
  Accessory4: 'Hat',
  Accessory5: 'Face',
};

// Reverse mapping: Layer folder -> trait names to check
// The API can return either the layer name or alternative names
const LAYER_TO_TRAITS: Record<string, string[]> = {
  Background: ['Background'],
  Skin: ['Skin'],
  Pants: ['Pants'],
  Shirt: ['Clothes', 'Shirt'],        // Check both "Clothes" and "Shirt"
  Eyes: ['Eyes'],
  Mouth: ['Mouth'],
  Hair: ['Hair'],
  Outline: ['Outline'],
  Hands: ['Hands'],
  Weapons: ['Weapons', 'Accessory1'], // Check both names
  Hip: ['Hip', 'Accessory2'],
  Neck: ['Neck', 'Accessory3'],
  Hat: ['Hat', 'Accessory4'],
  Face: ['Face', 'Accessory5'],
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get trait value for a layer from traits object
 * Per trait-swap.md line 339: if (!option || option === "None") continue;
 * Simplified: Check layer name directly first (keys should be normalized by TraitEditorPreview)
 */
function getTraitValueForLayer(layer: string, traits: Record<string, string>): string | null {
  // Primary: Check the layer name directly (normalized keys)
  const directValue = traits[layer];
  if (directValue && directValue !== 'None') {
    return directValue;
  }

  // Fallback: Check alternative names if direct lookup failed
  // This handles cases where traits haven't been normalized
  const possibleNames = LAYER_TO_TRAITS[layer];
  if (possibleNames) {
    for (const name of possibleNames) {
      if (name === layer) continue; // Already checked above
      const value = traits[name];
      if (value && value !== 'None') {
        return value;
      }
    }
  }

  return null;
}

/**
 * Normalize trait value (remove spaces)
 */
function normalizeTraitValue(value: string): string {
  return value.replace(/\s+/g, '');
}


/**
 * Encode file path for URL (handles # character which is common in layer filenames)
 */
function encodeLayerPath(path: string): string {
  // The # character in filenames needs to be encoded as %23 for URLs
  // Otherwise browsers interpret it as a fragment identifier
  return path.replace(/#/g, '%23');
}

/**
 * Get URL for a layer image using local /layers/ path
 */
function getLayerUrl(layerName: string, value: string): string {
  const normalizedValue = normalizeTraitValue(value);

  // Check the comprehensive LAYER_FILE_MAP first
  const filePath = LAYER_FILE_MAP[layerName]?.[normalizedValue];
  if (filePath) {
    const url = `${LAYERS_BASE}/${encodeLayerPath(filePath)}`;
    console.log(`[getLayerUrl] ${layerName}/${value} → ${url}`);
    return url;
  }

  // Fallback: try simple {LayerName}/{Value}.png format
  const fallbackUrl = `${LAYERS_BASE}/${layerName}/${normalizedValue}.png`;
  console.log(`[getLayerUrl] ${layerName}/${value} → fallback: ${fallbackUrl}`);
  return fallbackUrl;
}

/**
 * Build list of layers to render
 */
function buildLayerList(
  traits: Record<string, string>,
  nftType: 'human' | 'snake'
): { layer: string; url: string }[] {
  const layers: { layer: string; url: string }[] = [];
  const layerOrder = nftType === 'human' ? HUMAN_LAYER_ORDER : SNAKE_LAYER_ORDER;
  const requiredDefaults = REQUIRED_DEFAULT_LAYERS[nftType] || {};

  // Check for hat/hair clash - if hat equipped, skip hair
  const hatValue = traits.Hat || traits.Accessory4;
  const hasHat = !!(hatValue && hatValue !== 'None');

  console.log('[buildLayerList] Input traits:', traits);
  console.log('[buildLayerList] Hat value:', hatValue, 'hasHat:', hasHat);

  for (const layer of layerOrder) {
    // Skip hair if hat is equipped
    if (layer === 'Hair' && hasHat) {
      console.log('[buildLayerList] Skipping Hair layer due to hat');
      continue;
    }

    // Get trait value for this layer
    let traitValue = getTraitValueForLayer(layer, traits);

    // If no value found, check if this is a required layer with a default
    if (!traitValue && requiredDefaults[layer]) {
      traitValue = requiredDefaults[layer];
      console.log(`[buildLayerList] Using default for required layer: ${layer} = ${traitValue}`);
    }

    if (traitValue) {
      const url = getLayerUrl(layer, traitValue);
      layers.push({ layer, url });
      console.log(`[buildLayerList] Added layer: ${layer} = ${traitValue} → ${url}`);
    }
  }

  console.log('[buildLayerList] Final layers:', layers.map(l => l.layer));
  return layers;
}

// =============================================================================
// Image Loading with Cache
// =============================================================================

const imageCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

/**
 * Load an image from URL with CORS support and caching
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  // Return cached image if available
  if (imageCache.has(url)) {
    return Promise.resolve(imageCache.get(url)!);
  }

  // Return existing promise if already loading
  if (loadingPromises.has(url)) {
    return loadingPromises.get(url)!;
  }

  // Create new loading promise
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Required for CORS
    img.onload = () => {
      imageCache.set(url, img);
      loadingPromises.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      loadingPromises.delete(url);
      reject(new Error(`Failed to load: ${url}`));
    };
    img.src = url;
  });

  loadingPromises.set(url, promise);
  return promise;
}

// =============================================================================
// CanvasPreview Component
// =============================================================================

export interface CanvasPreviewProps {
  /** Current traits to render */
  traits: Record<string, string>;
  /** Type of NFT - "human" or "snake" */
  nftType: 'human' | 'snake';
  /** Additional CSS classes */
  className?: string;
  /** Show loading spinner */
  showLoading?: boolean;
  /** Callback when rendering complete */
  onRenderComplete?: (dataUrl: string) => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

export function CanvasPreview({
  traits,
  nftType,
  className = '',
  showLoading = true,
  onRenderComplete,
  onError,
}: CanvasPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedLayers, setLoadedLayers] = useState(0);
  const [totalLayers, setTotalLayers] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Create a stable key for detecting trait changes
  const traitsKey = useMemo(() => JSON.stringify(traits), [traits]);

  // Generate preview on canvas
  const generatePreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadedLayers(0);

    try {
      // Build layer list
      const layers = buildLayerList(traits, nftType);
      setTotalLayers(layers.length);

      if (layers.length === 0) {
        throw new Error('No layers to render');
      }

      console.log('[CanvasPreview] Rendering layers:', layers.map(l => l.layer));

      // Create canvas
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // Clear canvas
      ctx.clearRect(0, 0, 512, 512);

      // Draw each layer in order (back to front)
      let layersLoaded = 0;
      for (const { layer, url } of layers) {
        try {
          console.log(`[CanvasPreview] Loading ${layer}: ${url}`);
          const img = await loadImage(url);
          ctx.drawImage(img, 0, 0, 512, 512);
          layersLoaded++;
          setLoadedLayers(layersLoaded);
          console.log(`[CanvasPreview] Drew ${layer} (${layersLoaded}/${layers.length})`);
        } catch (err) {
          console.warn(`[CanvasPreview] Failed to load layer ${layer}:`, url, err);
          // Continue with other layers - don't fail completely
        }
      }

      if (layersLoaded === 0) {
        throw new Error('Failed to load any layers');
      }

      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png');
      setPreviewUrl(dataUrl);
      onRenderComplete?.(dataUrl);
      console.log(`[CanvasPreview] Rendered ${layersLoaded}/${layers.length} layers`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Preview failed';
      console.error('[CanvasPreview] Error:', err);
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [traits, nftType, onRenderComplete, onError]);

  useEffect(() => {
    generatePreview();
  }, [traitsKey, nftType, generatePreview]);

  return (
    <div className={`relative w-full ${className}`}>
      {/* Hidden canvas for rendering */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Preview Image */}
      {previewUrl && !loading && (
        <img
          src={previewUrl}
          alt="NFT Preview"
          className="w-full h-full rounded-lg border border-gray-700 object-contain"
        />
      )}

      {/* Loading overlay */}
      {showLoading && loading && (
        <div className="w-full aspect-square flex flex-col items-center justify-center bg-gray-900/70 rounded-lg">
          <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full" />
          <span className="text-gray-400 text-sm mt-2">
            {totalLayers > 0
              ? `Loading layers (${loadedLayers}/${totalLayers})...`
              : 'Generating preview...'}
          </span>
        </div>
      )}

      {/* Error overlay */}
      {error && !loading && (
        <div className="w-full aspect-square flex items-center justify-center bg-red-900/30 rounded-lg">
          <span className="text-red-400 text-sm text-center px-4">{error}</span>
        </div>
      )}

      {/* Placeholder when no image */}
      {!previewUrl && !loading && !error && (
        <div className="w-full aspect-square rounded-lg border border-gray-700 bg-gray-800 flex items-center justify-center">
          <span className="text-gray-500 text-sm">No preview available</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TraitEditorPreview - Side by Side Comparison (uses local canvas compositing)
// Renders preview using local layer images from /public/layers/
// =============================================================================

export interface TraitEditorPreviewProps {
  /** Token ID of the NFT */
  tokenId: number;
  /** Current traits (from NFT + equipped items) */
  currentTraits: Record<string, string>;
  /** Pending/selected traits for preview */
  pendingTraits: Record<string, string>;
  /** Type of NFT */
  nftType: 'human' | 'snake';
  /** Additional class names */
  className?: string;
}

export function TraitEditorPreview({
  tokenId,
  currentTraits,
  pendingTraits,
  nftType,
  className = '',
}: TraitEditorPreviewProps) {
  const [fullTraits, setFullTraits] = useState<Record<string, string> | null>(null);
  const [imageError, setImageError] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch full NFT traits from API to get base traits (Skin, Eyes, Mouth, etc.)
  useEffect(() => {
    // CRITICAL: Clear previous data immediately when tokenId changes
    // This prevents showing stale traits from a different NFT
    setFullTraits(null);
    setFetchError(null);
    setImageError(false);

    async function fetchFullTraits() {
      try {
        console.log(`[TraitEditorPreview] Fetching full traits for token ${tokenId}`);
        const response = await fetch(`https://api.applesnakes.com/api/nft/${tokenId}`);
        const data = await response.json();

        if (data.success && data.nft?.traits) {
          console.log('[TraitEditorPreview] Full traits from API:', data.nft.traits);
          setFullTraits(data.nft.traits);
        } else if (data.traits) {
          // Alternative response format
          console.log('[TraitEditorPreview] Full traits from API:', data.traits);
          setFullTraits(data.traits);
        } else {
          console.warn('[TraitEditorPreview] No traits in API response:', data);
          setFetchError('Failed to load NFT traits');
        }
      } catch (error) {
        console.warn('[TraitEditorPreview] Failed to fetch full NFT traits:', error);
        setFetchError('Failed to load NFT traits');
      }
    }

    fetchFullTraits();
  }, [tokenId]);

  const hasChanges = Object.keys(pendingTraits).some(
    key => pendingTraits[key] !== currentTraits[key]
  );

  // Normalize trait keys from API names to layer names
  // This ensures user's selection (e.g., "Shirt: None") overrides API values (e.g., "Clothes: Blue")
  const normalizeTraitKey = useCallback((key: string): string => {
    // Convert API names to layer names
    const normalized = TRAIT_TO_LAYER[key];
    return normalized || key;
  }, []);

  // Build preview traits: fullTraits (base) -> currentTraits -> pendingTraits
  // CRITICAL: All keys are normalized to layer names so user selections properly override API values
  // CRITICAL: Protected base traits (Skin, Eyes, Mouth) should NEVER be overwritten with "None"
  const previewTraits = useMemo(() => {
    const merged: Record<string, string> = {};

    // Start with base traits from API (normalize keys)
    if (fullTraits) {
      for (const [key, value] of Object.entries(fullTraits)) {
        const normalizedKey = normalizeTraitKey(key);
        merged[normalizedKey] = value;
      }
    }

    // Apply current equipped traits (normalize keys)
    for (const [key, value] of Object.entries(currentTraits)) {
      if (value && value !== 'None') {
        const normalizedKey = normalizeTraitKey(key);
        merged[normalizedKey] = value;
      }
    }

    // Apply pending changes (normalize keys)
    // This is where user's "None" selections override API values for EQUIPPABLE traits
    // BUT we must PROTECT base traits (Skin, Eyes, Mouth) from being set to "None"
    // because the API might return "None" for these even though they exist on the NFT
    for (const [key, value] of Object.entries(pendingTraits)) {
      const normalizedKey = normalizeTraitKey(key);

      // Protect base traits from being overwritten with "None" or empty values
      // These traits are permanent on the NFT and should use values from fullTraits
      if (PROTECTED_BASE_TRAITS.includes(normalizedKey)) {
        if (value && value !== 'None' && value !== '') {
          // Only override if it's a valid value (not None/empty)
          merged[normalizedKey] = value;
        }
        // If value is "None" or empty, keep the original value from fullTraits
        continue;
      }

      // For equippable traits, allow "None" to unequip items
      merged[normalizedKey] = value;
    }

    console.log('[TraitEditorPreview] Merged traits for preview:', merged);
    console.log('[TraitEditorPreview] Protected traits preserved - Skin:', merged.Skin, 'Eyes:', merged.Eyes, 'Mouth:', merged.Mouth);
    return merged;
  }, [fullTraits, currentTraits, pendingTraits, normalizeTraitKey]);

  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${className}`}>
      {/* Current (from IPFS) */}
      <div className="space-y-2">
        <h3 className="text-xs sm:text-sm font-medium text-gray-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-500" />
          Current
        </h3>
        <div className="relative aspect-square">
          {!imageError ? (
            <img
              src={`${NFT_IPNS_BASE}/${tokenId}.png`}
              alt={`NFT #${tokenId}`}
              className="w-full h-full rounded-lg border border-gray-700 object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full rounded-lg border border-gray-700 bg-gray-800 flex items-center justify-center">
              <span className="text-gray-500 text-sm">Image unavailable</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Preview (client-side canvas compositing using local layers) */}
      <div className="space-y-2">
        <h3 className="text-xs sm:text-sm font-medium text-gray-400 flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${hasChanges ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
          Preview
          {hasChanges && <span className="text-yellow-400 text-xs">(unsaved)</span>}
        </h3>
        <div className="aspect-square">
          {fullTraits ? (
            <CanvasPreview
              traits={previewTraits}
              nftType={nftType}
              className="w-full h-full"
            />
          ) : fetchError ? (
            <div className="w-full h-full rounded-lg border border-gray-700 bg-red-900/20 flex items-center justify-center">
              <span className="text-red-400 text-sm text-center px-2">{fetchError}</span>
            </div>
          ) : (
            <div className="w-full h-full rounded-lg border border-gray-700 bg-gray-800 flex items-center justify-center">
              <div className="animate-spin w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Exports
// =============================================================================

export default CanvasPreview;
export {
  NFT_IPNS_BASE,
  LAYERS_BASE,
  HUMAN_LAYER_ORDER,
  SNAKE_LAYER_ORDER,
  TRAIT_TO_LAYER,
  LAYER_TO_TRAITS,
  LAYER_FILE_MAP,
  BASE_TRAIT_LAYERS,
  getLayerUrl,
  buildLayerList,
  loadImage,
  getTraitValueForLayer,
  normalizeTraitValue,
};
