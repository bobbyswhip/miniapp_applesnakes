'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useBalance } from 'wagmi';
import { base } from 'wagmi/chains';
import { formatEther } from 'viem';
import { getContracts } from '@/config';
import { useNFTContext } from '@/contexts/NFTContext';
import { useInventory } from '@/contexts/InventoryContext';
import { UserNFT } from '@/hooks/useUserNFTs';
import { NFTOptionsModal } from './NFTOptionsModal';

export function InventorySack() {
  const [selectedNFT, setSelectedNFT] = useState<UserNFT | null>(null);
  const { isOpen, setIsOpen, openInventory, showPredictionJack } = useInventory();
  const { address: userAddress, isConnected, isReconnecting } = useAccount();
  const { nfts, isLoading } = useNFTContext();
  const contracts = getContracts(base.id);

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

  const handleNFTClick = (nft: UserNFT) => {
    setSelectedNFT(nft);
  };

  const wTokenBalanceFormatted = wTokenBalance ? Number(wTokenBalance) / 1e18 : 0;
  const ethBalanceFormatted = ethBalance ? parseFloat(formatEther(ethBalance.value)) : 0;

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
      {/* Sack Button - Fixed position, only visible when wallet connected and PredictionJack is not open */}
      {isWalletConnected && !showPredictionJack && (
        <button
          onClick={() => {
            if (!isOpen) {
              openInventory();
            } else {
              setIsOpen(false);
            }
          }}
          className="fixed bottom-6 right-6 z-40 transition-all duration-300 hover:scale-110 active:scale-95"
          title="Open Inventory"
        >
          <div className="relative">
            <img
              src="/Images/Sack.png"
              alt="Inventory"
              className="w-16 h-16 drop-shadow-lg animate-sack-float"
            />
            {/* Badge showing NFT count */}
            {nfts.length > 0 && (
              <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-gray-900">
                {nfts.length}
              </div>
            )}
          </div>
        </button>
      )}

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
                  {/* wToken Balance */}
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
              ) : isReconnecting || isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="relative">
                    <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-cyan-500/20 border-t-cyan-500"></div>
                    <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-cyan-500/10"></div>
                  </div>
                </div>
              ) : nfts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="relative mb-4 sm:mb-6">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-rose-500/20 flex items-center justify-center border border-purple-500/30">
                      <svg className="w-8 h-8 sm:w-10 sm:h-10 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300 mb-2">
                    No NFTs Found
                  </h3>
                  <p className="text-purple-200/60 text-sm sm:text-base">
                    You don&apos;t own any NFTs yet
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2 sm:mb-3 md:mb-4">
                    <h3 className="text-base sm:text-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-purple-300">
                      Collection ({nfts.length})
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-2.5 md:gap-3">
                    {nfts.map((nft) => {
                      const isJailed = nft.isJailed;
                      const isEgg = nft.isEgg;
                      const isEvolved = nft.evolved;

                      return (
                        <button
                          key={nft.tokenId}
                          onClick={() => handleNFTClick(nft)}
                          className="relative group rounded-xl overflow-hidden border-2 border-cyan-500/20 hover:border-cyan-400/50 transition-all hover:scale-105 active:scale-95 bg-gradient-to-br from-gray-900 to-gray-950"
                          style={{
                            boxShadow: '0 0 10px rgba(6, 182, 212, 0.1)'
                          }}
                        >
                          {/* NFT Image */}
                          <div className="aspect-square relative bg-gray-950">
                            <img
                              src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                              alt={nft.name}
                              className="w-full h-full object-cover"
                            />

                            {/* Status Badges */}
                            <div className="absolute top-1 left-1 flex flex-col gap-1">
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

                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/30 via-purple-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </div>
                          </div>

                          {/* Token ID */}
                          <div className="bg-gradient-to-r from-gray-900/90 to-gray-950/90 px-2 py-1 backdrop-blur-sm border-t border-cyan-500/10">
                            <p className="text-cyan-100 text-xs font-semibold text-center truncate">
                              #{nft.tokenId}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* NFT Options Modal */}
      <NFTOptionsModal
        nft={selectedNFT}
        isOpen={!!selectedNFT}
        onClose={() => setSelectedNFT(null)}
      />

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

        /* Sack gentle float animation - localized, with subtle scale */
        @keyframes sack-float {
          0%, 100% {
            transform: translateY(0) scale(1);
          }
          25% {
            transform: translateY(-6px) scale(1.03);
          }
          50% {
            transform: translateY(-10px) scale(1.05);
          }
          75% {
            transform: translateY(-6px) scale(1.03);
          }
        }

        .animate-sack-float {
          animation: sack-float 3s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
