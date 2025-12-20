# Token Wars Complete Frontend Implementation Guide

## Overview

This guide provides complete, copy-paste ready code for implementing Token Wars in your frontend. It covers:

1. **Fetching Wars** - List all token wars
2. **Fetching War Details** - Get participants, votes, consensus
3. **X402 Payment Flow** - Buy into a war with USDC
4. **Displaying Participants** - Show who has contributed

---

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/token-wars` | GET | List all wars |
| `/api/token-wars/{id}` | GET | Get war details + participants |
| `/api/token-wars/buy` | POST | Buy into a war (x402 payment) |

---

## Part 1: Types (types/tokenWars.ts)

```typescript
// types/tokenWars.ts

export type DexVote = 'v4' | 'aerodrome' | 'hydrex';
export type PairVote = 'eth' | 'wass';
export type WarStatus = 'active' | 'launching' | 'launched' | 'failed' | 'cancelled';

export interface TokenWar {
  id: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string | null;

  // Timing
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  isExpired: boolean;

  // Status
  status: WarStatus;
  isActive: boolean;
  isSoldOut: boolean;

  // Funding
  targetAmount: number | null;
  totalRaised: number;
  participantCount: number;
  progressPercent: number | null;

  // Creator
  creatorWallet: string;
  creatorBuyUsdc: number;
  creatorDexVote: DexVote;
  creatorPairVote: PairVote;

  // Launch results (after launch)
  winningDex: DexVote | null;
  winningPair: PairVote | null;
  tokenAddress: string | null;
  poolAddress: string | null;
  launchTxHash: string | null;
}

export interface Participant {
  wallet: string;
  totalUsdc: number;
  sharePercent: number;
  buyCount: number;
  firstBuy: number;
  lastBuy: number;
  lastDexVote: DexVote;
  lastPairVote: PairVote;
  votes: {
    v4: number;
    aerodrome: number;
    hydrex: number;
    eth: number;
    wass: number;
  } | null;
}

export interface VoteConsensus {
  dex: {
    leading: DexVote;
    v4: { votes: number; percent: number };
    aerodrome: { votes: number; percent: number };
    hydrex: { votes: number; percent: number };
    isTie: boolean;
  };
  pair: {
    leading: PairVote;
    eth: { votes: number; percent: number };
    wass: { votes: number; percent: number };
    isTie: boolean;
  };
  totalVotes: number;
}

export interface WarDetails {
  war: TokenWar;
  consensus: VoteConsensus | null;
  participants: Participant[];
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset?: string;
}

export interface BuyResult {
  success: boolean;
  message?: string;
  error?: string;
  buy?: {
    warId: string;
    amount: number;
    txHash: string;
    wallet: string;
    timestamp: number;
    dexVote: DexVote;
    pairVote: PairVote;
  };
  wallet?: {
    totalContribution: number;
    sharePercent: number;
  };
}
```

---

## Part 2: API Client (lib/tokenWarsApi.ts)

```typescript
// lib/tokenWarsApi.ts

import type { TokenWar, WarDetails, Participant } from '@/types/tokenWars';

const API_BASE = 'https://api.applesnakes.com';

/**
 * Fetch all token wars
 */
export async function fetchWars(): Promise<TokenWar[]> {
  const response = await fetch(`${API_BASE}/api/token-wars`);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch wars');
  }

  return data.wars;
}

/**
 * Fetch a single war with full details including participants
 */
export async function fetchWarDetails(warId: string): Promise<WarDetails> {
  const response = await fetch(`${API_BASE}/api/token-wars/${warId}`);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch war details');
  }

  return {
    war: data.war,
    consensus: data.consensus,
    participants: data.participants,
  };
}

/**
 * Fetch just the participants for a war
 */
export async function fetchParticipants(warId: string): Promise<Participant[]> {
  const details = await fetchWarDetails(warId);
  return details.participants;
}
```

---

## Part 3: X402 Payment Hook (hooks/useTokenWarsBuy.ts)

```typescript
// hooks/useTokenWarsBuy.ts

import { useState, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import type { DexVote, PairVote, PaymentRequirements, BuyResult } from '@/types/tokenWars';

// =============================================================================
// Constants
// =============================================================================

const API_BASE = 'https://api.applesnakes.com';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const SIGN_TIMEOUT = 60000;

// EIP-712 domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS,
} as const;

// EIP-3009 TransferWithAuthorization types
const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// =============================================================================
// Types
// =============================================================================

export type BuyStatus =
  | 'idle'
  | 'fetching_requirements'
  | 'awaiting_signature'
  | 'processing_payment'
  | 'success'
  | 'error';

// =============================================================================
// Utilities
// =============================================================================

function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

// =============================================================================
// Hook
// =============================================================================

export function useTokenWarsBuy() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [status, setStatus] = useState<BuyStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);

  /**
   * Sign EIP-3009 TransferWithAuthorization
   */
  const signPayment = useCallback(async (
    accepts: PaymentRequirements,
    amountUSDC: number
  ): Promise<string> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    // Calculate amount in atomic units (6 decimals)
    const amountAtomic = BigInt(Math.floor(amountUSDC * 10 ** USDC_DECIMALS));

    const nonce = generateNonce();
    const now = Math.floor(Date.now() / 1000);
    const validBefore = BigInt(now + (accepts.maxTimeoutSeconds || 3600));

    const message = {
      from: address as `0x${string}`,
      to: accepts.payTo as `0x${string}`,
      value: amountAtomic,
      validAfter: BigInt(0),
      validBefore,
      nonce,
    };

    console.log('[X402] Requesting signature for:', {
      from: address,
      to: accepts.payTo,
      amount: `$${amountUSDC} USDC`,
    });

    // Sign with timeout
    const signPromise = walletClient.signTypedData({
      account: walletClient.account!,
      domain: USDC_DOMAIN,
      types: TRANSFER_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Wallet signing timed out. Please try again.')), SIGN_TIMEOUT);
    });

    const signature = await Promise.race([signPromise, timeoutPromise]);

    // Build x402 payment header
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'base',
      payload: {
        signature,
        authorization: {
          from: address,
          to: accepts.payTo,
          value: amountAtomic.toString(),
          validAfter: '0',
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };

    return btoa(JSON.stringify(payload));
  }, [walletClient, address]);

  /**
   * Execute buy with x402 payment
   */
  const buyIn = useCallback(async (
    warId: string,
    amountUSDC: number,
    dexVote: DexVote,
    pairVote: PairVote
  ): Promise<BuyResult> => {
    // Validation
    if (!isConnected || !walletClient || !address) {
      const err: BuyResult = { success: false, error: 'Please connect your wallet' };
      setError(err.error!);
      setStatus('error');
      return err;
    }

    if (amountUSDC < 1) {
      const err: BuyResult = { success: false, error: 'Minimum buy is $1 USDC' };
      setError(err.error!);
      setStatus('error');
      return err;
    }

    if (amountUSDC > 10000) {
      const err: BuyResult = { success: false, error: 'Maximum buy is $10,000 USDC' };
      setError(err.error!);
      setStatus('error');
      return err;
    }

    // Reset state
    setStatus('fetching_requirements');
    setError(null);
    setResult(null);

    const requestBody = JSON.stringify({ warId, dexVote, pairVote });
    const endpoint = `${API_BASE}/api/token-wars/buy`;

    try {
      // =====================================================================
      // STEP 1: Make initial request to get payment requirements
      // =====================================================================
      console.log('[X402] Step 1: Fetching payment requirements...');

      const initialResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      // If not 402, check if it's already successful or an error
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (data.success) {
          setResult(data);
          setStatus('success');
          return data;
        }
        throw new Error(data.error || 'Request failed');
      }

      // =====================================================================
      // STEP 2: Parse payment requirements from 402 response
      // =====================================================================
      console.log('[X402] Step 2: Parsing payment requirements...');

      const paymentData = await initialResponse.json();
      console.log('[X402] Payment requirements received:', paymentData);

      const accepts = paymentData.accepts?.[0] as PaymentRequirements;
      if (!accepts) {
        throw new Error('Server returned invalid payment requirements');
      }

      // =====================================================================
      // STEP 3: Sign payment with wallet
      // =====================================================================
      console.log('[X402] Step 3: Requesting wallet signature...');
      setStatus('awaiting_signature');

      const paymentHeader = await signPayment(accepts, amountUSDC);
      console.log('[X402] Payment signed successfully');

      // =====================================================================
      // STEP 4: Retry request with X-PAYMENT header
      // =====================================================================
      console.log('[X402] Step 4: Submitting payment...');
      setStatus('processing_payment');

      const paidResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: requestBody,
      });

      const result = await paidResponse.json();
      console.log('[X402] Final response:', result);

      // =====================================================================
      // STEP 5: Handle result
      // =====================================================================
      if (result.success) {
        setResult(result);
        setStatus('success');
        return result;
      } else {
        throw new Error(result.error || 'Payment failed');
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Buy failed';
      console.error('[X402] Error:', message);
      setError(message);
      setStatus('error');
      return { success: false, error: message };
    }
  }, [isConnected, walletClient, address, signPayment]);

  /**
   * Reset hook state
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  return {
    // State
    status,
    error,
    result,
    isConnected,
    address,

    // Actions
    buyIn,
    reset,

    // Computed helpers
    isLoading: ['fetching_requirements', 'awaiting_signature', 'processing_payment'].includes(status),
    isAwaitingSignature: status === 'awaiting_signature',
    isProcessing: status === 'processing_payment',
    isSuccess: status === 'success',
    isError: status === 'error',
  };
}
```

---

## Part 4: Data Fetching Hook (hooks/useTokenWar.ts)

```typescript
// hooks/useTokenWar.ts

import { useState, useEffect, useCallback } from 'react';
import { fetchWarDetails } from '@/lib/tokenWarsApi';
import type { TokenWar, Participant, VoteConsensus } from '@/types/tokenWars';

interface UseTokenWarResult {
  war: TokenWar | null;
  participants: Participant[];
  consensus: VoteConsensus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTokenWar(warId: string | null): UseTokenWarResult {
  const [war, setWar] = useState<TokenWar | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [consensus, setConsensus] = useState<VoteConsensus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!warId) {
      setWar(null);
      setParticipants([]);
      setConsensus(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchWarDetails(warId);
      setWar(data.war);
      setParticipants(data.participants);
      setConsensus(data.consensus);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch war';
      setError(message);
      console.error('[useTokenWar] Error:', message);
    } finally {
      setIsLoading(false);
    }
  }, [warId]);

  // Fetch on mount and when warId changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds for active wars
  useEffect(() => {
    if (!warId || !war?.isActive) return;

    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [warId, war?.isActive, fetchData]);

  return {
    war,
    participants,
    consensus,
    isLoading,
    error,
    refetch: fetchData,
  };
}
```

---

## Part 5: Participants List Component (components/ParticipantsList.tsx)

```typescript
// components/ParticipantsList.tsx

import type { Participant } from '@/types/tokenWars';

interface ParticipantsListProps {
  participants: Participant[];
  totalRaised: number;
}

export function ParticipantsList({ participants, totalRaised }: ParticipantsListProps) {
  if (participants.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No participants yet</p>
        <p className="text-sm">Be the first to join!</p>
      </div>
    );
  }

  // Sort by contribution amount (highest first)
  const sorted = [...participants].sort((a, b) => b.totalUsdc - a.totalUsdc);

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-lg">
        Participants ({participants.length})
      </h3>

      <div className="space-y-2">
        {sorted.map((participant, index) => (
          <ParticipantRow
            key={participant.wallet}
            participant={participant}
            rank={index + 1}
            totalRaised={totalRaised}
          />
        ))}
      </div>
    </div>
  );
}

interface ParticipantRowProps {
  participant: Participant;
  rank: number;
  totalRaised: number;
}

function ParticipantRow({ participant, rank, totalRaised }: ParticipantRowProps) {
  const { wallet, totalUsdc, sharePercent, buyCount, lastDexVote, lastPairVote, votes } = participant;

  // Truncate wallet address
  const shortWallet = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

  // Medal for top 3
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
      {/* Left side: Rank + Wallet */}
      <div className="flex items-center gap-3">
        <span className="text-lg w-8 text-center">
          {medal || `#${rank}`}
        </span>
        <div>
          <div className="font-mono text-sm">{shortWallet}</div>
          <div className="text-xs text-gray-500">
            {buyCount} buy{buyCount !== 1 ? 's' : ''} •
            Last vote: {lastDexVote}/{lastPairVote}
          </div>
        </div>
      </div>

      {/* Right side: Amount + Share */}
      <div className="text-right">
        <div className="font-semibold">${totalUsdc.toLocaleString()}</div>
        <div className="text-sm text-gray-500">{sharePercent.toFixed(1)}% share</div>
      </div>
    </div>
  );
}

// Optional: Detailed view with vote breakdown
interface ParticipantDetailProps {
  participant: Participant;
}

export function ParticipantDetail({ participant }: ParticipantDetailProps) {
  const { wallet, totalUsdc, sharePercent, buyCount, firstBuy, lastBuy, votes } = participant;

  return (
    <div className="p-4 border rounded-lg space-y-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="font-mono">{wallet}</div>
          <div className="text-sm text-gray-500">
            First buy: {new Date(firstBuy).toLocaleDateString()}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">${totalUsdc}</div>
          <div className="text-sm text-green-600">{sharePercent.toFixed(2)}% share</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-semibold">{buyCount}</div>
          <div className="text-xs text-gray-500">Total Buys</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">${(totalUsdc / buyCount).toFixed(0)}</div>
          <div className="text-xs text-gray-500">Avg Buy</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{sharePercent.toFixed(1)}%</div>
          <div className="text-xs text-gray-500">Share</div>
        </div>
      </div>

      {/* Vote Breakdown */}
      {votes && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Vote History</h4>

          {/* DEX Votes */}
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className={`p-2 rounded ${votes.v4 > 0 ? 'bg-blue-100' : 'bg-gray-100'}`}>
              <div className="font-medium">V4</div>
              <div>${votes.v4}</div>
            </div>
            <div className={`p-2 rounded ${votes.aerodrome > 0 ? 'bg-green-100' : 'bg-gray-100'}`}>
              <div className="font-medium">Aero</div>
              <div>${votes.aerodrome}</div>
            </div>
            <div className={`p-2 rounded ${votes.hydrex > 0 ? 'bg-purple-100' : 'bg-gray-100'}`}>
              <div className="font-medium">Hydrex</div>
              <div>${votes.hydrex}</div>
            </div>
          </div>

          {/* Pair Votes */}
          <div className="grid grid-cols-2 gap-2 text-center text-sm">
            <div className={`p-2 rounded ${votes.eth > 0 ? 'bg-indigo-100' : 'bg-gray-100'}`}>
              <div className="font-medium">ETH</div>
              <div>${votes.eth}</div>
            </div>
            <div className={`p-2 rounded ${votes.wass > 0 ? 'bg-orange-100' : 'bg-gray-100'}`}>
              <div className="font-medium">wASS</div>
              <div>${votes.wass}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Part 6: Buy Modal Component (components/BuyModal.tsx)

```typescript
// components/BuyModal.tsx

import { useState } from 'react';
import { useTokenWarsBuy } from '@/hooks/useTokenWarsBuy';
import type { TokenWar, DexVote, PairVote } from '@/types/tokenWars';

interface BuyModalProps {
  war: TokenWar;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BuyModal({ war, isOpen, onClose, onSuccess }: BuyModalProps) {
  const [amount, setAmount] = useState(1);
  const [dexVote, setDexVote] = useState<DexVote>('aerodrome');
  const [pairVote, setPairVote] = useState<PairVote>('eth');

  const {
    buyIn,
    status,
    error,
    result,
    isLoading,
    isAwaitingSignature,
    reset,
  } = useTokenWarsBuy();

  if (!isOpen) return null;

  const handleBuy = async () => {
    const buyResult = await buyIn(war.id, amount, dexVote, pairVote);
    if (buyResult.success) {
      onSuccess();
      // Optionally close modal after delay
      setTimeout(() => {
        reset();
        onClose();
      }, 2000);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Calculate max available (if target exists)
  const maxAvailable = war.targetAmount
    ? Math.min(10000, war.targetAmount - war.totalRaised)
    : 10000;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">Join {war.symbol}</h2>
            <p className="text-sm text-gray-500">{war.name}</p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {/* Success State */}
        {status === 'success' && result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <div className="text-green-600 text-2xl mb-2">✓</div>
            <div className="font-semibold text-green-800">Purchase Successful!</div>
            <div className="text-sm text-green-600 mt-1">
              You now own {result.wallet?.sharePercent.toFixed(2)}% of {war.symbol}
            </div>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="font-semibold text-red-800">Error</div>
            <div className="text-sm text-red-600">{error}</div>
            <button
              onClick={reset}
              className="mt-2 text-sm text-red-600 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Form (show when not success) */}
        {status !== 'success' && (
          <>
            {/* Amount Input */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Amount (USDC)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={maxAvailable}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(1, Math.min(maxAvailable, Number(e.target.value))))}
                  className="flex-1 border rounded-lg px-4 py-2 text-lg"
                  disabled={isLoading}
                />
                <span className="text-gray-500">USDC</span>
              </div>
              <div className="flex gap-2 mt-2">
                {[1, 5, 10, 25, 100].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setAmount(preset)}
                    disabled={isLoading || preset > maxAvailable}
                    className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    ${preset}
                  </button>
                ))}
              </div>
            </div>

            {/* DEX Vote */}
            <div>
              <label className="block text-sm font-medium mb-2">
                DEX Vote (where token launches)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['v4', 'aerodrome', 'hydrex'] as DexVote[]).map((dex) => (
                  <button
                    key={dex}
                    onClick={() => setDexVote(dex)}
                    disabled={isLoading}
                    className={`p-3 rounded-lg border-2 transition-colors ${
                      dexVote === dex
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium capitalize">{dex === 'v4' ? 'Uniswap V4' : dex}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pair Vote */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Pair Vote (trading pair)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['eth', 'wass'] as PairVote[]).map((pair) => (
                  <button
                    key={pair}
                    onClick={() => setPairVote(pair)}
                    disabled={isLoading}
                    className={`p-3 rounded-lg border-2 transition-colors ${
                      pairVote === pair
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium uppercase">{pair}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Your contribution</span>
                <span className="font-medium">${amount} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Estimated share</span>
                <span className="font-medium">
                  {((amount / (war.totalRaised + amount)) * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Your votes</span>
                <span className="font-medium">
                  {amount} {dexVote} + {amount} {pairVote.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Buy Button */}
            <button
              onClick={handleBuy}
              disabled={isLoading}
              className={`w-full py-4 rounded-xl font-semibold text-white transition-colors ${
                isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isAwaitingSignature ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-pulse">⏳</span>
                  Sign in Wallet...
                </span>
              ) : isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⟳</span>
                  Processing...
                </span>
              ) : (
                `Buy $${amount} USDC`
              )}
            </button>

            {/* Help text */}
            <p className="text-xs text-gray-500 text-center">
              You'll be asked to sign a message in your wallet. This authorizes the USDC transfer.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

---

## Part 7: Main Token War Page (pages/TokenWarPage.tsx)

```typescript
// pages/TokenWarPage.tsx (or app/token-wars/[id]/page.tsx for App Router)

import { useState } from 'react';
import { useTokenWar } from '@/hooks/useTokenWar';
import { ParticipantsList } from '@/components/ParticipantsList';
import { BuyModal } from '@/components/BuyModal';

interface TokenWarPageProps {
  warId: string;
}

export function TokenWarPage({ warId }: TokenWarPageProps) {
  const { war, participants, consensus, isLoading, error, refetch } = useTokenWar(warId);
  const [showBuyModal, setShowBuyModal] = useState(false);

  if (isLoading && !war) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        <p>Error: {error}</p>
        <button onClick={refetch} className="mt-4 underline">
          Try again
        </button>
      </div>
    );
  }

  if (!war) {
    return <div className="p-8 text-center">War not found</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">{war.symbol}</h1>
          <p className="text-gray-500">{war.name}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Time remaining</div>
          <div className="text-xl font-semibold">{war.timeRemainingFormatted}</div>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-gray-100 rounded-xl p-6">
        <div className="flex justify-between mb-2">
          <span className="font-medium">Raised</span>
          <span className="font-bold">${war.totalRaised} / ${war.targetAmount || '∞'}</span>
        </div>
        {war.progressPercent !== null && (
          <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${Math.min(100, war.progressPercent)}%` }}
            />
          </div>
        )}
        <div className="mt-2 text-sm text-gray-500">
          {war.participantCount} participant{war.participantCount !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Vote Consensus */}
      {consensus && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* DEX Votes */}
          <div className="bg-white border rounded-xl p-4">
            <h3 className="font-semibold mb-3">DEX Vote</h3>
            <div className="space-y-2">
              {(['v4', 'aerodrome', 'hydrex'] as const).map((dex) => {
                const data = consensus.dex[dex];
                const isLeading = consensus.dex.leading === dex;
                return (
                  <div key={dex} className="flex items-center gap-3">
                    <div className="w-24 font-medium capitalize">
                      {isLeading && '👑 '}
                      {dex === 'v4' ? 'Uniswap V4' : dex}
                    </div>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${isLeading ? 'bg-green-500' : 'bg-gray-300'}`}
                        style={{ width: `${data.percent}%` }}
                      />
                    </div>
                    <div className="w-16 text-right text-sm">
                      ${data.votes} ({data.percent.toFixed(0)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pair Votes */}
          <div className="bg-white border rounded-xl p-4">
            <h3 className="font-semibold mb-3">Pair Vote</h3>
            <div className="space-y-2">
              {(['eth', 'wass'] as const).map((pair) => {
                const data = consensus.pair[pair];
                const isLeading = consensus.pair.leading === pair;
                return (
                  <div key={pair} className="flex items-center gap-3">
                    <div className="w-24 font-medium uppercase">
                      {isLeading && '👑 '}
                      {pair}
                    </div>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${isLeading ? 'bg-blue-500' : 'bg-gray-300'}`}
                        style={{ width: `${data.percent}%` }}
                      />
                    </div>
                    <div className="w-16 text-right text-sm">
                      ${data.votes} ({data.percent.toFixed(0)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Buy Button */}
      {war.isActive && (
        <button
          onClick={() => setShowBuyModal(true)}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
        >
          Buy into {war.symbol}
        </button>
      )}

      {/* Participants */}
      <ParticipantsList participants={participants} totalRaised={war.totalRaised} />

      {/* Buy Modal */}
      <BuyModal
        war={war}
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        onSuccess={refetch}
      />
    </div>
  );
}
```

---

## Checklist

### Setup
- [ ] Add types file: `types/tokenWars.ts`
- [ ] Add API client: `lib/tokenWarsApi.ts`
- [ ] Configure wagmi with Base chain (chainId 8453)

### Hooks
- [ ] Add buy hook: `hooks/useTokenWarsBuy.ts`
- [ ] Add data hook: `hooks/useTokenWar.ts`

### Components
- [ ] Add participants: `components/ParticipantsList.tsx`
- [ ] Add buy modal: `components/BuyModal.tsx`
- [ ] Add main page: `pages/TokenWarPage.tsx`

### Testing
- [ ] Connect wallet on Base
- [ ] Load a war page - verify participants show
- [ ] Click Buy - verify wallet popup appears
- [ ] Sign transaction - verify success
- [ ] Check participants list updated

---

## Common Issues

### "No participants yet" when API has data
**Cause**: Not calling the right endpoint or not parsing response correctly
**Fix**: Use `fetchWarDetails(warId)` which returns `{ war, participants, consensus }`

### "X-PAYMENT header is required"
**Cause**: Frontend not handling 402 response
**Fix**: Implement two-step flow - get 402, sign payment, retry with header

### Wallet popup doesn't appear
**Cause**: `walletClient` is null
**Fix**: Ensure user is connected and on Base network (chainId 8453)

### "User rejected signature"
**Cause**: User clicked Cancel in wallet
**Fix**: Show user-friendly message, allow retry
