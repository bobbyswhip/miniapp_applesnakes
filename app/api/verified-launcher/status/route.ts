import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * GET /api/verified-launcher/status
 * Poll for launch completion status
 *
 * Query params: queueId
 *
 * Response:
 * {
 *   status: 'pending' | 'deploying' | 'complete' | 'failed',
 *   contractAddress?: string, // Only when complete
 *   error?: string // Only when failed
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queueId = searchParams.get('queueId');

    if (!queueId) {
      return NextResponse.json(
        { success: false, error: 'queueId is required' },
        { status: 400 }
      );
    }

    const url = new URL(`${API_BASE_URL}/api/verified-launcher/status`);
    url.searchParams.set('queueId', queueId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

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
    console.error('Error proxying verified-launcher status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}
