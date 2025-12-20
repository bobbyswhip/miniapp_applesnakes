# Token Wars Dynamic x402 Payment - Frontend Implementation Guide

## Overview

The `/api/token-wars/buy/x402` endpoint supports **variable payment amounts** ($1-$10,000 USDC) using native x402 protocol with dynamic pricing.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PAYMENT FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Frontend sends request with amount                               │
│     POST /api/token-wars/buy/x402?amount=5                          │
│     Body: { warId, dexVote, pairVote }                              │
│                                                                      │
│  2. Server returns 402 with payment requirements                     │
│     { paymentRequirements: { maxAmountRequired: "5000000" } }       │
│                                                                      │
│  3. Frontend prompts wallet to sign for $5 USDC                     │
│     Uses x402 client library or manual EIP-712 signing              │
│                                                                      │
│  4. Frontend retries with X-PAYMENT header                          │
│     POST /api/token-wars/buy/x402?amount=5                          │
│     Headers: { X-PAYMENT: <base64-signed-payment> }                 │
│                                                                      │
│  5. Server verifies, settles payment, records buy                   │
│     Returns success with war/wallet/consensus data                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Option 1: Using x402 Client Library (Recommended)

```bash
npm install x402
```

```typescript
import { exact } from 'x402/schemes';
import { useWalletClient } from 'wagmi';

async function buyIntoWar(warId: string, amount: number, dexVote: string, pairVote: string) {
  const { data: walletClient } = useWalletClient();

  // Step 1: Make initial request to get payment requirements
  const initialResponse = await fetch(`/api/token-wars/buy/x402?amount=${amount}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ warId, dexVote, pairVote }),
  });

  // Step 2: Check if payment is required (402 response)
  if (initialResponse.status === 402) {
    const { paymentRequirements } = await initialResponse.json();

    // Step 3: Create and sign payment using x402
    const paymentHeader = await exact.evm.createPaymentHeader(
      walletClient,
      1, // x402 version
      paymentRequirements
    );

    // Step 4: Retry with payment header
    const paidResponse = await fetch(`/api/token-wars/buy/x402?amount=${amount}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader,
      },
      body: JSON.stringify({ warId, dexVote, pairVote }),
    });

    return paidResponse.json();
  }

  return initialResponse.json();
}
```

### Option 2: Manual Implementation (No x402 Library)

```typescript
import { useWalletClient, useAccount } from 'wagmi';
import { parseUnits, toHex } from 'viem';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

// EIP-712 domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS as `0x${string}`,
};

// TransferWithAuthorization types
const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

function generateNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return toHex(randomBytes);
}

async function buyIntoWarManual(
  walletClient: any,
  userAddress: string,
  warId: string,
  amount: number,
  dexVote: string,
  pairVote: string
) {
  // Step 1: Initial request to get 402
  const initialResponse = await fetch(`/api/token-wars/buy/x402?amount=${amount}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ warId, dexVote, pairVote }),
  });

  if (initialResponse.status !== 402) {
    return initialResponse.json();
  }

  // Step 2: Build authorization message
  const atomicAmount = parseUnits(amount.toString(), 6); // USDC has 6 decimals
  const nonce = generateNonce();
  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0;
  const validBefore = now + 3600; // 1 hour

  const message = {
    from: userAddress as `0x${string}`,
    to: AI_WALLET as `0x${string}`,
    value: atomicAmount,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: nonce,
  };

  // Step 3: Sign with wallet
  const signature = await walletClient.signTypedData({
    account: userAddress as `0x${string}`,
    domain: USDC_DOMAIN,
    types: TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  // Step 4: Build x402 payment payload
  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature,
      authorization: {
        from: userAddress.toLowerCase(),
        to: AI_WALLET.toLowerCase(),
        value: atomicAmount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce: nonce,
      },
    },
  };

  // Step 5: Base64 encode and retry
  const xPaymentHeader = btoa(JSON.stringify(paymentPayload));

  const paidResponse = await fetch(`/api/token-wars/buy/x402?amount=${amount}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': xPaymentHeader,
    },
    body: JSON.stringify({ warId, dexVote, pairVote }),
  });

  return paidResponse.json();
}
```

---

## Complete React Component

```tsx
// components/TokenWarsBuyX402.tsx
import { useState } from 'react';
import { useWalletClient, useAccount } from 'wagmi';
import { parseUnits, toHex } from 'viem';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS as `0x${string}`,
};

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

interface TokenWarsBuyProps {
  warId: string;
  warName: string;
  warSymbol: string;
  onSuccess?: (data: any) => void;
}

export function TokenWarsBuyX402({ warId, warName, warSymbol, onSuccess }: TokenWarsBuyProps) {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const [amount, setAmount] = useState(1);
  const [dexVote, setDexVote] = useState<'v4' | 'aerodrome' | 'hydrex'>('aerodrome');
  const [pairVote, setPairVote] = useState<'eth' | 'wass'>('eth');
  const [status, setStatus] = useState<'idle' | 'requesting' | 'signing' | 'processing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleBuy = async () => {
    if (!walletClient || !address) {
      setError('Please connect your wallet');
      return;
    }

    setStatus('requesting');
    setError(null);
    setResult(null);

    try {
      // Step 1: Initial request to get payment requirements
      console.log(`Requesting $${amount} buy into ${warSymbol}...`);

      const initialResponse = await fetch(`/api/token-wars/buy/x402?amount=${amount}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warId, dexVote, pairVote }),
      });

      // If not 402, something went wrong or payment not required
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (!initialResponse.ok) {
          throw new Error(data.error || 'Request failed');
        }
        setResult(data);
        setStatus('idle');
        onSuccess?.(data);
        return;
      }

      // Step 2: Got 402 - need to sign payment
      setStatus('signing');
      console.log('Got 402 response, signing payment...');

      // Generate authorization
      const atomicAmount = parseUnits(amount.toString(), 6);
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const now = Math.floor(Date.now() / 1000);

      const message = {
        from: address as `0x${string}`,
        to: AI_WALLET as `0x${string}`,
        value: atomicAmount,
        validAfter: BigInt(0),
        validBefore: BigInt(now + 3600),
        nonce: nonce as `0x${string}`,
      };

      // Sign with wallet (user will see popup)
      const signature = await walletClient.signTypedData({
        account: address,
        domain: USDC_DOMAIN,
        types: TRANSFER_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
      });

      // Build payment payload
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address.toLowerCase(),
            to: AI_WALLET.toLowerCase(),
            value: atomicAmount.toString(),
            validAfter: '0',
            validBefore: (now + 3600).toString(),
            nonce: nonce,
          },
        },
      };

      // Step 3: Retry with payment
      setStatus('processing');
      console.log('Payment signed, submitting...');

      const xPaymentHeader = btoa(JSON.stringify(paymentPayload));

      const paidResponse = await fetch(`/api/token-wars/buy/x402?amount=${amount}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': xPaymentHeader,
        },
        body: JSON.stringify({ warId, dexVote, pairVote }),
      });

      const data = await paidResponse.json();

      if (!paidResponse.ok || !data.success) {
        throw new Error(data.error || 'Payment failed');
      }

      console.log('Buy successful!', data);
      setResult(data);
      onSuccess?.(data);

    } catch (err) {
      console.error('Buy failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStatus('idle');
    }
  };

  const statusMessages = {
    idle: `Buy $${amount} USDC`,
    requesting: 'Requesting payment...',
    signing: 'Please sign in wallet...',
    processing: 'Processing payment...',
  };

  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-700">
      <h3 className="text-xl font-bold text-white mb-4">
        Buy into {warName} ({warSymbol})
      </h3>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Amount (USDC)</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={10000}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
            className="w-32 px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
            disabled={status !== 'idle'}
          />
          <span className="text-gray-400">= {amount} votes</span>
        </div>
      </div>

      {/* Quick Amount Buttons */}
      <div className="flex gap-2 mb-4">
        {[1, 5, 10, 25, 50, 100].map((preset) => (
          <button
            key={preset}
            onClick={() => setAmount(preset)}
            disabled={status !== 'idle'}
            className={`px-3 py-1 rounded text-sm transition ${
              amount === preset
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            ${preset}
          </button>
        ))}
      </div>

      {/* DEX Vote */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Vote for DEX</label>
        <div className="flex gap-4">
          {(['v4', 'aerodrome', 'hydrex'] as const).map((dex) => (
            <label key={dex} className="flex items-center gap-2 text-white cursor-pointer">
              <input
                type="radio"
                name="dexVote"
                value={dex}
                checked={dexVote === dex}
                onChange={() => setDexVote(dex)}
                disabled={status !== 'idle'}
                className="accent-blue-500"
              />
              <span className="capitalize">{dex === 'v4' ? 'Uniswap V4' : dex}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Pair Vote */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">Vote for Pair</label>
        <div className="flex gap-4">
          {(['eth', 'wass'] as const).map((pair) => (
            <label key={pair} className="flex items-center gap-2 text-white cursor-pointer">
              <input
                type="radio"
                name="pairVote"
                value={pair}
                checked={pairVote === pair}
                onChange={() => setPairVote(pair)}
                disabled={status !== 'idle'}
                className="accent-blue-500"
              />
              <span className="uppercase">{pair}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Buy Button */}
      <button
        onClick={handleBuy}
        disabled={status !== 'idle' || !walletClient}
        className={`w-full py-3 px-6 rounded-lg font-semibold transition ${
          status !== 'idle'
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {statusMessages[status]}
      </button>

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-200">
          {error}
        </div>
      )}

      {/* Success Message */}
      {result?.success && (
        <div className="mt-4 p-4 bg-green-900/50 border border-green-500 rounded-lg">
          <p className="text-green-200 font-medium">{result.message}</p>
          <div className="mt-2 text-sm text-green-300">
            <p>Amount: ${result.buy?.amount} USDC</p>
            <p>Your share: {result.wallet?.sharePercent?.toFixed(2)}%</p>
            <p>Total raised: ${result.war?.totalRaised}</p>
          </div>
        </div>
      )}

      {/* Info */}
      <p className="mt-4 text-xs text-gray-500">
        Each $1 = 1 share = 1 vote. Your votes help decide which DEX and trading pair the token launches on.
        Payment uses x402 protocol with EIP-3009 USDC authorization.
      </p>
    </div>
  );
}
```

---

## API Reference

### POST `/api/token-wars/buy/x402`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | number | Yes | Dollar amount to pay ($1-$10,000) |

**Request Body:**
```json
{
  "warId": "war-123456789-abc123",
  "dexVote": "aerodrome",
  "pairVote": "eth"
}
```

**Headers (First Request):**
```
Content-Type: application/json
```

**Headers (Second Request with Payment):**
```
Content-Type: application/json
X-PAYMENT: <base64-encoded-payment-payload>
```

---

### Response: 402 Payment Required

Returned on first request (no X-PAYMENT header):

```json
{
  "error": "Payment Required",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "5000000",
    "resource": "https://yoursite.com/api/token-wars/buy/x402?amount=5",
    "description": "Payment of $5 USDC",
    "mimeType": "application/json",
    "payTo": "0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098",
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

---

### Response: Success

Returned after valid payment:

```json
{
  "success": true,
  "message": "Successfully joined TEST Token War with $5 USDC! Voted for aerodrome/eth.",
  "buy": {
    "warId": "war-123456789-abc123",
    "amount": 5,
    "txHash": "x402-dynamic-1734200000000-5",
    "wallet": "0x...",
    "timestamp": 1734200000000,
    "dexVote": "aerodrome",
    "pairVote": "eth"
  },
  "war": {
    "id": "war-123456789-abc123",
    "name": "TEST Token",
    "symbol": "TEST",
    "totalRaised": 15,
    "targetAmount": 1000,
    "participantCount": 3,
    "endsAt": 1734286400000,
    "timeRemainingMs": 86400000,
    "status": "active"
  },
  "wallet": {
    "totalContribution": 5,
    "sharePercent": 33.33
  },
  "consensus": {
    "dex": {
      "leading": "aerodrome",
      "v4": { "votes": 0, "percent": 0 },
      "aerodrome": { "votes": 10, "percent": 66.67 },
      "hydrex": { "votes": 5, "percent": 33.33 },
      "isTie": false
    },
    "pair": {
      "leading": "eth",
      "eth": { "votes": 15, "percent": 100 },
      "wass": { "votes": 0, "percent": 0 },
      "isTie": false
    },
    "totalVotes": 15
  }
}
```

---

## X-PAYMENT Header Format

The `X-PAYMENT` header is a base64-encoded JSON object:

```typescript
// Before base64 encoding:
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base",
  "payload": {
    "signature": "0x...",  // EIP-712 signature (65 bytes)
    "authorization": {
      "from": "0x...",           // User's wallet address
      "to": "0xe5e9108b...",     // AI_WALLET (recipient)
      "value": "5000000",        // Amount in atomic units (6 decimals)
      "validAfter": "0",         // Unix timestamp (0 = immediately valid)
      "validBefore": "1734200000", // Unix timestamp (expiry)
      "nonce": "0x..."           // Random 32-byte hex string
    }
  }
}
```

---

## Error Responses

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `amount is required` | Missing `?amount=X` query param |
| 400 | `Amount must be between $1 and $10000` | Amount out of range |
| 400 | `warId is required` | Missing warId in body |
| 400 | `Payment amount mismatch` | Signed amount differs from requested |
| 402 | `Payment verification failed` | Invalid signature or insufficient balance |
| 404 | `Token War not found` | Invalid warId |

---

## Comparison: Endpoints

| Feature | `/buy` | `/buy/verified` | `/buy/x402` |
|---------|--------|-----------------|-------------|
| Protocol | x402 | EIP-3009 | x402 |
| Amount | Fixed $1 | Variable $1-$10k | Variable $1-$10k |
| Library | x402-next | viem only | x402 or viem |
| Facilitator | Required | No | Required |
| Gas | Facilitator pays | Server pays | Facilitator pays |

---

## Testing

```bash
# Step 1: Get 402 response
curl -X POST "http://localhost:3000/api/token-wars/buy/x402?amount=5" \
  -H "Content-Type: application/json" \
  -d '{"warId":"war-123","dexVote":"aerodrome","pairVote":"eth"}'

# Response: 402 with paymentRequirements

# Step 2: Sign payment in frontend, then retry with X-PAYMENT header
```

---

## Troubleshooting

### "amount is required"
Include `?amount=X` in the URL on BOTH requests (initial and retry).

### "Payment amount mismatch"
The amount in your query param must match the amount you signed for.

### "Payment verification failed"
- Check you're on Base mainnet (chainId 8453)
- Ensure USDC balance is sufficient
- Verify signature is for the correct domain (USD Coin, version 2)

### "Token War not found"
The warId doesn't exist or has a typo.

### Wallet popup doesn't appear
Make sure you're calling `walletClient.signTypedData()` and the wallet is connected.
