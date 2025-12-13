# Consensus Presale Voting - Implementation Guide

Complete frontend implementation guide for the Clankerdome consensus presale voting system. Each presale buy is also a vote for which liquidity protocol (Uniswap or Aerodrome) will be used when the token launches.

## Table of Contents
1. [System Overview](#system-overview)
2. [API Reference](#api-reference)
3. [Frontend Implementation](#frontend-implementation)
4. [React Hooks](#react-hooks)
5. [UI Components](#ui-components)
6. [X402 Payment Integration](#x402-payment-integration)
7. [Atomic Deployment Strategy](#atomic-deployment-strategy)
8. [Best Practices](#best-practices)

---

## System Overview

### How Consensus Voting Works

1. **Each buy is a vote**: When a user buys into a presale, they also vote for either Uniswap or Aerodrome
2. **Weighted by USDC**: Every $1 USDC = 1 vote for the chosen protocol
3. **Starts at 50/50**: Before any votes, the consensus shows a tie
4. **Aerodrome wins ties**: If votes are equal when presale ends, Aerodrome is used
5. **Final consensus**: The protocol with most USDC votes when presale ends determines deployment

### Data Flow

```
User selects protocol → Buys with X402 payment → Vote recorded → Consensus updated → All users see live results
```

### Response Structure

Every launch response includes consensus data:

```typescript
interface LaunchConsensus {
  leadingProtocol: "uniswap" | "aerodrome";
  uniswap: {
    votes: number;    // Total USDC voting for Uniswap
    percent: number;  // 0-100
  };
  aerodrome: {
    votes: number;    // Total USDC voting for Aerodrome
    percent: number;  // 0-100
  };
  totalVotes: number; // Total USDC in presale
  isTie: boolean;     // True if 50/50 (Aerodrome wins ties)
}
```

---

## API Reference

### GET /api/clankerdome/launch

Returns all launches with consensus data.

**Response:**
```json
{
  "success": true,
  "launches": [
    {
      "id": "launch-xxx",
      "name": "My Token",
      "symbol": "MTK",
      "totalRaised": 150,
      "participantCount": 12,
      "consensus": {
        "leadingProtocol": "aerodrome",
        "uniswap": { "votes": 45, "percent": 30 },
        "aerodrome": { "votes": 105, "percent": 70 },
        "totalVotes": 150,
        "isTie": false
      },
      "predictionMarket": { ... }
    }
  ]
}
```

### GET /api/clankerdome/buy?launchId={id}

Get launch details including participants and their votes.

**Response:**
```json
{
  "success": true,
  "launch": {
    "id": "launch-xxx",
    "name": "My Token",
    "symbol": "MTK",
    "totalRaised": 150,
    "isActive": true
  },
  "consensus": {
    "leadingProtocol": "aerodrome",
    "uniswap": { "votes": 45, "percent": 30 },
    "aerodrome": { "votes": 105, "percent": 70 },
    "totalVotes": 150,
    "isTie": false
  },
  "participants": [
    {
      "wallet": "0x123...",
      "totalUsdc": 50,
      "sharePercent": 33.3,
      "buyCount": 2,
      "votes": {
        "uniswap": 20,
        "aerodrome": 30
      }
    }
  ],
  "payment": {
    "minAmount": "$1.00",
    "network": "base",
    "payTo": "0xE5e9033C57B4332283Cda19B39431CD716340098",
    "currency": "USDC"
  }
}
```

### POST /api/clankerdome/buy

Buy into a launch with protocol vote. **Requires X402 payment.**

**Request Body:**
```json
{
  "launchId": "launch-xxx",
  "protocolVote": "aerodrome"  // REQUIRED: "uniswap" or "aerodrome"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully joined the launch party! Voted for aerodrome.",
  "buy": {
    "launchId": "launch-xxx",
    "amount": 10,
    "txHash": "x402-...",
    "wallet": "0x123...",
    "timestamp": 1765457200000,
    "protocolVote": "aerodrome"
  },
  "launch": {
    "id": "launch-xxx",
    "name": "My Token",
    "symbol": "MTK",
    "totalRaised": 160,
    "participantCount": 13
  },
  "wallet": {
    "totalContribution": 10,
    "sharePercent": 6.25
  },
  "consensus": {
    "leadingProtocol": "aerodrome",
    "uniswap": { "votes": 45, "percent": 28.1 },
    "aerodrome": { "votes": 115, "percent": 71.9 },
    "totalVotes": 160,
    "isTie": false
  }
}
```

---

## Frontend Implementation

### TypeScript Interfaces

```typescript
// Protocol vote options
type ProtocolVote = "uniswap" | "aerodrome";

// Consensus data from API
interface ProtocolConsensus {
  leadingProtocol: ProtocolVote;
  uniswap: {
    votes: number;
    percent: number;
  };
  aerodrome: {
    votes: number;
    percent: number;
  };
  totalVotes: number;
  isTie: boolean;
  description?: string;
}

// Launch with consensus
interface ClankerdomeLaunch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  status: "active" | "launching" | "launched" | "failed" | "cancelled";
  isActive: boolean;
  totalRaised: number;
  participantCount: number;
  consensus: ProtocolConsensus | null;
  predictionMarket?: {
    id: string;
    hasMarket: boolean;
    // ... prediction market data
  };
}

// Buy request
interface BuyRequest {
  launchId: string;
  protocolVote: ProtocolVote;
}

// Buy response
interface BuyResponse {
  success: boolean;
  message?: string;
  error?: string;
  buy?: {
    launchId: string;
    amount: number;
    txHash: string;
    wallet: string;
    timestamp: number;
    protocolVote: ProtocolVote;
  };
  consensus?: ProtocolConsensus;
}

// X402 payment accepts (from 402 response body)
interface X402Accepts {
  payTo: string;
  asset: string;
  maxAmount: string;
  extra: {
    name: string;
    version: string;
  };
}
```

---

## React Hooks

### useLaunchConsensus

Fetch and auto-refresh consensus data for a launch.

```typescript
import { useState, useEffect, useCallback } from 'react';

interface UseLaunchConsensusResult {
  consensus: ProtocolConsensus | null;
  launch: ClankerdomeLaunch | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLaunchConsensus(
  launchId: string | null,
  refreshInterval = 5000
): UseLaunchConsensusResult {
  const [consensus, setConsensus] = useState<ProtocolConsensus | null>(null);
  const [launch, setLaunch] = useState<ClankerdomeLaunch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!launchId) return;

    try {
      const response = await fetch(`/api/clankerdome/buy?launchId=${launchId}`);
      const data = await response.json();

      if (data.success) {
        setConsensus(data.consensus);
        setLaunch(data.launch);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch consensus');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [launchId]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!launchId || refreshInterval <= 0) return;

    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [launchId, refreshInterval, fetchData]);

  return {
    consensus,
    launch,
    loading,
    error,
    refresh: fetchData,
  };
}
```

### useConsensusBuy

Handle buying with protocol vote (X402 payment).

```typescript
import { useState, useCallback } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';

interface UseConsensusBuyResult {
  buy: (launchId: string, protocolVote: ProtocolVote, amount: number) => Promise<BuyResponse>;
  loading: boolean;
  error: string | null;
}

// USDC contract address on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export function useConsensusBuy(): UseConsensusBuyResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const buy = useCallback(async (
    launchId: string,
    protocolVote: ProtocolVote,
    amount: number
  ): Promise<BuyResponse> => {
    if (!address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Initial request to get 402 payment requirements
      const initialResponse = await fetch('/api/clankerdome/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, protocolVote }),
      });

      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        return { success: false, error: data.error || 'Unexpected response' };
      }

      // Step 2: Parse 402 response body for payment requirements
      const paymentReq = await initialResponse.json();
      const accepts = paymentReq.accepts[0] as X402Accepts;
      const payTo = accepts.payTo as `0x${string}`;

      // Step 3: Sign EIP-3009 TransferWithAuthorization
      const atomicAmount = BigInt(Math.floor(amount * 1_000_000)); // USDC 6 decimals
      const validAfter = BigInt(0);
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = `0x${[...Array(32)].map(() =>
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
      ).join('')}` as `0x${string}`;

      const signature = await signTypedDataAsync({
        domain: {
          name: accepts.extra.name,
          version: accepts.extra.version,
          chainId: 8453,
          verifyingContract: USDC_ADDRESS,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address,
          to: payTo,
          value: atomicAmount,
          validAfter,
          validBefore,
          nonce,
        },
      });

      // Step 4: Build X402 payment payload (ALL values as strings)
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: payTo,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));

      // Step 5: Retry with X-PAYMENT header
      const buyResponse = await fetch('/api/clankerdome/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({ launchId, protocolVote }),
      });

      const data = await buyResponse.json();

      if (!buyResponse.ok) {
        setError(data.error || 'Buy failed');
        return { success: false, error: data.error };
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [address, signTypedDataAsync]);

  return { buy, loading, error };
}
```

---

## UI Components

### ConsensusBar

Visual representation of the protocol vote split.

```tsx
import React from 'react';

interface ConsensusBarProps {
  consensus: ProtocolConsensus | null;
  showLabels?: boolean;
  height?: number;
}

export function ConsensusBar({
  consensus,
  showLabels = true,
  height = 24
}: ConsensusBarProps) {
  const uniswapPercent = consensus?.uniswap.percent ?? 50;
  const aerodromePercent = consensus?.aerodrome.percent ?? 50;
  const isTie = consensus?.isTie ?? true;
  const leadingProtocol = consensus?.leadingProtocol ?? 'aerodrome';

  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex justify-between text-sm mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-pink-500">Uniswap</span>
            <span className="text-gray-400">${consensus?.uniswap.votes ?? 0}</span>
            <span className={`font-bold ${leadingProtocol === 'uniswap' ? 'text-pink-500' : 'text-gray-500'}`}>
              {uniswapPercent.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`font-bold ${leadingProtocol === 'aerodrome' ? 'text-blue-500' : 'text-gray-500'}`}>
              {aerodromePercent.toFixed(1)}%
            </span>
            <span className="text-gray-400">${consensus?.aerodrome.votes ?? 0}</span>
            <span className="font-semibold text-blue-500">Aerodrome</span>
          </div>
        </div>
      )}

      <div
        className="relative w-full rounded-full overflow-hidden bg-gray-700"
        style={{ height }}
      >
        {/* Uniswap side (pink) */}
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-pink-600 to-pink-500 transition-all duration-500"
          style={{ width: `${uniswapPercent}%` }}
        />

        {/* Aerodrome side (blue) */}
        <div
          className="absolute right-0 top-0 h-full bg-gradient-to-l from-blue-600 to-blue-500 transition-all duration-500"
          style={{ width: `${aerodromePercent}%` }}
        />

        {/* Center line for tie */}
        {isTie && (
          <div className="absolute left-1/2 top-0 w-0.5 h-full bg-white/50 transform -translate-x-1/2" />
        )}

        {/* Leading indicator */}
        {!isTie && (
          <div
            className={`absolute top-1/2 transform -translate-y-1/2 text-white text-xs font-bold px-2 ${
              leadingProtocol === 'uniswap' ? 'left-2' : 'right-2'
            }`}
          >
            LEADING
          </div>
        )}
      </div>

      {isTie && (
        <p className="text-center text-xs text-gray-400 mt-1">
          Tie! Aerodrome will be used as tiebreaker
        </p>
      )}
    </div>
  );
}
```

### ProtocolVoteSelector

Radio button selector for protocol vote.

```tsx
import React from 'react';

interface ProtocolVoteSelectorProps {
  value: ProtocolVote;
  onChange: (vote: ProtocolVote) => void;
  consensus?: ProtocolConsensus | null;
  disabled?: boolean;
}

export function ProtocolVoteSelector({
  value,
  onChange,
  consensus,
  disabled = false,
}: ProtocolVoteSelectorProps) {
  const options: Array<{
    value: ProtocolVote;
    label: string;
    color: string;
    bgColor: string;
    description: string;
  }> = [
    {
      value: 'uniswap',
      label: 'Uniswap',
      color: 'text-pink-500',
      bgColor: 'bg-pink-500/10 border-pink-500',
      description: 'Deploy on Uniswap V3',
    },
    {
      value: 'aerodrome',
      label: 'Aerodrome',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10 border-blue-500',
      description: 'Deploy on Aerodrome CL',
    },
  ];

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">
        Vote for Liquidity Protocol
      </label>
      <div className="grid grid-cols-2 gap-4">
        {options.map((option) => {
          const isSelected = value === option.value;
          const currentVotes = consensus?.[option.value]?.votes ?? 0;
          const currentPercent = consensus?.[option.value]?.percent ?? 50;

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`
                relative p-4 rounded-lg border-2 transition-all
                ${isSelected
                  ? option.bgColor
                  : 'border-gray-600 hover:border-gray-500'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {/* Selection indicator */}
              <div className={`
                absolute top-2 right-2 w-5 h-5 rounded-full border-2
                ${isSelected
                  ? `${option.bgColor} flex items-center justify-center`
                  : 'border-gray-500'
                }
              `}>
                {isSelected && (
                  <div className={`w-2.5 h-2.5 rounded-full ${option.color.replace('text-', 'bg-')}`} />
                )}
              </div>

              {/* Content */}
              <div className="text-left">
                <h4 className={`font-bold text-lg ${isSelected ? option.color : 'text-white'}`}>
                  {option.label}
                </h4>
                <p className="text-sm text-gray-400 mt-1">
                  {option.description}
                </p>

                {/* Current votes */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-gray-500">Current votes:</span>
                  <span className={isSelected ? option.color : 'text-gray-400'}>
                    ${currentVotes.toFixed(0)} ({currentPercent.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

### BuyWithVoteForm

Complete buy form with protocol selection.

```tsx
import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ConsensusBar } from './ConsensusBar';
import { ProtocolVoteSelector } from './ProtocolVoteSelector';
import { useLaunchConsensus, useConsensusBuy } from '../hooks';

interface BuyWithVoteFormProps {
  launchId: string;
  onSuccess?: (response: BuyResponse) => void;
}

export function BuyWithVoteForm({ launchId, onSuccess }: BuyWithVoteFormProps) {
  const [amount, setAmount] = useState<string>('');
  const [protocolVote, setProtocolVote] = useState<ProtocolVote>('aerodrome');

  const { address, isConnected } = useAccount();
  const { consensus, launch, loading: loadingConsensus } = useLaunchConsensus(launchId);
  const { buy, loading: buyLoading, error: buyError } = useConsensusBuy();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      return;
    }

    const response = await buy(launchId, protocolVote, numAmount);

    if (response.success) {
      setAmount('');
      onSuccess?.(response);
    }
  };

  const numAmount = parseFloat(amount) || 0;
  const isValidAmount = numAmount >= 1;

  return (
    <div className="bg-gray-800 rounded-xl p-6 space-y-6">
      {/* Launch Header */}
      {launch && (
        <div className="border-b border-gray-700 pb-4">
          <h2 className="text-xl font-bold text-white">{launch.symbol}</h2>
          <p className="text-gray-400">{launch.name}</p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-green-400">${launch.totalRaised} raised</span>
            <span className="text-gray-500">{launch.participantCount} participants</span>
          </div>
        </div>
      )}

      {/* Consensus Bar */}
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-3">Protocol Consensus</h3>
        <ConsensusBar consensus={consensus} />
      </div>

      {/* Buy Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount (USDC)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">$</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10.00"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-8 pr-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Minimum $1 USDC. Your contribution = your vote weight.
          </p>
        </div>

        {/* Protocol Vote Selector */}
        <ProtocolVoteSelector
          value={protocolVote}
          onChange={setProtocolVote}
          consensus={consensus}
          disabled={buyLoading}
        />

        {/* Preview */}
        {isValidAmount && (
          <div className="bg-gray-700/50 rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-medium text-gray-300">Transaction Preview</h4>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">You pay:</span>
              <span className="text-white">${numAmount.toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Your vote:</span>
              <span className={protocolVote === 'uniswap' ? 'text-pink-500' : 'text-blue-500'}>
                {protocolVote === 'uniswap' ? 'Uniswap' : 'Aerodrome'} +${numAmount.toFixed(0)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Your share:</span>
              <span className="text-white">
                {launch ? ((numAmount / (launch.totalRaised + numAmount)) * 100).toFixed(2) : '0'}%
              </span>
            </div>
          </div>
        )}

        {/* Error Message */}
        {buyError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-red-400 text-sm">{buyError}</p>
          </div>
        )}

        {/* Submit Button */}
        {isConnected ? (
          <button
            type="submit"
            disabled={buyLoading || !isValidAmount}
            className={`
              w-full py-4 rounded-lg font-bold text-lg transition-all
              ${isValidAmount && !buyLoading
                ? 'bg-gradient-to-r from-pink-500 to-blue-500 text-white hover:from-pink-600 hover:to-blue-600'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            {buyLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </span>
            ) : (
              `Buy & Vote ${protocolVote === 'uniswap' ? 'Uniswap' : 'Aerodrome'}`
            )}
          </button>
        ) : (
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button
                type="button"
                onClick={openConnectModal}
                className="w-full py-4 rounded-lg font-bold text-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </ConnectButton.Custom>
        )}
      </form>
    </div>
  );
}
```

---

## X402 Payment Integration

The buy endpoint uses X402 payment protocol. See the `useConsensusBuy` hook for full implementation.

### Key Points

1. **Two-step flow**: Initial request returns 402 → Parse `accepts[0]` → Sign → Retry with payment
2. **Payment info is in response BODY**, not headers
3. **All authorization values must be STRINGS** in the JSON payload
4. **Use `payTo` from 402 response**, don't hardcode wallet addresses

### Error Handling

```typescript
// Common X402 errors:
// - "protocolVote is required" → Missing vote in request body
// - "Minimum buy-in is $1 USDC" → Amount too low
// - "invalid_payload" → Skipped initial 402 request
// - "invalid_exact_evm_payload_authorization_value" → Value encoding issue
```

---

## Atomic Deployment Strategy

### Problem: Front-Running Risk

When deploying to Aerodrome:
1. Pool creation is a public transaction
2. MEV bots can detect and front-run the first buy
3. Goal: Guarantee platform gets first buy in same block

### Solution: Multicall Contract

Deploy a contract that atomically:
1. Creates the Aerodrome pool
2. Adds initial liquidity
3. Executes first swap (dev buy)

All in a single transaction - MEV bots can't insert between steps.

### Implementation Pattern

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@aerodrome/interfaces/ICLFactory.sol";
import "@aerodrome/interfaces/INonfungiblePositionManager.sol";
import "@aerodrome/interfaces/ISwapRouter.sol";

contract AtomicPoolDeployer {
    ICLFactory public immutable factory;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;

    constructor(
        address _factory,
        address _positionManager,
        address _swapRouter
    ) {
        factory = ICLFactory(_factory);
        positionManager = INonfungiblePositionManager(_positionManager);
        swapRouter = ISwapRouter(_swapRouter);
    }

    /**
     * @notice Atomically deploy pool, add liquidity, and execute first buy
     * @param token The new token address
     * @param weth WETH address
     * @param tickSpacing Pool tick spacing
     * @param sqrtPriceX96 Initial price
     * @param tokenAmount Tokens for liquidity
     * @param ethForBuy ETH for first buy
     */
    function deployAndBuy(
        address token,
        address weth,
        int24 tickSpacing,
        uint160 sqrtPriceX96,
        uint256 tokenAmount,
        uint256 ethForBuy,
        int24 tickLower,
        int24 tickUpper
    ) external payable returns (
        address pool,
        uint256 positionId,
        uint256 tokensReceived
    ) {
        require(msg.value >= ethForBuy, "Insufficient ETH");

        // Step 1: Create pool
        (address token0, address token1) = token < weth
            ? (token, weth)
            : (weth, token);

        pool = factory.createPool(token0, token1, tickSpacing, sqrtPriceX96);

        // Step 2: Add liquidity
        IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);
        IERC20(token).approve(address(positionManager), tokenAmount);

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            tickSpacing: tickSpacing,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: token0 == token ? tokenAmount : 0,
            amount1Desired: token1 == token ? tokenAmount : 0,
            amount0Min: 0,
            amount1Min: 0,
            recipient: msg.sender,
            deadline: block.timestamp,
            sqrtPriceX96: 0
        });

        (positionId,,,) = positionManager.mint(params);

        // Step 3: Execute first buy (ETH → Token)
        ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter.ExactInputSingleParams({
            tokenIn: weth,
            tokenOut: token,
            tickSpacing: tickSpacing,
            recipient: msg.sender,
            deadline: block.timestamp,
            amountIn: ethForBuy,
            amountOutMinimum: 0, // Accept any amount
            sqrtPriceLimitX96: 0
        });

        tokensReceived = swapRouter.exactInputSingle{value: ethForBuy}(swapParams);

        // Return excess ETH
        if (address(this).balance > 0) {
            payable(msg.sender).transfer(address(this).balance);
        }
    }

    receive() external payable {}
}
```

### Backend Integration

```typescript
// lib/atomic-deployer.ts

import { encodeFunctionData } from 'viem';

export async function deployPoolAtomically(
  tokenAddress: Address,
  liquidityTokens: bigint,
  devBuyEth: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
): Promise<{ poolAddress: Address; positionId: bigint; tokensReceived: bigint }> {
  const ATOMIC_DEPLOYER = '0x...'; // Deploy this contract once
  const WETH = '0x4200000000000000000000000000000000000006';
  const TICK_SPACING = 2000;

  // Approve tokens first
  await approveToken(tokenAddress, ATOMIC_DEPLOYER, liquidityTokens);

  // Call atomic deploy
  const txHash = await walletClient.writeContract({
    address: ATOMIC_DEPLOYER,
    abi: ATOMIC_DEPLOYER_ABI,
    functionName: 'deployAndBuy',
    args: [
      tokenAddress,
      WETH,
      TICK_SPACING,
      sqrtPriceX96,
      liquidityTokens,
      devBuyEth,
      tickLower,
      tickUpper,
    ],
    value: devBuyEth,
  });

  // Parse logs for results
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  // ... parse pool address, position ID, tokens received from logs

  return { poolAddress, positionId, tokensReceived };
}
```

### Deployment Flow with Consensus

```
1. Presale ends
2. Determine winning protocol from consensus
3. If Aerodrome wins:
   - Use AtomicPoolDeployer.deployAndBuy()
   - Single tx: create pool → add liquidity → first buy
4. If Uniswap wins:
   - Similar atomic pattern for Uniswap V3
5. Distribute tokens to presale participants
```

---

## Best Practices

### 1. Real-Time Updates
- Poll consensus every 5 seconds during active presale
- Update UI immediately after successful buy
- Show loading states during transactions

### 2. Error Handling
- Validate vote selection before submission
- Handle X402 errors gracefully
- Show clear error messages to users

### 3. UX Considerations
- Default to Aerodrome (tiebreaker)
- Show both current votes AND percentages
- Indicate which protocol is winning
- Explain that vote weight = USDC amount

### 4. Mobile Responsiveness
- Stack protocol options vertically on mobile
- Make consensus bar touch-friendly
- Ensure buttons are large enough to tap

### 5. Accessibility
- Use proper ARIA labels
- Ensure color contrast for pink/blue
- Support keyboard navigation

---

## Contract Addresses (Base Mainnet)

```typescript
// Tokens
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';

// Aerodrome CL
const AERODROME_CL_FACTORY = '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A';
const AERODROME_POSITION_MANAGER = '0x827922686190790b37229fd06084350E74485b72';
const AERODROME_SWAP_ROUTER = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5';

// Payment receiver
const AI_WALLET = '0xE5e9033C57B4332283Cda19B39431CD716340098';
```

---

## Troubleshooting

### "protocolVote is required"
The request body must include `protocolVote` field with value `"uniswap"` or `"aerodrome"`.

### Consensus shows 50/50 but totalVotes > 0
This shouldn't happen. Check that existing buys have valid `protocol_vote` in database.

### Votes not updating after buy
- Verify the buy response includes updated consensus
- Check that `useLaunchConsensus` is polling
- Confirm database was updated (check server logs)

### X402 payment failures
See X402 error handling section above. Common issues:
- Missing initial 402 request
- Hardcoded wallet instead of using `payTo` from response
- BigInt values not converted to strings
