// app/api/prediction-market/sell/verified/route.ts
// Proxy for prediction market sell endpoint
// Supports both GET (check status) and POST (sell shares)

import { NextRequest, NextResponse } from 'next/server';

// Prediction Markets API
const API_BASE_URL = 'https://api.applesnakes.com';

/**
 * GET /api/prediction-market/sell/verified
 * Check if user can sell and get their positions
 * Query params: wallet, marketId (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const marketId = searchParams.get('marketId');

    if (!wallet) {
      return NextResponse.json(
        { success: false, error: 'wallet parameter is required' },
        { status: 400 }
      );
    }

    // Build query string for upstream
    const params = new URLSearchParams({ wallet });
    if (marketId) params.set('marketId', marketId);

    const url = `${API_BASE_URL}/api/prediction-market/sell/verified?${params}`;
    console.log('[Proxy] Fetching sell status from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Sell status error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prediction-market/sell/verified
 * Sell shares in a prediction market
 * Body: { marketId, outcomeIndex, side, sharesToSell, walletAddress }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { marketId, outcomeIndex, side, sharesToSell, walletAddress } = body;

    // Validate required fields
    if (!marketId || outcomeIndex === undefined || !side || !sharesToSell || !walletAddress) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: marketId, outcomeIndex, side, sharesToSell, walletAddress'
        },
        { status: 400 }
      );
    }

    console.log('[Proxy] Forwarding sell request to:', `${API_BASE_URL}/api/prediction-market/sell/verified`);
    console.log('[Proxy] Body:', JSON.stringify(body));

    const response = await fetch(`${API_BASE_URL}/api/prediction-market/sell/verified`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    console.log('[Proxy] Response status:', response.status);

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Sell error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
