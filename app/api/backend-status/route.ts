import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * GET /api/backend-status
 *
 * Proxy endpoint for the AppleSnakes backend status API.
 * This avoids CORS issues when fetching from the browser.
 *
 * Query params:
 *   - providers: comma-separated list of providers to fetch (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providers = searchParams.get('providers');

    let url = `${API_BASE_URL}/api/status`;
    if (providers) {
      url += `?providers=${providers}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // Don't cache - we want real-time status
      cache: 'no-store',
    });

    // Forward rate limit headers from backend
    const headers = new Headers();
    const rateLimitHeaders = [
      'X-RateLimit-Limit-Second',
      'X-RateLimit-Limit-Minute',
      'X-RateLimit-Remaining-Second',
      'X-RateLimit-Remaining-Minute',
      'Retry-After',
    ];

    rateLimitHeaders.forEach((header) => {
      const value = response.headers.get(header);
      if (value) {
        headers.set(header, value);
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          success: false,
          error: `Backend returned ${response.status}`,
          ...errorData
        },
        { status: response.status, headers }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200, headers });

  } catch (error) {
    console.error('Error proxying backend status:', error);
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
