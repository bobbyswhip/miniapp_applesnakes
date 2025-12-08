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
import { useWTokensNFTsCache } from '@/hooks/useWTokensNFTsCache';
import { ERC20_ABI } from '@/abis/erc20';
import type { Abi } from 'viem';

type FilterType = 'all' | 'human' | 'snake' | 'egg';

interface SwapWrapModalProps {
  isOpen: boolean;
  onClose: () => void;
  nftContractAddress?: string;
  initialMode?: 'buy' | 'wrap';
  embedded?: boolean; // When true, renders content without modal wrapper (for embedding in other modals)
  swapOnly?: boolean; // When true, only shows swap functionality (for NFT Exchange tab)
  buyOnly?: boolean; // When true, only shows buy functionality (for NFT Hub - no wrap/unwrap tabs)
  filterType?: FilterType; // External filter type from parent (for filtering pool NFTs)
  searchQuery?: string; // External search query from parent (for filtering pool NFTs)
  gridSize?: 'small' | 'medium' | 'large'; // Grid size for NFT display
}

// Helper function to determine NFT type from tokenId
const getLocalNFTType = (tokenId: number, name: string): 'snake' | 'egg' | 'human' => {
  if (name.toLowerCase().includes('egg')) return 'egg';
  if (tokenId % 10 === 0 || tokenId > 3000) return 'snake';
  return 'human';
};

type PaymentMethod = 'eth' | 'wass';
type ModalMode = 'buy' | 'wrap';
type WrapSubMode = 'wrap' | 'unwrap' | 'swap';

// Default estimate per NFT (used while loading accurate quote)
const DEFAULT_ETH_PER_NFT = 0.0012; // ~0.0012 ETH per NFT as initial estimate

// IPNS fallback URL for NFT images when imageUrl is empty
const IPNS_BASE_URL = 'https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dm7e0kn5ud2iogv1fonqr7if8ijb9w61bpcbjxuk0cp177dv2pp';

// Helper to get NFT image URL with IPNS fallback
const getNFTImageUrl = (imageUrl: string | undefined, tokenId: string | number): string => {
  if (imageUrl && imageUrl.trim() !== '') return imageUrl;
  return `${IPNS_BASE_URL}/${tokenId}.png`;
};

// Grid size classes - matches InventorySack for consistency
const gridSizeClasses = {
  small: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
  medium: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
  large: 'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
};

export function SwapWrapModal({ isOpen, onClose, initialMode = 'buy', embedded = false, swapOnly = false, buyOnly = false, filterType = 'all', searchQuery = '', gridSize = 'medium' }: SwapWrapModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);
  const { addTransaction: _addTransaction, updateTransaction } = useTransactions();
  const { nfts, isLoading: nftsLoading, refetch: refetchNFTs } = useNFTContext();

  // Modal mode state
  const [mode, setMode] = useState<ModalMode>(swapOnly ? 'wrap' : initialMode);

  // Wrap mode state - start in swap mode if swapOnly
  const [wrapSubMode, setWrapSubMode] = useState<WrapSubMode>(swapOnly ? 'swap' : 'wrap');
  const [selectedNFTs, setSelectedNFTs] = useState<Set<number>>(new Set());
  const [wrappedNFTs, setWrappedNFTs] = useState<Set<number>>(new Set());

  // Unwrap mode state
  const [unwrapCount, setUnwrapCount] = useState<number>(1);
  const [unwrapError, setUnwrapError] = useState<string>('');

  // Swap mode state - uses cached pool NFTs
  const { nfts: poolNFTs, isLoading: poolNFTsLoading, totalHeld: poolTotalHeld, refetch: refetchPoolNFTs } = useWTokensNFTsCache(false, false);
  const [selectedPoolNFT, setSelectedPoolNFT] = useState<number | null>(null);
  const [selectedUserNFTForSwap, setSelectedUserNFTForSwap] = useState<number | null>(null);

  // Optimistic swap state - track NFTs that were swapped locally without refetching
  const [swappedUserNFTs, setSwappedUserNFTs] = useState<Set<number>>(new Set()); // User NFTs sent to pool
  const [swappedPoolNFTs, setSwappedPoolNFTs] = useState<Set<number>>(new Set()); // Pool NFTs received by user
  const [pendingSwap, setPendingSwap] = useState<{ userNFT: number; poolNFT: number } | null>(null);
  const [swapSuccessMessage, setSwapSuccessMessage] = useState<string | null>(null);

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

  // Get swap fee from wrapper contract (separate from wrap fee)
  const { data: swapFeeData } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getSwapFee',
    chainId: base.id,
  });

  // Get NFT approval status for wrapper contract (for wrap mode)
  const { data: nftApprovalData, refetch: refetchNftApproval } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: address && contracts.wrapper.address ? [address, contracts.wrapper.address] : undefined,
    chainId: base.id,
  });

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';
  const tokenBalance = tokenBalanceData ? Number(formatUnits(tokenBalanceData as bigint, 18)) : 0;
  const wassApproved = wassApprovalData ? (wassApprovalData as bigint) >= parseEther(nftCount.toString()) : false;
  const nftApproved = Boolean(nftApprovalData);
  const wrapFee = wrapFeeData ? BigInt(wrapFeeData as bigint) : 0n;
  const wrapFeeFormatted = formatEther(wrapFee);
  const hasEnoughWass = tokenBalance >= nftCount;

  // Wrap mode calculations
  // Filter out wrapped NFTs AND NFTs the user swapped away
  const displayedNFTs = nfts.filter(nft => !wrappedNFTs.has(nft.tokenId) && !swappedUserNFTs.has(nft.tokenId));
  // For swap mode: user's NFTs exclude those sent to pool, but include those received from pool
  const displayedUserNFTsForSwap = [
    ...nfts.filter(nft => !swappedUserNFTs.has(nft.tokenId)),
    ...poolNFTs.filter(nft => swappedPoolNFTs.has(nft.tokenId)), // Pool NFTs user received
  ];
  // Pool NFTs exclude those the user received, but include those user sent
  // Then apply external filters if provided
  const basePoolNFTs = [
    ...poolNFTs.filter(nft => !swappedPoolNFTs.has(nft.tokenId)),
    ...nfts.filter(nft => swappedUserNFTs.has(nft.tokenId)), // User NFTs now in pool
  ];
  // Apply filterType and searchQuery from parent
  const displayedPoolNFTsForSwap = basePoolNFTs.filter(nft => {
    // Apply type filter
    if (filterType !== 'all') {
      const nftType = getLocalNFTType(nft.tokenId, nft.name);
      if (nftType !== filterType) return false;
    }
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!nft.name.toLowerCase().includes(query) && !nft.tokenId.toString().includes(query)) {
        return false;
      }
    }
    return true;
  });
  const selectedCount = selectedNFTs.size;
  const totalWrapFee = wrapFee * BigInt(selectedCount);
  const totalWrapFeeFormatted = formatEther(totalWrapFee);
  const hasEnoughEthForWrapFee = parseFloat(ethBalance) >= parseFloat(totalWrapFeeFormatted);

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
      // Check if this was a swap transaction - use optimistic update instead of refetch
      if (pendingSwap) {
        // Optimistic update: move NFTs locally without refetching
        setSwappedUserNFTs(prev => new Set([...prev, pendingSwap.userNFT]));
        setSwappedPoolNFTs(prev => new Set([...prev, pendingSwap.poolNFT]));

        // Show toast notification
        setSwapSuccessMessage(`Swapped #${pendingSwap.userNFT} for #${pendingSwap.poolNFT}`);

        // Clear selections and pending state
        setSelectedPoolNFT(null);
        setSelectedUserNFTForSwap(null);
        setPendingSwap(null);
        setTxStep('idle');

        // Auto-hide toast after 4 seconds
        setTimeout(() => setSwapSuccessMessage(null), 4000);
      } else {
        // Not a swap - normal success flow
        setTxStep('success');
        refetchNFTs();
      }
      refetchTokenBalance();
      refetchWassApproval();
      setTimeout(() => {
        resetBatch();
      }, 3000);
    }
  }, [isBatchSuccess, refetchNFTs, refetchTokenBalance, refetchWassApproval, resetBatch, pendingSwap]);

  // Handle single transaction success
  useEffect(() => {
    if (isSuccess && hash) {
      updateTransaction(hash, 'success');

      // Check if this was a swap transaction - use optimistic update instead of refetch
      if (pendingSwap) {
        // Optimistic update: move NFTs locally without refetching
        setSwappedUserNFTs(prev => new Set([...prev, pendingSwap.userNFT]));
        setSwappedPoolNFTs(prev => new Set([...prev, pendingSwap.poolNFT]));

        // Show toast notification
        setSwapSuccessMessage(`Swapped #${pendingSwap.userNFT} for #${pendingSwap.poolNFT}`);

        // Clear selections and pending state
        setSelectedPoolNFT(null);
        setSelectedUserNFTForSwap(null);
        setPendingSwap(null);
        setTxStep('idle');

        // Auto-hide toast after 4 seconds
        setTimeout(() => setSwapSuccessMessage(null), 4000);
      } else {
        // Not a swap - normal success flow
        setTxStep('success');
        refetchNFTs();
      }
      refetchTokenBalance();
      refetchWassApproval();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, hash]);

  // Handle transaction errors - set to cancelled state (allows retry)
  useEffect(() => {
    if (writeError || batchError) {
      setTxStep('cancelled');
      // Clear pending swap on error so user can retry
      setPendingSwap(null);
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
  const totalBuyWrapFee = parseFloat(wrapFeeFormatted) * nftCount;
  const hasEnoughEth = parseFloat(ethBalance) >= totalEthCost;
  const hasEnoughEthForBuyWrapFee = parseFloat(ethBalance) >= totalBuyWrapFee;
  const isTransactionPending = isWritePending || isBatchPending;
  const isTransactionConfirming = isConfirming || isBatchConfirming;
  const isBusy = isTransactionPending || isTransactionConfirming || txStep === 'pending';

  // ===== WRAP MODE: NFT Selection Handlers =====
  const toggleNFT = (tokenId: number) => {
    const newSelected = new Set(selectedNFTs);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      newSelected.add(tokenId);
    }
    setSelectedNFTs(newSelected);
  };

  const handleSelectAll = () => {
    setSelectedNFTs(new Set(displayedNFTs.map(nft => nft.tokenId)));
  };

  const handleUnselectAll = () => {
    setSelectedNFTs(new Set());
  };

  // ===== WRAP MODE: Wrap NFTs to Tokens =====
  const handleWrapNFTs = () => {
    if (selectedNFTs.size === 0) return;

    setTxStep('pending');
    const tokenIds = Array.from(selectedNFTs);
    const fee = wrapFee * BigInt(tokenIds.length);

    // Immediately update UI for instant feedback
    setWrappedNFTs(new Set([...wrappedNFTs, ...selectedNFTs]));
    setSelectedNFTs(new Set());

    writeContract({
      address: contracts.wrapper.address as `0x${string}`,
      abi: contracts.wrapper.abi,
      functionName: 'wrapNFTs',
      args: [contracts.nft.address, tokenIds],
      value: fee,
    });
  };

  // ===== WRAP MODE: Approve NFT for Wrapper =====
  const handleApproveNFT = () => {
    setTxStep('pending');
    writeContract({
      address: contracts.nft.address as `0x${string}`,
      abi: contracts.nft.abi,
      functionName: 'setApprovalForAll',
      args: [contracts.wrapper.address, true],
    });
  };

  // ===== WRAP MODE: Batch Approve + Wrap =====
  const handleApproveAndWrap = async () => {
    if (selectedNFTs.size === 0) return;

    setTxStep('pending');
    const tokenIds = Array.from(selectedNFTs);
    const fee = wrapFee * BigInt(tokenIds.length);

    // Immediately update UI for instant feedback
    setWrappedNFTs(new Set([...wrappedNFTs, ...selectedNFTs]));
    setSelectedNFTs(new Set());

    try {
      await executeBatch([
        {
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi as Abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
          value: 0n,
        },
        {
          address: contracts.wrapper.address as `0x${string}`,
          abi: contracts.wrapper.abi as Abi,
          functionName: 'wrapNFTs',
          args: [contracts.nft.address, tokenIds],
          value: fee,
        },
      ]);
    } catch (error) {
      console.error('Wrap error:', error);
      // Revert UI on error
      setWrappedNFTs(new Set());
      setTxStep('error');
    }
  };

  // ===== UNWRAP MODE: Unwrap Tokens to NFTs =====
  const handleUnwrapNFTs = () => {
    if (unwrapCount < 1) return;

    setTxStep('pending');
    const fee = wrapFee * BigInt(unwrapCount);

    writeContract({
      address: contracts.wrapper.address as `0x${string}`,
      abi: contracts.wrapper.abi,
      functionName: 'unwrapNFTs',
      args: [contracts.nft.address, BigInt(unwrapCount)],
      value: fee,
    });
  };

  // Unwrap calculations
  const unwrapFee = wrapFee * BigInt(unwrapCount);
  const unwrapFeeFormatted = formatEther(unwrapFee);
  const hasEnoughEthForUnwrap = parseFloat(ethBalance) >= parseFloat(unwrapFeeFormatted);
  const hasEnoughTokensForUnwrap = tokenBalance >= unwrapCount;

  // ===== SWAP MODE: Swap user NFT for pool NFT =====
  // Get actual swap fee from contract (not calculated from wrap fee)
  const swapFee = swapFeeData ? BigInt(swapFeeData as bigint) : 0n;
  const swapFeeFormatted = formatEther(swapFee);

  const handleSwapNFTs = async () => {
    if (selectedPoolNFT === null || selectedUserNFTForSwap === null) return;

    // Save pending swap info for optimistic update on success
    setPendingSwap({ userNFT: selectedUserNFTForSwap, poolNFT: selectedPoolNFT });
    setTxStep('pending');

    try {
      if (supportsAtomicBatch && !nftApproved) {
        // Batch: approve + swap
        await executeBatch([
          {
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi as Abi,
            functionName: 'setApprovalForAll',
            args: [contracts.wrapper.address, true],
            value: 0n,
          },
          {
            address: contracts.wrapper.address as `0x${string}`,
            abi: contracts.wrapper.abi as Abi,
            functionName: 'swapNFT',
            args: [contracts.nft.address, BigInt(selectedUserNFTForSwap), BigInt(selectedPoolNFT)],
            value: swapFee,
          },
        ]);
      } else if (nftApproved) {
        // Just swap
        writeContract({
          address: contracts.wrapper.address as `0x${string}`,
          abi: contracts.wrapper.abi,
          functionName: 'swapNFT',
          args: [contracts.nft.address, BigInt(selectedUserNFTForSwap), BigInt(selectedPoolNFT)],
          value: swapFee,
        });
      } else {
        // Need approval first
        writeContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
        });
      }
    } catch (error) {
      console.error('Swap error:', error);
      setTxStep('error');
    }
  };

  // Swap calculations
  const hasEnoughEthForSwap = parseFloat(ethBalance) >= parseFloat(swapFeeFormatted);
  const canSwap = selectedPoolNFT !== null && selectedUserNFTForSwap !== null && hasEnoughEthForSwap;

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
      setMode(initialMode);
      setWrapSubMode('wrap');
      setSelectedNFTs(new Set());
      setWrappedNFTs(new Set());
      setUnwrapCount(1);
      setUnwrapError('');
      setSelectedPoolNFT(null);
      setSelectedUserNFTForSwap(null);
      resetWrite();
      resetBatch();
    }
  }, [isOpen, initialMode, resetWrite, resetBatch]);

  // Refetch NFT approval after successful wrap approval
  useEffect(() => {
    if (isSuccess && mode === 'wrap') {
      refetchNftApproval();
      refetchNFTs();
      refetchTokenBalance();
    }
  }, [isSuccess, mode, refetchNftApproval, refetchNFTs, refetchTokenBalance]);

  if (!isOpen) return null;

  // ===== EMBEDDED FULL-SCREEN MODE =====
  if (embedded) {
    return (
      <div className="h-full flex flex-col bg-gray-950">
        {/* Full-Screen Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar with Controls - hidden when swapOnly to maximize swap content */}
          {!swapOnly && (
          <aside className="w-80 flex-shrink-0 border-r border-gray-800 bg-gray-900/50 overflow-y-auto p-6 hidden md:block">
            {/* Mode Selection (hidden when buyOnly) */}
            {!buyOnly && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Mode</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setMode('buy')}
                    disabled={isBusy}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      mode === 'buy'
                        ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/30 border-2 border-purple-500/50 text-purple-300'
                        : 'bg-gray-800 border-2 border-gray-700 text-gray-300 hover:bg-gray-750 hover:border-gray-600'
                    }`}
                  >
                    <span className="text-xl">🛒</span>
                    <div className="text-left">
                      <div className="font-semibold">Buy NFT</div>
                      <div className="text-xs text-gray-400">Purchase with ETH or tokens</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setMode('wrap')}
                    disabled={isBusy}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      mode === 'wrap'
                        ? 'bg-gradient-to-r from-blue-500/30 to-cyan-500/30 border-2 border-blue-500/50 text-blue-300'
                        : 'bg-gray-800 border-2 border-gray-700 text-gray-300 hover:bg-gray-750 hover:border-gray-600'
                    }`}
                  >
                    <span className="text-xl">🎁</span>
                    <div className="text-left">
                      <div className="font-semibold">Wrap / Unwrap</div>
                      <div className="text-xs text-gray-400">Convert NFTs ↔ tokens</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Wrap Sub-Mode Selection (only in wrap mode, hidden when swapOnly or buyOnly) */}
            {mode === 'wrap' && !swapOnly && !buyOnly && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Action</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setWrapSubMode('wrap')}
                    disabled={isBusy}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      wrapSubMode === 'wrap'
                        ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400'
                        : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750'
                    }`}
                  >
                    <span>🔄</span>
                    <span className="font-medium">Wrap / Unwrap</span>
                  </button>
                  <button
                    onClick={() => setWrapSubMode('swap')}
                    disabled={isBusy}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      wrapSubMode === 'swap'
                        ? 'bg-purple-500/20 border border-purple-500/50 text-purple-400'
                        : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750'
                    }`}
                  >
                    <span>↔️</span>
                    <span className="font-medium">Swap NFT ↔ Pool</span>
                  </button>
                </div>
              </div>
            )}

            {/* Smart Wallet Badge */}
            {isSmartWallet && (
              <div className="mb-6 p-3 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30">
                <div className="flex items-center gap-2 text-cyan-400">
                  <span>⚡</span>
                  <span className="text-sm font-medium">Smart Wallet Active</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">One-click transactions enabled</p>
              </div>
            )}

            {/* Balance Info */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400">Your Balances</h3>
              <div className="p-4 rounded-xl bg-gray-800/50 border border-gray-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">ETH</span>
                  <span className="text-white font-medium">{parseFloat(ethBalance).toFixed(4)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">wASS Tokens</span>
                  <span className="text-white font-medium">{tokenBalance.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Your NFTs</span>
                  <span className="text-white font-medium">{nfts.length}</span>
                </div>
              </div>
            </div>
          </aside>
          )}

          {/* Main Content Area */}
          <main className="flex-1 overflow-hidden flex flex-col">
            {/* Mobile Mode Tabs - hidden when swapOnly */}
            {!swapOnly && (
            <div className="md:hidden flex gap-2 p-4 border-b border-gray-800 bg-gray-900/50">
              <button
                onClick={() => setMode('buy')}
                disabled={isBusy}
                className={`flex-1 py-3 px-4 rounded-xl font-semibold transition-all ${
                  mode === 'buy'
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                🛒 Buy
              </button>
              <button
                onClick={() => setMode('wrap')}
                disabled={isBusy}
                className={`flex-1 py-3 px-4 rounded-xl font-semibold transition-all ${
                  mode === 'wrap'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                🎁 Wrap
              </button>
            </div>
            )}

            {/* Success State */}
            {txStep === 'success' ? (
              <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="text-8xl mb-6">🎉</div>
                <h2 className="text-3xl font-bold text-green-400 mb-4">
                  {mode === 'buy' ? (nftCount > 1 ? 'NFTs Acquired!' : 'NFT Acquired!') : 'Success!'}
                </h2>
                <p className="text-gray-400 text-lg mb-8 text-center max-w-md">
                  {mode === 'buy'
                    ? `Your new human${nftCount > 1 ? 's are' : ' is'} waiting in your wallet`
                    : 'Your transaction completed successfully'}
                </p>
                <button
                  onClick={() => {
                    setTxStep('idle');
                    if (mode === 'wrap') {
                      setWrappedNFTs(new Set());
                      refetchNFTs();
                      refetchTokenBalance();
                    }
                  }}
                  className="px-8 py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-400 hover:to-emerald-400 transition-all"
                >
                  Continue
                </button>
              </div>
            ) : mode === 'buy' ? (
              /* ===== BUY MODE - FULL SCREEN ===== */
              <div className="p-6 md:p-8 space-y-8">
                {/* Hero Section */}
                <div className="text-center max-w-2xl mx-auto">
                  <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                    Get Your NFT
                  </h2>
                  <p className="text-gray-400 text-lg">
                    Purchase AppleSnakes NFTs instantly with ETH or wASS tokens
                  </p>
                </div>

                {/* NFT Count Selector */}
                <div className="max-w-xl mx-auto">
                  <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800">
                    <label className="block text-sm font-medium text-gray-400 mb-4">
                      How many NFTs do you want?
                    </label>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setNftCount(Math.max(1, nftCount - 1))}
                        disabled={nftCount <= 1 || isBusy}
                        className="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 text-2xl text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        −
                      </button>
                      <div className="flex-1">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={nftCount}
                          onChange={(e) => setNftCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                          disabled={isBusy}
                          className="w-full h-14 text-center text-3xl font-bold bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <button
                        onClick={() => setNftCount(Math.min(100, nftCount + 1))}
                        disabled={nftCount >= 100 || isBusy}
                        className="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 text-2xl text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex justify-center gap-2 mt-4">
                      {[1, 5, 10, 25].map((num) => (
                        <button
                          key={num}
                          onClick={() => setNftCount(num)}
                          disabled={isBusy}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            nftCount === num
                              ? 'bg-purple-500/30 border border-purple-500/50 text-purple-300'
                              : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Payment Method */}
                <div className="max-w-xl mx-auto">
                  <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800">
                    <label className="block text-sm font-medium text-gray-400 mb-4">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setPaymentMethod('eth')}
                        disabled={isBusy}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'eth'
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                        }`}
                      >
                        <div className="text-2xl mb-2">⚡</div>
                        <div className="font-semibold text-white">ETH</div>
                        <div className="text-sm text-gray-400">Direct purchase</div>
                      </button>
                      <button
                        onClick={() => setPaymentMethod('wass')}
                        disabled={isBusy}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'wass'
                            ? 'border-orange-500 bg-orange-500/10'
                            : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                        }`}
                      >
                        <div className="text-2xl mb-2">🎁</div>
                        <div className="font-semibold text-white">wASS Tokens</div>
                        <div className="text-sm text-gray-400">Use your tokens</div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Cost Breakdown */}
                <div className="max-w-xl mx-auto">
                  <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30">
                    <h3 className="text-lg font-semibold text-white mb-4">Cost Summary</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">NFTs</span>
                        <span className="text-white font-medium">{nftCount} × 1 wASS</span>
                      </div>
                      {paymentMethod === 'eth' && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">ETH Cost</span>
                          <span className="text-white font-medium">
                            ~{totalEthCost.toFixed(5)} ETH
                            {isLoadingQuote && <span className="text-gray-500 ml-1">(updating...)</span>}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Unwrap Fee</span>
                        <span className="text-white font-medium">{formatEther(wrapFee * BigInt(nftCount))} ETH</span>
                      </div>
                      <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
                        <span className="text-lg font-semibold text-white">Total</span>
                        <span className="text-lg font-bold text-purple-400">
                          {paymentMethod === 'eth'
                            ? `${totalEthCost.toFixed(5)} ETH`
                            : `${nftCount} wASS + ${formatEther(wrapFee * BigInt(nftCount))} ETH`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Buy Button */}
                <div className="max-w-xl mx-auto">
                  <button
                    onClick={paymentMethod === 'eth' ? handleBuyWithEth : handleBuyWithWass}
                    disabled={isBusy || (paymentMethod === 'eth' && parseFloat(ethBalance) < totalEthCost) || (paymentMethod === 'wass' && !hasEnoughWass)}
                    className={`w-full py-5 rounded-2xl font-bold text-xl transition-all ${
                      isBusy
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400 hover:scale-[1.02]'
                    }`}
                  >
                    {isBusy ? (
                      <span className="flex items-center justify-center gap-3">
                        <span className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : paymentMethod === 'eth' ? (
                      `Buy ${nftCount} NFT${nftCount > 1 ? 's' : ''} for ${totalEthCost.toFixed(5)} ETH`
                    ) : !wassApproved ? (
                      supportsAtomicBatch ? `Approve & Buy ${nftCount} NFT${nftCount > 1 ? 's' : ''}` : 'Approve wASS First'
                    ) : (
                      `Buy ${nftCount} NFT${nftCount > 1 ? 's' : ''} with wASS`
                    )}
                  </button>
                  {paymentMethod === 'eth' && parseFloat(ethBalance) < totalEthCost && (
                    <p className="text-center text-red-400 mt-3">Insufficient ETH balance</p>
                  )}
                  {paymentMethod === 'wass' && !hasEnoughWass && (
                    <p className="text-center text-red-400 mt-3">Insufficient wASS token balance</p>
                  )}
                </div>

                {/* Transaction Hash Link */}
                {hash && (
                  <div className="max-w-xl mx-auto">
                    <a
                      href={`https://basescan.org/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 text-center text-purple-400 hover:bg-purple-500/20 transition-all"
                    >
                      View Transaction on BaseScan →
                    </a>
                  </div>
                )}
              </div>
            ) : (
              /* ===== WRAP MODE - FULL SCREEN ===== */
              <div className={`${swapOnly ? 'flex-1 flex flex-col p-4 md:p-6 overflow-hidden' : 'p-6 md:p-8 space-y-6'}`}>
                {/* Mobile Sub-Mode Tabs - hidden when swapOnly */}
                {!swapOnly && (
                <div className="md:hidden flex gap-2 mb-4">
                  <button
                    onClick={() => setWrapSubMode('wrap')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium ${
                      wrapSubMode === 'wrap' || wrapSubMode === 'unwrap' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50' : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    Wrap / Unwrap
                  </button>
                  <button
                    onClick={() => setWrapSubMode('swap')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium ${
                      wrapSubMode === 'swap' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50' : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    Swap NFTs
                  </button>
                </div>
                )}

                {wrapSubMode === 'swap' ? (
                  /* ===== SWAP MODE - FULL SCREEN UNIVERSAL NFT BROWSER ===== */
                  <div className={`${swapOnly ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : ''}`}>
                    {/* Toast Notification for Swap Success */}
                    {swapSuccessMessage && (
                      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
                        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-green-500/90 backdrop-blur-sm shadow-xl shadow-green-500/20 border border-green-400/30">
                          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                            <span className="text-lg">✓</span>
                          </div>
                          <div>
                            <div className="text-white font-bold text-sm">Swap Successful!</div>
                            <div className="text-green-100 text-xs">{swapSuccessMessage}</div>
                          </div>
                          <button
                            onClick={() => setSwapSuccessMessage(null)}
                            className="ml-2 text-white/70 hover:text-white text-lg"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action Bar at Top */}
                    <div className={`${swapOnly ? 'flex-shrink-0' : 'sticky top-0'} z-10 bg-gray-950/95 backdrop-blur-sm -mx-4 px-4 md:-mx-6 md:px-6 pb-4 mb-4 border-b border-gray-800`}>
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h2 className="text-xl font-bold text-white">Swap NFT ↔ Pool</h2>
                          <p className="text-sm text-gray-400">Select one of yours, then one from pool • Fee: {swapFeeFormatted} ETH</p>
                        </div>

                        {/* Selection Preview & Action */}
                        <div className="flex items-center gap-3">
                          {selectedUserNFTForSwap !== null && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30">
                              <span className="text-xs text-gray-400">Yours:</span>
                              <span className="text-sm font-bold text-blue-400">#{selectedUserNFTForSwap}</span>
                            </div>
                          )}
                          {selectedUserNFTForSwap !== null && selectedPoolNFT !== null && (
                            <span className="text-purple-400 text-lg">↔</span>
                          )}
                          {selectedPoolNFT !== null && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30">
                              <span className="text-xs text-gray-400">Pool:</span>
                              <span className="text-sm font-bold text-purple-400">#{selectedPoolNFT}</span>
                            </div>
                          )}
                          {(selectedUserNFTForSwap !== null || selectedPoolNFT !== null) && (
                            <button
                              onClick={() => {
                                setSelectedUserNFTForSwap(null);
                                setSelectedPoolNFT(null);
                              }}
                              disabled={isBusy}
                              className="px-3 py-2.5 rounded-xl font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-all"
                            >
                              Clear
                            </button>
                          )}
                          <button
                            onClick={handleSwapNFTs}
                            disabled={!canSwap || isBusy}
                            className={`px-6 py-2.5 rounded-xl font-bold transition-all ${
                              !canSwap || isBusy
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400'
                            }`}
                          >
                            {isBusy ? 'Processing...' : !nftApproved && canSwap
                              ? (supportsAtomicBatch ? 'Approve & Swap' : 'Approve First')
                              : 'Swap'}
                          </button>
                        </div>
                      </div>
                      {!hasEnoughEthForSwap && selectedPoolNFT !== null && selectedUserNFTForSwap !== null && (
                        <p className="text-red-400 text-sm mt-2">Insufficient ETH for swap fee</p>
                      )}
                    </div>

                    {/* Section Headers Row */}
                    <div className={`grid grid-cols-2 gap-4 mb-4 ${swapOnly ? 'flex-shrink-0' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                        <h3 className="text-lg font-bold text-white">Your NFTs</h3>
                        <span className="text-gray-500 text-sm">({nfts.length})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                        <h3 className="text-lg font-bold text-white">Pool NFTs</h3>
                        <span className="text-gray-500 text-sm">({poolTotalHeld})</span>
                      </div>
                    </div>

                    {/* Full-Width Side-by-Side Grids */}
                    <div className={`grid grid-cols-2 gap-4 ${swapOnly ? 'flex-1 min-h-0' : ''}`} style={swapOnly ? undefined : { height: 'calc(100vh - 280px)' }}>
                      {/* YOUR NFTs Grid */}
                      <div className="overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/30 p-3">
                        {nftsLoading ? (
                          <div className="flex justify-center items-center h-full">
                            <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                          </div>
                        ) : displayedUserNFTsForSwap.length === 0 ? (
                          <div className="flex flex-col justify-center items-center h-full text-center">
                            <div className="text-4xl mb-3">🤷</div>
                            <p className="text-gray-400 mb-4">No NFTs to swap</p>
                            <button
                              onClick={() => setMode('buy')}
                              className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 text-sm font-medium hover:bg-purple-500/30"
                            >
                              Get NFTs
                            </button>
                          </div>
                        ) : (
                          <div className={`grid ${gridSizeClasses[gridSize]} gap-2`}>
                            {displayedUserNFTsForSwap.map((nft) => (
                              <button
                                key={nft.tokenId}
                                onClick={() => setSelectedUserNFTForSwap(nft.tokenId)}
                                disabled={isBusy}
                                className={`relative rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02] ${
                                  selectedUserNFTForSwap === nft.tokenId
                                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                                    : 'border-gray-700 hover:border-gray-500'
                                }`}
                              >
                                <div className="aspect-square relative bg-gray-800">
                                  <img src={getNFTImageUrl(nft.imageUrl, nft.tokenId)} alt={nft.name} className="w-full h-full object-cover" />
                                  {selectedUserNFTForSwap === nft.tokenId && (
                                    <div className="absolute inset-0 bg-blue-500/30 flex items-center justify-center">
                                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                                        <span className="text-white text-sm">✓</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="p-1.5 bg-gray-800 text-center">
                                  <div className="text-xs text-gray-300">#{nft.tokenId}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* POOL NFTs Grid */}
                      <div className="overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/30 p-3">
                        {poolNFTsLoading ? (
                          <div className="flex justify-center items-center h-full">
                            <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                          </div>
                        ) : displayedPoolNFTsForSwap.length === 0 ? (
                          <div className="flex flex-col justify-center items-center h-full text-center">
                            <div className="text-4xl mb-3">📭</div>
                            <p className="text-gray-400">No NFTs in pool</p>
                          </div>
                        ) : (
                          <div className={`grid ${gridSizeClasses[gridSize]} gap-2`}>
                            {displayedPoolNFTsForSwap.map((nft) => (
                              <button
                                key={nft.tokenId}
                                onClick={() => setSelectedPoolNFT(nft.tokenId)}
                                disabled={isBusy}
                                className={`relative rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02] ${
                                  selectedPoolNFT === nft.tokenId
                                    ? 'border-purple-500 ring-2 ring-purple-500/30'
                                    : 'border-gray-700 hover:border-gray-500'
                                }`}
                              >
                                <div className="aspect-square relative bg-gray-800">
                                  <img src={getNFTImageUrl(nft.imageUrl, nft.tokenId)} alt={nft.name} className="w-full h-full object-cover" />
                                  {selectedPoolNFT === nft.tokenId && (
                                    <div className="absolute inset-0 bg-purple-500/30 flex items-center justify-center">
                                      <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                                        <span className="text-white text-sm">✓</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="p-1.5 bg-gray-800 text-center">
                                  <div className="text-xs text-gray-300">#{nft.tokenId}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ===== WRAP/UNWRAP MODE - FULL SCREEN UNIFIED EXPERIENCE ===== */
                  <>
                    {/* Sticky Action Bar at Top */}
                    <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm -mx-6 px-6 md:-mx-8 md:px-8 pb-4 mb-4 border-b border-gray-800">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h2 className="text-xl font-bold text-white">Wrap & Unwrap</h2>
                          <p className="text-sm text-gray-400">
                            Balance: <span className="text-white font-medium">{tokenBalance.toFixed(2)} wASS</span> •
                            ETH: <span className="text-white font-medium">{parseFloat(ethBalance).toFixed(4)}</span>
                          </p>
                        </div>

                        {/* Quick Unwrap Controls in Header */}
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
                          <span className="text-sm text-green-400 font-medium">Unwrap:</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setUnwrapCount(Math.max(1, unwrapCount - 1))}
                              disabled={unwrapCount <= 1 || isBusy}
                              className="w-8 h-8 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={Math.floor(tokenBalance)}
                              value={unwrapCount}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                setUnwrapCount(Math.max(1, Math.min(Math.floor(tokenBalance), val)));
                              }}
                              disabled={isBusy}
                              className="w-16 h-8 text-center text-lg font-bold bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none"
                            />
                            <button
                              onClick={() => setUnwrapCount(Math.min(Math.floor(tokenBalance), unwrapCount + 1))}
                              disabled={unwrapCount >= Math.floor(tokenBalance) || isBusy}
                              className="w-8 h-8 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-xs text-gray-400">({unwrapFeeFormatted} ETH fee)</span>
                          <button
                            onClick={handleUnwrapNFTs}
                            disabled={isBusy || !hasEnoughTokensForUnwrap || !hasEnoughEthForUnwrap}
                            className={`px-4 py-2 rounded-lg font-bold transition-all ${
                              isBusy || !hasEnoughTokensForUnwrap || !hasEnoughEthForUnwrap
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-400 hover:to-emerald-400'
                            }`}
                          >
                            {isBusy ? '...' : `Get ${unwrapCount} NFT${unwrapCount > 1 ? 's' : ''}`}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Selection Controls Bar */}
                    <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">📦</span>
                        <div>
                          <span className="text-white font-bold">Wrap NFTs → Tokens</span>
                          <span className="text-gray-400 ml-3">
                            {selectedCount} selected = {selectedCount} wASS • Fee: {totalWrapFeeFormatted} ETH
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSelectAll}
                          disabled={selectedNFTs.size === displayedNFTs.length || displayedNFTs.length === 0 || isBusy}
                          className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 text-sm font-medium disabled:opacity-50"
                        >
                          All
                        </button>
                        <button
                          onClick={handleUnselectAll}
                          disabled={selectedNFTs.size === 0 || isBusy}
                          className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-sm font-medium disabled:opacity-50"
                        >
                          Clear
                        </button>
                        {selectedCount > 0 && (
                          <button
                            onClick={supportsAtomicBatch && !nftApproved ? handleApproveAndWrap : (nftApproved ? handleWrapNFTs : handleApproveNFT)}
                            disabled={isBusy || !hasEnoughEthForWrapFee}
                            className={`px-4 py-1.5 rounded-lg font-bold transition-all ${
                              isBusy || !hasEnoughEthForWrapFee
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:from-blue-400 hover:to-cyan-400'
                            }`}
                          >
                            {isBusy ? '...' : !nftApproved ? (supportsAtomicBatch ? 'Approve & Wrap' : 'Approve') : `Wrap ${selectedCount}`}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Full-Screen NFT Grid */}
                    <div className="overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/30 p-4" style={{ height: 'calc(100vh - 320px)' }}>
                      {nftsLoading ? (
                        <div className="flex justify-center items-center h-full">
                          <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        </div>
                      ) : displayedNFTs.length === 0 ? (
                        <div className="flex flex-col justify-center items-center h-full text-center">
                          <div className="text-6xl mb-4">🤷</div>
                          <h3 className="text-xl font-semibold text-white mb-2">No NFTs Found</h3>
                          <p className="text-gray-400 mb-6">You don&apos;t own any NFTs to wrap</p>
                          <button
                            onClick={() => setMode('buy')}
                            className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold hover:from-purple-400 hover:to-pink-400"
                          >
                            Get Your First NFT
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
                          {displayedNFTs.map((nft) => {
                            const isSelected = selectedNFTs.has(nft.tokenId);
                            return (
                              <button
                                key={nft.tokenId}
                                onClick={() => !isBusy && toggleNFT(nft.tokenId)}
                                disabled={isBusy}
                                className={`relative rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02] ${
                                  isSelected
                                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                                    : 'border-gray-700 hover:border-gray-500'
                                }`}
                              >
                                <div className="aspect-square relative bg-gray-800">
                                  <img src={getNFTImageUrl(nft.imageUrl, nft.tokenId)} alt={nft.name} className="w-full h-full object-cover" />
                                  <div className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                                    isSelected ? 'bg-blue-500 border-blue-400' : 'bg-gray-900/80 border-gray-500'
                                  }`}>
                                    {isSelected && <span className="text-white text-xs">✓</span>}
                                  </div>
                                </div>
                                <div className="p-2 bg-gray-800">
                                  <div className="font-medium text-white text-sm truncate">{nft.name}</div>
                                  <div className="text-xs text-gray-500">#{nft.tokenId}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Error Messages */}
                    {!hasEnoughEthForWrapFee && selectedCount > 0 && (
                      <p className="text-center text-red-400 text-sm mt-3">Insufficient ETH for wrap fee</p>
                    )}
                    {!hasEnoughTokensForUnwrap && (
                      <p className="text-center text-red-400 text-sm mt-3">Insufficient wASS tokens for unwrap</p>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
        </div>

        {/* CSS for animations */}
        <style jsx>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // ===== STANDALONE MODAL MODE (Original) =====
  const modalContent = (
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
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
                  NFT Hub
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                  Buy or wrap your NFTs
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

          {/* Mode Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              onClick={() => setMode('buy')}
              disabled={isBusy}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: mode === 'buy'
                  ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.9), rgba(139, 92, 246, 0.9))'
                  : 'rgba(75, 85, 99, 0.3)',
                border: mode === 'buy'
                  ? '2px solid rgba(168, 85, 247, 0.8)'
                  : '2px solid rgba(75, 85, 99, 0.4)',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                color: '#fff',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              🛒 Buy NFT
            </button>
            <button
              onClick={() => setMode('wrap')}
              disabled={isBusy}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: mode === 'wrap'
                  ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.9))'
                  : 'rgba(75, 85, 99, 0.3)',
                border: mode === 'wrap'
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
              🪙 Wrap NFT
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
                {mode === 'buy' ? (nftCount > 1 ? 'NFTs Acquired!' : 'NFT Acquired!') : 'NFTs Wrapped!'}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 24 }}>
                {mode === 'buy'
                  ? `Your new human${nftCount > 1 ? 's are' : ' is'} waiting in your wallet`
                  : 'Your NFTs have been converted to tokens'}
              </div>
              <button
                onClick={() => {
                  setTxStep('idle');
                  if (mode === 'wrap') {
                    setWrappedNFTs(new Set());
                    refetchNFTs();
                    refetchTokenBalance();
                  }
                }}
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
                {mode === 'buy' ? 'Done' : 'Continue'}
              </button>
            </div>
          ) : mode === 'wrap' ? (
            /* ===== WRAP MODE UI ===== */
            <>
              {/* Sub-Mode Tabs - hidden when swapOnly */}
              {!swapOnly && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                <button
                  onClick={() => setWrapSubMode('wrap')}
                  disabled={isBusy}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: wrapSubMode === 'wrap'
                      ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.9))'
                      : 'rgba(75, 85, 99, 0.3)',
                    border: wrapSubMode === 'wrap'
                      ? '2px solid rgba(59, 130, 246, 0.8)'
                      : '2px solid rgba(75, 85, 99, 0.4)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Wrap
                </button>
                <button
                  onClick={() => setWrapSubMode('unwrap')}
                  disabled={isBusy}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: wrapSubMode === 'unwrap'
                      ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.9), rgba(22, 163, 74, 0.9))'
                      : 'rgba(75, 85, 99, 0.3)',
                    border: wrapSubMode === 'unwrap'
                      ? '2px solid rgba(34, 197, 94, 0.8)'
                      : '2px solid rgba(75, 85, 99, 0.4)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Unwrap
                </button>
                <button
                  onClick={() => setWrapSubMode('swap')}
                  disabled={isBusy}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: wrapSubMode === 'swap'
                      ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.9), rgba(139, 92, 246, 0.9))'
                      : 'rgba(75, 85, 99, 0.3)',
                    border: wrapSubMode === 'swap'
                      ? '2px solid rgba(168, 85, 247, 0.8)'
                      : '2px solid rgba(75, 85, 99, 0.4)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Swap
                </button>
              </div>
              )}

              {wrapSubMode === 'wrap' ? (
                /* ===== WRAP SUB-MODE ===== */
                <>
                  {/* Wrap Description */}
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                      Convert your NFTs to fungible wASS tokens
                    </div>
                  </div>

              {/* Selection Controls */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                paddingBottom: 12,
                borderBottom: '1px solid rgba(75, 85, 99, 0.4)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                    {selectedCount} NFT{selectedCount !== 1 ? 's' : ''} selected
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                    Fee: {totalWrapFeeFormatted} ETH
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleSelectAll}
                    disabled={selectedNFTs.size === displayedNFTs.length || displayedNFTs.length === 0 || isBusy}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(59, 130, 246, 0.3)',
                      border: '1px solid rgba(59, 130, 246, 0.5)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#fff',
                      cursor: 'pointer',
                      opacity: (selectedNFTs.size === displayedNFTs.length || displayedNFTs.length === 0 || isBusy) ? 0.5 : 1,
                    }}
                  >
                    Select All
                  </button>
                  <button
                    onClick={handleUnselectAll}
                    disabled={selectedNFTs.size === 0 || isBusy}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(75, 85, 99, 0.3)',
                      border: '1px solid rgba(75, 85, 99, 0.5)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#fff',
                      cursor: 'pointer',
                      opacity: (selectedNFTs.size === 0 || isBusy) ? 0.5 : 1,
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* NFT Grid */}
              {nftsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    border: '3px solid rgba(59, 130, 246, 0.3)',
                    borderTopColor: 'rgba(59, 130, 246, 1)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                </div>
              ) : displayedNFTs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🤷</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
                    No NFTs Found
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)' }}>
                    You don&apos;t own any NFTs to wrap
                  </div>
                  <button
                    onClick={() => setMode('buy')}
                    style={{
                      marginTop: 16,
                      padding: '10px 20px',
                      background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.9), rgba(139, 92, 246, 0.9))',
                      border: '2px solid rgba(168, 85, 247, 0.8)',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    Get Your First NFT
                  </button>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  maxHeight: 280,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}>
                  {displayedNFTs.map((nft) => {
                    const isSelected = selectedNFTs.has(nft.tokenId);
                    return (
                      <button
                        key={nft.tokenId}
                        onClick={() => !isBusy && toggleNFT(nft.tokenId)}
                        disabled={isBusy}
                        style={{
                          position: 'relative',
                          borderRadius: 10,
                          overflow: 'hidden',
                          border: isSelected
                            ? '2px solid rgba(59, 130, 246, 0.8)'
                            : '2px solid rgba(75, 85, 99, 0.4)',
                          background: 'rgba(17, 24, 39, 0.8)',
                          cursor: isBusy ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                          transform: isSelected ? 'scale(0.95)' : 'scale(1)',
                          boxShadow: isSelected ? '0 0 15px rgba(59, 130, 246, 0.4)' : 'none',
                        }}
                      >
                        {/* Selection Indicator */}
                        <div style={{
                          position: 'absolute',
                          top: 6,
                          left: 6,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: '2px solid',
                          borderColor: isSelected ? 'rgba(59, 130, 246, 1)' : 'rgba(75, 85, 99, 0.6)',
                          background: isSelected ? 'rgba(59, 130, 246, 1)' : 'rgba(17, 24, 39, 0.8)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          zIndex: 1,
                        }}>
                          {isSelected && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                        </div>

                        {/* NFT Image */}
                        <div style={{ aspectRatio: '1', position: 'relative' }}>
                          <img
                            src={getNFTImageUrl(nft.imageUrl, nft.tokenId)}
                            alt={nft.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>

                        {/* NFT Info */}
                        <div style={{ padding: 6, background: 'rgba(17, 24, 39, 0.9)' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {nft.name}
                          </div>
                          <div style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.5)' }}>
                            #{nft.tokenId}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Insufficient ETH Warning */}
              {selectedCount > 0 && !hasEnoughEthForWrapFee && (
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: 10,
                  textAlign: 'center',
                }}>
                  <span style={{ color: 'rgba(239, 68, 68, 1)', fontSize: 12 }}>
                    Insufficient ETH for wrap fee. Need {totalWrapFeeFormatted} ETH
                  </span>
                </div>
              )}

              {/* Wrap Action Button */}
              {displayedNFTs.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {!nftApproved ? (
                    <button
                      onClick={supportsAtomicBatch ? handleApproveAndWrap : handleApproveNFT}
                      disabled={isBusy || (supportsAtomicBatch && selectedCount === 0) || !hasEnoughEthForWrapFee}
                      style={{
                        width: '100%',
                        padding: 14,
                        background: isBusy
                          ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                          : 'linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.95))',
                        border: '2px solid rgba(251, 191, 36, 0.5)',
                        borderRadius: 12,
                        fontSize: 16,
                        fontWeight: 700,
                        color: '#fff',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: (isBusy || (supportsAtomicBatch && selectedCount === 0) || !hasEnoughEthForWrapFee) ? 0.7 : 1,
                      }}
                    >
                      {isBusy
                        ? '⚡ Processing...'
                        : supportsAtomicBatch
                          ? `⚡ Approve & Wrap ${selectedCount} NFT${selectedCount !== 1 ? 's' : ''}`
                          : '✅ Approve Wrapper Contract'}
                    </button>
                  ) : (
                    <button
                      onClick={handleWrapNFTs}
                      disabled={selectedCount === 0 || isBusy || !hasEnoughEthForWrapFee}
                      style={{
                        width: '100%',
                        padding: 14,
                        background: isBusy
                          ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                          : 'linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95))',
                        border: '2px solid rgba(59, 130, 246, 0.5)',
                        borderRadius: 12,
                        fontSize: 16,
                        fontWeight: 700,
                        color: '#fff',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: (selectedCount === 0 || isBusy || !hasEnoughEthForWrapFee) ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      <span>🪙</span>
                      <span>
                        {isBusy
                          ? 'Processing...'
                          : `Wrap ${selectedCount} NFT${selectedCount !== 1 ? 's' : ''} for ${totalWrapFeeFormatted} ETH`}
                      </span>
                    </button>
                  )}
                </div>
              )}
                </>
              ) : wrapSubMode === 'unwrap' ? (
                /* ===== UNWRAP SUB-MODE ===== */
                <>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                      Convert wASS tokens back to NFTs (FIFO)
                    </div>
                  </div>

                  {/* Unwrap Form */}
                  <div style={{
                    backgroundColor: 'rgba(17, 24, 39, 0.8)',
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 16,
                    border: '1px solid rgba(34, 197, 94, 0.5)',
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* Left: Balance & Input */}
                      <div>
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 4 }}>
                            Your Balance
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
                            {tokenBalance.toFixed(2)} wASS
                          </div>
                        </div>
                        <label style={{ display: 'block', fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 6 }}>
                          Amount to unwrap
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={unwrapCount}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value.includes('.')) {
                              setUnwrapError('Whole numbers only');
                              return;
                            }
                            const num = parseInt(value) || 0;
                            if (num < 1) {
                              setUnwrapError('Must be at least 1');
                              setUnwrapCount(0);
                            } else {
                              setUnwrapError('');
                              setUnwrapCount(num);
                            }
                          }}
                          style={{
                            width: '100%',
                            backgroundColor: 'rgba(17, 24, 39, 0.8)',
                            border: `1px solid ${unwrapError ? 'rgba(239, 68, 68, 0.6)' : 'rgba(75, 85, 99, 0.4)'}`,
                            borderRadius: 8,
                            padding: 10,
                            color: '#fff',
                            textAlign: 'center',
                            fontSize: 18,
                            fontWeight: 700,
                            outline: 'none',
                          }}
                        />
                        {unwrapError && (
                          <div style={{ fontSize: 11, color: 'rgba(239, 68, 68, 1)', marginTop: 6 }}>
                            {unwrapError}
                          </div>
                        )}
                        {!unwrapError && (
                          <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', marginTop: 6 }}>
                            Fee: {unwrapFeeFormatted} ETH
                          </div>
                        )}
                      </div>
                      {/* Right: You Receive */}
                      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 6 }}>
                          You receive
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <div style={{ fontSize: 26, fontWeight: 700, color: 'rgba(34, 197, 94, 1)' }}>
                            {unwrapCount}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
                            NFT{unwrapCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Insufficient Balance Warning */}
                  {!hasEnoughTokensForUnwrap && unwrapCount > 0 && (
                    <div style={{
                      marginBottom: 16,
                      padding: 12,
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: 10,
                      textAlign: 'center',
                    }}>
                      <span style={{ color: 'rgba(239, 68, 68, 1)', fontSize: 12 }}>
                        Insufficient wASS balance. You have {tokenBalance.toFixed(2)} wASS.
                      </span>
                    </div>
                  )}

                  {!hasEnoughEthForUnwrap && unwrapCount > 0 && hasEnoughTokensForUnwrap && (
                    <div style={{
                      marginBottom: 16,
                      padding: 12,
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: 10,
                      textAlign: 'center',
                    }}>
                      <span style={{ color: 'rgba(239, 68, 68, 1)', fontSize: 12 }}>
                        Insufficient ETH for unwrap fee. Need {unwrapFeeFormatted} ETH
                      </span>
                    </div>
                  )}

                  {/* Unwrap Button */}
                  <button
                    onClick={handleUnwrapNFTs}
                    disabled={
                      !!unwrapError ||
                      unwrapCount < 1 ||
                      !hasEnoughTokensForUnwrap ||
                      !hasEnoughEthForUnwrap ||
                      isBusy
                    }
                    style={{
                      width: '100%',
                      padding: 14,
                      background: isBusy
                        ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                        : 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))',
                      border: '2px solid rgba(34, 197, 94, 0.5)',
                      borderRadius: 12,
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#fff',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                      opacity: (!!unwrapError || unwrapCount < 1 || !hasEnoughTokensForUnwrap || !hasEnoughEthForUnwrap || isBusy) ? 0.7 : 1,
                    }}
                  >
                    {isBusy
                      ? 'Unwrapping...'
                      : `Unwrap ${unwrapCount} NFT${unwrapCount !== 1 ? 's' : ''} for ${unwrapFeeFormatted} ETH`}
                  </button>
                </>
              ) : (
                /* ===== SWAP SUB-MODE ===== */
                <>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
                      Trade your NFT for another from the pool
                    </div>
                  </div>

                  {/* Step indicator */}
                  <div style={{
                    textAlign: 'center',
                    marginBottom: 12,
                    padding: 8,
                    background: 'rgba(168, 85, 247, 0.1)',
                    borderRadius: 8,
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                  }}>
                    <span style={{ fontSize: 12, color: 'rgba(168, 85, 247, 1)' }}>
                      {selectedPoolNFT === null
                        ? 'Step 1: Select an NFT you want from the pool'
                        : selectedUserNFTForSwap === null
                          ? 'Step 2: Select your NFT to trade'
                          : '✓ Ready to swap!'}
                    </span>
                  </div>

                  {/* Step 1: Pool NFTs Selection */}
                  {selectedPoolNFT === null ? (
                    <>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                      }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                          Pool NFTs ({poolTotalHeld})
                        </div>
                        <button
                          onClick={() => refetchPoolNFTs()}
                          disabled={poolNFTsLoading}
                          style={{
                            padding: '4px 8px',
                            background: 'rgba(168, 85, 247, 0.3)',
                            border: '1px solid rgba(168, 85, 247, 0.5)',
                            borderRadius: 6,
                            fontSize: 11,
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          {poolNFTsLoading ? '...' : '↻'}
                        </button>
                      </div>

                      {poolNFTsLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                          <div style={{
                            width: 40,
                            height: 40,
                            border: '3px solid rgba(168, 85, 247, 0.3)',
                            borderTopColor: 'rgba(168, 85, 247, 1)',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                          }} />
                        </div>
                      ) : displayedPoolNFTsForSwap.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px 0' }}>
                          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                          <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.6)' }}>
                            No NFTs in pool
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gap: 6,
                          maxHeight: 220,
                          overflowY: 'auto',
                          paddingRight: 4,
                        }}>
                          {displayedPoolNFTsForSwap.map((nft) => (
                            <button
                              key={nft.tokenId}
                              onClick={() => setSelectedPoolNFT(nft.tokenId)}
                              style={{
                                position: 'relative',
                                borderRadius: 8,
                                overflow: 'hidden',
                                border: '1px solid rgba(75, 85, 99, 0.4)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                background: 'rgba(17, 24, 39, 0.8)',
                              }}
                            >
                              <div style={{ aspectRatio: '1', position: 'relative' }}>
                                <img
                                  src={getNFTImageUrl(nft.imageUrl, nft.tokenId)}
                                  alt={nft.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <div style={{ padding: 4, background: 'rgba(17, 24, 39, 0.9)' }}>
                                <div style={{ fontSize: 9, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  #{nft.tokenId}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : selectedUserNFTForSwap === null ? (
                    /* Step 2: Select your NFT to trade */
                    <>
                      {/* Show selected pool NFT */}
                      <div style={{
                        backgroundColor: 'rgba(168, 85, 247, 0.1)',
                        border: '1px solid rgba(168, 85, 247, 0.5)',
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>You will receive:</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>#{selectedPoolNFT}</span>
                        </div>
                        <button
                          onClick={() => setSelectedPoolNFT(null)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(239, 68, 68, 1)',
                            fontSize: 11,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Change
                        </button>
                      </div>

                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
                        Select your NFT to trade ({displayedUserNFTsForSwap.length})
                      </div>

                      {nftsLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                          <div style={{
                            width: 40,
                            height: 40,
                            border: '3px solid rgba(59, 130, 246, 0.3)',
                            borderTopColor: 'rgba(59, 130, 246, 1)',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                          }} />
                        </div>
                      ) : displayedUserNFTsForSwap.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px 0' }}>
                          <div style={{ fontSize: 32, marginBottom: 8 }}>🤷</div>
                          <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.6)' }}>
                            You don&apos;t have any NFTs to swap
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gap: 6,
                          maxHeight: 180,
                          overflowY: 'auto',
                          paddingRight: 4,
                        }}>
                          {displayedUserNFTsForSwap.map((nft) => (
                            <button
                              key={nft.tokenId}
                              onClick={() => setSelectedUserNFTForSwap(nft.tokenId)}
                              style={{
                                position: 'relative',
                                borderRadius: 8,
                                overflow: 'hidden',
                                border: '1px solid rgba(75, 85, 99, 0.4)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                background: 'rgba(17, 24, 39, 0.8)',
                              }}
                            >
                              <div style={{ aspectRatio: '1', position: 'relative' }}>
                                <img
                                  src={getNFTImageUrl(nft.imageUrl, nft.tokenId)}
                                  alt={nft.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <div style={{ padding: 4, background: 'rgba(17, 24, 39, 0.9)' }}>
                                <div style={{ fontSize: 9, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  #{nft.tokenId}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Step 3: Confirm swap */
                    <>
                      <div style={{
                        backgroundColor: 'rgba(17, 24, 39, 0.8)',
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 16,
                        border: '1px solid rgba(168, 85, 247, 0.5)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', marginBottom: 16 }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 4 }}>You give</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(239, 68, 68, 1)' }}>#{selectedUserNFTForSwap}</div>
                          </div>
                          <div style={{ fontSize: 24 }}>→</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 4 }}>You get</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(34, 197, 94, 1)' }}>#{selectedPoolNFT}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', paddingTop: 12, borderTop: '1px solid rgba(75, 85, 99, 0.4)' }}>
                          <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>Swap fee: </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{swapFeeFormatted} ETH</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        <button
                          onClick={() => {
                            setSelectedPoolNFT(null);
                            setSelectedUserNFTForSwap(null);
                          }}
                          style={{
                            flex: 1,
                            padding: 10,
                            background: 'rgba(75, 85, 99, 0.3)',
                            border: '1px solid rgba(75, 85, 99, 0.5)',
                            borderRadius: 8,
                            fontSize: 12,
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          Start Over
                        </button>
                        <button
                          onClick={() => setSelectedUserNFTForSwap(null)}
                          style={{
                            flex: 1,
                            padding: 10,
                            background: 'rgba(59, 130, 246, 0.3)',
                            border: '1px solid rgba(59, 130, 246, 0.5)',
                            borderRadius: 8,
                            fontSize: 12,
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          Change My NFT
                        </button>
                      </div>

                      {!hasEnoughEthForSwap && (
                        <div style={{
                          marginBottom: 12,
                          padding: 12,
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          borderRadius: 10,
                          textAlign: 'center',
                        }}>
                          <span style={{ color: 'rgba(239, 68, 68, 1)', fontSize: 12 }}>
                            Insufficient ETH for swap fee. Need {swapFeeFormatted} ETH
                          </span>
                        </div>
                      )}

                      {/* Swap Button */}
                      {!nftApproved ? (
                        <button
                          onClick={handleSwapNFTs}
                          disabled={isBusy || !hasEnoughEthForSwap}
                          style={{
                            width: '100%',
                            padding: 14,
                            background: isBusy
                              ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                              : 'linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.95))',
                            border: '2px solid rgba(251, 191, 36, 0.5)',
                            borderRadius: 12,
                            fontSize: 16,
                            fontWeight: 700,
                            color: '#fff',
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            opacity: (isBusy || !hasEnoughEthForSwap) ? 0.7 : 1,
                          }}
                        >
                          {isBusy
                            ? '⚡ Processing...'
                            : supportsAtomicBatch
                              ? `⚡ Approve & Swap for ${swapFeeFormatted} ETH`
                              : '✅ Approve NFT First'}
                        </button>
                      ) : (
                        <button
                          onClick={handleSwapNFTs}
                          disabled={isBusy || !hasEnoughEthForSwap}
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
                            opacity: (isBusy || !hasEnoughEthForSwap) ? 0.7 : 1,
                          }}
                        >
                          {isBusy ? 'Swapping...' : `🔄 Swap for ${swapFeeFormatted} ETH`}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}

              {/* CSS for spinner animation */}
              <style jsx>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </>
          ) : (
            /* ===== BUY MODE UI ===== */
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
                        {totalBuyWrapFee.toFixed(6)} ETH
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
                          {totalWassCost} wASS + {totalBuyWrapFee.toFixed(6)} ETH
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
                    Insufficient ETH for wrap fee. Need {totalBuyWrapFee.toFixed(6)} ETH
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
  );

  // For embedded mode, just return the content directly (no backdrop/fixed wrapper)
  if (embedded) {
    return modalContent;
  }

  // For standalone mode, wrap in backdrop and fixed container
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        {modalContent}
      </div>
    </>
  );
}
