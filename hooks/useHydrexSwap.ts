// hooks/useHydrexSwap.ts
// Hook for swapping on Hydrex via KyberSwap aggregator

import { useState, useCallback } from 'react';
import { usePublicClient, useWriteContract, useSendTransaction } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { base } from 'wagmi/chains';
import {
  KYBERSWAP_ROUTER_ADDRESS,
  KYBERSWAP_NATIVE_TOKEN,
  getKyberSwapQuote,
  buildKyberSwapTransaction,
  type KyberSwapRouteSummary,
} from '@/abis/hydrexRouter';
import { ERC20_ABI } from '@/abis/erc20';

interface HydrexQuote {
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  gas: string;
  gasUsd: string;
  priceImpact: number;
  routeSummary: KyberSwapRouteSummary;
  routerAddress: string;
}

interface HydrexSwapParams {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  decimalsIn: number;
  decimalsOut: number;
  sender: `0x${string}`;
  recipient: `0x${string}`;
  slippageTolerance?: number; // basis points, default 50 (0.5%)
}

interface UseHydrexSwapReturn {
  // Quote
  quote: HydrexQuote | null;
  isQuoting: boolean;
  quoteError: string | null;
  getQuote: (params: Omit<HydrexSwapParams, 'sender' | 'recipient'>) => Promise<HydrexQuote | null>;

  // Approval
  needsApproval: boolean;
  isCheckingApproval: boolean;
  isApproving: boolean;
  approvalError: string | null;
  checkApproval: (tokenIn: `0x${string}`, amount: string, decimals: number, owner: `0x${string}`) => Promise<boolean>;
  approve: (tokenIn: `0x${string}`, owner: `0x${string}`) => Promise<`0x${string}` | null>;

  // Swap
  isSwapping: boolean;
  swapError: string | null;
  swapTxHash: `0x${string}` | null;
  executeSwap: (params: HydrexSwapParams) => Promise<`0x${string}` | null>;

  // Reset
  reset: () => void;
}

export function useHydrexSwap(): UseHydrexSwapReturn {
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync, reset: resetWrite } = useWriteContract();
  const { sendTransactionAsync, reset: resetSendTx } = useSendTransaction();

  // Quote state
  const [quote, setQuote] = useState<HydrexQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Approval state
  const [needsApproval, setNeedsApproval] = useState(false);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // Swap state
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<`0x${string}` | null>(null);

  // Get quote from KyberSwap
  const getQuote = useCallback(async (
    params: Omit<HydrexSwapParams, 'sender' | 'recipient'>
  ): Promise<HydrexQuote | null> => {
    const { tokenIn, tokenOut, amountIn, decimalsIn, decimalsOut } = params;

    if (!amountIn || parseFloat(amountIn) <= 0) {
      setQuote(null);
      return null;
    }

    setIsQuoting(true);
    setQuoteError(null);

    try {
      const amountInWei = parseUnits(amountIn, decimalsIn).toString();

      console.log('[Hydrex] Getting quote:', { tokenIn, tokenOut, amountIn, amountInWei });

      const response = await getKyberSwapQuote(tokenIn, tokenOut, amountInWei);

      if (response.code !== 0 || !response.data) {
        throw new Error(response.message || 'Failed to get quote');
      }

      const { routeSummary, routerAddress } = response.data;

      const amountOutFormatted = formatUnits(BigInt(routeSummary.amountOut), decimalsOut);

      // Calculate price impact from USD values if available
      let priceImpact = 0;
      if (routeSummary.amountInUsd && routeSummary.amountOutUsd) {
        const inUsd = parseFloat(routeSummary.amountInUsd);
        const outUsd = parseFloat(routeSummary.amountOutUsd);
        if (inUsd > 0) {
          priceImpact = ((inUsd - outUsd) / inUsd) * 100;
        }
      }

      const quoteResult: HydrexQuote = {
        amountOut: routeSummary.amountOut,
        amountOutFormatted,
        amountOutUsd: routeSummary.amountOutUsd,
        gas: routeSummary.gas,
        gasUsd: routeSummary.gasUsd,
        priceImpact,
        routeSummary,
        routerAddress,
      };

      console.log('[Hydrex] Quote result:', quoteResult);

      setQuote(quoteResult);
      setIsQuoting(false);
      return quoteResult;
    } catch (error) {
      console.error('[Hydrex] Quote error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get quote';
      setQuoteError(errorMessage);
      setQuote(null);
      setIsQuoting(false);
      return null;
    }
  }, []);

  // Check if approval is needed
  const checkApproval = useCallback(async (
    tokenIn: `0x${string}`,
    amount: string,
    decimals: number,
    owner: `0x${string}`
  ): Promise<boolean> => {
    // Native token doesn't need approval
    if (tokenIn.toLowerCase() === KYBERSWAP_NATIVE_TOKEN.toLowerCase() ||
        tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      setNeedsApproval(false);
      return false;
    }

    if (!publicClient) {
      return false;
    }

    setIsCheckingApproval(true);

    try {
      const amountWei = parseUnits(amount, decimals);

      const allowance = await publicClient.readContract({
        address: tokenIn,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner, KYBERSWAP_ROUTER_ADDRESS],
      }) as bigint;

      const needsApprovalResult = allowance < amountWei;

      console.log('[Hydrex] Approval check:', {
        allowance: formatUnits(allowance, decimals),
        needed: amount,
        needsApproval: needsApprovalResult,
      });

      setNeedsApproval(needsApprovalResult);
      setIsCheckingApproval(false);
      return needsApprovalResult;
    } catch (error) {
      console.error('[Hydrex] Approval check error:', error);
      setIsCheckingApproval(false);
      return false;
    }
  }, [publicClient]);

  // Approve token spending
  const approve = useCallback(async (
    tokenIn: `0x${string}`,
    owner: `0x${string}`
  ): Promise<`0x${string}` | null> => {
    setIsApproving(true);
    setApprovalError(null);

    try {
      // Approve max amount
      const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

      const hash = await writeContractAsync({
        address: tokenIn,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [KYBERSWAP_ROUTER_ADDRESS, maxUint256],
        chainId: base.id,
      });

      console.log('[Hydrex] Approval tx:', hash);

      setIsApproving(false);
      setNeedsApproval(false);
      return hash;
    } catch (error) {
      console.error('[Hydrex] Approval error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Approval failed';
      setApprovalError(errorMessage);
      setIsApproving(false);
      return null;
    }
  }, [writeContractAsync]);

  // Execute swap
  const executeSwap = useCallback(async (params: HydrexSwapParams): Promise<`0x${string}` | null> => {
    const { tokenIn, tokenOut, amountIn, decimalsIn, sender, recipient, slippageTolerance = 50 } = params;

    if (!quote?.routeSummary) {
      setSwapError('No quote available');
      return null;
    }

    setIsSwapping(true);
    setSwapError(null);
    setSwapTxHash(null);

    try {
      // Build the swap transaction
      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

      console.log('[Hydrex] Building swap tx:', { sender, recipient, slippageTolerance, deadline });

      const buildResponse = await buildKyberSwapTransaction(
        quote.routeSummary,
        sender,
        recipient,
        slippageTolerance,
        deadline
      );

      if (buildResponse.code !== 0 || !buildResponse.data) {
        throw new Error(buildResponse.message || 'Failed to build swap transaction');
      }

      const { data: encodedData, routerAddress } = buildResponse.data;

      console.log('[Hydrex] Swap tx built:', { routerAddress, dataLength: encodedData.length });

      // Determine value to send (for native token swaps)
      const isNativeIn = tokenIn.toLowerCase() === KYBERSWAP_NATIVE_TOKEN.toLowerCase() ||
                         tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      const value = isNativeIn ? parseUnits(amountIn, decimalsIn) : 0n;

      // Send the transaction with raw calldata using sendTransaction
      const hash = await sendTransactionAsync({
        to: routerAddress as `0x${string}`,
        data: encodedData as `0x${string}`,
        value,
      });

      console.log('[Hydrex] Swap tx submitted:', hash);

      setSwapTxHash(hash);
      setIsSwapping(false);
      return hash;
    } catch (error) {
      console.error('[Hydrex] Swap error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Swap failed';
      setSwapError(errorMessage);
      setIsSwapping(false);
      return null;
    }
  }, [quote, sendTransactionAsync]);

  // Reset all state
  const reset = useCallback(() => {
    setQuote(null);
    setIsQuoting(false);
    setQuoteError(null);
    setNeedsApproval(false);
    setIsCheckingApproval(false);
    setIsApproving(false);
    setApprovalError(null);
    setIsSwapping(false);
    setSwapError(null);
    setSwapTxHash(null);
    resetWrite();
    resetSendTx();
  }, [resetWrite, resetSendTx]);

  return {
    // Quote
    quote,
    isQuoting,
    quoteError,
    getQuote,

    // Approval
    needsApproval,
    isCheckingApproval,
    isApproving,
    approvalError,
    checkApproval,
    approve,

    // Swap
    isSwapping,
    swapError,
    swapTxHash,
    executeSwap,

    // Reset
    reset,
  };
}

export default useHydrexSwap;
