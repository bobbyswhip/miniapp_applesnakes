import { useWriteContracts, useCallsStatus } from 'wagmi/experimental';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useState, useCallback, useEffect } from 'react';
import { useSmartWallet } from './useSmartWallet';
import { base } from 'wagmi/chains';
import type { Abi, Address } from 'viem';

// Coinbase Paymaster URL for sponsored (gasless) transactions
// Smart wallets use this to get gas fees paid by the app
const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;

// Debug: Log paymaster configuration on module load
if (typeof window !== 'undefined') {
  console.log('💳 Paymaster configured:', PAYMASTER_URL ? '✅ URL set' : '❌ No URL');
}

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface BatchTransactionResult {
  // Execute batch (for smart wallets) or sequential (for EOA)
  executeBatch: (calls: ContractCall[]) => Promise<void>;
  // Execute single transaction (always uses regular write)
  executeSingle: (call: ContractCall) => Promise<`0x${string}` | undefined>;
  // Status
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  // Hash(es)
  hash: `0x${string}` | undefined;
  batchId: string | undefined;
  // Smart wallet info
  isSmartWallet: boolean;
  supportsAtomicBatch: boolean;
  // Paymaster (sponsored gas) support
  supportsPaymaster: boolean;
  isSponsored: boolean;
  // Reset state
  reset: () => void;
}

/**
 * Hook for executing batched transactions on smart wallets,
 * with automatic fallback to sequential transactions for EOA wallets.
 *
 * Usage:
 * ```tsx
 * const { executeBatch, isPending, isSuccess, isSmartWallet } = useBatchTransaction();
 *
 * // For approve + action pattern:
 * await executeBatch([
 *   { address: tokenAddr, abi: erc20Abi, functionName: 'approve', args: [spender, amount] },
 *   { address: contractAddr, abi: contractAbi, functionName: 'stake', args: [tokenIds] }
 * ]);
 * ```
 */
export function useBatchTransaction(): BatchTransactionResult {
  const { isSmartWallet, supportsAtomicBatch, supportsPaymaster } = useSmartWallet();

  // Track if the last transaction was sponsored
  const [isSponsored, setIsSponsored] = useState(false);

  // State for tracking batch execution
  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [batchId, setBatchId] = useState<string | undefined>();

  // Wagmi experimental batch write (EIP-5792)
  const {
    writeContracts,
    data: writeContractsData,
    isPending: isBatchPending,
    error: batchError,
    reset: resetBatch,
  } = useWriteContracts();

  // Extract the ID from writeContractsData (it returns { id: string } or string depending on version)
  const callsId = writeContractsData
    ? typeof writeContractsData === 'string'
      ? writeContractsData
      : (writeContractsData as { id?: string })?.id
    : undefined;

  // Track batch status
  const { data: callsStatus } = useCallsStatus({
    id: callsId ?? '',
    query: {
      enabled: !!callsId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === 'success' || status === 'failure') return false;
        return 1000; // Poll every second until confirmed
      },
    },
  });

  // Regular write for sequential fallback
  const {
    writeContractAsync,
    data: singleHash,
    isPending: isSinglePending,
    error: singleError,
    reset: resetSingle,
  } = useWriteContract();

  const { isLoading: isSingleConfirming, isSuccess: isSingleSuccess } =
    useWaitForTransactionReceipt({ hash: singleHash });

  // Update state based on batch status
  useEffect(() => {
    if (callsStatus?.status === 'success') {
      setIsConfirming(false);
      setIsSuccess(true);
      // Get the transaction hash from receipts if available
      const receipts = callsStatus.receipts as Array<{ transactionHash?: `0x${string}` }> | undefined;
      if (receipts?.[0]?.transactionHash) {
        setHash(receipts[0].transactionHash);
      }
    } else if (callsStatus?.status === 'pending') {
      setIsConfirming(true);
    } else if (callsStatus?.status === 'failure') {
      setIsError(true);
      setIsConfirming(false);
    }
  }, [callsStatus]);

  // Handle batch error
  useEffect(() => {
    if (batchError) {
      setError(batchError);
      setIsError(true);
      setIsPending(false);
      setIsConfirming(false);
    }
  }, [batchError]);

  // Handle single tx completion
  useEffect(() => {
    if (isSingleSuccess && singleHash) {
      setHash(singleHash);
      setIsSuccess(true);
      setIsConfirming(false);
    }
  }, [isSingleSuccess, singleHash]);

  // Handle single tx error
  useEffect(() => {
    if (singleError) {
      setError(singleError);
      setIsError(true);
      setIsPending(false);
      setIsConfirming(false);
    }
  }, [singleError]);

  /**
   * Execute transactions as a batch (smart wallet) or sequentially (EOA)
   * If the wallet supports paymaster and a paymaster URL is configured,
   * gas fees will be sponsored (gasless transactions for users)
   */
  const executeBatch = useCallback(
    async (calls: ContractCall[]) => {
      setIsPending(true);
      setIsError(false);
      setError(null);
      setIsSuccess(false);
      setIsSponsored(false);

      try {
        if (supportsAtomicBatch && calls.length > 1) {
          // Smart wallet: use atomic batch
          // Check if paymaster is available for sponsored gas
          const usePaymaster = supportsPaymaster && PAYMASTER_URL;

          if (usePaymaster) {
            console.log('⛽ Using sponsored gas (paymaster) for', calls.length, 'transactions');
            console.log('📋 Contract addresses:', calls.map(c => `${c.functionName}@${c.address}`));
            console.log('🔗 Paymaster URL:', PAYMASTER_URL);
            setIsSponsored(true);
          } else {
            console.log('🔄 Using atomic batch for', calls.length, 'transactions');
            if (!supportsPaymaster) console.log('⚠️ Wallet does not support paymaster');
            if (!PAYMASTER_URL) console.log('⚠️ No paymaster URL configured');
          }

          // Build capabilities object with optional paymaster
          // Note: wagmi's writeContracts expects flat capabilities, not nested by chain ID
          // The paymaster URL is passed directly, not wrapped in chain-specific object
          const capabilities = usePaymaster
            ? {
                paymasterService: {
                  url: PAYMASTER_URL,
                },
              }
            : undefined;

          writeContracts({
            contracts: calls.map((call) => ({
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args as unknown[],
              value: call.value,
            })),
            ...(capabilities && { capabilities }),
          });

          setIsConfirming(true);
        } else {
          // EOA wallet: execute sequentially
          console.log('📝 Using sequential execution for', calls.length, 'transactions');

          for (let i = 0; i < calls.length; i++) {
            const call = calls[i];
            console.log(`Executing tx ${i + 1}/${calls.length}:`, call.functionName);

            const txHash = await writeContractAsync({
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args as unknown[],
              value: call.value,
            });

            setHash(txHash);

            // Wait a bit for state to propagate before next tx
            if (i < calls.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }

          setIsSuccess(true);
        }
      } catch (err) {
        console.error('Batch execution error:', err);
        setError(err as Error);
        setIsError(true);
      } finally {
        setIsPending(false);
      }
    },
    [supportsAtomicBatch, supportsPaymaster, writeContracts, writeContractAsync]
  );

  // Update batchId when writeContractsData changes
  useEffect(() => {
    if (callsId) {
      setBatchId(callsId);
    }
  }, [callsId]);

  /**
   * Execute a single transaction (bypasses batching)
   */
  const executeSingle = useCallback(
    async (call: ContractCall): Promise<`0x${string}` | undefined> => {
      setIsPending(true);
      setIsError(false);
      setError(null);

      try {
        const txHash = await writeContractAsync({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args as unknown[],
          value: call.value,
        });
        setHash(txHash);
        return txHash;
      } catch (err) {
        setError(err as Error);
        setIsError(true);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => {
    setIsPending(false);
    setIsConfirming(false);
    setIsSuccess(false);
    setIsError(false);
    setError(null);
    setHash(undefined);
    setBatchId(undefined);
    setIsSponsored(false);
    resetBatch();
    resetSingle();
  }, [resetBatch, resetSingle]);

  return {
    executeBatch,
    executeSingle,
    isPending: isPending || isBatchPending || isSinglePending,
    isConfirming: isConfirming || isSingleConfirming,
    isSuccess,
    isError,
    error,
    hash,
    batchId,
    isSmartWallet,
    supportsAtomicBatch,
    supportsPaymaster,
    isSponsored,
    reset,
  };
}
