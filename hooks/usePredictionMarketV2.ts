"use client";

// hooks/usePredictionMarketV2.ts
// Wagmi hooks for TokenWarsPredictionMarket V2 (On-Chain)

import { useState, useEffect, useCallback, useMemo } from "react";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount, usePublicClient } from "wagmi";
import { base } from "wagmi/chains";
import { keccak256, toBytes, formatEther, parseEther } from "viem";

import { PREDICTION_MARKET_V2_ABI } from "@/abis/predictionMarketV2";
import { ERC20_ABI } from "@/abis/erc20";
import {
  PREDICTION_MARKET_V2_ADDRESS,
  WASS_ADDRESS,
  MarketTypeV2,
  MarketStatusV2,
  MarketInfoV2,
  OutcomeInfoV2,
  UserMarketInfoV2,
  UserPositionV2,
  RawMarketInfo,
  RawUserMarketInfo,
  OUTCOME_LABELS_V2,
  MARKET_TYPE_NAMES,
  getStatusName,
  formatWASS,
  calculateProfitLossPercent,
} from "@/types/prediction-market-v2";

// =============================================================================
// CONTRACT ADDRESS
// =============================================================================

const CONTRACT_ADDRESS = PREDICTION_MARKET_V2_ADDRESS;
const WASS_TOKEN = WASS_ADDRESS;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert war ID string to bytes32 (keccak256 hash)
 */
export function warIdToBytes32(warId: string): `0x${string}` {
  if (warId.startsWith("0x") && warId.length === 66) {
    return warId as `0x${string}`;
  }
  return keccak256(toBytes(warId));
}

/**
 * Process raw market info into frontend-friendly format
 * Contract returns: [warId, marketTypeNum, statusNum, totalDeposits, numOutcomes, winningOutcome, outcomeTotalShares[], outcomeTotalDeposits[], outcomePrices[]]
 */
function processMarketInfo(
  marketId: number,
  rawData: unknown
): MarketInfoV2 | null {
  if (!rawData) return null;

  let warId: `0x${string}`;
  let marketTypeNum: number;
  let statusNum: number;
  let totalDeposits: bigint;
  let numOutcomes: number;
  let winningOutcome: number;
  let outcomeTotalShares: readonly bigint[];
  let outcomeTotalDeposits: readonly bigint[];
  let outcomePrices: readonly bigint[];

  if (Array.isArray(rawData)) {
    // Tuple format from viem
    [warId, marketTypeNum, statusNum, totalDeposits, numOutcomes, winningOutcome, outcomeTotalShares, outcomeTotalDeposits, outcomePrices] = rawData as [
      `0x${string}`,
      number,
      number,
      bigint,
      number,
      number,
      readonly bigint[],
      readonly bigint[],
      readonly bigint[]
    ];
  } else {
    // Object format with named properties
    const rawInfo = rawData as RawMarketInfo;
    warId = rawInfo.warId;
    marketTypeNum = rawInfo.marketTypeNum;
    statusNum = rawInfo.statusNum;
    totalDeposits = rawInfo.totalDeposits;
    numOutcomes = rawInfo.numOutcomes;
    winningOutcome = rawInfo.winningOutcome;
    outcomeTotalShares = rawInfo.outcomeTotalShares || [];
    outcomeTotalDeposits = rawInfo.outcomeTotalDeposits || [];
    outcomePrices = rawInfo.outcomePrices || [];
  }

  const marketType = marketTypeNum as MarketTypeV2;
  const status = statusNum as MarketStatusV2;
  const labels = OUTCOME_LABELS_V2[marketType] || [];

  const outcomes: OutcomeInfoV2[] = [];
  for (let i = 0; i < numOutcomes; i++) {
    const priceBps = outcomePrices[i] || 0n;
    outcomes.push({
      index: i + 1, // 1-indexed
      label: labels[i] || `Option ${i + 1}`,
      totalShares: outcomeTotalShares[i] || 0n,
      totalDeposits: outcomeTotalDeposits[i] || 0n,
      priceBps,
      probability: Number(priceBps) / 100, // BPS to percentage
    });
  }

  return {
    marketId,
    warId,
    warIdHex: warId,
    marketType,
    marketTypeName: MARKET_TYPE_NAMES[marketType] || "Unknown",
    status,
    statusName: getStatusName(status),
    totalDeposits,
    totalDepositsFormatted: formatWASS(totalDeposits),
    numOutcomes,
    winningOutcome,
    createdAt: 0, // Not available in getMarketInfo
    resolvedAt: 0,
    creator: "0x0000000000000000000000000000000000000000",
    outcomes,
    isActive: status === MarketStatusV2.Active,
    isResolved: status === MarketStatusV2.Resolved,
    isClosed: status === MarketStatusV2.Closed,
  };
}

/**
 * Process raw user market info into frontend-friendly format
 * Contract returns: [shares[], depositedAmounts[], claimed[], potentialPayouts[], claimableAmount]
 */
function processUserMarketInfo(
  marketId: number,
  rawData: unknown,
  marketType: MarketTypeV2
): UserMarketInfoV2 | null {
  // Handle null/undefined data
  if (!rawData) {
    return null;
  }

  // Contract returns a tuple array: [shares[], depositedAmounts[], claimed[], potentialPayouts[], claimableAmount]
  // viem may return as array or object depending on ABI format
  let shares: readonly bigint[];
  let depositedAmounts: readonly bigint[];
  let claimed: readonly boolean[];
  let potentialPayouts: readonly bigint[];
  let claimableAmount: bigint;

  if (Array.isArray(rawData)) {
    // Tuple format: [shares, depositedAmounts, claimed, potentialPayouts, claimableAmount]
    [shares, depositedAmounts, claimed, potentialPayouts, claimableAmount] = rawData as [
      readonly bigint[],
      readonly bigint[],
      readonly boolean[],
      readonly bigint[],
      bigint
    ];
  } else {
    // Object format with named properties
    const rawInfo = rawData as RawUserMarketInfo;
    shares = rawInfo.shares || [];
    depositedAmounts = rawInfo.depositedAmounts || [];
    claimed = rawInfo.claimed || [];
    potentialPayouts = rawInfo.potentialPayouts || [];
    claimableAmount = rawInfo.claimableAmount || 0n;
  }

  // Safety check
  if (!shares || shares.length === 0) {
    return {
      marketId,
      positions: [],
      claimableAmount: claimableAmount || 0n,
      claimableFormatted: formatWASS(claimableAmount || 0n),
      hasWinningPosition: (claimableAmount || 0n) > 0n,
      totalInvested: 0n,
      totalInvestedFormatted: "0.00",
    };
  }

  const labels = OUTCOME_LABELS_V2[marketType] || [];
  const positions: UserPositionV2[] = [];
  let totalInvested = 0n;

  for (let i = 0; i < shares.length; i++) {
    const shareAmount = shares[i] || 0n;
    if (shareAmount > 0n) {
      const deposited = depositedAmounts[i] || 0n;
      const potential = potentialPayouts[i] || 0n;
      const profitLoss = potential - deposited;

      totalInvested += deposited;

      positions.push({
        outcomeIndex: i + 1, // 1-indexed
        outcomeLabel: labels[i] || `Option ${i + 1}`,
        shares: shareAmount,
        sharesFormatted: formatWASS(shareAmount, 4),
        depositedAmount: deposited,
        depositedFormatted: formatWASS(deposited),
        claimed: claimed[i] || false,
        potentialPayout: potential,
        potentialPayoutFormatted: formatWASS(potential),
        profitLoss,
        profitLossFormatted: formatWASS(profitLoss),
        profitLossPercent: calculateProfitLossPercent(potential, deposited),
      });
    }
  }

  return {
    marketId,
    positions,
    claimableAmount: claimableAmount || 0n,
    claimableFormatted: formatWASS(claimableAmount || 0n),
    hasWinningPosition: (claimableAmount || 0n) > 0n,
    totalInvested,
    totalInvestedFormatted: formatWASS(totalInvested),
  };
}

// =============================================================================
// HOOK: useMarketInfo
// =============================================================================

export function useMarketInfoV2(marketId: number | null) {
  const enabled = marketId !== null && marketId > 0;

  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "getMarketInfo",
    args: enabled ? [BigInt(marketId)] : undefined,
    query: { enabled },
  });

  const market = useMemo(() => {
    if (!data || !marketId) return null;
    try {
      return processMarketInfo(marketId, data);
    } catch (err) {
      console.error("Error processing market info:", err, data);
      return null;
    }
  }, [data, marketId]);

  return {
    market,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

// =============================================================================
// HOOK: useUserPositionV2
// =============================================================================

export function useUserPositionV2(
  marketId: number | null,
  userAddress: `0x${string}` | undefined,
  marketType: MarketTypeV2 = MarketTypeV2.DexVote
) {
  const enabled = marketId !== null && marketId > 0 && !!userAddress;

  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "getUserMarketInfo",
    args: enabled ? [BigInt(marketId), userAddress] : undefined,
    query: { enabled },
  });

  const position = useMemo(() => {
    if (!data || !marketId) return null;
    try {
      return processUserMarketInfo(marketId, data, marketType);
    } catch (err) {
      console.error("Error processing user market info:", err, data);
      return null;
    }
  }, [data, marketId, marketType]);

  return {
    position,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

// =============================================================================
// HOOK: useWarMarketsV2
// =============================================================================

export function useWarMarketsV2(warId: string | null) {
  const bytes32WarId = useMemo(() => {
    if (!warId) return undefined;
    return warIdToBytes32(warId);
  }, [warId]);

  const enabled = !!bytes32WarId;

  // Get market IDs for this war
  const { data: marketIds, isLoading: idsLoading, error: idsError, refetch: refetchIds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "getMarketsByWarId",
    args: enabled ? [bytes32WarId] : undefined,
    query: { enabled },
  });

  // Get market info for each market ID
  const marketIdNumbers = useMemo(() => {
    if (!marketIds) return [];
    return (marketIds as bigint[]).map((id) => Number(id)).filter((id) => id > 0);
  }, [marketIds]);

  const contractCalls = useMemo(() => {
    return marketIdNumbers.map((id) => ({
      address: CONTRACT_ADDRESS,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "getMarketInfo" as const,
      args: [BigInt(id)] as const,
    }));
  }, [marketIdNumbers]);

  const { data: marketsData, isLoading: marketsLoading, error: marketsError, refetch: refetchMarkets } = useReadContracts({
    contracts: contractCalls,
    query: { enabled: marketIdNumbers.length > 0 },
  });

  const markets = useMemo(() => {
    if (!marketsData) return [];
    return marketsData
      .map((result, index) => {
        if (result.status === "success" && result.result) {
          try {
            return processMarketInfo(marketIdNumbers[index], result.result);
          } catch (err) {
            console.error("Error processing market:", marketIdNumbers[index], err);
            return null;
          }
        }
        return null;
      })
      .filter((m): m is MarketInfoV2 => m !== null);
  }, [marketsData, marketIdNumbers]);

  const refetch = useCallback(() => {
    refetchIds();
    refetchMarkets();
  }, [refetchIds, refetchMarkets]);

  return {
    marketIds: marketIdNumbers,
    markets,
    isLoading: idsLoading || marketsLoading,
    error: (idsError || marketsError) as Error | null,
    refetch,
  };
}

// =============================================================================
// HOOK: useSharesEstimate
// =============================================================================

export function useSharesEstimate(
  marketId: number | null,
  outcomeIndex: number,
  wassAmount: bigint
) {
  const enabled = marketId !== null && marketId > 0 && outcomeIndex > 0 && wassAmount > 0n;

  const { data, isLoading, error } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "estimateSharesOut",
    args: enabled ? [BigInt(marketId), outcomeIndex, wassAmount] : undefined,
    query: { enabled },
  });

  const estimate = useMemo(() => {
    if (!data) return null;
    const [sharesOut, fee] = data as [bigint, bigint];
    return {
      sharesOut,
      sharesFormatted: formatWASS(sharesOut, 4),
      fee,
      feeFormatted: formatWASS(fee),
      effectivePrice: wassAmount > 0n ? Number(wassAmount) / Number(sharesOut) : 0,
    };
  }, [data, wassAmount]);

  return { estimate, isLoading, error: error as Error | null };
}

// =============================================================================
// HOOK: useSellEstimate
// =============================================================================

export function useSellEstimate(
  marketId: number | null,
  outcomeIndex: number,
  sharesToSell: bigint
) {
  const enabled = marketId !== null && marketId > 0 && outcomeIndex > 0 && sharesToSell > 0n;

  const { data, isLoading, error } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "estimateTokensOut",
    args: enabled ? [BigInt(marketId), outcomeIndex, sharesToSell] : undefined,
    query: { enabled },
  });

  const estimate = useMemo(() => {
    if (!data) return null;
    const [wassOut, fee] = data as [bigint, bigint];
    return {
      wassOut,
      wassFormatted: formatWASS(wassOut),
      fee,
      feeFormatted: formatWASS(fee),
    };
  }, [data]);

  return { estimate, isLoading, error: error as Error | null };
}

// =============================================================================
// HOOK: useETHQuote
// =============================================================================

export function useETHQuote(ethAmount: bigint) {
  const enabled = ethAmount > 0n;

  const { data, isLoading, error } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "quoteETHForWASS",
    args: enabled ? [ethAmount] : undefined,
    query: { enabled },
  });

  const quote = useMemo(() => {
    if (!data) return null;
    const [swapPortion, otcPortion, otcAvailable, hasOtc] = data as [bigint, bigint, bigint, boolean];
    const totalWassOut = swapPortion + otcPortion;
    return {
      swapPortion,
      otcPortion,
      totalWassOut,
      totalWassFormatted: formatWASS(totalWassOut),
      otcAvailable,
      hasOtc,
    };
  }, [data]);

  return { quote, isLoading, error: error as Error | null };
}

// =============================================================================
// HOOK: useBuySharesV2
// =============================================================================

export function useBuySharesV2() {
  const { address } = useAccount();
  const [isApproving, setIsApproving] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [buySuccess, setBuySuccess] = useState(false);
  const [buyError, setBuyError] = useState<Error | null>(null);
  const [buyHash, setBuyHash] = useState<`0x${string}` | undefined>(undefined);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Check wASS allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WASS_TOKEN,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const buyShares = useCallback(async (
    marketId: number,
    outcomeIndex: number,
    wassAmount: bigint
  ): Promise<`0x${string}`> => {
    setBuySuccess(false);
    setBuyError(null);
    setBuyHash(undefined);

    try {
      // Check if we need to approve
      const currentAllowance = (allowance as bigint) || 0n;
      if (currentAllowance < wassAmount) {
        setIsApproving(true);

        // Approve max uint256 for convenience
        const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        const approveHash = await writeContractAsync({
          address: WASS_TOKEN,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, maxApproval],
        });

        // Wait for approval to be mined
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        // Refetch allowance to confirm
        await refetchAllowance();
        setIsApproving(false);
      }

      // Now buy shares
      setIsBuying(true);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: PREDICTION_MARKET_V2_ABI,
        functionName: "buyShares",
        args: [BigInt(marketId), outcomeIndex, wassAmount],
      });

      setBuyHash(hash);

      // Wait for buy transaction to be mined
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setIsBuying(false);
      setBuySuccess(true);
      return hash;
    } catch (err) {
      setIsApproving(false);
      setIsBuying(false);
      setBuyError(err as Error);
      throw err;
    }
  }, [writeContractAsync, allowance, refetchAllowance, publicClient]);

  const buySharesWithETH = useCallback(async (
    marketId: number,
    outcomeIndex: number,
    ethAmount: bigint,
    minWassOut: bigint = 0n
  ): Promise<`0x${string}`> => {
    setBuySuccess(false);
    setBuyError(null);
    setBuyHash(undefined);

    try {
      setIsBuying(true);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: PREDICTION_MARKET_V2_ABI,
        functionName: "buySharesWithETH",
        args: [BigInt(marketId), outcomeIndex, minWassOut],
        value: ethAmount,
      });

      setBuyHash(hash);

      // Wait for transaction to be mined
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setIsBuying(false);
      setBuySuccess(true);
      return hash;
    } catch (err) {
      setIsBuying(false);
      setBuyError(err as Error);
      throw err;
    }
  }, [writeContractAsync, publicClient]);

  // Reset success state when starting new transaction
  const resetState = useCallback(() => {
    setBuySuccess(false);
    setBuyError(null);
    setBuyHash(undefined);
  }, []);

  return {
    buyShares,
    buySharesWithETH,
    allowance: (allowance as bigint) || 0n,
    isApproving,
    isLoading: isApproving || isBuying,
    isSuccess: buySuccess,
    error: buyError,
    hash: buyHash,
    resetState,
  };
}

// =============================================================================
// HOOK: useSellSharesV2
// =============================================================================

export function useSellSharesV2() {
  const { writeContractAsync, isPending, error, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const sellShares = useCallback(async (
    marketId: number,
    outcomeIndex: number,
    sharesToSell: bigint
  ) => {
    return writeContractAsync({
      address: CONTRACT_ADDRESS,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "sellShares",
      args: [BigInt(marketId), outcomeIndex, sharesToSell],
    });
  }, [writeContractAsync]);

  return {
    sellShares,
    isLoading: isPending || isConfirming,
    isSuccess,
    error: error as Error | null,
    hash,
  };
}

// =============================================================================
// HOOK: useClaimV2
// =============================================================================

export function useClaimV2() {
  const { writeContractAsync, isPending, error, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const claimWinnings = useCallback(async (marketId: number) => {
    return writeContractAsync({
      address: CONTRACT_ADDRESS,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "claimWinnings",
      args: [BigInt(marketId)],
    });
  }, [writeContractAsync]);

  const claimRefund = useCallback(async (marketId: number) => {
    return writeContractAsync({
      address: CONTRACT_ADDRESS,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "claimRefund",
      args: [BigInt(marketId)],
    });
  }, [writeContractAsync]);

  return {
    claimWinnings,
    claimRefund,
    isLoading: isPending || isConfirming,
    isSuccess,
    error: error as Error | null,
    hash,
  };
}

// =============================================================================
// HOOK: useIsAdmin
// =============================================================================

export function useIsAdmin(address: `0x${string}` | undefined) {
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "admins",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return {
    isAdmin: (data as boolean) || false,
    isLoading,
  };
}

// =============================================================================
// HOOK: useTotalMarkets
// =============================================================================

export function useTotalMarkets() {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: PREDICTION_MARKET_V2_ABI,
    functionName: "getTotalMarkets",
  });

  return {
    totalMarkets: data ? Number(data) : 0,
    isLoading,
    refetch,
  };
}

// =============================================================================
// HOOK: useUnclaimedRewards
// Aggregates all unclaimed prediction market rewards for a user
// =============================================================================

export interface UnclaimedReward {
  marketId: number;
  warId: string;
  marketType: MarketTypeV2;
  claimableAmount: bigint;
  claimableFormatted: string;
  winningOutcome: number;
  isResolved: boolean;
  isClosed: boolean;
}

export function useUnclaimedRewards(userAddress?: `0x${string}`) {
  const { totalMarkets, isLoading: totalLoading } = useTotalMarkets();

  // Build contract calls to check claimable amounts for all markets
  const claimableCheckCalls = useMemo(() => {
    if (!userAddress || totalMarkets === 0) return [];
    // Markets are 1-indexed
    return Array.from({ length: totalMarkets }, (_, i) => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "getClaimableAmount" as const,
      args: [BigInt(i + 1), userAddress] as const,
    }));
  }, [userAddress, totalMarkets]);

  // Batch fetch all claimable amounts
  const {
    data: claimableData,
    isLoading: claimableLoading,
    error: claimableError,
    refetch: refetchClaimable,
  } = useReadContracts({
    contracts: claimableCheckCalls,
    query: { enabled: claimableCheckCalls.length > 0 },
  });

  // Find markets with claimable amounts
  const marketsWithClaimable = useMemo(() => {
    if (!claimableData) return [];
    const results: { marketId: number; claimable: bigint }[] = [];
    claimableData.forEach((result, index) => {
      if (result.status === "success" && result.result) {
        const claimable = result.result as bigint;
        if (claimable > 0n) {
          results.push({ marketId: index + 1, claimable });
        }
      }
    });
    return results;
  }, [claimableData]);

  // Build contract calls to get market info for markets with claimable amounts
  const marketInfoCalls = useMemo(() => {
    return marketsWithClaimable.map((m) => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "getMarketInfo" as const,
      args: [BigInt(m.marketId)] as const,
    }));
  }, [marketsWithClaimable]);

  // Fetch market info for claimable markets
  const {
    data: marketInfoData,
    isLoading: marketInfoLoading,
  } = useReadContracts({
    contracts: marketInfoCalls,
    query: { enabled: marketInfoCalls.length > 0 },
  });

  // Process rewards data
  const rewards = useMemo((): UnclaimedReward[] => {
    if (!marketInfoData || marketsWithClaimable.length === 0) return [];

    return marketsWithClaimable.map((m, index) => {
      const infoResult = marketInfoData[index];
      let warId = "";
      let marketType = MarketTypeV2.DexVote;
      let winningOutcome = 0;
      let status = MarketStatusV2.None;

      if (infoResult?.status === "success" && infoResult.result) {
        try {
          const rawData = infoResult.result;
          if (Array.isArray(rawData)) {
            // [warId, marketTypeNum, statusNum, totalDeposits, numOutcomes, winningOutcome, ...]
            warId = rawData[0] as string;
            marketType = Number(rawData[1]) as MarketTypeV2;
            status = Number(rawData[2]) as MarketStatusV2;
            winningOutcome = Number(rawData[5]);
          }
        } catch (err) {
          console.error("Error processing market info:", err);
        }
      }

      return {
        marketId: m.marketId,
        warId,
        marketType,
        claimableAmount: m.claimable,
        claimableFormatted: formatWASS(m.claimable),
        winningOutcome,
        isResolved: status === MarketStatusV2.Resolved,
        isClosed: status === MarketStatusV2.Closed,
      };
    });
  }, [marketInfoData, marketsWithClaimable]);

  // Calculate total claimable
  const totalClaimable = useMemo(() => {
    return rewards.reduce((sum, r) => sum + r.claimableAmount, 0n);
  }, [rewards]);

  const totalClaimableFormatted = formatWASS(totalClaimable);

  // Separate winnings (resolved markets) from refunds (closed/cancelled markets)
  const winnings = useMemo(() => {
    return rewards.filter((r) => r.isResolved);
  }, [rewards]);

  const refunds = useMemo(() => {
    return rewards.filter((r) => r.isClosed && !r.isResolved);
  }, [rewards]);

  const totalWinnings = useMemo(() => {
    return winnings.reduce((sum, r) => sum + r.claimableAmount, 0n);
  }, [winnings]);

  const totalRefunds = useMemo(() => {
    return refunds.reduce((sum, r) => sum + r.claimableAmount, 0n);
  }, [refunds]);

  const totalWinningsFormatted = formatWASS(totalWinnings);
  const totalRefundsFormatted = formatWASS(totalRefunds);

  return {
    rewards,
    winnings,
    refunds,
    totalClaimable,
    totalClaimableFormatted,
    totalWinnings,
    totalWinningsFormatted,
    totalRefunds,
    totalRefundsFormatted,
    marketsWithRewards: rewards.length,
    marketsWithWinnings: winnings.length,
    marketsWithRefunds: refunds.length,
    isLoading: totalLoading || claimableLoading || marketInfoLoading,
    error: claimableError?.message || null,
    refetch: refetchClaimable,
  };
}

// =============================================================================
// COMBINED HOOK: useTokenWarsPredictionMarketsV2
// =============================================================================

export interface UseTokenWarsPredictionMarketsV2Options {
  warId: string | null;
  userAddress?: `0x${string}`;
  autoRefresh?: boolean;
  pollInterval?: number;
}

export function useTokenWarsPredictionMarketsV2({
  warId,
  userAddress,
  autoRefresh = true,
  pollInterval = 10000,
}: UseTokenWarsPredictionMarketsV2Options) {
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  // Get markets for this war
  const {
    marketIds,
    markets,
    isLoading: marketsLoading,
    error: marketsError,
    refetch: refetchMarkets,
  } = useWarMarketsV2(warId);

  // Build contract calls for user positions
  const userPositionCalls = useMemo(() => {
    if (!userAddress || markets.length === 0) return [];
    return markets.map((market) => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: PREDICTION_MARKET_V2_ABI,
      functionName: "getUserMarketInfo" as const,
      args: [BigInt(market.marketId), userAddress] as const,
    }));
  }, [userAddress, markets]);

  // Fetch user positions for all markets in batch
  const {
    data: positionsData,
    isLoading: positionsLoading,
    error: positionsError,
    refetch: refetchPositions,
  } = useReadContracts({
    contracts: userPositionCalls,
    query: { enabled: userPositionCalls.length > 0 },
  });

  // Process user positions
  const userPositions = useMemo(() => {
    if (!positionsData || markets.length === 0) return [];
    return positionsData
      .map((result, index) => {
        if (result.status === "success" && result.result) {
          try {
            const market = markets[index];
            if (!market) return null;
            return processUserMarketInfo(market.marketId, result.result, market.marketType);
          } catch (err) {
            console.error("Error processing user position:", err);
            return null;
          }
        }
        return null;
      })
      .filter((pos): pos is UserMarketInfoV2 => {
        // Only include positions where user has shares or claimable amount
        if (!pos) return false;
        return pos.totalInvested > 0n || pos.claimableAmount > 0n;
      });
  }, [positionsData, markets]);

  // Derived market references
  const dexVoteMarket = useMemo(() =>
    markets.find((m) => m.marketType === MarketTypeV2.DexVote) || null,
    [markets]
  );
  const pairVoteMarket = useMemo(() =>
    markets.find((m) => m.marketType === MarketTypeV2.PairVote) || null,
    [markets]
  );
  const selloutMarket = useMemo(() =>
    markets.find((m) => m.marketType === MarketTypeV2.Sellout) || null,
    [markets]
  );

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !warId) return;

    const interval = setInterval(() => {
      refetchMarkets();
      refetchPositions();
      setLastUpdate(Date.now());
    }, pollInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, warId, pollInterval, refetchMarkets, refetchPositions]);

  const refresh = useCallback(() => {
    refetchMarkets();
    refetchPositions();
    setLastUpdate(Date.now());
  }, [refetchMarkets, refetchPositions]);

  return {
    // Market data
    marketIds,
    markets,
    dexVoteMarket,
    pairVoteMarket,
    selloutMarket,

    // User data
    userPositions,

    // State
    isLoading: marketsLoading || positionsLoading,
    error: marketsError?.message || positionsError?.message || null,
    lastUpdate,

    // Actions
    refresh,
    refetchPositions,
  };
}

export default useTokenWarsPredictionMarketsV2;
