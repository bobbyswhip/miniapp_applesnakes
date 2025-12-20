# Token Wars Variable Payment Implementation Guide

## Problem

The x402 protocol's "exact" scheme requires payments to match the declared price exactly. When the route declares `price: "$1.00"`, the x402 facilitator rejects any payment that doesn't equal exactly 1,000,000 atomic USDC units.

**Error:** `invalid_exact_evm_payload_authorization_value`

This occurs because:
1. Route config declares `price: "$1.00"`
2. User tries to pay $5 (5,000,000 atomic units)
3. x402 facilitator validates: `5000000 !== 1000000` → REJECTED

## Solution: Direct USDC Payment Verification

Instead of relying on x402's exact matching, implement direct on-chain USDC transfer verification.

### Frontend Changes

#### 1. Update `useTokenWarsBuy.ts`

Replace x402 payment flow with direct USDC transfer:

```typescript
// useTokenWarsBuy.ts

import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';

// USDC contract on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9033C57B4332283Cda19B39431CD716340098';

// USDC ABI for transfer
const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

export function useTokenWarsBuy() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const buyIn = async (warId: string, amount: number, dexVote: string, pairVote: string) => {
    if (!address) throw new Error('Wallet not connected');
    if (amount < 1 || amount > 10000) throw new Error('Amount must be $1-$10,000');

    // Step 1: Send USDC to AI wallet
    const atomicAmount = parseUnits(amount.toString(), 6); // USDC has 6 decimals

    const txHash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [AI_WALLET, atomicAmount],
    });

    // Step 2: Wait for confirmation
    // (use useWaitForTransactionReceipt or poll)

    // Step 3: Call API with tx hash for verification
    const response = await fetch('/api/token-wars/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        warId,
        dexVote,
        pairVote,
        txHash,
        amount,
        walletAddress: address,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Buy failed');
    }

    return data;
  };

  return { buyIn };
}
```

#### 2. Update Buy Form Component

```tsx
// TokenWarsBuyForm.tsx

const [amount, setAmount] = useState(1);
const [dexVote, setDexVote] = useState<'v4' | 'aerodrome' | 'hydrex'>('aerodrome');
const [pairVote, setPairVote] = useState<'eth' | 'wass'>('eth');

const handleBuy = async () => {
  try {
    setLoading(true);
    setError(null);

    const result = await buyIn(warId, amount, dexVote, pairVote);

    // Success!
    console.log('Buy successful:', result);
    onSuccess?.(result);

  } catch (err) {
    // Proper error handling
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    console.error('[TokenWarsBuy] Error:', message);
  } finally {
    setLoading(false);
  }
};

// Amount input
<input
  type="number"
  min={1}
  max={10000}
  value={amount}
  onChange={(e) => setAmount(Math.floor(Number(e.target.value)))}
/>
```

### Backend Changes

#### Update `/api/token-wars/buy/route.ts`

Replace x402 flow with direct USDC transfer verification:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { tokenWars, type DexVote, type PairVote } from "@/lib/token-wars-service";

const AI_WALLET = "0xE5e9033C57B4332283Cda19B39431CD716340098";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const client = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL || 'https://mainnet.base.org'),
});

// Verify USDC transfer on-chain
async function verifyUsdcTransfer(txHash: string, expectedFrom: string, expectedAmount: number): Promise<{
  valid: boolean;
  actualAmount: number;
  error?: string;
}> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (receipt.status !== 'success') {
      return { valid: false, actualAmount: 0, error: 'Transaction failed' };
    }

    // Find USDC Transfer event to AI_WALLET
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;

      try {
        // Decode Transfer event
        const [from, to, value] = [
          log.topics[1], // from (indexed)
          log.topics[2], // to (indexed)
          log.data,      // value
        ];

        const fromAddress = '0x' + from?.slice(26);
        const toAddress = '0x' + to?.slice(26);
        const amount = parseInt(log.data, 16);

        if (
          fromAddress.toLowerCase() === expectedFrom.toLowerCase() &&
          toAddress.toLowerCase() === AI_WALLET.toLowerCase()
        ) {
          const usdcDollars = Math.floor(amount / 1_000_000);
          return { valid: true, actualAmount: usdcDollars };
        }
      } catch {
        continue;
      }
    }

    return { valid: false, actualAmount: 0, error: 'No valid USDC transfer found' };
  } catch (error) {
    return { valid: false, actualAmount: 0, error: 'Failed to verify transaction' };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { warId, dexVote, pairVote, txHash, amount, walletAddress } = body;

    // Validate required fields
    if (!warId || !txHash || !walletAddress) {
      return NextResponse.json(
        { success: false, error: "warId, txHash, and walletAddress are required" },
        { status: 400 }
      );
    }

    if (!amount || amount < 1 || amount > 10000) {
      return NextResponse.json(
        { success: false, error: "Amount must be between $1 and $10,000" },
        { status: 400 }
      );
    }

    // Validate votes
    const validDexVotes: DexVote[] = ["v4", "aerodrome", "hydrex"];
    const validPairVotes: PairVote[] = ["eth", "wass"];

    if (!dexVote || !validDexVotes.includes(dexVote)) {
      return NextResponse.json(
        { success: false, error: "dexVote must be 'v4', 'aerodrome', or 'hydrex'" },
        { status: 400 }
      );
    }

    if (!pairVote || !validPairVotes.includes(pairVote)) {
      return NextResponse.json(
        { success: false, error: "pairVote must be 'eth' or 'wass'" },
        { status: 400 }
      );
    }

    // Check for duplicate tx hash
    if (tokenWars.isTxHashUsed(txHash)) {
      return NextResponse.json(
        { success: false, error: "This transaction has already been used" },
        { status: 400 }
      );
    }

    // Verify the USDC transfer on-chain
    const verification = await verifyUsdcTransfer(txHash, walletAddress, amount);

    if (!verification.valid) {
      return NextResponse.json(
        { success: false, error: verification.error || "Payment verification failed" },
        { status: 400 }
      );
    }

    const usdcAmount = verification.actualAmount;

    // Get the war
    const war = tokenWars.getWar(warId);
    if (!war) {
      return NextResponse.json(
        { success: false, error: "Token War not found" },
        { status: 404 }
      );
    }

    // Check war is still active
    if (war.status !== "active") {
      return NextResponse.json(
        { success: false, error: `Token War is no longer active (status: ${war.status})` },
        { status: 400 }
      );
    }

    // Check war hasn't ended
    if (Date.now() > war.endsAt) {
      return NextResponse.json(
        { success: false, error: "Token War ICO has ended" },
        { status: 400 }
      );
    }

    // Check if sold out
    if (war.targetAmount && war.totalRaised >= war.targetAmount) {
      return NextResponse.json(
        { success: false, error: "Token War is sold out" },
        { status: 400 }
      );
    }

    // Record the buy with votes
    const participant = tokenWars.recordBuy({
      warId,
      walletAddress,
      amountUsdc: usdcAmount,
      txHash,
      dexVote: dexVote as DexVote,
      pairVote: pairVote as PairVote,
    });

    if (!participant) {
      return NextResponse.json(
        { success: false, error: "Failed to record buy" },
        { status: 500 }
      );
    }

    // Get updated war info
    const updatedWar = tokenWars.getWar(warId);
    const walletTotal = tokenWars.getWalletContribution(warId, walletAddress);
    const consensus = tokenWars.getVoteConsensus(warId);

    const totalRaised = updatedWar?.totalRaised || usdcAmount;
    const sharePercent = (walletTotal / totalRaised) * 100;

    console.log(`[Token Wars Buy] Verified on-chain: $${usdcAmount} from ${walletAddress}`);
    console.log(`[Token Wars Buy] Votes: DEX=${dexVote}, Pair=${pairVote}`);

    return NextResponse.json({
      success: true,
      message: `Successfully joined ${war.symbol} Token War with $${usdcAmount}! Voted for ${dexVote}/${pairVote}.`,
      buy: {
        warId,
        amount: usdcAmount,
        txHash,
        wallet: walletAddress,
        timestamp: participant.timestamp,
        dexVote,
        pairVote,
      },
      war: {
        id: war.id,
        name: war.name,
        symbol: war.symbol,
        totalRaised,
        participantCount: updatedWar?.participantCount || 1,
        endsAt: war.endsAt,
        timeRemainingMs: Math.max(0, war.endsAt - Date.now()),
      },
      wallet: {
        totalContribution: walletTotal,
        sharePercent,
      },
      consensus: consensus ? {
        dex: {
          leading: consensus.winningDex,
          v4: { votes: consensus.v4Votes, percent: consensus.v4Percent },
          aerodrome: { votes: consensus.aerodromeVotes, percent: consensus.aerodromePercent },
          hydrex: { votes: consensus.hydrexVotes, percent: consensus.hydrexPercent },
          isTie: consensus.isDexTie,
        },
        pair: {
          leading: consensus.winningPair,
          eth: { votes: consensus.ethVotes, percent: consensus.ethPercent },
          wass: { votes: consensus.wassVotes, percent: consensus.wassPercent },
          isTie: consensus.isPairTie,
        },
        totalVotes: consensus.totalVotes,
      } : null,
    });
  } catch (error) {
    console.error("[Token Wars Buy] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Buy failed" },
      { status: 500 }
    );
  }
}
```

### Token Wars Service Update

Add `isTxHashUsed` method to prevent double-spending:

```typescript
// lib/token-wars-service.ts

// Add to TokenWarsService class
isTxHashUsed(txHash: string): boolean {
  const stmt = this.db.prepare(`
    SELECT 1 FROM token_war_buys WHERE tx_hash = ? LIMIT 1
  `);
  const result = stmt.get(txHash);
  return !!result;
}
```

## Frontend Error Handling Fix

Fix the `[object Object]` error in `useTokenWarsBuy.ts`:

```typescript
// Before (broken)
catch (error) {
  throw new Error(error); // [object Object]
}

// After (fixed)
catch (error) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object'
      ? JSON.stringify(error)
      : String(error);
  throw new Error(message);
}
```

## Summary

1. **Remove x402 dependency** - The "exact" scheme doesn't support variable amounts
2. **Direct USDC transfers** - User sends USDC directly via wallet
3. **On-chain verification** - Backend verifies the transfer happened
4. **Duplicate prevention** - Track used tx hashes to prevent double-spending
5. **Better error handling** - Properly stringify error objects

## Testing

1. Connect wallet with USDC on Base
2. Enter amount ($1-$10,000)
3. Select DEX vote (v4/aerodrome/hydrex)
4. Select pair vote (eth/wass)
5. Confirm USDC transfer in wallet
6. Backend verifies and records buy
