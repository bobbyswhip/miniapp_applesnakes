# Token Wars Prediction Markets - Frontend Display Guide

## The Problem

Each Token War has **3 prediction markets**, but the frontend was only showing 1. This guide explains how to properly fetch and display all 3 markets.

---

## API Endpoint

### Fetch All Markets for a War

```http
GET /api/prediction-market?relatedId={warId}
```

**Example:**
```
GET /api/prediction-market?relatedId=war-1765897691513-jg2vdf
```

**Response:**
```json
{
  "success": true,
  "relatedId": "war-1765897691513-jg2vdf",
  "count": 3,
  "markets": [
    {
      "market": {
        "id": "market-1765897694032-ztzgdn",
        "title": "TEST DEX Vote",
        "marketType": "dex_vote",
        "marketStyle": "winner_takes_all",
        "relatedId": "war-1765897691513-jg2vdf",
        ...
      },
      "outcomes": [...],
      "stats": {...}
    },
    {
      "market": {
        "id": "market-1765897694033-25c8zk",
        "title": "TEST Pair Vote",
        "marketType": "pair_vote",
        "marketStyle": "winner_takes_all",
        ...
      },
      "outcomes": [...],
      "stats": {...}
    },
    {
      "market": {
        "id": "market-1765897694034-4gb8bg",
        "title": "TEST Sellout",
        "marketType": "token_war_sellout",
        "marketStyle": "binary",
        ...
      },
      "outcomes": [...],
      "stats": {...}
    }
  ]
}
```

---

## The 3 Market Types

| Market Type | Style | Description | Bet Options |
|-------------|-------|-------------|-------------|
| `dex_vote` | winner_takes_all | Which DEX will token launch on? | YES only (pick winner) |
| `pair_vote` | winner_takes_all | Will token pair with ETH or wASS? | YES only (pick winner) |
| `token_war_sellout` | binary | Will token reach funding target? | YES or NO |

---

## React Implementation

### Hook: useTokenWarMarkets

```typescript
import { useState, useEffect, useCallback } from 'react';

interface MarketSummary {
  market: {
    id: string;
    title: string;
    description: string;
    marketType: 'dex_vote' | 'pair_vote' | 'token_war_sellout';
    marketStyle: 'winner_takes_all' | 'binary';
    relatedId: string;
    status: string;
    createdAt: number;
    endsAt: number;
    totalPool: number;
    metadata: string;
  };
  outcomes: Array<{
    outcomeIndex: number;
    label: string;
    yesPool: number;
    noPool: number;
    yesShares: number;
    noShares: number;
    yesOdds: number;
    noOdds: number;
    yesProbability: number;
    noProbability: number;
    totalPool: number;
  }>;
  stats: {
    totalPool: number;
    totalBets: number;
    uniqueBettors: number;
    timeRemaining: number;
    isActive: boolean;
  };
}

interface TokenWarMarkets {
  dexVote: MarketSummary | null;
  pairVote: MarketSummary | null;
  sellout: MarketSummary | null;
  all: MarketSummary[];
}

interface UseTokenWarMarketsReturn {
  markets: TokenWarMarkets;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTokenWarMarkets(warId: string | null): UseTokenWarMarketsReturn {
  const [markets, setMarkets] = useState<TokenWarMarkets>({
    dexVote: null,
    pairVote: null,
    sellout: null,
    all: []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    if (!warId) return;

    setLoading(true);
    setError(null);

    try {
      // IMPORTANT: Use relatedId param to get ALL markets for this war
      const response = await fetch(`/api/prediction-market?relatedId=${warId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch markets');
      }

      // data.markets is an array of all markets for this war
      const allMarkets: MarketSummary[] = data.markets || [];

      // Organize by market type
      const organized: TokenWarMarkets = {
        dexVote: allMarkets.find(m => m.market.marketType === 'dex_vote') || null,
        pairVote: allMarkets.find(m => m.market.marketType === 'pair_vote') || null,
        sellout: allMarkets.find(m => m.market.marketType === 'token_war_sellout') || null,
        all: allMarkets
      };

      setMarkets(organized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [warId]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  return { markets, loading, error, refetch: fetchMarkets };
}
```

---

### Component: TokenWarPredictionMarkets

```tsx
import React from 'react';
import { useTokenWarMarkets } from './useTokenWarMarkets';

interface TokenWarPredictionMarketsProps {
  warId: string;
  warName: string;
  warSymbol: string;
}

export function TokenWarPredictionMarkets({
  warId,
  warName,
  warSymbol
}: TokenWarPredictionMarketsProps) {
  const { markets, loading, error, refetch } = useTokenWarMarkets(warId);

  if (loading) {
    return <div className="loading">Loading prediction markets...</div>;
  }

  if (error) {
    return (
      <div className="error">
        <p>Failed to load markets: {error}</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  }

  // Check if we have all 3 markets
  const hasAllMarkets = markets.dexVote && markets.pairVote && markets.sellout;

  return (
    <div className="prediction-markets">
      <h2>Prediction Markets for {warName} (${warSymbol})</h2>

      {!hasAllMarkets && (
        <div className="warning">
          Some markets may not be available yet.
        </div>
      )}

      <div className="markets-grid">
        {/* DEX Vote Market */}
        {markets.dexVote && (
          <DexVoteMarket
            market={markets.dexVote}
            warId={warId}
          />
        )}

        {/* Pair Vote Market */}
        {markets.pairVote && (
          <PairVoteMarket
            market={markets.pairVote}
            warId={warId}
          />
        )}

        {/* Sellout Market */}
        {markets.sellout && (
          <SelloutMarket
            market={markets.sellout}
            warId={warId}
          />
        )}
      </div>

      {/* Debug info */}
      <details className="debug-info">
        <summary>Debug: {markets.all.length} markets loaded</summary>
        <pre>{JSON.stringify(markets.all.map(m => ({
          id: m.market.id,
          type: m.market.marketType,
          title: m.market.title
        })), null, 2)}</pre>
      </details>
    </div>
  );
}
```

---

### Component: DexVoteMarket (Winner Takes All)

```tsx
interface DexVoteMarketProps {
  market: MarketSummary;
  warId: string;
}

function DexVoteMarket({ market, warId }: DexVoteMarketProps) {
  const handleBet = async (outcomeIndex: number) => {
    // Winner-takes-all markets only allow YES bets
    // Navigate to bet modal or trigger bet flow
    console.log('Betting YES on outcome', outcomeIndex, 'in market', market.market.id);
  };

  return (
    <div className="market-card dex-vote">
      <div className="market-header">
        <h3>DEX Vote</h3>
        <span className="market-type">Winner Takes All</span>
      </div>

      <p className="market-description">
        Which DEX will this token launch on?
      </p>

      <div className="outcomes">
        {market.outcomes.map((outcome) => (
          <div key={outcome.outcomeIndex} className="outcome-row">
            <div className="outcome-info">
              <span className="outcome-label">{outcome.label}</span>
              <span className="outcome-pool">${outcome.totalPool.toFixed(2)}</span>
            </div>

            <div className="outcome-odds">
              <span className="probability">{outcome.yesProbability.toFixed(0)}%</span>
              <span className="multiplier">{outcome.yesOdds.toFixed(2)}x</span>
            </div>

            <button
              className="bet-button"
              onClick={() => handleBet(outcome.outcomeIndex)}
            >
              Bet on {outcome.label}
            </button>
          </div>
        ))}
      </div>

      <div className="market-footer">
        <span>Total Pool: ${market.stats.totalPool.toFixed(2)}</span>
        <span>Ends: {formatTimeRemaining(market.stats.timeRemaining)}</span>
      </div>
    </div>
  );
}
```

---

### Component: PairVoteMarket (Winner Takes All + wASS Bonus)

```tsx
interface PairVoteMarketProps {
  market: MarketSummary;
  warId: string;
}

function PairVoteMarket({ market, warId }: PairVoteMarketProps) {
  const handleBet = async (outcomeIndex: number, outcomeLabel: string) => {
    const isWassBonus = outcomeLabel.toLowerCase() === 'wass';
    console.log('Betting YES on', outcomeLabel, isWassBonus ? '(1.5x points!)' : '');
  };

  return (
    <div className="market-card pair-vote">
      <div className="market-header">
        <h3>Pair Vote</h3>
        <span className="market-type">Winner Takes All</span>
      </div>

      <p className="market-description">
        Will this token pair with ETH or wASS?
      </p>

      <div className="outcomes">
        {market.outcomes.map((outcome) => {
          const isWass = outcome.label.toLowerCase() === 'wass';

          return (
            <div
              key={outcome.outcomeIndex}
              className={`outcome-row ${isWass ? 'wass-bonus' : ''}`}
            >
              <div className="outcome-info">
                <span className="outcome-label">
                  {outcome.label}
                  {isWass && <span className="bonus-badge">1.5x Points!</span>}
                </span>
                <span className="outcome-pool">${outcome.totalPool.toFixed(2)}</span>
              </div>

              <div className="outcome-odds">
                <span className="probability">{outcome.yesProbability.toFixed(0)}%</span>
                <span className="multiplier">{outcome.yesOdds.toFixed(2)}x</span>
              </div>

              <button
                className={`bet-button ${isWass ? 'wass' : ''}`}
                onClick={() => handleBet(outcome.outcomeIndex, outcome.label)}
              >
                Bet {outcome.label}
              </button>
            </div>
          );
        })}
      </div>

      <div className="market-footer">
        <span>Total Pool: ${market.stats.totalPool.toFixed(2)}</span>
        <span>Ends: {formatTimeRemaining(market.stats.timeRemaining)}</span>
      </div>
    </div>
  );
}
```

---

### Component: SelloutMarket (Binary Yes/No)

```tsx
interface SelloutMarketProps {
  market: MarketSummary;
  warId: string;
}

function SelloutMarket({ market, warId }: SelloutMarketProps) {
  // Parse target amount from metadata
  const metadata = JSON.parse(market.market.metadata || '{}');
  const targetAmount = metadata.targetAmount || 0;

  const handleBet = async (outcomeIndex: number, side: 'yes' | 'no') => {
    console.log('Betting', side.toUpperCase(), 'on outcome', outcomeIndex);
  };

  // For binary markets, we typically show the first outcome (Yes - Sellout)
  // with both YES and NO buttons
  const yesOutcome = market.outcomes.find(o => o.label.includes('Yes'));
  const noOutcome = market.outcomes.find(o => o.label.includes('No'));

  return (
    <div className="market-card sellout">
      <div className="market-header">
        <h3>Sellout Prediction</h3>
        <span className="market-type">Binary</span>
      </div>

      <p className="market-description">
        Will this token reach the <strong>${targetAmount}</strong> funding target?
      </p>

      <div className="binary-betting">
        {/* YES side */}
        <div className="binary-side yes-side">
          <div className="side-header">
            <span className="side-label">YES - Will Sellout</span>
          </div>
          <div className="side-stats">
            <div className="stat">
              <span className="stat-label">Pool</span>
              <span className="stat-value">${(yesOutcome?.yesPool || 0).toFixed(2)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Probability</span>
              <span className="stat-value">{(yesOutcome?.yesProbability || 50).toFixed(0)}%</span>
            </div>
            <div className="stat">
              <span className="stat-label">Payout</span>
              <span className="stat-value">{(yesOutcome?.yesOdds || 2).toFixed(2)}x</span>
            </div>
          </div>
          <button
            className="bet-button yes"
            onClick={() => handleBet(0, 'yes')}
          >
            Bet YES
          </button>
        </div>

        {/* NO side */}
        <div className="binary-side no-side">
          <div className="side-header">
            <span className="side-label">NO - Won't Sellout</span>
          </div>
          <div className="side-stats">
            <div className="stat">
              <span className="stat-label">Pool</span>
              <span className="stat-value">${(yesOutcome?.noPool || 0).toFixed(2)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Probability</span>
              <span className="stat-value">{(yesOutcome?.noProbability || 50).toFixed(0)}%</span>
            </div>
            <div className="stat">
              <span className="stat-label">Payout</span>
              <span className="stat-value">{(yesOutcome?.noOdds || 2).toFixed(2)}x</span>
            </div>
          </div>
          <button
            className="bet-button no"
            onClick={() => handleBet(0, 'no')}
          >
            Bet NO
          </button>
        </div>
      </div>

      <div className="market-footer">
        <span>Total Pool: ${market.stats.totalPool.toFixed(2)}</span>
        <span>Ends: {formatTimeRemaining(market.stats.timeRemaining)}</span>
      </div>
    </div>
  );
}
```

---

## Utility Functions

```typescript
function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Ended';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
```

---

## CSS Styles

```css
.prediction-markets {
  padding: 20px;
}

.markets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.market-card {
  background: #1a1a2e;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #333;
}

.market-card.dex-vote {
  border-color: #6366f1;
}

.market-card.pair-vote {
  border-color: #10b981;
}

.market-card.sellout {
  border-color: #f59e0b;
}

.market-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.market-header h3 {
  margin: 0;
  font-size: 1.2rem;
}

.market-type {
  font-size: 0.75rem;
  padding: 4px 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
}

.market-description {
  color: #888;
  margin-bottom: 15px;
}

.outcome-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: rgba(255,255,255,0.05);
  border-radius: 8px;
  margin-bottom: 8px;
}

.outcome-row.wass-bonus {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.outcome-info {
  display: flex;
  flex-direction: column;
}

.outcome-label {
  font-weight: 600;
}

.bonus-badge {
  margin-left: 8px;
  font-size: 0.7rem;
  padding: 2px 6px;
  background: #10b981;
  color: white;
  border-radius: 4px;
}

.outcome-pool {
  font-size: 0.85rem;
  color: #888;
}

.outcome-odds {
  text-align: center;
}

.probability {
  display: block;
  font-size: 1.1rem;
  font-weight: bold;
}

.multiplier {
  font-size: 0.85rem;
  color: #888;
}

.bet-button {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.bet-button:hover {
  transform: scale(1.05);
}

.bet-button.yes {
  background: #10b981;
  color: white;
}

.bet-button.no {
  background: #ef4444;
  color: white;
}

.bet-button.wass {
  background: linear-gradient(135deg, #10b981, #059669);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
}

/* Binary market styles */
.binary-betting {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.binary-side {
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.binary-side.yes-side {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.binary-side.no-side {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.side-header {
  margin-bottom: 10px;
}

.side-label {
  font-weight: 600;
}

.side-stats {
  display: flex;
  justify-content: space-around;
  margin-bottom: 15px;
}

.stat {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.75rem;
  color: #888;
}

.stat-value {
  font-weight: 600;
}

.market-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #333;
  font-size: 0.85rem;
  color: #888;
}

.debug-info {
  margin-top: 20px;
  font-size: 0.8rem;
  color: #666;
}

.debug-info pre {
  background: #111;
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
}
```

---

## Placing Bets

### Bet Request Format

```typescript
// POST /api/prediction-market/bet
// Requires X-PAYMENT header with x402 payment

interface BetRequest {
  marketId: string;      // e.g., "market-1765897694032-ztzgdn"
  outcomeIndex: number;  // 0, 1, or 2 depending on outcome
  side: 'yes' | 'no';    // 'yes' only for winner_takes_all markets
  warId: string;         // Required for Token Wars markets!
}
```

### Bet Function

```typescript
async function placeBet(params: {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  warId: string;
  amount: number;  // USDC amount
}): Promise<BetResult> {
  // 1. Create X402 payment for the bet amount
  const paymentHeader = await createX402Payment({
    amount: params.amount,
    currency: 'USDC',
    recipient: '0xE5e9108B4467158C498e8c6B6e39aE12F8b0A098', // AI_WALLET
    network: 'base'
  });

  // 2. Send bet request with payment
  const response = await fetch('/api/prediction-market/bet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader
    },
    body: JSON.stringify({
      marketId: params.marketId,
      outcomeIndex: params.outcomeIndex,
      side: params.side,
      warId: params.warId  // IMPORTANT: Include warId!
    })
  });

  return response.json();
}
```

---

## Important Notes

### 1. Always Include warId for Token Wars Markets

```typescript
// WRONG - will fail with "warId is required for Token Wars prediction markets"
await placeBet({
  marketId: market.market.id,
  outcomeIndex: 0,
  side: 'yes'
});

// CORRECT
await placeBet({
  marketId: market.market.id,
  outcomeIndex: 0,
  side: 'yes',
  warId: market.market.relatedId  // Include the warId!
});
```

### 2. Winner-Takes-All Markets Only Allow YES

```typescript
// For dex_vote and pair_vote markets:
if (market.market.marketStyle === 'winner_takes_all') {
  // Only show YES button, hide NO button
  // side must always be 'yes'
}
```

### 3. Binary Markets Allow YES and NO

```typescript
// For token_war_sellout markets:
if (market.market.marketStyle === 'binary') {
  // Show both YES and NO buttons
  // User can bet either side
}
```

### 4. wASS Bonus Points

```typescript
// In pair_vote market, betting YES on wASS gives 1.5x points
const isWassBonus =
  market.market.marketType === 'pair_vote' &&
  outcome.label.toLowerCase() === 'wass' &&
  side === 'yes';

if (isWassBonus) {
  // Show "1.5x Points!" badge
}
```

---

## Quick Reference

| Market Type | API Filter | Style | Bet Options | Special |
|-------------|-----------|-------|-------------|---------|
| DEX Vote | `dex_vote` | winner_takes_all | YES only | 3 DEX options |
| Pair Vote | `pair_vote` | winner_takes_all | YES only | wASS = 1.5x points |
| Sellout | `token_war_sellout` | binary | YES or NO | Target amount in metadata |

### API Quick Reference

```
# Get all 3 markets for a war
GET /api/prediction-market?relatedId={warId}

# Get specific market type only
GET /api/prediction-market?relatedId={warId}&type=dex_vote

# Place bet (requires X402 payment)
POST /api/prediction-market/bet
Body: { marketId, outcomeIndex, side, warId }
```
