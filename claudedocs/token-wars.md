# Token Wars - Complete Frontend Implementation Guide

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Data Types & Interfaces](#3-data-types--interfaces)
4. [API Reference](#4-api-reference)
5. [Wallet Integration](#5-wallet-integration)
6. [React Hooks](#6-react-hooks)
7. [Components](#7-components)
8. [Pages & Routes](#8-pages--routes)
9. [State Management](#9-state-management)
10. [Real-Time Updates](#10-real-time-updates)
11. [Error Handling](#11-error-handling)
12. [Styling Reference](#12-styling-reference)

---

## 1. Overview

### What is Token Wars?

Token Wars is a community-driven token launch platform where users:
1. **Create Wars**: Propose new tokens with name, symbol, and image
2. **Buy In**: Purchase shares with USDC ($1-$10,000 per transaction)
3. **Vote**: Each dollar is a vote for DEX (V4/Aerodrome/Hydrex) and trading pair (ETH/wASS)
4. **Launch**: When sold out or timer ends, token launches on the winning DEX/pair

### Key Concepts

| Concept | Description |
|---------|-------------|
| **War** | A token launch campaign with funding goal and timer |
| **Buy-In** | USDC payment that gives shares and voting power |
| **DEX Vote** | Choose which DEX to launch on (V4, Aerodrome, Hydrex) |
| **Pair Vote** | Choose trading pair (ETH or wASS) |
| **Sellout** | When totalRaised >= targetAmount |
| **Countdown** | 60-second timer after sellout before launch |
| **Tie Extension** | +3 hours, +10% target when DEX votes are tied |

### User Journey

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Browse     │ ──► │  Connect    │ ──► │  Buy In     │ ──► │  Track      │
│  Wars       │     │  Wallet     │     │  + Vote     │     │  Progress   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
┌─────────────┐     ┌─────────────┐     ┌─────────────┐            │
│  Trade on   │ ◄── │  Token      │ ◄── │  Sellout &  │ ◄──────────┘
│  DEX        │     │  Launched   │     │  Countdown  │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 2. Architecture

### Tech Stack

```
Frontend:
├── React 18+ / Next.js 14+
├── TypeScript
├── wagmi v2 + viem (wallet connection)
├── TanStack Query (data fetching)
├── Tailwind CSS (styling)
└── Framer Motion (animations)

Backend API:
└── https://api.applesnakes.com

Blockchain:
├── Base Mainnet (Chain ID: 8453)
├── USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
└── AI Wallet: 0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098
```

### Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Home - War list
│   ├── war/[id]/page.tsx        # War detail page
│   ├── create/page.tsx          # Create new war
│   └── layout.tsx               # Root layout with providers
├── components/
│   ├── ui/                      # Base UI components
│   ├── war/                     # War-specific components
│   │   ├── WarCard.tsx
│   │   ├── WarDetail.tsx
│   │   ├── BuyPanel.tsx
│   │   ├── VoteDisplay.tsx
│   │   ├── CountdownTimer.tsx
│   │   └── ProgressBar.tsx
│   ├── wallet/                  # Wallet components
│   │   └── ConnectButton.tsx
│   └── layout/                  # Layout components
│       ├── Header.tsx
│       └── Footer.tsx
├── hooks/
│   ├── useTokenWars.ts          # Fetch wars list
│   ├── useTokenWar.ts           # Fetch single war
│   ├── useTokenWarsBuy.ts       # Buy functionality
│   ├── useTokenWarsCreate.ts    # Create war
│   └── useCountdown.ts          # Countdown timer
├── lib/
│   ├── api.ts                   # API client
│   ├── constants.ts             # Constants
│   └── utils.ts                 # Utility functions
├── types/
│   └── token-wars.ts            # TypeScript types
└── providers/
    └── Web3Provider.tsx         # Wallet provider setup
```

---

## 3. Data Types & Interfaces

### Core Types

```typescript
// types/token-wars.ts

// ============================================
// ENUMS & CONSTANTS
// ============================================

export type WarStatus = 'active' | 'launching' | 'launched' | 'failed' | 'cancelled';
export type DexVote = 'v4' | 'aerodrome' | 'hydrex';
export type PairVote = 'eth' | 'wass';
export type SelloutAction = 'none' | 'extended' | 'ready_to_launch' | 'already_processed' | 'countdown_started';

// ============================================
// WAR TYPES
// ============================================

export interface TokenWar {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;           // IPFS URL (ipfs://...)
  status: WarStatus;

  // Funding
  totalRaised: number;         // Current USDC raised
  targetAmount: number | null; // Sellout threshold (null = no limit)
  participantCount: number;

  // Timing
  createdAt: number;           // Unix timestamp (ms)
  endsAt: number;              // Unix timestamp (ms) - CHANGES ON SELLOUT!
  timeRemainingMs: number;
  timeRemainingFormatted?: string;

  // Creator
  creatorWallet: string;
  creatorBuyUsdc: number;
  creatorDexVote: DexVote;
  creatorPairVote: PairVote;

  // Votes (USDC amounts)
  v4VotesUsdc: number;
  aerodromeVotesUsdc: number;
  hydrexVotesUsdc: number;
  ethVotesUsdc: number;
  wassVotesUsdc: number;

  // Prediction Markets
  dexMarketId?: string;
  pairMarketId?: string;
  selloutMarketId?: string;

  // Launch Results (after launch)
  winningDex?: DexVote;
  winningPair?: PairVote;
  tokenAddress?: string;       // Deployed token contract
  poolAddress?: string;        // LP pool address
  launchTxHash?: string;

  // Tie handling
  tieExtensions: number;       // Number of times extended (max 5)
}

export interface TokenWarSummary {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  status: WarStatus;
  totalRaised: number;
  targetAmount: number | null;
  participantCount: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted?: string;
  tokenAddress?: string;
  winningDex?: DexVote;
  winningPair?: PairVote;
}

// ============================================
// VOTE CONSENSUS
// ============================================

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

// ============================================
// PARTICIPANT
// ============================================

export interface Participant {
  wallet: string;
  totalUsdc: number;
  sharePercent: number;
  buyCount: number;
  lastDexVote: DexVote;
  lastPairVote: PairVote;
  votes?: {
    v4: number;
    aerodrome: number;
    hydrex: number;
    eth: number;
    wass: number;
  };
}

// ============================================
// SELLOUT STATUS
// ============================================

export interface SelloutInfo {
  isSoldOut: boolean;
  readyToLaunch: boolean;
  action: SelloutAction;
  message: string;
  countdownEndsAt?: number;    // Unix timestamp (ms) when countdown ends
}

// ============================================
// API RESPONSES
// ============================================

export interface WarsListResponse {
  success: boolean;
  wars: TokenWarSummary[];
  stats: {
    totalWars: number;
    activeWars: number;
    launchedWars: number;
    totalRaisedUsdc: number;
    totalParticipants: number;
  };
  error?: string;
}

export interface WarDetailResponse {
  success: boolean;
  war: TokenWar;
  consensus: VoteConsensus | null;
  participants: Participant[];
  predictionMarkets: {
    dexMarketId?: string;
    pairMarketId?: string;
    selloutMarketId?: string;
  };
  error?: string;
}

export interface BuyResponse {
  success: boolean;
  message: string;
  buy: {
    warId: string;
    amount: number;
    txHash: string;
    wallet: string;
    timestamp: number;
    dexVote: DexVote;
    pairVote: PairVote;
  };
  war: {
    id: string;
    name: string;
    symbol: string;
    totalRaised: number;
    targetAmount: number | null;
    participantCount: number;
    endsAt: number;
    timeRemainingMs: number;
    status: WarStatus;
    tokenAddress?: string;
    imageUrl?: string;
  };
  wallet: {
    totalContribution: number;
    sharePercent: number;
  };
  consensus: VoteConsensus | null;
  sellout: SelloutInfo;
  error?: string;
}

export interface CreateWarResponse {
  success: boolean;
  message: string;
  war: TokenWar;
  error?: string;
}

export interface LaunchResponse {
  success: boolean;
  message: string;
  war: {
    id: string;
    name: string;
    symbol: string;
    status: WarStatus;
    totalRaised: number;
    participantCount: number;
  };
  launch: {
    dex: DexVote;
    pair: PairVote;
    tokenAddress: string;
    poolAddress?: string;
    txHash: string;
    devBuyEth: string;
  };
  swap: {
    usdcAmount: string;
    ethAmount: string;
    txHash: string;
  };
  links: {
    basescan: string;
    dexscreener: string;
    launchTx: string;
  };
  error?: string;
}
```

---

## 4. API Reference

### Base Configuration

```typescript
// lib/api.ts

const API_BASE = 'https://api.applesnakes.com';

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API Error: ${response.status}`);
  }

  return data;
}
```

### Endpoints

#### 1. List Wars

```typescript
// GET /api/token-wars

interface ListWarsParams {
  status?: 'active' | 'launched' | 'all';
  limit?: number;
  offset?: number;
  all?: boolean;  // Include all statuses
}

async function listWars(params?: ListWarsParams): Promise<WarsListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());
  if (params?.all) searchParams.set('all', 'true');

  return apiFetch(`/api/token-wars?${searchParams}`);
}
```

**Response:**
```json
{
  "success": true,
  "wars": [
    {
      "id": "war-1702500000000-abc123",
      "name": "Moon Rocket",
      "symbol": "MOON",
      "description": "To the moon!",
      "imageUrl": "ipfs://QmXxx...",
      "status": "active",
      "totalRaised": 500,
      "targetAmount": 1000,
      "participantCount": 25,
      "endsAt": 1702600000000,
      "timeRemainingMs": 3600000,
      "timeRemainingFormatted": "1h 0m"
    }
  ],
  "stats": {
    "totalWars": 50,
    "activeWars": 5,
    "launchedWars": 40,
    "totalRaisedUsdc": 50000,
    "totalParticipants": 500
  }
}
```

#### 2. Get War Details

```typescript
// GET /api/token-wars/buy?warId={id}

async function getWarDetails(warId: string): Promise<WarDetailResponse> {
  return apiFetch(`/api/token-wars/buy?warId=${warId}`);
}
```

**Response:**
```json
{
  "success": true,
  "war": {
    "id": "war-1702500000000-abc123",
    "name": "Moon Rocket",
    "symbol": "MOON",
    "description": "To the moon!",
    "imageUrl": "ipfs://QmXxx...",
    "status": "active",
    "totalRaised": 500,
    "targetAmount": 1000,
    "participantCount": 25,
    "endsAt": 1702600000000,
    "v4VotesUsdc": 200,
    "aerodromeVotesUsdc": 250,
    "hydrexVotesUsdc": 50,
    "ethVotesUsdc": 300,
    "wassVotesUsdc": 200,
    "creatorWallet": "0x123...",
    "creatorBuyUsdc": 10,
    "creatorDexVote": "aerodrome",
    "creatorPairVote": "eth",
    "tieExtensions": 0
  },
  "consensus": {
    "dex": {
      "leading": "aerodrome",
      "v4": { "votes": 200, "percent": 40 },
      "aerodrome": { "votes": 250, "percent": 50 },
      "hydrex": { "votes": 50, "percent": 10 },
      "isTie": false
    },
    "pair": {
      "leading": "eth",
      "eth": { "votes": 300, "percent": 60 },
      "wass": { "votes": 200, "percent": 40 },
      "isTie": false
    },
    "totalVotes": 500
  },
  "participants": [
    {
      "wallet": "0x123...",
      "totalUsdc": 100,
      "sharePercent": 20,
      "buyCount": 5,
      "lastDexVote": "aerodrome",
      "lastPairVote": "eth"
    }
  ],
  "predictionMarkets": {
    "dexMarketId": "market-dex-123",
    "pairMarketId": "market-pair-123",
    "selloutMarketId": "market-sellout-123"
  }
}
```

#### 3. Buy Into War (IMPORTANT: Use /verified!)

```typescript
// POST /api/token-wars/buy/verified
// ⚠️ DO NOT use /api/token-wars/buy - it only accepts $1 exactly!

interface BuyParams {
  warId: string;
  dexVote: DexVote;
  pairVote: PairVote;
}

interface PaymentPayload {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
}

async function buyIntoWar(
  params: BuyParams,
  payment: PaymentPayload
): Promise<BuyResponse> {
  return apiFetch('/api/token-wars/buy/verified', {
    method: 'POST',
    headers: {
      'X-PAYMENT': btoa(JSON.stringify(payment)),
    },
    body: JSON.stringify(params),
  });
}
```

**Response (on sellout):**
```json
{
  "success": true,
  "message": "🎉 MOON Token War SOLD OUT! 60-second countdown started!",
  "buy": {
    "warId": "war-123",
    "amount": 50,
    "txHash": "0xabc...",
    "wallet": "0x456...",
    "timestamp": 1702500000000,
    "dexVote": "aerodrome",
    "pairVote": "eth"
  },
  "war": {
    "id": "war-123",
    "name": "Moon Rocket",
    "symbol": "MOON",
    "totalRaised": 1000,
    "targetAmount": 1000,
    "participantCount": 50,
    "endsAt": 1702500060000,
    "timeRemainingMs": 60000,
    "status": "active",
    "imageUrl": "ipfs://QmXxx..."
  },
  "sellout": {
    "isSoldOut": true,
    "readyToLaunch": false,
    "action": "countdown_started",
    "message": "🎉 SOLD OUT! 60-second countdown started!",
    "countdownEndsAt": 1702500060000
  }
}
```

#### 4. Create War

```typescript
// POST /api/token-wars/create

interface CreateWarParams {
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;        // IPFS URL
  targetAmount?: number;    // Sellout threshold
  durationHours?: number;   // Default: 24
  dexVote: DexVote;         // Creator's vote
  pairVote: PairVote;       // Creator's vote
  // Payment required: minimum $1 USDC
}

async function createWar(
  params: CreateWarParams,
  payment: PaymentPayload
): Promise<CreateWarResponse> {
  return apiFetch('/api/token-wars/create', {
    method: 'POST',
    headers: {
      'X-PAYMENT': btoa(JSON.stringify(payment)),
    },
    body: JSON.stringify(params),
  });
}
```

#### 5. Check Launch Status

```typescript
// GET /api/token-wars/launch?warId={id}

async function checkLaunchStatus(warId: string) {
  return apiFetch(`/api/token-wars/launch?warId=${warId}`);
}
```

**Response:**
```json
{
  "success": true,
  "war": {
    "id": "war-123",
    "name": "Moon Rocket",
    "symbol": "MOON",
    "status": "active",
    "totalRaised": 1000,
    "isEnded": true,
    "isSoldOut": true
  },
  "consensus": {
    "winningDex": "aerodrome",
    "winningPair": "eth",
    "isDexTie": false,
    "isPairTie": false
  },
  "launch": {
    "canLaunch": true,
    "reason": "No tie - ready to resolve"
  }
}
```

#### 6. Trigger Launch

```typescript
// POST /api/token-wars/launch

async function triggerLaunch(warId: string, force = false): Promise<LaunchResponse> {
  return apiFetch('/api/token-wars/launch', {
    method: 'POST',
    body: JSON.stringify({ warId, force }),
  });
}
```

---

## 5. Wallet Integration

### Provider Setup

```typescript
// providers/Web3Provider.tsx

'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';

const config = createConfig(
  getDefaultConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://mainnet.base.org'),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
    appName: 'Token Wars',
    appDescription: 'Community-driven token launches',
    appUrl: 'https://tokenwars.app',
    appIcon: '/logo.png',
  })
);

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight">
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

### Connect Button

```typescript
// components/wallet/ConnectButton.tsx

'use client';

import { ConnectKitButton } from 'connectkit';

export function ConnectButton() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, address, ensName }) => (
        <button
          onClick={show}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold hover:opacity-90 transition"
        >
          {isConnected ? (
            <span>{ensName || `${address?.slice(0, 6)}...${address?.slice(-4)}`}</span>
          ) : (
            <span>Connect Wallet</span>
          )}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
```

---

## 6. React Hooks

### useTokenWars - List Wars

```typescript
// hooks/useTokenWars.ts

import { useQuery } from '@tanstack/react-query';
import type { WarsListResponse, TokenWarSummary } from '@/types/token-wars';

const API_BASE = 'https://api.applesnakes.com';

interface UseTokenWarsOptions {
  status?: 'active' | 'launched' | 'all';
  autoRefresh?: number;  // ms
}

export function useTokenWars(options?: UseTokenWarsOptions) {
  const { status, autoRefresh = 10000 } = options || {};

  const query = useQuery({
    queryKey: ['token-wars', status],
    queryFn: async (): Promise<WarsListResponse> => {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.set('status', status);
      params.set('all', 'true');
      params.set('limit', '50');

      const response = await fetch(`${API_BASE}/api/token-wars?${params}`);
      return response.json();
    },
    refetchInterval: autoRefresh,
    staleTime: 5000,
  });

  return {
    wars: query.data?.wars || [],
    stats: query.data?.stats,
    isLoading: query.isLoading,
    error: query.error?.message || query.data?.error,
    refresh: query.refetch,
  };
}
```

### useTokenWar - Single War Detail

```typescript
// hooks/useTokenWar.ts

import { useQuery } from '@tanstack/react-query';
import type { WarDetailResponse } from '@/types/token-wars';

const API_BASE = 'https://api.applesnakes.com';

export function useTokenWar(warId: string | null, autoRefresh = 5000) {
  const query = useQuery({
    queryKey: ['token-war', warId],
    queryFn: async (): Promise<WarDetailResponse> => {
      const response = await fetch(`${API_BASE}/api/token-wars/buy?warId=${warId}`);
      return response.json();
    },
    enabled: !!warId,
    refetchInterval: autoRefresh,
    staleTime: 2000,
  });

  const war = query.data?.war;
  const consensus = query.data?.consensus;

  // Derived state
  const isSoldOut = war?.targetAmount ? war.totalRaised >= war.targetAmount : false;
  const isEnded = war ? Date.now() >= war.endsAt : false;
  const progress = war?.targetAmount ? (war.totalRaised / war.targetAmount) * 100 : 0;

  return {
    war,
    consensus,
    participants: query.data?.participants || [],
    predictionMarkets: query.data?.predictionMarkets,
    isLoading: query.isLoading,
    error: query.error?.message || query.data?.error,
    refresh: query.refetch,
    // Derived
    isSoldOut,
    isEnded,
    progress,
  };
}
```

### useTokenWarsBuy - Buy Functionality

```typescript
// hooks/useTokenWarsBuy.ts

import { useState, useCallback } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import type { DexVote, PairVote, BuyResponse, SelloutInfo } from '@/types/token-wars';

const API_BASE = 'https://api.applesnakes.com';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_DECIMALS = 6;
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

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

// USDC ABI for balance check
const USDC_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

export type BuyStatus = 'idle' | 'checking_balance' | 'signing' | 'processing' | 'success' | 'error';

export function useTokenWarsBuy() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [status, setStatus] = useState<BuyStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BuyResponse | null>(null);
  const [sellout, setSellout] = useState<SelloutInfo | null>(null);

  // Check USDC balance
  const checkBalance = useCallback(async (amount: number): Promise<boolean> => {
    if (!address || !publicClient) return false;

    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [address],
      });

      const requiredAmount = BigInt(Math.floor(amount * 10 ** USDC_DECIMALS));
      return balance >= requiredAmount;
    } catch {
      return false;
    }
  }, [address, publicClient]);

  // Get USDC balance
  const getBalance = useCallback(async (): Promise<number> => {
    if (!address || !publicClient) return 0;

    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [address],
      });

      return Number(balance) / 10 ** USDC_DECIMALS;
    } catch {
      return 0;
    }
  }, [address, publicClient]);

  // Main buy function
  const buyIn = useCallback(async (
    warId: string,
    amountUSDC: number,
    dexVote: DexVote,
    pairVote: PairVote
  ): Promise<BuyResponse> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    if (amountUSDC < 1) {
      throw new Error('Minimum buy is $1 USDC');
    }

    if (amountUSDC > 10000) {
      throw new Error('Maximum buy is $10,000 USDC');
    }

    // Reset state
    setError(null);
    setSellout(null);

    try {
      // Check balance first
      setStatus('checking_balance');
      const hasBalance = await checkBalance(amountUSDC);
      if (!hasBalance) {
        throw new Error(`Insufficient USDC balance. You need $${amountUSDC} USDC.`);
      }

      // Sign authorization
      setStatus('signing');

      const amountAtomic = BigInt(Math.floor(amountUSDC * 10 ** USDC_DECIMALS));
      const nonce = generateNonce();
      const now = Math.floor(Date.now() / 1000);
      const validBefore = BigInt(now + 3600); // 1 hour

      const signature = await walletClient.signTypedData({
        account: walletClient.account!,
        domain: USDC_DOMAIN,
        types: TRANSFER_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address as `0x${string}`,
          to: AI_WALLET as `0x${string}`,
          value: amountAtomic,
          validAfter: BigInt(0),
          validBefore,
          nonce,
        },
      });

      // Submit to API
      setStatus('processing');

      const paymentPayload = {
        from: address,
        to: AI_WALLET,
        value: amountAtomic.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce,
        signature,
      };

      const response = await fetch(`${API_BASE}/api/token-wars/buy/verified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': btoa(JSON.stringify(paymentPayload)),
        },
        body: JSON.stringify({ warId, dexVote, pairVote }),
      });

      const result: BuyResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Buy failed');
      }

      // Success!
      setStatus('success');
      setLastResult(result);
      setSellout(result.sellout);

      return result;

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Buy failed';
      setError(errorMsg);
      setStatus('error');
      throw err;
    }
  }, [walletClient, address, checkBalance]);

  // Reset state
  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setLastResult(null);
    setSellout(null);
  }, []);

  return {
    // Actions
    buyIn,
    reset,
    checkBalance,
    getBalance,
    // State
    status,
    error,
    lastResult,
    sellout,
    isConnected,
    address,
    // Computed
    isLoading: status === 'checking_balance' || status === 'signing' || status === 'processing',
    isSuccess: status === 'success',
    isError: status === 'error',
  };
}
```

### useCountdown - Timer Hook

```typescript
// hooks/useCountdown.ts

import { useState, useEffect, useCallback } from 'react';

interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  isExpired: boolean;
  formatted: string;
}

export function useCountdown(endTime: number | null): CountdownState {
  const calculate = useCallback((): CountdownState => {
    if (!endTime) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalSeconds: 0,
        isExpired: true,
        formatted: '0:00',
      };
    }

    const now = Date.now();
    const diff = Math.max(0, endTime - now);
    const totalSeconds = Math.floor(diff / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let formatted: string;
    if (days > 0) {
      formatted = `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      formatted = `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      formatted = `0:${seconds.toString().padStart(2, '0')}`;
    }

    return {
      days,
      hours,
      minutes,
      seconds,
      totalSeconds,
      isExpired: diff <= 0,
      formatted,
    };
  }, [endTime]);

  const [state, setState] = useState<CountdownState>(calculate);

  useEffect(() => {
    setState(calculate());

    const interval = setInterval(() => {
      setState(calculate());
    }, 1000);

    return () => clearInterval(interval);
  }, [calculate]);

  return state;
}
```

---

## 7. Components

### WarCard

```typescript
// components/war/WarCard.tsx

'use client';

import Link from 'next/link';
import { useCountdown } from '@/hooks/useCountdown';
import type { TokenWarSummary } from '@/types/token-wars';

interface WarCardProps {
  war: TokenWarSummary;
}

export function WarCard({ war }: WarCardProps) {
  const countdown = useCountdown(war.endsAt);

  const progress = war.targetAmount
    ? Math.min((war.totalRaised / war.targetAmount) * 100, 100)
    : 0;

  const isSoldOut = war.targetAmount
    ? war.totalRaised >= war.targetAmount
    : false;

  const imageUrl = war.imageUrl?.replace('ipfs://', 'https://ipfs.io/ipfs/');

  const statusColors = {
    active: 'bg-green-500',
    launching: 'bg-yellow-500',
    launched: 'bg-blue-500',
    failed: 'bg-red-500',
    cancelled: 'bg-gray-500',
  };

  return (
    <Link href={`/war/${war.id}`}>
      <div className="bg-gray-800 rounded-xl overflow-hidden hover:ring-2 hover:ring-purple-500 transition cursor-pointer">
        {/* Image */}
        <div className="aspect-square bg-gray-700 relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={war.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-gray-500">
              {war.symbol.slice(0, 2)}
            </div>
          )}

          {/* Status Badge */}
          <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-semibold ${statusColors[war.status]}`}>
            {war.status.toUpperCase()}
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <h3 className="font-bold text-lg truncate">{war.name}</h3>
          <p className="text-gray-400 text-sm">${war.symbol}</p>

          {/* Progress Bar */}
          {war.targetAmount && (
            <div className="mt-3">
              <div className="flex justify-between text-sm mb-1">
                <span>${war.totalRaised.toLocaleString()}</span>
                <span className="text-gray-400">${war.targetAmount.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 flex justify-between items-center text-sm">
            <span className="text-gray-400">
              {war.participantCount} participant{war.participantCount !== 1 ? 's' : ''}
            </span>

            {war.status === 'active' && (
              <span className={isSoldOut ? 'text-green-400 font-semibold' : 'text-gray-400'}>
                {isSoldOut ? '🎉 SOLD OUT' : countdown.formatted}
              </span>
            )}

            {war.status === 'launched' && war.tokenAddress && (
              <span className="text-blue-400">View Token →</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
```

### BuyPanel

```typescript
// components/war/BuyPanel.tsx

'use client';

import { useState, useEffect } from 'react';
import { useTokenWarsBuy } from '@/hooks/useTokenWarsBuy';
import type { TokenWar, DexVote, PairVote, SelloutInfo } from '@/types/token-wars';

interface BuyPanelProps {
  war: TokenWar;
  onBuySuccess?: (sellout: SelloutInfo) => void;
}

const DEX_OPTIONS: { value: DexVote; label: string; description: string }[] = [
  { value: 'aerodrome', label: 'Aerodrome', description: 'Most popular DEX on Base' },
  { value: 'v4', label: 'Uniswap V4', description: 'Latest Uniswap with hooks' },
  { value: 'hydrex', label: 'Hydrex', description: 'Community DEX' },
];

const PAIR_OPTIONS: { value: PairVote; label: string; description: string }[] = [
  { value: 'eth', label: 'ETH', description: 'Trade against ETH' },
  { value: 'wass', label: 'wASS', description: 'Trade against wASS (OTC launch)' },
];

const AMOUNT_PRESETS = [1, 5, 10, 25, 50, 100];

export function BuyPanel({ war, onBuySuccess }: BuyPanelProps) {
  const {
    buyIn,
    status,
    error,
    isConnected,
    getBalance,
    reset,
  } = useTokenWarsBuy();

  const [amount, setAmount] = useState<number>(5);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [dexVote, setDexVote] = useState<DexVote>('aerodrome');
  const [pairVote, setPairVote] = useState<PairVote>('eth');
  const [balance, setBalance] = useState<number | null>(null);

  // Fetch balance on mount
  useEffect(() => {
    if (isConnected) {
      getBalance().then(setBalance);
    }
  }, [isConnected, getBalance]);

  const actualAmount = customAmount ? parseFloat(customAmount) : amount;
  const canBuy = isConnected && actualAmount >= 1 && actualAmount <= 10000 && war.status === 'active';

  const handleBuy = async () => {
    if (!canBuy) return;

    try {
      const result = await buyIn(war.id, actualAmount, dexVote, pairVote);

      if (result.sellout) {
        onBuySuccess?.(result.sellout);
      }
    } catch (err) {
      // Error is handled by the hook
    }
  };

  // Status messages
  const statusMessages: Record<string, string> = {
    checking_balance: 'Checking balance...',
    signing: 'Please sign the transaction in your wallet...',
    processing: 'Processing payment...',
    success: '✅ Purchase successful!',
    error: error || 'An error occurred',
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Buy ${war.symbol}</h2>

      {/* Amount Selection */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Amount (USDC)</label>

        {/* Presets */}
        <div className="grid grid-cols-3 gap-2 mb-2">
          {AMOUNT_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setAmount(preset);
                setCustomAmount('');
              }}
              className={`py-2 rounded-lg font-semibold transition ${
                amount === preset && !customAmount
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ${preset}
            </button>
          ))}
        </div>

        {/* Custom Amount */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
          <input
            type="number"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Custom amount"
            min="1"
            max="10000"
            className="w-full pl-8 pr-4 py-2 bg-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
          />
        </div>

        {balance !== null && (
          <p className="text-sm text-gray-400 mt-1">
            Balance: ${balance.toLocaleString()} USDC
          </p>
        )}
      </div>

      {/* DEX Vote */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Vote for DEX</label>
        <div className="space-y-2">
          {DEX_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setDexVote(option.value)}
              className={`w-full p-3 rounded-lg text-left transition ${
                dexVote === option.value
                  ? 'bg-purple-500/20 border border-purple-500'
                  : 'bg-gray-700 border border-transparent hover:border-gray-600'
              }`}
            >
              <div className="font-semibold">{option.label}</div>
              <div className="text-sm text-gray-400">{option.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Pair Vote */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">Vote for Trading Pair</label>
        <div className="grid grid-cols-2 gap-2">
          {PAIR_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setPairVote(option.value)}
              className={`p-3 rounded-lg text-center transition ${
                pairVote === option.value
                  ? 'bg-purple-500/20 border border-purple-500'
                  : 'bg-gray-700 border border-transparent hover:border-gray-600'
              }`}
            >
              <div className="font-semibold">{option.label}</div>
              <div className="text-xs text-gray-400">{option.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Status Message */}
      {status !== 'idle' && (
        <div className={`mb-4 p-3 rounded-lg ${
          status === 'success' ? 'bg-green-500/20 text-green-400' :
          status === 'error' ? 'bg-red-500/20 text-red-400' :
          'bg-blue-500/20 text-blue-400'
        }`}>
          {statusMessages[status]}
        </div>
      )}

      {/* Buy Button */}
      {!isConnected ? (
        <button className="w-full py-3 rounded-lg bg-gray-600 text-gray-400 cursor-not-allowed">
          Connect Wallet to Buy
        </button>
      ) : (
        <button
          onClick={handleBuy}
          disabled={!canBuy || status === 'signing' || status === 'processing'}
          className={`w-full py-3 rounded-lg font-semibold transition ${
            canBuy && status !== 'signing' && status !== 'processing'
              ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
          }`}
        >
          {status === 'signing' || status === 'processing' ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {status === 'signing' ? 'Sign in Wallet...' : 'Processing...'}
            </span>
          ) : (
            `Buy $${actualAmount} ${war.symbol}`
          )}
        </button>
      )}

      {/* Vote Summary */}
      <p className="text-center text-sm text-gray-400 mt-3">
        Your vote: {dexVote.charAt(0).toUpperCase() + dexVote.slice(1)} / {pairVote.toUpperCase()}
      </p>
    </div>
  );
}
```

### VoteDisplay

```typescript
// components/war/VoteDisplay.tsx

'use client';

import type { VoteConsensus } from '@/types/token-wars';

interface VoteDisplayProps {
  consensus: VoteConsensus | null;
}

export function VoteDisplay({ consensus }: VoteDisplayProps) {
  if (!consensus) {
    return (
      <div className="bg-gray-800 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4">Vote Results</h2>
        <p className="text-gray-400">No votes yet</p>
      </div>
    );
  }

  const dexColors = {
    v4: 'from-blue-500 to-cyan-500',
    aerodrome: 'from-purple-500 to-pink-500',
    hydrex: 'from-orange-500 to-yellow-500',
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Vote Results</h2>
      <p className="text-sm text-gray-400 mb-4">
        Total: ${consensus.totalVotes.toLocaleString()} USDC
      </p>

      {/* DEX Votes */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="font-semibold">DEX</span>
          {consensus.dex.isTie && (
            <span className="text-yellow-400 text-sm">⚠️ TIE</span>
          )}
        </div>

        {(['v4', 'aerodrome', 'hydrex'] as const).map((dex) => {
          const vote = consensus.dex[dex];
          const isLeading = consensus.dex.leading === dex && !consensus.dex.isTie;

          return (
            <div key={dex} className="mb-2">
              <div className="flex justify-between text-sm mb-1">
                <span className={isLeading ? 'text-white font-semibold' : 'text-gray-400'}>
                  {dex.charAt(0).toUpperCase() + dex.slice(1)}
                  {isLeading && ' 👑'}
                </span>
                <span className="text-gray-400">
                  ${vote.votes.toLocaleString()} ({vote.percent.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${dexColors[dex]} transition-all`}
                  style={{ width: `${vote.percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pair Votes */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="font-semibold">Trading Pair</span>
          {consensus.pair.isTie && (
            <span className="text-yellow-400 text-sm">→ wASS wins</span>
          )}
        </div>

        {(['eth', 'wass'] as const).map((pair) => {
          const vote = consensus.pair[pair];
          const isLeading = consensus.pair.leading === pair && !consensus.pair.isTie;
          const color = pair === 'eth' ? 'from-blue-500 to-indigo-500' : 'from-green-500 to-emerald-500';

          return (
            <div key={pair} className="mb-2">
              <div className="flex justify-between text-sm mb-1">
                <span className={isLeading ? 'text-white font-semibold' : 'text-gray-400'}>
                  {pair.toUpperCase()}
                  {isLeading && ' 👑'}
                </span>
                <span className="text-gray-400">
                  ${vote.votes.toLocaleString()} ({vote.percent.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${color} transition-all`}
                  style={{ width: `${vote.percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Tie Warnings */}
      {consensus.dex.isTie && (
        <div className="mt-4 p-3 bg-yellow-500/20 rounded-lg text-yellow-400 text-sm">
          ⚠️ DEX tie! If the war ends now, it will be extended (+3h, +10% target)
        </div>
      )}
    </div>
  );
}
```

### CountdownTimer

```typescript
// components/war/CountdownTimer.tsx

'use client';

import { useCountdown } from '@/hooks/useCountdown';

interface CountdownTimerProps {
  endTime: number;
  onExpire?: () => void;
  variant?: 'default' | 'sellout';
}

export function CountdownTimer({ endTime, onExpire, variant = 'default' }: CountdownTimerProps) {
  const { days, hours, minutes, seconds, totalSeconds, isExpired } = useCountdown(endTime);

  // Call onExpire when countdown reaches 0
  if (isExpired && onExpire) {
    onExpire();
  }

  if (variant === 'sellout') {
    // Big dramatic countdown for sellout
    return (
      <div className="text-center py-8">
        <div className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
          {totalSeconds}
        </div>
        <div className="text-xl text-gray-400 mt-2">
          seconds until launch
        </div>
        <div className="mt-4 flex justify-center gap-1">
          {[...Array(Math.min(totalSeconds, 60))].map((_, i) => (
            <div
              key={i}
              className="w-1 h-8 bg-gradient-to-t from-purple-500 to-pink-500 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 50}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // Default countdown display
  if (days > 0) {
    return (
      <div className="flex gap-2 text-center">
        <TimeUnit value={days} label="days" />
        <TimeUnit value={hours} label="hrs" />
        <TimeUnit value={minutes} label="min" />
      </div>
    );
  }

  if (hours > 0) {
    return (
      <div className="flex gap-2 text-center">
        <TimeUnit value={hours} label="hrs" />
        <TimeUnit value={minutes} label="min" />
        <TimeUnit value={seconds} label="sec" />
      </div>
    );
  }

  return (
    <div className="flex gap-2 text-center">
      <TimeUnit value={minutes} label="min" />
      <TimeUnit value={seconds} label="sec" />
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-gray-700 rounded-lg px-3 py-2 min-w-[60px]">
      <div className="text-2xl font-bold">{value.toString().padStart(2, '0')}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}
```

### ContractDisplay

```typescript
// components/war/ContractDisplay.tsx

'use client';

import { useState } from 'react';
import type { TokenWar } from '@/types/token-wars';

interface ContractDisplayProps {
  war: TokenWar;
}

export function ContractDisplay({ war }: ContractDisplayProps) {
  const [copied, setCopied] = useState(false);

  if (!war.tokenAddress) {
    return null;
  }

  const copyAddress = async () => {
    await navigator.clipboard.writeText(war.tokenAddress!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortAddress = `${war.tokenAddress.slice(0, 10)}...${war.tokenAddress.slice(-8)}`;

  return (
    <div className="bg-gray-800 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Token Deployed! 🎉</h2>

      {/* Contract Address */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Contract Address</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-gray-700 px-3 py-2 rounded text-sm font-mono">
            {shortAddress}
          </code>
          <button
            onClick={copyAddress}
            className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 transition"
          >
            {copied ? '✓' : '📋'}
          </button>
        </div>
      </div>

      {/* Launch Info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">DEX</label>
          <div className="font-semibold">
            {war.winningDex?.charAt(0).toUpperCase()}{war.winningDex?.slice(1)}
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Trading Pair</label>
          <div className="font-semibold">{war.winningPair?.toUpperCase()}</div>
        </div>
      </div>

      {/* Links */}
      <div className="space-y-2">
        <a
          href={`https://basescan.org/token/${war.tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
        >
          <span>View on Basescan</span>
          <span>→</span>
        </a>

        <a
          href={`https://dexscreener.com/base/${war.tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full p-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:opacity-90 transition font-semibold"
        >
          <span>Trade on DexScreener</span>
          <span>→</span>
        </a>
      </div>
    </div>
  );
}
```

---

## 8. Pages & Routes

### Home Page (War List)

```typescript
// app/page.tsx

'use client';

import { useState } from 'react';
import { useTokenWars } from '@/hooks/useTokenWars';
import { WarCard } from '@/components/war/WarCard';
import { ConnectButton } from '@/components/wallet/ConnectButton';

type FilterStatus = 'active' | 'launched' | 'all';

export default function HomePage() {
  const [filter, setFilter] = useState<FilterStatus>('active');
  const { wars, stats, isLoading, error } = useTokenWars({
    status: filter,
    autoRefresh: 10000,
  });

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Token Wars</h1>
          <ConnectButton />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Active Wars" value={stats.activeWars} />
            <StatCard label="Launched" value={stats.launchedWars} />
            <StatCard label="Total Raised" value={`$${(stats.totalRaisedUsdc).toLocaleString()}`} />
            <StatCard label="Participants" value={stats.totalParticipants} />
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {(['active', 'launched', 'all'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                filter === status
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Wars Grid */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-400 mt-4">Loading wars...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-400">{error}</p>
          </div>
        ) : wars.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No wars found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {wars.map((war) => (
              <WarCard key={war.id} war={war} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
```

### War Detail Page

```typescript
// app/war/[id]/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTokenWar } from '@/hooks/useTokenWar';
import { BuyPanel } from '@/components/war/BuyPanel';
import { VoteDisplay } from '@/components/war/VoteDisplay';
import { CountdownTimer } from '@/components/war/CountdownTimer';
import { ContractDisplay } from '@/components/war/ContractDisplay';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import type { SelloutInfo } from '@/types/token-wars';

export default function WarDetailPage() {
  const params = useParams();
  const warId = params.id as string;

  const { war, consensus, participants, isLoading, error, isSoldOut, progress, refresh } = useTokenWar(warId);
  const [selloutCountdown, setSelloutCountdown] = useState<number | null>(null);

  // Handle sellout from buy
  const handleBuySuccess = (sellout: SelloutInfo) => {
    if (sellout.action === 'countdown_started' && sellout.countdownEndsAt) {
      setSelloutCountdown(sellout.countdownEndsAt);
    }
    // Refresh data
    refresh();
  };

  // Auto-detect sellout from polling
  useEffect(() => {
    if (isSoldOut && war && !selloutCountdown) {
      // Check if countdown is already in progress (endsAt is within 60 seconds)
      const timeRemaining = war.endsAt - Date.now();
      if (timeRemaining > 0 && timeRemaining <= 60000) {
        setSelloutCountdown(war.endsAt);
      }
    }
  }, [isSoldOut, war, selloutCountdown]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !war) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-red-400">{error || 'War not found'}</p>
      </div>
    );
  }

  const imageUrl = war.imageUrl?.replace('ipfs://', 'https://ipfs.io/ipfs/');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <a href="/" className="text-xl font-bold">← Token Wars</a>
          <ConnectButton />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Sellout Banner */}
        {selloutCountdown && (
          <div className="mb-8 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-xl p-6 border border-purple-500">
            <h2 className="text-2xl font-bold text-center mb-4">🎉 SOLD OUT!</h2>
            <CountdownTimer endTime={selloutCountdown} variant="sellout" onExpire={refresh} />
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - War Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Hero */}
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={war.name}
                  className="w-full aspect-video object-cover"
                />
              )}
              <div className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <h1 className="text-3xl font-bold">{war.name}</h1>
                  <span className="px-3 py-1 bg-gray-700 rounded-full text-sm">
                    ${war.symbol}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    war.status === 'active' ? 'bg-green-500' :
                    war.status === 'launched' ? 'bg-blue-500' :
                    'bg-gray-600'
                  }`}>
                    {war.status.toUpperCase()}
                  </span>
                </div>

                {war.description && (
                  <p className="text-gray-400 mb-4">{war.description}</p>
                )}

                {/* Progress */}
                {war.targetAmount && (
                  <div className="mb-4">
                    <div className="flex justify-between mb-2">
                      <span className="text-2xl font-bold">
                        ${war.totalRaised.toLocaleString()}
                      </span>
                      <span className="text-gray-400">
                        of ${war.targetAmount.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-sm text-gray-400 mt-1">
                      <span>{war.participantCount} participants</span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                  </div>
                )}

                {/* Timer */}
                {war.status === 'active' && !selloutCountdown && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Time Remaining</label>
                    <CountdownTimer endTime={war.endsAt} />
                  </div>
                )}
              </div>
            </div>

            {/* Vote Display */}
            <VoteDisplay consensus={consensus} />

            {/* Contract Display (after launch) */}
            {war.status === 'launched' && (
              <ContractDisplay war={war} />
            )}

            {/* Participants */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Participants ({participants.length})</h2>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {participants.map((p, i) => (
                  <div key={p.wallet} className="flex justify-between items-center p-3 bg-gray-700 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400">#{i + 1}</span>
                      <span className="font-mono text-sm">
                        {p.wallet.slice(0, 6)}...{p.wallet.slice(-4)}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">${p.totalUsdc.toLocaleString()}</div>
                      <div className="text-sm text-gray-400">{p.sharePercent.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Buy Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-8">
              {war.status === 'active' && !isSoldOut ? (
                <BuyPanel war={war} onBuySuccess={handleBuySuccess} />
              ) : war.status === 'launched' ? (
                <ContractDisplay war={war} />
              ) : (
                <div className="bg-gray-800 rounded-xl p-6 text-center">
                  <p className="text-gray-400">
                    {isSoldOut ? 'This war is sold out!' : 'This war has ended'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
```

---

## 9. State Management

### Using React Query

The hooks already use TanStack Query for server state. For local state:

```typescript
// lib/stores/ui-store.ts (optional - using Zustand)

import { create } from 'zustand';

interface UIStore {
  // Sellout modal
  selloutModal: {
    isOpen: boolean;
    warId: string | null;
    countdownEndsAt: number | null;
  };
  openSelloutModal: (warId: string, countdownEndsAt: number) => void;
  closeSelloutModal: () => void;

  // Toast notifications
  toasts: Array<{
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>;
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selloutModal: {
    isOpen: false,
    warId: null,
    countdownEndsAt: null,
  },
  openSelloutModal: (warId, countdownEndsAt) =>
    set({ selloutModal: { isOpen: true, warId, countdownEndsAt } }),
  closeSelloutModal: () =>
    set({ selloutModal: { isOpen: false, warId: null, countdownEndsAt: null } }),

  toasts: [],
  addToast: (message, type) =>
    set((state) => ({
      toasts: [...state.toasts, { id: Date.now().toString(), message, type }],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
```

---

## 10. Real-Time Updates

### Polling Strategy

```typescript
// Recommended polling intervals

const POLLING_INTERVALS = {
  warList: 10000,      // 10 seconds
  warDetail: 5000,     // 5 seconds
  activeWar: 2000,     // 2 seconds (when close to ending)
  selloutCountdown: 1000, // 1 second (during 60s countdown)
};

// Dynamic polling based on war state
function getPollingInterval(war: TokenWar | null): number {
  if (!war) return POLLING_INTERVALS.warList;

  const timeRemaining = war.endsAt - Date.now();

  // During sellout countdown
  if (timeRemaining <= 60000 && timeRemaining > 0) {
    return POLLING_INTERVALS.selloutCountdown;
  }

  // Close to ending (within 5 minutes)
  if (timeRemaining <= 300000) {
    return POLLING_INTERVALS.activeWar;
  }

  return POLLING_INTERVALS.warDetail;
}
```

### WebSocket (Future Enhancement)

```typescript
// For future: WebSocket connection for real-time updates
// Currently using polling, but WebSocket would reduce load

interface WarEvent {
  type: 'buy' | 'sellout' | 'extended' | 'launched';
  warId: string;
  data: any;
}

// Future implementation
function useWarWebSocket(warId: string) {
  // TODO: Implement WebSocket connection
}
```

---

## 11. Error Handling

### Error Types

```typescript
// lib/errors.ts

export class TokenWarsError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'TokenWarsError';
  }
}

export const ERROR_CODES = {
  // Payment errors
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  INVALID_AMOUNT: 'invalid_amount',
  PAYMENT_FAILED: 'payment_failed',
  NONCE_USED: 'nonce_used',
  AUTHORIZATION_EXPIRED: 'authorization_expired',

  // War errors
  WAR_NOT_FOUND: 'war_not_found',
  WAR_ENDED: 'war_ended',
  WAR_SOLD_OUT: 'war_sold_out',
  WAR_NOT_ACTIVE: 'war_not_active',

  // Wallet errors
  WALLET_NOT_CONNECTED: 'wallet_not_connected',
  SIGNATURE_REJECTED: 'signature_rejected',

  // Network errors
  NETWORK_ERROR: 'network_error',
  API_ERROR: 'api_error',
};

export function parseError(error: any): { message: string; code: string; recoverable: boolean } {
  const message = error?.message || error?.error || 'An error occurred';

  // Map error messages to codes
  if (message.includes('insufficient') || message.includes('balance')) {
    return { message: 'Insufficient USDC balance', code: ERROR_CODES.INSUFFICIENT_BALANCE, recoverable: false };
  }

  if (message.includes('nonce already used')) {
    return { message: 'Transaction already processed. Please try again.', code: ERROR_CODES.NONCE_USED, recoverable: true };
  }

  if (message.includes('sold out')) {
    return { message: 'This Token War has sold out!', code: ERROR_CODES.WAR_SOLD_OUT, recoverable: false };
  }

  if (message.includes('ended')) {
    return { message: 'This Token War has ended', code: ERROR_CODES.WAR_ENDED, recoverable: false };
  }

  if (message.includes('User rejected') || message.includes('user rejected')) {
    return { message: 'Transaction cancelled', code: ERROR_CODES.SIGNATURE_REJECTED, recoverable: true };
  }

  return { message, code: ERROR_CODES.API_ERROR, recoverable: true };
}
```

### Error Boundary

```typescript
// components/ErrorBoundary.tsx

'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-red-400 mb-4">Something went wrong</h2>
            <p className="text-gray-400 mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-purple-500 rounded-lg"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

## 12. Styling Reference

### Color Palette

```css
/* Tailwind config colors */
colors: {
  gray: {
    900: '#111827',  /* Background */
    800: '#1f2937',  /* Card background */
    700: '#374151',  /* Input background */
    600: '#4b5563',  /* Border */
    400: '#9ca3af',  /* Muted text */
  },
  purple: {
    500: '#8b5cf6',  /* Primary */
    400: '#a78bfa',  /* Primary light */
  },
  pink: {
    500: '#ec4899',  /* Accent */
    400: '#f472b6',  /* Accent light */
  },
  green: {
    500: '#22c55e',  /* Success */
    400: '#4ade80',  /* Success light */
  },
  red: {
    500: '#ef4444',  /* Error */
    400: '#f87171',  /* Error light */
  },
  yellow: {
    500: '#eab308',  /* Warning */
    400: '#facc15',  /* Warning light */
  },
  blue: {
    500: '#3b82f6',  /* Info */
    400: '#60a5fa',  /* Info light */
  },
}
```

### Common Gradients

```css
/* Primary gradient */
.gradient-primary {
  @apply bg-gradient-to-r from-purple-500 to-pink-500;
}

/* Progress bar gradient */
.gradient-progress {
  @apply bg-gradient-to-r from-purple-500 to-pink-500;
}

/* DEX gradients */
.gradient-v4 {
  @apply bg-gradient-to-r from-blue-500 to-cyan-500;
}
.gradient-aerodrome {
  @apply bg-gradient-to-r from-purple-500 to-pink-500;
}
.gradient-hydrex {
  @apply bg-gradient-to-r from-orange-500 to-yellow-500;
}

/* Pair gradients */
.gradient-eth {
  @apply bg-gradient-to-r from-blue-500 to-indigo-500;
}
.gradient-wass {
  @apply bg-gradient-to-r from-green-500 to-emerald-500;
}
```

### Animation Classes

```css
/* Loading spinner */
.animate-spin {
  animation: spin 1s linear infinite;
}

/* Pulse for countdown */
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Fade in */
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## Quick Start Checklist

- [ ] Set up Next.js project with TypeScript
- [ ] Install dependencies: `wagmi`, `viem`, `@tanstack/react-query`, `connectkit`
- [ ] Configure Web3Provider with Base chain
- [ ] Create types from this guide
- [ ] Implement hooks: `useTokenWars`, `useTokenWar`, `useTokenWarsBuy`, `useCountdown`
- [ ] Build components: `WarCard`, `BuyPanel`, `VoteDisplay`, `CountdownTimer`, `ContractDisplay`
- [ ] Create pages: Home (war list), War detail
- [ ] Add error handling
- [ ] Test with real API

## Important Reminders

1. **ALWAYS use `/api/token-wars/buy/verified`** for buys (not `/buy`)
2. **Check `sellout.action`** after every buy for countdown
3. **`war.endsAt` changes** when sellout countdown starts
4. **Poll frequently** during active wars (2-5 seconds)
5. **Handle all error codes** gracefully
6. **Convert IPFS URLs** for display: `ipfs://` → `https://ipfs.io/ipfs/`
