# Token Wars x402 Sale Capacity - Frontend Implementation Guide

This guide explains how to integrate the sale capacity feature into your frontend to prevent over-buying and show users how much is left in a Token War sale.

---

## Overview

The x402 endpoint now returns **sale capacity information** in the 402 response. This allows your frontend to:

1. **Show remaining capacity** before the user enters an amount
2. **Auto-adjust** the buy amount if user requests more than available
3. **Prevent over-buying** by capping the payment signature to what's actually available
4. **Show progress** toward the sale target

---

## Quick Start

### 1. Get Sale Info from 402 Response

```typescript
const response = await fetch('https://api.applesnakes.com/api/token-wars/buy/x402?amount=100', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    warId: 'war-abc123',
    dexVote: 'aerodrome',
    pairVote: 'eth'
  })
});

const data = await response.json();

// Sale capacity info
console.log('Remaining in sale:', data.sale.remainingCapacity);
console.log('Max you can buy:', data.sale.maxBuyAmount);
console.log('Progress:', data.sale.percentComplete + '%');

// Check if amount was capped
if (data.x402.wasCapped) {
  console.log('Amount was reduced:', data.x402.cappedReason);
  console.log('You requested:', data.x402.requestedAmount);
  console.log('Actual amount:', data.x402.amount);
}
```

---

## Complete React Hook Implementation

```typescript
// hooks/useTokenWarsBuy.ts
import { useState, useCallback } from 'react';
import { useWalletClient, useAccount } from 'wagmi';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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

interface SaleInfo {
  id: string;
  name: string;
  totalRaised: number;
  targetAmount: number | null;
  remainingCapacity: number;
  maxBuyAmount: number;
  percentComplete: number | null;
  isSoldOut: boolean;
}

interface BuyResult {
  success: boolean;
  message: string;
  txHash?: string;
  error?: string;
}

export function useTokenWarsBuy() {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saleInfo, setSaleInfo] = useState<SaleInfo | null>(null);
  const [wasCapped, setWasCapped] = useState(false);
  const [cappedReason, setCappedReason] = useState<string | null>(null);
  const [actualAmount, setActualAmount] = useState<number | null>(null);

  /**
   * Fetch sale capacity info without buying
   * Use this to show remaining capacity in the UI before user enters amount
   */
  const fetchSaleInfo = useCallback(async (warId: string): Promise<SaleInfo | null> => {
    try {
      // Request with amount=1 just to get sale info
      const response = await fetch(
        `https://api.applesnakes.com/api/token-wars/buy/x402?amount=1`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warId,
            dexVote: 'aerodrome', // Doesn't matter for info fetch
            pairVote: 'eth'
          })
        }
      );

      if (response.status === 402) {
        const data = await response.json();
        if (data.sale) {
          setSaleInfo(data.sale);
          return data.sale;
        }
      } else if (response.status === 400) {
        const data = await response.json();
        // Sale might be sold out
        if (data.sale) {
          setSaleInfo(data.sale);
          return data.sale;
        }
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch sale info:', err);
      return null;
    }
  }, []);

  /**
   * Execute the buy flow with automatic amount capping
   */
  const buy = useCallback(async (
    warId: string,
    requestedAmount: number,
    dexVote: 'v4' | 'aerodrome' | 'hydrex',
    pairVote: 'eth' | 'wass'
  ): Promise<BuyResult> => {
    if (!walletClient || !address) {
      return { success: false, message: 'Wallet not connected', error: 'NO_WALLET' };
    }

    setIsLoading(true);
    setError(null);
    setWasCapped(false);
    setCappedReason(null);

    try {
      // Step 1: Get payment requirements (and sale capacity)
      console.log(`[TokenWarsBuy] Requesting $${requestedAmount} buy...`);

      const initialResponse = await fetch(
        `https://api.applesnakes.com/api/token-wars/buy/x402?amount=${requestedAmount}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ warId, dexVote, pairVote })
        }
      );

      // Handle non-402 responses
      if (initialResponse.status === 400) {
        const errorData = await initialResponse.json();

        // Check if sold out
        if (errorData.sale?.isSoldOut) {
          setSaleInfo(errorData.sale);
          return {
            success: false,
            message: 'This Token War is sold out!',
            error: 'SOLD_OUT'
          };
        }

        // Other errors (insufficient capacity, etc)
        return {
          success: false,
          message: errorData.message || errorData.error,
          error: 'VALIDATION_ERROR'
        };
      }

      if (initialResponse.status !== 402) {
        return {
          success: false,
          message: 'Unexpected response from server',
          error: 'UNEXPECTED_RESPONSE'
        };
      }

      const paymentData = await initialResponse.json();
      const { paymentRequirements, x402, sale } = paymentData;

      // Update sale info
      if (sale) {
        setSaleInfo(sale);
      }

      // Check if amount was capped
      if (x402.wasCapped) {
        setWasCapped(true);
        setCappedReason(x402.cappedReason);
        console.log(`[TokenWarsBuy] Amount capped: $${requestedAmount} → $${x402.amount}`);
        console.log(`[TokenWarsBuy] Reason: ${x402.cappedReason}`);
      }

      // USE THE ACTUAL AMOUNT (may be capped)
      const finalAmount = x402.amount;
      setActualAmount(finalAmount);

      console.log(`[TokenWarsBuy] Final amount: $${finalAmount}`);

      // Step 2: Create EIP-712 signature
      const now = Math.floor(Date.now() / 1000);
      const validAfter = BigInt(now - 60);
      const validBefore = BigInt(now + (paymentRequirements.maxTimeoutSeconds || 3600));

      // Generate random nonce
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      const message = {
        from: address,
        to: paymentRequirements.payTo as `0x${string}`,
        value: BigInt(paymentRequirements.maxAmountRequired),
        validAfter,
        validBefore,
        nonce: nonce as `0x${string}`
      };

      console.log('[TokenWarsBuy] Signing authorization...');

      const signature = await walletClient.signTypedData({
        account: address,
        domain: USDC_DOMAIN,
        types: TRANSFER_WITH_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        message
      });

      console.log('[TokenWarsBuy] Signature obtained');

      // Step 3: Build X-PAYMENT header
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address.toLowerCase(),
            to: paymentRequirements.payTo.toLowerCase(),
            value: paymentRequirements.maxAmountRequired,
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce
          }
        }
      };

      const xPaymentHeader = btoa(JSON.stringify(paymentPayload));

      // Step 4: Submit with payment
      console.log('[TokenWarsBuy] Submitting payment...');

      const buyResponse = await fetch(
        `https://api.applesnakes.com/api/token-wars/buy/x402?amount=${finalAmount}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PAYMENT': xPaymentHeader
          },
          body: JSON.stringify({ warId, dexVote, pairVote })
        }
      );

      const result = await buyResponse.json();

      if (!buyResponse.ok || !result.success) {
        throw new Error(result.error || result.message || 'Buy failed');
      }

      console.log('[TokenWarsBuy] Success!', result);

      return {
        success: true,
        message: result.message,
        txHash: result.buy?.txHash
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('[TokenWarsBuy] Error:', err);
      return { success: false, message: errorMessage, error: 'BUY_FAILED' };
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, address]);

  return {
    buy,
    fetchSaleInfo,
    isLoading,
    error,
    saleInfo,
    wasCapped,
    cappedReason,
    actualAmount
  };
}
```

---

## React Component Example

```tsx
// components/TokenWarsBuyForm.tsx
import { useState, useEffect } from 'react';
import { useTokenWarsBuy } from '../hooks/useTokenWarsBuy';

interface Props {
  warId: string;
  warName: string;
}

export function TokenWarsBuyForm({ warId, warName }: Props) {
  const {
    buy,
    fetchSaleInfo,
    isLoading,
    error,
    saleInfo,
    wasCapped,
    cappedReason,
    actualAmount
  } = useTokenWarsBuy();

  const [amount, setAmount] = useState<string>('');
  const [dexVote, setDexVote] = useState<'v4' | 'aerodrome' | 'hydrex'>('aerodrome');
  const [pairVote, setPairVote] = useState<'eth' | 'wass'>('eth');
  const [showCappedWarning, setShowCappedWarning] = useState(false);

  // Fetch sale info on mount
  useEffect(() => {
    fetchSaleInfo(warId);
  }, [warId, fetchSaleInfo]);

  // Handle amount input with max validation
  const handleAmountChange = (value: string) => {
    const numValue = parseFloat(value) || 0;

    // Cap to max available
    if (saleInfo && numValue > saleInfo.maxBuyAmount) {
      setAmount(saleInfo.maxBuyAmount.toString());
      setShowCappedWarning(true);
    } else {
      setAmount(value);
      setShowCappedWarning(false);
    }
  };

  // Set amount to max available
  const handleMaxClick = () => {
    if (saleInfo) {
      setAmount(saleInfo.maxBuyAmount.toString());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (numAmount < 1) return;

    const result = await buy(warId, numAmount, dexVote, pairVote);

    if (result.success) {
      alert(result.message);
      setAmount('');
      // Refresh sale info
      fetchSaleInfo(warId);
    } else {
      alert(`Error: ${result.message}`);
    }
  };

  return (
    <div className="buy-form">
      <h2>Buy into {warName}</h2>

      {/* Sale Progress */}
      {saleInfo && (
        <div className="sale-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${saleInfo.percentComplete || 0}%` }}
            />
          </div>
          <div className="progress-text">
            ${saleInfo.totalRaised.toLocaleString()} / ${saleInfo.targetAmount?.toLocaleString() || '∞'} raised
            ({saleInfo.percentComplete?.toFixed(1) || 0}%)
          </div>
          <div className="remaining">
            <strong>${saleInfo.remainingCapacity.toLocaleString()}</strong> remaining
          </div>
        </div>
      )}

      {/* Sold Out State */}
      {saleInfo?.isSoldOut && (
        <div className="sold-out-banner">
          🎉 This Token War is SOLD OUT!
        </div>
      )}

      {/* Buy Form */}
      {!saleInfo?.isSoldOut && (
        <form onSubmit={handleSubmit}>
          {/* Amount Input */}
          <div className="input-group">
            <label>Amount (USDC)</label>
            <div className="input-with-max">
              <input
                type="number"
                min="1"
                max={saleInfo?.maxBuyAmount || 10000}
                step="1"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="Enter amount..."
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={handleMaxClick}
                className="max-button"
              >
                MAX (${saleInfo?.maxBuyAmount || 10000})
              </button>
            </div>

            {/* Warning if user tried to enter more than available */}
            {showCappedWarning && (
              <div className="warning">
                ⚠️ Amount capped to ${saleInfo?.maxBuyAmount} (remaining in sale)
              </div>
            )}
          </div>

          {/* DEX Vote */}
          <div className="input-group">
            <label>DEX Vote</label>
            <select value={dexVote} onChange={(e) => setDexVote(e.target.value as any)}>
              <option value="aerodrome">Aerodrome</option>
              <option value="v4">Uniswap V4</option>
              <option value="hydrex">Hydrex</option>
            </select>
          </div>

          {/* Pair Vote */}
          <div className="input-group">
            <label>Pair Vote</label>
            <select value={pairVote} onChange={(e) => setPairVote(e.target.value as any)}>
              <option value="eth">ETH</option>
              <option value="wass">WASS</option>
            </select>
          </div>

          {/* Amount Was Capped Warning */}
          {wasCapped && actualAmount && (
            <div className="capped-notice">
              ℹ️ Your buy was adjusted to ${actualAmount}: {cappedReason}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="error">
              ❌ {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !amount || parseFloat(amount) < 1}
            className="buy-button"
          >
            {isLoading ? 'Processing...' : `Buy $${amount || '0'} USDC`}
          </button>
        </form>
      )}

      <style jsx>{`
        .buy-form {
          max-width: 400px;
          padding: 20px;
          border: 1px solid #333;
          border-radius: 12px;
          background: #1a1a1a;
        }

        .sale-progress {
          margin-bottom: 20px;
        }

        .progress-bar {
          height: 8px;
          background: #333;
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #00ff88, #00cc66);
          transition: width 0.3s ease;
        }

        .progress-text {
          font-size: 14px;
          color: #888;
          margin-top: 8px;
        }

        .remaining {
          font-size: 16px;
          color: #00ff88;
          margin-top: 4px;
        }

        .sold-out-banner {
          background: linear-gradient(90deg, #ff6b6b, #ff8e53);
          padding: 16px;
          border-radius: 8px;
          text-align: center;
          font-size: 18px;
          font-weight: bold;
        }

        .input-group {
          margin-bottom: 16px;
        }

        .input-group label {
          display: block;
          margin-bottom: 6px;
          color: #888;
          font-size: 14px;
        }

        .input-with-max {
          display: flex;
          gap: 8px;
        }

        .input-with-max input {
          flex: 1;
          padding: 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #0a0a0a;
          color: white;
          font-size: 16px;
        }

        .max-button {
          padding: 12px 16px;
          background: #333;
          border: none;
          border-radius: 8px;
          color: #00ff88;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }

        .max-button:hover {
          background: #444;
        }

        select {
          width: 100%;
          padding: 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #0a0a0a;
          color: white;
          font-size: 16px;
        }

        .warning, .capped-notice {
          background: #332200;
          border: 1px solid #ff8800;
          padding: 10px;
          border-radius: 6px;
          font-size: 14px;
          color: #ffaa00;
          margin-top: 8px;
        }

        .capped-notice {
          background: #002233;
          border-color: #0088ff;
          color: #00aaff;
          margin-bottom: 16px;
        }

        .error {
          background: #330000;
          border: 1px solid #ff0000;
          padding: 10px;
          border-radius: 6px;
          font-size: 14px;
          color: #ff4444;
          margin-bottom: 16px;
        }

        .buy-button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(90deg, #00ff88, #00cc66);
          border: none;
          border-radius: 8px;
          color: black;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .buy-button:hover:not(:disabled) {
          opacity: 0.9;
        }

        .buy-button:disabled {
          background: #333;
          color: #666;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
```

---

## Key Points

### 1. Always Use `x402.amount`, Not Your Requested Amount

```typescript
// ❌ WRONG - Don't use the amount you requested
const amount = requestedAmount;

// ✅ CORRECT - Use the actual amount from the 402 response
const amount = data.x402.amount;
```

### 2. Check for Capping Before Signing

```typescript
if (data.x402.wasCapped) {
  // Inform user their amount was adjusted
  console.log(`Adjusted from $${data.x402.requestedAmount} to $${data.x402.amount}`);
  console.log(`Reason: ${data.x402.cappedReason}`);

  // Optionally ask for confirmation before proceeding
  if (!confirm(`Your buy was adjusted to $${data.x402.amount}. Continue?`)) {
    return;
  }
}
```

### 3. Use `sale.maxBuyAmount` for Input Validation

```typescript
// Set max attribute on input
<input
  type="number"
  max={saleInfo?.maxBuyAmount || 10000}
  ...
/>

// Or validate on change
if (inputAmount > saleInfo.maxBuyAmount) {
  setInputAmount(saleInfo.maxBuyAmount);
  showWarning('Amount capped to remaining capacity');
}
```

### 4. Handle Sold Out State

```typescript
if (response.status === 400) {
  const data = await response.json();
  if (data.sale?.isSoldOut) {
    // Show sold out UI
    setSoldOut(true);
    return;
  }
}
```

---

## Error Responses

### Sale Sold Out (400)
```json
{
  "error": "Sale is sold out",
  "message": "MYTOKEN Token War has reached its target of $1000",
  "sale": {
    "totalRaised": 1000,
    "targetAmount": 1000,
    "remainingCapacity": 0,
    "isSoldOut": true
  }
}
```

### Insufficient Remaining Capacity (400)
```json
{
  "error": "Insufficient remaining capacity",
  "message": "Only $0.50 remaining, minimum buy is $1",
  "sale": {
    "totalRaised": 999.50,
    "targetAmount": 1000,
    "remainingCapacity": 0.50,
    "isSoldOut": false
  }
}
```

---

## Summary

| Field | Use For |
|-------|---------|
| `x402.amount` | The actual amount to sign for (may be capped) |
| `x402.wasCapped` | Show warning to user that amount was adjusted |
| `x402.cappedReason` | Display reason for adjustment |
| `sale.maxBuyAmount` | Set max on input field |
| `sale.remainingCapacity` | Show "X remaining" in UI |
| `sale.percentComplete` | Progress bar |
| `sale.isSoldOut` | Disable buy form, show sold out state |
