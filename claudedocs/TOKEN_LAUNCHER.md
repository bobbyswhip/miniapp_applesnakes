# X402 Verified Token Launcher - Complete Frontend Implementation

## Overview

The verified token launcher uses a **simplified payment flow**:
1. Your frontend makes a request
2. Server returns `402 Payment Required` with payment details
3. Your frontend sends USDC directly via `transfer()`
4. Your frontend retries with payment proof headers
5. Server verifies the tx hash and processes request

**IMPORTANT**: This guide uses direct USDC transfer + proof headers (not the complex x402 EIP-3009 signature flow).

## Backend Endpoints

| Endpoint | Method | Price | Description |
|----------|--------|-------|-------------|
| `/api/verified-launcher/verify` | GET | Free | Get requirements info |
| `/api/verified-launcher/verify` | POST | $0.50 USDC | Verify image style |
| `/api/verified-launcher/launch` | GET | Free | Get launch requirements |
| `/api/verified-launcher/launch` | POST | $1.00+ USDC | Launch token |

**Base URL:** `http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3000`

**Payment Recipient:** `0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098`

**USDC Contract (Base):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## The 402 Response

When you POST without payment, you get:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "500000",
    "payTo": "0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }]
}
```

Key fields:
- `maxAmountRequired`: Amount in USDC smallest units (500000 = $0.50)
- `payTo`: Address to send USDC to
- `asset`: USDC contract address

## Payment Headers (Simple Approach)

After sending USDC, retry your request with these headers:

```typescript
headers: {
  "Content-Type": "application/json",
  "X-Payment-Amount": "0.50",        // Amount in USDC (human readable)
  "X-Payment-Tx-Hash": "0x...",      // The USDC transfer tx hash
  "X-Payment-From": "0x..."          // Your wallet address
}
```

**Do NOT use the complex X-PAYMENT base64 header** - it requires EIP-3009 signature format that is hard to implement correctly.

## Complete React Implementation

### 1. Install Dependencies

```bash
npm install viem wagmi @tanstack/react-query
```

### 2. Constants File

```typescript
// lib/x402-constants.ts

export const X402_CONFIG = {
  // Backend API
  API_BASE_URL: "http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3000",

  // Payment recipient (AI Wallet)
  PAYMENT_RECIPIENT: "0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098" as const,

  // USDC on Base
  USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
  USDC_DECIMALS: 6,

  // Prices
  VERIFY_PRICE_USDC: 0.50,
  MIN_LAUNCH_PRICE_USDC: 1.00,

  // Chain
  CHAIN_ID: 8453, // Base mainnet
};

export const USDC_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;
```

### 3. X402 Client Hook (Simple Version)

```typescript
// hooks/useX402Simple.ts

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { X402_CONFIG, USDC_ABI } from "@/lib/x402-constants";

interface X402PaymentDetails {
  payTo: string;
  amount: string;
  asset: string;
}

interface X402Response<T> {
  success: boolean;
  data?: T;
  error?: string;
  paymentRequired?: boolean;
  paymentDetails?: X402PaymentDetails;
}

export function useX402Simple() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Parse the 402 response to extract payment details
   */
  const parse402Response = (responseData: any): X402PaymentDetails | null => {
    try {
      if (responseData.accepts && responseData.accepts.length > 0) {
        const accept = responseData.accepts[0];
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
   * Pay USDC to the specified address via direct transfer
   */
  const payUsdc = async (to: string, amountRaw: string): Promise<string> => {
    if (!address) throw new Error("Wallet not connected");

    console.log(`[X402] Paying ${amountRaw} USDC units to ${to}`);

    // Execute USDC transfer
    const txHash = await writeContractAsync({
      address: X402_CONFIG.USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [to as `0x${string}`, BigInt(amountRaw)]
    });

    console.log(`[X402] Payment tx: ${txHash}`);

    // Wait for confirmation
    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`[X402] Payment confirmed`);
    }

    return txHash;
  };

  /**
   * Make an x402-enabled request using simple payment headers
   * Handles 402 responses, payment, and retry automatically
   */
  const x402Request = useCallback(async <T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST";
      body?: any;
      customAmount?: number; // For launch, allow custom amount in USDC
    } = {}
  ): Promise<X402Response<T>> => {
    const { method = "POST", body, customAmount } = options;

    if (!isConnected || !address) {
      return { success: false, error: "Wallet not connected" };
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `${X402_CONFIG.API_BASE_URL}${endpoint}`;

      // Step 1: Make initial request
      console.log(`[X402] Initial request to ${url}`);

      const initialResponse = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // If not 402, return the response
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (!initialResponse.ok) {
          return { success: false, error: data.error || "Request failed" };
        }
        return { success: true, data };
      }

      // Step 2: Parse 402 response
      console.log(`[X402] Got 402 Payment Required`);
      const paymentResponse = await initialResponse.json();
      const paymentDetails = parse402Response(paymentResponse);

      if (!paymentDetails) {
        return { success: false, error: "Could not parse payment details" };
      }

      console.log(`[X402] Payment details:`, paymentDetails);

      // Step 3: Calculate payment amount
      let paymentAmount = paymentDetails.amount;
      let paymentAmountUsdc = parseInt(paymentAmount) / 1e6; // Convert to USDC

      // If custom amount provided (for launch), use that instead
      if (customAmount && customAmount > 0) {
        paymentAmount = parseUnits(customAmount.toString(), X402_CONFIG.USDC_DECIMALS).toString();
        paymentAmountUsdc = customAmount;
        console.log(`[X402] Using custom amount: ${customAmount} USDC (${paymentAmount} units)`);
      }

      // Step 4: Execute payment (direct USDC transfer)
      console.log(`[X402] Executing payment of ${paymentAmount} units...`);
      const txHash = await payUsdc(paymentDetails.payTo, paymentAmount);

      // Step 5: Retry with SIMPLE payment headers (not the complex X-PAYMENT format)
      console.log(`[X402] Retrying request with payment proof headers...`);

      const retryResponse = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          // Simple payment proof headers
          "X-Payment-Amount": paymentAmountUsdc.toString(),
          "X-Payment-Tx-Hash": txHash,
          "X-Payment-From": address,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await retryResponse.json();

      if (!retryResponse.ok) {
        return { success: false, error: data.error || "Request failed after payment" };
      }

      return { success: true, data };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`[X402] Error:`, err);
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, payUsdc, publicClient]);

  return {
    x402Request,
    isLoading,
    error,
    isConnected,
    address,
  };
}
```

### 4. Token Launcher Component

```tsx
// components/TokenLauncher.tsx

"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useX402Simple } from "@/hooks/useX402Simple";
import { X402_CONFIG } from "@/lib/x402-constants";

interface VerifyResponse {
  success: boolean;
  verified: boolean;
  confidence: number;
  reason: string;
  verificationToken: string | null;
  ipfsUrl: string | null;
  imageCid: string | null;
  hasCuteFace: boolean;
  bonusApplied: boolean;
}

interface LaunchResponse {
  success: boolean;
  launchId: string;
  message: string;
  token: {
    name: string;
    symbol: string;
    imageCid: string;
    imageUrl: string;
  };
  result?: {
    tokenAddress: string;
  };
}

type Step = "upload" | "verifying" | "verified" | "launching" | "complete" | "error";

export function TokenLauncher() {
  const { address, isConnected } = useAccount();
  const { x402Request, isLoading } = useX402Simple();

  // State
  const [step, setStep] = useState<Step>("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [verifiedIpfsUrl, setVerifiedIpfsUrl] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [launchResult, setLaunchResult] = useState<LaunchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [launchAmount, setLaunchAmount] = useState(5); // $5 default

  /**
   * Handle image selection
   */
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (1MB max)
    if (file.size > 1024 * 1024) {
      setError("Image must be less than 1MB");
      return;
    }

    // Validate file type
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      setError("Image must be PNG, JPG, GIF, or WebP");
      return;
    }

    setImageFile(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  /**
   * Convert file to base64 (without data URL prefix)
   */
  const fileToBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:image/xxx;base64, prefix
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * Step 1: Verify image (pays $0.50 USDC)
   */
  const handleVerify = async () => {
    if (!imageFile || !address) return;

    setStep("verifying");
    setError(null);

    try {
      const base64 = await fileToBase64(imageFile);

      const result = await x402Request<VerifyResponse>("/api/verified-launcher/verify", {
        method: "POST",
        body: {
          imageData: base64,
          walletAddress: address,
          contentType: imageFile.type
        }
      });

      if (!result.success) {
        throw new Error(result.error || "Verification failed");
      }

      setVerifyResult(result.data!);

      if (result.data!.verified) {
        setVerifiedIpfsUrl(result.data!.ipfsUrl);
        setStep("verified");
      } else {
        setError(`Verification failed: ${result.data!.reason}`);
        setStep("upload");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setStep("error");
    }
  };

  /**
   * Step 2: Launch token (pays custom USDC amount)
   */
  const handleLaunch = async () => {
    if (!address || !tokenName || !tokenSymbol) return;

    setStep("launching");
    setError(null);

    try {
      const result = await x402Request<LaunchResponse>("/api/verified-launcher/launch", {
        method: "POST",
        body: {
          name: tokenName,
          symbol: tokenSymbol.toUpperCase(),
          walletAddress: address
        },
        customAmount: launchAmount // Use custom amount for dev buy
      });

      if (!result.success) {
        throw new Error(result.error || "Launch failed");
      }

      setLaunchResult(result.data!);
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
      setStep("error");
    }
  };

  /**
   * Reset to start over
   */
  const handleReset = () => {
    setStep("upload");
    setImageFile(null);
    setImagePreview(null);
    setVerifiedIpfsUrl(null);
    setVerifyResult(null);
    setLaunchResult(null);
    setError(null);
    setTokenName("");
    setTokenSymbol("");
  };

  // Not connected state
  if (!isConnected) {
    return (
      <div className="p-6 bg-gray-100 rounded-lg text-center">
        <h2 className="text-xl font-bold mb-4">Connect Your Wallet</h2>
        <p className="text-gray-600">
          Please connect your wallet to use the token launcher.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Token Launcher</h1>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Step 1: Upload & Verify */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            {imagePreview ? (
              <div>
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="max-w-xs mx-auto mb-4 rounded"
                />
                <button
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  Remove Image
                </button>
              </div>
            ) : (
              <div>
                <p className="mb-2">Select an image for your token</p>
                <p className="text-sm text-gray-500 mb-4">
                  PNG, JPG, GIF, or WebP (max 1MB)
                </p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleImageSelect}
                  className="hidden"
                  id="image-upload"
                />
                <label
                  htmlFor="image-upload"
                  className="cursor-pointer bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  Choose Image
                </label>
              </div>
            )}
          </div>

          {imageFile && (
            <button
              onClick={handleVerify}
              disabled={isLoading}
              className="w-full bg-green-500 text-white px-4 py-3 rounded-lg hover:bg-green-600 disabled:bg-gray-400"
            >
              {isLoading ? "Processing..." : `Verify Image ($${X402_CONFIG.VERIFY_PRICE_USDC} USDC)`}
            </button>
          )}

          <p className="text-sm text-gray-500 text-center">
            Verification costs ${X402_CONFIG.VERIFY_PRICE_USDC} USDC. Your image will be
            checked against the AppleSnakes art style.
          </p>
        </div>
      )}

      {/* Step 1b: Verifying */}
      {step === "verifying" && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg">Verifying your image...</p>
          <p className="text-sm text-gray-500">Please confirm the transaction in your wallet</p>
        </div>
      )}

      {/* Step 2: Verified - Enter Token Details */}
      {step === "verified" && verifyResult && (
        <div className="space-y-6">
          {/* Verification Success */}
          <div className="bg-green-100 border border-green-400 p-4 rounded">
            <h3 className="font-bold text-green-700 mb-2">Image Verified!</h3>
            <p className="text-green-600">
              Confidence: {verifyResult.confidence}%
            </p>
            <p className="text-sm text-green-600">{verifyResult.reason}</p>
            {verifyResult.hasCuteFace && (
              <p className="text-sm text-green-600 mt-1">
                Cute face bonus applied! (+10 points)
              </p>
            )}
          </div>

          {/* Show IPFS Image */}
          {verifiedIpfsUrl && (
            <div className="text-center">
              <img
                src={verifiedIpfsUrl}
                alt="Verified"
                className="max-w-xs mx-auto rounded shadow"
              />
              <p className="text-xs text-gray-500 mt-2">
                Stored on IPFS
              </p>
            </div>
          )}

          {/* Token Details Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Token Name</label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="My Awesome Token"
                className="w-full border rounded px-3 py-2"
                maxLength={50}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Token Symbol</label>
              <input
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                placeholder="MYTKN"
                className="w-full border rounded px-3 py-2"
                maxLength={10}
              />
              <p className="text-xs text-gray-500 mt-1">
                2-10 characters, letters and numbers only
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Dev Buy Amount: ${launchAmount} USDC
              </label>
              <input
                type="range"
                min={1}
                max={100}
                value={launchAmount}
                onChange={(e) => setLaunchAmount(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>$1 (minimum)</span>
                <span>$100</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                This amount becomes your dev buy (minus 1% admin fee).
                Higher amount = larger initial position.
              </p>
            </div>
          </div>

          <button
            onClick={handleLaunch}
            disabled={isLoading || !tokenName || !tokenSymbol || tokenSymbol.length < 2}
            className="w-full bg-purple-500 text-white px-4 py-3 rounded-lg hover:bg-purple-600 disabled:bg-gray-400"
          >
            {isLoading ? "Processing..." : `Launch Token ($${launchAmount} USDC)`}
          </button>
        </div>
      )}

      {/* Step 2b: Launching */}
      {step === "launching" && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-lg">Launching your token...</p>
          <p className="text-sm text-gray-500">This may take a minute</p>
        </div>
      )}

      {/* Step 3: Complete */}
      {step === "complete" && launchResult && (
        <div className="space-y-4">
          <div className="bg-green-100 border border-green-400 p-6 rounded text-center">
            <h3 className="font-bold text-green-700 text-xl mb-2">
              Token Launched!
            </h3>
            <p className="text-green-600 mb-4">{launchResult.message}</p>

            {launchResult.result?.tokenAddress && (
              <div className="bg-white p-3 rounded mb-4">
                <p className="text-sm text-gray-500">Token Address:</p>
                <p className="font-mono text-sm break-all">
                  {launchResult.result.tokenAddress}
                </p>
                <a
                  href={`https://basescan.org/token/${launchResult.result.tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline text-sm"
                >
                  View on BaseScan
                </a>
              </div>
            )}

            {launchResult.token.imageUrl && (
              <img
                src={launchResult.token.imageUrl}
                alt={launchResult.token.name}
                className="max-w-32 mx-auto rounded"
              />
            )}
          </div>

          <button
            onClick={handleReset}
            className="w-full bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
          >
            Launch Another Token
          </button>
        </div>
      )}

      {/* Error State */}
      {step === "error" && (
        <div className="text-center py-8">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <p className="text-lg text-red-600 mb-4">{error || "Something went wrong"}</p>
          <button
            onClick={handleReset}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-8 p-4 bg-gray-100 rounded text-sm text-gray-600">
        <h4 className="font-bold mb-2">How it works:</h4>
        <ol className="list-decimal list-inside space-y-1">
          <li>Upload an image and pay $0.50 USDC to verify it matches the art style</li>
          <li>If verified, enter your token name and symbol</li>
          <li>Pay $1-100 USDC - this becomes your dev buy budget</li>
          <li>Your token is launched on Base via Clanker, paired with WASS</li>
        </ol>
      </div>
    </div>
  );
}
```

### 5. Wagmi Configuration

```typescript
// lib/wagmi-config.ts

import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

export const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    coinbaseWallet({ appName: "Token Launcher" }),
    walletConnect({ projectId: "YOUR_WALLETCONNECT_PROJECT_ID" }),
  ],
  transports: {
    [base.id]: http(),
  },
});
```

### 6. App Provider Setup

```tsx
// app/providers.tsx

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi-config";

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

### 7. Layout Setup

```tsx
// app/layout.tsx

import { Providers } from "./providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 8. Page

```tsx
// app/launcher/page.tsx

import { TokenLauncher } from "@/components/TokenLauncher";

export default function LauncherPage() {
  return (
    <main className="min-h-screen py-8">
      <TokenLauncher />
    </main>
  );
}
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SIMPLE PAYMENT FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. USER SELECTS IMAGE                                          │
│     └── Frontend validates size/type                            │
│                                                                  │
│  2. CLICK "VERIFY IMAGE ($0.50)"                                │
│     ├── POST /verify with image data                            │
│     ├── Server returns 402 Payment Required                     │
│     │   {                                                        │
│     │     "accepts": [{                                          │
│     │       "payTo": "0xE5E9108B...",                           │
│     │       "maxAmountRequired": "500000"                        │
│     │     }]                                                     │
│     │   }                                                        │
│     ├── Frontend calls USDC.transfer(payTo, 500000)             │
│     ├── User confirms tx in wallet                               │
│     ├── Frontend waits for tx confirmation                       │
│     └── Frontend retries POST with payment headers:              │
│         X-Payment-Amount: "0.50"                                 │
│         X-Payment-Tx-Hash: "0x..."                               │
│         X-Payment-From: "0x..."                                  │
│                                                                  │
│  3. SERVER VERIFIES IMAGE                                       │
│     ├── Checks payment headers                                   │
│     ├── AI checks image against AppleSnakes style               │
│     ├── If confidence >= 70%: uploads to temp storage           │
│     └── Returns ipfsUrl for preview                             │
│                                                                  │
│  4. USER ENTERS TOKEN DETAILS                                   │
│     ├── Token name                                               │
│     ├── Token symbol                                             │
│     └── Dev buy amount ($1-100 USDC)                            │
│                                                                  │
│  5. CLICK "LAUNCH TOKEN ($X)"                                   │
│     ├── Same 402 → pay → retry flow                             │
│     └── Server launches token via Clanker                       │
│                                                                  │
│  6. TOKEN LAUNCHED!                                             │
│     └── Returns token address, IPFS image URL                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Testing Checklist

1. **Wallet Connection**
   - [ ] Can connect with MetaMask
   - [ ] Can connect with Coinbase Wallet
   - [ ] Shows correct address

2. **Image Upload**
   - [ ] Rejects files > 1MB
   - [ ] Rejects non-image files
   - [ ] Shows preview correctly

3. **Verification Flow**
   - [ ] 402 response received
   - [ ] Wallet prompts for USDC payment
   - [ ] Payment succeeds on Base
   - [ ] Retry request with headers succeeds
   - [ ] IPFS URL displayed

4. **Launch Flow**
   - [ ] Can enter token name/symbol
   - [ ] Slider changes amount correctly
   - [ ] Payment executes
   - [ ] Token address returned

## Common Issues

### "X-PAYMENT header is required"
This is expected on the first request! It means the 402 flow is working.
Your code should then:
1. Pay USDC via `transfer()`
2. Retry with `X-Payment-*` headers

### "Invalid payment amount"
- The X-Payment-Amount header is missing or zero
- Make sure it's a positive number string like "0.50" or "5.00"

### "Address is invalid" (viem error)
- The payTo address has wrong checksum
- Use exactly: `0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098`

### "Failed to fetch"
- CORS issue or network error
- Check browser console for details
- Ensure API_BASE_URL is correct

### "Insufficient USDC balance"
- User doesn't have enough USDC on Base
- Need at least $0.50 for verify, $1+ for launch

### "nonce validation error"
**DO NOT use the X-PAYMENT base64 header format** - it requires a complex EIP-3009 signature.
Instead, use the simple `X-Payment-*` headers:
- `X-Payment-Amount`: "0.50"
- `X-Payment-Tx-Hash`: "0x..."
- `X-Payment-From`: "0x..."

## Alternative: Minimal Implementation

If the hook is too complex, here's the absolute minimum:

```typescript
async function verifyImageSimple(imageFile: File, walletAddress: string, walletClient: any) {
  const API = "http://ec2-34-217-202-250.us-west-2.compute.amazonaws.com:3000";
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const PAY_TO = "0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098";

  // 1. Convert image to base64
  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.readAsDataURL(imageFile);
  });

  // 2. Make initial request (will get 402)
  const initial = await fetch(`${API}/api/verified-launcher/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageData: base64, walletAddress, contentType: imageFile.type })
  });

  if (initial.status !== 402) {
    return initial.json();
  }

  // 3. Pay 0.50 USDC (500000 units) via direct transfer
  const txHash = await walletClient.writeContract({
    address: USDC,
    abi: [{
      name: "transfer",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
      outputs: [{ type: "bool" }]
    }],
    functionName: "transfer",
    args: [PAY_TO, BigInt(500000)]
  });

  // 4. Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // 5. Retry with SIMPLE payment headers (NOT X-PAYMENT base64!)
  const retry = await fetch(`${API}/api/verified-launcher/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Amount": "0.50",
      "X-Payment-Tx-Hash": txHash,
      "X-Payment-From": walletAddress
    },
    body: JSON.stringify({ imageData: base64, walletAddress, contentType: imageFile.type })
  });

  return retry.json();
}
```

## Why Not Use X-PAYMENT Header?

The X-PAYMENT header uses EIP-3009 `TransferWithAuthorization` which requires:
1. A 32-byte hex nonce (e.g., `0x1234...5678` with 64 hex chars)
2. EIP-712 typed data signature
3. Specific field formats validated by regex

This is complex to implement correctly. The simple approach with `X-Payment-*` headers:
- Uses a direct USDC `transfer()`
- Passes proof via simple string headers
- Works with the backend's fallback verification

**Use the simple approach unless you have a specific need for EIP-3009.**
