'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance, usePublicClient } from 'wagmi';
import { formatEther, parseEther, formatUnits } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI } from '@/config';
import { useNFTContext } from '@/contexts/NFTContext';
import { useTransactions } from '@/contexts/TransactionContext';
import { useWTokensNFTs } from '@/hooks/useWTokensNFTs';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { useBatchTransaction, ContractCall } from '@/hooks/useBatchTransaction';

type WizardStep = 1 | 2 | 3;

export default function WrapPage() {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { nfts, isLoading, error: _error, refetch: refetchNFTs } = useNFTContext();
  const contracts = getContracts(base.id);
  const { addTransaction, updateTransaction } = useTransactions();

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

  const [selectedNFTs, setSelectedNFTs] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<'get-nft' | 'wrap' | 'swap'>('get-nft');

  // Swap mode state
  const [selectedUserNFT, setSelectedUserNFT] = useState<number | null>(null);
  const [selectedWTokenNFT, setSelectedWTokenNFT] = useState<number | null>(null);

  // Fetch wTokens NFTs (secondary data, loads after user NFTs)
  const {
    nfts: wTokensNFTs,
    isLoading: wTokensLoading,
    error: _wTokensError,
    refetch: refetchWTokensNFTs,
    totalHeld: wTokensTotalHeld
  } = useWTokensNFTs(true, isLoading);

  const [currentOperation, setCurrentOperation] = useState<'approve' | 'wrap' | 'unwrap' | 'swap' | 'buy' | null>(null);
  const [wrappedNFTs, setWrappedNFTs] = useState<Set<number>>(new Set()); // Track wrapped NFTs for instant UI update
  const [operationByHash, setOperationByHash] = useState<Record<string, 'approve' | 'wrap' | 'unwrap' | 'swap' | 'buy'>>({});
  const [pendingWrapNFTs, setPendingWrapNFTs] = useState<Set<number>>(new Set()); // Track NFTs being wrapped (for error recovery)

  // Get NFT wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [txStep, setTxStep] = useState<'idle' | 'pending' | 'confirming' | 'success' | 'error'>('idle');
  const [ethNeeded, setEthNeeded] = useState<string>('0');
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Get ETH balance
  const { data: ethBalanceData } = useBalance({
    address: address,
    chainId: base.id,
  });

  // Read wrap fee
  const { data: wrapFee } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getWrapFee',
    chainId: base.id,
  });

  // Read approval status
  const { data: isApproved, refetch: refetchApproval } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: address && contracts.wrapper.address ? [address, contracts.wrapper.address] : undefined,
    chainId: base.id,
  });

  // Read wToken balance
  const { data: wTokenBalance, refetch: refetchWTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  // Read swap fee
  const { data: swapFee } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getSwapFee',
    chainId: base.id,
  });

  // Direct read of held NFTs from contract - more reliable than waiting for full metadata load
  const { data: heldNFTsData, isLoading: heldNFTsLoading, refetch: refetchHeldNFTs } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getHeldNFTs',
    args: [contracts.nft.address, BigInt(0), BigInt(1)], // Just get the first one
    chainId: base.id,
  });

  // Get the next NFT token ID directly from contract read (FIFO order)
  const nextTokenId = heldNFTsData &&
    (heldNFTsData as { tokenIds: readonly bigint[] }).tokenIds?.length > 0
    ? Number((heldNFTsData as { tokenIds: readonly bigint[] }).tokenIds[0])
    : null;

  // Get image URL from wTokensNFTs if available, otherwise we'll construct it
  const nextNFTFromPool = wTokensNFTs.find(nft => nft.tokenId === nextTokenId);
  const nextNFTImageUrl = nextNFTFromPool?.imageUrl ?? null;

  // Loading state: either waiting for contract read OR have token ID but no image yet
  const isLoadingNextNFT = heldNFTsLoading || (nextTokenId !== null && !nextNFTImageUrl && wTokensLoading);

  // Fallback: fetch metadata directly for next NFT if we have ID but not image
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [isFetchingFallback, setIsFetchingFallback] = useState(false);

  useEffect(() => {
    // Only fetch if we have a token ID but no image from the pool
    if (nextTokenId !== null && !nextNFTImageUrl && !fallbackImageUrl && !isFetchingFallback && publicClient) {
      setIsFetchingFallback(true);

      const fetchMetadata = async () => {
        try {
          // Get tokenURI from contract
          const tokenURI = await publicClient.readContract({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'tokenURI',
            args: [BigInt(nextTokenId)],
          }) as string;

          if (tokenURI) {
            const ipfsUrl = tokenURI.replace('ipfs://', 'https://surrounding-amaranth-catshark.myfilebase.com/ipfs/');
            const response = await fetch(ipfsUrl);
            const metadata = await response.json();

            let imageUrl = metadata.image || '';
            if (imageUrl.startsWith('ipfs://')) {
              imageUrl = imageUrl.replace('ipfs://', '');
            } else if (imageUrl.startsWith('https://') || imageUrl.startsWith('http://')) {
              const ipfsMatch = imageUrl.match(/\/ipfs\/([^/]+)/);
              if (ipfsMatch) imageUrl = ipfsMatch[1];
            }

            setFallbackImageUrl(imageUrl);
          }
        } catch (err) {
          console.error('Failed to fetch fallback metadata:', err);
        } finally {
          setIsFetchingFallback(false);
        }
      };

      fetchMetadata();
    }
  }, [nextTokenId, nextNFTImageUrl, fallbackImageUrl, isFetchingFallback, publicClient, contracts.nft.address, contracts.nft.abi]);

  // Reset fallback when token ID changes
  useEffect(() => {
    setFallbackImageUrl(null);
  }, [nextTokenId]);

  // Final image URL - use pool data if available, otherwise fallback
  const finalNFTImageUrl = nextNFTImageUrl || fallbackImageUrl;
  const isLoadingImage = isLoadingNextNFT || (nextTokenId !== null && !finalNFTImageUrl && isFetchingFallback);

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';
  const wTokenBalanceFormatted = wTokenBalance ? Number(formatUnits(wTokenBalance as bigint, 18)) : 0;
  const hasOneToken = wTokenBalanceFormatted >= 1;
  const isApprovedBool = Boolean(isApproved);
  const wrapFeeFormatted = wrapFee ? formatEther(BigInt(wrapFee as bigint)) : '0';

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
      const ethNeededForOne = ethPerToken * 1 * 1.15; // 15% slippage

      setEthNeeded(ethNeededForOne.toFixed(8));
    } catch (error) {
      console.error('Quote error:', error);
      setEthNeeded('0.001');
    } finally {
      setIsLoadingQuote(false);
    }
  }, [publicClient, contracts.nft.address, contracts.nft.abi]);

  // Determine starting step based on user's state
  useEffect(() => {
    if (mode === 'get-nft' && isConnected) {
      if (hasOneToken && isApprovedBool) {
        setCurrentStep(3); // Go straight to wrap
      } else if (hasOneToken) {
        setCurrentStep(2); // Skip swap, go to approve
      } else {
        setCurrentStep(1); // Start from swap
      }
      setTxStep('idle');
    }
  }, [mode, isConnected, hasOneToken, isApprovedBool]);

  // Fetch quote when on step 1
  useEffect(() => {
    if (mode === 'get-nft' && currentStep === 1 && isConnected) {
      fetchQuote();
    }
  }, [mode, currentStep, isConnected, fetchQuote]);

  // Toggle NFT selection
  const toggleNFT = (tokenId: number) => {
    const newSelected = new Set(selectedNFTs);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      newSelected.add(tokenId);
    }
    setSelectedNFTs(newSelected);
  };

  // Select all
  const handleSelectAll = () => {
    setSelectedNFTs(new Set(displayedNFTs.map(nft => nft.tokenId)));
  };

  // Unselect all
  const handleUnselectAll = () => {
    setSelectedNFTs(new Set());
  };

  // Track transaction status
  useEffect(() => {
    if (hash && currentOperation) {
      const descriptions: Record<string, string> = {
        approve: 'Approving NFT wrapper',
        wrap: `Wrapping ${selectedNFTs.size} NFT${selectedNFTs.size > 1 ? 's' : ''}`,
        unwrap: 'Getting your NFT',
        swap: `Swapping NFT #${selectedUserNFT} for #${selectedWTokenNFT}`,
        buy: 'Buying token',
      };

      // Store operation type by hash for success handler
      setOperationByHash(prev => ({ ...prev, [hash]: currentOperation }));

      // Add transaction when hash is available
      addTransaction(hash, descriptions[currentOperation]);

      // Clear operation immediately for wrap so user can wrap again
      if (currentOperation === 'wrap') {
        setCurrentOperation(null);
      }
    }
  }, [hash, currentOperation, selectedNFTs.size, addTransaction, selectedUserNFT, selectedWTokenNFT]);

  // Update transaction status
  useEffect(() => {
    if (hash && isSuccess) {
      const operation = operationByHash[hash];
      if (operation) {
        updateTransaction(hash, 'success');
        setTxStep('success');

        // Refetch approval status after approval succeeds
        if (operation === 'approve') {
          refetchApproval();
          setTimeout(() => {
            setCurrentStep(3);
            setTxStep('idle');
            resetWrite();
            setCurrentOperation(null);
          }, 2000);
        }

        // On buy: move to approve step
        if (operation === 'buy') {
          refetchWTokenBalance();
          setTimeout(() => {
            setCurrentStep(2);
            setTxStep('idle');
            resetWrite();
            setCurrentOperation(null);
          }, 2000);
        }

        // On wrap: just refetch wToken balance (UI already updated immediately)
        if (operation === 'wrap') {
          refetchWTokenBalance();
          setPendingWrapNFTs(new Set()); // Clear pending wrap NFTs on success
        }

        // On unwrap: full NFT refetch to see what the user got
        if (operation === 'unwrap') {
          refetchNFTs();
          refetchWTokenBalance();
          refetchWTokensNFTs(); // Refresh for next NFT preview
          setWrappedNFTs(new Set()); // Clear wrapped NFTs tracking
          // Keep success state visible
        }

        // On swap: refetch both user NFTs and wTokens NFTs
        if (operation === 'swap') {
          refetchNFTs();
          refetchWTokensNFTs();
          setSelectedUserNFT(null);
          setSelectedWTokenNFT(null);
          setCurrentOperation(null);
        }

        // Clean up hash tracking
        setOperationByHash(prev => {
          const newMap = { ...prev };
          delete newMap[hash];
          return newMap;
        });
      }
    }
  }, [hash, isSuccess, operationByHash, updateTransaction, refetchApproval, refetchNFTs, refetchWTokenBalance, refetchWTokensNFTs, resetWrite]);

  // Handle transaction errors (including user rejection)
  useEffect(() => {
    if (writeError && currentOperation) {
      const errorMessage = writeError.message || 'Unknown error';

      // Check if user rejected the transaction
      if (errorMessage.includes('User rejected') ||
          errorMessage.includes('User denied') ||
          errorMessage.includes('user rejected')) {
        console.log('Transaction rejected by user');
      } else {
        console.error('Transaction error:', errorMessage);
      }

      // Restore NFTs if wrap operation failed
      if (currentOperation === 'wrap' && pendingWrapNFTs.size > 0) {
        // Remove pending NFTs from wrapped set (restore to display)
        setWrappedNFTs(prev => {
          const newSet = new Set(prev);
          pendingWrapNFTs.forEach(id => newSet.delete(id));
          return newSet;
        });
        setPendingWrapNFTs(new Set()); // Clear pending
      }

      setTxStep('error');
      // Clear current operation on error
      setCurrentOperation(null);
    }
  }, [writeError, currentOperation, pendingWrapNFTs]);

  // Handle batch transaction success
  useEffect(() => {
    if (isBatchSuccess) {
      setTxStep('success');
      refetchNFTs();
      refetchWTokensNFTs(); // Also refreshes next NFT preview
      refetchWTokenBalance();
      refetchApproval();
      setCurrentOperation(null);
      setSelectedNFTs(new Set());
      setSelectedUserNFT(null);
      setSelectedWTokenNFT(null);
      setTimeout(() => {
        resetBatch();
      }, 3000);
    }
  }, [isBatchSuccess, refetchNFTs, refetchWTokensNFTs, refetchWTokenBalance, refetchApproval, resetBatch]);

  // Step 1: Buy token
  const handleBuyToken = () => {
    if (!address || parseFloat(ethNeeded) <= 0) return;

    setCurrentOperation('buy');
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

  // Step 2: Approve
  const handleApprove = () => {
    setCurrentOperation('approve');
    setTxStep('pending');

    writeContract({
      address: contracts.nft.address,
      abi: contracts.nft.abi,
      functionName: 'setApprovalForAll',
      args: [contracts.wrapper.address, true],
    });
  };

  // Step 3: Get NFT (unwrap)
  const handleGetNFT = () => {
    setCurrentOperation('unwrap');
    setTxStep('pending');
    const totalFee = wrapFee ? BigInt(wrapFee as bigint) : 0n;

    writeContract({
      address: contracts.wrapper.address,
      abi: contracts.wrapper.abi,
      functionName: 'unwrapNFTs',
      args: [contracts.nft.address, BigInt(1)],
      value: totalFee,
    });
  };

  // Smart wallet batch all steps
  const handleBatchAll = async () => {
    if (!address) return;

    setCurrentOperation('unwrap');
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
      if (!isApprovedBool) {
        calls.push({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
          value: 0n,
        });
      }

      // Always add unwrap
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
      setCurrentOperation(null);
    }
  };

  // Handle wrap (existing NFTs to tokens)
  const handleWrap = () => {
    if (selectedNFTs.size === 0) return;

    setCurrentOperation('wrap');
    const tokenIds = Array.from(selectedNFTs);
    const totalFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(tokenIds.length) : 0n;

    // Store which NFTs we're wrapping for error recovery
    const wrappingNFTs = new Set(selectedNFTs);
    setPendingWrapNFTs(wrappingNFTs);

    // Immediately update UI for instant feedback
    setWrappedNFTs(new Set([...wrappedNFTs, ...wrappingNFTs]));
    setSelectedNFTs(new Set());

    writeContract({
      address: contracts.wrapper.address,
      abi: contracts.wrapper.abi,
      functionName: 'wrapNFTs',
      args: [contracts.nft.address, tokenIds],
      value: totalFee,
    });
  };

  // Handle swap
  const handleSwap = () => {
    if (selectedUserNFT === null || selectedWTokenNFT === null) return;

    setCurrentOperation('swap');
    const totalFee = swapFee ? BigInt(swapFee as bigint) : 0n;

    writeContract({
      address: contracts.wrapper.address,
      abi: contracts.wrapper.abi,
      functionName: 'swapNFT',
      args: [contracts.nft.address, BigInt(selectedUserNFT), BigInt(selectedWTokenNFT)],
      value: totalFee,
    });
  };

  // Smart wallet: batch approve + wrap in single transaction
  const handleApproveAndWrap = async () => {
    if (selectedNFTs.size === 0) return;

    setCurrentOperation('wrap');
    const tokenIds = Array.from(selectedNFTs);
    const totalFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(tokenIds.length) : 0n;

    // Store which NFTs we're wrapping for error recovery
    const wrappingNFTs = new Set(selectedNFTs);
    setPendingWrapNFTs(wrappingNFTs);

    // Immediately update UI for instant feedback
    setWrappedNFTs(new Set([...wrappedNFTs, ...wrappingNFTs]));
    setSelectedNFTs(new Set());

    try {
      await executeBatch([
        {
          address: contracts.nft.address,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
        },
        {
          address: contracts.wrapper.address,
          abi: contracts.wrapper.abi,
          functionName: 'wrapNFTs',
          args: [contracts.nft.address, tokenIds],
          value: totalFee,
        },
      ]);
    } catch {
      // Revert UI on error
      setWrappedNFTs(prev => {
        const newSet = new Set(prev);
        wrappingNFTs.forEach(id => newSet.delete(id));
        return newSet;
      });
      setPendingWrapNFTs(new Set());
      setCurrentOperation(null);
    }
  };

  // Smart wallet: batch approve + swap in single transaction
  const handleApproveAndSwap = async () => {
    if (selectedUserNFT === null || selectedWTokenNFT === null) return;

    setCurrentOperation('swap');
    const totalFee = swapFee ? BigInt(swapFee as bigint) : 0n;

    try {
      await executeBatch([
        {
          address: contracts.nft.address,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
        },
        {
          address: contracts.wrapper.address,
          abi: contracts.wrapper.abi,
          functionName: 'swapNFT',
          args: [contracts.nft.address, BigInt(selectedUserNFT), BigInt(selectedWTokenNFT)],
          value: totalFee,
        },
      ]);
    } catch {
      setCurrentOperation(null);
    }
  };

  // Filter out wrapped NFTs for instant UI feedback
  const displayedNFTs = nfts.filter(nft => !wrappedNFTs.has(nft.tokenId));

  const selectedCount = selectedNFTs.size;
  const totalWrapFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(selectedCount) : 0n;

  // Cost calculations for get-nft wizard
  const swapCost = parseFloat(ethNeeded);
  const wrapCost = parseFloat(wrapFeeFormatted);
  const totalCostFromStep1 = swapCost + wrapCost;
  const hasEnoughEthForSwap = parseFloat(ethBalance) >= swapCost;
  const hasEnoughEthForWrap = parseFloat(ethBalance) >= wrapCost;
  const isTransactionPending = isPending || isBatchPending;
  const isTransactionConfirming = isConfirming || isBatchConfirming;
  const isBusy = isTransactionPending || isTransactionConfirming || txStep === 'pending';

  // Step indicator component for get-nft wizard
  const StepIndicator = ({ stepNum, label, isActive, isComplete, isSkipped }: {
    stepNum: number;
    label: string;
    isActive: boolean;
    isComplete: boolean;
    isSkipped: boolean;
  }) => (
    <div className="flex flex-col items-center flex-1">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
          isComplete || isSkipped
            ? 'bg-gradient-to-br from-green-500 to-green-600 text-white'
            : isActive
            ? 'bg-gradient-to-br from-purple-500 to-violet-600 text-white ring-2 ring-purple-400 ring-offset-2 ring-offset-gray-900'
            : 'bg-gray-700 text-gray-400'
        }`}
      >
        {isComplete || isSkipped ? '✓' : stepNum}
      </div>
      <div className={`text-xs mt-2 ${isActive ? 'text-purple-400 font-semibold' : 'text-gray-500'}`}>
        {isSkipped ? 'Skipped' : label}
      </div>
    </div>
  );

  // Determine step states for wizard
  const step1Complete = hasOneToken || currentStep > 1;
  const step1Skipped = hasOneToken && currentStep >= 1;
  const step2Complete = isApprovedBool || currentStep > 2;
  const step2Skipped = isApprovedBool && currentStep >= 2;
  const step3Complete = txStep === 'success' && currentStep === 3;

  return (
    <main className="flex min-h-screen flex-col items-center p-6">
      <div className="w-full max-w-7xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4 pt-4">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-purple-600 bg-clip-text text-transparent">
            NFT Wrapper
          </h1>
          <p className="text-gray-400 text-lg">
            Get your Human NFT in just a few steps
          </p>
        </div>

        {!isConnected ? (
          <div className="glass rounded-3xl p-8 shadow-2xl border border-gray-800">
            <div className="space-y-6 text-center">
              
              <h2 className="text-2xl font-semibold text-white">
                Connect Your Wallet
              </h2>
              <p className="text-gray-400">
                Use the &quot;Connect Wallet&quot; button in the header above to start
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* wNFT Balance Card */}
            <div className="glass rounded-3xl p-6 shadow-2xl border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Your Token Balance</p>
                  <p className="text-3xl font-bold text-white">{wTokenBalanceFormatted.toFixed(2)}</p>
                </div>
                <div className="text-5xl">🪙</div>
              </div>
            </div>

            {/* Main Wrapper Card */}
            <div className="glass rounded-3xl p-8 shadow-2xl border border-gray-800">
              {/* Mode Tabs */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                <button
                  onClick={() => setMode('get-nft')}
                  className={`py-3 px-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                    mode === 'get-nft'
                      ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/50'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {finalNFTImageUrl ? (
                    <img
                      src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${finalNFTImageUrl}`}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : isLoadingImage ? (
                    <span className="w-5 h-5 rounded-full bg-gray-600 animate-pulse" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center text-xs">?</span>
                  )}
                  Get NFT
                </button>
                <button
                  onClick={() => setMode('wrap')}
                  className={`py-3 px-4 rounded-xl font-semibold transition-all ${
                    mode === 'wrap'
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/50'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  🪙 Wrap
                </button>
                <button
                  onClick={() => setMode('swap')}
                  className={`py-3 px-4 rounded-xl font-semibold transition-all ${
                    mode === 'swap'
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/50'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  Swap
                </button>
              </div>

              {mode === 'get-nft' ? (
                /* GET NFT MODE - 3-Step Wizard */
                <div className="space-y-6">
                  {/* Smart Wallet Badge */}
                  {isSmartWallet && (
                    <div className="flex justify-center">
                      <div className="px-4 py-2 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/50 rounded-lg text-sm font-semibold text-cyan-400">
                        ⚡ Smart Wallet - All Steps in One Transaction
                      </div>
                    </div>
                  )}

                  {/* Step Progress Indicator */}
                  <div className="flex items-start relative mb-8">
                    {/* Connecting line */}
                    <div className="absolute top-5 left-[16.66%] right-[16.66%] h-0.5 bg-gray-700" />
                    <div
                      className="absolute top-5 left-[16.66%] h-0.5 bg-gradient-to-r from-green-500 to-purple-500 transition-all duration-300"
                      style={{
                        width: currentStep === 1 ? '0%' : currentStep === 2 ? '50%' : '100%',
                        maxWidth: '66.66%',
                      }}
                    />

                    <StepIndicator stepNum={1} label="Buy Token" isActive={currentStep === 1} isComplete={step1Complete} isSkipped={step1Skipped} />
                    <StepIndicator stepNum={2} label="Approve" isActive={currentStep === 2} isComplete={step2Complete} isSkipped={step2Skipped} />
                    <StepIndicator stepNum={3} label="Get NFT" isActive={currentStep === 3} isComplete={step3Complete} isSkipped={false} />
                  </div>

                  {/* Step Content */}
                  <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700">
                    {/* Step 1: Buy Token */}
                    {currentStep === 1 && txStep !== 'success' && (
                      <>
                        <div className="text-lg font-bold text-white mb-3">
                          Step 1: Buy 1 Token
                        </div>
                        <div className="text-sm text-gray-400 mb-6">
                          Swap ETH for 1 token from the liquidity pool. This token will be wrapped into your NFT.
                        </div>

                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm text-gray-500">You Pay</span>
                          <span className="text-sm text-gray-500">
                            Balance: {parseFloat(ethBalance).toFixed(4)} ETH
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                          <span className={`text-2xl font-bold ${isLoadingQuote ? 'text-gray-500' : 'text-white'}`}>
                            {isLoadingQuote ? 'Loading...' : swapCost.toFixed(6)}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">Ξ</span>
                            <span className="font-semibold">ETH</span>
                          </div>
                        </div>

                        {!hasEnoughEthForSwap && (
                          <div className="mt-4 text-red-400 text-sm text-center">
                            Insufficient ETH balance
                          </div>
                        )}
                      </>
                    )}

                    {/* Step 2: Approve */}
                    {currentStep === 2 && txStep !== 'success' && (
                      <>
                        <div className="text-lg font-bold text-white mb-3">
                          Step 2: Approve Wrapper
                        </div>
                        <div className="text-sm text-gray-400 mb-6">
                          Allow the wrapper contract to convert your token into an NFT. This is a one-time approval.
                        </div>

                        <div className="p-6 bg-purple-500/10 border border-purple-500/30 rounded-xl text-center">
                          
                          <div className="text-gray-300">Approve wrapper contract</div>
                          <div className="text-gray-500 text-sm mt-2">No ETH required for this step</div>
                        </div>

                        <div className="mt-4 text-sm text-gray-500">
                          Your token balance: {wTokenBalanceFormatted.toFixed(4)} tokens
                        </div>
                      </>
                    )}

                    {/* Step 3: Get NFT */}
                    {currentStep === 3 && txStep !== 'success' && (
                      <>
                        <div className="text-lg font-bold text-white mb-3">
                          Step 3: Get Your NFT
                        </div>
                        <div className="text-sm text-gray-400 mb-6">
                          {nextTokenId
                            ? `You will receive Human #${nextTokenId} from the collection.`
                            : 'Convert your token into a Human NFT from the collection.'}
                        </div>

                        <div className="flex items-center gap-4 p-6 bg-green-500/10 border border-green-500/30 rounded-xl">
                          {finalNFTImageUrl ? (
                            <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-green-500/50 shadow-lg shadow-green-500/20 flex-shrink-0">
                              <img
                                src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${finalNFTImageUrl}`}
                                alt={nextTokenId ? `Human #${nextTokenId}` : 'NFT Preview'}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : isLoadingImage ? (
                            <div className="w-20 h-20 rounded-xl bg-gray-700 animate-pulse flex-shrink-0" />
                          ) : (
                            <div className="w-20 h-20 rounded-xl bg-gray-700 flex items-center justify-center flex-shrink-0">
                              <span className="text-3xl text-gray-500">?</span>
                            </div>
                          )}
                          <div>
                            <div className="text-xl font-bold text-white">
                              {nextTokenId ? `Human #${nextTokenId}` : isLoadingImage ? 'Loading...' : '1 Human NFT'}
                            </div>
                            <div className="text-gray-500 text-sm">
                              {nextTokenId ? 'Next in queue (FIFO)' : isLoadingImage ? 'Fetching preview...' : 'NFT from collection'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex justify-between text-sm">
                          <span className="text-gray-500">Wrap Fee:</span>
                          <span className="text-white">{wrapFeeFormatted} ETH</span>
                        </div>

                        {!hasEnoughEthForWrap && (
                          <div className="mt-4 text-red-400 text-sm text-center">
                            Insufficient ETH for wrap fee
                          </div>
                        )}
                      </>
                    )}

                    {/* Success State */}
                    {txStep === 'success' && currentStep === 3 && (
                      <div className="text-center py-8">
                        
                        <div className="text-2xl font-bold text-green-400 mb-2">NFT Acquired!</div>
                        {finalNFTImageUrl && (
                          <div className="flex justify-center my-4">
                            <div className="w-24 h-24 rounded-xl overflow-hidden border-2 border-green-500 shadow-lg shadow-green-500/30">
                              <img
                                src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${finalNFTImageUrl}`}
                                alt={nextTokenId ? `Human #${nextTokenId}` : 'Your NFT'}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          </div>
                        )}
                        <div className="text-gray-400">
                          {nextTokenId ? `Human #${nextTokenId} is now yours!` : 'Your new Human is waiting in your wallet'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Error Message */}
                  {(writeError || batchError) && txStep === 'error' && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-center">
                      <span className="text-red-400 text-sm">
                        {writeError?.message?.includes('User rejected') || batchError?.message?.includes('User rejected')
                          ? 'Transaction cancelled'
                          : 'Transaction failed. Please try again.'}
                      </span>
                    </div>
                  )}

                  {/* Action Button */}
                  {txStep === 'success' && currentStep === 3 ? (
                    <button
                      onClick={() => {
                        setTxStep('idle');
                        // Reset to appropriate step for next NFT
                        if (hasOneToken && isApprovedBool) {
                          setCurrentStep(3);
                        } else if (hasOneToken) {
                          setCurrentStep(2);
                        } else {
                          setCurrentStep(1);
                        }
                        refetchWTokenBalance();
                        resetWrite();
                      }}
                      className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white font-bold py-4 px-6 rounded-xl transition-all hover:from-green-600 hover:to-green-700"
                    >
                      Get Another NFT
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (isBusy) return;

                        // Smart wallet can batch everything
                        if (supportsAtomicBatch && !hasOneToken) {
                          handleBatchAll();
                        } else if (currentStep === 1) {
                          handleBuyToken();
                        } else if (currentStep === 2) {
                          handleApprove();
                        } else if (currentStep === 3) {
                          handleGetNFT();
                        }
                      }}
                      disabled={isBusy || isLoadingQuote || (currentStep === 1 && !hasEnoughEthForSwap) || (currentStep === 3 && !hasEnoughEthForWrap)}
                      className={`w-full font-bold py-4 px-6 rounded-xl transition-all flex items-center justify-center gap-2 ${
                        isBusy
                          ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                          : 'bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:from-purple-600 hover:to-violet-700 shadow-lg shadow-purple-500/30'
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          <span>{currentStep === 1 ? 'Buying...' : currentStep === 2 ? 'Approving...' : 'Getting NFT...'}</span>
                        </>
                      ) : isLoadingQuote ? (
                        'Loading...'
                      ) : supportsAtomicBatch && !hasOneToken ? (
                        `⚡ Get NFT (${totalCostFromStep1.toFixed(5)} ETH)`
                      ) : currentStep === 1 ? (
                        `Buy Token (${swapCost.toFixed(5)} ETH)`
                      ) : currentStep === 2 ? (
                        'Approve Wrapper'
                      ) : (
                        `Get NFT (${wrapFeeFormatted} ETH)`
                      )}
                    </button>
                  )}

                  {/* Transaction Hash */}
                  {hash && (
                    <a
                      href={`https://basescan.org/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mt-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-sm text-purple-400 text-center hover:bg-purple-500/20 transition-colors"
                    >
                      View Transaction on Basescan
                    </a>
                  )}
                </div>
              ) : mode === 'swap' ? (
                /* SWAP MODE */
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <p className="text-gray-400">
                      Swap your NFT for a specific NFT from the pool
                    </p>
                    <p className="text-sm text-gray-500">
                      Available NFTs in pool: {wTokensTotalHeld}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Your NFTs */}
                    <div className="space-y-4">
                      <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2">
                        Your NFTs
                      </h3>
                      {isLoading ? (
                        <div className="flex items-center justify-center py-16">
                          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-500"></div>
                        </div>
                      ) : displayedNFTs.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-gray-400">No NFTs available</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2">
                          {displayedNFTs.map((nft) => {
                            const isSelected = selectedUserNFT === nft.tokenId;
                            return (
                              <button
                                key={nft.tokenId}
                                onClick={() => setSelectedUserNFT(isSelected ? null : nft.tokenId)}
                                className={`relative group rounded-xl overflow-hidden border-2 transition-all ${
                                  isSelected
                                    ? 'border-purple-500 shadow-lg shadow-purple-500/50 scale-95'
                                    : 'border-gray-700 hover:border-purple-400'
                                }`}
                              >
                                {/* Selection Indicator */}
                                <div className="absolute top-2 left-2 z-10">
                                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                                    isSelected ? 'bg-purple-500 border-purple-500' : 'bg-gray-800/80 border-gray-600'
                                  }`}>
                                    {isSelected && <span className="text-white text-xs">✓</span>}
                                  </div>
                                </div>

                                {/* NFT Image */}
                                <div className="aspect-square relative">
                                  <img
                                    src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                                    alt={nft.name}
                                    className="w-full h-full object-cover"
                                  />
                                </div>

                                {/* NFT Info */}
                                <div className="p-2 bg-gray-900/90">
                                  <p className="text-white text-xs font-semibold truncate">{nft.name}</p>
                                  <p className="text-gray-400 text-xs">#{nft.tokenId}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Pool NFTs */}
                    <div className="space-y-4">
                      <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2">
                        Pool NFTs ({wTokensTotalHeld})
                      </h3>
                      {wTokensLoading ? (
                        <div className="flex items-center justify-center py-16">
                          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-500"></div>
                        </div>
                      ) : wTokensNFTs.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-gray-400">No NFTs in pool</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2">
                          {wTokensNFTs.map((nft) => {
                            const isSelected = selectedWTokenNFT === nft.tokenId;
                            return (
                              <button
                                key={nft.tokenId}
                                onClick={() => setSelectedWTokenNFT(isSelected ? null : nft.tokenId)}
                                className={`relative group rounded-xl overflow-hidden border-2 transition-all ${
                                  isSelected
                                    ? 'border-purple-500 shadow-lg shadow-purple-500/50 scale-95'
                                    : 'border-gray-700 hover:border-purple-400'
                                }`}
                              >
                                {/* Selection Indicator */}
                                <div className="absolute top-2 left-2 z-10">
                                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                                    isSelected ? 'bg-purple-500 border-purple-500' : 'bg-gray-800/80 border-gray-600'
                                  }`}>
                                    {isSelected && <span className="text-white text-xs">✓</span>}
                                  </div>
                                </div>

                                {/* NFT Image */}
                                <div className="aspect-square relative">
                                  <img
                                    src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                                    alt={nft.name}
                                    className="w-full h-full object-cover"
                                  />
                                </div>

                                {/* NFT Info */}
                                <div className="p-2 bg-gray-900/90">
                                  <p className="text-white text-xs font-semibold truncate">{nft.name}</p>
                                  <p className="text-gray-400 text-xs">#{nft.tokenId}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Swap Preview */}
                  {(selectedUserNFT !== null || selectedWTokenNFT !== null) && (
                    <div className="border-t border-gray-700 pt-6">
                      <div className="bg-gray-800/50 rounded-xl p-4 mb-4">
                        <div className="flex items-center justify-center gap-4">
                          <div className="text-center">
                            <p className="text-gray-400 text-sm mb-1">You give</p>
                            <p className="text-white font-bold">
                              {selectedUserNFT !== null ? `#${selectedUserNFT}` : '—'}
                            </p>
                          </div>
                          <div className="text-2xl">↔️</div>
                          <div className="text-center">
                            <p className="text-gray-400 text-sm mb-1">You get</p>
                            <p className="text-white font-bold">
                              {selectedWTokenNFT !== null ? `#${selectedWTokenNFT}` : '—'}
                            </p>
                          </div>
                        </div>
                        <p className="text-center text-gray-500 text-sm mt-3">
                          Fee: {swapFee ? formatEther(BigInt(swapFee as bigint)) : '0'} ETH
                        </p>
                      </div>

                      {/* Approval/Swap Button */}
                      {!isApproved ? (
                        <button
                          onClick={supportsAtomicBatch ? handleApproveAndSwap : handleApprove}
                          disabled={isPending || isConfirming || isBatchPending || isBatchConfirming || (supportsAtomicBatch && (selectedUserNFT === null || selectedWTokenNFT === null))}
                          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isBatchPending || isBatchConfirming
                            ? '⚡ Processing...'
                            : isPending || isConfirming
                              ? 'Approving...'
                              : supportsAtomicBatch
                                ? `⚡ Approve & Swap for ${swapFee ? formatEther(BigInt(swapFee as bigint)) : '0'} ETH`
                                : '✅ Approve Wrapper Contract'}
                        </button>
                      ) : (
                        <button
                          onClick={handleSwap}
                          disabled={selectedUserNFT === null || selectedWTokenNFT === null || isPending || isConfirming}
                          className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                        >
                          
                          <span>
                            {isPending || isConfirming
                              ? 'Swapping...'
                              : `Swap NFTs for ${swapFee ? formatEther(BigInt(swapFee as bigint)) : '0'} ETH`}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* WRAP MODE */
                <div className="space-y-6">
                  <div className="text-center">
                    <p className="text-gray-400">
                      Convert your NFTs to fungible tokens
                    </p>
                  </div>

                  {/* Selection Controls */}
                  <div className="flex items-center justify-between border-b border-gray-700 pb-4">
                    <div>
                      <p className="text-white font-semibold">
                        {selectedCount} NFT{selectedCount !== 1 ? 's' : ''} selected
                      </p>
                      <p className="text-gray-400 text-sm">
                        Fee: {wrapFee ? formatEther(totalWrapFee) : '0'} ETH
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSelectAll}
                        disabled={selectedNFTs.size === displayedNFTs.length || displayedNFTs.length === 0}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Select All
                      </button>
                      <button
                        onClick={handleUnselectAll}
                        disabled={selectedNFTs.size === 0}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Unselect All
                      </button>
                    </div>
                  </div>

                  {/* NFT Grid */}
                  {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                    </div>
                  ) : displayedNFTs.length === 0 ? (
                    <div className="text-center py-16">
                      {finalNFTImageUrl ? (
                        <div className="w-24 h-24 rounded-xl overflow-hidden border-2 border-gray-600 mx-auto">
                          <img
                            src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${finalNFTImageUrl}`}
                            alt="NFT Preview"
                            className="w-full h-full object-cover opacity-50"
                          />
                        </div>
                      ) : isLoadingImage ? (
                        <div className="w-24 h-24 rounded-xl bg-gray-700 mx-auto animate-pulse" />
                      ) : (
                        <div className="w-24 h-24 rounded-xl bg-gray-700 mx-auto flex items-center justify-center">
                          <span className="text-3xl text-gray-500">?</span>
                        </div>
                      )}
                      <h3 className="text-2xl font-bold text-white mt-4">No NFTs Found</h3>
                      <p className="text-gray-400 mt-2">You don&apos;t own any NFTs to wrap</p>
                      <button
                        onClick={() => setMode('get-nft')}
                        className="mt-6 px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl transition-colors"
                      >
                        Get Your First NFT
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-h-[500px] overflow-y-auto pr-2">
                      {displayedNFTs.map((nft) => {
                        const isSelected = selectedNFTs.has(nft.tokenId);
                        return (
                          <button
                            key={nft.tokenId}
                            onClick={() => toggleNFT(nft.tokenId)}
                            className={`relative group rounded-xl overflow-hidden border-2 transition-all ${
                              isSelected
                                ? 'border-blue-500 shadow-lg shadow-blue-500/50 scale-95'
                                : 'border-gray-700 hover:border-blue-400'
                            }`}
                          >
                            {/* Checkbox */}
                            <div className="absolute top-2 left-2 z-10">
                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                                isSelected ? 'bg-blue-500 border-blue-500' : 'bg-gray-800/80 border-gray-600'
                              }`}>
                                {isSelected && <span className="text-white text-xs">✓</span>}
                              </div>
                            </div>

                            {/* NFT Image */}
                            <div className="aspect-square relative">
                              <img
                                src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                                alt={nft.name}
                                className="w-full h-full object-cover"
                              />
                            </div>

                            {/* NFT Info */}
                            <div className="p-2 bg-gray-900/90">
                              <p className="text-white text-xs font-semibold truncate">{nft.name}</p>
                              <p className="text-gray-400 text-xs">#{nft.tokenId}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Action Button */}
                  {displayedNFTs.length > 0 && (
                    <div className="border-t border-gray-700 pt-6">
                      {!isApproved ? (
                        <button
                          onClick={supportsAtomicBatch ? handleApproveAndWrap : handleApprove}
                          disabled={isPending || isConfirming || isBatchPending || isBatchConfirming || (supportsAtomicBatch && selectedCount === 0)}
                          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isBatchPending || isBatchConfirming
                            ? '⚡ Processing...'
                            : isPending || isConfirming
                              ? 'Approving...'
                              : supportsAtomicBatch
                                ? `⚡ Approve & Wrap ${selectedCount} NFT${selectedCount !== 1 ? 's' : ''}`
                                : '✅ Approve Wrapper Contract'}
                        </button>
                      ) : (
                        <button
                          onClick={handleWrap}
                          disabled={selectedCount === 0 || isPending}
                          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                        >
                          <span>🪙</span>
                          <span>
                            {isPending
                              ? 'Confirm in Wallet...'
                              : `Wrap ${selectedCount} NFT${selectedCount !== 1 ? 's' : ''} for ${wrapFee ? formatEther(totalWrapFee) : '0'} ETH`}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Transaction Status */}
              {hash && mode !== 'get-nft' && (
                <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-blue-400 text-sm text-center">
                    {isConfirming ? 'Confirming transaction...' : isSuccess ? 'Transaction successful!' : 'Transaction submitted'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
