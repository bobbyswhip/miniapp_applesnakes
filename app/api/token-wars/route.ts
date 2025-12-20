// app/api/token-wars/route.ts
// Proxy for Token Wars list endpoint - avoids CORS by proxying server-side

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://api.applesnakes.com';

/**
 * GET /api/token-wars
 *
 * Query params (forwarded to backend):
 * - status: Filter by status (active, launching, launched, failed, cancelled)
 * - all: Include all wars (not just active)
 * - wallet: Filter by creator wallet
 * - limit: Max results (default 20)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Forward all query params to backend
    const backendUrl = new URL(`${API_BASE_URL}/api/token-wars`);
    searchParams.forEach((value, key) => {
      backendUrl.searchParams.set(key, value);
    });

    console.log('[TokenWarsProxy] GET:', backendUrl.toString());

    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Don't cache - we want fresh data
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[TokenWarsProxy] Backend error:', response.status);
      return NextResponse.json(
        { success: false, error: `Backend returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[TokenWarsProxy] Success, wars:', data.wars?.length || 0);

    return NextResponse.json(data);
  } catch (error) {
    console.error('[TokenWarsProxy] GET Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/token-wars
 *
 * Create a new token war (proxies to backend with X402 payment)
 */
export async function POST(request: NextRequest) {
  try {
    // Check content type - could be JSON or FormData
    const contentType = request.headers.get('content-type') || '';

    const headers: HeadersInit = {};

    // Forward X-PAYMENT header if present
    const xPaymentHeader = request.headers.get('X-PAYMENT');
    if (xPaymentHeader) {
      headers['X-PAYMENT'] = xPaymentHeader;
    }

    let body: BodyInit;

    if (contentType.includes('multipart/form-data')) {
      // FormData - pass through
      body = await request.formData();
    } else {
      // JSON
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(await request.json());
    }

    console.log('[TokenWarsProxy] POST to:', `${API_BASE_URL}/api/token-wars`);
    console.log('[TokenWarsProxy] Has X-PAYMENT:', !!xPaymentHeader);

    const response = await fetch(`${API_BASE_URL}/api/token-wars`, {
      method: 'POST',
      headers,
      body,
    });

    console.log('[TokenWarsProxy] Response status:', response.status);

    // For 402 Payment Required, pass through the body with payment requirements
    if (response.status === 402) {
      let responseBody;
      try {
        responseBody = await response.json();
        console.log('[TokenWarsProxy] 402 response body:', JSON.stringify(responseBody));
      } catch {
        responseBody = { error: 'Payment required', accepts: [] };
      }
      return NextResponse.json(responseBody, { status: 402 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[TokenWarsProxy] POST Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
