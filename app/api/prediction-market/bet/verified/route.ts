// app/api/prediction-market/bet/verified/route.ts
// Proxy for prediction market verified betting endpoint (EIP-3009)
// Supports both GET (market info) and POST (place bet)

import { NextRequest, NextResponse } from 'next/server';

// Prediction Markets API
const API_BASE_URL = 'https://api.applesnakes.com';

/**
 * GET /api/prediction-market/bet/verified
 * Get market info and odds for betting UI
 * Query params: marketId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');

    if (!marketId) {
      return NextResponse.json(
        { success: false, error: 'marketId parameter is required' },
        { status: 400 }
      );
    }

    const url = `${API_BASE_URL}/api/prediction-market/bet/verified?marketId=${encodeURIComponent(marketId)}`;
    console.log('[Proxy] Fetching market info from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Market info error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prediction-market/bet/verified
 * Place a bet using EIP-3009 payment authorization
 */
export async function POST(request: NextRequest) {
  try {
    // Get the request body
    const body = await request.json();

    // Get the X-PAYMENT header (required for EIP-3009 payment)
    const xPaymentHeader = request.headers.get('X-PAYMENT');

    if (!xPaymentHeader) {
      return NextResponse.json(
        { success: false, error: 'X-PAYMENT header is required' },
        { status: 400 }
      );
    }

    // Build headers for the upstream request
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-PAYMENT': xPaymentHeader,
    };

    console.log('[Proxy] Forwarding verified bet request to:', `${API_BASE_URL}/api/prediction-market/bet/verified`);
    console.log('[Proxy] Body:', JSON.stringify(body));

    // Forward to production API
    const response = await fetch(`${API_BASE_URL}/api/prediction-market/bet/verified`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[Proxy] Response status:', response.status);

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Verified bet error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
