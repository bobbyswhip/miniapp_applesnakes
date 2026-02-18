'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { UserNFT } from '@/hooks/useUserNFTs';
import {
  useListNFT,
  useListBatch,
  useUnlistNFT,
  useNFTApproval,
  useSetApprovalForAll,
  useListing,
  useIsCollectionApproved,
} from '@/hooks/useMarketplace';
import { getContracts } from '@/config/contracts';
import { base } from 'wagmi/chains';

interface ListingModalProps {
  nft?: UserNFT | null; // Single NFT (legacy support)
  nfts?: UserNFT[]; // Multiple NFTs for bulk listing
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ListingModal({ nft, nfts, isOpen, onClose, onSuccess }: ListingModalProps) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const nftCollection = contracts.nft.address;

  // Determine if this is a bulk listing
  const nftList = nfts && nfts.length > 0 ? nfts : nft ? [nft] : [];
  const isBulkListing = nftList.length > 1;
  const primaryNft = nftList[0];

  const [price, setPrice] = useState('');
  const [step, setStep] = useState<'input' | 'approve' | 'list' | 'success' | 'unlist'>('input');

  // Check if collection is approved for marketplace
  const { isApproved: collectionApproved } = useIsCollectionApproved(nftCollection);

  // Check NFT approval (checks both isApprovedForAll and per-token approval)
  const { isApproved: nftApproved, isApprovedForAll, refetchApproval } = useNFTApproval(
    nftCollection,
    primaryNft ? BigInt(primaryNft.tokenId) : 0n
  );

  // Check existing listing (only for single NFT mode)
  const { listing, refetch: refetchListing } = useListing(
    nftCollection,
    primaryNft && !isBulkListing ? BigInt(primaryNft.tokenId) : 0n
  );

  // Set approval for all NFTs (one-time approval)
  const {
    setApprovalForAll,
    isPending: isApproving,
    isConfirming: isApprovingConfirming,
    isSuccess: approveSuccess,
    error: approveError,
    reset: resetApprove,
  } = useSetApprovalForAll();

  // Single list NFT
  const {
    list,
    isPending: isListingSingle,
    isConfirming: isListingSingleConfirming,
    isSuccess: listSingleSuccess,
    error: listSingleError,
    reset: resetListSingle,
  } = useListNFT();

  // Batch list NFTs
  const {
    listBatch,
    isPending: isListingBatch,
    isConfirming: isListingBatchConfirming,
    isSuccess: listBatchSuccess,
    error: listBatchError,
    reset: resetListBatch,
  } = useListBatch();

  // Unlist NFT
  const {
    unlist,
    isPending: isUnlisting,
    isConfirming: isUnlistingConfirming,
    isSuccess: unlistSuccess,
    error: unlistError,
    reset: resetUnlist,
  } = useUnlistNFT();

  // Combined states
  const isListing = isListingSingle || isListingBatch;
  const isListingConfirming = isListingSingleConfirming || isListingBatchConfirming;
  const listSuccess = listSingleSuccess || listBatchSuccess;
  const listError = listSingleError || listBatchError;

  // Track previous values to prevent infinite loops
  const prevIsOpenRef = useRef(false);
  const prevNftIdRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);

  // Store callbacks in refs to avoid dependency issues
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  onSuccessRef.current = onSuccess;
  onCloseRef.current = onClose;

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  // Reset state when modal opens (only once per open)
  useEffect(() => {
    const isNewOpen = isOpen && !prevIsOpenRef.current;
    const isNewNft = primaryNft && primaryNft.tokenId !== prevNftIdRef.current;

    if (isOpen && primaryNft && (isNewOpen || isNewNft)) {
      resetApprove();
      resetListSingle();
      resetListBatch();
      resetUnlist();
      hasInitializedRef.current = false;
      setStep('input');
      setPrice('');
    }

    prevIsOpenRef.current = isOpen;
    prevNftIdRef.current = primaryNft?.tokenId ?? null;
  }, [isOpen, primaryNft?.tokenId, resetApprove, resetListSingle, resetListBatch, resetUnlist]);

  // Check listing status after initial render (only once, only for single NFT)
  useEffect(() => {
    if (isOpen && primaryNft && !isBulkListing && listing && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      if (listing.active && listing.seller.toLowerCase() === address?.toLowerCase()) {
        setStep('unlist');
        setPrice(listing.priceFormatted);
      }
    }
  }, [isOpen, primaryNft, isBulkListing, listing?.active, listing?.seller, listing?.priceFormatted, address]);

  // Store price in ref for use after approval
  const priceRef = useRef(price);
  priceRef.current = price;

  // Handle approve success - now actually call list()
  useEffect(() => {
    if (approveSuccess && nftList.length > 0) {
      refetchApproval();
      setStep('list');
      // Submit the list transaction after approval
      if (isBulkListing) {
        const tokenIds = nftList.map(n => BigInt(n.tokenId));
        listBatch(nftCollection, tokenIds, priceRef.current);
      } else {
        list(nftCollection, BigInt(nftList[0].tokenId), priceRef.current);
      }
    }
  }, [approveSuccess, refetchApproval, nftList, nftCollection, list, listBatch, isBulkListing]);

  // Handle list success
  useEffect(() => {
    if (listSuccess) {
      setStep('success');
      refetchListing();
      onSuccessRef.current?.();
    }
  }, [listSuccess, refetchListing]);

  // Handle unlist success
  useEffect(() => {
    if (unlistSuccess) {
      refetchListing();
      onCloseRef.current();
      onSuccessRef.current?.();
    }
  }, [unlistSuccess, refetchListing]);

  if (!isOpen || nftList.length === 0) return null;

  const handleSubmit = async () => {
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 1) {
      alert('Minimum price is 1 wASS');
      return;
    }

    if (!nftApproved) {
      // Use setApprovalForAll for one-time approval of all NFTs
      setStep('approve');
      await setApprovalForAll(nftCollection, true);
    } else {
      setStep('list');
      if (isBulkListing) {
        const tokenIds = nftList.map(n => BigInt(n.tokenId));
        await listBatch(nftCollection, tokenIds, price);
      } else {
        await list(nftCollection, BigInt(nftList[0].tokenId), price);
      }
    }
  };

  const handleUnlist = async () => {
    if (primaryNft) {
      await unlist(nftCollection, BigInt(primaryNft.tokenId));
    }
  };

  const isProcessing = isApproving || isApprovingConfirming || isListing || isListingConfirming || isUnlisting || isUnlistingConfirming;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div
        className="rounded-2xl w-full relative"
        style={{
          maxWidth: 'clamp(20rem, 90vw, 28rem)',
          maxHeight: 'clamp(30rem, 85vh, 40rem)',
          overflowY: 'auto',
          background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.05), rgba(197, 169, 123, 0.08), rgba(255, 208, 117, 0.05))',
          backgroundColor: 'rgba(10, 13, 12, 0.98)',
          border: '2px solid rgba(255, 208, 117, 0.3)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 50px rgba(255, 208, 117, 0.3), 0 0 100px rgba(197, 169, 123, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="rounded-t-2xl relative overflow-hidden"
          style={{
            padding: 'clamp(0.75rem, 2.5vh, 1rem)',
            background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.3), rgba(197, 169, 123, 0.3))',
            borderBottom: '1px solid rgba(255, 208, 117, 0.3)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏪</span>
              <div>
                <h2
                  className="font-bold text-lg"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 208, 117, 1), rgba(197, 169, 123, 1))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {step === 'unlist' ? 'Manage Listing' : isBulkListing ? `List ${nftList.length} NFTs` : 'List on Marketplace'}
                </h2>
                <p className="text-[#e0e0e0] text-sm">
                  {isBulkListing ? `${nftList.length} NFTs selected` : primaryNft?.name}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#c5a97b]/80 hover:text-[#ffd075] transition-colors text-xl"
            >
              ✕
            </button>
          </div>
        </div>

        {/* NFT Preview */}
        <div className="p-4 border-b border-[rgba(255,208,117,0.2)]">
          {isBulkListing ? (
            // Grid preview for multiple NFTs
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                {nftList.slice(0, 6).map((nftItem) => (
                  <img
                    key={nftItem.tokenId}
                    src={nftItem.imageUrl}
                    alt={nftItem.name}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                ))}
                {nftList.length > 6 && (
                  <div className="w-12 h-12 rounded-lg bg-[#1a2221] flex items-center justify-center text-[#8a9090] text-sm">
                    +{nftList.length - 6}
                  </div>
                )}
              </div>
              <p className="text-[#8a9090] text-sm">
                All {nftList.length} NFTs will be listed at the same price
              </p>
              {isApprovedForAll && (
                <p className="text-[#22c55e] text-xs mt-1">✓ Marketplace approved</p>
              )}
            </div>
          ) : (
            // Single NFT preview
            <div className="flex items-center gap-4">
              <img
                src={primaryNft?.imageUrl}
                alt={primaryNft?.name}
                className="w-20 h-20 rounded-lg object-cover"
              />
              <div className="flex-1">
                <p className="text-white text-sm">Token ID: <span className="font-mono">#{primaryNft?.tokenId}</span></p>
                <p className="text-white text-sm">Type: <span className="capitalize">{primaryNft?.nftType}</span></p>
                {!collectionApproved && (
                  <p className="text-[#ffd075] text-xs mt-1">Collection not yet approved</p>
                )}
                {isApprovedForAll && (
                  <p className="text-[#22c55e] text-xs mt-1">✓ Marketplace approved</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Collection not approved warning */}
          {!collectionApproved && (
            <div className="mb-4 p-3 bg-[rgba(255,208,117,0.08)] border border-[rgba(255,208,117,0.2)] rounded-lg">
              <p className="text-[#ffd075] text-sm">
                Approve collection to list your NFT{isBulkListing ? 's' : ''}.
              </p>
            </div>
          )}

          {/* Input Step */}
          {step === 'input' && (
            <>
              <div className="mb-4">
                <label className="block text-[#8a9090] text-sm mb-2">
                  Price per NFT (wASS)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Enter price in wASS"
                    min="1"
                    step="0.1"
                    className="w-full bg-[#1a2221]/50 border border-[rgba(255,208,117,0.3)] rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-[#ffd075]"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8a9090]">wASS</span>
                </div>
                <p className="text-[#6b7575] text-xs mt-1">
                  Minimum: 1 wASS • 5% seller fee
                  {isBulkListing && ` • Each NFT listed at ${price || '0'} wASS`}
                </p>
              </div>

              {/* Quick price buttons */}
              <div className="flex gap-2 mb-4">
                {['5', '10', '25', '50', '100'].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrice(p)}
                    className="flex-1 py-2 px-3 bg-[#1a2221]/50 border border-[rgba(255,208,117,0.2)] rounded-lg text-[#cecece] hover:bg-[rgba(255,208,117,0.1)] hover:border-[rgba(255,208,117,0.4)] transition-colors text-sm"
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                onClick={handleSubmit}
                disabled={!price || parseFloat(price) < 1 || isProcessing}
                className="w-full py-3 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.8), rgba(197, 169, 123, 0.8))',
                  border: '2px solid rgba(255, 208, 117, 0.5)',
                  color: 'white',
                }}
              >
                {!nftApproved
                  ? `Approve & List ${isBulkListing ? `${nftList.length} NFTs` : 'NFT'}`
                  : `List ${isBulkListing ? `${nftList.length} NFTs` : 'NFT'}`
                }
              </button>
            </>
          )}

          {/* Approve Step */}
          {step === 'approve' && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ffd075] mx-auto mb-4"></div>
              <p className="text-white font-medium mb-2">
                {isApproving ? 'Confirm in wallet...' : 'Approving marketplace...'}
              </p>
              <p className="text-[#8a9090] text-sm">One-time approval for marketplace</p>
              {approveError && (
                <p className="text-[#FF3B5C] text-sm mt-2">{approveError.message}</p>
              )}
            </div>
          )}

          {/* List Step */}
          {step === 'list' && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ffd075] mx-auto mb-4"></div>
              <p className="text-white font-medium mb-2">
                {isListing ? 'Confirm in wallet...' : `Creating ${isBulkListing ? 'listings' : 'listing'}...`}
              </p>
              <p className="text-[#8a9090] text-sm">
                {isBulkListing
                  ? `Listing ${nftList.length} NFTs at ${price} wASS each`
                  : `Listing for ${price} wASS`
                }
              </p>
              {listError && (
                <p className="text-[#FF3B5C] text-sm mt-2">{listError.message}</p>
              )}
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">🎉</div>
              <p className="text-white font-bold text-xl mb-2">Listed!</p>
              <p className="text-[#8a9090] mb-4">
                {isBulkListing
                  ? `${nftList.length} NFTs are now for sale at ${price} wASS each`
                  : `Your NFT is now for sale at ${price} wASS`
                }
              </p>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-lg font-semibold"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.8), rgba(197, 169, 123, 0.8))',
                  border: '2px solid rgba(255, 208, 117, 0.5)',
                  color: 'white',
                }}
              >
                Done
              </button>
            </div>
          )}

          {/* Unlist Step (already listed) - only for single NFT */}
          {step === 'unlist' && listing && !isBulkListing && (
            <>
              <div className="mb-4 p-3 bg-[rgba(255,208,117,0.1)] border border-[rgba(255,208,117,0.3)] rounded-lg">
                <p className="text-[#ffd075] font-medium">Currently Listed</p>
                <p className="text-white text-2xl font-bold">{listing.priceFormatted} wASS</p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleUnlist}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-lg font-semibold transition-all disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.8), rgba(220, 38, 38, 0.8))',
                    border: '2px solid rgba(239, 68, 68, 0.5)',
                    color: 'white',
                  }}
                >
                  {isUnlisting || isUnlistingConfirming ? 'Removing...' : 'Remove Listing'}
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-3 rounded-lg font-semibold bg-[#1a2221] text-[#cecece] hover:bg-[#1f2827] transition-colors"
                >
                  Keep Listed
                </button>
              </div>

              {unlistError && (
                <p className="text-[#FF3B5C] text-sm mt-2 text-center">{unlistError.message}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
