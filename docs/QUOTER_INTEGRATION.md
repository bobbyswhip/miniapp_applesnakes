# Uniswap V4 Swap Implementation Guide

Complete frontend implementation guide for swapping on Uniswap V4 with the wASSBLASTER hook.

## Overview

This guide covers **both swap directions**:
- **SELL**: TOKEN → WASS (selling meme tokens for WASS)
- **BUY**: WASS → TOKEN (buying meme tokens with WASS)

### Architecture Flow
```
User Wallet → ERC20.approve() → Permit2 → Permit2.approve() → Universal Router → V4 Pool Manager → Hook
```

---

## 1. Contract Addresses (Base Mainnet)

```typescript
// Core Infrastructure
const ADDRESSES = {
  // Uniswap V4 Infrastructure
  UNIVERSAL_ROUTER: "0x6ff5693b99212da76ad316178a184ab56d299b43",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  POOL_MANAGER: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
  QUOTER: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",

  // Tokens
  WASS: "0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6",

  // Hook (TEST pool)
  HOOK: "0x35B9b5b023897DA8C7375ba6141245B8416460CC",

  // Example paired token (replace with your token)
  TOKEN: "0x9B26FcCf0C90C2DAf54B82FeF07dDBF21E11c658",
};

// Maximum uint160 for Permit2 approvals
const MAX_UINT160 = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
```

---

## 2. Pool Configuration

### Pool Key Structure
The pool key uniquely identifies a V4 pool:

```typescript
interface PoolKey {
  currency0: string;  // Lower address (sorted)
  currency1: string;  // Higher address (sorted)
  fee: number;        // Fee in hundredths of a bip (3000 = 0.3%)
  tickSpacing: number;
  hooks: string;      // Hook contract address
}

// IMPORTANT: Tokens MUST be sorted by address!
// WASS (0x4450...) < TOKEN (0x9B26...) → WASS is currency0
const poolKey: PoolKey = {
  currency0: ADDRESSES.WASS,   // 0x445040...
  currency1: ADDRESSES.TOKEN,  // 0x9B26Fc...
  fee: 3000,                   // 0.3%
  tickSpacing: 60,
  hooks: ADDRESSES.HOOK,
};
```

### Computing Pool ID
```typescript
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

function computePoolId(poolKey: PoolKey): string {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, uint24, int24, address"),
      [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
      ]
    )
  );
}

const poolId = computePoolId(poolKey);
// Example: 0x...
```

---

## 3. ABIs

```typescript
// ERC20 Standard
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Permit2
const PERMIT2_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Universal Router
const ROUTER_ABI = [
  {
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;
```

---

## 4. Approval Flow (Two Steps)

Users must complete TWO approval transactions before swapping:

### Step 1: ERC20 → Permit2
Approve Permit2 to spend the token:

```typescript
import { createPublicClient, createWalletClient, http, maxUint256 } from "viem";
import { base } from "viem/chains";

async function approveTokenToPermit2(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: string,
  userAddress: string
): Promise<boolean> {
  // Check existing allowance
  const allowance = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [userAddress, ADDRESSES.PERMIT2],
  });

  // If already approved, skip
  if (allowance > 0n) {
    console.log("Token already approved to Permit2");
    return true;
  }

  // Approve max amount (one-time)
  const hash = await walletClient.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [ADDRESSES.PERMIT2, maxUint256],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return true;
}
```

### Step 2: Permit2 → Universal Router
Approve Universal Router via Permit2:

```typescript
async function approvePermit2ToRouter(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: string,
  userAddress: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 86400 * 365; // 1 year

  // Check existing Permit2 allowance
  const [amount, exp, nonce] = await publicClient.readContract({
    address: ADDRESSES.PERMIT2 as `0x${string}`,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [userAddress, tokenAddress, ADDRESSES.UNIVERSAL_ROUTER],
  });

  // If sufficient allowance and not expired, skip
  if (amount > 0n && Number(exp) > now) {
    console.log("Permit2 already approved to Router");
    return true;
  }

  // Approve via Permit2
  const hash = await walletClient.writeContract({
    address: ADDRESSES.PERMIT2 as `0x${string}`,
    abi: PERMIT2_ABI,
    functionName: "approve",
    args: [
      tokenAddress,
      ADDRESSES.UNIVERSAL_ROUTER,
      MAX_UINT160,
      expiration,
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return true;
}
```

### Combined Approval Helper
```typescript
async function ensureApprovals(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: string,
  userAddress: string
): Promise<{ step1: boolean; step2: boolean }> {
  // Step 1: Token → Permit2
  const step1 = await approveTokenToPermit2(
    walletClient,
    publicClient,
    tokenAddress,
    userAddress
  );

  // Step 2: Permit2 → Router
  const step2 = await approvePermit2ToRouter(
    walletClient,
    publicClient,
    tokenAddress,
    userAddress
  );

  return { step1, step2 };
}
```

---

## 5. Building Swap Calldata

### Required Dependencies
```bash
npm install @uniswap/v4-sdk @uniswap/universal-router-sdk ethers viem
```

### Swap Direction Logic
```
Pool structure (tokens sorted by address):
  - WASS (0x4450...) < TOKEN (0x9B26...) → WASS is currency0, TOKEN is currency1

SELL (TOKEN → WASS):
  - zeroForOne = FALSE (currency1 → currency0)
  - Settle TOKEN (input), Take WASS (output)

BUY (WASS → TOKEN):
  - zeroForOne = TRUE (currency0 → currency1)
  - Settle WASS (input), Take TOKEN (output)
```

### Build Swap Transaction
```typescript
import { Actions, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner } from "@uniswap/universal-router-sdk";
import { ethers } from "ethers";

interface SwapParams {
  poolKey: PoolKey;
  amountIn: bigint;
  amountOutMinimum: bigint;
  isBuy: boolean;  // true = WASS → TOKEN, false = TOKEN → WASS
}

function buildSwapCalldata(params: SwapParams): {
  commands: string;
  inputs: string[];
} {
  const { poolKey, amountIn, amountOutMinimum, isBuy } = params;

  // Create V4 planner
  const planner = new V4Planner();

  // Determine direction:
  // BUY (WASS → TOKEN): zeroForOne = true (currency0 → currency1)
  // SELL (TOKEN → WASS): zeroForOne = false (currency1 → currency0)
  const zeroForOne = isBuy;

  // Determine settle/take tokens based on direction
  const settleToken = isBuy ? poolKey.currency0 : poolKey.currency1;
  const takeToken = isBuy ? poolKey.currency1 : poolKey.currency0;

  // Add swap action
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{
    poolKey,
    zeroForOne,
    amountIn: amountIn.toString(),
    amountOutMinimum: amountOutMinimum.toString(),
    hookData: "0x",
  }]);

  // SETTLE: Pull input token from user via Permit2
  // [currency, amount, payerIsUser]
  // payerIsUser = true means Universal Router pulls via Permit2
  planner.addAction(Actions.SETTLE, [
    settleToken,
    amountIn.toString(),
    true,  // payerIsUser = true (CRITICAL!)
  ]);

  // TAKE_ALL: Send all output to user
  planner.addAction(Actions.TAKE_ALL, [
    takeToken,
    "0",  // Min already set in swap action
  ]);

  // Wrap in Universal Router command
  const route = new RoutePlanner();
  route.addCommand(CommandType.V4_SWAP, [planner.finalize()]);

  return {
    commands: route.commands,
    inputs: route.inputs,
  };
}
```

---

## 6. Execute Swap

```typescript
async function executeSwap(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: string,
  amountIn: bigint,
  isBuy: boolean,  // true = WASS → TOKEN, false = TOKEN → WASS
  slippagePercent: number = 1
): Promise<string> {
  const userAddress = walletClient.account.address;

  // 1. Determine which token needs approval
  const inputToken = isBuy ? ADDRESSES.WASS : tokenAddress;

  // 2. Ensure approvals for the INPUT token
  await ensureApprovals(walletClient, publicClient, inputToken, userAddress);

  // 3. Calculate minimum output with slippage (optional)
  const amountOutMinimum = 0n; // Set to 0 or calculate from quoter

  // 4. Build swap calldata
  const poolKey: PoolKey = {
    currency0: ADDRESSES.WASS,
    currency1: tokenAddress,
    fee: 3000,
    tickSpacing: 60,
    hooks: ADDRESSES.HOOK,
  };

  const { commands, inputs } = buildSwapCalldata({
    poolKey,
    amountIn,
    amountOutMinimum,
    isBuy,
  });

  // 5. Set deadline (1 hour from now)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // 6. Execute via ethers (required for V4 SDK compatibility)
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();

  const router = new ethers.Contract(
    ADDRESSES.UNIVERSAL_ROUTER,
    ROUTER_ABI,
    signer
  );

  // 7. Send transaction with Base L2 gas settings
  const tx = await router.execute(commands, inputs, deadline, {
    gasLimit: 450000,
    // Base L2 has very low gas prices
    maxFeePerGas: ethers.utils.parseUnits("0.01", "gwei"),
    maxPriorityFeePerGas: ethers.utils.parseUnits("0.001", "gwei"),
  });

  console.log("Transaction sent:", tx.hash);

  // 8. Wait for confirmation
  const receipt = await tx.wait();
  console.log("Confirmed! Gas used:", receipt.gasUsed.toString());

  return tx.hash;
}
```

---

## 7. Complete React Hook Example

```typescript
import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseEther, formatEther } from "viem";

export function useV4Swap() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if approvals are needed for a specific token
  const checkApprovals = useCallback(async (tokenAddress: string) => {
    if (!publicClient || !address) return { needsStep1: true, needsStep2: true };

    const now = Math.floor(Date.now() / 1000);

    // Check ERC20 → Permit2
    const erc20Allowance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, ADDRESSES.PERMIT2],
    });

    // Check Permit2 → Router
    const [permit2Amount, permit2Exp] = await publicClient.readContract({
      address: ADDRESSES.PERMIT2 as `0x${string}`,
      abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [address, tokenAddress, ADDRESSES.UNIVERSAL_ROUTER],
    });

    return {
      needsStep1: erc20Allowance === 0n,
      needsStep2: permit2Amount === 0n || Number(permit2Exp) < now,
    };
  }, [publicClient, address]);

  // Execute swap in either direction
  const swap = useCallback(async (
    tokenAddress: string,
    amount: string,  // Human-readable amount (e.g., "1.5")
    isBuy: boolean   // true = WASS → TOKEN, false = TOKEN → WASS
  ) => {
    if (!walletClient || !publicClient || !address) {
      throw new Error("Wallet not connected");
    }

    setError(null);
    const amountIn = parseEther(amount);

    // Determine which token is the INPUT
    const inputToken = isBuy ? ADDRESSES.WASS : tokenAddress;

    try {
      // Step 1: Approvals for INPUT token
      setIsApproving(true);
      const { needsStep1, needsStep2 } = await checkApprovals(inputToken);

      if (needsStep1) {
        console.log(`Approving ${isBuy ? "WASS" : "TOKEN"} to Permit2...`);
        await approveTokenToPermit2(walletClient, publicClient, inputToken, address);
      }

      if (needsStep2) {
        console.log("Approving Permit2 to Router...");
        await approvePermit2ToRouter(walletClient, publicClient, inputToken, address);
      }
      setIsApproving(false);

      // Step 2: Execute swap
      setIsSwapping(true);
      const txHash = await executeSwap(
        walletClient,
        publicClient,
        tokenAddress,
        amountIn,
        isBuy,
        1 // 1% slippage
      );
      setIsSwapping(false);

      return txHash;
    } catch (err: any) {
      setError(err.message || "Swap failed");
      setIsApproving(false);
      setIsSwapping(false);
      throw err;
    }
  }, [walletClient, publicClient, address, checkApprovals]);

  // Convenience methods
  const buy = useCallback((tokenAddress: string, wassAmount: string) =>
    swap(tokenAddress, wassAmount, true), [swap]);

  const sell = useCallback((tokenAddress: string, tokenAmount: string) =>
    swap(tokenAddress, tokenAmount, false), [swap]);

  return {
    swap,
    buy,   // WASS → TOKEN
    sell,  // TOKEN → WASS
    checkApprovals,
    isApproving,
    isSwapping,
    error,
  };
}
```

---

## 8. UI Component Example

```tsx
import { useState } from "react";
import { useV4Swap } from "./useV4Swap";
import { formatEther, parseEther } from "viem";

const TOKEN_ADDRESS = "0x9B26FcCf0C90C2DAf54B82FeF07dDBF21E11c658";

export function SwapForm() {
  const [amount, setAmount] = useState("");
  const [isBuyMode, setIsBuyMode] = useState(false);
  const { buy, sell, isApproving, isSwapping, error } = useV4Swap();

  const handleSwap = async () => {
    try {
      const txHash = isBuyMode
        ? await buy(TOKEN_ADDRESS, amount)   // WASS → TOKEN
        : await sell(TOKEN_ADDRESS, amount); // TOKEN → WASS
      alert(`Success! TX: ${txHash}`);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-xl font-bold mb-4">
        {isBuyMode ? "Buy TOKEN with WASS" : "Sell TOKEN for WASS"}
      </h2>

      {/* Direction Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setIsBuyMode(false)}
          className={`px-3 py-1 rounded ${!isBuyMode ? "bg-blue-500 text-white" : "bg-gray-200"}`}
        >
          Sell TOKEN
        </button>
        <button
          onClick={() => setIsBuyMode(true)}
          className={`px-3 py-1 rounded ${isBuyMode ? "bg-green-500 text-white" : "bg-gray-200"}`}
        >
          Buy TOKEN
        </button>
      </div>

      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={isBuyMode ? "WASS amount" : "TOKEN amount"}
        className="border p-2 w-full mb-4"
      />

      <button
        onClick={handleSwap}
        disabled={isApproving || isSwapping || !amount}
        className={`${isBuyMode ? "bg-green-500" : "bg-blue-500"} text-white px-4 py-2 rounded disabled:opacity-50 w-full`}
      >
        {isApproving
          ? "Approving..."
          : isSwapping
          ? "Swapping..."
          : isBuyMode ? "Buy TOKEN" : "Sell TOKEN"}
      </button>

      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
}
```

---

## 9. Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `InsufficientAllowance` | Step 1 or 2 approval missing | Run both approval steps |
| `InsufficientBalance` | User doesn't have enough tokens | Check balance before swap |
| `SlippageExceeded` | Price moved too much | Increase slippage or retry |
| `Deadline exceeded` | Transaction took too long | Retry with new deadline |
| `Hook call failed` | Hook contract error | Check hook inventory/state |

### Error Decoding
```typescript
const ERROR_SIGNATURES = {
  "0x6190b2b0": "UnexpectedRevertBytes - Check inner error",
  "0x90bfb865": "Hook call failed - Check hook state/inventory",
  "0xec442f05": "ERC20InvalidReceiver - Invalid recipient address",
  "0xfb8f41b2": "InsufficientAllowance - Need to approve token",
  "0x7dc2f438": "InsufficientBalance - Not enough tokens",
};
```

---

## 10. Key Implementation Notes

### Critical Points

1. **Token Sorting**: ALWAYS sort tokens by address. Lower address = currency0.
   ```typescript
   const [currency0, currency1] = BigInt(tokenA) < BigInt(tokenB)
     ? [tokenA, tokenB]
     : [tokenB, tokenA];
   ```

2. **zeroForOne Direction**:
   - `true` = swap currency0 → currency1 (BUY: WASS → TOKEN)
   - `false` = swap currency1 → currency0 (SELL: TOKEN → WASS)
   - For WASS < TOKEN: BUY = `true`, SELL = `false`

3. **SETTLE with payerIsUser=true**: This is CRITICAL! It tells the router to pull tokens via Permit2.

4. **Gas Settings**: Base L2 has very low gas. Use:
   ```typescript
   maxFeePerGas: parseGwei("0.01"),
   maxPriorityFeePerGas: parseGwei("0.001"),
   gasLimit: 450000n,
   ```

5. **Two Approval Steps**: Users need BOTH:
   - ERC20.approve(Permit2, maxUint256)
   - Permit2.approve(token, Router, MAX_UINT160, expiration)

6. **Approve the INPUT token**: For BUY, approve WASS. For SELL, approve TOKEN.

### Hook-Specific Notes

- **OTC Mechanism**: The hook manages token inventory for OTC trades
- **Hook Inventory**: Check `poolTokenBalance(poolId)` for available liquidity
- **Fee Structure**: 3000 = 0.3% fee, tick spacing = 60
- **Single Pool**: This guide is for the specific wASSBLASTER hook pool

---

## Appendix: Full Working Example

See `scripts/test-hook-swaps.mjs` for a complete Node.js implementation that demonstrates:
- Both approval steps
- Building swap calldata
- Executing swaps
- Balance checking before/after
