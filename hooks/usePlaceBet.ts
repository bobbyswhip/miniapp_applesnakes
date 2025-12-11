// hooks/usePlaceBet.ts
'use client';

import { useCallback, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import type { BetResult } from '@/types/clankerdome';

// Use local API proxy to avoid CORS issues
// The proxy forwards to https://api.applesnakes.com
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

interface PlaceBetParams {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  amountUsdc: number;  // Amount in dollars (e.g., 5.00)
}

export function usePlaceBet() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBet = useCallback(async (params: PlaceBetParams): Promise<BetResult | null> => {
    if (!address) {
      setError('Connect wallet first');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Get payment requirements from 402 response
      console.log('[PlaceBet] Step 1: Requesting payment requirements...', params);
      const initialResponse = await fetch('/api/prediction-market/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: params.marketId,
          outcomeIndex: params.outcomeIndex,
          side: params.side,
        }),
      });

      console.log('[PlaceBet] Initial response status:', initialResponse.status);

      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (!initialResponse.ok) throw new Error(data.error || 'Request failed');
        // Already paid or no payment needed
        return data;
      }

      // Step 2: Parse X402 requirements from header
      const acceptsHeader = initialResponse.headers.get('X-PAYMENT');
      console.log('[PlaceBet] X-PAYMENT header:', acceptsHeader);

      if (!acceptsHeader) {
        throw new Error('No payment header in 402 response');
      }

      // Parse accepts (could be JSON string)
      let accepts;
      try {
        accepts = JSON.parse(acceptsHeader);
      } catch {
        throw new Error('Invalid payment header format');
      }

      const paymentInfo = accepts[0]; // First accepted payment method
      console.log('[PlaceBet] Payment info:', paymentInfo);

      // Step 3: Create EIP-3009 authorization
      const atomicAmount = BigInt(Math.floor(params.amountUsdc * 1_000_000)); // USDC has 6 decimals
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const nonce = `0x${crypto.randomUUID().replace(/-/g, '')}` as `0x${string}`;

      console.log('[PlaceBet] Signing authorization...', {
        from: address,
        to: AI_WALLET,
        value: atomicAmount.toString(),
        validAfter,
        validBefore,
        nonce,
      });

      // Step 4: Sign the authorization
      const signature = await signTypedDataAsync({
        domain: {
          name: 'USD Coin',
          version: '2',
          chainId: 8453, // Base mainnet
          verifyingContract: USDC_ADDRESS,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address,
          to: AI_WALLET as `0x${string}`,
          value: atomicAmount,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      });

      console.log('[PlaceBet] Signature obtained:', signature);

      // Step 5: Build X402 payment payload
      // IMPORTANT: All values must be STRINGS for JSON serialization
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: AI_WALLET,
            value: atomicAmount.toString(), // STRING!
            validAfter: validAfter.toString(), // STRING!
            validBefore: validBefore.toString(), // STRING!
            nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));
      console.log('[PlaceBet] Payment payload built, retrying with X-PAYMENT header...');

      // Step 6: Retry with payment
      const betResponse = await fetch('/api/prediction-market/bet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({
          marketId: params.marketId,
          outcomeIndex: params.outcomeIndex,
          side: params.side,
        }),
      });

      const result = await betResponse.json();
      console.log('[PlaceBet] Final response:', result);

      if (!betResponse.ok || !result.success) {
        throw new Error(result.error || 'Bet failed');
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[PlaceBet] Error:', message, err);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address, signTypedDataAsync]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { placeBet, loading, error, clearError };
}
