# Token Wars Create API - Frontend Integration Guide

## The Error

```
Error: invalid_exact_evm_payload_authorization_value
```

This error occurs when the x402 payment authorization doesn't match what the backend expects.

---

## Understanding the Create Endpoint

### Endpoint: `POST /api/token-wars`

**Payment Scheme**: x402 "exact" - **MUST be exactly $1.00 USDC**

The create war endpoint uses a **FIXED $1.00 payment** via x402. The creator's initial dev buy is always $1.00 (not variable).

> **Important**: If you need variable creator buy amounts, you would need to modify the backend. Currently, war creation is fixed at $1.00.

---

## Why the Error Occurs

### Cause 1: Wrong Amount
The signed payment must be for **exactly $1.00 USDC** (1,000,000 atomic units).

```typescript
// ❌ WRONG - Variable amount
const amount = userSelectedAmount * 1_000_000; // e.g., 5_000_000 for $5

// ✅ CORRECT - Fixed $1.00
const amount = 1_000_000; // Always exactly $1.00
```

### Cause 2: Wrong Value Encoding
The authorization value must be encoded as a **STRING**, not a number.

```typescript
// ❌ WRONG
authorization: {
  value: 1000000  // Number
}

// ✅ CORRECT
authorization: {
  value: "1000000"  // String
}
```

### Cause 3: Wrong Token Address
Must use USDC on Base mainnet with correct checksum.

```typescript
// ✅ CORRECT
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
```

---

## Complete Frontend Implementation

### Step 1: Constants

```typescript
// USDC on Base mainnet (checksum address)
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// AI Wallet that receives payments
const AI_WALLET = "0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098";

// Fixed price for war creation - ALWAYS $1.00
const CREATE_WAR_PRICE = 1_000_000; // 1 USDC in atomic units (6 decimals)

// EIP-712 domain for USDC TransferWithAuthorization
const USDC_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: 8453, // Base mainnet
  verifyingContract: USDC_ADDRESS,
} as const;

// EIP-3009 types
const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
```

### Step 2: Generate Nonce

```typescript
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")) as `0x${string}`;
}
```

### Step 3: Sign Payment Authorization

```typescript
import { useWalletClient } from "wagmi";

async function signCreateWarPayment(walletClient: WalletClient) {
  const address = walletClient.account?.address;
  if (!address) throw new Error("Wallet not connected");

  const now = Math.floor(Date.now() / 1000);
  const nonce = generateNonce();

  // CRITICAL: Value must be STRING and exactly 1_000_000 for $1.00
  const authorization = {
    from: address,
    to: AI_WALLET,
    value: CREATE_WAR_PRICE.toString(), // "1000000" - MUST BE STRING
    validAfter: "0",
    validBefore: (now + 3600).toString(), // Valid for 1 hour
    nonce: nonce,
  };

  // Sign with EIP-712
  const signature = await walletClient.signTypedData({
    account: address,
    domain: USDC_DOMAIN,
    types: TRANSFER_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  return {
    authorization,
    signature,
  };
}
```

### Step 4: Build X-PAYMENT Header

```typescript
function buildPaymentHeader(
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  },
  signature: string
): string {
  // Build the x402 payload structure
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value, // String!
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
    },
  };

  // Base64 encode for X-PAYMENT header
  return btoa(JSON.stringify(payload));
}
```

### Step 5: Create War Request

```typescript
interface CreateWarParams {
  name: string;
  symbol: string;
  description?: string;
  targetAmount?: number;
  durationHours?: number; // Minimum 24 hours
  dexVote: "v4" | "aerodrome" | "hydrex";
  pairVote: "eth" | "wass";
  // Optional RAW ICO locks
  lockedDex?: "v4" | "aerodrome" | "hydrex";
  lockedPair?: "eth" | "wass";
  // Optional image
  image?: File;
}

async function createTokenWar(
  walletClient: WalletClient,
  params: CreateWarParams
) {
  // Step 1: Sign the payment ($1.00 fixed)
  const { authorization, signature } = await signCreateWarPayment(walletClient);

  // Step 2: Build X-PAYMENT header
  const paymentHeader = buildPaymentHeader(authorization, signature);

  // Step 3: Build form data
  const formData = new FormData();
  formData.append("name", params.name);
  formData.append("symbol", params.symbol);
  if (params.description) formData.append("description", params.description);
  if (params.targetAmount) formData.append("targetAmount", params.targetAmount.toString());
  if (params.durationHours) formData.append("durationHours", params.durationHours.toString());
  formData.append("dexVote", params.dexVote);
  formData.append("pairVote", params.pairVote);

  // RAW ICO lock options
  if (params.lockedDex) formData.append("lockedDex", params.lockedDex);
  if (params.lockedPair) formData.append("lockedPair", params.lockedPair);

  // Image upload
  if (params.image) formData.append("image", params.image);

  // Step 4: Make request with payment header
  const response = await fetch("https://api.applesnakes.com/api/token-wars", {
    method: "POST",
    headers: {
      "X-PAYMENT": paymentHeader,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create war");
  }

  return response.json();
}
```

---

## Complete React Hook

```typescript
import { useWalletClient } from "wagmi";
import { useState } from "react";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AI_WALLET = "0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098";
const CREATE_WAR_PRICE = 1_000_000;

const USDC_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: 8453,
  verifyingContract: USDC_ADDRESS,
} as const;

const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")) as `0x${string}`;
}

export function useCreateTokenWar() {
  const { data: walletClient } = useWalletClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createWar = async (params: {
    name: string;
    symbol: string;
    description?: string;
    targetAmount?: number;
    durationHours?: number;
    dexVote: "v4" | "aerodrome" | "hydrex";
    pairVote: "eth" | "wass";
    lockedDex?: "v4" | "aerodrome" | "hydrex";
    lockedPair?: "eth" | "wass";
    image?: File;
  }) => {
    if (!walletClient) {
      setError("Please connect your wallet");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const address = walletClient.account?.address;
      if (!address) throw new Error("No address");

      // Sign payment - ALWAYS $1.00
      const now = Math.floor(Date.now() / 1000);
      const nonce = generateNonce();

      const authorization = {
        from: address,
        to: AI_WALLET,
        value: CREATE_WAR_PRICE.toString(), // CRITICAL: String "1000000"
        validAfter: "0",
        validBefore: (now + 3600).toString(),
        nonce: nonce,
      };

      console.log("[CreateWar] Signing authorization:", authorization);

      const signature = await walletClient.signTypedData({
        account: address,
        domain: USDC_DOMAIN,
        types: TRANSFER_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: authorization,
      });

      console.log("[CreateWar] Signature obtained");

      // Build payment header
      const payload = {
        x402Version: 1,
        scheme: "exact",
        network: "base",
        payload: {
          signature,
          authorization: {
            from: authorization.from,
            to: authorization.to,
            value: authorization.value,
            validAfter: authorization.validAfter,
            validBefore: authorization.validBefore,
            nonce: authorization.nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));
      console.log("[CreateWar] Payment header built");

      // Build form data
      const formData = new FormData();
      formData.append("name", params.name);
      formData.append("symbol", params.symbol);
      if (params.description) formData.append("description", params.description);
      if (params.targetAmount) formData.append("targetAmount", params.targetAmount.toString());
      if (params.durationHours) formData.append("durationHours", Math.max(24, params.durationHours).toString());
      formData.append("dexVote", params.dexVote);
      formData.append("pairVote", params.pairVote);
      if (params.lockedDex) formData.append("lockedDex", params.lockedDex);
      if (params.lockedPair) formData.append("lockedPair", params.lockedPair);
      if (params.image) formData.append("image", params.image);

      console.log("[CreateWar] Sending request...");

      const response = await fetch("https://api.applesnakes.com/api/token-wars", {
        method: "POST",
        headers: {
          "X-PAYMENT": paymentHeader,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("[CreateWar] Error response:", data);
        throw new Error(data.error || "Failed to create war");
      }

      console.log("[CreateWar] Success:", data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[CreateWar] Error:", message);
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { createWar, isLoading, error };
}
```

---

## Troubleshooting

### Error: `invalid_exact_evm_payload_authorization_value`

**Check these things in order:**

1. **Value is EXACTLY 1_000_000** (not more, not less)
   ```typescript
   // The signed value MUST be 1000000 (string)
   value: "1000000"
   ```

2. **Value is a STRING, not a number**
   ```typescript
   // ❌ Wrong
   value: 1000000

   // ✅ Correct
   value: "1000000"
   ```

3. **All numeric fields in authorization are STRINGS**
   ```typescript
   authorization: {
     from: "0x...",        // address string
     to: "0x...",          // address string
     value: "1000000",     // STRING not number
     validAfter: "0",      // STRING not number
     validBefore: "...",   // STRING not number
     nonce: "0x...",       // hex string
   }
   ```

4. **Correct USDC domain**
   ```typescript
   const USDC_DOMAIN = {
     name: "USD Coin",     // Exact match required
     version: "2",         // Must be "2"
     chainId: 8453,        // Base mainnet
     verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
   };
   ```

5. **Correct recipient address**
   ```typescript
   const AI_WALLET = "0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098";
   ```

### Debug Logging

Add this before signing:
```typescript
console.log("Authorization to sign:", JSON.stringify({
  from: address,
  to: AI_WALLET,
  value: CREATE_WAR_PRICE.toString(),
  valueType: typeof CREATE_WAR_PRICE.toString(), // Should be "string"
  validAfter: "0",
  validBefore: (now + 3600).toString(),
  nonce: nonce,
}, null, 2));
```

Add this before sending:
```typescript
console.log("X-PAYMENT payload:", JSON.parse(atob(paymentHeader)));
```

### Error: `Payment verification failed`

- USDC allowance may be insufficient
- User may not have enough USDC balance
- Nonce may have already been used (regenerate it)

### Error: `Token deployment failed`

This happens AFTER payment succeeds. The war creation needs to deploy a token contract. Check:
- Backend wallet has enough ETH for gas
- Contract deployment service is running

---

## Request/Response Example

### Request
```http
POST /api/token-wars HTTP/1.1
Host: api.applesnakes.com
Content-Type: multipart/form-data
X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiYmFzZSIsInBheWxvYWQiOnsic2lnbmF0dXJlIjoiMHguLi4iLCJhdXRob3JpemF0aW9uIjp7ImZyb20iOiIweC4uLiIsInRvIjoiMHhFNWU5MTA4QjQ0NjcxNThDNDk4ZThjNkI2ZTM5YUUxMmY4YjBBMDk4IiwidmFsdWUiOiIxMDAwMDAwIiwidmFsaWRBZnRlciI6IjAiLCJ2YWxpZEJlZm9yZSI6IjE3MDAwMDAwMDAiLCJub25jZSI6IjB4Li4uIn19fQ==

--boundary
Content-Disposition: form-data; name="name"

My Test Token
--boundary
Content-Disposition: form-data; name="symbol"

TEST
--boundary
Content-Disposition: form-data; name="dexVote"

aerodrome
--boundary
Content-Disposition: form-data; name="pairVote"

eth
--boundary--
```

### Success Response
```json
{
  "success": true,
  "message": "Token War created!",
  "war": {
    "id": "war-abc123",
    "name": "My Test Token",
    "symbol": "TEST",
    "status": "active",
    "totalRaised": 1,
    "locks": {
      "lockedDex": null,
      "lockedPair": null,
      "isRawIco": false
    },
    "predictionMarkets": {
      "dexMarketId": "pm-xxx",
      "pairMarketId": "pm-yyy",
      "selloutMarketId": null
    }
  },
  "tokenAddress": "0x..."
}
```

---

## Summary Checklist

Before calling the create API:

- [ ] Wallet is connected
- [ ] Using Base mainnet (chain ID 8453)
- [ ] Payment value is EXACTLY "1000000" (string)
- [ ] All authorization fields are strings
- [ ] USDC domain matches exactly
- [ ] AI_WALLET address is correct
- [ ] Form data includes required fields (name, symbol, dexVote, pairVote)
- [ ] durationHours >= 24 (or omit for default 24)
