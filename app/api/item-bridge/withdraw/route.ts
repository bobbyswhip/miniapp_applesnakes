import { NextRequest, NextResponse } from 'next/server';

// Proxy API route for item-bridge withdraw endpoint
// Forwards requests to the production API server
// v1.02: Withdrawal is direct NFT transfer from backend wallet to user

const API_BASE = 'https://api.applesnakes.com';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE}/api/item-bridge/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[item-bridge/withdraw proxy] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to withdraw via item-bridge API' },
      { status: 500 }
    );
  }
}
