# Clankerdome Prediction Market Integration Guide

## Overview

Clankerdome launches now require X402 USDC payment to create. The payment is split:
- **50% seeds the prediction market** - provides initial liquidity for trading
- **50% goes to presale** - creator's initial contribution to their own launch

**Minimum to create a launch: $1 USDC**

---

## Part 1: Creating a Launch (X402 Payment Required)

### Launch Creation Flow

```
User clicks "Create Launch"
    ↓
Frontend sends initial POST (no payment)
    ↓
Backend returns 402 with payment requirements
    ↓
Frontend signs EIP-3009 authorization
    ↓
Frontend retries with X-PAYMENT header
    ↓
Backend creates launch + seeds prediction market
    ↓
Response includes launchId, marketId, payment split info
```

### Hook: useCreateLaunch

```typescript
import { useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

interface CreateLaunchParams {
  name: string;
  symbol: string;
  description?: string;
  image?: string;           // IPFS URL or base64
  targetAmount?: number;
  durationHours?: number;   // Default: 24
  amountUsdc: number;       // Minimum $1
}

interface CreateLaunchResult {
  success: boolean;
  launchId?: string;
  predictionMarket?: {
    id: string;
    seededAmount: number;
  };
  payment?: {
    total: number;
    pmSeed: number;
    presale: number;
  };
  error?: string;
}

export function useCreateLaunch() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createLaunch = async (params: CreateLaunchParams): Promise<CreateLaunchResult | null> => {
    if (!address) {
      setError('Connect wallet first');
      return null;
    }

    if (params.amountUsdc < 1) {
      setError('Minimum $1 USDC required to create a launch');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Create EIP-3009 authorization for X402 payment
      const atomicAmount = BigInt(Math.floor(params.amountUsdc * 1_000_000));
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const nonce = `0x${crypto.randomUUID().replace(/-/g, '')}`;

      // Step 2: Sign the authorization
      const signature = await signTypedDataAsync({
        domain: {
          name: 'USD Coin',
          version: '2',
          chainId: 8453, // Base mainnet
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
          to: AI_WALLET,
          value: atomicAmount,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce as `0x${string}`,
        },
      });

      // Step 3: Build X402 payment payload
      // CRITICAL: All numeric values MUST be strings for JSON
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: AI_WALLET,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce: nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));

      // Step 4: Send create request with payment
      const response = await fetch('/api/clankerdome/launch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({
          action: 'create',
          name: params.name,
          symbol: params.symbol,
          description: params.description,
          image: params.image,
          creatorWallet: address,
          targetAmount: params.targetAmount,
          durationHours: params.durationHours || 24,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create launch');
      }

      return {
        success: true,
        launchId: data.launchId,
        predictionMarket: data.predictionMarket,
        payment: data.payment,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  };

  return { createLaunch, isLoading, error };
}
```

### Component: CreateLaunchForm

```tsx
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useCreateLaunch } from './useCreateLaunch';

export function CreateLaunchForm() {
  const { address, isConnected } = useAccount();
  const { createLaunch, isLoading, error } = useCreateLaunch();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('1'); // Default $1

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = await createLaunch({
      name,
      symbol,
      description,
      amountUsdc: parseFloat(amount),
    });

    if (result?.success) {
      console.log('Launch created!', result);
      // Navigate to launch page or show success
    }
  };

  if (!isConnected) {
    return <div>Connect wallet to create a launch</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <h2 className="text-xl font-bold">Create Clankerdome Launch</h2>

      {/* Token Name */}
      <div>
        <label className="block text-sm font-medium mb-1">Token Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Token"
          required
          className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-600"
        />
      </div>

      {/* Token Symbol */}
      <div>
        <label className="block text-sm font-medium mb-1">Symbol</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="MYTKN"
          maxLength={10}
          required
          className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-600"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-1">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's your token about?"
          className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-600"
          rows={3}
        />
      </div>

      {/* Initial Amount */}
      <div>
        <label className="block text-sm font-medium mb-1">Initial Contribution (USDC)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="1"
          step="0.01"
          required
          className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-600"
        />
        <p className="text-xs text-gray-400 mt-1">
          Minimum $1. Split: 50% seeds prediction market, 50% your presale contribution.
        </p>
      </div>

      {/* Payment Breakdown */}
      {parseFloat(amount) >= 1 && (
        <div className="p-3 bg-gray-900 rounded border border-gray-700">
          <h4 className="text-sm font-medium mb-2">Payment Breakdown</h4>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-400">Prediction Market Seed:</span>
              <span className="text-green-400">${(parseFloat(amount) * 0.5).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Your Presale Balance:</span>
              <span className="text-blue-400">${(parseFloat(amount) * 0.5).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
              <span className="font-medium">Total:</span>
              <span className="font-medium">${parseFloat(amount).toFixed(2)} USDC</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || parseFloat(amount) < 1}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition-colors"
      >
        {isLoading ? 'Creating Launch...' : `Create Launch ($${amount} USDC)`}
      </button>
    </form>
  );
}
```

### Create Launch Response

```typescript
// POST /api/clankerdome/launch with X-PAYMENT header returns:
{
  "success": true,
  "message": "Clankerdome launch party created!",
  "launchId": "launch-1765500000000-abc123",
  "launch": {
    "id": "launch-1765500000000-abc123",
    "name": "My Token",
    "symbol": "MYTKN",
    "status": "active",
    "totalRaised": 0.50,          // 50% of payment went here
    "participantCount": 1,         // Creator is first participant
    "endsAt": 1765586400000,       // 24 hours from creation
    "predictionMarket": {
      "id": "market-1765500000000-xyz789",
      "hasMarket": true,
      "type": "x402",
      "totalPool": 0.50,           // 50% of payment seeded here
      "outcomes": [...]
    }
  },
  "predictionMarket": {
    "id": "market-1765500000000-xyz789",
    "type": "x402",
    "betEndpoint": "/api/prediction-market/bet",
    "seededAmount": 0.50
  },
  "payment": {
    "total": 1.00,
    "pmSeed": 0.50,                // Went to prediction market
    "presale": 0.50                // Went to presale as creator's buy
  }
}
```

---

## Part 2: Viewing Launches with Prediction Markets

### GET Launch Response Structure

```typescript
// GET /api/clankerdome/launch returns:
{
  "status": "ready",
  "stats": {
    "totalLaunches": 5,
    "activeLaunches": 2,
    "activePredictionMarkets": 2,
    "totalPredictionMarkets": 5,
    "totalPredictionVolume": 150.50,
    "totalPredictionBets": 42,
    "totalRaisedUsdc": 500,
    "totalParticipants": 25
  },
  "currentLaunches": [{
    "id": "launch-xxx",
    "name": "My Token",
    "symbol": "MYTKN",
    "status": "active",
    "totalRaised": 50.50,
    "participantCount": 10,
    "endsAt": 1765586400000,

    // PREDICTION MARKET DATA (already seeded!)
    "predictionMarket": {
      "id": "market-xxx",
      "hasMarket": true,
      "type": "x402",
      "totalPool": 25.50,          // Includes seed + all bets
      "totalBets": 15,
      "uniqueBettors": 8,
      "outcomes": [
        {
          "index": 0,
          "label": "0-25% Funded",
          "yesProbability": 45,
          "noProbability": 55,
          "yesOdds": 2.2,
          "noOdds": 1.8,
          "totalPool": 5.10        // Includes seed liquidity
        },
        {
          "index": 1,
          "label": "25-50% Funded",
          "yesProbability": 50,
          "noProbability": 50,
          "yesOdds": 2.0,
          "noOdds": 2.0,
          "totalPool": 5.10
        },
        {
          "index": 2,
          "label": "50-75% Funded",
          "yesProbability": 50,
          "noProbability": 50,
          "yesOdds": 2.0,
          "noOdds": 2.0,
          "totalPool": 5.10
        },
        {
          "index": 3,
          "label": "75-99% Funded",
          "yesProbability": 50,
          "noProbability": 50,
          "yesOdds": 2.0,
          "noOdds": 2.0,
          "totalPool": 5.10
        },
        {
          "index": 4,
          "label": "100% SELL OUT!",
          "yesProbability": 55,
          "noProbability": 45,
          "yesOdds": 1.8,
          "noOdds": 2.2,
          "totalPool": 5.10
        }
      ]
    }
  }]
}
```

---

## Part 3: Placing Bets (X402 Payment)

### Hook: usePlaceBet

```typescript
import { useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

interface BetParams {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  amountUsdc: number;  // Minimum $1
}

export function usePlaceBet() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBet = async ({ marketId, outcomeIndex, side, amountUsdc }: BetParams) => {
    if (!address) {
      setError('Connect wallet first');
      return null;
    }

    if (amountUsdc < 1) {
      setError('Minimum bet is $1 USDC');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Create EIP-3009 authorization
      const atomicAmount = BigInt(Math.floor(amountUsdc * 1_000_000));
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600;
      const nonce = `0x${crypto.randomUUID().replace(/-/g, '')}`;

      // Step 2: Sign the authorization
      const signature = await signTypedDataAsync({
        domain: {
          name: 'USD Coin',
          version: '2',
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
          to: AI_WALLET,
          value: atomicAmount,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce as `0x${string}`,
        },
      });

      // Step 3: Build payment payload (all values as STRINGS!)
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: AI_WALLET,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce: nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));

      // Step 4: Send bet request with payment
      const response = await fetch('/api/prediction-market/bet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({ marketId, outcomeIndex, side }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Bet failed');
      }

      return await response.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { placeBet, isLoading, error };
}
```

### Bet Response

```typescript
{
  "success": true,
  "message": "Successfully bet $5 YES on outcome 4",
  "bet": {
    "marketId": "market-xxx",
    "outcomeIndex": 4,
    "side": "yes",
    "amount": 5,
    "shares": 2.5,           // Based on current price
    "price": 0.5,            // Price at time of bet
    "txIdentifier": "x402-abc123...",
    "wallet": "0x..."
  },
  "position": {
    "shares": 2.5,
    "totalCost": 5,
    "averagePrice": 0.5
  },
  "market": {
    // Updated market summary with new odds
  }
}
```

---

## Part 4: Complete Integration Example

```tsx
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useCreateLaunch } from './useCreateLaunch';
import { usePlaceBet } from './usePlaceBet';

interface Launch {
  id: string;
  name: string;
  symbol: string;
  totalRaised: number;
  participantCount: number;
  endsAt: number;
  predictionMarket?: {
    id: string;
    hasMarket: boolean;
    totalPool: number;
    totalBets: number;
    outcomes: Array<{
      index: number;
      label: string;
      yesProbability: number;
      noProbability: number;
      yesOdds: number;
      noOdds: number;
      totalPool: number;
    }>;
  };
}

export function ClankerdomeApp() {
  const { address, isConnected } = useAccount();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null);
  const [view, setView] = useState<'list' | 'create' | 'details'>('list');

  // Fetch launches
  useEffect(() => {
    fetch('/api/clankerdome/launch')
      .then(res => res.json())
      .then(data => setLaunches(data.currentLaunches || []));
  }, []);

  return (
    <div className="container mx-auto p-4">
      {/* Navigation */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setView('list')}
          className={`px-4 py-2 rounded ${view === 'list' ? 'bg-blue-600' : 'bg-gray-700'}`}
        >
          Active Launches
        </button>
        <button
          onClick={() => setView('create')}
          className={`px-4 py-2 rounded ${view === 'create' ? 'bg-blue-600' : 'bg-gray-700'}`}
        >
          Create Launch
        </button>
      </div>

      {/* Create Launch View */}
      {view === 'create' && <CreateLaunchForm />}

      {/* Launch List View */}
      {view === 'list' && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {launches.map(launch => (
            <LaunchCard
              key={launch.id}
              launch={launch}
              onClick={() => {
                setSelectedLaunch(launch);
                setView('details');
              }}
            />
          ))}
        </div>
      )}

      {/* Launch Details View */}
      {view === 'details' && selectedLaunch && (
        <LaunchDetails
          launch={selectedLaunch}
          onBack={() => setView('list')}
        />
      )}
    </div>
  );
}

function LaunchCard({ launch, onClick }: { launch: Launch; onClick: () => void }) {
  const timeRemaining = Math.max(0, launch.endsAt - Date.now());
  const hoursLeft = Math.floor(timeRemaining / (1000 * 60 * 60));

  return (
    <div
      onClick={onClick}
      className="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 transition-colors"
    >
      <h3 className="text-lg font-bold">{launch.name}</h3>
      <p className="text-gray-400">${launch.symbol}</p>

      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Raised:</span>
          <span className="text-green-400">${launch.totalRaised.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Participants:</span>
          <span>{launch.participantCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Time Left:</span>
          <span>{hoursLeft}h</span>
        </div>
      </div>

      {/* Prediction Market Summary */}
      {launch.predictionMarket?.hasMarket && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Prediction Market</div>
          <div className="flex justify-between text-sm">
            <span>Pool: ${launch.predictionMarket.totalPool.toFixed(2)}</span>
            <span>{launch.predictionMarket.totalBets} bets</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LaunchDetails({ launch, onBack }: { launch: Launch; onBack: () => void }) {
  const { placeBet, isLoading, error } = usePlaceBet();
  const [selectedBet, setSelectedBet] = useState<{
    outcomeIndex: number;
    side: 'yes' | 'no';
  } | null>(null);
  const [betAmount, setBetAmount] = useState('1');

  const handlePlaceBet = async () => {
    if (!selectedBet || !launch.predictionMarket?.id) return;

    const result = await placeBet({
      marketId: launch.predictionMarket.id,
      outcomeIndex: selectedBet.outcomeIndex,
      side: selectedBet.side,
      amountUsdc: parseFloat(betAmount),
    });

    if (result?.success) {
      setSelectedBet(null);
      // Refresh launch data
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onBack} className="mb-4 text-gray-400 hover:text-white">
        ← Back to launches
      </button>

      {/* Launch Header */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold">{launch.name} ({launch.symbol})</h2>
        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-green-400">
              ${launch.totalRaised.toFixed(2)}
            </div>
            <div className="text-sm text-gray-400">Raised</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{launch.participantCount}</div>
            <div className="text-sm text-gray-400">Participants</div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {Math.floor((launch.endsAt - Date.now()) / (1000 * 60 * 60))}h
            </div>
            <div className="text-sm text-gray-400">Remaining</div>
          </div>
        </div>
      </div>

      {/* Prediction Market */}
      {launch.predictionMarket?.hasMarket && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">
            Prediction Market
            <span className="ml-2 text-sm font-normal text-gray-400">
              ${launch.predictionMarket.totalPool.toFixed(2)} total pool
            </span>
          </h3>

          {/* Outcomes */}
          <div className="space-y-3">
            {launch.predictionMarket.outcomes.map((outcome) => (
              <div key={outcome.index} className="bg-gray-900 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <div className="font-medium">{outcome.label}</div>
                    <div className="text-xs text-gray-400">
                      Pool: ${outcome.totalPool.toFixed(2)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedBet({ outcomeIndex: outcome.index, side: 'yes' })}
                      className={`px-4 py-2 rounded font-medium ${
                        selectedBet?.outcomeIndex === outcome.index && selectedBet?.side === 'yes'
                          ? 'bg-green-500'
                          : 'bg-green-900 hover:bg-green-700'
                      }`}
                    >
                      YES {outcome.yesOdds.toFixed(1)}x
                    </button>
                    <button
                      onClick={() => setSelectedBet({ outcomeIndex: outcome.index, side: 'no' })}
                      className={`px-4 py-2 rounded font-medium ${
                        selectedBet?.outcomeIndex === outcome.index && selectedBet?.side === 'no'
                          ? 'bg-red-500'
                          : 'bg-red-900 hover:bg-red-700'
                      }`}
                    >
                      NO {outcome.noOdds.toFixed(1)}x
                    </button>
                  </div>
                </div>

                {/* Probability Bar */}
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${outcome.yesProbability}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-green-400">YES {outcome.yesProbability}%</span>
                  <span className="text-red-400">NO {outcome.noProbability}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Bet Confirmation */}
          {selectedBet && (
            <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
              <h4 className="font-medium mb-3">
                Bet {selectedBet.side.toUpperCase()} on "
                {launch.predictionMarket.outcomes[selectedBet.outcomeIndex].label}"
              </h4>

              <div className="flex items-center gap-3 mb-4">
                <input
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  min="1"
                  className="w-24 px-3 py-2 bg-gray-800 rounded border border-gray-600"
                />
                <span className="text-gray-400">USDC</span>
                <span className="text-sm text-gray-400">
                  Potential win: $
                  {(
                    parseFloat(betAmount) *
                    (selectedBet.side === 'yes'
                      ? launch.predictionMarket.outcomes[selectedBet.outcomeIndex].yesOdds
                      : launch.predictionMarket.outcomes[selectedBet.outcomeIndex].noOdds)
                  ).toFixed(2)}
                </span>
              </div>

              {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

              <div className="flex gap-2">
                <button
                  onClick={handlePlaceBet}
                  disabled={isLoading || parseFloat(betAmount) < 1}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded font-medium"
                >
                  {isLoading ? 'Placing Bet...' : `Bet $${betAmount}`}
                </button>
                <button
                  onClick={() => setSelectedBet(null)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## API Reference

### Create Launch
```typescript
POST /api/clankerdome/launch
Headers: { "Content-Type": "application/json", "X-PAYMENT": "<base64>" }
Body: {
  action: "create",
  name: string,
  symbol: string,
  description?: string,
  image?: string,
  creatorWallet: string,
  targetAmount?: number,
  durationHours?: number
}
// Returns 402 without payment, success with payment
```

### Place Bet
```typescript
POST /api/prediction-market/bet
Headers: { "Content-Type": "application/json", "X-PAYMENT": "<base64>" }
Body: {
  marketId: string,
  outcomeIndex: number,  // 0-4 for sellout markets
  side: "yes" | "no"
}
// Payment amount determines bet size (min $1)
```

### Get Market Details
```typescript
GET /api/prediction-market/{marketId}
// Returns full market with outcomes, odds, stats
```

### Get Market Activity
```typescript
GET /api/prediction-market/{marketId}/activity
// Returns recent bets, top bettors, momentum
```

### Get User Positions
```typescript
GET /api/prediction-market/user?wallet=0x...
// Returns all positions across markets
```

### Claim Winnings
```typescript
POST /api/prediction-market/claim
Body: { marketId: string, wallet: string }
// After market resolves
```

---

## Key Points

1. **Creating launches requires X402 payment** (minimum $1 USDC)
2. **Payment is split 50/50**: prediction market seed + presale contribution
3. **Markets are pre-seeded with liquidity** - better trading from the start
4. **All X402 values must be strings** in the JSON payload
5. **CORS is enabled** for prediction market routes (X-PAYMENT header allowed)
6. **Minimum bet is $1 USDC**
7. **5 outcomes** for sellout markets: 0-25%, 25-50%, 50-75%, 75-99%, 100%

---

## Troubleshooting

### "Minimum $1 USDC required"
- Launch creation requires at least $1 payment
- Bets also require minimum $1

### "Failed to fetch"
- Check browser console for CORS errors
- Ensure X-PAYMENT header is included
- Verify the API endpoint is correct

### Payment Errors
- `invalid_exact_evm_payload_authorization_value` - Ensure all values in authorization are STRINGS
- User rejected signature - Check wallet popup
- Insufficient USDC balance - User needs USDC on Base

### "No prediction market"
- Older launches created before the update don't have seeded markets
- New launches automatically get seeded markets

### Odds Always 2.0x
- Fresh markets start at 50/50
- Odds change as bets are placed
- Seeded markets have initial liquidity but even odds
