'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts } from '@/config';
import { useNFTContext } from '@/contexts/NFTContext';
import { useTransactions } from '@/contexts/TransactionContext';
import { useWTokensNFTs } from '@/hooks/useWTokensNFTs';

export default function WrapPage() {
  const { isConnected, address } = useAccount();
  const { nfts, isLoading, error: _error, refetch: refetchNFTs } = useNFTContext();
  const contracts = getContracts(base.id);
  const { addTransaction, updateTransaction } = useTransactions();

  const [selectedNFTs, setSelectedNFTs] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<'wrap' | 'unwrap' | 'swap'>('wrap');

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
  const [unwrapCount, setUnwrapCount] = useState(1);
  const [currentOperation, setCurrentOperation] = useState<'approve' | 'wrap' | 'unwrap' | 'swap' | null>(null);
  const [wrappedNFTs, setWrappedNFTs] = useState<Set<number>>(new Set()); // Track wrapped NFTs for instant UI update
  const [operationByHash, setOperationByHash] = useState<Record<string, 'approve' | 'wrap' | 'unwrap' | 'swap'>>({});
  const [pendingWrapNFTs, setPendingWrapNFTs] = useState<Set<number>>(new Set()); // Track NFTs being wrapped (for error recovery)

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

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
      const descriptions = {
        approve: 'Approving NFT wrapper',
        wrap: `Wrapping ${selectedNFTs.size} NFT${selectedNFTs.size > 1 ? 's' : ''}`,
        unwrap: `Unwrapping ${unwrapCount} NFT${unwrapCount > 1 ? 's' : ''}`,
        swap: `Swapping NFT #${selectedUserNFT} for #${selectedWTokenNFT}`,
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
  }, [hash, currentOperation, selectedNFTs.size, unwrapCount, addTransaction]);

  // Update transaction status
  useEffect(() => {
    if (hash && isSuccess) {
      const operation = operationByHash[hash];
      if (operation) {
        updateTransaction(hash, 'success');

        // Refetch approval status after approval succeeds
        if (operation === 'approve') {
          refetchApproval();
          setCurrentOperation(null);
        }

        // On wrap: just refetch wToken balance (UI already updated immediately)
        if (operation === 'wrap') {
          refetchWTokenBalance();
          setPendingWrapNFTs(new Set()); // Clear pending wrap NFTs on success
        }

        // On unwrap: full NFT refetch to see what the user got (FIFO)
        if (operation === 'unwrap') {
          refetchNFTs();
          refetchWTokenBalance();
          setWrappedNFTs(new Set()); // Clear wrapped NFTs tracking
          setCurrentOperation(null);
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
  }, [hash, isSuccess, operationByHash, updateTransaction, refetchApproval, refetchNFTs, refetchWTokenBalance]);

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

      // Clear current operation on error
      setCurrentOperation(null);
    }
  }, [writeError, currentOperation, pendingWrapNFTs]);

  // Handle approval
  const handleApprove = () => {
    setCurrentOperation('approve');
    writeContract({
      address: contracts.nft.address,
      abi: contracts.nft.abi,
      functionName: 'setApprovalForAll',
      args: [contracts.wrapper.address, true],
    });
  };

  // Handle wrap
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

  // Handle unwrap
  const handleUnwrap = () => {
    setCurrentOperation('unwrap');
    const totalFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(unwrapCount) : 0n;

    writeContract({
      address: contracts.wrapper.address,
      abi: contracts.wrapper.abi,
      functionName: 'unwrapNFTs',
      args: [contracts.nft.address, BigInt(unwrapCount)],
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

  // Filter out wrapped NFTs for instant UI feedback
  const displayedNFTs = nfts.filter(nft => !wrappedNFTs.has(nft.tokenId));

  const selectedCount = selectedNFTs.size;
  const totalWrapFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(selectedCount) : 0n;
  const totalUnwrapFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(unwrapCount) : 0n;

  const wTokenBalanceFormatted = wTokenBalance ? Number(wTokenBalance) / 1e18 : 0;

  return (
    <main className="flex min-h-screen flex-col items-center p-6">
      <div className="w-full max-w-7xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4 pt-4">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 bg-clip-text text-transparent">
            NFT Wrapper
          </h1>
          <p className="text-gray-400 text-lg">
            Wrap your NFTs to get fungible wTokens
          </p>
        </div>

        {!isConnected ? (
          <div className="glass rounded-3xl p-8 shadow-2xl border border-gray-800">
            <div className="space-y-6 text-center">
              <span className="text-7xl">🔌</span>
              <h2 className="text-2xl font-semibold text-white">
                Connect Your Wallet
              </h2>
              <p className="text-gray-400">
                Use the &quot;Connect Wallet&quot; button in the header above to start wrapping your NFTs
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* wNFT Balance Card */}
            <div className="glass rounded-3xl p-6 shadow-2xl border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Your wNFT Balance</p>
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
                  onClick={() => setMode('unwrap')}
                  className={`py-3 px-4 rounded-xl font-semibold transition-all ${
                    mode === 'unwrap'
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/50'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  🎁 Unwrap
                </button>
                <button
                  onClick={() => setMode('swap')}
                  className={`py-3 px-4 rounded-xl font-semibold transition-all ${
                    mode === 'swap'
                      ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/50'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  🔄 Swap
                </button>
              </div>

              {mode === 'swap' ? (
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
                          onClick={handleApprove}
                          disabled={isPending || isConfirming}
                          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isPending || isConfirming ? 'Approving...' : '✅ Approve Wrapper Contract'}
                        </button>
                      ) : (
                        <button
                          onClick={handleSwap}
                          disabled={selectedUserNFT === null || selectedWTokenNFT === null || isPending || isConfirming}
                          className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                        >
                          <span>🔄</span>
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
              ) : mode === 'wrap' ? (
                /* WRAP MODE */
                <div className="space-y-6">
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
                      <span className="text-7xl">🐍</span>
                      <h3 className="text-2xl font-bold text-white mt-4">No NFTs Found</h3>
                      <p className="text-gray-400 mt-2">You don&apos;t own any NFTs to wrap</p>
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
                          onClick={handleApprove}
                          disabled={isPending || isConfirming}
                          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isPending || isConfirming ? 'Approving...' : '✅ Approve Wrapper Contract'}
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
              ) : (
                /* UNWRAP MODE */
                <div className="space-y-6">
                  <div className="text-center space-y-4">
                    <p className="text-gray-400">
                      Unwrap NFTs from the pool (FIFO - First In, First Out)
                    </p>
                    <div className="max-w-md mx-auto">
                      <label className="block text-gray-400 text-sm mb-2">Number of NFTs to unwrap</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={unwrapCount}
                        onChange={(e) => setUnwrapCount(parseInt(e.target.value) || 1)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-center text-2xl font-bold focus:outline-none focus:border-green-500"
                      />
                      <p className="text-gray-500 text-sm mt-2">
                        Fee: {wrapFee ? formatEther(totalUnwrapFee) : '0'} ETH
                      </p>
                      <p className="text-gray-500 text-sm">
                        Required balance: {unwrapCount} wNFTs
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleUnwrap}
                    disabled={unwrapCount < 1 || unwrapCount > wTokenBalanceFormatted || isPending || isConfirming}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                  >
                    <span>🎁</span>
                    <span>
                      {isPending || isConfirming
                        ? 'Unwrapping...'
                        : `Unwrap ${unwrapCount} NFT${unwrapCount !== 1 ? 's' : ''} for ${wrapFee ? formatEther(totalUnwrapFee) : '0'} ETH`}
                    </span>
                  </button>

                  {unwrapCount > wTokenBalanceFormatted && (
                    <p className="text-red-400 text-center text-sm">
                      Insufficient wNFT balance. You have {wTokenBalanceFormatted.toFixed(2)} wNFTs.
                    </p>
                  )}
                </div>
              )}

              {/* Transaction Status */}
              {hash && (
                <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-blue-400 text-sm text-center">
                    {isConfirming ? '⏳ Confirming transaction...' : isSuccess ? '✅ Transaction successful!' : '📝 Transaction submitted'}
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
