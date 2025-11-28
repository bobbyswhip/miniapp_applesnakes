'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useBalance } from 'wagmi';
import { parseEther, formatEther, formatUnits } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI } from '@/config';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { useBatchTransaction, ContractCall } from '@/hooks/useBatchTransaction';
import { useTransactions } from '@/contexts/TransactionContext';
import { useNFTContext } from '@/contexts/NFTContext';

interface SwapWrapModalProps {
  isOpen: boolean;
  onClose: () => void;
  nftContractAddress: string;
}

type WizardStep = 1 | 2 | 3;

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
  const [ethNeeded, setEthNeeded] = useState<string>('0');
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [txStep, setTxStep] = useState<'idle' | 'pending' | 'confirming' | 'success' | 'error'>('idle');

  // Get ETH balance
  const { data: ethBalanceData } = useBalance({
    address: address,
    chainId: base.id,
  });

  // Get token balance
  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  // Get approval status for wrapper
  const { data: isApprovedData, refetch: refetchApproval } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: address && contracts.wrapper.address ? [address, contracts.wrapper.address] : undefined,
    chainId: base.id,
  });

  // Get wrap fee
  const { data: wrapFee } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getWrapFee',
    chainId: base.id,
  });

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';
  const tokenBalance = tokenBalanceData ? Number(formatUnits(tokenBalanceData as bigint, 18)) : 0;
  const hasOneToken = tokenBalance >= 1;
  const isApproved = Boolean(isApprovedData);
  const wrapFeeFormatted = wrapFee ? formatEther(BigInt(wrapFee as bigint)) : '0';

  // Determine starting step based on user's state
  useEffect(() => {
    if (isOpen) {
      if (hasOneToken && isApproved) {
        setCurrentStep(3); // Go straight to wrap
      } else if (hasOneToken) {
        setCurrentStep(2); // Skip swap, go to approve
      } else {
        setCurrentStep(1); // Start from swap
      }
      setTxStep('idle');
    }
  }, [isOpen, hasOneToken, isApproved]);

  // Calculate ETH needed for 1 token using quoter
  const fetchQuote = useCallback(async () => {
    if (!publicClient) return;

    setIsLoadingQuote(true);
    try {
      const probeAmount = parseEther('0.0001');

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

      const result = await publicClient.simulateContract({
        address: QUOTER_ADDRESS,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: poolKey,
            zeroForOne: true,
            exactAmount: BigInt(probeAmount.toString()),
            hookData: '0x',
          },
        ],
      });

      const [amountOut] = result.result as [bigint, bigint];
      const tokensForProbe = parseFloat(formatUnits(amountOut, 18));
      const ethPerToken = 0.0001 / tokensForProbe;
      const ethNeededForOne = ethPerToken * 1 * 1.15;

      setEthNeeded(ethNeededForOne.toFixed(8));
    } catch (error) {
      console.error('Quote error:', error);
      setEthNeeded('0.001');
    } finally {
      setIsLoadingQuote(false);
    }
  }, [publicClient, contracts.nft.address, contracts.nft.abi]);

  useEffect(() => {
    if (isOpen && currentStep === 1) {
      fetchQuote();
    }
  }, [isOpen, currentStep, fetchQuote]);

  // Handle batch transaction success
  useEffect(() => {
    if (isBatchSuccess) {
      setTxStep('success');
      refetchNFTs();
      refetchTokenBalance();
      refetchApproval();
      setTimeout(() => {
        resetBatch();
        setTxStep('idle');
      }, 3000);
    }
  }, [isBatchSuccess, refetchNFTs, refetchTokenBalance, refetchApproval, resetBatch]);

  // Handle single transaction success
  useEffect(() => {
    if (isSuccess && hash) {
      updateTransaction(hash, 'success');
      setTxStep('success');

      // Move to next step after success
      setTimeout(() => {
        if (currentStep === 1) {
          refetchTokenBalance();
          setCurrentStep(2);
          setTxStep('idle');
          resetWrite();
        } else if (currentStep === 2) {
          refetchApproval();
          setCurrentStep(3);
          setTxStep('idle');
          resetWrite();
        } else if (currentStep === 3) {
          refetchNFTs();
          refetchTokenBalance();
          // Stay on success state
        }
      }, 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, hash]);

  // Step 1: Swap ETH for Token
  const handleSwap = () => {
    if (!address || parseFloat(ethNeeded) <= 0) return;

    setTxStep('pending');
    const ethValue = parseEther(ethNeeded);

    writeContract({
      address: contracts.nft.address as `0x${string}`,
      abi: contracts.nft.abi,
      functionName: 'swap',
      args: [],
      value: ethValue,
    });
  };

  // Step 2: Approve Wrapper
  const handleApprove = () => {
    setTxStep('pending');

    writeContract({
      address: contracts.nft.address as `0x${string}`,
      abi: contracts.nft.abi,
      functionName: 'setApprovalForAll',
      args: [contracts.wrapper.address, true],
    });
  };

  // Step 3: Wrap Token to NFT
  const handleWrap = () => {
    setTxStep('pending');
    const fee = wrapFee ? BigInt(wrapFee as bigint) : 0n;

    writeContract({
      address: contracts.wrapper.address as `0x${string}`,
      abi: contracts.wrapper.abi,
      functionName: 'unwrapNFTs',
      args: [contracts.nft.address, BigInt(1)],
      value: fee,
    });
  };

  // Smart wallet batch all steps
  const handleBatchAll = async () => {
    if (!address) return;

    setTxStep('pending');
    const ethValue = parseEther(ethNeeded);
    const fee = wrapFee ? BigInt(wrapFee as bigint) : 0n;

    try {
      const calls: ContractCall[] = [];

      // Only add swap if user doesn't have tokens
      if (!hasOneToken) {
        calls.push({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'swap',
          args: [],
          value: ethValue,
        });
      }

      // Only add approve if not already approved
      if (!isApproved) {
        calls.push({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
          value: 0n,
        });
      }

      // Always add wrap
      calls.push({
        address: contracts.wrapper.address as `0x${string}`,
        abi: contracts.wrapper.abi,
        functionName: 'unwrapNFTs',
        args: [contracts.nft.address, BigInt(1)],
        value: fee,
      });

      await executeBatch(calls);
    } catch (error) {
      console.error('Batched transaction error:', error);
      setTxStep('error');
    }
  };

  const swapCost = parseFloat(ethNeeded);
  const wrapCost = parseFloat(wrapFeeFormatted);
  const totalCostFromStep1 = swapCost + wrapCost;
  const hasEnoughEthForSwap = parseFloat(ethBalance) >= swapCost;
  const hasEnoughEthForWrap = parseFloat(ethBalance) >= wrapCost;
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

  if (!isOpen) return null;

  // Step indicator component
  const StepIndicator = ({ stepNum, label, isActive, isComplete, isSkipped }: {
    stepNum: number;
    label: string;
    isActive: boolean;
    isComplete: boolean;
    isSkipped: boolean;
  }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 600,
          background: isComplete || isSkipped
            ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.9), rgba(22, 163, 74, 0.9))'
            : isActive
            ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.9), rgba(139, 92, 246, 0.9))'
            : 'rgba(75, 85, 99, 0.5)',
          color: '#fff',
          border: isActive ? '2px solid rgba(168, 85, 247, 0.8)' : '2px solid transparent',
          boxShadow: isActive ? '0 0 15px rgba(168, 85, 247, 0.5)' : 'none',
        }}
      >
        {stepNum}
      </div>
      <div style={{
        fontSize: 11,
        marginTop: 6,
        color: isActive ? 'rgba(168, 85, 247, 1)' : 'rgba(255, 255, 255, 0.5)',
        fontWeight: isActive ? 600 : 400,
        textAlign: 'center',
      }}>
        {isSkipped ? 'Skipped' : label}
      </div>
    </div>
  );

  // Determine step states
  const step1Complete = hasOneToken || currentStep > 1;
  const step1Skipped = hasOneToken && currentStep > 1;
  const step2Complete = isApproved || currentStep > 2;
  const step2Skipped = isApproved && currentStep > 2;
  const step3Complete = txStep === 'success' && currentStep === 3;

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
                  Wrap a token to receive a human
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
                Smart Wallet - All Steps in One Transaction
              </div>
            </div>
          )}

          {/* Step Progress Indicator */}
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 24, position: 'relative' }}>
            {/* Connecting line */}
            <div style={{
              position: 'absolute',
              top: 16,
              left: '16.66%',
              right: '16.66%',
              height: 2,
              background: 'rgba(75, 85, 99, 0.5)',
              zIndex: 0,
            }} />
            <div style={{
              position: 'absolute',
              top: 16,
              left: '16.66%',
              width: currentStep === 1 ? '0%' : currentStep === 2 ? '50%' : '100%',
              maxWidth: '66.66%',
              height: 2,
              background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.9), rgba(168, 85, 247, 0.9))',
              zIndex: 1,
              transition: 'width 0.3s ease',
            }} />

            <StepIndicator stepNum={1} label="Buy Token" isActive={currentStep === 1} isComplete={step1Complete} isSkipped={step1Skipped} />
            <StepIndicator stepNum={2} label="Approve" isActive={currentStep === 2} isComplete={step2Complete} isSkipped={step2Skipped} />
            <StepIndicator stepNum={3} label="Wrap NFT" isActive={currentStep === 3} isComplete={step3Complete} isSkipped={false} />
          </div>

          {/* Step Content */}
          <div
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.8)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              border: '1px solid rgba(75, 85, 99, 0.4)',
            }}
          >
            {/* Step 1: Buy Token */}
            {currentStep === 1 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
                  Step 1: Buy 1 Token
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 16 }}>
                  Swap ETH for 1 token from the liquidity pool. This token will be wrapped into your NFT.
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>You Pay</span>
                  <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                    Balance: {parseFloat(ethBalance).toFixed(4)} ETH
                  </span>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  borderRadius: 10,
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}>
                  <span style={{ fontSize: 20, fontWeight: 600, color: isLoadingQuote ? 'rgba(255,255,255,0.4)' : '#fff' }}>
                    {isLoadingQuote ? 'Loading...' : `${swapCost.toFixed(6)}`}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>Ξ</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>ETH</span>
                  </div>
                </div>

                {!hasEnoughEthForSwap && (
                  <div style={{ marginTop: 12, color: 'rgba(239, 68, 68, 1)', fontSize: 12, textAlign: 'center' }}>
                    Insufficient ETH balance
                  </div>
                )}
              </>
            )}

            {/* Step 2: Approve */}
            {currentStep === 2 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
                  Step 2: Approve Wrapper
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 16 }}>
                  Allow the wrapper contract to convert your token into an NFT. This is a one-time approval.
                </div>

                <div style={{
                  padding: '16px',
                  backgroundColor: 'rgba(168, 85, 247, 0.1)',
                  borderRadius: 10,
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  textAlign: 'center',
                }}>
                  
                  <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.7)' }}>
                    Approve wrapper contract
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', marginTop: 4 }}>
                    No ETH required for this step
                  </div>
                </div>

                <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
                  Your token balance: {tokenBalance.toFixed(4)} tokens
                </div>
              </>
            )}

            {/* Step 3: Wrap */}
            {currentStep === 3 && txStep !== 'success' && (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
                  Step 3: Wrap to NFT
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 16 }}>
                  Convert your token into a random human NFT from the collection.
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px',
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  borderRadius: 10,
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                }}>
                  
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>1 Human NFT</div>
                    <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
                      Random from the collection
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Wrap Fee:</span>
                  <span style={{ color: '#fff' }}>{wrapFeeFormatted} ETH</span>
                </div>

                {!hasEnoughEthForWrap && (
                  <div style={{ marginTop: 12, color: 'rgba(239, 68, 68, 1)', fontSize: 12, textAlign: 'center' }}>
                    Insufficient ETH for wrap fee
                  </div>
                )}
              </>
            )}

            {/* Success State */}
            {txStep === 'success' && currentStep === 3 && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                
                <div style={{ fontSize: 18, fontWeight: 600, color: 'rgba(34, 197, 94, 1)', marginBottom: 8 }}>
                  NFT Acquired!
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                  Your new human is waiting in your wallet
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {(writeError || batchError) && (
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
                {writeError?.message?.includes('User rejected') || batchError?.message?.includes('User rejected')
                  ? 'Transaction cancelled'
                  : 'Transaction failed. Please try again.'}
              </span>
            </div>
          )}

          {/* Action Button */}
          {txStep === 'success' && currentStep === 3 ? (
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
          ) : (
            <button
              onClick={() => {
                if (isBusy) return;

                // Smart wallet can batch everything
                if (supportsAtomicBatch && !hasOneToken) {
                  handleBatchAll();
                } else if (currentStep === 1) {
                  handleSwap();
                } else if (currentStep === 2) {
                  handleApprove();
                } else if (currentStep === 3) {
                  handleWrap();
                }
              }}
              disabled={isBusy || isLoadingQuote || (currentStep === 1 && !hasEnoughEthForSwap) || (currentStep === 3 && !hasEnoughEthForWrap)}
              style={{
                width: '100%',
                padding: 14,
                background: isBusy
                  ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                  : 'linear-gradient(135deg, rgba(168, 85, 247, 0.95), rgba(139, 92, 246, 0.95))',
                border: '2px solid rgba(168, 85, 247, 0.5)',
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                color: '#fff',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                opacity: isBusy || isLoadingQuote ? 0.7 : 1,
              }}
            >
              {isBusy ? (
                currentStep === 1 ? 'Swapping...' : currentStep === 2 ? 'Approving...' : 'Wrapping...'
              ) : isLoadingQuote ? (
                'Loading...'
              ) : supportsAtomicBatch && !hasOneToken ? (
                `Get NFT (${totalCostFromStep1.toFixed(5)} ETH)`
              ) : currentStep === 1 ? (
                `Buy Token (${swapCost.toFixed(5)} ETH)`
              ) : currentStep === 2 ? (
                'Approve Wrapper'
              ) : (
                `Wrap to NFT (${wrapFeeFormatted} ETH)`
              )}
            </button>
          )}

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
            href="https://opensea.io/collection/apple-snakes"
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
        </div>
      </div>
    </>
  );
}
