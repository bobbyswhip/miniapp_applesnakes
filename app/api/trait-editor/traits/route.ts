import { NextRequest, NextResponse } from 'next/server';
import {
  ITEM_TOKEN_MAPPING,
  TOKEN_ID_TO_ITEM,
  EQUIPPABLE_TRAITS,
  TRAIT_DISPLAY_NAMES
} from '@/lib/itemTokenMapping';

// IPNS Configuration
const IPNS_CONFIG = {
  items: {
    gateway: 'https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i',
    networkKey: 'k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i',
  },
  traits: {
    gateway: 'https://ipfs.filebase.io/ipns/k51qzi5uqu5dh4bd9ukgssk9szgu8k7bv0zgaa3g6463vemct4m0iee30zwood',
    networkKey: 'k51qzi5uqu5dh4bd9ukgssk9szgu8k7bv0zgaa3g6463vemct4m0iee30zwood',
  },
  contract: '0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd',
};

// Category metadata
const CATEGORY_METADATA: Record<string, { name: string; slot: string; layer: string; description: string }> = {
  Clothes: { name: 'Clothes', slot: 'shirt', layer: 'Shirt', description: 'Shirts and tops' },
  Pants: { name: 'Pants', slot: 'pants', layer: 'Pants', description: 'Pants and bottoms' },
  Hands: { name: 'Hands', slot: 'hands', layer: 'Hands', description: 'Gloves' },
  Accessory1: { name: 'Weapon', slot: 'weapon', layer: 'Weapons', description: 'Weapons and tools' },
  Accessory2: { name: 'Hip', slot: 'hip', layer: 'Hip', description: 'Fanny packs' },
  Accessory3: { name: 'Neck', slot: 'neck', layer: 'Neck', description: 'Necklaces and amulets' },
  Accessory4: { name: 'Hat', slot: 'hat', layer: 'Hat', description: 'Hats and headwear' },
  Accessory5: { name: 'Face', slot: 'face', layer: 'Face', description: 'Beards and face accessories' },
  Hair: { name: 'Hair', slot: 'hair', layer: 'Hair', description: 'Hairstyles' },
  Background: { name: 'Background', slot: 'background', layer: 'Background', description: 'Backgrounds' },
};

// Item rarity mapping
const ITEM_RARITY: Record<number, string> = {
  24: 'rare',    // Apple Shooter
  26: 'rare',    // Earth Wand
  27: 'rare',    // Electric Wand
  28: 'rare',    // Fire Wand
  34: 'rare',    // Water Wand
  43: 'legendary', // Amulet of Apple
  44: 'epic',    // Amulet of Health
  45: 'rare',    // Ethereal Amulet
  62: 'rare',    // The Last Eclipse
  63: 'presale', // Santa Hat
  64: 'presale', // Doug Dimmadome
  65: 'presale', // Blue Partyhat
  66: 'presale', // Base Chain
};

// Item file mapping for trait layers
const ITEM_FILES: Record<number, string> = {
  // Shirts
  1: 'Shirt/Base.png',
  2: 'Shirt/Based.png',
  3: 'Shirt/Blue.png',
  4: 'Shirt/Cyan.png',
  5: 'Shirt/Green.png',
  6: 'Shirt/Grey.png',
  7: 'Shirt/Lime.png',
  8: 'Shirt/Nougat.png',
  9: 'Shirt/Orange.png',
  10: 'Shirt/Pink.png',
  11: 'Shirt/Plum.png',
  12: 'Shirt/Red.png',
  13: 'Shirt/Sun.png',
  14: 'Shirt/White.png',
  15: 'Shirt/Yellow.png',
  // Pants
  16: 'Pants/Based.png',
  17: 'Pants/Blue.png',
  18: 'Pants/Grey.png',
  19: 'Pants/Purple.png',
  20: 'Pants/Red.png',
  21: 'Pants/Sky.png',
  22: 'Pants/Sol.png',
  23: 'Pants/White.png',
  // Weapons
  24: 'Weapons/AppleShooter#60.png',
  25: 'Weapons/BaseballBat#5.png',
  26: 'Weapons/EarthWand#60.png',
  27: 'Weapons/ElectricWand#60.png',
  28: 'Weapons/FireWand#60.png',
  29: 'Weapons/Hammer#15.png',
  30: 'Weapons/Knife#30.png',
  31: 'Weapons/Mace#30.png',
  32: 'Weapons/Sickle#15.png',
  33: 'Weapons/Spear#60.png',
  34: 'Weapons/WaterWand#60.png',
  // Gloves
  35: 'Hands/Grey.png',
  36: 'Hands/Pink.png',
  37: 'Hands/Purple.png',
  38: 'Hands/Red.png',
  39: 'Hands/White.png',
  // Fanny Packs
  40: 'Hip/PurpleFannyPack.png',
  41: 'Hip/RedFannyPack.png',
  42: 'Hip/YellowFannyPack.png',
  // Amulets
  43: 'Neck/AmuletOfApple.png',
  44: 'Neck/AmuletOfHealth.png',
  45: 'Neck/EtherealAmulet.png',
  // Face
  46: 'Face/WhiteBeard.png',
  // Hair
  47: 'Hair/Blonde.png',
  48: 'Hair/Brown.png',
  49: 'Hair/BuzzCut.png',
  50: 'Hair/BuzzCutAlt.png',
  51: 'Hair/OneHair.png',
  52: 'Hair/OneHairAlt.png',
  53: 'Hair/Poop.png',
  54: 'Hair/ThreeHair.png',
  55: 'Hair/ThreeHairAlt.png',
  // Backgrounds
  56: 'Background/Cave#15.png',
  57: 'Background/Moon#15.png',
  58: 'Background/MountBlowamanjaro#5.png',
  59: 'Background/Pond#15.png',
  60: 'Background/Sun#15.png',
  61: 'Background/Sunny#15.png',
  62: 'Background/TheLastEclipse#60.png',
  // Hats
  63: 'Hat/SantaHat#5.png',
  64: 'Hat/DougDimmadome#5.png',
  65: 'Hat/BluePartyhat#5.png',
  // Chain
  66: 'Neck/BaseChain.png',
};

function getImageUrl(tokenId: number): string {
  return `${IPNS_CONFIG.items.gateway}/images/${tokenId}.png`;
}

function getMetadataUrl(tokenId: number): string {
  return `${IPNS_CONFIG.items.gateway}/${tokenId}.json`;
}

function getTraitLayerUrl(file: string): string {
  return `${IPNS_CONFIG.traits.gateway}/${file}`;
}

interface ItemData {
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

function buildAllItems(): ItemData[] {
  const items: ItemData[] = [];

  for (const [traitCategory, itemMap] of Object.entries(ITEM_TOKEN_MAPPING)) {
    const categoryMeta = CATEGORY_METADATA[traitCategory];
    if (!categoryMeta) continue;

    for (const [name, tokenId] of Object.entries(itemMap)) {
      if (tokenId === 0) continue; // Skip "None"

      const file = ITEM_FILES[tokenId] || '';
      const weight = file.match(/#(\d+)\.png$/)?.[1];

      items.push({
        id: tokenId,
        name,
        category: categoryMeta.layer,
        slot: categoryMeta.slot,
        traitCategory,
        file,
        imageUrl: getImageUrl(tokenId),
        metadataUrl: getMetadataUrl(tokenId),
        traitLayerUrl: file ? getTraitLayerUrl(file) : '',
        rarity: ITEM_RARITY[tokenId] || null,
        weight: weight ? parseInt(weight, 10) : undefined,
      });
    }
  }

  return items.sort((a, b) => a.id - b.id);
}

function buildTraitsData() {
  const allItems = buildAllItems();
  const traits: Record<string, {
    category: typeof CATEGORY_METADATA[string] & { id: string };
    items: ItemData[];
    options: Array<{ value: string; tokenId: number; imageUrl: string; rarity: string | null }>;
  }> = {};

  for (const traitCategory of EQUIPPABLE_TRAITS) {
    const categoryMeta = CATEGORY_METADATA[traitCategory];
    if (!categoryMeta) continue;

    const categoryItems = allItems.filter(item => item.traitCategory === traitCategory);

    traits[traitCategory] = {
      category: { id: traitCategory, ...categoryMeta },
      items: categoryItems,
      options: [
        { value: 'None', tokenId: 0, imageUrl: '', rarity: null },
        ...categoryItems.map(item => ({
          value: item.name,
          tokenId: item.id,
          imageUrl: item.imageUrl,
          rarity: item.rarity,
        })),
      ],
    };
  }

  return traits;
}

function buildItemsBySlot(allItems: ItemData[]): Record<string, ItemData[]> {
  const bySlot: Record<string, ItemData[]> = {};

  for (const item of allItems) {
    if (!bySlot[item.slot]) {
      bySlot[item.slot] = [];
    }
    bySlot[item.slot].push(item);
  }

  return bySlot;
}

function buildLookups(allItems: ItemData[]) {
  const tokenIdToTrait: Record<number, { category: string; name: string; slot: string }> = {};
  const nameToTokenId: Record<string, Record<string, number>> = {};

  for (const item of allItems) {
    tokenIdToTrait[item.id] = {
      category: item.traitCategory,
      name: item.name,
      slot: item.slot,
    };

    if (!nameToTokenId[item.traitCategory]) {
      nameToTokenId[item.traitCategory] = { 'None': 0 };
    }
    nameToTokenId[item.traitCategory][item.name] = item.id;
  }

  return { tokenIdToTrait, nameToTokenId };
}

function buildStats(allItems: ItemData[]) {
  const itemsByCategory: Record<string, number> = {};

  for (const item of allItems) {
    if (!itemsByCategory[item.traitCategory]) {
      itemsByCategory[item.traitCategory] = 0;
    }
    itemsByCategory[item.traitCategory]++;
  }

  return {
    totalItems: allItems.length,
    totalCategories: Object.keys(CATEGORY_METADATA).length,
    itemsByCategory,
  };
}

async function fetchLiveMetadata(tokenId: number): Promise<unknown> {
  try {
    const url = getMetadataUrl(tokenId);
    const response = await fetch(url, {
      next: { revalidate: 3600 } // Cache for 1 hour
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`[trait-editor/traits] Failed to fetch live metadata for token ${tokenId}:`, error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get('category');
  const tokenIdParam = searchParams.get('tokenId');
  const live = searchParams.get('live') === 'true';

  try {
    const allItems = buildAllItems();

    // Single item lookup
    if (tokenIdParam) {
      const tokenId = parseInt(tokenIdParam, 10);
      const item = allItems.find(i => i.id === tokenId);

      if (!item) {
        return NextResponse.json(
          { success: false, error: `Item with tokenId ${tokenId} not found` },
          { status: 404 }
        );
      }

      const response: {
        success: boolean;
        item: ItemData;
        liveMetadata?: unknown;
      } = {
        success: true,
        item,
      };

      if (live) {
        response.liveMetadata = await fetchLiveMetadata(tokenId);
      }

      return NextResponse.json(response);
    }

    // Category lookup
    if (category) {
      const categoryMeta = CATEGORY_METADATA[category];
      if (!categoryMeta) {
        return NextResponse.json(
          { success: false, error: `Category "${category}" not found` },
          { status: 404 }
        );
      }

      const categoryItems = allItems.filter(item => item.traitCategory === category);

      return NextResponse.json({
        success: true,
        category: { id: category, ...categoryMeta },
        items: categoryItems,
        count: categoryItems.length,
        options: [
          { value: 'None', tokenId: 0, imageUrl: '' },
          ...categoryItems.map(item => ({
            value: item.name,
            tokenId: item.id,
            imageUrl: item.imageUrl,
            rarity: item.rarity,
          })),
        ],
      });
    }

    // Full catalog
    const traits = buildTraitsData();
    const itemsBySlot = buildItemsBySlot(allItems);
    const lookups = buildLookups(allItems);
    const stats = buildStats(allItems);

    const categories = EQUIPPABLE_TRAITS.map(id => ({
      id,
      ...CATEGORY_METADATA[id],
    }));

    return NextResponse.json({
      success: true,

      // IPNS Configuration
      ipns: {
        items: {
          gateway: IPNS_CONFIG.items.gateway,
          networkKey: IPNS_CONFIG.items.networkKey,
        },
        traits: {
          gateway: IPNS_CONFIG.traits.gateway,
          networkKey: IPNS_CONFIG.traits.networkKey,
        },
        contract: IPNS_CONFIG.contract,
      },

      // Categories
      categories,

      // Traits with items
      traits,

      // All items flat array
      allItems,

      // Items grouped by slot
      itemsBySlot,

      // Lookup tables
      lookups,

      // Statistics
      stats,
    });
  } catch (error) {
    console.error('[trait-editor/traits] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to build trait catalog' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tokenIds, fetchAll } = body;

    const allItems = buildAllItems();

    // Fetch all items
    if (fetchAll) {
      const results: Record<number, { success: boolean; item: ItemData; liveMetadata?: unknown; error?: string }> = {};

      for (const item of allItems) {
        try {
          const liveMetadata = await fetchLiveMetadata(item.id);
          results[item.id] = {
            success: true,
            item,
            liveMetadata,
          };
        } catch (error) {
          results[item.id] = {
            success: false,
            item,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }

      return NextResponse.json({
        success: true,
        results,
        totalRequested: allItems.length,
      });
    }

    // Fetch specific token IDs
    if (!tokenIds || !Array.isArray(tokenIds)) {
      return NextResponse.json(
        { success: false, error: 'tokenIds array or fetchAll flag is required' },
        { status: 400 }
      );
    }

    const results: Record<number, { success: boolean; item?: ItemData; liveMetadata?: unknown; error?: string }> = {};

    for (const tokenId of tokenIds) {
      const item = allItems.find(i => i.id === tokenId);
      if (!item) {
        results[tokenId] = {
          success: false,
          error: `Item with tokenId ${tokenId} not found`,
        };
        continue;
      }

      try {
        const liveMetadata = await fetchLiveMetadata(tokenId);
        results[tokenId] = {
          success: true,
          item,
          liveMetadata,
        };
      } catch (error) {
        results[tokenId] = {
          success: false,
          item,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    return NextResponse.json({
      success: true,
      results,
      totalRequested: tokenIds.length,
    });
  } catch (error) {
    console.error('[trait-editor/traits] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch trait metadata' },
      { status: 500 }
    );
  }
}
