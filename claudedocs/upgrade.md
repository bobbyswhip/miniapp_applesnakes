# Token Wars Prediction Market V2 - Frontend Implementation Guide

## Overview

The TokenWarsPredictionMarketV2 contract introduces a **unified claim system** that automatically handles both resolved and closed (cancelled) markets. This eliminates the previous issue where using `claimWinnings()` on a closed market would fail.

## Contract Details

| Property | Value |
|----------|-------|
| **Contract Address** | `0xcAd8BAa9e8885de5bfeAC6a043BA085e040Df17c` |
| **Network** | Base Mainnet (Chain ID: 8453) |
| **Version** | V2.0.0 |
| **Verified** | [Sourcify](https://repo.sourcify.dev/contracts/full_match/8453/0xcAd8BAa9e8885de5bfeAC6a043BA085e040Df17c/) |

### Previous V1 Contract (Deprecated)
- Address: `0xCC71e190c8209C29421345C95F43591391413204`
- Do not use for new integrations

## Key V2 Improvements

1. **Unified `claim()` function** - Works for both resolved and closed markets
2. **`getUserClaimStatus()`** - Tells frontend exactly what user can claim and why
3. **`getClaimableRefund()`** - View function for closed market refunds
4. **Better error messages** - Custom errors for easier debugging
5. **Additional helper functions** - `isMarketClosed()`, `isMarketClaimable()`

---

## Market Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                       MARKET STATES                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  None (0)     Market doesn't exist                               │
│      ↓                                                            │
│  Active (1)   Trading open - users can buy/sell shares           │
│      ↓                                                            │
│  ┌─────────────────┬─────────────────────────────────────┐       │
│  │                 │                                     │       │
│  ▼                 ▼                                     │       │
│  Resolved (2)      Closed (3)                            │       │
│  War completed     War cancelled                         │       │
│  Winner declared   No winner                             │       │
│      ↓                 ↓                                 │       │
│  claim() →         claim() →                             │       │
│  Winnings (1% fee) Refund (0% fee)                      │       │
│                                                          │       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Frontend Integration

### Contract ABI (Essential Functions)

```typescript
const PREDICTION_MARKET_V2_ABI = [
  // ===== TRADING =====
  "function buyShares(uint256 marketId, uint8 outcomeIndex, uint256 wassAmount) returns (uint256 sharesReceived)",
  "function buySharesWithETH(uint256 marketId, uint8 outcomeIndex, uint256 minWassOut) payable returns (uint256 sharesReceived)",
  "function sellShares(uint256 marketId, uint8 outcomeIndex, uint256 sharesToSell) returns (uint256 wassReceived)",

  // ===== V2 UNIFIED CLAIM =====
  "function claim(uint256 marketId) returns (uint256 amount, uint256 fee)",

  // ===== LEGACY CLAIMS (still work) =====
  "function claimWinnings(uint256 marketId) returns (uint256 payout)",
  "function claimRefund(uint256 marketId) returns (uint256 refund)",

  // ===== V2 VIEW FUNCTIONS =====
  "function getUserClaimStatus(uint256 marketId, address user) view returns (bool canClaim, bool isResolved, bool isClosed, uint256 claimableAmount, uint256 feeAmount, uint8 winningOutcome)",
  "function getClaimableRefund(uint256 marketId, address user) view returns (uint256)",
  "function getClaimableAmount(uint256 marketId, address user) view returns (uint256)",
  "function isMarketResolved(uint256 marketId) view returns (bool)",
  "function isMarketClosed(uint256 marketId) view returns (bool)",
  "function isMarketClaimable(uint256 marketId) view returns (bool)",

  // ===== MARKET INFO =====
  "function getMarket(uint256 marketId) view returns (bytes32 warId, uint8 marketType, uint8 status, uint256 createdAt, uint256 resolvedAt, uint256 totalDeposits, uint8 numOutcomes, uint8 winningOutcome, address creator)",
  "function getMarketInfo(uint256 marketId) view returns (bytes32 warId, uint8 marketTypeNum, uint8 statusNum, uint256 totalDeposits, uint8 numOutcomes, uint8 winningOutcome, uint256[] outcomeTotalShares, uint256[] outcomeTotalDeposits, uint256[] outcomePrices)",
  "function getUserMarketInfo(uint256 marketId, address user) view returns (uint256[] shares, uint256[] depositedAmounts, bool[] claimed, uint256[] potentialPayouts, uint256 claimableAmount)",
  "function getUserAllPositions(uint256 marketId, address user) view returns (uint256[] shares, uint256[] depositedAmounts, bool[] claimedStatus)",
  "function getAllOutcomePrices(uint256 marketId) view returns (uint256[] prices)",
  "function estimateSharesOut(uint256 marketId, uint8 outcomeIndex, uint256 wassAmount) view returns (uint256 sharesOut, uint256 fee)",
  "function estimateTokensOut(uint256 marketId, uint8 outcomeIndex, uint256 sharesToSell) view returns (uint256 wassOut, uint256 fee)",
];

const PREDICTION_MARKET_V2_ADDRESS = "0xcAd8BAa9e8885de5bfeAC6a043BA085e040Df17c";
```

### TypeScript Types

```typescript
// Market status enum
enum MarketStatus {
  None = 0,      // Market doesn't exist
  Active = 1,    // Trading open
  Resolved = 2,  // Winner declared
  Closed = 3,    // Cancelled, refunds available
}

// Market type enum
enum MarketType {
  DexVote = 0,   // 3 options: Uniswap, Aerodrome, Clankerdome
  PairVote = 1,  // 2 options: ETH pair, wASS pair
  Sellout = 2,   // 2 options: Yes, No
}

// Claim status from getUserClaimStatus()
interface ClaimStatus {
  canClaim: boolean;       // Whether user can claim anything
  isResolved: boolean;     // Market was resolved (winnings available)
  isClosed: boolean;       // Market was closed (refund available)
  claimableAmount: bigint; // Amount user can claim (after fees)
  feeAmount: bigint;       // Fee that will be charged (0 for refunds)
  winningOutcome: number;  // Winning outcome (0 if closed)
}

// Outcome names by market type
const OUTCOME_NAMES = {
  [MarketType.DexVote]: {
    1: "Uniswap V4",
    2: "Aerodrome",
    3: "Clankerdome",
  },
  [MarketType.PairVote]: {
    1: "ETH Pair",
    2: "wASS Pair",
  },
  [MarketType.Sellout]: {
    1: "Yes (Sells Out)",
    2: "No (Doesn't Sell Out)",
  },
};
```

---

## Implementation Examples

### 1. Check User's Claim Status (Recommended Approach)

```typescript
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0xcAd8BAa9e8885de5bfeAC6a043BA085e040Df17c";

async function getClaimStatus(marketId: number, userAddress: string) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICTION_MARKET_V2_ABI, provider);

  const status = await contract.getUserClaimStatus(marketId, userAddress);

  return {
    canClaim: status[0],
    isResolved: status[1],
    isClosed: status[2],
    claimableAmount: status[3],
    feeAmount: status[4],
    winningOutcome: status[5],
  };
}

// Usage in React component
function ClaimButton({ marketId, userAddress }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    getClaimStatus(marketId, userAddress).then(setStatus);
  }, [marketId, userAddress]);

  if (!status?.canClaim) {
    return <button disabled>Nothing to Claim</button>;
  }

  const claimType = status.isResolved ? "Winnings" : "Refund";
  const amount = ethers.utils.formatEther(status.claimableAmount);
  const fee = ethers.utils.formatEther(status.feeAmount);

  return (
    <button onClick={() => claim(marketId)}>
      Claim {claimType}: {amount} wASS
      {status.feeAmount > 0 && ` (${fee} wASS fee)`}
    </button>
  );
}
```

### 2. Execute Claim (Unified Function)

```typescript
async function claim(marketId: number) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICTION_MARKET_V2_ABI, signer);

  try {
    // V2 unified claim - works for both resolved and closed markets
    const tx = await contract.claim(marketId);
    const receipt = await tx.wait();

    // Parse the Claimed event
    const claimedEvent = receipt.events?.find(e => e.event === "Claimed");
    if (claimedEvent) {
      const { amount, fee, wasRefund } = claimedEvent.args;
      console.log(`Claimed ${ethers.utils.formatEther(amount)} wASS`);
      console.log(`Fee: ${ethers.utils.formatEther(fee)} wASS`);
      console.log(`Type: ${wasRefund ? "Refund" : "Winnings"}`);
    }

    return receipt;
  } catch (error) {
    // Handle specific errors
    if (error.message.includes("NothingToClaim")) {
      alert("You have nothing to claim from this market");
    } else if (error.message.includes("AlreadyClaimed")) {
      alert("You have already claimed from this market");
    } else if (error.message.includes("MarketNotClaimable")) {
      alert("This market is not yet claimable (still active)");
    } else {
      throw error;
    }
  }
}
```

### 3. Display Market Status

```typescript
async function getMarketDisplay(marketId: number) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICTION_MARKET_V2_ABI, provider);

  const info = await contract.getMarketInfo(marketId);

  const statusNames = ["None", "Active", "Resolved", "Closed"];
  const marketTypeNames = ["DEX Vote", "Pair Vote", "Sellout"];

  return {
    warId: info.warId,
    marketType: marketTypeNames[info.marketTypeNum],
    status: statusNames[info.statusNum],
    totalDeposits: ethers.utils.formatEther(info.totalDeposits),
    numOutcomes: info.numOutcomes,
    winningOutcome: info.winningOutcome,
    outcomes: info.outcomeTotalShares.map((shares, i) => ({
      index: i + 1,
      shares: ethers.utils.formatEther(shares),
      deposits: ethers.utils.formatEther(info.outcomeTotalDeposits[i]),
      probability: (Number(info.outcomePrices[i]) / 100).toFixed(1) + "%",
    })),
  };
}
```

### 4. Buy Shares

```typescript
async function buyShares(
  marketId: number,
  outcomeIndex: number,
  wassAmount: string
) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICTION_MARKET_V2_ABI, signer);

  const amount = ethers.utils.parseEther(wassAmount);

  // First approve wASS spending
  const wassContract = new ethers.Contract(
    "0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6", // wASS token
    ["function approve(address spender, uint256 amount) returns (bool)"],
    signer
  );

  const approveTx = await wassContract.approve(CONTRACT_ADDRESS, amount);
  await approveTx.wait();

  // Then buy shares
  const tx = await contract.buyShares(marketId, outcomeIndex, amount);
  const receipt = await tx.wait();

  // Parse SharesPurchased event
  const event = receipt.events?.find(e => e.event === "SharesPurchased");
  if (event) {
    console.log(`Bought ${ethers.utils.formatEther(event.args.sharesReceived)} shares`);
  }

  return receipt;
}
```

### 5. Buy Shares with ETH

```typescript
async function buySharesWithETH(
  marketId: number,
  outcomeIndex: number,
  ethAmount: string,
  slippageBps: number = 100 // 1% default slippage
) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICTION_MARKET_V2_ABI, signer);

  const ethValue = ethers.utils.parseEther(ethAmount);

  // Get quote for minimum wASS out
  const quote = await contract.quoteETHForWASS(ethValue);
  const expectedWass = quote.swapPortion.add(quote.otcPortion);
  const minWassOut = expectedWass.mul(10000 - slippageBps).div(10000);

  // Buy with ETH
  const tx = await contract.buySharesWithETH(marketId, outcomeIndex, minWassOut, {
    value: ethValue,
  });

  return tx.wait();
}
```

---

## UI Component Patterns

### Market Card Component

```tsx
function MarketCard({ marketId, userAddress }) {
  const [market, setMarket] = useState(null);
  const [claimStatus, setClaimStatus] = useState(null);

  useEffect(() => {
    Promise.all([
      getMarketDisplay(marketId),
      getClaimStatus(marketId, userAddress),
    ]).then(([marketData, claimData]) => {
      setMarket(marketData);
      setClaimStatus(claimData);
    });
  }, [marketId, userAddress]);

  if (!market) return <div>Loading...</div>;

  return (
    <div className="market-card">
      <h3>{market.marketType}</h3>
      <StatusBadge status={market.status} />

      <div className="outcomes">
        {market.outcomes.map(outcome => (
          <OutcomeRow
            key={outcome.index}
            outcome={outcome}
            isWinner={market.winningOutcome === outcome.index}
            marketType={market.marketType}
          />
        ))}
      </div>

      <div className="total-pool">
        Total Pool: {market.totalDeposits} wASS
      </div>

      {/* Show claim button based on status */}
      {claimStatus?.canClaim && (
        <ClaimSection
          status={claimStatus}
          marketId={marketId}
          onClaim={() => claim(marketId)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    Active: "green",
    Resolved: "blue",
    Closed: "orange",
  };

  return (
    <span style={{ backgroundColor: colors[status] }}>
      {status}
    </span>
  );
}

function ClaimSection({ status, marketId, onClaim }) {
  const type = status.isResolved ? "Winnings" : "Refund";
  const amount = ethers.utils.formatEther(status.claimableAmount);

  return (
    <div className="claim-section">
      <p>
        {type} Available: <strong>{amount} wASS</strong>
        {status.feeAmount > 0 && (
          <span className="fee">
            ({ethers.utils.formatEther(status.feeAmount)} wASS fee)
          </span>
        )}
      </p>
      <button onClick={onClaim}>
        Claim {type}
      </button>
    </div>
  );
}
```

---

## API Endpoints (Backend)

The backend `prediction-market-manager.ts` has been updated with V2 support:

```typescript
import { predictionMarketManager, PREDICTION_MARKET_V2_ADDRESS } from "@/lib/prediction-market-manager";

// Get claim status for a user
const status = await predictionMarketManager.getClaimStatus(marketId, userAddress);

// Claim from a single market (unified - works for resolved or closed)
const result = await predictionMarketManager.claimFromMarket(marketId);

// Claim from all markets for a war
const results = await predictionMarketManager.claimAllForWar(war);

// Get market info
const info = await predictionMarketManager.getMarketInfo(marketId);
```

---

## Events

### V2 Unified Claim Event

```solidity
event Claimed(
    uint256 indexed marketId,
    address indexed user,
    uint256 amount,      // Amount claimed (after fee)
    uint256 fee,         // Fee charged (0 for refunds)
    bool wasRefund       // true if refund, false if winnings
);
```

### Other Events

```solidity
event MarketCreated(uint256 indexed marketId, bytes32 indexed warId, MarketType marketType, uint8 numOutcomes, address creator);
event SharesPurchased(uint256 indexed marketId, address indexed buyer, uint8 outcomeIndex, uint256 wassAmount, uint256 sharesReceived, uint256 fee);
event SharesSold(uint256 indexed marketId, address indexed seller, uint8 outcomeIndex, uint256 sharesSold, uint256 wassReceived, uint256 fee);
event MarketResolved(uint256 indexed marketId, bytes32 indexed warId, uint8 winningOutcome, uint256 totalPayout);
event MarketClosed(uint256 indexed marketId, bytes32 indexed warId, uint256 totalDeposits);
event WinningsClaimed(uint256 indexed marketId, address indexed user, uint8 outcomeIndex, uint256 payout, uint256 fee);
event RefundClaimed(uint256 indexed marketId, address indexed user, uint256 refundAmount);
```

---

## Error Handling

V2 uses custom errors for better debugging:

| Error | Description |
|-------|-------------|
| `MarketNotFound()` | Market ID doesn't exist |
| `MarketNotActive()` | Market is not active (can't trade) |
| `MarketNotResolved()` | Market not resolved (for claimWinnings) |
| `MarketNotClosed()` | Market not closed (for claimRefund) |
| `MarketNotClaimable()` | Market is still active |
| `InvalidOutcome()` | Outcome index out of range |
| `InsufficientShares()` | User doesn't have enough shares |
| `InsufficientLiquidity()` | Not enough liquidity for operation |
| `NothingToClaim()` | No claimable amount for user |
| `AlreadyClaimed()` | User already claimed |
| `TransferFailed()` | Token transfer failed |
| `SlippageExceeded()` | Slippage protection triggered |
| `NotAdmin()` | Caller is not admin |
| `ZeroAddress()` | Invalid zero address |
| `ZeroAmount()` | Amount must be > 0 |

---

## Migration from V1

If you have existing V1 integrations:

1. **Update contract address**:
   ```typescript
   // Old
   const CONTRACT = "0xCC71e190c8209C29421345C95F43591391413204";
   // New
   const CONTRACT = "0xcAd8BAa9e8885de5bfeAC6a043BA085e040Df17c";
   ```

2. **Use unified claim**:
   ```typescript
   // Old (could fail for closed markets)
   await contract.claimWinnings(marketId);

   // New (works for both)
   await contract.claim(marketId);
   ```

3. **Use getUserClaimStatus**:
   ```typescript
   // Old (had to check multiple functions)
   const claimable = await contract.getClaimableAmount(marketId, user);
   const market = await contract.getMarket(marketId);

   // New (one call, all info)
   const status = await contract.getUserClaimStatus(marketId, user);
   // status.canClaim, status.isResolved, status.isClosed, status.claimableAmount, etc.
   ```

---

## Support

- Contract verified on Sourcify
- Basescan: https://basescan.org/address/0xcAd8BAa9e8885de5bfeAC6a043BA085e040Df17c
