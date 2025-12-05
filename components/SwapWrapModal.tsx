'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useBalance } from 'wagmi';
import { parseEther, formatEther, formatUnits } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI, OPENSEA_COLLECTION_URL } from '@/config';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { useBatchTransaction, ContractCall } from '@/hooks/useBatchTransaction';
import { useTransactions } from '@/contexts/TransactionContext';
import { useNFTContext } from '@/contexts/NFTContext';
import { ERC20_ABI } from '@/abis/erc20';
import type { Abi } from 'viem';

interface SwapWrapModalProps {
  isOpen: boolean;
  onClose: () => void;
  nftContractAddress: string;
}

type PaymentMethod = 'eth' | 'wass';

// Default estimate per NFT (used while loading accurate quote)
const DEFAULT_ETH_PER_NFT = 0.0012; // ~0.0012 ETH per NFT as initial estimate

export function SwapWrapModal({ isOpen, onClose }: SwapWrapModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);
  const { addTransaction: _addTransaction, updateTransaction } = useTransactions();
  const { refetch: refetchNFTs } = useNFTContext();

  // Smart wallet detection for batch transactions
  const { supportsAtomicBatch, isSmartWallet } = useSmartWallet();
  const {
    executeBatch,
    isPending: isBatchPending,
    isConfirming: isBatchConfirming,
    isSuccess: isBatchSuccess,
    error: batchError,
    reset: resetBatch,
  } = useBatchTransaction();

  // Regular write contract for EOA
  const {
    writeContract,
    data: hash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // State
  const [nftCount, setNftCount] = useState<number>(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('eth');
  const [ethNeeded, setEthNeeded] = useState<string>((DEFAULT_ETH_PER_NFT).toFixed(6));
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [quoteReady, setQuoteReady] = useState(false);
  const [txStep, setTxStep] = useState<'idle' | 'pending' | 'confirming' | 'success' | 'error' | 'cancelled'>('idle');

  // Cache for quotes to make switching counts faster
  const quoteCache = useRef<Map<number, string>>(new Map());

  // Get ETH balance
  const { data: ethBalanceData } = useBalance({
    address: address,
    chainId: base.id,
  });

  // Get wASS token balance
  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  // Get wASS approval status for wrapper contract (for wASS payment method)
  const { data: wassApprovalData, refetch: refetchWassApproval } = useReadContract({
    address: contracts.token.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && contracts.wrapper.address ? [address, contracts.wrapper.address] : undefined,
    chainId: base.id,
  });

  // Get wrap fee from wrapper contract
  const { data: wrapFeeData } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getWrapFee',
    chainId: base.id,
  });

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';
  const tokenBalance = tokenBalanceData ? Number(formatUnits(tokenBalanceData as bigint, 18)) : 0;
  const wassApproved = wassApprovalData ? (wassApprovalData as bigint) >= parseEther(nftCount.toString()) : false;
  const wrapFee = wrapFeeData ? BigInt(wrapFeeData as bigint) : 0n;
  const wrapFeeFormatted = formatEther(wrapFee);
  const hasEnoughWass = tokenBalance >= nftCount;

  // Set initial estimate immediately when count changes
  useEffect(() => {
    // Check cache first
    const cached = quoteCache.current.get(nftCount);
    if (cached) {
      setEthNeeded(cached);
      setQuoteReady(true);
    } else {
      // Use estimate while fetching
      const estimate = (DEFAULT_ETH_PER_NFT * nftCount).toFixed(6);
      setEthNeeded(estimate);
      setQuoteReady(false);
    }
  }, [nftCount]);

  // Calculate ETH needed for NFT purchase using V4 quoter (background fetch)
  const fetchQuote = useCallback(async () => {
    if (!publicClient || nftCount <= 0) return;

    // Check cache
    const cached = quoteCache.current.get(nftCount);
    if (cached) {
      setEthNeeded(cached);
      setQuoteReady(true);
      return;
    }

    setIsLoadingQuote(true);
    try {
      // Get unwrap fee from OTC contract's quoteBuyNFT
      const quoteBuyNFTResult = await publicClient.readContract({
        address: contracts.otc.address as `0x${string}`,
        abi: contracts.otc.abi,
        functionName: 'quoteBuyNFT',
        args: [BigInt(nftCount)],
      }) as [bigint, bigint];

      const [unwrapFeeFromContract, tokensNeeded] = quoteBuyNFTResult;

      // Now get ETH needed for the tokens using V4 quoter
      // First, get pool info from NFT contract
      const [poolIdRaw, hookAddress] = await Promise.all([
        publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'poolIdRaw',
          args: [],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'hook',
          args: [],
        }) as Promise<`0x${string}`>,
      ]);

      // Get the full PoolKey from the hook contract
      const poolKey = await publicClient.readContract({
        address: hookAddress,
        abi: [
          {
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [
              {
                components: [
                  { internalType: 'address', name: 'currency0', type: 'address' },
                  { internalType: 'address', name: 'currency1', type: 'address' },
                  { internalType: 'uint24', name: 'fee', type: 'uint24' },
                  { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
                  { internalType: 'address', name: 'hooks', type: 'address' },
                ],
                internalType: 'tuple',
                name: '',
                type: 'tuple',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        functionName: 'getPoolKey',
        args: [poolIdRaw],
      }) as unknown as {
        currency0: `0x${string}`;
        currency1: `0x${string}`;
        fee: number;
        tickSpacing: number;
        hooks: `0x${string}`;
      };

      // Use quoteExactOutputSingle to get exact ETH needed for the tokens
      // This is more accurate than probe-based estimation
      const result = await publicClient.simulateContract({
        address: QUOTER_ADDRESS,
        abi: QUOTER_ABI,
        functionName: 'quoteExactOutputSingle',
        args: [
          {
            poolKey: poolKey,
            zeroForOne: true, // ETH -> Token (we want ETH input for token output)
            exactAmount: tokensNeeded, // Exact tokens we need
            hookData: '0x',
          },
        ],
      });

      const [ethRequired] = result.result as [bigint, bigint];

      // Add 5% buffer for price movement and OTC fee
      // This prevents reverts during volatile periods
      const ethForTokens = parseFloat(formatEther(ethRequired)) * 1.05;

      // Total = ETH for swap + unwrap fee
      const totalEth = ethForTokens + parseFloat(formatEther(unwrapFeeFromContract));
      const totalEthStr = totalEth.toFixed(6);

      // Cache the result
      quoteCache.current.set(nftCount, totalEthStr);

      setEthNeeded(totalEthStr);
      setQuoteReady(true);
    } catch (error) {
      console.error('Quote error:', error);
      // Keep the estimate on error
      setQuoteReady(true); // Mark as ready so user can still proceed
    } finally {
      setIsLoadingQuote(false);
    }
  }, [publicClient, nftCount, contracts.otc.address, contracts.otc.abi, contracts.nft.address, contracts.nft.abi]);

  // Fetch quote when modal opens or count changes (in background)
  useEffect(() => {
    if (isOpen && paymentMethod === 'eth') {
      fetchQuote();
    }
  }, [isOpen, nftCount, paymentMethod, fetchQuote]);

  // Handle batch transaction success
  useEffect(() => {
    if (isBatchSuccess) {
      setTxStep('success');
      refetchNFTs();
      refetchTokenBalance();
      refetchWassApproval();
      setTimeout(() => {
        resetBatch();
      }, 3000);
    }
  }, [isBatchSuccess, refetchNFTs, refetchTokenBalance, refetchWassApproval, resetBatch]);

  // Handle single transaction success
  useEffect(() => {
    if (isSuccess && hash) {
      updateTransaction(hash, 'success');
      setTxStep('success');
      refetchNFTs();
      refetchTokenBalance();
      refetchWassApproval();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, hash]);

  // Handle transaction errors - set to cancelled state (allows retry)
  useEffect(() => {
    if (writeError || batchError) {
      setTxStep('cancelled');
    }
  }, [writeError, batchError]);

  // ===== ETH PAYMENT: One-Click Buy using buyNFT =====
  const handleBuyWithEth = () => {
    if (!address || parseFloat(ethNeeded) <= 0) return;

    setTxStep('pending');
    // Send 5% extra ETH to prevent reverts during price movements
    // Contract will refund any unused ETH
    const ethWithBuffer = parseFloat(ethNeeded) * 1.05;
    const ethValue = parseEther(ethWithBuffer.toFixed(18));

    // Calculate minimum tokens expected (with 15% slippage tolerance)
    const minWassOut = parseEther((nftCount * 0.85).toString());

    // Single call to buyNFT - handles swap + unwrap internally
    writeContract({
      address: contracts.otc.address as `0x${string}`,
      abi: contracts.otc.abi,
      functionName: 'buyNFT',
      args: [BigInt(nftCount), minWassOut],
      value: ethValue,
    });
  };

  // ===== wASS PAYMENT: Approve + Unwrap =====
  const handleBuyWithWass = async () => {
    if (!address || !hasEnoughWass) return;

    setTxStep('pending');
    const fee = wrapFee * BigInt(nftCount);

    try {
      // Smart wallet: batch approve + unwrap if needed
      if (supportsAtomicBatch) {
        const calls: ContractCall[] = [];

        // Add approval if not already approved
        if (!wassApproved) {
          calls.push({
            address: contracts.token.address as `0x${string}`,
            abi: ERC20_ABI as Abi,
            functionName: 'approve',
            args: [contracts.wrapper.address, parseEther('1000000')], // Approve max
            value: 0n,
          });
        }

        // Add unwrap call
        calls.push({
          address: contracts.wrapper.address as `0x${string}`,
          abi: contracts.wrapper.abi as Abi,
          functionName: 'unwrapNFTs',
          args: [contracts.nft.address, BigInt(nftCount)],
          value: fee,
        });

        await executeBatch(calls);
      } else {
        // EOA: need to do approval first if needed
        if (!wassApproved) {
          // For EOA without batching, we'd need a multi-step flow
          // For simplicity, just show they need to approve first
          writeContract({
            address: contracts.token.address as `0x${string}`,
            abi: ERC20_ABI as Abi,
            functionName: 'approve',
            args: [contracts.wrapper.address, parseEther('1000000')],
          });
          return;
        }

        // Already approved, do the unwrap
        writeContract({
          address: contracts.wrapper.address as `0x${string}`,
          abi: contracts.wrapper.abi,
          functionName: 'unwrapNFTs',
          args: [contracts.nft.address, BigInt(nftCount)],
          value: fee,
        });
      }
    } catch (error) {
      console.error('wASS purchase error:', error);
      setTxStep('error');
    }
  };

  const totalEthCost = parseFloat(ethNeeded);
  const totalWassCost = nftCount; // 1 wASS per NFT
  const totalWrapFee = parseFloat(wrapFeeFormatted) * nftCount;
  const hasEnoughEth = parseFloat(ethBalance) >= totalEthCost;
  const hasEnoughEthForWrapFee = parseFloat(ethBalance) >= totalWrapFee;
  const isTransactionPending = isWritePending || isBatchPending;
  const isTransactionConfirming = isConfirming || isBatchConfirming;
  const isBusy = isTransactionPending || isTransactionConfirming || txStep === 'pending';

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTxStep('idle');
      setNftCount(1);
      setQuoteReady(false);
      resetWrite();
      resetBatch();
    }
  }, [isOpen, resetWrite, resetBatch]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full"
          style={{
            maxWidth: '480px',
            maxHeight: '85vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.05), rgba(236, 72, 153, 0.08), rgba(139, 92, 246, 0.05))',
            backgroundColor: 'rgba(17, 24, 39, 0.98)',
            border: '2px solid rgba(168, 85, 247, 0.3)',
            borderRadius: '16px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(168, 85, 247, 0.3), 0 0 100px rgba(236, 72, 153, 0.2)',
            padding: 'clamp(16px, 4vw, 24px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, rgba(168, 85, 247, 1), rgba(236, 72, 153, 1))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Get Your NFT
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                  {paymentMethod === 'wass' ? 'wASS can be unwrapped to get NFTs' : 'One-click purchase from the collection'}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: 24,
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              ✕
            </button>
          </div>

          {/* Smart Wallet Badge */}
          {isSmartWallet && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <div
                style={{
                  padding: '6px 14px',
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))',
                  border: '1px solid rgba(6, 182, 212, 0.5)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'rgba(6, 182, 212, 1)',
                }}
              >
                Smart Wallet Detected
              </div>
            </div>
          )}

          {/* Success State */}
          {txStep === 'success' ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'rgba(34, 197, 94, 1)', marginBottom: 8 }}>
                NFT{nftCount > 1 ? 's' : ''} Acquired!
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 24 }}>
                Your new human{nftCount > 1 ? 's are' : ' is'} waiting in your wallet
              </div>
              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: 14,
                  background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))',
                  border: '2px solid rgba(34, 197, 94, 0.5)',
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* NFT Count Selector */}
              <div
                style={{
                  backgroundColor: 'rgba(17, 24, 39, 0.8)',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                  border: '1px solid rgba(75, 85, 99, 0.4)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
                  How many NFTs?
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 5, 10].map((count) => (
                    <button
                      key={count}
                      onClick={() => setNftCount(count)}
                      disabled={isBusy}
                      style={{
                        flex: '1 1 auto',
                        minWidth: 50,
                        padding: '10px 16px',
                        background: nftCount === count
                          ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.9), rgba(139, 92, 246, 0.9))'
                          : 'rgba(75, 85, 99, 0.3)',
                        border: nftCount === count
                          ? '2px solid rgba(168, 85, 247, 0.8)'
                          : '2px solid rgba(75, 85, 99, 0.4)',
                        borderRadius: 10,
                        fontSize: 16,
                        fontWeight: 600,
                        color: '#fff',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment Method Toggle */}
              <div
                style={{
                  backgroundColor: 'rgba(17, 24, 39, 0.8)',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                  border: '1px solid rgba(75, 85, 99, 0.4)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
                  Payment Method
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setPaymentMethod('eth')}
                    disabled={isBusy}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: paymentMethod === 'eth'
                        ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.9))'
                        : 'rgba(75, 85, 99, 0.3)',
                      border: paymentMethod === 'eth'
                        ? '2px solid rgba(59, 130, 246, 0.8)'
                        : '2px solid rgba(75, 85, 99, 0.4)',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#fff',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div>ETH</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>One-Click Buy</div>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('wass')}
                    disabled={isBusy || !hasEnoughWass}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: paymentMethod === 'wass'
                        ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.9), rgba(22, 163, 74, 0.9))'
                        : 'rgba(75, 85, 99, 0.3)',
                      border: paymentMethod === 'wass'
                        ? '2px solid rgba(34, 197, 94, 0.8)'
                        : '2px solid rgba(75, 85, 99, 0.4)',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#fff',
                      cursor: (isBusy || !hasEnoughWass) ? 'not-allowed' : 'pointer',
                      opacity: hasEnoughWass ? 1 : 0.5,
                      transition: 'all 0.2s',
                    }}
                  >
                    <div>wASS</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                      {hasEnoughWass ? `${tokenBalance.toFixed(2)} available` : 'Need more tokens'}
                    </div>
                  </button>
                </div>
              </div>

              {/* Cost Breakdown */}
              <div
                style={{
                  backgroundColor: 'rgba(17, 24, 39, 0.8)',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                  border: '1px solid rgba(75, 85, 99, 0.4)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
                  Cost Breakdown
                </div>

                {paymentMethod === 'eth' ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                        {nftCount} NFT{nftCount > 1 ? 's' : ''} (swap + unwrap)
                      </span>
                      <span style={{ fontSize: 13, color: '#fff', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {totalEthCost.toFixed(6)} ETH
                        {isLoadingQuote && (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 12,
                              height: 12,
                              border: '2px solid rgba(168, 85, 247, 0.3)',
                              borderTopColor: 'rgba(168, 85, 247, 1)',
                              borderRadius: '50%',
                              animation: 'spin 1s linear infinite',
                            }}
                          />
                        )}
                      </span>
                    </div>
                    <div
                      style={{
                        borderTop: '1px solid rgba(75, 85, 99, 0.4)',
                        paddingTop: 8,
                        marginTop: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Total</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(168, 85, 247, 1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {totalEthCost.toFixed(6)} ETH
                        {isLoadingQuote && !quoteReady && (
                          <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)' }}>(est)</span>
                        )}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', marginTop: 8 }}>
                      Balance: {parseFloat(ethBalance).toFixed(4)} ETH
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                        {nftCount} NFT{nftCount > 1 ? 's' : ''} ({totalWassCost} wASS)
                      </span>
                      <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>
                        {totalWassCost} wASS
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                        Wrap Fee
                      </span>
                      <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>
                        {totalWrapFee.toFixed(6)} ETH
                      </span>
                    </div>
                    <div
                      style={{
                        borderTop: '1px solid rgba(75, 85, 99, 0.4)',
                        paddingTop: 8,
                        marginTop: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Total</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(34, 197, 94, 1)' }}>
                          {totalWassCost} wASS + {totalWrapFee.toFixed(6)} ETH
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', marginTop: 8 }}>
                      wASS Balance: {tokenBalance.toFixed(2)} | ETH Balance: {parseFloat(ethBalance).toFixed(4)}
                    </div>
                    {!wassApproved && paymentMethod === 'wass' && (
                      <div style={{
                        fontSize: 11,
                        color: 'rgba(251, 191, 36, 1)',
                        marginTop: 8,
                        padding: '8px',
                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
                        borderRadius: 6,
                      }}>
                        {supportsAtomicBatch
                          ? '✨ Approval will be batched with purchase (one click!)'
                          : '⚠️ Requires approval transaction first'}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Insufficient Balance Warning */}
              {paymentMethod === 'eth' && !hasEnoughEth && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: 12,
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 10,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ color: 'rgba(239, 68, 68, 1)', fontSize: 12 }}>
                    Insufficient ETH balance. Need {totalEthCost.toFixed(6)} ETH
                  </span>
                </div>
              )}

              {paymentMethod === 'wass' && !hasEnoughEthForWrapFee && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: 12,
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 10,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ color: 'rgba(239, 68, 68, 1)', fontSize: 12 }}>
                    Insufficient ETH for wrap fee. Need {totalWrapFee.toFixed(6)} ETH
                  </span>
                </div>
              )}

              {/* Action Button - Never blocked by loading */}
              <button
                onClick={() => {
                  if (isBusy) return;
                  // Reset errors on retry
                  if (txStep === 'cancelled') {
                    resetWrite();
                    resetBatch();
                    setTxStep('idle');
                  }
                  if (paymentMethod === 'eth') {
                    handleBuyWithEth();
                  } else {
                    handleBuyWithWass();
                  }
                }}
                disabled={
                  isBusy ||
                  (paymentMethod === 'eth' && !hasEnoughEth) ||
                  (paymentMethod === 'wass' && (!hasEnoughWass || !hasEnoughEthForWrapFee))
                }
                style={{
                  width: '100%',
                  padding: 16,
                  background: isBusy
                    ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                    : txStep === 'cancelled'
                    ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.95))'
                    : paymentMethod === 'eth'
                    ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95))'
                    : 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))',
                  border: txStep === 'cancelled'
                    ? '2px solid rgba(251, 191, 36, 0.5)'
                    : paymentMethod === 'eth'
                    ? '2px solid rgba(59, 130, 246, 0.5)'
                    : '2px solid rgba(34, 197, 94, 0.5)',
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#fff',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                  opacity: isBusy ? 0.7 : 1,
                }}
              >
                {isBusy ? (
                  paymentMethod === 'eth' ? 'Buying NFT...' : 'Processing...'
                ) : txStep === 'cancelled' ? (
                  'Click to try again'
                ) : paymentMethod === 'eth' ? (
                  <>
                    Buy {nftCount} NFT{nftCount > 1 ? 's' : ''} for {totalEthCost.toFixed(5)} ETH
                    {isLoadingQuote && <span style={{ opacity: 0.7 }}> (updating...)</span>}
                  </>
                ) : !wassApproved ? (
                  supportsAtomicBatch
                    ? `Approve & Buy ${nftCount} NFT${nftCount > 1 ? 's' : ''}`
                    : 'Approve wASS First'
                ) : (
                  `Buy ${nftCount} NFT${nftCount > 1 ? 's' : ''} with wASS`
                )}
              </button>

              {/* Transaction Hash */}
              {hash && (
                <a
                  href={`https://basescan.org/tx/${hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    marginTop: 12,
                    padding: 10,
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    borderRadius: 8,
                    fontSize: 11,
                    color: 'rgba(168, 85, 247, 0.9)',
                    textAlign: 'center',
                    textDecoration: 'none',
                  }}
                >
                  View Transaction
                </a>
              )}

              {/* View Collection Link */}
              <a
                href={OPENSEA_COLLECTION_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  marginTop: 12,
                  padding: 10,
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'rgba(59, 130, 246, 0.9)',
                  textAlign: 'center',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                View Collection on OpenSea
              </a>

              {/* CSS for spinner animation */}
              <style jsx>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </>
          )}
        </div>
      </div>
    </>
  );
}
