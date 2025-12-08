import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * GET /api/token-launcher/x402
 * Proxy for x402 launcher status check and USDC balance queries
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = new URL(`${API_BASE_URL}/api/token-launcher/x402`);

    // Forward all query params
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    // Handle 402 - pass through to client
    if (response.status === 402) {
      const paymentInfo = await response.json();
      return NextResponse.json(paymentInfo, { status: 402 });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          success: false,
          error: `Backend returned ${response.status}`,
          ...errorData,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying x402 token-launcher status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to connect to backend',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    );
  }
}

/**
 * POST /api/token-launcher/x402
 * Proxy for x402 token launch with USDC payment
 *
 * Payment methods:
 * 1. X-PAYMENT header (EIP-3009 signed authorization) - traditional x402
 * 2. X-PAYMENT-TX header (direct USDC transfer tx hash) - miniapp compatible
 *
 * Flow:
 * 1. Initial POST without payment header -> returns 402 with payment requirements
 * 2. Retry POST with payment proof header
 * 3. Backend verifies and executes payment, then launches token
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const xPaymentHeader = request.headers.get('x-payment');
    const xPaymentTxHeader = request.headers.get('x-payment-tx');
    const xPaymentPayerHeader = request.headers.get('x-payment-payer');

    let backendResponse: Response;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Support both payment methods
    if (xPaymentHeader) {
      // Traditional x402 EIP-3009 signed authorization
      headers['X-PAYMENT'] = xPaymentHeader;
    } else if (xPaymentTxHeader && xPaymentPayerHeader) {
      // Direct USDC transfer (miniapp compatible)
      headers['X-PAYMENT-TX'] = xPaymentTxHeader;
      headers['X-PAYMENT-PAYER'] = xPaymentPayerHeader;
    }

    if (contentType.includes('multipart/form-data')) {
      // Forward FormData as-is
      const formData = await request.formData();

      backendResponse = await fetch(`${API_BASE_URL}/api/token-launcher/x402`, {
        method: 'POST',
        headers: {
          // Don't set Content-Type for FormData - browser/fetch sets it with boundary
          ...headers,
        },
        body: formData,
      });
    } else {
      // Forward JSON
      const body = await request.json();

      backendResponse = await fetch(`${API_BASE_URL}/api/token-launcher/x402`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      });
    }

    // Handle 402 Payment Required - pass through to client with payment info
    if (backendResponse.status === 402) {
      const paymentInfo = await backendResponse.json().catch(() => null);

      // Return standard x402 402 response
      // CRITICAL: Must include `extra` with name/version for EIP-712 domain signing
      return NextResponse.json(paymentInfo || {
        x402Version: 1,
        error: 'Payment required for token launch',
        accepts: [{
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '1000000', // $1.00 USDC minimum
          resource: `${request.nextUrl.origin}/api/token-launcher/x402`,
          description: 'Token Launch - $1.00 USDC minimum',
          payTo: process.env.RESOURCE_WALLET_ADDRESS || '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
          maxTimeoutSeconds: 3600,
          // CRITICAL: EIP-712 domain info for USDC on Base
          extra: {
            name: 'USD Coin',
            version: '2',
          },
        }],
      }, {
        status: 402,
        headers: {
          'X-402-Payment-Required': 'true',
        },
      });
    }

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      return NextResponse.json(
        {
          success: false,
          error: `Backend returned ${backendResponse.status}`,
          ...errorData,
        },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying x402 token-launcher action:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to connect to backend',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    );
  }
}
