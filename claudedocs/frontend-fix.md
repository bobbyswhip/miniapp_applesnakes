# Token Wars x402 Frontend Implementation Guide

Complete guide for implementing x402 payments in a frontend application to interact with the Token Wars `/api/token-wars/buy/x402` endpoint.

## Overview

The x402 protocol enables HTTP-native payments. When you make a request to a protected endpoint:
1. Server returns **402 Payment Required** with payment requirements
2. Client signs a payment authorization using EIP-3009 (TransferWithAuthorization)
3. Client retries the request with the signed payment in the `X-PAYMENT` header
4. Server verifies the signature and settles the payment

## Two Implementation Options

### Option A: Official x402 Packages (Recommended)
Uses `@x402/fetch` and `@x402/evm` for automatic handling.

### Option B: Manual Implementation
Custom code for full control over the payment flow.

---

## Option A: Official x402 Packages

### Installation

```bash
npm install @x402/fetch @x402/evm viem
```

### Implementation

```typescript
// lib/x402-client.ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";

// Create x402 client with wallet signer
export async function createX402Fetch(ethereum: any) {
  const client = new x402Client();

  // Create viem wallet client from browser wallet
  const walletClient = createWalletClient({
    chain: base,
    transport: custom(ethereum),
  });

  const [address] = await walletClient.getAddresses();

  // Register EVM payment scheme with the wallet's signing capability
  registerExactEvmScheme(client, {
    signer: {
      address,
      signTypedData: async (params: any) => {
        return walletClient.signTypedData(params);
      },
    },
  });

  // Return wrapped fetch that auto-handles 402 responses
  return wrapFetchWithPayment(fetch, client);
}
```

### Usage in React Component

```typescript
// components/TokenWarsBuy.tsx
import { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { createX402Fetch } from '@/lib/x402-client';

interface BuyParams {
  warId: string;
  amount: number;  // USD amount (1-10000)
  dexVote: 'v4' | 'aerodrome' | 'hydrex';
  pairVote: 'eth' | 'wass';
}

export function useTokenWarsBuy() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyIntoWar = async (params: BuyParams) => {
    if (!walletClient) {
      setError('Wallet not connected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Create x402-enabled fetch
      const x402Fetch = await createX402Fetch(window.ethereum);

      // Make the request - x402 handles 402 automatically
      const response = await x402Fetch(
        `https://api.applesnakes.com/api/token-wars/buy/x402?amount=${params.amount}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            warId: params.warId,
            dexVote: params.dexVote,
            pairVote: params.pairVote,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Buy failed');
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Buy failed';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { buyIntoWar, isLoading, error };
}
```

---

## Option B: Manual Implementation (Full Control)

This approach gives you complete control over the payment flow and UI feedback.

### Required Dependencies

```bash
npm install wagmi viem @rainbow-me/rainbowkit
```

### Constants

```typescript
// lib/constants.ts

// USDC on Base Mainnet
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
export const USDC_DECIMALS = 6;

// Token Wars API
export const TOKEN_WARS_API = 'https://api.applesnakes.com';

// EIP-712 Domain for USDC on Base
export const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453, // Base mainnet
  verifyingContract: USDC_ADDRESS,
} as const;

// EIP-3009 TransferWithAuthorization types
export const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;
```

### Payment Requirements Interface

```typescript
// types/x402.ts

export interface PaymentRequirements {
  scheme: string;           // "exact"
  network: string;          // "base"
  maxAmountRequired: string; // Amount in atomic units (e.g., "5000000" for $5)
  resource: string;         // The URL being paid for
  description?: string;     // Human-readable description
  mimeType?: string;        // Response type
  payTo: string;            // Recipient address
  maxTimeoutSeconds: number; // Signature validity window
  asset: string;            // "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
}

export interface X402Response {
  error: string;
  paymentRequirements: PaymentRequirements;
  x402?: {
    version: number;
    appName: string;
    appLogo?: string;
    amount: number;
    currency: string;
  };
}
```

### x402 Payment Helper

```typescript
// lib/x402-payment.ts
import { WalletClient } from 'viem';
import { USDC_DOMAIN, TRANSFER_AUTHORIZATION_TYPES } from './constants';
import type { PaymentRequirements } from '@/types/x402';

/**
 * Generate a random 32-byte nonce for EIP-3009
 */
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

/**
 * Create an x402 payment header with EIP-3009 TransferWithAuthorization signature
 */
export async function createX402PaymentHeader(
  walletClient: WalletClient,
  address: `0x${string}`,
  paymentRequirements: PaymentRequirements
): Promise<string> {
  // Use the maxAmountRequired from server (already in atomic units)
  const amountInAtomicUnits = BigInt(paymentRequirements.maxAmountRequired);
  const nonce = generateNonce();
  const now = Math.floor(Date.now() / 1000);

  // Signature validity window
  const validAfter = now - 60; // Valid from 1 minute ago (clock skew tolerance)
  const validBefore = now + (paymentRequirements.maxTimeoutSeconds || 3600);

  // Recipient from payment requirements
  const recipientAddress = paymentRequirements.payTo as `0x${string}`;

  console.log('[x402] Creating payment authorization:', {
    from: address,
    to: recipientAddress,
    value: amountInAtomicUnits.toString(),
    validAfter,
    validBefore,
  });

  // EIP-712 message for signing (BigInt for uint256 types)
  const signingMessage = {
    from: address,
    to: recipientAddress,
    value: amountInAtomicUnits,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  // Sign the EIP-712 typed data
  const signature = await walletClient.signTypedData({
    domain: USDC_DOMAIN,
    types: TRANSFER_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: signingMessage,
  });

  // x402 authorization object (all numeric values as strings per spec)
  const authorization = {
    from: address,
    to: recipientAddress,
    value: amountInAtomicUnits.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
  };

  // x402 payment payload
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature,
      authorization,
    },
  };

  console.log('[x402] Payment payload:', JSON.stringify(payload, null, 2));

  // Encode as base64 for X-PAYMENT header
  return btoa(JSON.stringify(payload));
}

/**
 * Parse payment requirements from a 402 response
 */
export function parsePaymentRequirements(responseBody: any): PaymentRequirements | null {
  // Try different response formats

  // Format 1: Standard x402 with 'accepts' array
  if (responseBody.accepts && Array.isArray(responseBody.accepts) && responseBody.accepts.length > 0) {
    // Find USDC/Base payment option
    const requirement = responseBody.accepts.find(
      (req: PaymentRequirements) => req.scheme === 'exact' && req.network === 'base'
    ) || responseBody.accepts[0];

    if (requirement?.maxAmountRequired) {
      return requirement;
    }
  }

  // Format 2: Our custom format with 'paymentRequirements' object
  if (responseBody.paymentRequirements?.maxAmountRequired) {
    return responseBody.paymentRequirements;
  }

  // Format 3: Direct payment requirements in body
  if (responseBody.maxAmountRequired) {
    return responseBody;
  }

  console.error('[x402] Could not parse payment requirements:', responseBody);
  return null;
}
```

### Complete React Hook

```typescript
// hooks/useTokenWarsBuy.ts
import { useState, useCallback } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { base } from 'viem/chains';
import { formatUnits } from 'viem';
import {
  createX402PaymentHeader,
  parsePaymentRequirements
} from '@/lib/x402-payment';
import { TOKEN_WARS_API, USDC_ADDRESS, USDC_DECIMALS } from '@/lib/constants';

type BuyStatus = 'idle' | 'requesting' | 'signing' | 'submitting' | 'success' | 'error';

interface BuyParams {
  warId: string;
  amount: number;  // USD amount (1-10000)
  dexVote: 'v4' | 'aerodrome' | 'hydrex';
  pairVote: 'eth' | 'wass';
}

interface BuyResult {
  success: boolean;
  message: string;
  buy?: {
    warId: string;
    amount: number;
    txHash: string;
    wallet: string;
    dexVote: string;
    pairVote: string;
  };
  war?: {
    id: string;
    name: string;
    symbol: string;
    totalRaised: number;
    status: string;
  };
  error?: string;
}

// USDC balance ABI
const BALANCE_ABI = [{
  inputs: [{ name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

export function useTokenWarsBuy() {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: base.id });

  const [status, setStatus] = useState<BuyStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);

  // Get USDC balance
  const getUSDCBalance = useCallback(async (): Promise<number> => {
    if (!address || !publicClient) return 0;

    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      return parseFloat(formatUnits(balance, USDC_DECIMALS));
    } catch {
      return 0;
    }
  }, [address, publicClient]);

  // Main buy function
  const buyIntoWar = useCallback(async (params: BuyParams): Promise<BuyResult | null> => {
    // Validation
    if (!isConnected || !walletClient || !address) {
      setError('Please connect your wallet');
      return null;
    }

    if (chain?.id !== base.id) {
      setError('Please switch to Base network');
      return null;
    }

    if (params.amount < 1 || params.amount > 10000) {
      setError('Amount must be between $1 and $10,000');
      return null;
    }

    // Check USDC balance
    const balance = await getUSDCBalance();
    if (balance < params.amount) {
      setError(`Insufficient USDC balance. You have $${balance.toFixed(2)}`);
      return null;
    }

    // Reset state
    setStatus('requesting');
    setStatusMessage('Requesting payment requirements...');
    setError(null);
    setResult(null);

    try {
      // STEP 1: Make initial request to get 402 response
      const endpoint = `${TOKEN_WARS_API}/api/token-wars/buy/x402?amount=${params.amount}`;

      const initialResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          warId: params.warId,
          dexVote: params.dexVote,
          pairVote: params.pairVote,
        }),
      });

      // STEP 2: Handle 402 Payment Required
      if (initialResponse.status === 402) {
        const responseBody = await initialResponse.json();
        console.log('[TokenWarsBuy] 402 response:', responseBody);

        // Parse payment requirements from response
        const paymentRequirements = parsePaymentRequirements(responseBody);

        if (!paymentRequirements) {
          throw new Error('Invalid payment requirements from server. Response: ' + JSON.stringify(responseBody));
        }

        console.log('[TokenWarsBuy] Payment requirements:', paymentRequirements);

        // Display amount to user
        const requiredAmount = formatUnits(
          BigInt(paymentRequirements.maxAmountRequired),
          USDC_DECIMALS
        );

        setStatus('signing');
        setStatusMessage(`Sign payment of $${parseFloat(requiredAmount).toFixed(2)} USDC in your wallet...`);

        // STEP 3: Create signed payment header
        const paymentHeader = await createX402PaymentHeader(
          walletClient,
          address,
          paymentRequirements
        );

        // STEP 4: Retry request with payment
        setStatus('submitting');
        setStatusMessage('Submitting payment and recording buy...');

        const paidResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PAYMENT': paymentHeader,
          },
          body: JSON.stringify({
            warId: params.warId,
            dexVote: params.dexVote,
            pairVote: params.pairVote,
          }),
        });

        const paidData = await paidResponse.json();
        console.log('[TokenWarsBuy] Payment response:', paidData);

        if (paidResponse.ok && paidData.success) {
          setResult(paidData);
          setStatus('success');
          setStatusMessage('Successfully joined the Token War!');
          return paidData;
        } else if (paidResponse.status === 402) {
          // Payment verification failed
          if (paidData.reason) {
            throw new Error(`Payment verification failed: ${paidData.reason}`);
          }
          throw new Error(paidData.error || 'Payment not accepted');
        } else {
          throw new Error(paidData.error || 'Buy failed');
        }
      } else if (initialResponse.ok) {
        // Unexpected success without payment (shouldn't happen)
        const data = await initialResponse.json();
        setResult(data);
        setStatus('success');
        return data;
      } else {
        const errorData = await initialResponse.json();
        throw new Error(errorData.error || `Request failed with status ${initialResponse.status}`);
      }
    } catch (err) {
      console.error('[TokenWarsBuy] Error:', err);

      let message: string;
      if (err instanceof Error) {
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction cancelled by user';
        } else {
          message = err.message;
        }
      } else {
        message = 'Buy failed';
      }

      setError(message);
      setStatus('error');
      setStatusMessage('');
      return null;
    }
  }, [address, isConnected, chain, walletClient, getUSDCBalance]);

  // Reset state
  const reset = useCallback(() => {
    setStatus('idle');
    setStatusMessage('');
    setError(null);
    setResult(null);
  }, []);

  return {
    buyIntoWar,
    status,
    statusMessage,
    error,
    result,
    reset,
    isLoading: status !== 'idle' && status !== 'success' && status !== 'error',
    getUSDCBalance,
  };
}
```

### Complete React Component

```typescript
// components/TokenWarsBuyPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { base } from 'viem/chains';
import { formatUnits } from 'viem';
import { useTokenWarsBuy } from '@/hooks/useTokenWarsBuy';
import { USDC_ADDRESS, USDC_DECIMALS } from '@/lib/constants';

interface TokenWarsBuyPanelProps {
  warId: string;
  warName: string;
  warSymbol: string;
}

const BALANCE_ABI = [{
  inputs: [{ name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

export function TokenWarsBuyPanel({ warId, warName, warSymbol }: TokenWarsBuyPanelProps) {
  const { address, isConnected, chain } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: base.id });

  const {
    buyIntoWar,
    status,
    statusMessage,
    error,
    result,
    isLoading,
    reset
  } = useTokenWarsBuy();

  // Form state
  const [amount, setAmount] = useState('5');
  const [dexVote, setDexVote] = useState<'v4' | 'aerodrome' | 'hydrex'>('aerodrome');
  const [pairVote, setPairVote] = useState<'eth' | 'wass'>('eth');
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);

  // Fetch USDC balance
  useEffect(() => {
    async function fetchBalance() {
      if (!address || !publicClient) {
        setUsdcBalance(null);
        return;
      }
      try {
        const balance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setUsdcBalance(formatUnits(balance, USDC_DECIMALS));
      } catch {
        setUsdcBalance('0');
      }
    }
    fetchBalance();
  }, [address, publicClient, result]); // Refetch after successful buy

  // Handle buy
  const handleBuy = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 1) {
      return;
    }

    await buyIntoWar({
      warId,
      amount: amountNum,
      dexVote,
      pairVote,
    });
  };

  const canBuy = isConnected &&
    chain?.id === base.id &&
    !isLoading &&
    parseFloat(amount) >= 1;

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h3 className="text-xl font-bold text-white mb-4">
        Join {warSymbol} Token War
      </h3>

      {/* Wallet Status */}
      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
        {isConnected ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 text-sm">Connected</span>
              </div>
              <div className="text-white font-mono text-sm mt-1">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <div className="text-gray-400 text-xs mt-1">
                USDC: ${usdcBalance ? parseFloat(usdcBalance).toFixed(2) : '--'}
              </div>
            </div>
            {chain?.id !== base.id && (
              <span className="text-yellow-400 text-xs">Switch to Base</span>
            )}
          </div>
        ) : (
          <button
            onClick={openConnectModal}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Buy Form */}
      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Buy Amount (USDC)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
              max="10000"
              step="1"
              disabled={isLoading}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            />
            <span className="text-gray-400">USDC</span>
          </div>
          <div className="text-gray-500 text-xs mt-1">Min: $1 | Max: $10,000</div>
        </div>

        {/* DEX Vote */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Vote for DEX
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['aerodrome', 'v4', 'hydrex'] as const).map((dex) => (
              <button
                key={dex}
                onClick={() => setDexVote(dex)}
                disabled={isLoading}
                className={`py-2 px-3 rounded font-medium text-sm transition-colors ${
                  dexVote === dex
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {dex === 'v4' ? 'Uniswap V4' : dex.charAt(0).toUpperCase() + dex.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Pair Vote */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Vote for Trading Pair
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['eth', 'wass'] as const).map((pair) => (
              <button
                key={pair}
                onClick={() => setPairVote(pair)}
                disabled={isLoading}
                className={`py-2 px-3 rounded font-medium text-sm transition-colors ${
                  pairVote === pair
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {pair.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Status Messages */}
        {statusMessage && status !== 'error' && (
          <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded text-yellow-300 text-sm flex items-center gap-2">
            {isLoading && (
              <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            )}
            {statusMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Success Result */}
        {result?.success && (
          <div className="p-3 bg-green-900/30 border border-green-700/50 rounded">
            <div className="text-green-400 font-medium mb-2">
              {result.message}
            </div>
            {result.buy && (
              <div className="text-gray-300 text-xs space-y-1">
                <div>Amount: ${result.buy.amount} USDC</div>
                <div>DEX Vote: {result.buy.dexVote}</div>
                <div>Pair Vote: {result.buy.pairVote}</div>
              </div>
            )}
            {result.war && (
              <div className="text-gray-400 text-xs mt-2">
                Total Raised: ${result.war.totalRaised}
              </div>
            )}
          </div>
        )}

        {/* Buy Button */}
        <button
          onClick={handleBuy}
          disabled={!canBuy}
          className={`w-full py-3 rounded font-semibold transition-all ${
            !canBuy
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white'
          }`}
        >
          {isLoading
            ? 'Processing...'
            : `Buy $${amount} into ${warSymbol}`}
        </button>

        {/* Reset Button (after success/error) */}
        {(status === 'success' || status === 'error') && (
          <button
            onClick={reset}
            className="w-full py-2 text-gray-400 hover:text-white text-sm"
          >
            Make Another Buy
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## Debugging Guide

### Common Errors and Solutions

#### 1. "Invalid payment requirements from server"

**Cause**: Frontend can't parse the 402 response.

**Debug**:
```typescript
// Log the raw 402 response
const response = await fetch(endpoint, { method: 'POST', body: ... });
if (response.status === 402) {
  const body = await response.json();
  console.log('Raw 402 response:', JSON.stringify(body, null, 2));
}
```

**Expected response format**:
```json
{
  "error": "Payment Required",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "5000000",
    "resource": "https://api.applesnakes.com/api/token-wars/buy/x402?amount=5",
    "description": "Token Wars Buy-In",
    "payTo": "0xE5e9033C57B4332283Cda19B39431CD716340098",
    "maxTimeoutSeconds": 60,
    "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  "x402": {
    "version": 1,
    "appName": "Token Wars",
    "amount": 5,
    "currency": "USDC"
  }
}
```

#### 2. "Payment verification failed"

**Cause**: The signature or payload format is incorrect.

**Debug**:
```typescript
// Log the payment payload before encoding
const payload = {
  x402Version: 1,
  scheme: 'exact',
  network: 'base',
  payload: {
    signature,
    authorization,
  },
};
console.log('Payment payload:', JSON.stringify(payload, null, 2));
```

**Check**:
- `authorization.value` must equal `paymentRequirements.maxAmountRequired`
- `authorization.to` must equal `paymentRequirements.payTo`
- Timestamps must be valid (validAfter < now < validBefore)

#### 3. "Payment amount mismatch"

**Cause**: The amount in the signed payload doesn't match the requested amount.

**Solution**: Ensure you pass the same `amount` query parameter on both requests:
```typescript
// MUST be identical URLs
const url = `${API}/api/token-wars/buy/x402?amount=${amount}`;

// First request (gets 402)
await fetch(url, { method: 'POST', body: JSON.stringify(data) });

// Second request (with X-PAYMENT) - SAME URL
await fetch(url, {
  method: 'POST',
  body: JSON.stringify(data),
  headers: { 'X-PAYMENT': paymentHeader }
});
```

#### 4. Network Issues

**CORS errors**: Ensure the API allows your origin.

**Check using curl**:
```bash
# Test 402 response
curl -X POST "https://api.applesnakes.com/api/token-wars/buy/x402?amount=5" \
  -H "Content-Type: application/json" \
  -d '{"warId":"test","dexVote":"aerodrome","pairVote":"eth"}'
```

---

## API Reference

### Endpoint

```
POST https://api.applesnakes.com/api/token-wars/buy/x402?amount={amount}
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | number | Yes | USD amount (1-10000) |

### Request Body

```json
{
  "warId": "string",          // Required: Token War ID
  "dexVote": "string",        // Required: "v4" | "aerodrome" | "hydrex"
  "pairVote": "string"        // Required: "eth" | "wass"
}
```

### Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-PAYMENT` | Base64-encoded x402 payment payload (required on retry) |

### Response: 402 Payment Required (First Request)

```json
{
  "error": "Payment Required",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "5000000",
    "resource": "https://api.applesnakes.com/api/token-wars/buy/x402?amount=5",
    "payTo": "0xE5e9033C57B4332283Cda19B39431CD716340098",
    "maxTimeoutSeconds": 60,
    "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }
}
```

### Response: 200 Success (After Payment)

```json
{
  "success": true,
  "message": "Successfully joined TEST Token War with $5 USDC!",
  "buy": {
    "warId": "war-abc123",
    "amount": 5,
    "txHash": "x402-dynamic-1234567890-5",
    "wallet": "0x1234...",
    "dexVote": "aerodrome",
    "pairVote": "eth"
  },
  "war": {
    "id": "war-abc123",
    "name": "Test Token",
    "symbol": "TEST",
    "totalRaised": 105,
    "status": "active"
  },
  "wallet": {
    "totalContribution": 5,
    "sharePercent": 4.76
  },
  "consensus": {
    "dex": {
      "leading": "aerodrome",
      "aerodrome": { "votes": 50, "percent": 47.6 }
    },
    "pair": {
      "leading": "eth",
      "eth": { "votes": 80, "percent": 76.2 }
    }
  }
}
```

---

## Sources

- [@coinbase/x402 - npm](https://www.npmjs.com/package/@coinbase/x402)
- [x402-next - npm](https://www.npmjs.com/package/x402-next)
- [Quickstart for Buyers - Coinbase Developer Documentation](https://docs.cdp.coinbase.com/x402/quickstart-for-buyers)
- [GitHub - coinbase/x402: A payments protocol for the internet](https://github.com/coinbase/x402)
