// app/api/token-wars/admin/route.ts
// Admin API for Token Wars - test features and war management

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://api.applesnakes.com';

/**
 * PATCH /api/token-wars/admin
 *
 * Actions:
 * - set_test_timer: Sets war to end in 5 seconds for rapid testing
 * - set_end_time: Sets a custom end time for the war
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, warId, endsAt } = body;

    // Validate required fields
    if (!action) {
      return NextResponse.json(
        { success: false, error: 'action is required' },
        { status: 400 }
      );
    }

    if (!warId) {
      return NextResponse.json(
        { success: false, error: 'warId is required' },
        { status: 400 }
      );
    }

    // Validate action type
    if (!['set_test_timer', 'set_end_time'].includes(action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action: ${action}. Must be set_test_timer or set_end_time` },
        { status: 400 }
      );
    }

    // For set_end_time, validate endsAt
    if (action === 'set_end_time' && typeof endsAt !== 'number') {
      return NextResponse.json(
        { success: false, error: 'endsAt timestamp is required for set_end_time action' },
        { status: 400 }
      );
    }

    console.log('[TokenWarsAdmin] PATCH action:', action, 'warId:', warId);

    // Forward to backend API
    const response = await fetch(`${API_BASE_URL}/api/token-wars/admin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log('[TokenWarsAdmin] Response:', JSON.stringify(data));

    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[TokenWarsAdmin] PATCH Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Admin API error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/token-wars/admin
 *
 * Returns admin status/info (can be extended for admin dashboard)
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Token Wars Admin API',
    actions: [
      {
        action: 'set_test_timer',
        description: 'Sets war to end in 5 seconds for rapid testing',
        method: 'PATCH',
        required: ['warId'],
      },
      {
        action: 'set_end_time',
        description: 'Sets a custom end time for the war',
        method: 'PATCH',
        required: ['warId', 'endsAt'],
      },
    ],
  });
}
