# TokenWarsPredictionMarket V2 - Frontend Implementation Guide

## Contract Details

| Item | Value |
|------|-------|
| **Contract Address** | `0xCC71e190c8209C29421345C95F43591391413204` |
| **Network** | Base Mainnet (Chain ID: 8453) |
| **wASS Token** | `0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6` |
| **OTC Router** | `0xD39bcE42ad5Cf7704e74206aD9551206fa0aD98a` |
| **Block Explorer** | https://basescan.org/address/0xCC71e190c8209C29421345C95F43591391413204 |

---

## 1. Contract ABI

```typescript
// lib/prediction-market-abi.ts
export const PREDICTION_MARKET_ABI = [
  // View Functions
  "function getMarket(uint256 marketId) view returns (bytes32 warId, uint8 marketType, uint8 status, uint256 createdAt, uint256 resolvedAt, uint256 totalDeposits, uint8 numOutcomes, uint8 winningOutcome, address creator)",
  "function getMarketInfo(uint256 marketId) view returns (bytes32 warId, uint8 marketTypeNum, uint8 statusNum, uint256 totalDeposits, uint8 numOutcomes, uint8 winningOutcome, uint256[] outcomeTotalShares, uint256[] outcomeTotalDeposits, uint256[] outcomePrices)",
  "function getUserMarketInfo(uint256 marketId, address user) view returns (uint256[] shares, uint256[] depositedAmounts, bool[] claimed, uint256[] potentialPayouts, uint256 claimableAmount)",
  "function getOutcomePool(uint256 marketId, uint8 outcomeIndex) view returns (uint256 totalShares, uint256 totalDeposits)",
  "function getAllOutcomePools(uint256 marketId) view returns (uint256[] shares, uint256[] deposits)",
  "function getUserPosition(uint256 marketId, address user, uint8 outcomeIndex) view returns (uint256 shares, uint256 depositedAmount, bool claimed)",
  "function getUserAllPositions(uint256 marketId, address user) view returns (uint256[] shares, uint256[] depositedAmounts, bool[] claimedStatus)",
  "function getOutcomePrice(uint256 marketId, uint8 outcomeIndex) view returns (uint256 priceBps)",
  "function getAllOutcomePrices(uint256 marketId) view returns (uint256[] prices)",
  "function estimateSharesOut(uint256 marketId, uint8 outcomeIndex, uint256 wassAmount) view returns (uint256 sharesOut, uint256 fee)",
  "function estimateTokensOut(uint256 marketId, uint8 outcomeIndex, uint256 sharesToSell) view returns (uint256 wassOut, uint256 fee)",
  "function estimatePayout(uint256 marketId, address user) view returns (uint256 potentialPayout)",
  "function getMarketsByWarId(bytes32 warId) view returns (uint256[] marketIds)",
  "function getClaimableAmount(uint256 marketId, address user) view returns (uint256 claimable)",
  "function isMarketResolved(uint256 marketId) view returns (bool)",
  "function getTotalMarkets() view returns (uint256)",
  "function quoteETHForWASS(uint256 ethIn) view returns (uint256 swapPortion, uint256 otcPortion, uint256 otcAvailable, bool hasOtc)",
  "function nextMarketId() view returns (uint256)",
  "function totalFeesCollected() view returns (uint256)",
  "function totalFeesToStaking() view returns (uint256)",
  "function admins(address) view returns (bool)",

  // Write Functions
  "function createMarket(bytes32 warId, uint8 marketType, uint256 initialLiquidity) returns (uint256 marketId)",
  "function createMarketWithETH(bytes32 warId, uint8 marketType, uint256 minWassOut) payable returns (uint256 marketId)",
  "function buyShares(uint256 marketId, uint8 outcomeIndex, uint256 wassAmount) returns (uint256 sharesReceived)",
  "function buySharesWithETH(uint256 marketId, uint8 outcomeIndex, uint256 minWassOut) payable returns (uint256 sharesReceived)",
  "function sellShares(uint256 marketId, uint8 outcomeIndex, uint256 sharesToSell) returns (uint256 wassReceived)",
  "function claimWinnings(uint256 marketId) returns (uint256 payout)",
  "function claimRefund(uint256 marketId) returns (uint256 refund)",

  // Admin Functions
  "function resolveMarket(uint256 marketId, uint8 winningOutcome)",
  "function closeMarket(uint256 marketId)",
  "function setAdmin(address admin, bool status)",

  // Events
  "event MarketCreated(uint256 indexed marketId, bytes32 indexed warId, uint8 marketType, uint8 numOutcomes, address creator)",
  "event SharesPurchased(uint256 indexed marketId, address indexed buyer, uint8 outcomeIndex, uint256 wassAmount, uint256 sharesReceived, uint256 fee)",
  "event SharesSold(uint256 indexed marketId, address indexed seller, uint8 outcomeIndex, uint256 sharesSold, uint256 wassReceived, uint256 fee)",
  "event MarketResolved(uint256 indexed marketId, bytes32 indexed warId, uint8 winningOutcome, uint256 totalPayout)",
  "event WinningsClaimed(uint256 indexed marketId, address indexed user, uint8 outcomeIndex, uint256 payout, uint256 fee)",
  "event ETHSwappedToWASS(address indexed user, uint256 ethAmount, uint256 wassReceived)",
] as const;

export const WASS_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
] as const;
```

---

## 2. TypeScript Types

```typescript
// types/prediction-market.ts

export const PREDICTION_MARKET_ADDRESS = "0xCC71e190c8209C29421345C95F43591391413204";
export const WASS_ADDRESS = "0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6";
export const OTC_ROUTER_ADDRESS = "0xD39bcE42ad5Cf7704e74206aD9551206fa0aD98a";

// Enums matching contract
export enum MarketStatus {
  None = 0,
  Active = 1,
  Resolved = 2,
  Closed = 3,
}

export enum MarketType {
  DexVote = 0,   // 3 options: Uniswap, Aerodrome, Clankerdome
  PairVote = 1, // 2 options: ETH pair, wASS pair
  Sellout = 2,  // Binary: Yes/No
}

// Outcome labels by market type
export const OUTCOME_LABELS: Record<MarketType, string[]> = {
  [MarketType.DexVote]: ["Uniswap", "Aerodrome", "Clankerdome"],
  [MarketType.PairVote]: ["ETH Pair", "wASS Pair"],
  [MarketType.Sellout]: ["Yes", "No"],
};

export interface MarketInfo {
  marketId: number;
  warId: string;
  marketType: MarketType;
  status: MarketStatus;
  totalDeposits: bigint;
  numOutcomes: number;
  winningOutcome: number;
  createdAt: number;
  resolvedAt: number;
  creator: string;
  outcomes: OutcomeInfo[];
}

export interface OutcomeInfo {
  index: number;          // 1-indexed (matches contract)
  label: string;
  totalShares: bigint;
  totalDeposits: bigint;
  price: number;          // Probability as percentage (0-100)
  priceBps: bigint;       // Raw BPS value from contract
}

export interface UserPosition {
  outcomeIndex: number;
  shares: bigint;
  depositedAmount: bigint;
  claimed: boolean;
  potentialPayout: bigint;
}

export interface UserMarketInfo {
  positions: UserPosition[];
  claimableAmount: bigint;
  hasWinningPosition: boolean;
}
```

---

## 3. Contract Client

```typescript
// lib/prediction-market-client.ts
import { ethers } from "ethers";
import {
  PREDICTION_MARKET_ADDRESS,
  WASS_ADDRESS,
  MarketInfo,
  MarketType,
  MarketStatus,
  OutcomeInfo,
  UserMarketInfo,
  UserPosition,
  OUTCOME_LABELS,
} from "../types/prediction-market";
import { PREDICTION_MARKET_ABI, WASS_ABI } from "./prediction-market-abi";

export class PredictionMarketClient {
  private contract: ethers.Contract;
  private wassContract: ethers.Contract;
  private provider: ethers.Provider;
  private signer?: ethers.Signer;

  constructor(providerOrSigner: ethers.Provider | ethers.Signer) {
    if ("getAddress" in providerOrSigner) {
      // It's a signer
      this.signer = providerOrSigner as ethers.Signer;
      this.provider = this.signer.provider!;
      this.contract = new ethers.Contract(PREDICTION_MARKET_ADDRESS, PREDICTION_MARKET_ABI, this.signer);
      this.wassContract = new ethers.Contract(WASS_ADDRESS, WASS_ABI, this.signer);
    } else {
      // It's a provider
      this.provider = providerOrSigner;
      this.contract = new ethers.Contract(PREDICTION_MARKET_ADDRESS, PREDICTION_MARKET_ABI, this.provider);
      this.wassContract = new ethers.Contract(WASS_ADDRESS, WASS_ABI, this.provider);
    }
  }

  // ============ Read Functions ============

  /**
   * Get comprehensive market info
   */
  async getMarketInfo(marketId: number): Promise<MarketInfo> {
    const [basicInfo, marketInfo] = await Promise.all([
      this.contract.getMarket(marketId),
      this.contract.getMarketInfo(marketId),
    ]);

    const marketType = Number(marketInfo.marketTypeNum) as MarketType;
    const numOutcomes = Number(marketInfo.numOutcomes);
    const outcomeLabels = OUTCOME_LABELS[marketType];

    const outcomes: OutcomeInfo[] = [];
    for (let i = 0; i < numOutcomes; i++) {
      outcomes.push({
        index: i + 1, // 1-indexed
        label: outcomeLabels[i] || `Option ${i + 1}`,
        totalShares: marketInfo.outcomeTotalShares[i],
        totalDeposits: marketInfo.outcomeTotalDeposits[i],
        priceBps: marketInfo.outcomePrices[i],
        price: Number(marketInfo.outcomePrices[i]) / 100, // BPS to percentage
      });
    }

    return {
      marketId,
      warId: basicInfo.warId,
      marketType,
      status: Number(marketInfo.statusNum) as MarketStatus,
      totalDeposits: marketInfo.totalDeposits,
      numOutcomes,
      winningOutcome: Number(marketInfo.winningOutcome),
      createdAt: Number(basicInfo.createdAt),
      resolvedAt: Number(basicInfo.resolvedAt),
      creator: basicInfo.creator,
      outcomes,
    };
  }

  /**
   * Get user's position in a market
   */
  async getUserMarketInfo(marketId: number, userAddress: string): Promise<UserMarketInfo> {
    const info = await this.contract.getUserMarketInfo(marketId, userAddress);
    const market = await this.contract.getMarket(marketId);
    const marketType = Number(market[1]) as MarketType;
    const outcomeLabels = OUTCOME_LABELS[marketType];

    const positions: UserPosition[] = [];
    for (let i = 0; i < info.shares.length; i++) {
      if (info.shares[i] > 0n) {
        positions.push({
          outcomeIndex: i + 1,
          shares: info.shares[i],
          depositedAmount: info.depositedAmounts[i],
          claimed: info.claimed[i],
          potentialPayout: info.potentialPayouts[i],
        });
      }
    }

    return {
      positions,
      claimableAmount: info.claimableAmount,
      hasWinningPosition: info.claimableAmount > 0n,
    };
  }

  /**
   * Get all outcome prices (probabilities)
   */
  async getOutcomePrices(marketId: number): Promise<{ index: number; price: number }[]> {
    const prices = await this.contract.getAllOutcomePrices(marketId);
    return prices.map((p: bigint, i: number) => ({
      index: i + 1,
      price: Number(p) / 100, // BPS to percentage
    }));
  }

  /**
   * Estimate shares received for wASS amount
   */
  async estimateSharesOut(
    marketId: number,
    outcomeIndex: number,
    wassAmount: bigint
  ): Promise<{ sharesOut: bigint; fee: bigint }> {
    const result = await this.contract.estimateSharesOut(marketId, outcomeIndex, wassAmount);
    return { sharesOut: result.sharesOut, fee: result.fee };
  }

  /**
   * Estimate wASS received for selling shares
   */
  async estimateTokensOut(
    marketId: number,
    outcomeIndex: number,
    sharesToSell: bigint
  ): Promise<{ wassOut: bigint; fee: bigint }> {
    const result = await this.contract.estimateTokensOut(marketId, outcomeIndex, sharesToSell);
    return { wassOut: result.wassOut, fee: result.fee };
  }

  /**
   * Get ETH quote for wASS swap
   */
  async quoteETHForWASS(ethAmount: bigint): Promise<{
    swapPortion: bigint;
    otcPortion: bigint;
    otcAvailable: bigint;
    hasOtc: boolean;
  }> {
    const result = await this.contract.quoteETHForWASS(ethAmount);
    return {
      swapPortion: result.swapPortion,
      otcPortion: result.otcPortion,
      otcAvailable: result.otcAvailable,
      hasOtc: result.hasOtc,
    };
  }

  /**
   * Find markets by war ID
   */
  async getMarketsByWarId(warId: string): Promise<number[]> {
    const bytes32WarId = ethers.id(warId); // Hash string to bytes32
    const marketIds = await this.contract.getMarketsByWarId(bytes32WarId);
    return marketIds.map((id: bigint) => Number(id));
  }

  /**
   * Get claimable amount
   */
  async getClaimableAmount(marketId: number, userAddress: string): Promise<bigint> {
    return await this.contract.getClaimableAmount(marketId, userAddress);
  }

  /**
   * Check if market is resolved
   */
  async isMarketResolved(marketId: number): Promise<boolean> {
    return await this.contract.isMarketResolved(marketId);
  }

  /**
   * Get total number of markets
   */
  async getTotalMarkets(): Promise<number> {
    const total = await this.contract.getTotalMarkets();
    return Number(total);
  }

  /**
   * Check if address is admin
   */
  async isAdmin(address: string): Promise<boolean> {
    return await this.contract.admins(address);
  }

  // ============ Write Functions ============

  /**
   * Create market with wASS
   */
  async createMarket(
    warId: string,
    marketType: MarketType,
    initialLiquidity: bigint
  ): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const bytes32WarId = ethers.id(warId);

    // Check and set allowance
    const signerAddress = await this.signer.getAddress();
    const allowance = await this.wassContract.allowance(signerAddress, PREDICTION_MARKET_ADDRESS);

    if (allowance < initialLiquidity) {
      const approveTx = await this.wassContract.approve(PREDICTION_MARKET_ADDRESS, initialLiquidity);
      await approveTx.wait();
    }

    const tx = await this.contract.createMarket(bytes32WarId, marketType, initialLiquidity);
    return await tx.wait();
  }

  /**
   * Create market with ETH (auto-swaps to wASS)
   */
  async createMarketWithETH(
    warId: string,
    marketType: MarketType,
    ethAmount: bigint,
    minWassOut: bigint = 0n // Set slippage protection
  ): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const bytes32WarId = ethers.id(warId);
    const tx = await this.contract.createMarketWithETH(bytes32WarId, marketType, minWassOut, {
      value: ethAmount,
    });
    return await tx.wait();
  }

  /**
   * Buy shares with wASS
   */
  async buyShares(
    marketId: number,
    outcomeIndex: number,
    wassAmount: bigint
  ): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    // Check and set allowance
    const signerAddress = await this.signer.getAddress();
    const allowance = await this.wassContract.allowance(signerAddress, PREDICTION_MARKET_ADDRESS);

    if (allowance < wassAmount) {
      const approveTx = await this.wassContract.approve(PREDICTION_MARKET_ADDRESS, wassAmount);
      await approveTx.wait();
    }

    const tx = await this.contract.buyShares(marketId, outcomeIndex, wassAmount);
    return await tx.wait();
  }

  /**
   * Buy shares with ETH (auto-swaps to wASS)
   */
  async buySharesWithETH(
    marketId: number,
    outcomeIndex: number,
    ethAmount: bigint,
    minWassOut: bigint = 0n
  ): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const tx = await this.contract.buySharesWithETH(marketId, outcomeIndex, minWassOut, {
      value: ethAmount,
    });
    return await tx.wait();
  }

  /**
   * Sell shares
   */
  async sellShares(
    marketId: number,
    outcomeIndex: number,
    sharesToSell: bigint
  ): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const tx = await this.contract.sellShares(marketId, outcomeIndex, sharesToSell);
    return await tx.wait();
  }

  /**
   * Claim winnings from resolved market
   */
  async claimWinnings(marketId: number): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const tx = await this.contract.claimWinnings(marketId);
    return await tx.wait();
  }

  /**
   * Claim refund from closed market
   */
  async claimRefund(marketId: number): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const tx = await this.contract.claimRefund(marketId);
    return await tx.wait();
  }

  // ============ Admin Functions ============

  /**
   * Resolve market (admin only)
   */
  async resolveMarket(marketId: number, winningOutcome: number): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const tx = await this.contract.resolveMarket(marketId, winningOutcome);
    return await tx.wait();
  }

  /**
   * Close market for refunds (admin only)
   */
  async closeMarket(marketId: number): Promise<ethers.TransactionReceipt> {
    if (!this.signer) throw new Error("Signer required");

    const tx = await this.contract.closeMarket(marketId);
    return await tx.wait();
  }
}
```

---

## 4. React Hooks

```typescript
// hooks/usePredictionMarket.ts
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { PredictionMarketClient } from "../lib/prediction-market-client";
import { MarketInfo, UserMarketInfo, MarketType } from "../types/prediction-market";

export function usePredictionMarket(signer?: ethers.Signer) {
  const [client, setClient] = useState<PredictionMarketClient | null>(null);

  useEffect(() => {
    if (signer) {
      setClient(new PredictionMarketClient(signer));
    } else {
      // Read-only provider
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
      setClient(new PredictionMarketClient(provider));
    }
  }, [signer]);

  return client;
}

export function useMarketInfo(client: PredictionMarketClient | null, marketId: number) {
  const [market, setMarket] = useState<MarketInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!client || marketId <= 0) return;

    setLoading(true);
    try {
      const info = await client.getMarketInfo(marketId);
      setMarket(info);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [client, marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { market, loading, error, refresh };
}

export function useUserPosition(
  client: PredictionMarketClient | null,
  marketId: number,
  userAddress: string | undefined
) {
  const [position, setPosition] = useState<UserMarketInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!client || marketId <= 0 || !userAddress) {
      setPosition(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const info = await client.getUserMarketInfo(marketId, userAddress);
      setPosition(info);
    } catch (err) {
      console.error("Error fetching user position:", err);
    } finally {
      setLoading(false);
    }
  }, [client, marketId, userAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { position, loading, refresh };
}

export function useWarMarkets(client: PredictionMarketClient | null, warId: string) {
  const [marketIds, setMarketIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      if (!client || !warId) return;

      setLoading(true);
      try {
        const ids = await client.getMarketsByWarId(warId);
        setMarketIds(ids);
      } catch (err) {
        console.error("Error fetching war markets:", err);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, [client, warId]);

  return { marketIds, loading };
}
```

---

## 5. Usage Examples

### Creating a Market

```tsx
// components/CreateMarket.tsx
import { useState } from "react";
import { ethers } from "ethers";
import { usePredictionMarket } from "../hooks/usePredictionMarket";
import { MarketType } from "../types/prediction-market";

export function CreateMarket({ warId, signer }: { warId: string; signer: ethers.Signer }) {
  const client = usePredictionMarket(signer);
  const [loading, setLoading] = useState(false);
  const [marketType, setMarketType] = useState<MarketType>(MarketType.DexVote);
  const [useETH, setUseETH] = useState(true);
  const [amount, setAmount] = useState("0.01"); // ETH or wASS

  const handleCreate = async () => {
    if (!client) return;

    setLoading(true);
    try {
      if (useETH) {
        const ethAmount = ethers.parseEther(amount);
        const receipt = await client.createMarketWithETH(warId, marketType, ethAmount);
        console.log("Market created!", receipt);
      } else {
        const wassAmount = ethers.parseEther(amount);
        const receipt = await client.createMarket(warId, marketType, wassAmount);
        console.log("Market created!", receipt);
      }
    } catch (err) {
      console.error("Failed to create market:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3>Create Prediction Market</h3>

      <select value={marketType} onChange={(e) => setMarketType(Number(e.target.value))}>
        <option value={MarketType.DexVote}>DEX Vote (Uniswap/Aerodrome/Clankerdome)</option>
        <option value={MarketType.PairVote}>Pair Vote (ETH/wASS)</option>
        <option value={MarketType.Sellout}>Sellout (Yes/No)</option>
      </select>

      <label>
        <input type="checkbox" checked={useETH} onChange={(e) => setUseETH(e.target.checked)} />
        Pay with ETH (auto-swaps to wASS)
      </label>

      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={useETH ? "ETH amount" : "wASS amount"}
      />

      <button onClick={handleCreate} disabled={loading}>
        {loading ? "Creating..." : "Create Market"}
      </button>
    </div>
  );
}
```

### Buying Shares

```tsx
// components/BuyShares.tsx
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { usePredictionMarket, useMarketInfo } from "../hooks/usePredictionMarket";
import { OUTCOME_LABELS, MarketType } from "../types/prediction-market";

export function BuyShares({
  marketId,
  signer
}: {
  marketId: number;
  signer: ethers.Signer;
}) {
  const client = usePredictionMarket(signer);
  const { market, refresh } = useMarketInfo(client, marketId);
  const [selectedOutcome, setSelectedOutcome] = useState(1);
  const [amount, setAmount] = useState("0.001");
  const [useETH, setUseETH] = useState(true);
  const [loading, setLoading] = useState(false);
  const [estimatedShares, setEstimatedShares] = useState<string>("0");

  // Estimate shares when amount changes
  useEffect(() => {
    async function estimate() {
      if (!client || !amount) return;

      try {
        const wassAmount = ethers.parseEther(amount);
        const { sharesOut } = await client.estimateSharesOut(marketId, selectedOutcome, wassAmount);
        setEstimatedShares(ethers.formatEther(sharesOut));
      } catch (err) {
        console.error("Estimate failed:", err);
      }
    }
    estimate();
  }, [client, marketId, selectedOutcome, amount]);

  const handleBuy = async () => {
    if (!client) return;

    setLoading(true);
    try {
      if (useETH) {
        const ethAmount = ethers.parseEther(amount);
        await client.buySharesWithETH(marketId, selectedOutcome, ethAmount);
      } else {
        const wassAmount = ethers.parseEther(amount);
        await client.buyShares(marketId, selectedOutcome, wassAmount);
      }
      refresh();
    } catch (err) {
      console.error("Buy failed:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!market) return <div>Loading...</div>;

  const labels = OUTCOME_LABELS[market.marketType];

  return (
    <div>
      <h3>Buy Shares</h3>

      <div className="outcomes">
        {market.outcomes.map((outcome) => (
          <button
            key={outcome.index}
            className={selectedOutcome === outcome.index ? "selected" : ""}
            onClick={() => setSelectedOutcome(outcome.index)}
          >
            <span>{outcome.label}</span>
            <span>{outcome.price.toFixed(1)}%</span>
          </button>
        ))}
      </div>

      <label>
        <input type="checkbox" checked={useETH} onChange={(e) => setUseETH(e.target.checked)} />
        Pay with ETH
      </label>

      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={useETH ? "ETH" : "wASS"}
      />

      <p>Estimated shares: {estimatedShares}</p>

      <button onClick={handleBuy} disabled={loading}>
        {loading ? "Buying..." : `Buy ${labels[selectedOutcome - 1]}`}
      </button>
    </div>
  );
}
```

### Market Display with Odds

```tsx
// components/MarketDisplay.tsx
import { usePredictionMarket, useMarketInfo, useUserPosition } from "../hooks/usePredictionMarket";
import { MarketStatus, OUTCOME_LABELS } from "../types/prediction-market";
import { ethers } from "ethers";

export function MarketDisplay({
  marketId,
  userAddress
}: {
  marketId: number;
  userAddress?: string;
}) {
  const client = usePredictionMarket();
  const { market, loading } = useMarketInfo(client, marketId);
  const { position } = useUserPosition(client, marketId, userAddress);

  if (loading || !market) return <div>Loading...</div>;

  const labels = OUTCOME_LABELS[market.marketType];
  const statusLabels = ["None", "Active", "Resolved", "Closed"];

  return (
    <div className="market-card">
      <div className="market-header">
        <span className={`status status-${market.status}`}>
          {statusLabels[market.status]}
        </span>
        <span>Total Pool: {ethers.formatEther(market.totalDeposits)} wASS</span>
      </div>

      <div className="outcomes-grid">
        {market.outcomes.map((outcome) => (
          <div
            key={outcome.index}
            className={`outcome ${market.winningOutcome === outcome.index ? "winner" : ""}`}
          >
            <h4>{outcome.label}</h4>
            <div className="probability-bar">
              <div
                className="fill"
                style={{ width: `${outcome.price}%` }}
              />
            </div>
            <span className="price">{outcome.price.toFixed(1)}%</span>
            <span className="pool">
              {ethers.formatEther(outcome.totalDeposits)} wASS
            </span>
          </div>
        ))}
      </div>

      {position && position.positions.length > 0 && (
        <div className="user-positions">
          <h4>Your Positions</h4>
          {position.positions.map((pos) => (
            <div key={pos.outcomeIndex} className="position">
              <span>{labels[pos.outcomeIndex - 1]}</span>
              <span>{ethers.formatEther(pos.shares)} shares</span>
              <span>Potential: {ethers.formatEther(pos.potentialPayout)} wASS</span>
            </div>
          ))}
        </div>
      )}

      {position && position.claimableAmount > 0n && (
        <div className="claimable">
          <p>Claimable: {ethers.formatEther(position.claimableAmount)} wASS</p>
          <button onClick={() => client?.claimWinnings(marketId)}>
            Claim Winnings
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 6. Admin Panel

```tsx
// components/AdminPanel.tsx
import { useState } from "react";
import { ethers } from "ethers";
import { usePredictionMarket, useMarketInfo } from "../hooks/usePredictionMarket";
import { MarketStatus, OUTCOME_LABELS } from "../types/prediction-market";

export function AdminPanel({
  marketId,
  signer
}: {
  marketId: number;
  signer: ethers.Signer;
}) {
  const client = usePredictionMarket(signer);
  const { market, refresh } = useMarketInfo(client, marketId);
  const [selectedWinner, setSelectedWinner] = useState(1);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check admin status
  useState(() => {
    async function check() {
      if (!client || !signer) return;
      const address = await signer.getAddress();
      const admin = await client.isAdmin(address);
      setIsAdmin(admin);
    }
    check();
  });

  if (!isAdmin) return <div>Not authorized</div>;
  if (!market) return <div>Loading...</div>;

  const labels = OUTCOME_LABELS[market.marketType];

  const handleResolve = async () => {
    if (!client) return;

    setLoading(true);
    try {
      await client.resolveMarket(marketId, selectedWinner);
      refresh();
    } catch (err) {
      console.error("Resolve failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    if (!client) return;

    setLoading(true);
    try {
      await client.closeMarket(marketId);
      refresh();
    } catch (err) {
      console.error("Close failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-panel">
      <h3>Admin Controls - Market #{marketId}</h3>

      {market.status === MarketStatus.Active && (
        <>
          <div className="resolve-section">
            <h4>Resolve Market</h4>
            <select
              value={selectedWinner}
              onChange={(e) => setSelectedWinner(Number(e.target.value))}
            >
              {market.outcomes.map((outcome) => (
                <option key={outcome.index} value={outcome.index}>
                  {outcome.label} ({outcome.price.toFixed(1)}%)
                </option>
              ))}
            </select>
            <button onClick={handleResolve} disabled={loading}>
              {loading ? "Resolving..." : `Resolve: ${labels[selectedWinner - 1]} Wins`}
            </button>
          </div>

          <div className="close-section">
            <h4>Cancel Market</h4>
            <p>Close market and allow refunds (use if war is cancelled)</p>
            <button onClick={handleClose} disabled={loading} className="danger">
              Close Market (Enable Refunds)
            </button>
          </div>
        </>
      )}

      {market.status === MarketStatus.Resolved && (
        <div className="resolved-info">
          <p>Winner: {labels[market.winningOutcome - 1]}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 7. API Route Integration

```typescript
// app/api/prediction-market/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { PredictionMarketClient } from "@/lib/prediction-market-client";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
const client = new PredictionMarketClient(provider);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const marketId = searchParams.get("marketId");
  const warId = searchParams.get("warId");
  const userAddress = searchParams.get("user");

  try {
    switch (action) {
      case "market": {
        if (!marketId) return NextResponse.json({ error: "marketId required" }, { status: 400 });
        const market = await client.getMarketInfo(Number(marketId));
        return NextResponse.json(serializeBigInts(market));
      }

      case "user-position": {
        if (!marketId || !userAddress) {
          return NextResponse.json({ error: "marketId and user required" }, { status: 400 });
        }
        const position = await client.getUserMarketInfo(Number(marketId), userAddress);
        return NextResponse.json(serializeBigInts(position));
      }

      case "war-markets": {
        if (!warId) return NextResponse.json({ error: "warId required" }, { status: 400 });
        const marketIds = await client.getMarketsByWarId(warId);
        return NextResponse.json({ marketIds });
      }

      case "prices": {
        if (!marketId) return NextResponse.json({ error: "marketId required" }, { status: 400 });
        const prices = await client.getOutcomePrices(Number(marketId));
        return NextResponse.json({ prices });
      }

      case "total": {
        const total = await client.getTotalMarkets();
        return NextResponse.json({ total });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Prediction market API error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Helper to serialize BigInts for JSON
function serializeBigInts(obj: any): any {
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInts);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return obj;
}
```

---

## 8. Key Differences from Previous Version

| Feature | Old (Off-Chain) | New (On-Chain) |
|---------|-----------------|----------------|
| **Data Storage** | Database | Smart Contract |
| **Currency** | Off-chain tracking | wASS (ERC20) |
| **ETH Support** | Direct | Via OTC Router swap |
| **Fees** | Configurable | Fixed 1% to staking |
| **Resolution** | API call | Admin tx on-chain |
| **Payouts** | Manual/scheduled | User claims |
| **Trust** | Centralized | On-chain, auditable |

---

## 9. Important Notes

1. **Outcome Indices are 1-indexed**: The contract uses 1, 2, 3 for outcomes (not 0, 1, 2)

2. **Slippage Protection**: When using ETH functions, pass `minWassOut` to protect against slippage:
   ```typescript
   // Get quote first
   const quote = await client.quoteETHForWASS(ethAmount);
   const minWassOut = (quote.swapPortion + quote.otcPortion) * 95n / 100n; // 5% slippage
   await client.buySharesWithETH(marketId, outcome, ethAmount, minWassOut);
   ```

3. **wASS Approval**: When using wASS directly, the client handles approval automatically

4. **Fee Structure**:
   - 1% on buys → staking rewards
   - 1% on sells → staking rewards
   - 1% on claims → staking rewards

5. **Market Types**:
   - `0 = DexVote`: 3 outcomes (Uniswap, Aerodrome, Clankerdome)
   - `1 = PairVote`: 2 outcomes (ETH pair, wASS pair)
   - `2 = Sellout`: 2 outcomes (Yes, No)

6. **War ID Format**: Convert string war IDs to bytes32 using `ethers.id(warId)`

---

## 10. Admin Automation System

The prediction markets are managed automatically by the `PredictionMarketManager` service.

### Automatic Behavior

| Event | Action |
|-------|--------|
| **War Created** | Creates 3 markets (DexVote, PairVote, Sellout), seeds with 10% of admin wASS balance |
| **War Ends** | Resolves all 3 markets based on voting results |
| **After Resolution** | Claims winnings back to admin wallet |

### Admin API Endpoints

**Base URL**: `/api/prediction-market/admin`

#### GET Endpoints (No Auth Required)

```bash
# Get manager status and wASS balance
GET /api/prediction-market/admin?action=status

# Get market info
GET /api/prediction-market/admin?action=market&marketId=1

# Get markets for a war
GET /api/prediction-market/admin?action=war-markets&warId=war-123
```

#### POST Endpoints (Auth Required)

```bash
# Create markets for a specific war
POST /api/prediction-market/admin
{ "action": "create", "warId": "war-123" }

# Resolve markets for a war
POST /api/prediction-market/admin
{ "action": "resolve", "warId": "war-123" }

# Claim winnings for a war
POST /api/prediction-market/admin
{ "action": "claim", "warId": "war-123" }

# Run full cycle (create new, resolve ended, claim all)
POST /api/prediction-market/admin
{ "action": "process" }

# Create markets for all active wars
POST /api/prediction-market/admin
{ "action": "create-all" }

# Resolve and claim for all ended wars
POST /api/prediction-market/admin
{ "action": "resolve-all" }
```

### Market Resolution Logic

| Market | Outcome 1 | Outcome 2 | Outcome 3 |
|--------|-----------|-----------|-----------|
| **DexVote** | Uniswap V4 | Aerodrome | Hydrex |
| **PairVote** | ETH | wASS | - |
| **Sellout** | Yes (sold out) | No (not sold out) | - |

Winner is determined by:
- **DexVote**: Highest vote count (v4VotesUsdc vs aerodromeVotesUsdc vs hydrexVotesUsdc)
- **PairVote**: Highest vote count (ethVotesUsdc vs wassVotesUsdc)
- **Sellout**: Whether totalRaised >= targetAmount

### Cron Integration

Add to your cron/scheduler to run automatically:

```bash
# Run every 5 minutes to process new and ended wars
curl -X POST http://localhost:3000/api/prediction-market/admin \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_API_KEY" \
  -d '{"action": "process"}'
```

### Seeding Strategy

- Uses **10% of admin wallet wASS balance** total
- Split evenly across 3 markets (~3.33% each)
- Admin receives seeded shares in all outcomes
- On resolution, admin claims winnings from winning outcome
- Net effect: Admin recovers seed + any profit from winning outcome
