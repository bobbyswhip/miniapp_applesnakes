// app/api/prediction-market/bet/route.ts
// Proxy for prediction market betting to avoid CORS issues

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://api.applesnakes.com';

export async function POST(request: NextRequest) {
  try {
    // Get the request body
    const body = await request.json();

    // Get the X-PAYMENT header if present (for retry with payment)
    const xPaymentHeader = request.headers.get('X-PAYMENT');

    // Build headers for the upstream request
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (xPaymentHeader) {
      headers['X-PAYMENT'] = xPaymentHeader;
    }

    console.log('[Proxy] Forwarding bet request to:', `${API_BASE_URL}/api/prediction-market/bet`);
    console.log('[Proxy] Body:', JSON.stringify(body));
    console.log('[Proxy] Has X-PAYMENT:', !!xPaymentHeader);

    // Forward to production API
    const response = await fetch(`${API_BASE_URL}/api/prediction-market/bet`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[Proxy] Response status:', response.status);

    // For 402 Payment Required, we need to pass through the X-PAYMENT header
    if (response.status === 402) {
      const xPaymentResponse = response.headers.get('X-PAYMENT');
      console.log('[Proxy] Got 402, X-PAYMENT header:', xPaymentResponse ? 'present' : 'missing');

      // Try to get the body too
      let responseBody;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = { error: 'Payment required' };
      }

      // Create response with the X-PAYMENT header
      const proxyResponse = NextResponse.json(responseBody, { status: 402 });

      if (xPaymentResponse) {
        proxyResponse.headers.set('X-PAYMENT', xPaymentResponse);
      }

      return proxyResponse;
    }

    // For other responses, just pass through
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
