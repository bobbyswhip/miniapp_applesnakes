// hooks/useClankerdomeBuy.ts
'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';

const API_BASE_URL = 'https://api.applesnakes.com';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_DECIMALS = 6;

// EIP-3009 TransferWithAuthorization domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS
} as const;

// TransferWithAuthorization types
const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
} as const;

// Generate random bytes32 nonce
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function useClankerdomeBuy() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyIn = useCallback(async (launchId: string, amountUsdc: number) => {
    if (!address || !walletClient) {
      setError('Wallet not connected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Make initial request to get payment requirements
      const initialResponse = await fetch(`${API_BASE_URL}/api/clankerdome/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId })
      });

      // If not 402, something went wrong or no payment needed
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (data.success) return data;
        throw new Error(data.error || 'Unexpected response');
      }

      // Step 2: Parse payment requirements from 402 response
      const paymentData = await initialResponse.json();
      const accepts = paymentData.accepts?.[0];

      if (!accepts) {
        throw new Error('No payment requirements returned');
      }

      console.log('[X402] Payment requirements:', accepts);

      // Step 3: Build the authorization
      // Use the amount from accepts OR override with user's amount
      const value = parseUnits(amountUsdc.toString(), USDC_DECIMALS);
      const nonce = generateNonce();

      // validAfter: 10 minutes ago (to handle clock skew)
      const validAfter = BigInt(Math.floor(Date.now() / 1000) - 600);
      // validBefore: based on maxTimeoutSeconds from requirements
      const maxTimeout = accepts.maxTimeoutSeconds || 3600;
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + maxTimeout);

      const authorization = {
        from: address,
        to: accepts.payTo as `0x${string}`,
        value,
        validAfter,
        validBefore,
        nonce
      };

      console.log('[X402] Signing authorization:', authorization);

      // Step 4: Sign the authorization using EIP-712
      const signature = await walletClient.signTypedData({
        domain: USDC_DOMAIN,
        types: TRANSFER_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: authorization
      });

      console.log('[X402] Signature:', signature);

      // Step 5: Build payment payload (strings for JSON serialization)
      const paymentPayload = {
        x402Version: 1,
        scheme: accepts.scheme || 'exact',
        network: accepts.network || 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: accepts.payTo,
            value: value.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce
          }
        }
      };

      // Step 6: Base64 encode and send
      const paymentHeader = btoa(JSON.stringify(paymentPayload));

      console.log('[X402] Sending payment...');

      const paidResponse = await fetch(`${API_BASE_URL}/api/clankerdome/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader
        },
        body: JSON.stringify({ launchId })
      });

      const result = await paidResponse.json();

      if (!result.success) {
        throw new Error(result.error || 'Payment failed');
      }

      console.log('[X402] Payment successful:', result);
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[X402] Error:', err);
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [address, walletClient]);

  return { buyIn, isLoading, error };
}
