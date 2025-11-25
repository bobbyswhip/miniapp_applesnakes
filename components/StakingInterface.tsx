'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { base } from 'wagmi/chains';
import { getContracts } from '@/config/contracts';
import { useNFTContext } from '@/contexts/NFTContext';
import { useTransactions } from '@/contexts/TransactionContext';
import { formatUnits } from 'viem';
import type { UserNFT, NFTType } from '@/hooks/useUserNFTs';

interface StakingInterfaceProps {
  selectedSnakesForStaking: Set<number>;
  setSelectedSnakesForStaking: (snakes: Set<number>) => void;
  selectedStakedSnakes: Set<number>;
  setSelectedStakedSnakes: (snakes: Set<number>) => void;
}

export function StakingInterface({
  selectedSnakesForStaking,
  setSelectedSnakesForStaking,
  selectedStakedSnakes,
  setSelectedStakedSnakes,
}: StakingInterfaceProps) {
  const { address } = useAccount();
  const { nfts, refetch: refetchNFTs } = useNFTContext();
  const { addTransaction } = useTransactions();
  const publicClient = usePublicClient({ chainId: base.id });
  const stakingConfig = getContracts(base.id).staking;
  const nftConfig = getContracts(base.id).nft;

  const [stakedTokenIds, setStakedTokenIds] = useState<number[]>([]);
  const [stakedNFTs, setStakedNFTs] = useState<UserNFT[]>([]);
  const [isLoadingStaked, setIsLoadingStaked] = useState(false);
  const [activeView, setActiveView] = useState<'stake' | 'unstake'>('stake');

  // Check if staking contract is approved to transfer NFTs
  const { data: isApproved, refetch: refetchApproval } = useReadContract({
    address: nftConfig.address,
    abi: nftConfig.abi,
    functionName: 'isApprovedForAll',
    args: address ? [address, stakingConfig.address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Get pending rewards
  const { data: pendingRewardsData } = useReadContract({
    address: stakingConfig.address,
    abi: stakingConfig.abi,
    functionName: 'pendingRewards',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000, // Refetch every 10 seconds
    },
  });

  // Get staked token IDs
  const { data: stakedData, refetch: refetchStaked } = useReadContract({
    address: stakingConfig.address,
    abi: stakingConfig.abi,
    functionName: 'getStakedTokenIdsPaginated',
    args: address ? [address, BigInt(0), BigInt(100)] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Get user stats
  const { data: userStats } = useReadContract({
    address: stakingConfig.address,
    abi: stakingConfig.abi,
    functionName: 'getUserStats',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000,
    },
  });

  const { writeContractAsync, data: hash, isPending: isWritePending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // Update staked token IDs when data changes
  useEffect(() => {
    if (stakedData && Array.isArray(stakedData) && stakedData.length > 0) {
      const tokenIds = stakedData[0] as bigint[];
      setStakedTokenIds(tokenIds.map(id => Number(id)));
    } else {
      setStakedTokenIds([]);
    }
  }, [stakedData]);

  // Fetch full NFT data for staked tokens (similar to useUserNFTs)
  useEffect(() => {
    if (!publicClient || stakedTokenIds.length === 0) {
      setStakedNFTs([]);
      setIsLoadingStaked(false);
      return;
    }

    const fetchStakedNFTs = async () => {
      setIsLoadingStaked(true);
      console.log('🔍 Fetching full NFT data for', stakedTokenIds.length, 'staked tokens:', stakedTokenIds);

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
        console.log('  📦 Calling getTokenInfo for batch...');
        const tokenInfoResults = await publicClient.readContract({
          address: nftConfig.address as `0x${string}`,
          abi: nftConfig.abi,
          functionName: 'getTokenInfo',
          args: [stakedTokenIds.map(id => BigInt(id))],
        }) as TokenInfo[];

        // Batch fetch tokenURI
        console.log('  📦 Fetching tokenURI for batch...');
        const tokenURIResults = await publicClient.multicall({
          contracts: stakedTokenIds.map(tokenId => ({
            address: nftConfig.address as `0x${string}`,
            abi: nftConfig.abi,
            functionName: 'tokenURI' as const,
            args: [BigInt(tokenId)],
          })),
          allowFailure: true,
        });

        // Build UserNFT objects
        const stakedNFTObjects: UserNFT[] = [];

        for (let i = 0; i < stakedTokenIds.length; i++) {
          const tokenId = stakedTokenIds[i];
          const tokenInfo = tokenInfoResults[i];
          const tokenURIResult = tokenURIResults[i];

          // Get metadata from tokenURI
          let metadata: any = {
            name: `AppleSnake #${tokenId}`,
            description: '',
            image: `${tokenId}.png`,
            attributes: [],
          };

          if (tokenURIResult.status === 'success' && tokenURIResult.result) {
            try {
              const uri = tokenURIResult.result as string;
              // Handle different URI formats (IPFS, HTTP, data URI)
              let metadataUrl = uri;
              if (uri.startsWith('ipfs://')) {
                metadataUrl = uri.replace('ipfs://', 'https://surrounding-amaranth-catshark.myfilebase.com/ipfs/');
              } else if (uri.startsWith('data:application/json;base64,')) {
                const base64Data = uri.replace('data:application/json;base64,', '');
                const jsonString = atob(base64Data);
                metadata = JSON.parse(jsonString);
              }

              // Fetch JSON metadata if it's a URL
              if (metadataUrl.startsWith('http')) {
                const metadataResponse = await fetch(metadataUrl);
                if (metadataResponse.ok) {
                  metadata = await metadataResponse.json();
                }
              }
            } catch (error) {
              console.warn(`  ⚠️ Could not fetch metadata for token ${tokenId}:`, error);
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

          const userNFT: UserNFT = {
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
          };

          stakedNFTObjects.push(userNFT);
        }

        console.log('✅ Successfully fetched', stakedNFTObjects.length, 'staked NFTs');
        setStakedNFTs(stakedNFTObjects);
        setIsLoadingStaked(false);
      } catch (error) {
        console.error('❌ Error fetching staked NFTs:', error);
        setStakedNFTs([]);
        setIsLoadingStaked(false);
      }
    };

    fetchStakedNFTs();
  }, [stakedTokenIds, publicClient, nftConfig.address, nftConfig.abi]);

  // Refetch when transaction confirms
  useEffect(() => {
    if (isConfirmed) {
      refetchStaked();
      refetchNFTs();
      refetchApproval();
      setSelectedSnakesForStaking(new Set());
      setSelectedStakedSnakes(new Set());
    }
  }, [isConfirmed, refetchStaked, refetchNFTs, refetchApproval, setSelectedSnakesForStaking, setSelectedStakedSnakes]);

  const handleApprove = async () => {
    if (!address) return;

    try {
      const hash = await writeContractAsync({
        address: nftConfig.address,
        abi: nftConfig.abi,
        functionName: 'setApprovalForAll',
        args: [stakingConfig.address, true],
      });

      addTransaction(hash, 'Approving staking contract');
    } catch (error) {
      console.error('Approve error:', error);
    }
  };

  const handleStake = async () => {
    if (selectedSnakesForStaking.size === 0 || !address) return;

    try {
      const tokenIds = Array.from(selectedSnakesForStaking);
      const hash = await writeContractAsync({
        address: stakingConfig.address,
        abi: stakingConfig.abi,
        functionName: 'stake',
        args: [tokenIds.map(id => BigInt(id))],
      });

      addTransaction(hash, `Staking ${tokenIds.length} snake${tokenIds.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Stake error:', error);
    }
  };

  const handleUnstake = async () => {
    if (selectedStakedSnakes.size === 0 || !address) return;

    try {
      const tokenIds = Array.from(selectedStakedSnakes);
      const hash = await writeContractAsync({
        address: stakingConfig.address,
        abi: stakingConfig.abi,
        functionName: 'unstake',
        args: [tokenIds.map(id => BigInt(id))],
      });

      addTransaction(hash, `Unstaking ${tokenIds.length} snake${tokenIds.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Unstake error:', error);
    }
  };

  const handleClaimRewards = async () => {
    if (!address) return;

    try {
      const hash = await writeContractAsync({
        address: stakingConfig.address,
        abi: stakingConfig.abi,
        functionName: 'claimRewards',
        args: [],
      });

      addTransaction(hash, 'Claiming staking rewards');
    } catch (error) {
      console.error('Claim rewards error:', error);
    }
  };

  const toggleSelectSnake = (tokenId: number) => {
    const newSelected = new Set(selectedSnakesForStaking);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      newSelected.add(tokenId);
    }
    setSelectedSnakesForStaking(newSelected);
  };

  const toggleSelectStakedSnake = (tokenId: number) => {
    const newSelected = new Set(selectedStakedSnakes);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      newSelected.add(tokenId);
    }
    setSelectedStakedSnakes(newSelected);
  };

  const availableSnakes = nfts.filter(nft => nft.nftType === 'snake' && !stakedTokenIds.includes(nft.tokenId));
  const stakedSnakes = stakedNFTs; // Use the fetched staked NFTs with full metadata

  const pendingRewardsFormatted = pendingRewardsData
    ? parseFloat(formatUnits(pendingRewardsData as bigint, 18)).toFixed(4)
    : '0.0000';

  const stakedCount = userStats ? Number((userStats as any)[0]) : 0;

  return (
    <>
      {/* Rewards Info */}
      <div
        style={{
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderRadius: 'clamp(8px, 1.6vw, 12px)',
          padding: 'clamp(12px, 2.5vw, 16px)',
          marginBottom: 'clamp(12px, 2vw, 16px)',
          border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'clamp(8px, 1.5vw, 10px)' }}>
          <span style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(255, 255, 255, 0.6)' }}>Snakes Staked:</span>
          <span style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(6, 182, 212, 1)', fontWeight: 700 }}>{stakedCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(255, 255, 255, 0.6)' }}>Pending Rewards:</span>
          <span style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(34, 197, 94, 1)', fontWeight: 700 }}>{pendingRewardsFormatted} tokens</span>
        </div>

        {/* Claim Rewards Button */}
        {Number(pendingRewardsFormatted) > 0 && (
          <button
            onClick={handleClaimRewards}
            disabled={isWritePending || isConfirming}
            style={{
              width: '100%',
              marginTop: 'clamp(12px, 2vw, 16px)',
              padding: 'clamp(8px, 1.6vw, 12px)',
              backgroundColor: 'rgba(34, 197, 94, 0.2)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(34, 197, 94, 0.5)',
              borderRadius: 'clamp(8px, 1.5vw, 12px)',
              color: 'rgba(34, 197, 94, 1)',
              fontSize: 'clamp(11px, 2.2vw, 13px)',
              fontWeight: 700,
              cursor: isWritePending || isConfirming ? 'not-allowed' : 'pointer',
              opacity: isWritePending || isConfirming ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            {isConfirming ? 'Claiming...' : 'Claim Rewards'}
          </button>
        )}
      </div>

      {/* Tab Selector for Stake/Unstake View */}
      <div style={{ display: 'flex', gap: 'clamp(6px, 1.2vw, 8px)', marginBottom: 'clamp(12px, 2vw, 16px)', flexShrink: 0 }}>
        <button
          onClick={() => {
            setActiveView('stake');
            setSelectedSnakesForStaking(new Set());
            setSelectedStakedSnakes(new Set());
          }}
          style={{
            flex: 1,
            padding: 'clamp(6px, 1.2vw, 8px)',
            borderRadius: 'clamp(6px, 1.2vw, 8px)',
            fontWeight: 600,
            fontSize: 'clamp(10px, 2vw, 12px)',
            border: `clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, ${activeView === 'stake' ? '0.8' : '0.4'})`,
            background: activeView === 'stake'
              ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
              : 'linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(59, 130, 246, 0.1))',
            color: 'rgba(6, 182, 212, 1)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            opacity: activeView === 'stake' ? 1 : 0.6,
          }}
        >
          Stake Snakes ({availableSnakes.length})
        </button>
        <button
          onClick={() => {
            setActiveView('unstake');
            setSelectedSnakesForStaking(new Set());
            setSelectedStakedSnakes(new Set());
          }}
          style={{
            flex: 1,
            padding: 'clamp(6px, 1.2vw, 8px)',
            borderRadius: 'clamp(6px, 1.2vw, 8px)',
            fontWeight: 600,
            fontSize: 'clamp(10px, 2vw, 12px)',
            border: `clamp(1px, 0.2vw, 1.5px) solid rgba(168, 85, 247, ${activeView === 'unstake' ? '0.8' : '0.4'})`,
            background: activeView === 'unstake'
              ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))'
              : 'linear-gradient(135deg, rgba(168, 85, 247, 0.1), rgba(139, 92, 246, 0.1))',
            color: 'rgba(168, 85, 247, 1)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            opacity: activeView === 'unstake' ? 1 : 0.6,
          }}
        >
          Unstake ({stakedSnakes.length})
        </button>
      </div>

      {/* Snakes Grid */}
      <div
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.8)',
          borderRadius: 'clamp(8px, 1.6vw, 12px)',
          padding: 'clamp(8px, 1.6vw, 12px)',
          marginBottom: 'clamp(6px, 1.2vw, 10px)',
          border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Available Snakes (for staking) */}
        {activeView === 'stake' && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 15vw, 90px), 1fr))',
                gap: 'clamp(6px, 1.2vw, 10px)',
              }}
            >
              {availableSnakes.map((nft) => (
                <div
                  key={nft.tokenId}
                  onClick={() => toggleSelectSnake(nft.tokenId)}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: 'clamp(6px, 1.2vw, 8px)',
                    overflow: 'hidden',
                    border: selectedSnakesForStaking.has(nft.tokenId)
                      ? 'clamp(2px, 0.4vw, 3px) solid rgba(6, 182, 212, 1)'
                      : 'clamp(2px, 0.4vw, 3px) solid transparent',
                    boxShadow: selectedSnakesForStaking.has(nft.tokenId)
                      ? '0 0 15px rgba(6, 182, 212, 0.5)'
                      : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <img
                    src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                    alt={nft.name}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                    }}
                  />
                  {selectedSnakesForStaking.has(nft.tokenId) && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 'clamp(16px, 3vw, 20px)',
                        height: 'clamp(16px, 3vw, 20px)',
                        borderRadius: '50%',
                        background: 'rgba(6, 182, 212, 1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'clamp(10px, 2vw, 12px)',
                      }}
                    >
                      ✓
                    </div>
                  )}
                </div>
              ))}
            </div>
            {availableSnakes.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: 'clamp(20px, 4vw, 40px)',
                  color: 'rgba(255, 255, 255, 0.4)',
                  fontSize: 'clamp(10px, 2vw, 12px)',
                }}
              >
                No snakes available to stake. Breed some using 3 humans!
              </div>
            )}
          </div>
        )}

        {/* Loading indicator for staked NFTs */}
        {activeView === 'unstake' && isLoadingStaked && (
          <div
            style={{
              textAlign: 'center',
              padding: 'clamp(20px, 4vw, 40px)',
              color: 'rgba(168, 85, 247, 0.6)',
              fontSize: 'clamp(10px, 2vw, 12px)',
            }}
          >
            Loading staked snakes...
          </div>
        )}

        {/* Staked Snakes (for unstaking) */}
        {activeView === 'unstake' && !isLoadingStaked && stakedSnakes.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div
              style={{
                fontSize: 'clamp(11px, 2.2vw, 13px)',
                fontWeight: 600,
                color: 'rgba(168, 85, 247, 1)',
                marginBottom: 'clamp(8px, 1.5vw, 12px)',
              }}
            >
              Staked Snakes ({stakedSnakes.length})
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 15vw, 90px), 1fr))',
                gap: 'clamp(6px, 1.2vw, 10px)',
              }}
            >
              {stakedSnakes.map((nft) => (
                <div
                  key={nft.tokenId}
                  onClick={() => toggleSelectStakedSnake(nft.tokenId)}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: 'clamp(6px, 1.2vw, 8px)',
                    overflow: 'hidden',
                    border: selectedStakedSnakes.has(nft.tokenId)
                      ? 'clamp(2px, 0.4vw, 3px) solid rgba(168, 85, 247, 1)'
                      : 'clamp(2px, 0.4vw, 3px) solid transparent',
                    boxShadow: selectedStakedSnakes.has(nft.tokenId)
                      ? '0 0 15px rgba(168, 85, 247, 0.5)'
                      : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <img
                    src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                    alt={nft.name}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                    }}
                  />
                  {selectedStakedSnakes.has(nft.tokenId) && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 'clamp(16px, 3vw, 20px)',
                        height: 'clamp(16px, 3vw, 20px)',
                        borderRadius: '50%',
                        background: 'rgba(168, 85, 247, 1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'clamp(10px, 2vw, 12px)',
                      }}
                    >
                      ✓
                    </div>
                  )}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                      padding: 'clamp(4px, 0.8vw, 6px)',
                      fontSize: 'clamp(8px, 1.6vw, 10px)',
                      color: 'rgba(168, 85, 247, 1)',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    Staked
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: 'flex',
          gap: 'clamp(8px, 1.5vw, 12px)',
          paddingTop: 'clamp(8px, 1.5vw, 12px)',
          flexShrink: 0,
        }}
      >
        {selectedSnakesForStaking.size > 0 && (
          <>
            {!isApproved ? (
              <button
                onClick={handleApprove}
                disabled={isWritePending || isConfirming}
                style={{
                  flex: 1,
                  padding: 'clamp(10px, 2vw, 14px)',
                  borderRadius: 'clamp(8px, 1.5vw, 12px)',
                  fontWeight: 700,
                  fontSize: 'clamp(12px, 2.5vw, 16px)',
                  border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(249, 115, 22, 0.6)',
                  background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.3), rgba(234, 88, 12, 0.3))',
                  color: 'rgba(249, 115, 22, 1)',
                  cursor: isWritePending || isConfirming ? 'not-allowed' : 'pointer',
                  opacity: isWritePending || isConfirming ? 0.5 : 1,
                  boxShadow: '0 0 20px rgba(249, 115, 22, 0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                {isConfirming ? 'Approving...' : 'Approve Staking Contract'}
              </button>
            ) : (
              <button
                onClick={handleStake}
                disabled={isWritePending || isConfirming}
                style={{
                  flex: 1,
                  padding: 'clamp(10px, 2vw, 14px)',
                  borderRadius: 'clamp(8px, 1.5vw, 12px)',
                  fontWeight: 700,
                  fontSize: 'clamp(12px, 2.5vw, 16px)',
                  border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.6)',
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))',
                  color: 'rgba(6, 182, 212, 1)',
                  cursor: isWritePending || isConfirming ? 'not-allowed' : 'pointer',
                  opacity: isWritePending || isConfirming ? 0.5 : 1,
                  boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                {isConfirming ? 'Staking...' : `Stake ${selectedSnakesForStaking.size} Snake${selectedSnakesForStaking.size > 1 ? 's' : ''}`}
              </button>
            )}
          </>
        )}

        {selectedStakedSnakes.size > 0 && (
          <button
            onClick={handleUnstake}
            disabled={isWritePending || isConfirming}
            style={{
              flex: 1,
              padding: 'clamp(10px, 2vw, 14px)',
              borderRadius: 'clamp(8px, 1.5vw, 12px)',
              fontWeight: 700,
              fontSize: 'clamp(12px, 2.5vw, 16px)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(168, 85, 247, 0.6)',
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
              color: 'rgba(168, 85, 247, 1)',
              cursor: isWritePending || isConfirming ? 'not-allowed' : 'pointer',
              opacity: isWritePending || isConfirming ? 0.5 : 1,
              boxShadow: '0 0 20px rgba(168, 85, 247, 0.3)',
              transition: 'all 0.2s ease',
            }}
          >
            {isConfirming ? 'Unstaking...' : `Unstake ${selectedStakedSnakes.size} Snake${selectedStakedSnakes.size > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </>
  );
}
