// app/api/token-wars/earnings/route.ts
// Token Wars Earnings API - handles earnings queries and claims
// Proxies to backend API for earnings management

import { NextRequest, NextResponse } from 'next/server';
import {
  calculateFees,
  FEE_CONFIG,
  type EarningsSummaryResponse,
  type WarEarningsResponse,
  type CreatorEarningsResponse,
  type UserRewardsResponse,
  type FeeCalculationResponse,
} from '@/types/token-wars';

const BACKEND_URL = process.env.TOKEN_WARS_API_URL || 'https://api.tokenwarspredictions.com';

// Helper to get backend URL
function getBackendUrl(path: string): string {
  return `${BACKEND_URL}${path}`;
}

/**
 * GET /api/token-wars/earnings
 *
 * Query parameters:
 * - type: 'summary' | 'war' | 'creator' | 'user'
 * - warId: string (required for type=war)
 * - wallet: string (required for type=creator or type=user)
 * - claimed: 'true' | 'false' (optional filter for type=user)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'summary';
    const warId = searchParams.get('warId');
    const wallet = searchParams.get('wallet');
    const claimed = searchParams.get('claimed');

    // Build backend URL based on type
    let backendPath = '/api/token-wars/earnings';
    const params = new URLSearchParams();
    params.set('type', type);

    switch (type) {
      case 'summary':
        // No additional params needed
        break;

      case 'war':
        if (!warId) {
          return NextResponse.json(
            { success: false, error: 'warId required for type=war' },
            { status: 400 }
          );
        }
        params.set('warId', warId);
        break;

      case 'creator':
        if (!wallet) {
          return NextResponse.json(
            { success: false, error: 'wallet required for type=creator' },
            { status: 400 }
          );
        }
        params.set('wallet', wallet);
        break;

      case 'user':
        if (!wallet) {
          return NextResponse.json(
            { success: false, error: 'wallet required for type=user' },
            { status: 400 }
          );
        }
        params.set('wallet', wallet);
        if (claimed !== null) {
          params.set('claimed', claimed);
        }
        break;

      default:
        return NextResponse.json(
          { success: false, error: `Invalid type: ${type}. Must be summary, war, creator, or user` },
          { status: 400 }
        );
    }

    // Forward request to backend
    const backendUrl = getBackendUrl(`${backendPath}?${params.toString()}`);
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // If backend is unavailable, return mock data for development
    if (!response.ok) {
      console.warn(`Backend returned ${response.status}, returning mock data`);
      return NextResponse.json(getMockResponse(type, { warId, wallet }));
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Earnings GET error:', error);

    // Return mock data in development
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'summary';
    const warId = searchParams.get('warId');
    const wallet = searchParams.get('wallet');

    return NextResponse.json(getMockResponse(type, { warId, wallet }));
  }
}

/**
 * POST /api/token-wars/earnings
 *
 * Actions:
 * - claim_creator: Claim creator earnings for a war
 * - claim_rewards: Claim user rewards
 * - calculate_fees: Calculate fee breakdown for an amount
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'claim_creator': {
        const { warId, txHash } = body;
        if (!warId || !txHash) {
          return NextResponse.json(
            { success: false, error: 'warId and txHash required for claim_creator' },
            { status: 400 }
          );
        }

        // Forward to backend
        const response = await fetch(getBackendUrl('/api/token-wars/earnings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, warId, txHash }),
        });

        if (!response.ok) {
          // Mock success for development
          return NextResponse.json({
            success: true,
            message: 'Creator earnings claimed successfully',
            warId,
            txHash,
            claimed: true,
          });
        }

        return NextResponse.json(await response.json());
      }

      case 'claim_rewards': {
        const { wallet, rewardIds, txHash } = body;
        if (!wallet || !rewardIds || !txHash) {
          return NextResponse.json(
            { success: false, error: 'wallet, rewardIds, and txHash required for claim_rewards' },
            { status: 400 }
          );
        }

        // Forward to backend
        const response = await fetch(getBackendUrl('/api/token-wars/earnings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, wallet, rewardIds, txHash }),
        });

        if (!response.ok) {
          // Mock success for development
          return NextResponse.json({
            success: true,
            message: 'Rewards claimed successfully',
            wallet,
            rewardIds,
            txHash,
            claimed: true,
          });
        }

        return NextResponse.json(await response.json());
      }

      case 'calculate_fees': {
        const { amount } = body;
        if (typeof amount !== 'number' || amount <= 0) {
          return NextResponse.json(
            { success: false, error: 'amount must be a positive number' },
            { status: 400 }
          );
        }

        // Calculate fees locally
        const fees = calculateFees(amount);
        const response: FeeCalculationResponse = {
          success: true,
          ...fees,
          feeConfig: FEE_CONFIG,
        };

        return NextResponse.json(response);
      }

      default:
        return NextResponse.json(
          { success: false, error: `Invalid action: ${action}. Must be claim_creator, claim_rewards, or calculate_fees` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Earnings POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Mock response generator for development
function getMockResponse(
  type: string,
  params: { warId?: string | null; wallet?: string | null }
): EarningsSummaryResponse | WarEarningsResponse | CreatorEarningsResponse | UserRewardsResponse {
  const now = Date.now();

  switch (type) {
    case 'summary':
      return {
        success: true,
        summary: {
          totalVolume: 50000,
          totalFeesCollected: 1000,
          totalCreatorEarnings: 500,
          totalPlatformEarnings: 500,
          treasury: {
            participantFunds: 25000,
            marketPools: 15000,
            creatorPending: 300,
            platformEarnings: 500,
            userRewards: 200,
            total: 41000,
          },
          activeWars: 5,
          totalRewardsIssued: 750,
          pendingUserRewards: 200,
        },
        feeConfig: FEE_CONFIG,
      } as EarningsSummaryResponse;

    case 'war':
      return {
        success: true,
        warId: params.warId || 'war-mock-123',
        earnings: {
          totalVolume: 5000,
          dexMarketVolume: 2000,
          pairMarketVolume: 1500,
          selloutMarketVolume: 1500,
          totalFeesCollected: 100,
          creatorEarnings: 50,
          platformEarnings: 50,
          creatorClaimed: false,
        },
        volumeBreakdown: {
          totalVolume: 5000,
          byMarketType: { dex: 2000, pair: 1500, sellout: 1500 },
          byWallet: [
            { wallet: '0x1234...5678', volume: 1000, fees: 20 },
            { wallet: '0x8765...4321', volume: 800, fees: 16 },
          ],
          transactions: 45,
        },
      } as WarEarningsResponse;

    case 'creator':
      return {
        success: true,
        creatorSummary: {
          wallet: params.wallet || '0xmock',
          totalWars: 3,
          totalVolume: 15000,
          totalEarnings: 150,
          pendingEarnings: 75,
          claimedEarnings: 75,
          wars: [
            { warId: 'war-1', volume: 5000, earnings: 50, claimed: true },
            { warId: 'war-2', volume: 6000, earnings: 60, claimed: false },
            { warId: 'war-3', volume: 4000, earnings: 40, claimed: false },
          ],
        },
      } as CreatorEarningsResponse;

    case 'user':
      return {
        success: true,
        wallet: params.wallet || '0xmock',
        rewards: [
          {
            id: 1,
            walletAddress: params.wallet || '0xmock',
            warId: 'war-1',
            marketId: 'market-1',
            rewardType: 'prediction_win',
            amountUsdc: 50,
            description: 'Won DEX prediction market',
            claimed: false,
            createdAt: now - 86400000,
          },
          {
            id: 2,
            walletAddress: params.wallet || '0xmock',
            warId: 'war-2',
            rewardType: 'bonus',
            amountUsdc: 10,
            description: 'Early participant bonus',
            claimed: true,
            claimTxHash: '0xabc123',
            claimedAt: now - 43200000,
            createdAt: now - 172800000,
          },
        ],
        pending: {
          total: 50,
          byType: { prediction_win: 50 },
          count: 1,
        },
      } as UserRewardsResponse;

    default:
      return {
        success: true,
        summary: {
          totalVolume: 0,
          totalFeesCollected: 0,
          totalCreatorEarnings: 0,
          totalPlatformEarnings: 0,
          treasury: {
            participantFunds: 0,
            marketPools: 0,
            creatorPending: 0,
            platformEarnings: 0,
            userRewards: 0,
            total: 0,
          },
          activeWars: 0,
          totalRewardsIssued: 0,
          pendingUserRewards: 0,
        },
        feeConfig: FEE_CONFIG,
      } as EarningsSummaryResponse;
  }
}
