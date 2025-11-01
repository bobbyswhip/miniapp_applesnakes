import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/notify
 *
 * Notification proxy endpoint for Base MiniKit.
 * This endpoint forwards notification requests to the Farcaster notification URL
 * to handle cross-origin request restrictions.
 *
 * Required for MiniKit notification-related hooks like useNotification.
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the incoming request body
    const body = await request.json();

    // Extract the notification URL from the body
    const { notificationUrl, ...notificationData } = body;

    if (!notificationUrl) {
      return NextResponse.json(
        { error: 'Missing notificationUrl in request body' },
        { status: 400 }
      );
    }

    // Forward the notification request to the Farcaster notification URL
    const response = await fetch(notificationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(notificationData),
    });

    // Check if the notification was successful
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Notification failed:', errorText);
      return NextResponse.json(
        { error: 'Failed to send notification', details: errorText },
        { status: response.status }
      );
    }

    // Return success response
    const responseData = await response.json();
    return NextResponse.json(responseData, { status: 200 });
  } catch (error) {
    console.error('Error in notification proxy:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
