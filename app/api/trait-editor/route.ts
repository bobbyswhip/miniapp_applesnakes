import { NextRequest, NextResponse } from 'next/server';
import { ITEM_TOKEN_MAPPING, TOKEN_ID_TO_ITEM, EQUIPPABLE_TRAITS } from '@/lib/itemTokenMapping';

// Trait Editor API
// GET: Fetches user's item inventory for trait editing from item-bridge API
// POST: Validates and updates inventory when applying trait changes

const API_BASE = 'https://api.applesnakes.com';

/**
 * Build availableItems from inventory balances
 * Maps token IDs to trait categories for the trait editor
 */
function buildAvailableItems(balances: Record<string, number>): Record<string, string[]> {
  const availableItems: Record<string, string[]> = {};

  // Initialize all equippable traits with "None"
  for (const trait of EQUIPPABLE_TRAITS) {
    availableItems[trait] = ['None'];
  }

  // Add items based on inventory balances
  for (const [tokenIdStr, count] of Object.entries(balances)) {
    if (count <= 0) continue;

    const tokenId = parseInt(tokenIdStr, 10);
    const itemInfo = TOKEN_ID_TO_ITEM[tokenId];

    if (itemInfo) {
      const { trait, name } = itemInfo;
      if (availableItems[trait] && !availableItems[trait].includes(name)) {
        availableItems[trait].push(name);
      }
    }
  }

  return availableItems;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json(
      { success: false, error: 'Address is required' },
      { status: 400 }
    );
  }

  try {
    // Fetch inventory from item-bridge API (this endpoint actually exists)
    const targetUrl = `${API_BASE}/api/item-bridge?action=inventory&address=${address}`;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!data.success || !data.inventory) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch inventory' },
        { status: response.status }
      );
    }

    // Transform item-bridge response to trait-editor format
    const inventory = data.inventory;
    const balances = inventory.balances || {};
    const totalItems = inventory.totalItems || 0;

    // Build availableItems from inventory balances
    const availableItems = buildAvailableItems(balances);

    // Return in the format expected by useTraitSwapper
    return NextResponse.json({
      success: true,
      address: inventory.address || address.toLowerCase(),
      inventory: balances,
      totalItems,
      availableItems,
      cooldowns: {
        fulfil: inventory.fulfilCooldown || { canFulfil: true, remainingSeconds: 0 },
        withdraw: inventory.withdrawCooldown || { canWithdraw: true, remainingSeconds: 0 },
      },
    });
  } catch (error) {
    console.error('[trait-editor] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch inventory' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, tokenId, currentTraits, newTraits } = body;

    if (!address || !tokenId || !currentTraits || !newTraits) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: address, tokenId, currentTraits, newTraits' },
        { status: 400 }
      );
    }

    // For now, just validate the inventory locally
    // In a full implementation, this would update the backend

    // Fetch current inventory
    const inventoryUrl = `${API_BASE}/api/item-bridge?action=inventory&address=${address}`;
    const inventoryRes = await fetch(inventoryUrl);
    const inventoryData = await inventoryRes.json();

    if (!inventoryData.success) {
      return NextResponse.json(
        { success: false, error: 'Failed to verify inventory' },
        { status: 500 }
      );
    }

    const balances = inventoryData.inventory?.balances || {};

    // Calculate what items need to be equipped/returned
    const equipped: Array<{ trait: string; value: string; tokenId: number }> = [];
    const returned: Array<{ trait: string; value: string; tokenId: number }> = [];
    const missingItems: Array<{ trait: string; value: string; tokenId: number }> = [];

    for (const trait of EQUIPPABLE_TRAITS) {
      const oldValue = currentTraits[trait] || 'None';
      const newValue = newTraits[trait] || 'None';

      if (oldValue === newValue) continue;

      // Item being returned
      if (oldValue !== 'None') {
        const traitMapping = ITEM_TOKEN_MAPPING[trait];
        const tokenIdForItem = traitMapping?.[oldValue];
        if (tokenIdForItem && tokenIdForItem > 0) {
          returned.push({ trait, value: oldValue, tokenId: tokenIdForItem });
        }
      }

      // Item being equipped
      if (newValue !== 'None') {
        const traitMapping = ITEM_TOKEN_MAPPING[trait];
        const tokenIdForItem = traitMapping?.[newValue];
        if (tokenIdForItem && tokenIdForItem > 0) {
          // Check if user has this item in inventory
          const hasItem = (balances[tokenIdForItem.toString()] || 0) > 0;
          if (hasItem) {
            equipped.push({ trait, value: newValue, tokenId: tokenIdForItem });
          } else {
            missingItems.push({ trait, value: newValue, tokenId: tokenIdForItem });
          }
        }
      }
    }

    // If any items are missing, return error
    if (missingItems.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'Insufficient items in inventory',
        missingItems,
      }, { status: 400 });
    }

    // Success - return validation result
    // The actual inventory update happens after x402 payment in the NFT generator
    return NextResponse.json({
      success: true,
      message: 'Trait change validated',
      equipped,
      returned,
      newBalance: balances,
      totalItems: inventoryData.inventory?.totalItems || 0,
    });
  } catch (error) {
    console.error('[trait-editor] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to validate trait change' },
      { status: 500 }
    );
  }
}
