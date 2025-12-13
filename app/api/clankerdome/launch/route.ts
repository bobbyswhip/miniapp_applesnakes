// app/api/clankerdome/launch/route.ts
// Proxy for Clankerdome launch operations with X402 payment support

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://api.applesnakes.com';

// GET - Fetch launches and stats (no payment needed)
export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Proxy] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}

// POST - Create launch (X402 payment required) or other actions
export async function POST(request: NextRequest) {
  try {
    // Check content type for form data vs JSON
    const contentType = request.headers.get('content-type') || '';
    const isFormData = contentType.includes('multipart/form-data');

    let body: FormData | string;
    const headers: HeadersInit = {};

    if (isFormData) {
      // Forward FormData as-is for file uploads
      body = await request.formData();
    } else {
      // JSON request
      body = JSON.stringify(await request.json());
      headers['Content-Type'] = 'application/json';
    }

    // Get the X-PAYMENT header if present (for X402 payment)
    const xPaymentHeader = request.headers.get('X-PAYMENT');
    if (xPaymentHeader) {
      headers['X-PAYMENT'] = xPaymentHeader;
    }

    console.log('[Proxy] POST to:', `${API_BASE_URL}/api/clankerdome/launch`);
    console.log('[Proxy] Has X-PAYMENT:', !!xPaymentHeader);
    console.log('[Proxy] Content-Type:', contentType);

    // Forward to production API
    const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
      method: 'POST',
      headers: isFormData ? { ...headers } : headers,
      body,
    });

    console.log('[Proxy] Response status:', response.status);

    // For 402 Payment Required, pass through the X-PAYMENT header
    if (response.status === 402) {
      const xPaymentResponse = response.headers.get('X-PAYMENT');
      console.log('[Proxy] Got 402, X-PAYMENT header:', xPaymentResponse ? 'present' : 'missing');

      let responseBody;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = { error: 'Payment required' };
      }

      const proxyResponse = NextResponse.json(responseBody, { status: 402 });

      if (xPaymentResponse) {
        proxyResponse.headers.set('X-PAYMENT', xPaymentResponse);
      }

      return proxyResponse;
    }

    // For other responses, pass through
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] POST Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
