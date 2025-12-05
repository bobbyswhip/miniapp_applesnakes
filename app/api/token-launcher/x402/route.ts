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
 * Flow:
 * 1. Initial POST without X-PAYMENT header -> returns 402 with payment requirements
 * 2. Retry POST with X-PAYMENT header containing signed EIP-3009 authorization
 * 3. Backend verifies and executes payment, then launches token
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const xPaymentHeader = request.headers.get('x-payment');

    let backendResponse: Response;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Forward the X-PAYMENT header if present (contains signed EIP-3009 authorization)
    if (xPaymentHeader) {
      headers['X-PAYMENT'] = xPaymentHeader;
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
      const paymentInfo = await backendResponse.json();
      return NextResponse.json(paymentInfo, {
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
