import { NextRequest, NextResponse } from 'next/server';

// OpenSea API configuration
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';
const CHAIN = 'base';

// NFT contract address
const NFT_CONTRACT = '0xa85D49d8B7a041c339D18281a750dE3D7c15A628';

/**
 * POST /api/opensea/fulfill
 *
 * Gets fulfillment data from OpenSea to execute a buy transaction
 *
 * Request body:
 * {
 *   orderHash: string,
 *   protocolAddress: string,
 *   fulfillerAddress: string,
 *   tokenId?: string
 * }
 *
 * Returns the transaction data needed to fulfill the order on-chain
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderHash, protocolAddress, fulfillerAddress, tokenId } = body;

    // Validate required fields
    if (!orderHash || !protocolAddress || !fulfillerAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: orderHash, protocolAddress, fulfillerAddress' },
        { status: 400 }
      );
    }

    if (!OPENSEA_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'OpenSea API key not configured' },
        { status: 500 }
      );
    }

    console.log('[OpenSea Fulfill] Requesting fulfillment data:', {
      orderHash,
      protocolAddress,
      fulfillerAddress,
      tokenId,
    });

    // Build the request body for OpenSea's fulfillment endpoint
    const fulfillmentBody: {
      listing: {
        hash: string;
        chain: string;
        protocol_address: string;
      };
      fulfiller: {
        address: string;
      };
      consideration?: {
        asset_contract_address: string;
        token_id: string;
      };
    } = {
      listing: {
        hash: orderHash,
        chain: CHAIN,
        protocol_address: protocolAddress,
      },
      fulfiller: {
        address: fulfillerAddress,
      },
    };

    // Add consideration if token ID is provided (helps with specific token fulfillment)
    if (tokenId) {
      fulfillmentBody.consideration = {
        asset_contract_address: NFT_CONTRACT,
        token_id: tokenId.toString(),
      };
    }

    // Request fulfillment data from OpenSea
    const response = await fetch(`${OPENSEA_API_BASE}/listings/fulfillment_data`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': OPENSEA_API_KEY,
      },
      body: JSON.stringify(fulfillmentBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpenSea Fulfill] API error:', response.status, errorText);

      // Parse error if possible
      let errorMessage = `OpenSea API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.errors?.[0] || errorJson.detail || errorMessage;
      } catch {
        // Use default message
      }

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: response.status }
      );
    }

    const fulfillmentData = await response.json();
    console.log('[OpenSea Fulfill] Got fulfillment data:', JSON.stringify(fulfillmentData, null, 2));

    // The response contains the transaction data needed to fulfill the order
    // Structure: { fulfillment_data: { transaction: { to, value, data, ... } } }
    return NextResponse.json({
      success: true,
      fulfillmentData,
    });

  } catch (error) {
    console.error('[OpenSea Fulfill] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get fulfillment data' },
      { status: 500 }
    );
  }
}
