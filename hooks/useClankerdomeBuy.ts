// hooks/useClankerdomeBuy.ts
'use client';

import { useState, useCallback } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import type { ProtocolVote, ConsensusBuyResponse, X402Accepts } from '@/types/clankerdome';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

interface BuyParams {
  launchId: string;
  protocolVote: ProtocolVote;
  amountUsdc: number;
}

export function useClankerdomeBuy() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyIn = useCallback(async ({ launchId, protocolVote, amountUsdc }: BuyParams): Promise<ConsensusBuyResponse | null> => {
    if (!address) {
      setError('Wallet not connected');
      return null;
    }

    if (amountUsdc < 1) {
      setError('Minimum buy-in is $1 USDC');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Initial request to get 402 payment requirements
      console.log('[ConsensusBuy] Step 1: Getting payment requirements...');
      const initialResponse = await fetch('/api/clankerdome/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, protocolVote }),
      });

      console.log('[ConsensusBuy] Initial response status:', initialResponse.status);

      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (data.success) return data;
        throw new Error(data.error || 'Unexpected response');
      }

      // Step 2: Parse 402 response body for payment requirements
      const paymentReq = await initialResponse.json();
      console.log('[ConsensusBuy] Payment requirements:', paymentReq);

      if (!paymentReq.accepts || !paymentReq.accepts[0]) {
        throw new Error('No payment requirements in 402 response');
      }

      const accepts = paymentReq.accepts[0] as X402Accepts;
      const payTo = accepts.payTo as `0x${string}`;

      console.log('[ConsensusBuy] Pay to:', payTo);
      console.log('[ConsensusBuy] Domain:', accepts.extra);

      // Step 3: Sign EIP-3009 TransferWithAuthorization
      const atomicAmount = BigInt(Math.floor(amountUsdc * 1_000_000)); // USDC 6 decimals
      const validAfter = BigInt(0);
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

      // Generate 32 bytes (64 hex chars) for bytes32 nonce
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = `0x${Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

      console.log('[ConsensusBuy] Signing authorization...', {
        from: address,
        to: payTo,
        value: atomicAmount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      });

      const signature = await signTypedDataAsync({
        domain: {
          name: accepts.extra.name,
          version: accepts.extra.version,
          chainId: 8453,
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
          to: payTo,
          value: atomicAmount,
          validAfter,
          validBefore,
          nonce,
        },
      });

      console.log('[ConsensusBuy] Signature obtained:', signature);

      // Step 4: Build X402 payment payload (ALL values as strings)
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: payTo,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));
      console.log('[ConsensusBuy] Retrying with X-PAYMENT header...');

      // Step 5: Retry with X-PAYMENT header
      const buyResponse = await fetch('/api/clankerdome/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({ launchId, protocolVote }),
      });

      const data = await buyResponse.json();
      console.log('[ConsensusBuy] Final response:', data);

      if (!buyResponse.ok || !data.success) {
        throw new Error(data.error || 'Buy failed');
      }

      return data;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ConsensusBuy] Error:', err);
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [address, signTypedDataAsync]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { buyIn, isLoading, error, clearError };
}
