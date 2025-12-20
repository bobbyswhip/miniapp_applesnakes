import { NextRequest, NextResponse } from 'next/server';

// Proxy API route for verified-trait-swapper to avoid CORS issues
// Forwards requests to the production API server

const API_BASE = 'https://api.applesnakes.com';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  const tokenId = searchParams.get('tokenId');

  if (!address) {
    return NextResponse.json(
      { success: false, error: 'Address is required' },
      { status: 400 }
    );
  }

  try {
    // Try the verified-trait-swapper endpoint first
    const targetUrl = new URL(`${API_BASE}/api/verified-trait-swapper`);
    targetUrl.searchParams.set('address', address);
    if (tokenId) targetUrl.searchParams.set('tokenId', tokenId);

    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Check if we got a valid JSON response
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      console.log('[verified-trait-swapper proxy] External API not available, falling back to local endpoints');
      return await fallbackToLocalEndpoints(address, tokenId);
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[verified-trait-swapper proxy] GET error:', error);
    // Fall back to local endpoints
    return await fallbackToLocalEndpoints(address, tokenId);
  }
}

// Fallback: combine data from trait-editor and NFT customize API
async function fallbackToLocalEndpoints(address: string, tokenId: string | null): Promise<NextResponse> {
  try {
    // Get inventory from trait-editor (which uses item-bridge)
    const inventoryRes = await fetch(`${API_BASE}/api/item-bridge?action=inventory&address=${address}`);
    const inventoryData = await inventoryRes.json();

    if (!inventoryData.success) {
      return NextResponse.json(
        { success: false, error: inventoryData.error || 'Failed to fetch inventory' },
        { status: 500 }
      );
    }

    const inventory = inventoryData.inventory;

    // If no tokenId, just return inventory data
    if (!tokenId) {
      // Import the mapping functions
      const { ITEM_TOKEN_MAPPING, TOKEN_ID_TO_ITEM, EQUIPPABLE_TRAITS } = await import('@/lib/itemTokenMapping');

      const balances = inventory.balances || {};
      const availableItems: Record<string, string[]> = {};

      // Build availableItems from inventory
      for (const trait of EQUIPPABLE_TRAITS) {
        availableItems[trait] = ['None'];
      }

      for (const [tokenIdStr, count] of Object.entries(balances)) {
        if ((count as number) <= 0) continue;
        const tid = parseInt(tokenIdStr, 10);
        const itemInfo = TOKEN_ID_TO_ITEM[tid];
        if (itemInfo && availableItems[itemInfo.trait]) {
          if (!availableItems[itemInfo.trait].includes(itemInfo.name)) {
            availableItems[itemInfo.trait].push(itemInfo.name);
          }
        }
      }

      return NextResponse.json({
        success: true,
        address: inventory.address || address.toLowerCase(),
        inventory: balances,
        totalItems: inventory.totalItems || 0,
        availableItems,
        cooldowns: {
          fulfil: inventory.fulfilCooldown || { canFulfil: true, remainingSeconds: 0 },
          withdraw: inventory.withdrawCooldown || { canWithdraw: true, remainingSeconds: 0 },
        },
        price: '$0.05',
      });
    }

    // Get current NFT traits from customize API
    const nftRes = await fetch(`${API_BASE}/api/customize/${tokenId}/available`);
    const nftData = await nftRes.json();

    if (!nftData.success) {
      return NextResponse.json(
        { success: false, error: nftData.error || 'Failed to fetch NFT traits' },
        { status: 500 }
      );
    }

    // Import the mapping functions
    const { TOKEN_ID_TO_ITEM, EQUIPPABLE_TRAITS } = await import('@/lib/itemTokenMapping');

    const balances = inventory.balances || {};
    const availableItems: Record<string, string[]> = {};

    // Build availableItems from inventory
    for (const trait of EQUIPPABLE_TRAITS) {
      availableItems[trait] = ['None'];
    }

    for (const [tokenIdStr, count] of Object.entries(balances)) {
      if ((count as number) <= 0) continue;
      const tid = parseInt(tokenIdStr, 10);
      const itemInfo = TOKEN_ID_TO_ITEM[tid];
      if (itemInfo && availableItems[itemInfo.trait]) {
        if (!availableItems[itemInfo.trait].includes(itemInfo.name)) {
          availableItems[itemInfo.trait].push(itemInfo.name);
        }
      }
    }

    // Add currently equipped items to available options
    if (nftData.currentTraits) {
      for (const [trait, value] of Object.entries(nftData.currentTraits)) {
        if (availableItems[trait] && (value as string) !== 'None') {
          if (!availableItems[trait].includes(value as string)) {
            availableItems[trait].push(value as string);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      address: inventory.address || address.toLowerCase(),
      tokenId: parseInt(tokenId, 10),
      currentTraits: nftData.currentTraits,
      inventory: balances,
      totalItems: inventory.totalItems || 0,
      availableItems,
      cooldowns: {
        fulfil: inventory.fulfilCooldown || { canFulfil: true, remainingSeconds: 0 },
        withdraw: inventory.withdrawCooldown || { canWithdraw: true, remainingSeconds: 0 },
      },
      price: '$0.05',
      paymentInfo: {
        price: '$0.05',
        recipient: '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098',
        description: 'Verified trait swap with ownership verification and image generation',
      },
    });
  } catch (error) {
    console.error('[verified-trait-swapper proxy] Fallback error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, tokenId, newTraits, type } = body;

    if (!address || !tokenId || !newTraits) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: address, tokenId, newTraits' },
        { status: 400 }
      );
    }

    // Validate newTraits has content (per trait-swap.md)
    // EC2 backend returns "New traits are required" for empty/invalid traits object
    if (!newTraits || typeof newTraits !== 'object' || Object.keys(newTraits).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid traits object. Please select traits to apply.' },
        { status: 400 }
      );
    }

    // Forward payment headers if present (for X402 retry)
    const forwardHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward all X-PAYMENT related headers
    const xPayment = request.headers.get('X-PAYMENT');
    const xPaymentAmount = request.headers.get('X-Payment-Amount');
    const xPaymentTxHash = request.headers.get('X-Payment-Tx-Hash');
    const xPaymentFrom = request.headers.get('X-Payment-From');

    if (xPayment) forwardHeaders['X-PAYMENT'] = xPayment;
    if (xPaymentAmount) forwardHeaders['X-Payment-Amount'] = xPaymentAmount;
    if (xPaymentTxHash) forwardHeaders['X-Payment-Tx-Hash'] = xPaymentTxHash;
    if (xPaymentFrom) forwardHeaders['X-Payment-From'] = xPaymentFrom;

    // Try verified-trait-swapper first
    const response = await fetch(`${API_BASE}/api/verified-trait-swapper`, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    // Check if we got a valid JSON response (not HTML 404)
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      console.log('[verified-trait-swapper proxy] External POST API not available, using customize endpoint');
      return await fallbackPostToCustomize(body, forwardHeaders);
    }

    // Handle 402 Payment Required specially - pass through headers
    if (response.status === 402) {
      const data = await response.json();
      const headers = new Headers();

      // Copy payment-related headers
      const x402Version = response.headers.get('X-402-Version');
      const x402Payment = response.headers.get('X-402-Payment');

      if (x402Version) headers.set('X-402-Version', x402Version);
      if (x402Payment) headers.set('X-402-Payment', x402Payment);

      return NextResponse.json(data, { status: 402, headers });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[verified-trait-swapper proxy] POST error:', error);
    // Try fallback
    try {
      const body = await request.clone().json();
      const forwardHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const xPayment = request.headers.get('X-PAYMENT');
      if (xPayment) forwardHeaders['X-PAYMENT'] = xPayment;
      return await fallbackPostToCustomize(body, forwardHeaders);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Failed to post to verified-trait-swapper API' },
        { status: 500 }
      );
    }
  }
}

// Map frontend trait names to backend names (per trait-swap.md)
const TRAIT_NAME_MAP: Record<string, string> = {
  "Accessory1": "Weapons",   // Swords, wands, etc.
  "Accessory2": "Hip",       // Fanny packs, belts
  "Accessory3": "Neck",      // Amulets, chains
  "Accessory4": "Hat",       // Hats, headwear
  "Accessory5": "Face",      // Beards, masks
  "Clothes": "Shirt",        // Normalize Clothes to Shirt
};

function normalizeTraitNames(traits: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(traits)) {
    const normalizedKey = TRAIT_NAME_MAP[key] || key;
    normalized[normalizedKey] = value;
  }
  return normalized;
}

// Fallback POST: use the customize endpoint
async function fallbackPostToCustomize(
  body: { address: string; tokenId: number; newTraits?: Record<string, string>; traits?: Record<string, string>; type?: string },
  headers: Record<string, string>
): Promise<NextResponse> {
  const { address, tokenId, newTraits, traits, type } = body;

  // Per trait-swap.md: Always send FULL traits object, not just changes
  // Use newTraits (full object) preferentially, fall back to traits (partial)
  const rawTraits = newTraits || traits;

  if (!rawTraits || Object.keys(rawTraits).length === 0) {
    return NextResponse.json(
      { success: false, error: 'No trait changes to apply' },
      { status: 400 }
    );
  }

  // Per trait-swap.md: Normalize trait names (Accessory1→Weapons, Clothes→Shirt, etc.)
  const normalizedTraits = normalizeTraitNames(rawTraits);

  try {
    // Per trait-swap.md line 36 & lines 406-413: Use /api/customize/{tokenId} endpoint
    // tokenId goes in URL, NOT in body
    const customizeUrl = `${API_BASE}/api/customize/${tokenId}`;

    console.log('[verified-trait-swapper proxy] Fallback sending to /api/customize/{tokenId}:', {
      url: customizeUrl,
      normalizedTraits,
      type: type === 'snake' ? 'snake' : 'human',
    });

    // Per trait-swap.md lines 406-413: Request body format (no tokenId in body)
    const response = await fetch(customizeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: type === 'snake' ? 'snake' : 'human',  // "human" or "snake"
        traits: normalizedTraits,     // Normalized trait names
        autoPublish: true,
      }),
    });

    // Handle 402 Payment Required
    if (response.status === 402) {
      const data = await response.json();
      const responseHeaders = new Headers();

      const x402Version = response.headers.get('X-402-Version');
      const x402Payment = response.headers.get('X-402-Payment');

      if (x402Version) responseHeaders.set('X-402-Version', x402Version);
      if (x402Payment) responseHeaders.set('X-402-Payment', x402Payment);

      return NextResponse.json(data, { status: 402, headers: responseHeaders });
    }

    const data = await response.json();

    // Transform response to match verified-trait-swapper format
    if (data.success) {
      return NextResponse.json({
        success: true,
        message: data.message || 'Trait swap successful',
        tokenId,
        newTraits: data.newTraits || data.traits,
        equipped: data.equipped || [],
        returned: data.returned || [],
        hatHairClash: data.hatHairClash,
        image: data.image,
        inventory: data.inventory,
        payment: {
          price: '$0.05',
          status: 'completed',
        },
      });
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[verified-trait-swapper proxy] Fallback POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit trait changes' },
      { status: 500 }
    );
  }
}
