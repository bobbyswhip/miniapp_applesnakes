// app/api/clankerdome/buy/route.ts
// Proxy for Clankerdome consensus buy operations with X402 payment support

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://api.applesnakes.com';

// GET - Fetch launch details with consensus data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const launchId = searchParams.get('launchId');

    if (!launchId) {
      return NextResponse.json(
        { error: 'launchId is required' },
        { status: 400 }
      );
    }

    console.log('[BuyProxy] GET launch:', launchId);

    const response = await fetch(
      `${API_BASE_URL}/api/clankerdome/buy?launchId=${launchId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const data = await response.json();
    console.log('[BuyProxy] GET response:', JSON.stringify(data));
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[BuyProxy] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}

// POST - Buy into presale with protocol vote (X402 payment required)
// Two-step flow:
// 1. Initial POST without X-PAYMENT -> Returns 402 with payment requirements in body
// 2. Retry POST with X-PAYMENT header -> Returns success/error
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Get the X-PAYMENT header if present (for step 2)
    const xPaymentHeader = request.headers.get('X-PAYMENT');
    if (xPaymentHeader) {
      headers['X-PAYMENT'] = xPaymentHeader;
    }

    console.log('[BuyProxy] POST to:', `${API_BASE_URL}/api/clankerdome/buy`);
    console.log('[BuyProxy] Has X-PAYMENT:', !!xPaymentHeader);
    console.log('[BuyProxy] Body:', JSON.stringify(body));

    // Forward to production API
    const response = await fetch(`${API_BASE_URL}/api/clankerdome/buy`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[BuyProxy] Response status:', response.status);

    // For 402 Payment Required, pass through the body with payment requirements
    if (response.status === 402) {
      let responseBody;
      try {
        responseBody = await response.json();
        console.log('[BuyProxy] 402 response body:', JSON.stringify(responseBody));
      } catch {
        responseBody = { error: 'Payment required', accepts: [] };
      }

      // Return the 402 response with accepts array in body
      return NextResponse.json(responseBody, { status: 402 });
    }

    // For other responses, pass through
    const data = await response.json();
    console.log('[BuyProxy] Response data:', JSON.stringify(data));
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[BuyProxy] POST Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
