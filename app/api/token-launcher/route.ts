import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * GET /api/token-launcher
 * Proxy for launcher status check
 */
export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/token-launcher`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
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
    console.error('Error proxying token-launcher status:', error);
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
 * POST /api/token-launcher
 * Proxy for launch/upload actions
 * Supports both JSON and FormData
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let backendResponse: Response;

    if (contentType.includes('multipart/form-data')) {
      // Forward FormData as-is
      const formData = await request.formData();

      backendResponse = await fetch(`${API_BASE_URL}/api/token-launcher`, {
        method: 'POST',
        body: formData,
      });
    } else {
      // Forward JSON
      const body = await request.json();

      backendResponse = await fetch(`${API_BASE_URL}/api/token-launcher`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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
    console.error('Error proxying token-launcher action:', error);
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
