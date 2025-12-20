// app/api/prediction-market/claim/route.ts
// Proxy for claiming prediction market winnings

import { NextRequest, NextResponse } from 'next/server';

// Prediction Markets API
const API_BASE_URL = 'https://api.applesnakes.com';

export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const marketId = searchParams.get('marketId');

    const queryParts: string[] = [];
    if (wallet) queryParts.push(`wallet=${wallet}`);
    if (marketId) queryParts.push(`marketId=${marketId}`);

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

    console.log('[Proxy] Fetching claimable amounts:', queryString);

    // Forward to production API
    const response = await fetch(
      `${API_BASE_URL}/api/prediction-market/claim${queryString}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[Proxy] Response status:', response.status);

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Error fetching claimable:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the request body
    const body = await request.json();

    console.log('[Proxy] Claiming winnings:', JSON.stringify(body));

    // Forward to production API
    const response = await fetch(`${API_BASE_URL}/api/prediction-market/claim`, {
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
    console.error('[Proxy] Error claiming winnings:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
