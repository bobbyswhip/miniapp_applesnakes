'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { base } from 'viem/chains';

// ============================================================================
// X402 Configuration
// ============================================================================

export const X402_CONFIG = {
  // Production API endpoint
  API_BASE_URL: 'https://api.applesnakes.com',

  // Payment recipient (AI Wallet) - checksummed
  PAYMENT_RECIPIENT: '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098' as const,

  // USDC on Base
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  USDC_DECIMALS: 6,

  // Prices
  VERIFY_PRICE_USDC: 0.50,
  MIN_LAUNCH_PRICE_USDC: 1.00,

  // Chain
  CHAIN_ID: 8453, // Base mainnet
};

const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
] as const;

// ============================================================================
// Types
// ============================================================================

interface X402PaymentDetails {
  payTo: string;
  amount: string;
  asset: string;
}

interface X402Response<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useX402Fetch() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: base.id });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  /**
   * Parse the 402 response to extract payment details
   */
  const parse402Response = (responseData: unknown): X402PaymentDetails | null => {
    try {
      const data = responseData as { accepts?: Array<{ payTo: string; maxAmountRequired: string; asset: string }> };
      if (data.accepts && data.accepts.length > 0) {
        const accept = data.accepts[0];
        return {
          payTo: accept.payTo,
          amount: accept.maxAmountRequired,
          asset: accept.asset
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  /**
   * Pay USDC to the specified address
   */
  const payUsdc = useCallback(async (to: string, amountRaw: string): Promise<string> => {
    if (!address) throw new Error('Wallet not connected');

    console.log(`[X402] Paying ${amountRaw} USDC units to ${to}`);

    const txHash = await writeContractAsync({
      address: X402_CONFIG.USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [to as `0x${string}`, BigInt(amountRaw)]
    });

    console.log(`[X402] Payment tx: ${txHash}`);

    // Wait for confirmation
    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`[X402] Payment confirmed`);
    }

    return txHash;
  }, [address, writeContractAsync, publicClient]);

  /**
   * Make an x402-enabled request to the backend
   * Handles 402 responses, payment, and retry automatically
   */
  const x402Fetch = useCallback(async <T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      formData?: FormData;
      customAmount?: number; // For launch, allow custom amount in USDC
    } = {}
  ): Promise<X402Response<T>> => {
    const { method = 'POST', body, formData, customAmount } = options;

    if (!isConnected || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);
    setStatusMessage('');

    try {
      const url = `${X402_CONFIG.API_BASE_URL}${endpoint}`;

      // Step 1: Make initial request
      console.log(`[X402] Initial request to ${url}`);
      setStatusMessage('Sending request...');

      const headers: Record<string, string> = {};
      let requestBody: FormData | string | undefined;

      if (formData) {
        requestBody = formData;
        // Don't set Content-Type for FormData - browser will set it with boundary
      } else if (body) {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
      }

      const initialResponse = await fetch(url, {
        method,
        headers,
        body: requestBody,
      });

      // If not 402, return the response
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (!initialResponse.ok) {
          setIsLoading(false);
          return { success: false, error: data.error || 'Request failed' };
        }
        setIsLoading(false);
        return { success: true, data };
      }

      // Step 2: Parse 402 response
      console.log(`[X402] Got 402 Payment Required`);
      setStatusMessage('Payment required...');

      const paymentResponse = await initialResponse.json();
      const paymentDetails = parse402Response(paymentResponse);

      if (!paymentDetails) {
        setIsLoading(false);
        return { success: false, error: 'Could not parse payment details' };
      }

      console.log(`[X402] Payment details:`, paymentDetails);

      // Step 3: Calculate payment amount
      let paymentAmount = paymentDetails.amount;

      // If custom amount provided (for launch), use that instead
      if (customAmount && customAmount > 0) {
        // Convert USDC to raw units (6 decimals)
        paymentAmount = Math.floor(customAmount * 1_000_000).toString();
        console.log(`[X402] Using custom amount: ${customAmount} USDC (${paymentAmount} units)`);
      }

      // Step 4: Execute payment
      console.log(`[X402] Executing payment of ${paymentAmount} units...`);
      setStatusMessage('Please confirm USDC payment in your wallet...');

      const txHash = await payUsdc(paymentDetails.payTo, paymentAmount);
      setStatusMessage('Payment confirmed, processing request...');

      // Step 5: Retry with payment proof
      console.log(`[X402] Retrying request with payment proof...`);

      // Create the X-PAYMENT header payload (base64-encoded JSON)
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature: txHash,
          authorization: {
            from: address,
            to: paymentDetails.payTo,
            value: paymentAmount,
            validAfter: '0',
            validBefore: Math.floor(Date.now() / 1000 + 3600).toString(),
            nonce: Date.now().toString()
          }
        }
      };

      const xPaymentHeader = btoa(JSON.stringify(paymentPayload));

      // Build retry headers
      const retryHeaders: Record<string, string> = {
        'X-PAYMENT': xPaymentHeader,
        'X-Payment-Amount': (parseInt(paymentAmount) / 1_000_000).toString(),
        'X-Payment-Tx-Hash': txHash,
        'X-Payment-From': address,
      };

      let retryBody: FormData | string | undefined;

      if (formData) {
        // Need to recreate FormData for retry since original was consumed
        retryBody = formData;
      } else if (body) {
        retryHeaders['Content-Type'] = 'application/json';
        retryBody = JSON.stringify(body);
      }

      const retryResponse = await fetch(url, {
        method,
        headers: retryHeaders,
        body: retryBody,
      });

      const data = await retryResponse.json();

      if (!retryResponse.ok) {
        setIsLoading(false);
        return { success: false, error: data.error || 'Request failed after payment' };
      }

      setIsLoading(false);
      setStatusMessage('');
      return { success: true, data };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[X402] Error:`, err);
      setError(errorMessage);
      setIsLoading(false);
      return { success: false, error: errorMessage };
    }
  }, [address, isConnected, payUsdc]);

  return {
    x402Fetch,
    isLoading,
    error,
    statusMessage,
    isConnected,
    address,
    setError,
    setStatusMessage,
  };
}
