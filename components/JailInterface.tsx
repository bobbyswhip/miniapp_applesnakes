'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount, usePublicClient, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getContracts, getNFTMetadataUrl, getNFTImageUrl } from '@/config';
import { base } from 'wagmi/chains';
import { getAddress } from '@coinbase/onchainkit/identity';
import { NFTImage } from './NFTImage';
import { UserNFT, NFTType } from '@/hooks/useUserNFTs';
import { useNFTContext } from '@/contexts/NFTContext';

interface JailInterfaceProps {
  onClose: () => void;
}

type TabType = 'jail' | 'bail';

export function JailInterface({ onClose }: JailInterfaceProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);
  const { nfts: userNfts } = useNFTContext();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('jail');

  // Jail tab state
  const [jailTarget, setJailTarget] = useState<string>('');
  const [targetNFTs, setTargetNFTs] = useState<UserNFT[]>([]);
  const [selectedJailNFTs, setSelectedJailNFTs] = useState<Set<number>>(new Set());
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [targetError, setTargetError] = useState<string>('');

  // Bail tab state - user's jailed NFTs (memoized to prevent unnecessary re-renders)
  const jailedNFTs = useMemo(() => userNfts.filter(nft => nft.isJailed), [userNfts]);
  const [selectedBailNFTs, setSelectedBailNFTs] = useState<Set<number>>(new Set());

  // Fetch jail fee from contract
  const { data: jailFeeData } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'jailFee',
    chainId: base.id,
  });
  const jailFee = jailFeeData ? Number(jailFeeData) / 1e18 : 0.00111;

  // Contract write hooks for jail transactions
  const {
    data: jailHash,
    writeContract: writeJail,
    isPending: isJailPending,
    error: jailError
  } = useWriteContract();

  const {
    isLoading: isJailConfirming,
    isSuccess: isJailConfirmed
  } = useWaitForTransactionReceipt({ hash: jailHash });

  // Contract write hooks for unjail (bail) transactions
  const {
    data: unjailHash,
    writeContract: writeUnjail,
    isPending: isUnjailPending,
    error: unjailError
  } = useWriteContract();

  const {
    isLoading: isUnjailConfirming,
    isSuccess: isUnjailConfirmed
  } = useWaitForTransactionReceipt({ hash: unjailHash });

  // Refresh NFTs after successful transactions
  const { refetch: refetchNFTs } = useNFTContext();

  useEffect(() => {
    if (isJailConfirmed) {
      console.log('Jail transaction confirmed!');
      refetchNFTs();
      setSelectedJailNFTs(new Set());
      setTargetNFTs([]);
      setJailTarget('');
    }
  }, [isJailConfirmed, refetchNFTs]);

  useEffect(() => {
    if (isUnjailConfirmed) {
      console.log('Unjail transaction confirmed!');
      refetchNFTs();
      setSelectedBailNFTs(new Set());
    }
  }, [isUnjailConfirmed, refetchNFTs]);

  // Handle target search and load NFTs
  const handleLoadTarget = async () => {
    if (!jailTarget.trim()) return;
    if (!publicClient) {
      setTargetError('Wallet not connected');
      return;
    }

    setLoadingTarget(true);
    setTargetError('');
    setTargetNFTs([]);
    setSelectedJailNFTs(new Set());

    try {
      let targetAddress = jailTarget.trim();

      // Check if it's a token ID (just numbers)
      if (/^\d+$/.test(targetAddress)) {
        await loadSingleNFT(parseInt(targetAddress));
      } else {
        // Check if it's a basename or ENS name
        if (targetAddress.endsWith('.base.eth') || targetAddress.endsWith('.basetest.eth') || targetAddress.endsWith('.eth')) {
          try {
            console.log('Resolving basename:', targetAddress);
            const resolvedAddress = await getAddress({ name: targetAddress, chain: base });
            console.log('Resolved address:', resolvedAddress);

            if (resolvedAddress && typeof resolvedAddress === 'string' && resolvedAddress.length > 0) {
              targetAddress = resolvedAddress;
              console.log('Using resolved address:', targetAddress);
            } else {
              console.warn('No address returned for basename:', targetAddress);
              setTargetError(`Could not resolve "${targetAddress}". Please check the name and try again.`);
              setLoadingTarget(false);
              return;
            }
          } catch (err: any) {
            console.error('Basename resolution error:', err);
            const errorMessage = err?.message || 'Unknown error';
            setTargetError(`Failed to resolve "${targetAddress}": ${errorMessage}`);
            setLoadingTarget(false);
            return;
          }
        }

        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
          setTargetError('Invalid address format');
          setLoadingTarget(false);
          return;
        }

        // Load NFTs for address
        await loadAddressNFTs(targetAddress);
      }
    } catch (err) {
      console.error('Error loading target:', err);
      setTargetError(err instanceof Error ? err.message : 'Failed to load target');
    } finally {
      setLoadingTarget(false);
    }
  };

  // Load single NFT by token ID
  const loadSingleNFT = async (tokenId: number) => {
    if (!publicClient) return;

    const tokenInfo = await publicClient.readContract({
      address: contracts.nft.address as `0x${string}`,
      abi: contracts.nft.abi,
      functionName: 'getTokenInfo',
      args: [[BigInt(tokenId)]],
    }) as any[];

    if (tokenInfo.length > 0) {
      const info = tokenInfo[0];

      if (!info.exists) {
        setTargetError('Token does not exist');
        return;
      }
      if (info.isSnake) {
        setTargetError('Snakes cannot be jailed');
        return;
      }
      if (info.ownerIsJailExempt || info.ownerIsWarden) {
        setTargetError('This wallet is jail-exempt');
        return;
      }
      if (info.isJailed) {
        setTargetError('Already jailed');
        return;
      }

      // Fetch metadata using IPNS (always gets latest version)
      const metadata = await fetchMetadata(tokenId);
      if (!metadata) {
        setTargetError('Failed to load NFT metadata');
        return;
      }

      setTargetNFTs([{
        tokenId,
        imageUrl: metadata.imageUrl,
        name: metadata.name,
        nftType: 'human' as NFTType,
        owner: info.owner,
        exists: info.exists,
        isSnake: info.isSnake,
        isJailed: info.isJailed,
        jailTime: Number(info.jailTime),
        isEgg: info.isEgg,
        mintTime: Number(info.mintTime),
        forceHatched: info.forceHatched,
        evolved: info.evolved,
        ownerIsWarden: info.ownerIsWarden,
        ownerIsJailExempt: info.ownerIsJailExempt,
        metadata: metadata.raw,
        swapMintTime: 0,
        canUnwrap: false,
      }]);
    }
  };

  // Load NFTs for an address (same method as useUserNFTs)
  const loadAddressNFTs = async (targetAddress: string) => {
    if (!publicClient) return;

    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyKey) {
      setTargetError('Alchemy API not configured');
      return;
    }

    // Step 1: Get token IDs from Alchemy
    const url = new URL(`https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner`);
    url.searchParams.append('owner', targetAddress);
    url.searchParams.append('contractAddresses[]', contracts.nft.address);
    url.searchParams.append('withMetadata', 'false');

    const response = await fetch(url.toString());
    if (!response.ok) {
      setTargetError('Failed to fetch NFTs');
      return;
    }

    const data = await response.json();
    const tokenIds = data.ownedNfts.map((nft: any) => BigInt(nft.tokenId));

    if (tokenIds.length === 0) {
      setTargetError('No NFTs found for this address');
      return;
    }

    // Step 2: Batch load token info and tokenURI
    const batchSize = 30;
    const allInfos: any[] = [];
    const tokenURIMap = new Map<number, string>();

    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      const batchNumbers = batch.map((id: bigint) => Number(id));

      // Batch getTokenInfo
      const infos = await publicClient.readContract({
        address: contracts.nft.address as `0x${string}`,
        abi: contracts.nft.abi,
        functionName: 'getTokenInfo',
        args: [batch],
      }) as any[];
      allInfos.push(...infos);

      // Batch tokenURI using multicall
      const tokenURIResults = await publicClient.multicall({
        contracts: batchNumbers.map((tokenId: number) => ({
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'tokenURI' as const,
          args: [BigInt(tokenId)],
        })),
        allowFailure: true,
      });

      batchNumbers.forEach((tokenId: number, idx: number) => {
        const result = tokenURIResults[idx];
        if (result.status === 'success') {
          tokenURIMap.set(tokenId, result.result as string);
        }
      });

      if (i + batchSize < tokenIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Step 3: Fetch metadata from IPNS (always gets latest version)
    const metadataMap = new Map<number, any>();
    const metadataPromises = tokenIds.map(async (tokenIdBigInt: bigint) => {
      const tokenId = Number(tokenIdBigInt);

      const metadata = await fetchMetadata(tokenId);
      if (metadata) {
        metadataMap.set(tokenId, metadata);
      }
      return metadata;
    });

    await Promise.all(metadataPromises);

    // Step 4: Build jailable NFTs array
    const jailableNFTs = allInfos
      .map((info, index) => {
        const tokenId = Number(tokenIds[index]);
        const metadata = metadataMap.get(tokenId);

        if (!metadata) return null;

        return {
          tokenId,
          imageUrl: metadata.imageUrl,
          name: metadata.name,
          nftType: 'human' as NFTType,
          owner: info.owner,
          exists: info.exists,
          isSnake: info.isSnake,
          isJailed: info.isJailed,
          jailTime: Number(info.jailTime),
          isEgg: info.isEgg,
          mintTime: Number(info.mintTime),
          forceHatched: info.forceHatched,
          evolved: info.evolved,
          ownerIsWarden: info.ownerIsWarden,
          ownerIsJailExempt: info.ownerIsJailExempt,
          metadata: metadata.raw,
          swapMintTime: 0,
          canUnwrap: false,
        };
      })
      .filter((nft): nft is NonNullable<typeof nft> =>
        nft !== null &&
        nft.exists &&
        !nft.isSnake &&
        !nft.isJailed &&
        !nft.ownerIsJailExempt &&
        !nft.ownerIsWarden
      );

    if (jailableNFTs.length === 0) {
      setTargetError('No jailable humans found for this wallet');
      return;
    }

    setTargetNFTs(jailableNFTs);
  };

  // Fetch metadata from IPNS (always gets latest version)
  const fetchMetadata = async (tokenId: number) => {
    try {
      const metadataUrl = getNFTMetadataUrl(tokenId);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(metadataUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`Failed to fetch metadata from ${metadataUrl}`);
        return null;
      }

      const metadata = await response.json();

      // Use IPNS image URL - always gets latest version
      const imageUrl = getNFTImageUrl(tokenId);

      return {
        imageUrl,
        name: metadata.name,
        raw: metadata,
      };
    } catch (err) {
      console.warn('Error fetching metadata:', err);
      return null;
    }
  };

  // Toggle NFT selection for jailing
  const toggleJailSelection = (tokenId: number) => {
    setSelectedJailNFTs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tokenId)) {
        newSet.delete(tokenId);
      } else {
        newSet.add(tokenId);
      }
      return newSet;
    });
  };

  // Toggle NFT selection for bailing
  const toggleBailSelection = (tokenId: number) => {
    setSelectedBailNFTs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tokenId)) {
        newSet.delete(tokenId);
      } else {
        newSet.add(tokenId);
      }
      return newSet;
    });
  };

  // Calculate time remaining for jailed NFTs
  const getTimeRemaining = (jailTime: number) => {
    if (jailTime === 0) return 'Not jailed';

    const now = Math.floor(Date.now() / 1000);
    const remaining = jailTime - now;

    if (remaining <= 0) return 'Ready to bail';

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 cursor-pointer"
        style={{
          zIndex: 99,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed"
        style={{
          zIndex: 100,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'clamp(280px, 92vw, 500px)',
          maxHeight: '90vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))',
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
          borderRadius: 'clamp(10px, 2vw, 16px)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 50px rgba(6, 182, 212, 0.3), 0 0 100px rgba(168, 85, 247, 0.2), inset 0 0 30px rgba(168, 85, 247, 0.05)',
          padding: 'clamp(12px, 2.5vw, 20px)',
        }}
      >
        {/* Shimmer effect overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.1), transparent)',
            animation: 'shimmer 3s infinite',
            zIndex: 1,
            borderRadius: 'clamp(10px, 2vw, 16px)',
          }}
        />

        {/* Content wrapper */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(8px, 1.6vw, 12px)',
          }}
        >
          {/* Header */}
          <div
            style={{
              marginBottom: 'clamp(16px, 3.5vw, 24px)',
              marginTop: 'clamp(16px, 3.5vw, 24px)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 'clamp(16px, 4vw, 24px)',
                fontWeight: 700,
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 1) 0%, rgba(168, 85, 247, 1) 50%, rgba(236, 72, 153, 1) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                textShadow: 'none',
              }}
            >
              🔒 Apple Town Jail
            </div>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 'clamp(6px, 1.2vw, 10px)',
              marginBottom: 'clamp(8px, 1.6vw, 12px)',
            }}
          >
            <button
              onClick={() => setActiveTab('jail')}
              style={{
                flex: 1,
                padding: 'clamp(8px, 1.6vw, 12px)',
                fontSize: 'clamp(11px, 2.2vw, 14px)',
                fontWeight: 600,
                color: activeTab === 'jail' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
                background: activeTab === 'jail'
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))'
                  : 'rgba(6, 182, 212, 0.2)',
                border: 'none',
                borderRadius: 'clamp(6px, 1.2vw, 10px)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
            >
              Jail
            </button>
            <button
              onClick={() => setActiveTab('bail')}
              style={{
                flex: 1,
                padding: 'clamp(8px, 1.6vw, 12px)',
                fontSize: 'clamp(11px, 2.2vw, 14px)',
                fontWeight: 600,
                color: activeTab === 'bail' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
                background: activeTab === 'bail'
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))'
                  : 'rgba(6, 182, 212, 0.2)',
                border: 'none',
                borderRadius: 'clamp(6px, 1.2vw, 10px)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                position: 'relative',
              }}
            >
              Bail
              {jailedNFTs.length > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    backgroundColor: 'rgba(239, 68, 68, 1)',
                    color: '#FFFFFF',
                    fontSize: 'clamp(8px, 1.6vw, 10px)',
                    fontWeight: 700,
                    borderRadius: '50%',
                    width: 'clamp(16px, 3.2vw, 20px)',
                    height: 'clamp(16px, 3.2vw, 20px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {jailedNFTs.length}
                </span>
              )}
            </button>
          </div>

          {/* Jail Tab Content */}
          {activeTab === 'jail' && (
            <>
              {/* Description */}
              <div
                style={{
                  fontSize: 'clamp(9px, 1.8vw, 11px)',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontWeight: 500,
                  lineHeight: 1.3,
                  marginBottom: 'clamp(6px, 1.2vw, 8px)',
                }}
              >
                Would you like to report a crime to the warden?
              </div>

              {/* Transfer restriction note */}
              <div
                style={{
                  padding: 'clamp(6px, 1.2vw, 8px) clamp(8px, 1.6vw, 12px)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'clamp(6px, 1.2vw, 10px)',
                  marginBottom: 'clamp(8px, 1.6vw, 12px)',
                }}
              >
                <div
                  style={{
                    fontSize: 'clamp(8px, 1.6vw, 10px)',
                    color: 'rgba(239, 68, 68, 1)',
                    fontWeight: 600,
                    marginBottom: 'clamp(2px, 0.4vw, 3px)',
                  }}
                >
                  ⚠️ Transfer Restriction
                </div>
                <div
                  style={{
                    fontSize: 'clamp(8px, 1.6vw, 9px)',
                    color: 'rgba(255, 255, 255, 0.6)',
                    lineHeight: 1.3,
                  }}
                >
                  NFTs cannot be transferred while jailed. They will be locked for 7 days.
                </div>
              </div>

              {/* Target Input */}
              <div style={{ flexShrink: 0 }}>
                <div
                  style={{
                    fontSize: 'clamp(11px, 2.2vw, 14px)',
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.7)',
                    marginBottom: 'clamp(6px, 1.2vw, 8px)',
                  }}
                >
                  Search
                </div>
                <div style={{ display: 'flex', gap: 'clamp(6px, 1.2vw, 10px)', marginBottom: 'clamp(8px, 1.6vw, 12px)' }}>
                  <input
                    type="text"
                    placeholder="Token ID, basename, or wallet address"
                    value={jailTarget}
                    onChange={(e) => setJailTarget(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleLoadTarget();
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: 'clamp(8px, 1.6vw, 12px)',
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.3)',
                      borderRadius: 'clamp(6px, 1.2vw, 10px)',
                      color: '#FFFFFF',
                      fontSize: 'clamp(10px, 2vw, 12px)',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleLoadTarget}
                    disabled={!jailTarget.trim() || loadingTarget}
                    style={{
                      padding: 'clamp(8px, 1.6vw, 12px) clamp(12px, 2.4vw, 16px)',
                      backgroundColor: (!jailTarget.trim() || loadingTarget) ? 'rgba(6, 182, 212, 0.3)' : 'rgba(6, 182, 212, 1)',
                      border: 'none',
                      borderRadius: 'clamp(6px, 1.2vw, 10px)',
                      color: '#FFFFFF',
                      fontSize: 'clamp(10px, 2vw, 12px)',
                      fontWeight: 600,
                      cursor: (!jailTarget.trim() || loadingTarget) ? 'not-allowed' : 'pointer',
                      opacity: (!jailTarget.trim() || loadingTarget) ? 0.5 : 1,
                    }}
                  >
                    {loadingTarget ? '...' : 'Load'}
                  </button>
                </div>

                {/* Error Message */}
                {targetError && (
                  <div
                    style={{
                      padding: 'clamp(8px, 1.6vw, 12px)',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 'clamp(6px, 1.2vw, 10px)',
                      color: 'rgba(239, 68, 68, 1)',
                      fontSize: 'clamp(9px, 1.8vw, 11px)',
                      marginBottom: 'clamp(8px, 1.6vw, 12px)',
                    }}
                  >
                    {targetError}
                  </div>
                )}

                {/* Target NFTs Grid */}
                {targetNFTs.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 'clamp(11px, 2.2vw, 14px)',
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.7)',
                        marginBottom: 'clamp(6px, 1.2vw, 8px)',
                        marginTop: 'clamp(8px, 1.6vw, 12px)',
                      }}
                    >
                      Jailable Humans ({targetNFTs.length})
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 14vw, 100px), 1fr))',
                        gap: 'clamp(12px, 2.4vw, 16px)',
                        maxHeight: 'clamp(150px, 30vh, 250px)',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        padding: 'clamp(8px, 1.6vw, 12px)',
                        backgroundColor: 'rgba(0, 0, 0, 0.2)',
                        borderRadius: 'clamp(6px, 1.2vw, 10px)',
                        border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.2)',
                      }}
                    >
                      {targetNFTs.map((nft) => (
                        <div
                          key={nft.tokenId}
                          onClick={() => toggleJailSelection(nft.tokenId)}
                          style={{
                            cursor: 'pointer',
                            aspectRatio: '1 / 1',
                            borderRadius: 'clamp(6px, 1.2vw, 10px)',
                            border: selectedJailNFTs.has(nft.tokenId)
                              ? 'clamp(2px, 0.4vw, 3px) solid rgba(6, 182, 212, 1)'
                              : 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
                            overflow: 'hidden',
                            position: 'relative',
                            boxShadow: selectedJailNFTs.has(nft.tokenId)
                              ? '0 0 15px rgba(6, 182, 212, 0.6)'
                              : 'none',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                            <NFTImage
                              tokenId={nft.tokenId}
                              imageUrl={nft.imageUrl}
                              width={100}
                              height={100}
                              thumbnail={true}
                              className="w-full h-full"
                            />
                          </div>
                          {selectedJailNFTs.has(nft.tokenId) && (
                            <div
                              style={{
                                position: 'absolute',
                                top: '4px',
                                right: '4px',
                                backgroundColor: 'rgba(6, 182, 212, 1)',
                                color: '#FFFFFF',
                                borderRadius: '50%',
                                width: 'clamp(18px, 3.6vw, 24px)',
                                height: 'clamp(18px, 3.6vw, 24px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'clamp(10px, 2vw, 14px)',
                                fontWeight: 700,
                              }}
                            >
                              ✓
                            </div>
                          )}
                          <div
                            style={{
                              position: 'absolute',
                              top: '2px',
                              left: '2px',
                              backgroundColor: 'rgba(0, 0, 0, 0.8)',
                              color: '#FFFFFF',
                              borderRadius: 'clamp(4px, 0.8vw, 6px)',
                              padding: 'clamp(2px, 0.4vw, 4px) clamp(4px, 0.8vw, 6px)',
                              fontSize: 'clamp(8px, 1.6vw, 10px)',
                              fontWeight: 600,
                            }}
                          >
                            #{nft.tokenId}
                          </div>
                          <div
                            style={{
                              position: 'absolute',
                              bottom: '2px',
                              left: '2px',
                              right: '2px',
                              backgroundColor: 'rgba(0, 0, 0, 0.8)',
                              color: '#FFFFFF',
                              borderRadius: 'clamp(4px, 0.8vw, 6px)',
                              padding: 'clamp(2px, 0.4vw, 4px)',
                              fontSize: 'clamp(8px, 1.6vw, 10px)',
                              fontWeight: 600,
                              textAlign: 'center',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {nft.name}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Transaction Error */}
                    {jailError && (
                      <div
                        style={{
                          padding: 'clamp(8px, 1.6vw, 12px)',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 'clamp(6px, 1.2vw, 10px)',
                          color: 'rgba(239, 68, 68, 1)',
                          fontSize: 'clamp(9px, 1.8vw, 11px)',
                          marginTop: 'clamp(8px, 1.6vw, 12px)',
                        }}
                      >
                        Error: {jailError.message}
                      </div>
                    )}

                    {/* Jail Button */}
                    <button
                      onClick={async () => {
                        if (!address || selectedJailNFTs.size === 0) return;

                        const tokenIds = Array.from(selectedJailNFTs);
                        const totalFee = BigInt(Math.floor(jailFee * 1e18)) * BigInt(tokenIds.length);

                        writeJail({
                          address: contracts.nft.address as `0x${string}`,
                          abi: contracts.nft.abi,
                          functionName: 'jail',
                          args: [tokenIds.map(id => BigInt(id))],
                          value: totalFee,
                        });
                      }}
                      disabled={selectedJailNFTs.size === 0 || isJailPending || isJailConfirming}
                      style={{
                        width: '100%',
                        padding: 'clamp(10px, 2vw, 14px)',
                        fontSize: 'clamp(12px, 2.4vw, 16px)',
                        fontWeight: 700,
                        color: '#FFFFFF',
                        background: (selectedJailNFTs.size === 0 || isJailPending || isJailConfirming)
                          ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(168, 85, 247, 0.3))'
                          : 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))',
                        border: 'none',
                        borderRadius: 'clamp(10px, 2vw, 14px)',
                        cursor: (selectedJailNFTs.size === 0 || isJailPending || isJailConfirming) ? 'not-allowed' : 'pointer',
                        opacity: (selectedJailNFTs.size === 0 || isJailPending || isJailConfirming) ? 0.5 : 1,
                        transition: 'all 0.3s ease',
                        marginTop: 'clamp(8px, 1.6vw, 12px)',
                      }}
                    >
                      {isJailPending
                        ? 'Confirm in Wallet...'
                        : isJailConfirming
                        ? 'Confirming...'
                        : selectedJailNFTs.size === 0
                        ? 'Select Humans to File Report'
                        : `File ${selectedJailNFTs.size} Report${selectedJailNFTs.size !== 1 ? 's' : ''} (${(selectedJailNFTs.size * jailFee).toFixed(5)} ETH)`}
                    </button>

                    {/* Powered by Pairable */}
                    <div
                      style={{
                        marginTop: 'clamp(8px, 1.5vw, 12px)',
                        marginBottom: 'clamp(10px, 2vw, 16px)',
                        paddingBottom: 'clamp(8px, 1.5vw, 12px)',
                        fontSize: 'clamp(9px, 1.8vw, 11px)',
                        color: 'rgba(255, 255, 255, 0.4)',
                        textAlign: 'center',
                        lineHeight: '1.5',
                        flexShrink: 0,
                      }}
                    >
                      powered by the <a href="https://pairable.io/#/contracts/superstrat" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(6, 182, 212, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT super strategy hook
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Bail Tab Content */}
          {activeTab === 'bail' && (
            <>
              {/* Description */}
              <div
                style={{
                  fontSize: 'clamp(9px, 1.8vw, 11px)',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontWeight: 500,
                  lineHeight: 1.3,
                  marginBottom: 'clamp(8px, 1.6vw, 12px)',
                }}
              >
                Bail out your jailed humans. NFTs are released for free after 7 days
              </div>

              {jailedNFTs.length === 0 ? (
                <div
                  style={{
                    padding: 'clamp(16px, 3.2vw, 24px)',
                    textAlign: 'center',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: 'clamp(10px, 2vw, 12px)',
                  }}
                >
                  <div style={{ fontSize: 'clamp(32px, 6.4vw, 48px)', marginBottom: 'clamp(8px, 1.6vw, 12px)' }}>
                    ⛓️
                  </div>
                  <div>You have no jailed humans</div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      fontSize: 'clamp(11px, 2.2vw, 14px)',
                      fontWeight: 600,
                      color: 'rgba(255, 255, 255, 0.7)',
                      marginBottom: 'clamp(6px, 1.2vw, 8px)',
                    }}
                  >
                    Your Jailed Humans ({jailedNFTs.length})
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 14vw, 100px), 1fr))',
                      gap: 'clamp(12px, 2.4vw, 16px)',
                      maxHeight: 'clamp(200px, 40vh, 300px)',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      padding: 'clamp(8px, 1.6vw, 12px)',
                      backgroundColor: 'rgba(0, 0, 0, 0.2)',
                      borderRadius: 'clamp(6px, 1.2vw, 10px)',
                      border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.2)',
                    }}
                  >
                    {jailedNFTs.map((nft) => (
                      <div
                        key={nft.tokenId}
                        onClick={() => toggleBailSelection(nft.tokenId)}
                        style={{
                          cursor: 'pointer',
                          aspectRatio: '1 / 1',
                          borderRadius: 'clamp(6px, 1.2vw, 10px)',
                          border: selectedBailNFTs.has(nft.tokenId)
                            ? 'clamp(2px, 0.4vw, 3px) solid rgba(239, 68, 68, 1)'
                            : 'clamp(1.5px, 0.3vw, 2px) solid rgba(107, 114, 128, 0.3)',
                          overflow: 'hidden',
                          position: 'relative',
                          boxShadow: selectedBailNFTs.has(nft.tokenId)
                            ? '0 0 15px rgba(239, 68, 68, 0.6)'
                            : 'none',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                          <NFTImage
                            tokenId={nft.tokenId}
                            imageUrl={nft.imageUrl}
                            isJailed={true}
                            width={100}
                            height={100}
                            thumbnail={true}
                            className="w-full h-full"
                          />
                        </div>
                        {selectedBailNFTs.has(nft.tokenId) && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: 'rgba(239, 68, 68, 1)',
                              color: '#FFFFFF',
                              borderRadius: '50%',
                              width: 'clamp(18px, 3.6vw, 24px)',
                              height: 'clamp(18px, 3.6vw, 24px)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 'clamp(10px, 2vw, 14px)',
                              fontWeight: 700,
                            }}
                          >
                            ✓
                          </div>
                        )}
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '2px',
                            left: '2px',
                            right: '2px',
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            color: '#FFFFFF',
                            borderRadius: 'clamp(4px, 0.8vw, 6px)',
                            padding: 'clamp(2px, 0.4vw, 4px)',
                            fontSize: 'clamp(8px, 1.6vw, 10px)',
                            fontWeight: 600,
                            textAlign: 'center',
                          }}
                        >
                          {getTimeRemaining(nft.jailTime)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Bail Summary */}
                  <div
                    style={{
                      marginTop: 'clamp(8px, 1.6vw, 12px)',
                      padding: 'clamp(8px, 1.6vw, 12px)',
                      backgroundColor: 'rgba(0, 0, 0, 0.2)',
                      borderRadius: 'clamp(6px, 1.2vw, 10px)',
                      border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.2)',
                      fontSize: 'clamp(10px, 2vw, 12px)',
                      color: 'rgba(255, 255, 255, 0.7)',
                    }}
                  >
                    <div>
                      <strong style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Selected:</strong> {selectedBailNFTs.size} human{selectedBailNFTs.size !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Transaction Error */}
                  {unjailError && (
                    <div
                      style={{
                        padding: 'clamp(8px, 1.6vw, 12px)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(239, 68, 68, 0.3)',
                        borderRadius: 'clamp(6px, 1.2vw, 10px)',
                        color: 'rgba(239, 68, 68, 1)',
                        fontSize: 'clamp(9px, 1.8vw, 11px)',
                        marginTop: 'clamp(8px, 1.6vw, 12px)',
                      }}
                    >
                      Error: {unjailError.message}
                    </div>
                  )}

                  {/* Bail Button */}
                  <button
                    onClick={async () => {
                      if (!address || selectedBailNFTs.size === 0) return;

                      const tokenIds = Array.from(selectedBailNFTs);

                      writeUnjail({
                        address: contracts.nft.address as `0x${string}`,
                        abi: contracts.nft.abi,
                        functionName: 'unjail',
                        args: [tokenIds.map(id => BigInt(id))],
                      });
                    }}
                    disabled={selectedBailNFTs.size === 0 || isUnjailPending || isUnjailConfirming}
                    style={{
                      width: '100%',
                      padding: 'clamp(10px, 2vw, 14px)',
                      fontSize: 'clamp(12px, 2.4vw, 16px)',
                      fontWeight: 700,
                      color: '#FFFFFF',
                      background: (selectedBailNFTs.size === 0 || isUnjailPending || isUnjailConfirming)
                        ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.3))'
                        : 'linear-gradient(135deg, rgba(239, 68, 68, 1), rgba(220, 38, 38, 1))',
                      border: 'none',
                      borderRadius: 'clamp(10px, 2vw, 14px)',
                      cursor: (selectedBailNFTs.size === 0 || isUnjailPending || isUnjailConfirming) ? 'not-allowed' : 'pointer',
                      opacity: (selectedBailNFTs.size === 0 || isUnjailPending || isUnjailConfirming) ? 0.5 : 1,
                      transition: 'all 0.3s ease',
                      marginTop: 'clamp(8px, 1.6vw, 12px)',
                    }}
                  >
                    {isUnjailPending
                      ? 'Confirm in Wallet...'
                      : isUnjailConfirming
                      ? 'Confirming...'
                      : selectedBailNFTs.size === 0
                      ? 'Select Humans to Bail'
                      : `Bail ${selectedBailNFTs.size} Human${selectedBailNFTs.size !== 1 ? 's' : ''}`}
                  </button>

                  {/* Powered by Pairable */}
                  <div
                    style={{
                      marginTop: 'clamp(8px, 1.5vw, 12px)',
                      marginBottom: 'clamp(10px, 2vw, 16px)',
                      paddingBottom: 'clamp(8px, 1.5vw, 12px)',
                      fontSize: 'clamp(9px, 1.8vw, 11px)',
                      color: 'rgba(255, 255, 255, 0.4)',
                      textAlign: 'center',
                      lineHeight: '1.5',
                      flexShrink: 0,
                    }}
                  >
                    powered by the <a href="https://pairable.io/#/contracts/superstrat" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(6, 182, 212, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT super strategy hook
                  </div>
                </>
              )}

              {/* Powered by Pairable for empty state */}
              {jailedNFTs.length === 0 && (
                <div
                  style={{
                    marginTop: 'clamp(8px, 1.5vw, 12px)',
                    marginBottom: 'clamp(10px, 2vw, 16px)',
                    paddingBottom: 'clamp(8px, 1.5vw, 12px)',
                    fontSize: 'clamp(9px, 1.8vw, 11px)',
                    color: 'rgba(255, 255, 255, 0.4)',
                    textAlign: 'center',
                    lineHeight: '1.5',
                    flexShrink: 0,
                  }}
                >
                  powered by the <a href="https://pairable.io/#/contracts/superstrat" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(6, 182, 212, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT super strategy hook
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* CSS animations */}
      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </>
  );
}
