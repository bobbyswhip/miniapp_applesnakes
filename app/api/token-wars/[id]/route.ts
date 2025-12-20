// app/api/token-wars/[id]/route.ts
// Proxy for Token Wars individual war endpoint - avoids CORS by proxying server-side

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'https://api.applesnakes.com';

/**
 * GET /api/token-wars/[id]
 *
 * Query params (forwarded to backend):
 * - participants: Include all participants (true/false)
 * - wallet: Get wallet-specific info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    // Build backend URL with query params
    const backendUrl = new URL(`${API_BASE_URL}/api/token-wars/${id}`);
    searchParams.forEach((value, key) => {
      backendUrl.searchParams.set(key, value);
    });

    console.log('[TokenWarsProxy] GET war:', backendUrl.toString());

    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[TokenWarsProxy] Backend error:', response.status);
      return NextResponse.json(
        { success: false, error: `Backend returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[TokenWarsProxy] War fetched:', data.war?.id || data.launch?.id);

    // Transform participants array to match frontend expectations
    // Backend returns: { participants: [...] }
    // Frontend expects: { topContributors: [...], allParticipants: [...] }
    if (data.participants && Array.isArray(data.participants)) {
      // Sort by totalUsdc descending and add rank
      const sortedParticipants = [...data.participants]
        .sort((a, b) => (b.totalUsdc || 0) - (a.totalUsdc || 0))
        .map((p, index) => ({
          rank: index + 1,
          wallet: p.wallet ? `${p.wallet.slice(0, 6)}...${p.wallet.slice(-4)}` : 'Unknown',
          fullWallet: p.wallet || '',
          totalUsdc: p.totalUsdc || 0,
          sharePercent: p.sharePercent || 0,
          buyCount: p.buyCount || 0,
          estimatedTokens: 0, // Calculated later
          votes: p.votes || {},
        }));

      // Top 10 as topContributors
      data.topContributors = sortedParticipants.slice(0, 10);
      // All as allParticipants
      data.allParticipants = sortedParticipants;

      // Calculate stats
      const totalContributions = sortedParticipants.reduce((sum, p) => sum + p.totalUsdc, 0);
      data.stats = {
        totalParticipants: sortedParticipants.length,
        averageContribution: sortedParticipants.length > 0 ? totalContributions / sortedParticipants.length : 0,
        largestContribution: sortedParticipants[0]?.totalUsdc || 0,
      };

      console.log('[TokenWarsProxy] Transformed participants:', sortedParticipants.length);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[TokenWarsProxy] GET war Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
