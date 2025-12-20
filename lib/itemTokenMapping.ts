// Item Token ID Mapping for Trait Editor
// Maps trait categories to bonded item token IDs

// Maps trait categories to item token IDs
export const ITEM_TOKEN_MAPPING: Record<string, Record<string, number>> = {
  // SHIRTS (ID 1-15) - maps to Clothes trait
  Clothes: {
    "None": 0,
    "Base Shirt": 1,
    "Based Shirt": 2,
    "Blue Shirt": 3,
    "Cyan Shirt": 4,
    "Green Shirt": 5,
    "Grey Shirt": 6,
    "Lime Shirt": 7,
    "Nougat Shirt": 8,
    "Orange Shirt": 9,
    "Pink Shirt": 10,
    "Plum Shirt": 11,
    "Red Shirt": 12,
    "Sun Shirt": 13,
    "White Shirt": 14,
    "Yellow Shirt": 15,
  },
  // PANTS (ID 16-23)
  Pants: {
    "None": 0,
    "Based Pants": 16,
    "Blue Pants": 17,
    "Grey Pants": 18,
    "Purple Pants": 19,
    "Red Pants": 20,
    "Sky Pants": 21,
    "Sol Pants": 22,
    "White Pants": 23,
  },
  // HANDS (ID 35-39) - Gloves
  Hands: {
    "None": 0,
    "Grey Gloves": 35,
    "Pink Gloves": 36,
    "Purple Gloves": 37,
    "Red Gloves": 38,
    "White Gloves": 39,
  },
  // WEAPONS (ID 24-34) - maps to Accessory1
  Accessory1: {
    "None": 0,
    "Apple Shooter": 24,
    "Baseball Bat": 25,
    "Earth Wand": 26,
    "Electric Wand": 27,
    "Fire Wand": 28,
    "Hammer": 29,
    "Knife": 30,
    "Mace": 31,
    "Sickle": 32,
    "Spear": 33,
    "Water Wand": 34,
  },
  // HIP (ID 40-42) - Fanny Packs - maps to Accessory2
  Accessory2: {
    "None": 0,
    "Purple Fanny Pack": 40,
    "Red Fanny Pack": 41,
    "Yellow Fanny Pack": 42,
  },
  // NECK (ID 43-45, 66) - Amulets and Chain - maps to Accessory3
  Accessory3: {
    "None": 0,
    "Amulet of Apple": 43,
    "Amulet of Health": 44,
    "Ethereal Amulet": 45,
    "Base Chain": 66,
  },
  // HATS (ID 63-65) - maps to Accessory4
  Accessory4: {
    "None": 0,
    "Santa Hat": 63,
    "Doug Dimmadome": 64,
    "Blue Partyhat": 65,
  },
  // FACE (ID 46) - Beard - maps to Accessory5
  Accessory5: {
    "None": 0,
    "White Beard": 46,
  },
  // HAIR (ID 47-55)
  Hair: {
    "None": 0,
    "Blonde Hair": 47,
    "Brown Hair": 48,
    "Buzz Cut": 49,
    "Buzz Cut Alt": 50,
    "One Hair": 51,
    "One Hair Alt": 52,
    "Poop Hair": 53,
    "Three Hair": 54,
    "Three Hair Alt": 55,
  },
  // BACKGROUNDS (ID 56-62)
  Background: {
    "None": 0,
    "Cave Background": 56,
    "Moon Background": 57,
    "Mount Blowamanjaro": 58,
    "Pond Background": 59,
    "Sun Background": 60,
    "Sunny Background": 61,
    "The Last Eclipse": 62,
  },
};

// Reverse mapping: token ID to item info
export const TOKEN_ID_TO_ITEM: Record<number, { trait: string; name: string }> = {};

// Build reverse mapping
for (const [trait, items] of Object.entries(ITEM_TOKEN_MAPPING)) {
  for (const [name, tokenId] of Object.entries(items)) {
    if (tokenId > 0) {
      TOKEN_ID_TO_ITEM[tokenId] = { trait, name };
    }
  }
}

// Equippable trait categories (items from bonded items)
export const EQUIPPABLE_TRAITS = [
  "Clothes",
  "Pants",
  "Hands",
  "Accessory1",
  "Accessory2",
  "Accessory3",
  "Accessory4",
  "Accessory5",
  "Hair",
  "Background",
] as const;

export type EquippableTrait = typeof EQUIPPABLE_TRAITS[number];

// User-friendly trait display names
export const TRAIT_DISPLAY_NAMES: Record<string, string> = {
  Clothes: "Shirt",
  Pants: "Pants",
  Hands: "Gloves",
  Accessory1: "Weapon",
  Accessory2: "Hip",
  Accessory3: "Neck",
  Accessory4: "Hat",
  Accessory5: "Face",
  Hair: "Hair",
  Background: "Background",
};

/**
 * Get token ID from trait and value
 */
export function getTokenIdFromTrait(trait: string, value: string): number | null {
  const traitMapping = ITEM_TOKEN_MAPPING[trait];
  if (!traitMapping) return null;
  const tokenId = traitMapping[value];
  return tokenId !== undefined ? tokenId : null;
}

/**
 * Get trait info from token ID
 */
export function getTraitFromTokenId(tokenId: number): { trait: string; value: string } | null {
  const info = TOKEN_ID_TO_ITEM[tokenId];
  if (!info) return null;
  return { trait: info.trait, value: info.name };
}

/**
 * Get all item names for a trait category
 */
export function getItemNamesForTrait(trait: string): string[] {
  const traitMapping = ITEM_TOKEN_MAPPING[trait];
  if (!traitMapping) return ['None'];
  return Object.keys(traitMapping);
}

/**
 * Check if a token ID is valid
 */
export function isValidTokenId(tokenId: number): boolean {
  return TOKEN_ID_TO_ITEM[tokenId] !== undefined;
}

/**
 * Get items available in user's inventory for a specific trait
 */
export function getAvailableItemsForTrait(
  trait: string,
  inventory: Record<number, number>
): string[] {
  const traitMapping = ITEM_TOKEN_MAPPING[trait];
  if (!traitMapping) return ['None'];

  const available: string[] = ['None'];
  for (const [name, tokenId] of Object.entries(traitMapping)) {
    if (tokenId === 0) continue; // Skip "None"
    if ((inventory[tokenId] || 0) > 0) {
      available.push(name);
    }
  }
  return available;
}
