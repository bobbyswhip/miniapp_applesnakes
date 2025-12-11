# Clankerdome Prediction Market Integration Guide

## Quick Start - What You Need to Know

The prediction market data is **already included** in the `/api/clankerdome/launch` response. The frontend just needs to display it.

### Current Launch Response Structure

```typescript
// GET /api/clankerdome/launch returns:
{
  "currentLaunches": [{
    "id": "launch-xxx",
    "name": "test",
    "symbol": "TEST",
    // ... other launch fields ...

    // THIS IS THE PREDICTION MARKET DATA:
    "predictionMarket": {
      "id": "market-1765392746080-czvwvr",  // Use this for betting
      "hasMarket": true,
      "type": "x402",
      "totalPool": 0,
      "totalBets": 0,
      "uniqueBettors": 0,
      "outcomes": [
        {
          "index": 0,
          "label": "0-25% Funded",
          "yesProbability": 50,
          "noProbability": 50,
          "yesOdds": 2,
          "noOdds": 2,
          "totalPool": 0
        },
        // ... 4 more outcomes (indices 1-4)
      ]
    }
  }]
}
```

---

## Step 1: Access Prediction Market Data

The data is already in your launch object. Access it like this:

```typescript
// In your Clankerdome component
const launch = currentLaunches[0]; // or whichever launch

// Check if prediction market exists
if (launch.predictionMarket?.hasMarket) {
  const marketId = launch.predictionMarket.id;
  const outcomes = launch.predictionMarket.outcomes;

  // Display the outcomes
  outcomes.forEach(outcome => {
    console.log(`${outcome.label}: YES ${outcome.yesProbability}% / NO ${outcome.noProbability}%`);
  });
}
```

---

## Step 2: Display Prediction Market UI

### Simple Outcome Display Component

```tsx
interface PredictionOutcome {
  index: number;
  label: string;
  yesProbability: number;
  noProbability: number;
  yesOdds: number;
  noOdds: number;
  totalPool: number;
}

interface PredictionMarketProps {
  marketId: string;
  outcomes: PredictionOutcome[];
  onBet: (outcomeIndex: number, side: 'yes' | 'no') => void;
}

function PredictionMarketDisplay({ marketId, outcomes, onBet }: PredictionMarketProps) {
  return (
    <div className="prediction-market">
      <h3>Predict the Outcome</h3>
      <p className="text-sm text-gray-400">Bet on whether this launch will reach each funding tier</p>

      <div className="space-y-2 mt-4">
        {outcomes.map((outcome) => (
          <div key={outcome.index} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
            {/* Outcome Label */}
            <div className="flex-1">
              <span className="font-medium">{outcome.label}</span>
              <div className="text-xs text-gray-400">
                Pool: ${outcome.totalPool.toFixed(2)}
              </div>
            </div>

            {/* YES Button */}
            <button
              onClick={() => onBet(outcome.index, 'yes')}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded mr-2"
            >
              YES {outcome.yesOdds.toFixed(1)}x
            </button>

            {/* NO Button */}
            <button
              onClick={() => onBet(outcome.index, 'no')}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded"
            >
              NO {outcome.noOdds.toFixed(1)}x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Step 3: Place a Bet (X402 Payment)

Betting requires X402 USDC payment. Here's the complete flow:

### Bet Hook

```typescript
import { useAccount, useSignTypedData } from 'wagmi';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098';

interface BetParams {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  amountUsdc: number;
}

function usePlaceBet() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBet = async ({ marketId, outcomeIndex, side, amountUsdc }: BetParams) => {
    if (!address) {
      setError('Connect wallet first');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Get payment requirements from 402 response
      const initialResponse = await fetch('/api/prediction-market/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, outcomeIndex, side }),
      });

      if (initialResponse.status !== 402) {
        throw new Error('Expected 402 payment required response');
      }

      // Step 2: Parse X402 requirements
      const acceptsHeader = initialResponse.headers.get('X-PAYMENT');
      if (!acceptsHeader) throw new Error('No payment header');

      const accepts = JSON.parse(acceptsHeader);
      const paymentInfo = accepts[0]; // First accepted payment method

      // Step 3: Create EIP-3009 authorization
      const atomicAmount = BigInt(Math.floor(amountUsdc * 1_000_000)); // USDC has 6 decimals
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const nonce = `0x${crypto.randomUUID().replace(/-/g, '')}`;

      // Step 4: Sign the authorization
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

      // Step 5: Build X402 payment payload
      // IMPORTANT: All values must be STRINGS for JSON serialization
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: AI_WALLET,
            value: atomicAmount.toString(), // STRING!
            validAfter: validAfter.toString(), // STRING!
            validBefore: validBefore.toString(), // STRING!
            nonce: nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));

      // Step 6: Retry with payment
      const betResponse = await fetch('/api/prediction-market/bet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({ marketId, outcomeIndex, side }),
      });

      if (!betResponse.ok) {
        const errorData = await betResponse.json();
        throw new Error(errorData.error || 'Bet failed');
      }

      return await betResponse.json();
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

---

## Step 4: Complete Integration Example

Here's how to integrate into your existing Clankerdome component:

```tsx
// In your Clankerdome.tsx or similar

import { useState } from 'react';
import { useAccount } from 'wagmi';

export function ClankerdomeWithPrediction({ launch }) {
  const { address } = useAccount();
  const { placeBet, isLoading, error } = usePlaceBet();
  const [selectedBet, setSelectedBet] = useState<{
    outcomeIndex: number;
    side: 'yes' | 'no';
  } | null>(null);
  const [betAmount, setBetAmount] = useState('1');

  const handleBetClick = (outcomeIndex: number, side: 'yes' | 'no') => {
    setSelectedBet({ outcomeIndex, side });
  };

  const handleConfirmBet = async () => {
    if (!selectedBet || !launch.predictionMarket?.id) return;

    const result = await placeBet({
      marketId: launch.predictionMarket.id,
      outcomeIndex: selectedBet.outcomeIndex,
      side: selectedBet.side,
      amountUsdc: parseFloat(betAmount),
    });

    if (result?.success) {
      // Bet placed successfully!
      setSelectedBet(null);
      // Refresh launch data to show updated odds
    }
  };

  // Check if prediction market exists
  if (!launch.predictionMarket?.hasMarket) {
    return <div>No prediction market for this launch</div>;
  }

  return (
    <div className="clankerdome-prediction">
      {/* Launch Info */}
      <div className="launch-header">
        <h2>{launch.name} ({launch.symbol})</h2>
        <p>Target: ${launch.targetAmount} | Raised: ${launch.totalRaised}</p>
      </div>

      {/* Prediction Market */}
      <div className="prediction-section mt-6">
        <h3 className="text-lg font-bold mb-4">
          Prediction Market
          <span className="ml-2 text-sm text-gray-400">
            {launch.predictionMarket.totalBets} bets | ${launch.predictionMarket.totalPool} pool
          </span>
        </h3>

        {/* Outcomes */}
        <div className="space-y-3">
          {launch.predictionMarket.outcomes.map((outcome) => (
            <div
              key={outcome.index}
              className="bg-gray-800 rounded-lg p-4"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{outcome.label}</div>
                  <div className="text-xs text-gray-400">
                    Pool: ${outcome.totalPool.toFixed(2)}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleBetClick(outcome.index, 'yes')}
                    disabled={isLoading}
                    className={`px-4 py-2 rounded font-medium transition-colors ${
                      selectedBet?.outcomeIndex === outcome.index && selectedBet?.side === 'yes'
                        ? 'bg-green-500 text-white'
                        : 'bg-green-900 hover:bg-green-700 text-green-300'
                    }`}
                  >
                    YES {outcome.yesOdds.toFixed(1)}x
                  </button>

                  <button
                    onClick={() => handleBetClick(outcome.index, 'no')}
                    disabled={isLoading}
                    className={`px-4 py-2 rounded font-medium transition-colors ${
                      selectedBet?.outcomeIndex === outcome.index && selectedBet?.side === 'no'
                        ? 'bg-red-500 text-white'
                        : 'bg-red-900 hover:bg-red-700 text-red-300'
                    }`}
                  >
                    NO {outcome.noOdds.toFixed(1)}x
                  </button>
                </div>
              </div>

              {/* Probability Bar */}
              <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
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

        {/* Bet Confirmation Modal */}
        {selectedBet && (
          <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
            <h4 className="font-medium mb-2">
              Place Bet: {selectedBet.side.toUpperCase()} on "{
                launch.predictionMarket.outcomes[selectedBet.outcomeIndex].label
              }"
            </h4>

            <div className="flex items-center gap-2 mb-4">
              <input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                min="1"
                step="1"
                className="w-24 px-3 py-2 bg-gray-800 rounded border border-gray-600"
              />
              <span className="text-gray-400">USDC</span>
            </div>

            {error && (
              <div className="text-red-400 text-sm mb-2">{error}</div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleConfirmBet}
                disabled={isLoading || !address}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium disabled:opacity-50"
              >
                {isLoading ? 'Placing Bet...' : `Bet $${betAmount} USDC`}
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
    </div>
  );
}
```

---

## API Reference Quick Guide

### Get Market Details
```typescript
// GET /api/prediction-market/{marketId}
const response = await fetch(`/api/prediction-market/${marketId}`);
const data = await response.json();
// Returns: { success: true, market: {...}, outcomes: [...], stats: {...} }
```

### Get Market Activity
```typescript
// GET /api/prediction-market/{marketId}/activity
const response = await fetch(`/api/prediction-market/${marketId}/activity`);
const data = await response.json();
// Returns: { recentBets: [...], topBettors: [...], volumeByOutcome: [...], momentum: {...} }
```

### Get User Positions
```typescript
// GET /api/prediction-market/user?wallet=0x...
const response = await fetch(`/api/prediction-market/user?wallet=${address}`);
const data = await response.json();
// Returns: { positions: [...], stats: {...} }
```

### Claim Winnings (After Market Resolves)
```typescript
// POST /api/prediction-market/claim
const response = await fetch('/api/prediction-market/claim', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ marketId, wallet: address }),
});
```

---

## Troubleshooting

### "No prediction market for this launch"
- The market may not have been created for older launches
- Check if `launch.predictionMarket.hasMarket` is `true`
- Markets are auto-created for NEW launches only

### X402 Payment Errors
- `invalid_exact_evm_payload_authorization_value` - Amount encoding issue, ensure all values are strings
- `Missing payment` - Initial request needs to return 402 first, then retry with signed payment

### Odds Not Updating
- Odds update after each bet
- Refresh the launch data to see new odds
- Pool-based pricing: `odds = totalPool / sidePool`

---

## Summary

1. **Data is already there** - `launch.predictionMarket` has everything you need
2. **Display outcomes** - Map over `outcomes` array, show YES/NO buttons with odds
3. **Place bets** - Use X402 payment flow (402 response → sign → retry)
4. **Show positions** - Use `/api/prediction-market/user?wallet=0x...`
