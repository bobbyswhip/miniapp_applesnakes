import { NextRequest, NextResponse } from 'next/server';

// Proxy API route for item-bridge fee endpoint
// Forwards requests to the production API server

const API_BASE = 'https://api.applesnakes.com';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const count = searchParams.get('count') || '1';

  try {
    const response = await fetch(`${API_BASE}/api/item-bridge/fee?count=${count}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[item-bridge/fee proxy] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch fee from item-bridge API' },
      { status: 500 }
    );
  }
}
