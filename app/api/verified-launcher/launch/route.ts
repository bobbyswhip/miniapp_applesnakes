import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';
const MIN_DEV_BUY_USDC = 1.00;

/**
 * POST /api/verified-launcher/launch
 * Deploy token via Clanker SDK with WASS pairing (requires $1+ USDC payment)
 *
 * Payment flow:
 * 1. First request without payment → returns 402 with payment details
 * 2. Frontend pays USDC via direct transfer()
 * 3. Retry request with simple payment headers:
 *    - X-Payment-Amount: "5.00" (amount paid becomes dev buy budget)
 *    - X-Payment-Tx-Hash: "0x..."
 *    - X-Payment-From: "0x..."
 */
export async function POST(request: NextRequest) {
  try {
    // Simple payment headers - forward directly to backend
    const xPaymentAmount = request.headers.get('x-payment-amount');
    const xPaymentTxHash = request.headers.get('x-payment-tx-hash');
    const xPaymentFrom = request.headers.get('x-payment-from');

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    // Forward simple payment headers if present
    if (xPaymentAmount) headers['X-Payment-Amount'] = xPaymentAmount;
    if (xPaymentTxHash) headers['X-Payment-Tx-Hash'] = xPaymentTxHash;
    if (xPaymentFrom) headers['X-Payment-From'] = xPaymentFrom;

    console.log('[launch-proxy] Request details:', {
      hasPaymentAmount: !!xPaymentAmount,
      hasPaymentTxHash: !!xPaymentTxHash,
      hasPaymentFrom: !!xPaymentFrom,
      paymentAmount: xPaymentAmount,
      paymentTxHash: xPaymentTxHash ? xPaymentTxHash.slice(0, 20) + '...' : null,
    });

    const body = await request.json();
    const devBuyBudget = body.devBuyBudget || MIN_DEV_BUY_USDC;

    const backendResponse = await fetch(`${API_BASE_URL}/api/verified-launcher/launch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[launch-proxy] Backend response status:', backendResponse.status);

    // Handle 402 Payment Required
    if (backendResponse.status === 402) {
      const paymentInfo = await backendResponse.json().catch(() => null);

      return NextResponse.json(paymentInfo || {
        x402Version: 1,
        error: 'Payment required for token launch',
        accepts: [{
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: String(Math.floor(devBuyBudget * 1_000_000)),
          resource: `${request.nextUrl.origin}/api/verified-launcher/launch`,
          description: `Token Launch via Clanker - $${devBuyBudget.toFixed(2)} USDC`,
          payTo: '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        }],
      }, {
        status: 402,
        headers: { 'X-402-Payment-Required': 'true' },
      });
    }

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, error: `Backend returned ${backendResponse.status}`, ...errorData },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying verified-launcher launch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}
