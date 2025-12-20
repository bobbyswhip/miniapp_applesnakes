import { NextRequest, NextResponse } from 'next/server';

// Proxy API route for item-bridge fulfil endpoint
// Forwards requests to the production API server

const API_BASE = 'https://api.applesnakes.com';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE}/api/item-bridge/fulfil`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[item-bridge/fulfil proxy] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fulfil deposits via item-bridge API' },
      { status: 500 }
    );
  }
}
