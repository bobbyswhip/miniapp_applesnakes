// hooks/usePlaceBet.ts
// Uses EIP-3009 TransferWithAuthorization for USDC payments
// Endpoint: /api/prediction-market/bet/verified
'use client';

import { useCallback, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { getAddress } from 'viem';
import type { BetResult } from '@/types/clankerdome';

// EIP-3009 Constants - Import from centralized constants
import { USDC_ADDRESS as USDC_ADDR, AI_WALLET as AI_WALLET_ADDR } from '@/lib/prediction-market-constants';
const USDC_ADDRESS = USDC_ADDR;
const AI_WALLET = AI_WALLET_ADDR;

// EIP-712 domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS as `0x${string}`,
} as const;

// EIP-3009 TransferWithAuthorization types
const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// Generate cryptographically secure 32-byte nonce
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')) as `0x${string}`;
}

interface PlaceBetParams {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  amountUsdc: number;  // Amount in dollars (e.g., 5.00)
  warId?: string;      // Required for Token Wars markets
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
      // Step 1: Calculate atomic amount (USDC has 6 decimals)
      const atomicAmount = BigInt(Math.round(params.amountUsdc * 1_000_000));

      // Step 2: Generate authorization parameters
      const nonce = generateNonce();
      const validAfter = BigInt(0);
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

      console.log('[PlaceBet] Signing EIP-3009 authorization...', {
        from: address,
        to: AI_WALLET,
        value: atomicAmount.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce,
      });

      // Step 3: Sign EIP-712 typed data
      const signature = await signTypedDataAsync({
        domain: USDC_DOMAIN,
        types: TRANSFER_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: getAddress(address),
          to: getAddress(AI_WALLET),
          value: atomicAmount,
          validAfter,
          validBefore,
          nonce,
        },
      });

      console.log('[PlaceBet] Signature obtained:', signature.slice(0, 20) + '...');

      // Step 4: Build X-PAYMENT payload with STRING values
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: getAddress(address),
            to: getAddress(AI_WALLET),
            value: atomicAmount.toString(),
            validAfter: '0',
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(paymentPayload));
      console.log('[PlaceBet] Sending to verified endpoint...');

      // Step 5: Submit to verified endpoint
      const response = await fetch('/api/prediction-market/bet/verified', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({
          marketId: params.marketId,
          outcomeIndex: params.outcomeIndex,
          side: params.side,
          warId: params.warId,
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
