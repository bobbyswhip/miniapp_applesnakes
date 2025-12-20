# Token Wars x402 Payment - Frontend Implementation Guide

This guide explains exactly how to implement the x402 payment flow in your frontend to buy into Token Wars using USDC on Base.

---

## Overview

The x402 protocol uses HTTP 402 "Payment Required" status to request payment. The flow is:

1. **Initial Request** → Backend returns 402 with payment requirements
2. **User Signs** → Frontend creates EIP-712 signature (gasless, no on-chain tx)
3. **Retry with Payment** → Frontend sends signed authorization in `X-PAYMENT` header
4. **Backend Verifies & Settles** → Coinbase facilitator verifies signature and executes USDC transfer

---

## Step 1: Initial Request (Get 402)

Make your initial POST request to the buy endpoint with the amount:

```typescript
const response = await fetch('https://api.applesnakes.com/api/token-wars/buy/x402?amount=5', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    warId: 'war-abc123',
    dexVote: 'aerodrome',
    pairVote: 'eth'
  })
});

// Should return 402 Payment Required
if (response.status === 402) {
  const data = await response.json();
  console.log('Payment requirements:', data.paymentRequirements);
}
```

### Expected 402 Response

```json
{
  "error": "Payment Required",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "5000000",
    "resource": "https://api.applesnakes.com/api/token-wars/buy/x402?amount=5",
    "description": "Payment of $5 USDC",
    "mimeType": "application/json",
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

### Key Fields to Extract

| Field | Description | Example |
|-------|-------------|---------|
| `maxAmountRequired` | Amount in atomic units (6 decimals for USDC) | `"5000000"` = $5.00 |
| `payTo` | Recipient address for the USDC transfer | `"0xE5e9033C57B4332283Cda19B39431CD716340098"` |
| `maxTimeoutSeconds` | How long the signature is valid | `60` seconds |

---

## Step 2: Create EIP-712 Signature

The frontend signs an EIP-712 typed data message for `TransferWithAuthorization` (EIP-3009). This is a **gasless signature** - no on-chain transaction is needed from the user.

### Constants

```typescript
// USDC Contract on Base Mainnet
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// EIP-712 Domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS
};

// EIP-712 Types for TransferWithAuthorization
const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};
```

### Generate Random Nonce

```typescript
function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### Create Authorization Message

```typescript
function createAuthorizationMessage(
  userAddress: string,
  payTo: string,
  amount: string, // atomic units from maxAmountRequired
  timeoutSeconds: number = 3600
) {
  const now = Math.floor(Date.now() / 1000);

  return {
    from: userAddress,
    to: payTo,
    value: BigInt(amount),
    validAfter: BigInt(now - 60),      // Valid from 1 minute ago (clock skew buffer)
    validBefore: BigInt(now + timeoutSeconds), // Valid for timeoutSeconds
    nonce: generateNonce()
  };
}
```

### Sign with Wallet (viem/wagmi example)

```typescript
import { useWalletClient } from 'wagmi';

async function signPayment(
  walletClient: WalletClient,
  userAddress: string,
  paymentRequirements: PaymentRequirements
) {
  const message = createAuthorizationMessage(
    userAddress,
    paymentRequirements.payTo,
    paymentRequirements.maxAmountRequired,
    paymentRequirements.maxTimeoutSeconds || 3600
  );

  const signature = await walletClient.signTypedData({
    account: userAddress,
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: message
  });

  return { signature, message };
}
```

---

## Step 3: Build X-PAYMENT Header

The `X-PAYMENT` header is a **Base64-encoded JSON string** containing the signature and authorization details.

### Payment Payload Structure

```typescript
interface X402PaymentPayload {
  x402Version: 1;
  scheme: 'exact';
  network: 'base';
  payload: {
    signature: string;      // 0x-prefixed 65-byte signature
    authorization: {
      from: string;         // User's wallet address (lowercase)
      to: string;           // payTo address (lowercase)
      value: string;        // Amount as STRING (not number!)
      validAfter: string;   // Unix timestamp as STRING
      validBefore: string;  // Unix timestamp as STRING
      nonce: string;        // 32-byte hex string with 0x prefix
    };
  };
}
```

### Build the Payload

```typescript
function buildPaymentPayload(
  signature: string,
  message: AuthorizationMessage
): string {
  const payload: X402PaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature: signature,
      authorization: {
        from: message.from.toLowerCase(),
        to: message.to.toLowerCase(),
        value: message.value.toString(),           // BigInt → string
        validAfter: message.validAfter.toString(), // BigInt → string
        validBefore: message.validBefore.toString(), // BigInt → string
        nonce: message.nonce
      }
    }
  };

  // Base64 encode
  return btoa(JSON.stringify(payload));
}
```

### CRITICAL: Value Types

All authorization fields must be **strings**, not numbers:

| Field | Type | Correct | Wrong |
|-------|------|---------|-------|
| `from` | string | `"0xabc..."` | - |
| `to` | string | `"0xdef..."` | - |
| `value` | string | `"5000000"` | `5000000` |
| `validAfter` | string | `"1734567890"` | `1734567890` |
| `validBefore` | string | `"1734571490"` | `1734571490` |
| `nonce` | string | `"0x7a3f..."` | - |

---

## Step 4: Retry with X-PAYMENT Header

Send the same request again, but include the `X-PAYMENT` header:

```typescript
async function submitPayment(
  paymentHeader: string,
  warId: string,
  amount: number,
  dexVote: string,
  pairVote: string
) {
  const response = await fetch(`https://api.applesnakes.com/api/token-wars/buy/x402?amount=${amount}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader  // Base64-encoded payment payload
    },
    body: JSON.stringify({
      warId,
      dexVote,
      pairVote
    })
  });

  if (response.ok) {
    const result = await response.json();
    console.log('Payment successful!', result);
    return result;
  } else {
    const error = await response.json();
    throw new Error(error.error || 'Payment failed');
  }
}
```

---

## Complete Example: React Hook

```typescript
import { useWalletClient, useAccount } from 'wagmi';
import { useState } from 'react';

// Constants
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const API_BASE = 'https://api.applesnakes.com';

const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS
} as const;

const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
} as const;

function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function useTokenWarsBuy() {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buyIntoWar(
    warId: string,
    amount: number, // USD amount (e.g., 5 for $5)
    dexVote: string,
    pairVote: string
  ) {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Get payment requirements
      console.log('[TokenWarsBuy] Step 1: Getting payment requirements...');

      const initialResponse = await fetch(
        `${API_BASE}/api/token-wars/buy/x402?amount=${amount}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ warId, dexVote, pairVote })
        }
      );

      if (initialResponse.status !== 402) {
        throw new Error(`Expected 402, got ${initialResponse.status}`);
      }

      const { paymentRequirements } = await initialResponse.json();
      console.log('[TokenWarsBuy] Payment requirements:', paymentRequirements);

      // Step 2: Create and sign authorization
      console.log('[TokenWarsBuy] Step 2: Signing authorization...');

      const now = Math.floor(Date.now() / 1000);
      const nonce = generateNonce();

      const message = {
        from: address,
        to: paymentRequirements.payTo as `0x${string}`,
        value: BigInt(paymentRequirements.maxAmountRequired),
        validAfter: BigInt(now - 60),
        validBefore: BigInt(now + (paymentRequirements.maxTimeoutSeconds || 3600)),
        nonce: nonce
      };

      console.log('[TokenWarsBuy] Signing for:', {
        from: message.from,
        to: message.to,
        amount: `$${amount} USDC`,
        validAfter: new Date(Number(message.validAfter) * 1000).toISOString(),
        validBefore: new Date(Number(message.validBefore) * 1000).toISOString()
      });

      const signature = await walletClient.signTypedData({
        account: address,
        domain: USDC_DOMAIN,
        types: TRANSFER_WITH_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: message
      });

      console.log('[TokenWarsBuy] Authorization signed (no on-chain tx)');

      // Step 3: Build X-PAYMENT header
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature: signature,
          authorization: {
            from: message.from.toLowerCase(),
            to: message.to.toLowerCase(),
            value: message.value.toString(),
            validAfter: message.validAfter.toString(),
            validBefore: message.validBefore.toString(),
            nonce: message.nonce
          }
        }
      };

      const xPaymentHeader = btoa(JSON.stringify(paymentPayload));
      console.log('[TokenWarsBuy] Payment payload built');

      // Step 4: Submit with payment
      console.log('[TokenWarsBuy] Step 3: Submitting to server...');

      const paidResponse = await fetch(
        `${API_BASE}/api/token-wars/buy/x402?amount=${amount}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PAYMENT': xPaymentHeader
          },
          body: JSON.stringify({ warId, dexVote, pairVote })
        }
      );

      const result = await paidResponse.json();
      console.log('[TokenWarsBuy] Server response:', result);

      if (!paidResponse.ok) {
        throw new Error(result.error || result.reason || 'Payment failed');
      }

      return result;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('[TokenWarsBuy] Error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { buyIntoWar, loading, error };
}
```

---

## Usage in Component

```tsx
import { useTokenWarsBuy } from './useTokenWarsBuy';

function BuyIntoWarButton({ warId }: { warId: string }) {
  const { buyIntoWar, loading, error } = useTokenWarsBuy();
  const [amount, setAmount] = useState(5);

  const handleBuy = async () => {
    try {
      const result = await buyIntoWar(warId, amount, 'aerodrome', 'eth');
      alert('Successfully bought into war!');
    } catch (err) {
      // Error is already set in hook
    }
  };

  return (
    <div>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        min={1}
        max={1000}
      />
      <button onClick={handleBuy} disabled={loading}>
        {loading ? 'Signing...' : `Buy $${amount} USDC`}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `"Payment verification failed"` | Signature doesn't match authorization | Check domain, types, and message values match exactly |
| `"Payment amount mismatch"` | Amount in URL doesn't match signed amount | Ensure `?amount=X` matches `maxAmountRequired` |
| `"Authorization expired"` | `validBefore` timestamp has passed | Sign with longer timeout or submit faster |
| `"Invalid payment recipient"` | `to` address doesn't match `payTo` | Use `payTo` from payment requirements |
| `"Signature verification failed"` | EIP-712 domain/types mismatch | Verify domain name is "USD Coin", version is "2" |

### Debugging Checklist

1. **Check domain values**:
   - `name`: Must be `"USD Coin"` (exactly)
   - `version`: Must be `"2"` (string, not number)
   - `chainId`: Must be `8453` (Base mainnet)
   - `verifyingContract`: Must be `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

2. **Check authorization values**:
   - All values must be **strings** in the payload
   - `from` and `to` should be **lowercase**
   - `value` is in **atomic units** (6 decimals)
   - `nonce` must be exactly 32 bytes (66 characters with 0x prefix)

3. **Check timing**:
   - `validAfter` should be in the past (use `now - 60` for buffer)
   - `validBefore` should be in the future (at least 60 seconds)
   - Server clock might differ slightly from client

---

## USDC Approval Not Required

Unlike traditional ERC-20 transfers, **EIP-3009 TransferWithAuthorization does NOT require prior approval**. The signature itself authorizes the transfer.

The user only needs:
1. Sufficient USDC balance
2. To sign the EIP-712 message (gasless)

---

## Testing

### Check USDC Balance First

```typescript
import { formatUnits } from 'viem';
import { useBalance } from 'wagmi';

function USDCBalance() {
  const { address } = useAccount();
  const { data: balance } = useBalance({
    address,
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  });

  return (
    <div>
      USDC Balance: ${balance ? formatUnits(balance.value, 6) : '0.00'}
    </div>
  );
}
```

### Minimum Amount

The backend requires minimum $1 USD (`minAmount: 1`), so `amount` parameter must be at least 1.

---

## Quick Reference

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/token-wars/buy/x402?amount=5` | POST | Buy into war with x402 payment |

### Headers

| Header | Value | When |
|--------|-------|------|
| `Content-Type` | `application/json` | Always |
| `X-PAYMENT` | Base64 JSON | On retry after 402 |

### Constants

```
USDC Address: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Chain ID: 8453 (Base Mainnet)
Domain Name: "USD Coin"
Domain Version: "2"
USDC Decimals: 6 (so $5 = 5000000 atomic units)
AI Wallet (payTo): 0xE5e9033C57B4332283Cda19B39431CD716340098
```
