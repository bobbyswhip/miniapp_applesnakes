// hooks/usePlaceBet.ts
'use client';

import { useCallback, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import type { BetResult } from '@/types/clankerdome';

// Use local API proxy to avoid CORS issues
// The proxy forwards to https://api.applesnakes.com
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098';

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

    if (params.amountUsdc < 1) {
      setError('Minimum bet is $1 USDC');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Create EIP-3009 authorization for X402 payment
      const atomicAmount = BigInt(Math.floor(params.amountUsdc * 1_000_000)); // USDC has 6 decimals
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      // Generate 32 bytes (64 hex chars) for bytes32 nonce
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = `0x${Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

      console.log('[PlaceBet] Signing authorization...', {
        from: address,
        to: AI_WALLET,
        value: atomicAmount.toString(),
        validAfter,
        validBefore,
        nonce,
      });

      // Step 2: Sign the authorization
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

      // Step 3: Build X402 payment payload
      // CRITICAL: All numeric values MUST be strings for JSON serialization
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: AI_WALLET,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));
      console.log('[PlaceBet] Sending bet with X-PAYMENT header...');

      // Step 4: Send bet request with payment header upfront
      const response = await fetch('/api/prediction-market/bet', {
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

      const result = await response.json();
      console.log('[PlaceBet] Response:', result);

      if (!response.ok || !result.success) {
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
