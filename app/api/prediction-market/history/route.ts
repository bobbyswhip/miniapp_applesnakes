// app/api/prediction-market/history/route.ts
// Proxy for prediction market transaction history endpoint

import { NextRequest, NextResponse } from 'next/server';

// Prediction Markets API
const API_BASE_URL = 'https://api.applesnakes.com';

/**
 * GET /api/prediction-market/history
 * Get transaction history for a wallet or market
 * Query params:
 *   - wallet: Filter by wallet address (required if no marketId)
 *   - marketId: Filter by market ID (required if no wallet)
 *   - limit: Max results (default: 100)
 *   - action: Filter by action type (buy, sell, seed, claim, refund)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const marketId = searchParams.get('marketId');
    const limit = searchParams.get('limit');
    const action = searchParams.get('action');

    // At least one of wallet or marketId is required
    if (!wallet && !marketId) {
      return NextResponse.json(
        { success: false, error: 'Either wallet or marketId parameter is required' },
        { status: 400 }
      );
    }

    // Build query string for upstream
    const params = new URLSearchParams();
    if (wallet) params.set('wallet', wallet);
    if (marketId) params.set('marketId', marketId);
    if (limit) params.set('limit', limit);
    if (action) params.set('action', action);

    const url = `${API_BASE_URL}/api/prediction-market/history?${params}`;
    console.log('[Proxy] Fetching history from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('[Proxy] History error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
