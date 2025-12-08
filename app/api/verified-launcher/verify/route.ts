import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';
const VERIFICATION_COST_USDC = 0.50;

/**
 * GET /api/verified-launcher/verify
 * Get verification requirements and status
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = new URL(`${API_BASE_URL}/api/verified-launcher/verify`);

    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (response.status === 402) {
      const paymentInfo = await response.json();
      return NextResponse.json(paymentInfo, { status: 402 });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, error: `Backend returned ${response.status}`, ...errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying verified-launcher verify GET:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}

/**
 * POST /api/verified-launcher/verify
 * Submit image for AI verification (requires $0.50 USDC payment)
 *
 * Payment flow:
 * 1. First request without payment → returns 402 with payment details
 * 2. Frontend pays USDC via direct transfer()
 * 3. Retry request with simple payment headers:
 *    - X-Payment-Amount: "0.50"
 *    - X-Payment-Tx-Hash: "0x..."
 *    - X-Payment-From: "0x..."
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    // Simple payment headers - forward directly to backend
    const xPaymentAmount = request.headers.get('x-payment-amount');
    const xPaymentTxHash = request.headers.get('x-payment-tx-hash');
    const xPaymentFrom = request.headers.get('x-payment-from');

    const headers: Record<string, string> = { 'Accept': 'application/json' };

    // Forward simple payment headers if present
    if (xPaymentAmount) headers['X-Payment-Amount'] = xPaymentAmount;
    if (xPaymentTxHash) headers['X-Payment-Tx-Hash'] = xPaymentTxHash;
    if (xPaymentFrom) headers['X-Payment-From'] = xPaymentFrom;

    console.log('[verify-proxy] Request details:', {
      contentType,
      hasPaymentAmount: !!xPaymentAmount,
      hasPaymentTxHash: !!xPaymentTxHash,
      hasPaymentFrom: !!xPaymentFrom,
      paymentAmount: xPaymentAmount,
      paymentTxHash: xPaymentTxHash ? xPaymentTxHash.slice(0, 20) + '...' : null,
    });

    let backendResponse: Response;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      console.log('[verify-proxy] Forwarding FormData to backend:', API_BASE_URL);

      backendResponse = await fetch(`${API_BASE_URL}/api/verified-launcher/verify`, {
        method: 'POST',
        headers,
        body: formData,
      });
    } else {
      const body = await request.json();
      console.log('[verify-proxy] Forwarding JSON to backend:', API_BASE_URL);
      backendResponse = await fetch(`${API_BASE_URL}/api/verified-launcher/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    }

    console.log('[verify-proxy] Backend response status:', backendResponse.status);

    // Handle 402 Payment Required
    if (backendResponse.status === 402) {
      const paymentInfo = await backendResponse.json().catch(() => null);
      console.log('[verify-proxy] 402 response from backend:', paymentInfo);

      return NextResponse.json(paymentInfo || {
        x402Version: 1,
        error: 'Payment required for image verification',
        accepts: [{
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: String(Math.floor(VERIFICATION_COST_USDC * 1_000_000)),
          resource: `${request.nextUrl.origin}/api/verified-launcher/verify`,
          description: 'AI Image Verification - $0.50 USDC',
          payTo: '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        }],
      }, {
        status: 402,
        headers: { 'X-402-Payment-Required': 'true' },
      });
    }

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, error: `Backend returned ${backendResponse.status}`, ...errorData },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying verified-launcher verify POST:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}
