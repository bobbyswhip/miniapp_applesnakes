import { NextRequest, NextResponse } from 'next/server';

// Proxy API route for item-bridge to avoid CORS issues during local development
// Forwards requests to the production API server

const API_BASE = 'https://api.applesnakes.com';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const address = searchParams.get('address');

  // Build the target URL with query params
  const targetUrl = new URL(`${API_BASE}/api/item-bridge`);
  if (action) targetUrl.searchParams.set('action', action);
  if (address) targetUrl.searchParams.set('address', address);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[item-bridge proxy] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch from item-bridge API' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE}/api/item-bridge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[item-bridge proxy] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to post to item-bridge API' },
      { status: 500 }
    );
  }
}
