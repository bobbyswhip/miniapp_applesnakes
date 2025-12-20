// app/api/preview/route.ts
// Proxy for the Preview API to avoid CORS issues
import { NextRequest, NextResponse } from 'next/server';

const PREVIEW_API = 'https://api.applesnakes.com/api/preview';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('[preview proxy] Forwarding request with traits:', Object.keys(body.traits || {}));

    const response = await fetch(PREVIEW_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[preview proxy] API error:', response.status, errorText);
      return NextResponse.json(
        { success: false, error: `Preview API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    console.log('[preview proxy] Success, image length:', data.image?.length || 0);

    return NextResponse.json(data);
  } catch (error) {
    console.error('[preview proxy] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Preview failed' },
      { status: 500 }
    );
  }
}
