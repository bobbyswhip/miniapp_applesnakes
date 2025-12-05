'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useBalance, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useRouter } from 'next/navigation';
import { base } from 'wagmi/chains';
import { formatEther, formatUnits } from 'viem';
import { getContracts } from '@/config';
import { useNFTContext } from '@/contexts/NFTContext';
import { useInventory } from '@/contexts/InventoryContext';
import { useTransactions } from '@/contexts/TransactionContext';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { useBatchTransaction } from '@/hooks/useBatchTransaction';
import { UserNFT, NFTType } from '@/hooks/useUserNFTs';

// Extended NFT type to include staking status
interface InventoryNFT extends UserNFT {
  isStaked?: boolean;
}

type InventoryTab = 'collection' | 'staked';

export function InventorySack() {
  const router = useRouter();
  const [viewingNFT, setViewingNFT] = useState<InventoryNFT | null>(null);
  const [stakedNFTs, setStakedNFTs] = useState<InventoryNFT[]>([]);
  const [isLoadingStaked, setIsLoadingStaked] = useState(false);
  const [activeTab, setActiveTab] = useState<InventoryTab>('collection');
  const [hasSetInitialTab, setHasSetInitialTab] = useState(false);
  const [selectedNFTs, setSelectedNFTs] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [currentOperation, setCurrentOperation] = useState<'approve' | 'stake' | 'unstake' | 'wrap' | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<string>('');

  const { isOpen, setIsOpen, openNFTHub } = useInventory();
  const { address: userAddress, isConnected, isReconnecting } = useAccount();
  const { nfts, isLoading, refetch: refetchNFTs } = useNFTContext();
  const { addTransaction } = useTransactions();
  const contracts = getContracts(base.id);
  const publicClient = usePublicClient({ chainId: base.id });

  // Smart wallet detection for batch transactions
  const { supportsAtomicBatch } = useSmartWallet();
  const {
    executeBatch,
    isPending: isBatchPending,
    isConfirming: isBatchConfirming,
    isSuccess: isBatchSuccess,
    reset: resetBatch,
  } = useBatchTransaction();

  // Contract write hooks
  const { writeContractAsync, data: txHash, isPending: isWritePending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Use address presence as connection indicator (more reliable than isConnected)
  const isWalletConnected = !!userAddress;

  // Get wToken balance
  const { data: wTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    chainId: base.id,
  });

  // Get ETH balance
  const { data: ethBalance } = useBalance({
    address: userAddress,
    chainId: base.id,
  });

  // Get staked token IDs
  const { data: stakedData } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'getStakedTokenIdsPaginated',
    args: userAddress ? [userAddress, BigInt(0), BigInt(100)] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // Get pending rewards
  const { data: pendingRewardsData } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'pendingRewards',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
      refetchInterval: 10000, // Refetch every 10 seconds
    },
  });

  // Get user staking stats
  const { data: userStats } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'getUserStats',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
      refetchInterval: 10000,
    },
  });

  // Check if staking contract is approved to transfer NFTs
  const { data: isApproved, refetch: refetchApproval } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: userAddress ? [userAddress, contracts.staking.address] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // Refetch staked data function
  const { refetch: refetchStaked } = useReadContract({
    address: contracts.staking.address,
    abi: contracts.staking.abi,
    functionName: 'getStakedTokenIdsPaginated',
    args: userAddress ? [userAddress, BigInt(0), BigInt(100)] : undefined,
    query: {
      enabled: false, // We'll manually trigger this
    },
  });

  // Extract staked token IDs
  const stakedTokenIds = stakedData && Array.isArray(stakedData) && stakedData.length > 0
    ? (stakedData[0] as bigint[]).map(id => Number(id))
    : [];

  // Fetch full NFT data for staked tokens
  useEffect(() => {
    if (!publicClient || stakedTokenIds.length === 0) {
      setStakedNFTs([]);
      setIsLoadingStaked(false);
      return;
    }

    const fetchStakedNFTs = async () => {
      setIsLoadingStaked(true);

      try {
        // TokenInfo interface from contract
        interface TokenInfo {
          tokenId: bigint;
          owner: string;
          exists: boolean;
          isSnake: boolean;
          isJailed: boolean;
          jailTime: bigint;
          isEgg: boolean;
          mintTime: bigint;
          forceHatched: boolean;
          evolved: boolean;
          ownerIsWarden: boolean;
          ownerIsJailExempt: boolean;
          swapMintTime: bigint;
          canUnwrap: boolean;
        }

        // Batch call getTokenInfo for all staked tokens
        const tokenInfoResults = await publicClient.readContract({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'getTokenInfo',
          args: [stakedTokenIds.map(id => BigInt(id))],
        }) as TokenInfo[];

        // Batch fetch tokenURI
        const tokenURIResults = await publicClient.multicall({
          contracts: stakedTokenIds.map(tokenId => ({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'tokenURI' as const,
            args: [BigInt(tokenId)],
          })),
          allowFailure: true,
        });

        // Build InventoryNFT objects
        const stakedNFTObjects: InventoryNFT[] = [];

        for (let i = 0; i < stakedTokenIds.length; i++) {
          const tokenId = stakedTokenIds[i];
          const tokenInfo = tokenInfoResults[i];
          const tokenURIResult = tokenURIResults[i];

          // Get metadata from tokenURI
          let metadata: {
            name: string;
            description?: string;
            image: string;
            attributes?: Array<{ trait_type: string; value: string | number }>;
            [key: string]: unknown;
          } = {
            name: `AppleSnake #${tokenId}`,
            description: '',
            image: `${tokenId}.png`,
            attributes: [],
          };

          if (tokenURIResult.status === 'success' && tokenURIResult.result) {
            try {
              const uri = tokenURIResult.result as string;
              let metadataUrl = uri;
              if (uri.startsWith('ipfs://')) {
                metadataUrl = uri.replace('ipfs://', 'https://surrounding-amaranth-catshark.myfilebase.com/ipfs/');
              } else if (uri.startsWith('data:application/json;base64,')) {
                const base64Data = uri.replace('data:application/json;base64,', '');
                const jsonString = atob(base64Data);
                metadata = JSON.parse(jsonString);
              }

              if (metadataUrl.startsWith('http')) {
                const metadataResponse = await fetch(metadataUrl);
                if (metadataResponse.ok) {
                  metadata = await metadataResponse.json();
                }
              }
            } catch {
              // Use default metadata on error
            }
          }

          // Determine NFT type
          let nftType: NFTType = 'human';
          if (tokenInfo.isSnake) nftType = 'snake';
          else if (tokenInfo.isEgg) nftType = 'egg';
          else if (tokenInfo.ownerIsWarden) nftType = 'warden';

          // Extract image URL
          let imageUrl = metadata.image || `${tokenId}.png`;
          if (imageUrl.startsWith('ipfs://')) {
            imageUrl = imageUrl.replace('ipfs://', '');
          }

          const inventoryNFT: InventoryNFT = {
            tokenId,
            imageUrl,
            name: metadata.name || `AppleSnake #${tokenId}`,
            nftType,
            owner: tokenInfo.owner,
            exists: tokenInfo.exists,
            isSnake: tokenInfo.isSnake,
            isJailed: tokenInfo.isJailed,
            jailTime: Number(tokenInfo.jailTime),
            isEgg: tokenInfo.isEgg,
            mintTime: Number(tokenInfo.mintTime),
            forceHatched: tokenInfo.forceHatched,
            evolved: tokenInfo.evolved,
            ownerIsWarden: tokenInfo.ownerIsWarden,
            ownerIsJailExempt: tokenInfo.ownerIsJailExempt,
            swapMintTime: Number(tokenInfo.swapMintTime),
            canUnwrap: tokenInfo.canUnwrap,
            metadata,
            isStaked: true,
          };

          stakedNFTObjects.push(inventoryNFT);
        }

        setStakedNFTs(stakedNFTObjects);
        setIsLoadingStaked(false);
      } catch (error) {
        console.error('Error fetching staked NFTs:', error);
        setStakedNFTs([]);
        setIsLoadingStaked(false);
      }
    };

    fetchStakedNFTs();
  }, [stakedTokenIds.length, publicClient, contracts.nft.address, contracts.nft.abi]);

  // Lock body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen]);

  const wTokenBalanceFormatted = wTokenBalance ? Number(wTokenBalance) / 1e18 : 0;
  const ethBalanceFormatted = ethBalance ? parseFloat(formatEther(ethBalance.value)) : 0;

  // Staking info formatting
  const pendingRewardsFormatted = pendingRewardsData
    ? parseFloat(formatUnits(pendingRewardsData as bigint, 18)).toFixed(4)
    : '0.0000';
  const stakedCount = userStats ? Number((userStats as [bigint])[0]) : 0;

  // Separate collection NFTs (owned, not staked)
  const collectionNFTs: InventoryNFT[] = nfts.map(nft => ({ ...nft, isStaked: false }));

  // Combine regular NFTs with staked NFTs for total count
  const allNFTs: InventoryNFT[] = [...collectionNFTs, ...stakedNFTs];

  // Filter NFTs based on active tab
  const displayedNFTs = activeTab === 'collection' ? collectionNFTs : stakedNFTs;

  // Set initial tab based on which has more NFTs (only once after loading)
  useEffect(() => {
    if (!isLoading && !isLoadingStaked && !hasSetInitialTab) {
      // Default to whichever tab has more NFTs
      if (stakedNFTs.length > nfts.length) {
        setActiveTab('staked');
      } else {
        setActiveTab('collection');
      }
      setHasSetInitialTab(true);
    }
  }, [isLoading, isLoadingStaked, hasSetInitialTab, nfts.length, stakedNFTs.length]);

  // Reset initial tab flag when inventory closes
  useEffect(() => {
    if (!isOpen) {
      setHasSetInitialTab(false);
    }
  }, [isOpen]);

  // Handle buy NFT action
  const handleBuyNFT = () => {
    setIsOpen(false);
    router.push('/?fastTravelMint=true');
  };

  // Toggle selection for an NFT
  const toggleSelection = useCallback((tokenId: number) => {
    setSelectedNFTs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tokenId)) {
        newSet.delete(tokenId);
      } else {
        newSet.add(tokenId);
      }
      // Enable selection mode if we have selections
      if (newSet.size > 0 && !isSelectionMode) {
        setIsSelectionMode(true);
      } else if (newSet.size === 0) {
        setIsSelectionMode(false);
      }
      return newSet;
    });
  }, [isSelectionMode]);

  // Clear all selections
  const clearSelections = useCallback(() => {
    setSelectedNFTs(new Set());
    setIsSelectionMode(false);
  }, []);

  // Handle NFT click (toggle selection or view details)
  const handleNFTInteraction = useCallback((nft: InventoryNFT, e: React.MouseEvent) => {
    if (isSelectionMode || e.shiftKey) {
      // In selection mode or shift+click: toggle selection
      toggleSelection(nft.tokenId);
    } else {
      // Normal click: view NFT details inline
      setViewingNFT(nft);
    }
  }, [isSelectionMode, toggleSelection]);

  // Close detail view and return to grid
  const closeDetailView = useCallback(() => {
    setViewingNFT(null);
  }, []);

  // Get selected NFTs data
  const selectedNFTsData = displayedNFTs.filter(nft => selectedNFTs.has(nft.tokenId));
  const selectedSnakes = selectedNFTsData.filter(nft => nft.isSnake);
  const selectedForStake = activeTab === 'collection' ? selectedSnakes : [];
  const selectedForUnstake = activeTab === 'staked' ? selectedSnakes : [];

  // Handle approve staking contract
  const handleApprove = async () => {
    if (!userAddress) return;
    setCurrentOperation('approve');

    try {
      const hash = await writeContractAsync({
        address: contracts.nft.address,
        abi: contracts.nft.abi,
        functionName: 'setApprovalForAll',
        args: [contracts.staking.address, true],
      });

      addTransaction(hash, 'Approving staking contract');
    } catch (error) {
      console.error('Approve error:', error);
      setCurrentOperation(null);
    }
  };

  // Handle stake action
  const handleStake = async () => {
    if (selectedForStake.length === 0 || !userAddress) return;
    setCurrentOperation('stake');

    try {
      const tokenIds = selectedForStake.map(nft => BigInt(nft.tokenId));
      const hash = await writeContractAsync({
        address: contracts.staking.address,
        abi: contracts.staking.abi,
        functionName: 'stake',
        args: [tokenIds],
      });

      addTransaction(hash, `Staking ${selectedForStake.length} snake${selectedForStake.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Stake error:', error);
      setCurrentOperation(null);
    }
  };

  // Combined approve + stake for smart wallets
  const handleApproveAndStake = async () => {
    if (selectedForStake.length === 0 || !userAddress) return;
    setCurrentOperation('stake');

    const tokenIds = selectedForStake.map(nft => BigInt(nft.tokenId));

    try {
      await executeBatch([
        {
          address: contracts.nft.address,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.staking.address, true],
        },
        {
          address: contracts.staking.address,
          abi: contracts.staking.abi,
          functionName: 'stake',
          args: [tokenIds],
        },
      ]);

      addTransaction('0x' as `0x${string}`, `Approving & Staking ${selectedForStake.length} snake${selectedForStake.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Approve and stake error:', error);
      setCurrentOperation(null);
    }
  };

  // Handle unstake action
  const handleUnstake = async () => {
    if (selectedForUnstake.length === 0 || !userAddress) return;
    setCurrentOperation('unstake');

    try {
      const tokenIds = selectedForUnstake.map(nft => BigInt(nft.tokenId));
      const hash = await writeContractAsync({
        address: contracts.staking.address,
        abi: contracts.staking.abi,
        functionName: 'unstake',
        args: [tokenIds],
      });

      addTransaction(hash, `Unstaking ${selectedForUnstake.length} snake${selectedForUnstake.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Unstake error:', error);
      setCurrentOperation(null);
    }
  };

  // Handle wrap action - open NFT Hub with wrap mode
  const handleWrap = () => {
    setIsOpen(false);
    openNFTHub('wrap');
  };

  // Refetch when transaction confirms
  useEffect(() => {
    if (isConfirmed) {
      refetchStaked();
      refetchNFTs();
      refetchApproval();
      clearSelections();
      setCurrentOperation(null);
    }
  }, [isConfirmed, refetchStaked, refetchNFTs, refetchApproval, clearSelections]);

  // Handle batch transaction success
  useEffect(() => {
    if (isBatchSuccess) {
      refetchStaked();
      refetchNFTs();
      refetchApproval();
      clearSelections();
      setCurrentOperation(null);
      resetBatch();
    }
  }, [isBatchSuccess, refetchStaked, refetchNFTs, refetchApproval, clearSelections, resetBatch]);

  // Clear selections when switching tabs
  useEffect(() => {
    clearSelections();
  }, [activeTab, clearSelections]);

  // Clear selections when closing inventory
  useEffect(() => {
    if (!isOpen) {
      clearSelections();
    }
  }, [isOpen, clearSelections]);

  // Check if any operation is in progress
  const isProcessing = isWritePending || isConfirming || isBatchPending || isBatchConfirming;

  // Cooldown timer for wrap cooldown
  useEffect(() => {
    if (!viewingNFT || viewingNFT.canUnwrap) {
      setCooldownRemaining('');
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const cooldownEnd = viewingNFT.swapMintTime + 3600; // 1 hour
      const remaining = cooldownEnd - now;

      if (remaining <= 0) {
        setCooldownRemaining('Ready');
      } else {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        setCooldownRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [viewingNFT]);

  // Close detail view when inventory closes
  useEffect(() => {
    if (!isOpen) {
      setViewingNFT(null);
    }
  }, [isOpen]);

  // Single NFT action handlers (from detail view)
  const handleSingleStake = async () => {
    if (!viewingNFT || !viewingNFT.isSnake || !userAddress) return;
    setCurrentOperation('stake');

    try {
      if (!isApproved && supportsAtomicBatch) {
        // Smart wallet: batch approve + stake
        await executeBatch([
          {
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'setApprovalForAll',
            args: [contracts.staking.address, true],
          },
          {
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'stake',
            args: [[BigInt(viewingNFT.tokenId)]],
          },
        ]);
        addTransaction('0x' as `0x${string}`, `Staking snake #${viewingNFT.tokenId}`);
      } else if (!isApproved) {
        // EOA: need to approve first
        const hash = await writeContractAsync({
          address: contracts.nft.address,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.staking.address, true],
        });
        addTransaction(hash, 'Approving staking contract');
      } else {
        // Already approved: just stake
        const hash = await writeContractAsync({
          address: contracts.staking.address,
          abi: contracts.staking.abi,
          functionName: 'stake',
          args: [[BigInt(viewingNFT.tokenId)]],
        });
        addTransaction(hash, `Staking snake #${viewingNFT.tokenId}`);
      }
      setViewingNFT(null);
    } catch (error) {
      console.error('Stake error:', error);
      setCurrentOperation(null);
    }
  };

  const handleSingleUnstake = async () => {
    if (!viewingNFT || !viewingNFT.isStaked || !userAddress) return;
    setCurrentOperation('unstake');

    try {
      const hash = await writeContractAsync({
        address: contracts.staking.address,
        abi: contracts.staking.abi,
        functionName: 'unstake',
        args: [[BigInt(viewingNFT.tokenId)]],
      });
      addTransaction(hash, `Unstaking snake #${viewingNFT.tokenId}`);
      setViewingNFT(null);
    } catch (error) {
      console.error('Unstake error:', error);
      setCurrentOperation(null);
    }
  };

  // Navigate to specific game locations
  const navigateAndClose = (path: string) => {
    setViewingNFT(null);
    setIsOpen(false);
    router.push(path);
  };

  // Get type config for detail view
  const getTypeConfig = (nft: InventoryNFT) => {
    if (nft.isEgg) return { title: 'Egg Options', emoji: '🥚' };
    if (nft.isSnake) return { title: 'Snake Options', emoji: '🐍' };
    if (nft.ownerIsWarden) return { title: 'Warden Options', emoji: '⚔️' };
    return { title: 'Human Options', emoji: '🧑' };
  };

  // Debug logging
  useEffect(() => {
    if (isOpen) {
      console.log('🔍 InventorySack State:', {
        isConnected,
        isReconnecting,
        isLoading,
        nftsLength: nfts.length,
        userAddress,
      });
    }
  }, [isOpen, isConnected, isReconnecting, isLoading, nfts.length, userAddress]);

  return (
    <>
      {/* Inventory Panel - Slides in from right */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 w-full md:w-[500px] bg-gray-950 z-50 shadow-2xl border-l border-cyan-500/20 flex flex-col animate-slide-in-right" style={{ overflowX: 'hidden' }}>
            {/* Header */}
            <div
              className="relative overflow-hidden bg-gradient-to-r from-cyan-950/60 via-purple-950/60 to-pink-950/60 border-b border-cyan-500/30 backdrop-blur-sm"
              style={{
                padding: 'clamp(0.5rem, 2vh, 1rem) clamp(0.75rem, 3vw, 1.5rem)'
              }}
            >
              {/* Shimmer effect */}
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.3), transparent)',
                  animation: 'shimmer 3s infinite',
                }}
              />

              <div
                className="relative flex items-center justify-end"
                style={{
                  marginBottom: 'clamp(0.5rem, 1.5vh, 0.75rem)'
                }}
              >
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-cyan-300/80 hover:text-cyan-200 transition-colors leading-none"
                  style={{
                    fontSize: 'clamp(1.25rem, 3vh, 1.875rem)'
                  }}
                  aria-label="Close Inventory"
                >
                  ✕
                </button>
              </div>

              {/* Balances - Compact Single Row */}
              {(isWalletConnected || isReconnecting) && (
                <div
                  className="relative flex items-center justify-between rounded-lg border border-cyan-500/20 bg-gray-900/40 backdrop-blur-sm"
                  style={{
                    boxShadow: '0 0 8px rgba(6, 182, 212, 0.1)',
                    gap: 'clamp(0.375rem, 1vw, 0.5rem)',
                    padding: 'clamp(0.375rem, 1.2vh, 0.5rem) clamp(0.5rem, 2vw, 0.75rem)'
                  }}
                >
                  {/* wToken Balance with Wrap Button */}
                  <div
                    className="flex items-center"
                    style={{
                      gap: 'clamp(0.375rem, 1vw, 0.5rem)'
                    }}
                  >
                    <div
                      className="rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center border border-orange-500/30"
                      style={{
                        width: 'clamp(1.25rem, 3vh, 1.5rem)',
                        height: 'clamp(1.25rem, 3vh, 1.5rem)'
                      }}
                    >
                      <svg className="text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '60%', height: '60%' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-orange-200/60 leading-none" style={{ fontSize: 'clamp(0.5rem, 1.2vh, 0.625rem)' }}>wNFTs</p>
                      <p className="text-orange-100 font-bold leading-none mt-0.5" style={{ fontSize: 'clamp(0.7rem, 1.6vh, 0.875rem)' }}>{wTokenBalanceFormatted.toFixed(2)}</p>
                    </div>
                    {/* Wrap Button */}
                    <button
                      onClick={handleWrap}
                      className="ml-1 px-2 py-0.5 rounded-md bg-gradient-to-r from-orange-500/30 to-amber-500/30 border border-orange-500/50 hover:from-orange-500/50 hover:to-amber-500/50 transition-all"
                      style={{ fontSize: 'clamp(0.5rem, 1.2vh, 0.625rem)' }}
                    >
                      <span className="text-orange-200 font-semibold">Wrap</span>
                    </button>
                  </div>

                  {/* Divider */}
                  <div className="w-px bg-gradient-to-b from-transparent via-cyan-500/30 to-transparent" style={{ height: 'clamp(1.5rem, 4vh, 2rem)' }} />

                  {/* ETH Balance */}
                  <div
                    className="flex items-center"
                    style={{
                      gap: 'clamp(0.375rem, 1vw, 0.5rem)'
                    }}
                  >
                    <div
                      className="rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center border border-blue-500/30"
                      style={{
                        width: 'clamp(1.25rem, 3vh, 1.5rem)',
                        height: 'clamp(1.25rem, 3vh, 1.5rem)'
                      }}
                    >
                      <svg className="text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '60%', height: '60%' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-blue-200/60 leading-none" style={{ fontSize: 'clamp(0.5rem, 1.2vh, 0.625rem)' }}>ETH</p>
                      <p className="text-blue-100 font-bold leading-none mt-0.5" style={{ fontSize: 'clamp(0.7rem, 1.6vh, 0.875rem)' }}>{ethBalanceFormatted.toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Staking Info Section */}
              {(isWalletConnected || isReconnecting) && (stakedCount > 0 || Number(pendingRewardsFormatted) > 0) && (
                <div
                  className="relative flex items-center justify-between rounded-lg border border-purple-500/20 bg-gradient-to-r from-purple-900/20 to-pink-900/20 backdrop-blur-sm mt-2"
                  style={{
                    boxShadow: '0 0 8px rgba(168, 85, 247, 0.1)',
                    gap: 'clamp(0.375rem, 1vw, 0.5rem)',
                    padding: 'clamp(0.375rem, 1.2vh, 0.5rem) clamp(0.5rem, 2vw, 0.75rem)'
                  }}
                >
                  {/* Staked Count */}
                  <div
                    className="flex items-center"
                    style={{
                      gap: 'clamp(0.375rem, 1vw, 0.5rem)'
                    }}
                  >
                    <div
                      className="rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center border border-purple-500/30"
                      style={{
                        width: 'clamp(1.25rem, 3vh, 1.5rem)',
                        height: 'clamp(1.25rem, 3vh, 1.5rem)'
                      }}
                    >
                      <span style={{ fontSize: 'clamp(0.6rem, 1.5vh, 0.75rem)' }}>🐍</span>
                    </div>
                    <div>
                      <p className="text-purple-200/60 leading-none" style={{ fontSize: 'clamp(0.5rem, 1.2vh, 0.625rem)' }}>Staked</p>
                      <p className="text-purple-100 font-bold leading-none mt-0.5" style={{ fontSize: 'clamp(0.7rem, 1.6vh, 0.875rem)' }}>{stakedCount}</p>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="w-px bg-gradient-to-b from-transparent via-purple-500/30 to-transparent" style={{ height: 'clamp(1.5rem, 4vh, 2rem)' }} />

                  {/* Pending Rewards */}
                  <div
                    className="flex items-center"
                    style={{
                      gap: 'clamp(0.375rem, 1vw, 0.5rem)'
                    }}
                  >
                    <div
                      className="rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center border border-green-500/30"
                      style={{
                        width: 'clamp(1.25rem, 3vh, 1.5rem)',
                        height: 'clamp(1.25rem, 3vh, 1.5rem)'
                      }}
                    >
                      <span style={{ fontSize: 'clamp(0.6rem, 1.5vh, 0.75rem)' }}>💰</span>
                    </div>
                    <div>
                      <p className="text-green-200/60 leading-none" style={{ fontSize: 'clamp(0.5rem, 1.2vh, 0.625rem)' }}>Rewards</p>
                      <p className="text-green-100 font-bold leading-none mt-0.5" style={{ fontSize: 'clamp(0.7rem, 1.6vh, 0.875rem)' }}>{pendingRewardsFormatted}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* NFT Collection */}
            <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4 bg-gradient-to-b from-gray-950 to-gray-900" style={{ overflowX: 'hidden' }}>
              {!(isWalletConnected || isReconnecting) ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="relative mb-4 sm:mb-6">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center border border-cyan-500/30">
                      <svg className="w-8 h-8 sm:w-10 sm:h-10 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-purple-300 mb-2">
                    Connect Your Wallet
                  </h3>
                  <p className="text-cyan-200/60 text-sm sm:text-base">
                    Connect to view your NFTs and balances
                  </p>
                </div>
              ) : isReconnecting || isLoading || isLoadingStaked ? (
                <div className="flex items-center justify-center h-full">
                  <div className="relative">
                    <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-cyan-500/20 border-t-cyan-500"></div>
                    <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-cyan-500/10"></div>
                  </div>
                </div>
              ) : allNFTs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="relative mb-4 sm:mb-6">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center border border-cyan-500/30">
                      <span className="text-3xl">🎁</span>
                    </div>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-purple-300 mb-2">
                    No NFTs Yet
                  </h3>
                  <p className="text-cyan-200/60 text-sm sm:text-base mb-4">
                    Start your collection today!
                  </p>
                  <button
                    onClick={handleBuyNFT}
                    className="px-6 py-3 rounded-xl text-base font-bold transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(168, 85, 247, 0.4))',
                      border: '2px solid rgba(6, 182, 212, 0.5)',
                      color: 'white',
                      boxShadow: '0 0 25px rgba(6, 182, 212, 0.3), 0 0 50px rgba(168, 85, 247, 0.2)',
                    }}
                  >
                    🛒 Get Your First NFT
                  </button>
                </div>
              ) : viewingNFT ? (
                /* Inline NFT Detail View */
                <div className="h-full flex flex-col animate-fade-in">
                  {/* Back Button Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={closeDetailView}
                      className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      <span className="text-sm font-medium">Back to {activeTab === 'staked' ? 'Staked' : 'Collection'}</span>
                    </button>
                  </div>

                  {/* NFT Details Card */}
                  <div
                    className="rounded-2xl overflow-hidden border-2 border-cyan-500/30"
                    style={{
                      background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))',
                      boxShadow: '0 0 30px rgba(6, 182, 212, 0.2)',
                    }}
                  >
                    {/* Header with Type */}
                    <div
                      className="px-4 py-3 border-b border-cyan-500/20"
                      style={{
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(168, 85, 247, 0.2))',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{getTypeConfig(viewingNFT).emoji}</span>
                        <div>
                          <h3 className="font-bold text-lg bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent">
                            {getTypeConfig(viewingNFT).title}
                          </h3>
                          <p className="text-cyan-200/80 text-sm">{viewingNFT.name}</p>
                        </div>
                      </div>
                    </div>

                    {/* NFT Image and Info */}
                    <div className="p-4 flex gap-4">
                      <img
                        src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${viewingNFT.imageUrl}`}
                        alt={viewingNFT.name}
                        className="w-24 h-24 rounded-xl object-cover border-2 border-cyan-500/30"
                      />
                      <div className="flex-1 space-y-1">
                        <p className="text-white text-sm">Token ID: <span className="font-mono text-cyan-300">#{viewingNFT.tokenId}</span></p>
                        <p className="text-white text-sm">Type: <span className="capitalize text-purple-300">{viewingNFT.nftType}</span></p>
                        {viewingNFT.isStaked && (
                          <p className="text-purple-400 text-sm flex items-center gap-1">⚡ Currently Staked</p>
                        )}
                        {viewingNFT.isJailed && (
                          <p className="text-red-400 text-sm flex items-center gap-1">⛓️ Jailed</p>
                        )}
                        {viewingNFT.evolved && (
                          <p className="text-yellow-400 text-sm flex items-center gap-1">⭐ Evolved</p>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="p-4 pt-0 space-y-2">
                      {/* EGG Actions */}
                      {viewingNFT.isEgg && (
                        <button
                          onClick={() => navigateAndClose('/?fastTravelHatch=true')}
                          className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                          style={{
                            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                            border: '2px solid rgba(168, 85, 247, 0.5)',
                            color: 'rgb(168, 85, 247)',
                            boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
                          }}
                        >
                          <span className="text-xl">✨</span>
                          <div className="text-left">
                            <span className="block">Hatch Egg</span>
                            <span className="text-xs opacity-70">Open the hatching interface</span>
                          </div>
                        </button>
                      )}

                      {/* HUMAN/WARDEN Actions */}
                      {!viewingNFT.isSnake && !viewingNFT.isEgg && (
                        <>
                          {/* Wrap */}
                          <button
                            onClick={() => viewingNFT.canUnwrap && navigateAndClose('/?openShopWrap=true')}
                            disabled={!viewingNFT.canUnwrap}
                            className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            style={{
                              background: viewingNFT.canUnwrap
                                ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                                : 'linear-gradient(135deg, rgba(75, 85, 99, 0.3), rgba(55, 65, 81, 0.3))',
                              border: viewingNFT.canUnwrap
                                ? '2px solid rgba(6, 182, 212, 0.5)'
                                : '2px solid rgba(75, 85, 99, 0.5)',
                              color: viewingNFT.canUnwrap ? 'rgb(6, 182, 212)' : 'rgb(156, 163, 175)',
                              boxShadow: viewingNFT.canUnwrap ? '0 0 15px rgba(6, 182, 212, 0.2)' : 'none',
                            }}
                          >
                            <span className="text-xl">🎁</span>
                            <div className="text-left">
                              <span className="block">Wrap NFT</span>
                              <span className="text-xs opacity-70">
                                {viewingNFT.canUnwrap ? 'Convert to fungible wNFT' : `Cooldown: ${cooldownRemaining}`}
                              </span>
                            </div>
                          </button>

                          {/* Sacrifice */}
                          <button
                            onClick={() => navigateAndClose('/?fastTravelBreed=true')}
                            className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                            style={{
                              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                              border: '2px solid rgba(168, 85, 247, 0.5)',
                              color: 'rgb(168, 85, 247)',
                              boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
                            }}
                          >
                            <span className="text-xl">🔮</span>
                            <div className="text-left">
                              <span className="block">Sacrifice</span>
                              <span className="text-xs opacity-70">Sacrifice 3 humans to get an applesnake egg</span>
                            </div>
                          </button>

                          {/* Jail */}
                          <button
                            onClick={() => navigateAndClose('/?fastTravelJail=true')}
                            className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                            style={{
                              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(219, 39, 119, 0.3))',
                              border: '2px solid rgba(236, 72, 153, 0.5)',
                              color: 'rgb(236, 72, 153)',
                              boxShadow: '0 0 15px rgba(236, 72, 153, 0.2)',
                            }}
                          >
                            <span className="text-xl">⛓️</span>
                            <div className="text-left">
                              <span className="block">Jail</span>
                              <span className="text-xs opacity-70">
                                {viewingNFT.ownerIsWarden
                                  ? "You're a warden - jail at no charge!"
                                  : viewingNFT.isJailed
                                  ? "This NFT can't be transferred while jailed"
                                  : "Bribe the warden to jail whoever you want!"}
                              </span>
                            </div>
                          </button>
                        </>
                      )}

                      {/* SNAKE Actions */}
                      {viewingNFT.isSnake && (
                        <>
                          {/* Wrap */}
                          <button
                            onClick={() => viewingNFT.canUnwrap && navigateAndClose('/?openShopWrap=true')}
                            disabled={!viewingNFT.canUnwrap}
                            className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            style={{
                              background: viewingNFT.canUnwrap
                                ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                                : 'linear-gradient(135deg, rgba(75, 85, 99, 0.3), rgba(55, 65, 81, 0.3))',
                              border: viewingNFT.canUnwrap
                                ? '2px solid rgba(6, 182, 212, 0.5)'
                                : '2px solid rgba(75, 85, 99, 0.5)',
                              color: viewingNFT.canUnwrap ? 'rgb(6, 182, 212)' : 'rgb(156, 163, 175)',
                              boxShadow: viewingNFT.canUnwrap ? '0 0 15px rgba(6, 182, 212, 0.2)' : 'none',
                            }}
                          >
                            <span className="text-xl">🎁</span>
                            <div className="text-left">
                              <span className="block">Wrap NFT</span>
                              <span className="text-xs opacity-70">
                                {viewingNFT.canUnwrap ? 'Convert to fungible wNFT' : `Cooldown: ${cooldownRemaining}`}
                              </span>
                            </div>
                          </button>

                          {/* Stake/Unstake */}
                          {viewingNFT.isStaked ? (
                            <button
                              onClick={handleSingleUnstake}
                              disabled={isProcessing}
                              className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{
                                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                                border: '2px solid rgba(168, 85, 247, 0.5)',
                                color: 'rgb(168, 85, 247)',
                                boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
                              }}
                            >
                              {isProcessing && currentOperation === 'unstake' ? (
                                <span className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <span className="text-xl">🔓</span>
                              )}
                              <div className="text-left">
                                <span className="block">{isProcessing && currentOperation === 'unstake' ? 'Unstaking...' : 'Unstake Snake'}</span>
                                <span className="text-xs opacity-70">Remove from staking to use or transfer</span>
                              </div>
                            </button>
                          ) : (
                            <button
                              onClick={handleSingleStake}
                              disabled={isProcessing}
                              className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{
                                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                                border: '2px solid rgba(168, 85, 247, 0.5)',
                                color: 'rgb(168, 85, 247)',
                                boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
                              }}
                            >
                              {isProcessing && currentOperation === 'stake' ? (
                                <span className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <span className="text-xl">💎</span>
                              )}
                              <div className="text-left">
                                <span className="block">
                                  {isProcessing && currentOperation === 'stake'
                                    ? 'Staking...'
                                    : !isApproved && !supportsAtomicBatch
                                      ? 'Approve & Stake'
                                      : 'Stake Snake'}
                                </span>
                                <span className="text-xs opacity-70">Stake your snake to earn token rewards</span>
                              </div>
                            </button>
                          )}

                          {/* Jail - disabled for snakes */}
                          <button
                            disabled
                            className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center gap-3 opacity-50 cursor-not-allowed"
                            style={{
                              background: 'linear-gradient(135deg, rgba(75, 85, 99, 0.3), rgba(55, 65, 81, 0.3))',
                              border: '2px solid rgba(75, 85, 99, 0.5)',
                              color: 'rgb(156, 163, 175)',
                            }}
                          >
                            <span className="text-xl">⛓️</span>
                            <div className="text-left">
                              <span className="block">Jail</span>
                              <span className="text-xs opacity-70">You can&apos;t fit a 120 foot snake in this jail cell...</span>
                            </div>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Tab Toggle Header */}
                  <div className="flex items-center justify-center mb-3 sm:mb-4">
                    <div className="relative flex bg-gray-900/80 rounded-xl p-1 border border-gray-700/50">
                      {/* Sliding Background */}
                      <div
                        className="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out"
                        style={{
                          width: 'calc(50% - 4px)',
                          left: activeTab === 'collection' ? '4px' : 'calc(50%)',
                          background: activeTab === 'collection'
                            ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))'
                            : 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(236, 72, 153, 0.4))',
                          boxShadow: activeTab === 'collection'
                            ? '0 0 15px rgba(6, 182, 212, 0.3)'
                            : '0 0 15px rgba(168, 85, 247, 0.3)',
                        }}
                      />

                      {/* Collection Tab */}
                      <button
                        onClick={() => setActiveTab('collection')}
                        className="relative z-10 px-4 py-2 rounded-lg text-sm font-semibold transition-colors duration-200"
                        style={{
                          minWidth: '110px',
                          color: activeTab === 'collection' ? 'rgb(6, 182, 212)' : 'rgba(255, 255, 255, 0.5)',
                        }}
                      >
                        Collection
                        <span
                          className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: activeTab === 'collection' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                            color: activeTab === 'collection' ? 'rgb(6, 182, 212)' : 'rgba(255, 255, 255, 0.4)',
                          }}
                        >
                          {collectionNFTs.length}
                        </span>
                      </button>

                      {/* Staked Tab */}
                      <button
                        onClick={() => setActiveTab('staked')}
                        className="relative z-10 px-4 py-2 rounded-lg text-sm font-semibold transition-colors duration-200"
                        style={{
                          minWidth: '110px',
                          color: activeTab === 'staked' ? 'rgb(168, 85, 247)' : 'rgba(255, 255, 255, 0.5)',
                        }}
                      >
                        Staked
                        <span
                          className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: activeTab === 'staked' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                            color: activeTab === 'staked' ? 'rgb(168, 85, 247)' : 'rgba(255, 255, 255, 0.4)',
                          }}
                        >
                          {stakedNFTs.length}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Empty State for Current Tab */}
                  {displayedNFTs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="w-16 h-16 mb-4 rounded-full flex items-center justify-center" style={{
                        background: activeTab === 'collection'
                          ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))'
                          : 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))',
                        border: activeTab === 'collection'
                          ? '1px solid rgba(6, 182, 212, 0.3)'
                          : '1px solid rgba(168, 85, 247, 0.3)',
                      }}>
                        <span className="text-2xl">{activeTab === 'collection' ? '📦' : '⚡'}</span>
                      </div>
                      <p className="text-sm mb-4" style={{
                        color: activeTab === 'collection' ? 'rgba(6, 182, 212, 0.8)' : 'rgba(168, 85, 247, 0.8)',
                      }}>
                        {activeTab === 'collection'
                          ? 'No NFTs in your wallet'
                          : 'No staked NFTs'}
                      </p>
                      {activeTab === 'collection' && (
                        <button
                          onClick={handleBuyNFT}
                          className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105"
                          style={{
                            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))',
                            border: '1px solid rgba(6, 182, 212, 0.5)',
                            color: 'rgb(6, 182, 212)',
                            boxShadow: '0 0 15px rgba(6, 182, 212, 0.2)',
                          }}
                        >
                          🛒 Get NFTs
                        </button>
                      )}
                      {activeTab === 'staked' && collectionNFTs.length > 0 && (
                        <p className="text-xs text-gray-400">
                          Stake snakes to earn rewards!
                        </p>
                      )}
                    </div>
                  )}

                  {/* NFT Grid */}
                  {displayedNFTs.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-2.5 md:gap-3 pb-20">
                    {displayedNFTs.map((nft) => {
                      const isJailed = nft.isJailed;
                      const isEgg = nft.isEgg;
                      const isEvolved = nft.evolved;
                      const isStaked = (nft as InventoryNFT).isStaked;
                      const isSelected = selectedNFTs.has(nft.tokenId);

                      return (
                        <button
                          key={nft.tokenId}
                          onClick={(e) => handleNFTInteraction(nft, e)}
                          className={`relative group rounded-xl overflow-hidden border-2 transition-all hover:scale-105 active:scale-95 bg-gradient-to-br from-gray-900 to-gray-950 ${
                            isSelected
                              ? isStaked
                                ? 'border-purple-400 ring-2 ring-purple-400/50'
                                : 'border-cyan-400 ring-2 ring-cyan-400/50'
                              : 'border-cyan-500/20 hover:border-cyan-400/50'
                          }`}
                          style={{
                            boxShadow: isSelected
                              ? isStaked
                                ? '0 0 20px rgba(168, 85, 247, 0.4)'
                                : '0 0 20px rgba(6, 182, 212, 0.4)'
                              : '0 0 10px rgba(6, 182, 212, 0.1)'
                          }}
                        >
                          {/* NFT Image */}
                          <div className="aspect-square relative bg-gray-950">
                            <img
                              src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                              alt={nft.name}
                              className={`w-full h-full object-cover transition-all ${isSelected ? 'brightness-110' : ''}`}
                            />

                            {/* Selection Checkbox */}
                            {(isSelectionMode || isSelected) && (
                              <div
                                className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                                  isSelected
                                    ? isStaked
                                      ? 'bg-purple-500 border-purple-400'
                                      : 'bg-cyan-500 border-cyan-400'
                                    : 'bg-gray-800/80 border-gray-500/50'
                                }`}
                              >
                                {isSelected && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            )}

                            {/* Status Badges */}
                            <div className="absolute top-1 left-1 flex flex-col gap-1">
                              {isStaked && (
                                <span className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold border border-purple-400/30 shadow-lg">
                                  ⚡
                                </span>
                              )}
                              {isEvolved && (
                                <span className="bg-gradient-to-r from-yellow-500 to-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold border border-yellow-400/30 shadow-lg">
                                  ⭐
                                </span>
                              )}
                              {isEgg && (
                                <span className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold border border-amber-400/30 shadow-lg">
                                  🥚
                                </span>
                              )}
                              {isJailed && (
                                <span className="bg-gradient-to-r from-red-500 to-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold border border-red-400/30 shadow-lg">
                                  🔒
                                </span>
                              )}
                            </div>

                            {/* Hover overlay - only show when not in selection mode */}
                            {!isSelectionMode && (
                              <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/30 via-purple-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              </div>
                            )}
                          </div>

                          {/* Token ID */}
                          <div className={`px-2 py-1 backdrop-blur-sm border-t ${isStaked ? 'bg-gradient-to-r from-purple-900/90 to-pink-900/90 border-purple-500/20' : 'bg-gradient-to-r from-gray-900/90 to-gray-950/90 border-cyan-500/10'}`}>
                            <p className={`text-xs font-semibold text-center truncate ${isStaked ? 'text-purple-100' : 'text-cyan-100'}`}>
                              #{nft.tokenId} {isStaked && <span className="text-[9px] text-purple-300/80">• Staked</span>}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  )}
                </>
              )}
            </div>

            {/* Action Footer - Shows when items are selected */}
            {selectedNFTs.size > 0 && (
              <div
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-gray-950 via-gray-900/95 to-gray-900/90 backdrop-blur-md border-t border-cyan-500/30 px-4 py-3"
                style={{
                  boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.5)',
                }}
              >
                {/* Selection Info */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {selectedNFTs.size} NFT{selectedNFTs.size > 1 ? 's' : ''} selected
                    </span>
                    {selectedSnakes.length > 0 && selectedSnakes.length !== selectedNFTs.size && (
                      <span className="text-xs text-cyan-400/80">
                        ({selectedSnakes.length} snake{selectedSnakes.length > 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={clearSelections}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Clear
                  </button>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {/* Collection Tab Actions */}
                  {activeTab === 'collection' && selectedForStake.length > 0 && (
                    <>
                      {!isApproved ? (
                        supportsAtomicBatch ? (
                          <button
                            onClick={handleApproveAndStake}
                            disabled={isProcessing}
                            className="flex-1 py-2.5 px-4 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                              border: '2px solid rgba(6, 182, 212, 0.6)',
                              color: 'rgb(6, 182, 212)',
                              boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
                            }}
                          >
                            {isProcessing && currentOperation === 'stake' ? (
                              <span className="flex items-center justify-center gap-2">
                                <span className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                Processing...
                              </span>
                            ) : (
                              `⚡ Stake ${selectedForStake.length} Snake${selectedForStake.length > 1 ? 's' : ''}`
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={handleApprove}
                            disabled={isProcessing}
                            className="flex-1 py-2.5 px-4 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.4), rgba(234, 88, 12, 0.4))',
                              border: '2px solid rgba(249, 115, 22, 0.6)',
                              color: 'rgb(249, 115, 22)',
                              boxShadow: '0 0 20px rgba(249, 115, 22, 0.3)',
                            }}
                          >
                            {isProcessing && currentOperation === 'approve' ? (
                              <span className="flex items-center justify-center gap-2">
                                <span className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                                Approving...
                              </span>
                            ) : (
                              '🔓 Approve First'
                            )}
                          </button>
                        )
                      ) : (
                        <button
                          onClick={handleStake}
                          disabled={isProcessing}
                          className="flex-1 py-2.5 px-4 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                            border: '2px solid rgba(6, 182, 212, 0.6)',
                            color: 'rgb(6, 182, 212)',
                            boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
                          }}
                        >
                          {isProcessing && currentOperation === 'stake' ? (
                            <span className="flex items-center justify-center gap-2">
                              <span className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                              Staking...
                            </span>
                          ) : (
                            `⚡ Stake ${selectedForStake.length} Snake${selectedForStake.length > 1 ? 's' : ''}`
                          )}
                        </button>
                      )}
                    </>
                  )}

                  {/* Staked Tab Actions */}
                  {activeTab === 'staked' && selectedForUnstake.length > 0 && (
                    <button
                      onClick={handleUnstake}
                      disabled={isProcessing}
                      className="flex-1 py-2.5 px-4 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(139, 92, 246, 0.4))',
                        border: '2px solid rgba(168, 85, 247, 0.6)',
                        color: 'rgb(168, 85, 247)',
                        boxShadow: '0 0 20px rgba(168, 85, 247, 0.3)',
                      }}
                    >
                      {isProcessing && currentOperation === 'unstake' ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                          Unstaking...
                        </span>
                      ) : (
                        `🔓 Unstake ${selectedForUnstake.length} Snake${selectedForUnstake.length > 1 ? 's' : ''}`
                      )}
                    </button>
                  )}

                  {/* Wrap Button - Always available when items selected */}
                  {selectedNFTs.size > 0 && (
                    <button
                      onClick={handleWrap}
                      className="py-2.5 px-4 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                      style={{
                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.4), rgba(22, 163, 74, 0.4))',
                        border: '2px solid rgba(34, 197, 94, 0.6)',
                        color: 'rgb(34, 197, 94)',
                        boxShadow: '0 0 20px rgba(34, 197, 94, 0.3)',
                      }}
                    >
                      🎁 Wrap
                    </button>
                  )}
                </div>

                {/* Info text for non-snake selections */}
                {activeTab === 'collection' && selectedNFTs.size > 0 && selectedForStake.length === 0 && (
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    Only snakes can be staked. Select snakes to enable staking.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }

        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
