import { NextRequest, NextResponse } from 'next/server';

// OpenSea API configuration
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const COLLECTION_SLUG = 'applesnakes';
const CHAIN = 'base';

// OpenSea API base URL
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

// Listing interface
interface OpenSeaListing {
  order_hash: string;
  chain: string;
  type: string;
  price: {
    current: {
      currency: string;
      decimals: number;
      value: string;
    };
  };
  protocol_data: {
    parameters: {
      offerer: string;
      offer: Array<{
        itemType: number;
        token: string;
        identifierOrCriteria: string;
        startAmount: string;
        endAmount: string;
      }>;
    };
  };
  protocol_address: string;
}

interface TransformedListing {
  tokenId: number;
  price: string;
  priceWei: string;
  currency: string;
  seller: string;
  orderHash: string;
  imageUrl: string;
  name: string;
  openseaUrl: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');

    // If no API key, return mock data for development
    if (!OPENSEA_API_KEY) {
      console.warn('OpenSea API key not configured, returning empty listings');
      return NextResponse.json({
        success: true,
        listings: [],
        total: 0,
        message: 'OpenSea API key not configured. Add OPENSEA_API_KEY to environment variables.',
      });
    }

    // Fetch best listings from OpenSea API v2
    const response = await fetch(
      `${OPENSEA_API_BASE}/listings/collection/${COLLECTION_SLUG}/best?limit=${limit}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-API-KEY': OPENSEA_API_KEY,
        },
        next: { revalidate: 60 }, // Cache for 60 seconds
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenSea API error:', response.status, errorText);
      return NextResponse.json(
        {
          success: false,
          error: `OpenSea API error: ${response.status}`,
          listings: [],
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    const listings: OpenSeaListing[] = data.listings || [];

    // Transform listings to our format
    const transformedListings: TransformedListing[] = listings.map((listing) => {
      // Extract token ID from the offer
      const offer = listing.protocol_data?.parameters?.offer?.[0];
      const tokenId = offer ? parseInt(offer.identifierOrCriteria) : 0;

      // Price in ETH
      const priceValue = listing.price?.current?.value || '0';
      const decimals = listing.price?.current?.decimals || 18;
      const priceInEth = parseFloat(priceValue) / Math.pow(10, decimals);

      return {
        tokenId,
        price: priceInEth.toFixed(6),
        priceWei: priceValue,
        currency: listing.price?.current?.currency || 'ETH',
        seller: listing.protocol_data?.parameters?.offerer || '',
        orderHash: listing.order_hash,
        imageUrl: `https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5diqasdnw3fydh31emy8lksdygkl4ycimvxqaj22oeekiclww6mc/${tokenId}.png`,
        name: `AppleSnake #${tokenId}`,
        openseaUrl: `https://opensea.io/assets/base/0xa85D49d8B7a041c339D18281a750dE3D7c15A628/${tokenId}`,
      };
    });

    // Sort by price ascending (cheapest first)
    transformedListings.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    return NextResponse.json({
      success: true,
      listings: transformedListings,
      total: transformedListings.length,
    });

  } catch (error) {
    console.error('OpenSea listings error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch listings',
        listings: [],
      },
      { status: 500 }
    );
  }
}
