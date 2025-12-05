import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * GET /api/nft-cache
 * Proxy for cached NFT data from the wTokens contract
 * Returns pre-cached NFT metadata, token info, and images
 * Rate limited: 1 request per minute per IP
 */
export async function GET(request: NextRequest) {
  try {
    // Forward client IP for rate limiting
    const clientIP = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    const response = await fetch(`${API_BASE_URL}/api/nft-cache`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Forwarded-For': clientIP,
      },
      cache: 'no-store',
    });

    // Handle rate limiting
    if (response.status === 429) {
      const errorData = await response.json();
      return NextResponse.json(errorData, {
        status: 429,
        headers: {
          'Retry-After': String(errorData.retryAfter || 60),
        },
      });
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

    // Forward rate limit headers from backend
    const headers: Record<string, string> = {};
    const rateLimitHeaders = [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ];

    rateLimitHeaders.forEach(header => {
      const value = response.headers.get(header);
      if (value) headers[header] = value;
    });

    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error('Error proxying nft-cache:', error);
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
 * POST /api/nft-cache
 * Admin endpoint to force refresh or get status
 * Body: { "action": "refresh" | "status" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/nft-cache`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

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
    console.error('Error proxying nft-cache POST:', error);
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
