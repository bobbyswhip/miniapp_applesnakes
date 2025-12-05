# x402 Frontend Implementation Guide

## Overview

This guide shows how to integrate x402 USDC payments into your token launcher frontend. Users pay USDC via their connected wallet to launch tokens.

## Prerequisites

Your frontend needs:
- wagmi + viem for wallet connection
- A wallet connector (RainbowKit, ConnectKit, etc.)
- Base mainnet support

## Installation

```bash
npm install wagmi viem @tanstack/react-query
```

## Step 1: Wallet Configuration

```typescript
// lib/wagmi-config.ts
import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    walletConnect({ projectId: 'YOUR_PROJECT_ID' }),
  ],
  transports: {
    [base.id]: http(),
  },
});
```

## Step 2: App Provider Setup

```typescript
// app/providers.tsx
'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/lib/wagmi-config';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

## Step 3: Token Launcher Component

```typescript
// components/X402TokenLauncher.tsx
'use client';

import { useState, useEffect } from 'react';
import { useAccount, useWalletClient, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// AI Wallet that receives payments
const PAYMENT_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

interface LaunchResult {
  success: boolean;
  payment?: {
    amount: number;
    currency: string;
    txHash: string;
    from: string;
  };
  token?: {
    name: string;
    symbol: string;
  };
  error?: string;
}

export default function X402TokenLauncher() {
  // Wallet state
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  // Form state
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenDescription, setTokenDescription] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('1.00'); // USDC amount
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // UI state
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [launching, setLaunching] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch USDC balance
  useEffect(() => {
    if (address && walletClient) {
      fetchUSDCBalance(address);
    }
  }, [address, walletClient]);

  async function fetchUSDCBalance(userAddress: string) {
    try {
      const response = await fetch(`/api/token-launcher/x402?checkBalance=${userAddress}`);
      // Or use viem directly:
      // const balance = await publicClient.readContract({...})
      // For now, just show placeholder
      setUsdcBalance('--');
    } catch {
      setUsdcBalance('0');
    }
  }

  // Main launch function with x402 payment
  async function handleLaunch() {
    if (!walletClient || !address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!tokenName || !tokenSymbol) {
      setError('Token name and symbol are required');
      return;
    }

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount < 0.01) {
      setError('Minimum payment is $0.01 USDC');
      return;
    }

    setLaunching(true);
    setError(null);
    setResult(null);
    setStatus('Preparing request...');

    try {
      // Step 1: Create form data
      const formData = new FormData();
      formData.append('name', tokenName);
      formData.append('symbol', tokenSymbol);
      if (tokenDescription) {
        formData.append('description', tokenDescription);
      }
      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      // Step 2: Make initial request (will get 402)
      setStatus('Requesting payment requirements...');
      const initialResponse = await fetch('/api/token-launcher/x402', {
        method: 'POST',
        body: formData,
      });

      // Step 3: Handle 402 Payment Required
      if (initialResponse.status === 402) {
        const paymentInfo = await initialResponse.json();
        console.log('Payment required:', paymentInfo);

        setStatus('Signing payment authorization...');

        // Step 4: Create signed payment header
        const paymentHeader = await createX402PaymentHeader(
          paymentAmount,
          PAYMENT_WALLET,
          walletClient
        );

        // Step 5: Retry with payment
        setStatus('Sending payment and launching token...');
        const paidResponse = await fetch('/api/token-launcher/x402', {
          method: 'POST',
          headers: {
            'X-PAYMENT': paymentHeader,
          },
          body: formData,
        });

        const responseData = await paidResponse.json();

        if (paidResponse.ok && responseData.success) {
          setResult(responseData);
          setStatus('Success! Token launch initiated.');
          // Clear form
          setTokenName('');
          setTokenSymbol('');
          setTokenDescription('');
          setSelectedFile(null);
        } else {
          setError(responseData.error || 'Payment failed');
          setStatus('');
        }
      } else if (initialResponse.ok) {
        // Unexpected success without payment
        const responseData = await initialResponse.json();
        setResult(responseData);
        setStatus('Success!');
      } else {
        const errorData = await initialResponse.json();
        setError(errorData.error || 'Request failed');
        setStatus('');
      }
    } catch (err) {
      console.error('Launch error:', err);
      setError(err instanceof Error ? err.message : 'Launch failed');
      setStatus('');
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-gray-900 rounded-lg">
      <h1 className="text-2xl font-bold text-white mb-6">
        Launch Token with USDC Payment
      </h1>

      {/* Wallet Connection */}
      <div className="mb-6 p-4 bg-gray-800 rounded-lg">
        {isConnected ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-green-400 text-sm">Connected</div>
              <div className="text-white font-mono">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <div className="text-gray-400 text-sm">
                USDC Balance: ${usdcBalance}
              </div>
            </div>
            <button
              onClick={() => disconnect()}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Payment Info */}
      <div className="mb-6 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
        <div className="text-blue-400 font-semibold mb-2">Payment Info</div>
        <div className="text-gray-300 text-sm space-y-1">
          <div>Currency: USDC on Base</div>
          <div>Recipient: {PAYMENT_WALLET.slice(0, 10)}...</div>
          <div>Your payment amount becomes the dev buy budget</div>
        </div>
      </div>

      {/* Token Form */}
      <div className="space-y-4">
        {/* Token Name */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Token Name *
          </label>
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="My Awesome Token"
            disabled={launching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-4 py-2 text-white"
          />
        </div>

        {/* Token Symbol */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Token Symbol *
          </label>
          <input
            type="text"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
            placeholder="TKN"
            maxLength={10}
            disabled={launching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-4 py-2 text-white font-mono"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Description (optional)
          </label>
          <textarea
            value={tokenDescription}
            onChange={(e) => setTokenDescription(e.target.value)}
            placeholder="Token description..."
            rows={3}
            disabled={launching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-4 py-2 text-white"
          />
        </div>

        {/* Image Upload */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Token Image (optional)
          </label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            disabled={launching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-4 py-2 text-white"
          />
          {selectedFile && (
            <div className="text-gray-400 text-sm mt-1">
              Selected: {selectedFile.name}
            </div>
          )}
        </div>

        {/* Payment Amount */}
        <div>
          <label className="block text-gray-400 text-sm mb-1">
            Payment Amount (USDC) *
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              min="0.01"
              step="0.01"
              disabled={launching}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-4 py-2 text-white font-mono"
            />
            <span className="text-gray-400">USDC</span>
          </div>
          <div className="text-gray-500 text-xs mt-1">
            This amount will be used as the dev buy budget (converted to ETH)
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-900/50 border border-red-700 rounded text-red-200">
            {error}
          </div>
        )}

        {/* Status Message */}
        {status && (
          <div className="p-3 bg-yellow-900/50 border border-yellow-700 rounded text-yellow-200">
            {status}
          </div>
        )}

        {/* Success Result */}
        {result?.success && (
          <div className="p-4 bg-green-900/50 border border-green-700 rounded">
            <div className="text-green-400 font-semibold mb-2">
              Token Launch Initiated!
            </div>
            {result.payment && (
              <div className="text-gray-300 text-sm space-y-1">
                <div>Payment: ${result.payment.amount} USDC</div>
                <div>From: {result.payment.from?.slice(0, 10)}...</div>
                {result.payment.txHash && (
                  <div>
                    TX:{' '}
                    <a
                      href={`https://basescan.org/tx/${result.payment.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {result.payment.txHash.slice(0, 16)}...
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Launch Button */}
        <button
          onClick={handleLaunch}
          disabled={!isConnected || !tokenName || !tokenSymbol || launching}
          className={`w-full py-4 rounded font-bold text-lg ${
            !isConnected || !tokenName || !tokenSymbol || launching
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {launching
            ? 'Processing...'
            : `Launch Token (Pay $${paymentAmount} USDC)`}
        </button>
      </div>
    </div>
  );
}

/**
 * Create x402 payment header with EIP-3009 signature
 */
async function createX402PaymentHeader(
  amount: string,
  payTo: string,
  walletClient: any
): Promise<string> {
  const amountInAtomicUnits = parseUnits(amount, USDC_DECIMALS);
  const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;

  const authorization = {
    from: walletClient.account.address,
    to: payTo,
    value: amountInAtomicUnits.toString(),
    validAfter: Math.floor(Date.now() / 1000) - 60,
    validBefore: Math.floor(Date.now() / 1000) + 3600,
    nonce,
  };

  // EIP-712 domain for USDC on Base
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: 8453, // Base mainnet
    verifyingContract: USDC_ADDRESS,
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  // Sign the authorization
  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });

  // Create x402 payment payload
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature,
      authorization,
    },
  };

  // Encode as base64
  return btoa(JSON.stringify(payload));
}
```

## Step 4: Add to Page

```typescript
// app/token-launcher-x402/page.tsx
import X402TokenLauncher from '@/components/X402TokenLauncher';

export default function TokenLauncherX402Page() {
  return (
    <div className="min-h-screen bg-gray-950 py-12">
      <X402TokenLauncher />
    </div>
  );
}
```

## How It Works

### Payment Flow

```
1. User fills form and clicks "Launch Token"
2. POST /api/token-launcher/x402 → 402 Payment Required
3. User's wallet signs EIP-3009 USDC authorization
4. Retry POST with X-PAYMENT header
5. x402 facilitator settles USDC payment
6. Server processes token launch
7. Success response returned
```

### EIP-3009 (TransferWithAuthorization)

This is the key to x402. Instead of the user sending a transaction:

1. User **signs** an authorization message
2. The authorization allows someone else to transfer their USDC
3. The x402 facilitator uses this to move USDC in one atomic operation

Benefits:
- No user gas fees
- Instant settlement
- Single wallet interaction

## Customization

### Different Payment Amounts

```typescript
// Preset amounts
const PAYMENT_OPTIONS = [
  { label: 'Basic ($1)', value: '1.00' },
  { label: 'Standard ($5)', value: '5.00' },
  { label: 'Premium ($10)', value: '10.00' },
];

// In component
<select value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}>
  {PAYMENT_OPTIONS.map((opt) => (
    <option key={opt.value} value={opt.value}>{opt.label}</option>
  ))}
</select>
```

### Error Handling

```typescript
// Handle specific x402 errors
if (paidResponse.status === 402) {
  // Payment not accepted - maybe insufficient balance
  const error = await paidResponse.json();
  if (error.code === 'INSUFFICIENT_BALANCE') {
    setError('Insufficient USDC balance. Please add funds.');
  } else if (error.code === 'PAYMENT_EXPIRED') {
    setError('Payment authorization expired. Please try again.');
  }
}
```

### Check USDC Balance

```typescript
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

async function getUSDCBalance(address: string): Promise<string> {
  const balance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: [{
      inputs: [{ name: 'account', type: 'address' }],
      name: 'balanceOf',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    }],
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  });

  return formatUnits(balance as bigint, 6);
}
```

## Testing

### On Base Sepolia (Testnet)

Change the constants:
```typescript
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Sepolia USDC
const CHAIN_ID = 84532; // Base Sepolia
```

### Mock Payment (Development)

For local dev without real payments:
```typescript
// Skip payment in dev
if (process.env.NODE_ENV === 'development') {
  // Send without X-PAYMENT header
  const response = await fetch('/api/token-launcher/x402?skipPayment=true', ...);
}
```

## Common Issues

### "User rejected the request"
User clicked "Reject" in wallet. No action needed.

### "Invalid signature"
Wallet may not support EIP-712. Try MetaMask or Coinbase Wallet.

### "Insufficient allowance"
x402 uses EIP-3009 (transferWithAuthorization), not allowances. This error shouldn't occur.

### "Network mismatch"
User's wallet is on wrong network. Prompt them to switch to Base.

```typescript
import { useSwitchChain } from 'wagmi';

const { switchChain } = useSwitchChain();

// If wrong chain
if (walletClient.chain.id !== base.id) {
  await switchChain({ chainId: base.id });
}
```

## Summary

1. Connect wallet (wagmi)
2. Fill token form
3. POST to `/api/token-launcher/x402` → get 402
4. Sign EIP-3009 authorization with wallet
5. Retry with `X-PAYMENT` header
6. Payment settles, token launches

The user never sends a transaction - they just sign a message. The x402 facilitator handles the actual USDC transfer.
