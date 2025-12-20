// app/api/prediction-market/route.ts
// Proxy for fetching prediction markets to avoid CORS issues

import { NextRequest, NextResponse } from 'next/server';

// Prediction Markets API
const API_BASE_URL = 'https://api.applesnakes.com';

export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const relatedId = searchParams.get('relatedId');

    if (!relatedId) {
      return NextResponse.json(
        { success: false, error: 'relatedId parameter is required' },
        { status: 400 }
      );
    }

    console.log('[Proxy] Fetching markets for relatedId:', relatedId);

    // Forward to production API
    const response = await fetch(
      `${API_BASE_URL}/api/prediction-market?relatedId=${relatedId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[Proxy] Response status:', response.status);

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] Error fetching markets:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
