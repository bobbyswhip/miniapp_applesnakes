# Hydrex Frontend Integration Guide

## Problem

The Token Wars buy section currently only shows Uniswap V4 and Aerodrome as DEX voting options. Hydrex needs to be added as the third option.

## Backend Status

The backend **already fully supports Hydrex**:
- `DexVote` type includes: `"v4" | "aerodrome" | "hydrex"`
- Database tracks `hydrex_votes_usdc` column
- API accepts `dexVote: "hydrex"` in buy requests
- Vote consensus calculations include Hydrex
- Launcher mapping exists for Hydrex

## Frontend Changes Required

### 1. Update DEX Options Array

Find the DEX voting options in your frontend and add Hydrex:

```tsx
// BEFORE - Missing Hydrex
const DEX_OPTIONS = [
  { value: 'v4', label: 'Uniswap V4', icon: '/icons/uniswap.svg' },
  { value: 'aerodrome', label: 'Aerodrome', icon: '/icons/aerodrome.svg' },
];

// AFTER - With Hydrex
const DEX_OPTIONS = [
  { value: 'v4', label: 'Uniswap V4', icon: '/icons/uniswap.svg' },
  { value: 'aerodrome', label: 'Aerodrome', icon: '/icons/aerodrome.svg' },
  { value: 'hydrex', label: 'Hydrex', icon: '/icons/hydrex.svg' },
];
```

### 2. Update TypeScript Types

```typescript
// types/token-wars.ts

// DEX vote options - ensure Hydrex is included
export type DexVote = 'v4' | 'aerodrome' | 'hydrex';

// Pair vote options
export type PairVote = 'eth' | 'wass';

// Vote consensus from API
export interface VoteConsensus {
  // DEX votes
  winningDex: DexVote;
  v4Votes: number;
  aerodromeVotes: number;
  hydrexVotes: number;  // Make sure this is included
  v4Percent: number;
  aerodromePercent: number;
  hydrexPercent: number;  // Make sure this is included
  isDexTie: boolean;

  // Pair votes
  winningPair: PairVote;
  ethVotes: number;
  wassVotes: number;
  ethPercent: number;
  wassPercent: number;
  isPairTie: boolean;

  totalVotes: number;
}
```

### 3. Update DEX Vote Selector Component

```tsx
// components/DexVoteSelector.tsx

import { useState } from 'react';

interface DexVoteSelectorProps {
  value: string;
  onChange: (value: string) => void;
  consensus?: {
    v4Votes: number;
    aerodromeVotes: number;
    hydrexVotes: number;
    v4Percent: number;
    aerodromePercent: number;
    hydrexPercent: number;
    winningDex: string;
  };
}

const DEX_OPTIONS = [
  {
    value: 'v4',
    label: 'Uniswap V4',
    description: 'Latest Uniswap with hooks',
    icon: '🦄',
    color: 'pink',
  },
  {
    value: 'aerodrome',
    label: 'Aerodrome',
    description: 'Base-native liquidity hub',
    icon: '✈️',
    color: 'blue',
  },
  {
    value: 'hydrex',
    label: 'Hydrex',
    description: 'High-performance DEX',
    icon: '💧',
    color: 'cyan',
  },
];

export function DexVoteSelector({ value, onChange, consensus }: DexVoteSelectorProps) {
  return (
    <div className="dex-vote-selector">
      <h3>Vote for DEX</h3>
      <p className="description">Choose where this token should launch</p>

      <div className="options-grid">
        {DEX_OPTIONS.map((option) => {
          const votes = consensus?.[`${option.value}Votes` as keyof typeof consensus] as number || 0;
          const percent = consensus?.[`${option.value}Percent` as keyof typeof consensus] as number || 0;
          const isWinning = consensus?.winningDex === option.value;

          return (
            <button
              key={option.value}
              type="button"
              className={`option ${value === option.value ? 'selected' : ''} ${isWinning ? 'winning' : ''}`}
              onClick={() => onChange(option.value)}
            >
              <span className="icon">{option.icon}</span>
              <span className="label">{option.label}</span>
              <span className="description">{option.description}</span>

              {consensus && (
                <div className="vote-info">
                  <span className="votes">${votes} voted</span>
                  <div className="progress-bar">
                    <div
                      className="progress"
                      style={{ width: `${percent}%`, backgroundColor: `var(--${option.color})` }}
                    />
                  </div>
                  <span className="percent">{percent.toFixed(1)}%</span>
                </div>
              )}

              {isWinning && <span className="winning-badge">Leading</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

### 4. Update Buy Form

```tsx
// components/TokenWarBuyForm.tsx

import { useState } from 'react';
import { DexVoteSelector } from './DexVoteSelector';
import { PairVoteSelector } from './PairVoteSelector';

interface BuyFormProps {
  warId: string;
  consensus?: VoteConsensus;
  onBuy: (params: BuyParams) => Promise<void>;
}

interface BuyParams {
  warId: string;
  dexVote: string;
  pairVote: string;
  amountUsdc: number;
}

export function TokenWarBuyForm({ warId, consensus, onBuy }: BuyFormProps) {
  // Default to aerodrome if no selection (matches tiebreaker)
  const [dexVote, setDexVote] = useState<string>('aerodrome');
  const [pairVote, setPairVote] = useState<string>('eth');
  const [amount, setAmount] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await onBuy({
        warId,
        dexVote,
        pairVote,
        amountUsdc: amount,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="buy-form">
      {/* Amount selector */}
      <div className="amount-section">
        <label>Buy Amount (USDC)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
        />
        <p className="hint">Minimum $1, whole dollars only. Each $1 = 1 vote</p>
      </div>

      {/* DEX Vote - NOW WITH HYDREX */}
      <DexVoteSelector
        value={dexVote}
        onChange={setDexVote}
        consensus={consensus}
      />

      {/* Pair Vote */}
      <PairVoteSelector
        value={pairVote}
        onChange={setPairVote}
        consensus={consensus}
      />

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Processing...' : `Buy $${amount} & Vote`}
      </button>
    </form>
  );
}
```

### 5. Update Vote Display Component

```tsx
// components/VoteResults.tsx

interface VoteResultsProps {
  consensus: VoteConsensus;
}

export function VoteResults({ consensus }: VoteResultsProps) {
  const dexResults = [
    { name: 'Uniswap V4', votes: consensus.v4Votes, percent: consensus.v4Percent, key: 'v4' },
    { name: 'Aerodrome', votes: consensus.aerodromeVotes, percent: consensus.aerodromePercent, key: 'aerodrome' },
    { name: 'Hydrex', votes: consensus.hydrexVotes, percent: consensus.hydrexPercent, key: 'hydrex' },
  ].sort((a, b) => b.votes - a.votes);

  const pairResults = [
    { name: 'ETH', votes: consensus.ethVotes, percent: consensus.ethPercent, key: 'eth' },
    { name: 'wASS', votes: consensus.wassVotes, percent: consensus.wassPercent, key: 'wass' },
  ].sort((a, b) => b.votes - a.votes);

  return (
    <div className="vote-results">
      <section className="dex-results">
        <h4>DEX Vote Results</h4>
        {consensus.isDexTie && (
          <div className="tie-warning">
            ⚠️ TIE DETECTED - War will extend if not broken
          </div>
        )}
        {dexResults.map((result, idx) => (
          <div
            key={result.key}
            className={`result-row ${result.key === consensus.winningDex ? 'winning' : ''}`}
          >
            <span className="rank">{idx + 1}</span>
            <span className="name">{result.name}</span>
            <div className="bar-container">
              <div className="bar" style={{ width: `${result.percent}%` }} />
            </div>
            <span className="votes">${result.votes}</span>
            <span className="percent">{result.percent.toFixed(1)}%</span>
            {result.key === consensus.winningDex && <span className="badge">Leading</span>}
          </div>
        ))}
      </section>

      <section className="pair-results">
        <h4>Pair Vote Results</h4>
        {consensus.isPairTie && (
          <div className="tie-warning">
            ⚠️ TIE DETECTED - War will extend if not broken
          </div>
        )}
        {pairResults.map((result, idx) => (
          <div
            key={result.key}
            className={`result-row ${result.key === consensus.winningPair ? 'winning' : ''}`}
          >
            <span className="rank">{idx + 1}</span>
            <span className="name">{result.name}</span>
            <div className="bar-container">
              <div className="bar" style={{ width: `${result.percent}%` }} />
            </div>
            <span className="votes">${result.votes}</span>
            <span className="percent">{result.percent.toFixed(1)}%</span>
            {result.key === consensus.winningPair && <span className="badge">Leading</span>}
          </div>
        ))}
      </section>
    </div>
  );
}
```

### 6. Update API Request

```typescript
// api/token-wars.ts

export async function buyIntoWar(params: {
  warId: string;
  dexVote: 'v4' | 'aerodrome' | 'hydrex';  // Hydrex is valid!
  pairVote: 'eth' | 'wass';
  paymentHeader: string;
}): Promise<BuyResponse> {
  const response = await fetch('/api/token-wars/buy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': params.paymentHeader,
    },
    body: JSON.stringify({
      warId: params.warId,
      dexVote: params.dexVote,
      pairVote: params.pairVote,
    }),
  });

  return response.json();
}
```

## Tie Extension Display

The backend now supports tie extensions. Update your frontend to show tie status:

```tsx
// components/WarStatus.tsx

interface WarStatusProps {
  war: TokenWar;
  consensus: VoteConsensus;
}

export function WarStatus({ war, consensus }: WarStatusProps) {
  const hasTie = consensus.isDexTie || consensus.isPairTie;

  return (
    <div className="war-status">
      {/* Time remaining */}
      <div className="time-remaining">
        <span className="label">Time Remaining:</span>
        <span className="value">{formatTimeRemaining(war.endsAt - Date.now())}</span>
      </div>

      {/* Tie warning */}
      {hasTie && (
        <div className="tie-alert">
          <h4>⚠️ Tie Detected!</h4>
          <p>
            {consensus.isDexTie && 'DEX vote is tied. '}
            {consensus.isPairTie && 'Pair vote is tied. '}
            If the tie persists when the timer ends:
          </p>
          <ul>
            <li>Timer extends by 3 hours</li>
            <li>Target increases by 10%</li>
            <li>Voting continues until tie is broken</li>
          </ul>
          <p className="extensions">
            Extensions used: {war.tieExtensions || 0} / 5
          </p>
        </div>
      )}

      {/* Target progress */}
      {war.targetAmount && (
        <div className="progress-section">
          <div className="progress-header">
            <span>${war.totalRaised} / ${war.targetAmount}</span>
            <span>{((war.totalRaised / war.targetAmount) * 100).toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress"
              style={{ width: `${Math.min(100, (war.totalRaised / war.targetAmount) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

## CSS Styles

```css
/* styles/token-wars.css */

.dex-vote-selector .options-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr); /* 3 columns for 3 DEX options */
  gap: 1rem;
}

.dex-vote-selector .option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  border: 2px solid #333;
  border-radius: 12px;
  background: #1a1a1a;
  cursor: pointer;
  transition: all 0.2s;
}

.dex-vote-selector .option:hover {
  border-color: #666;
  background: #222;
}

.dex-vote-selector .option.selected {
  border-color: #00ff88;
  background: #0a2a1a;
}

.dex-vote-selector .option.winning {
  position: relative;
}

.dex-vote-selector .option.winning::after {
  content: '👑';
  position: absolute;
  top: -10px;
  right: -10px;
  font-size: 1.5rem;
}

.dex-vote-selector .icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.dex-vote-selector .label {
  font-weight: bold;
  font-size: 1.1rem;
}

.dex-vote-selector .description {
  font-size: 0.85rem;
  color: #888;
  text-align: center;
}

.dex-vote-selector .vote-info {
  margin-top: 1rem;
  width: 100%;
}

.dex-vote-selector .progress-bar {
  height: 4px;
  background: #333;
  border-radius: 2px;
  margin: 0.25rem 0;
}

.dex-vote-selector .progress {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}

/* Tie alert styles */
.tie-alert {
  background: linear-gradient(135deg, #ff6b3520, #ff9f0020);
  border: 1px solid #ff6b35;
  border-radius: 12px;
  padding: 1rem;
  margin: 1rem 0;
}

.tie-alert h4 {
  color: #ff6b35;
  margin: 0 0 0.5rem 0;
}

.tie-alert ul {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.tie-alert .extensions {
  font-size: 0.9rem;
  color: #888;
  margin-top: 0.5rem;
}

/* Responsive */
@media (max-width: 768px) {
  .dex-vote-selector .options-grid {
    grid-template-columns: 1fr;
  }
}
```

## API Response Reference

### GET /api/token-wars

```json
{
  "success": true,
  "wars": [{
    "id": "war-123",
    "name": "Test Token",
    "symbol": "TEST",
    "dexVotes": {
      "v4": 100,
      "aerodrome": 150,
      "hydrex": 75,
      "leading": "aerodrome",
      "v4Percent": 30.77,
      "aerodromePercent": 46.15,
      "hydrexPercent": 23.08
    },
    "pairVotes": {
      "eth": 200,
      "wass": 125,
      "leading": "eth",
      "ethPercent": 61.54,
      "wassPercent": 38.46
    },
    "tieExtensions": 0
  }]
}
```

### POST /api/token-wars/buy

Request:
```json
{
  "warId": "war-123",
  "dexVote": "hydrex",
  "pairVote": "eth"
}
```

Response:
```json
{
  "success": true,
  "buy": {
    "warId": "war-123",
    "amount": 10,
    "dexVote": "hydrex",
    "pairVote": "eth"
  },
  "consensus": {
    "dex": {
      "leading": "aerodrome",
      "v4": { "votes": 100, "percent": 29.41 },
      "aerodrome": { "votes": 150, "percent": 44.12 },
      "hydrex": { "votes": 85, "percent": 25.00 }
    }
  }
}
```

## Checklist

- [ ] Add Hydrex to DEX options array
- [ ] Update TypeScript types to include `hydrex`
- [ ] Update DEX vote selector component (3 options instead of 2)
- [ ] Update vote results display to show Hydrex
- [ ] Add tie extension warning UI
- [ ] Update CSS for 3-column grid
- [ ] Test buy with `dexVote: "hydrex"`
- [ ] Verify Hydrex votes appear in results
