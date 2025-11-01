'use client';

import { useUserNFTs } from '@/hooks/useUserNFTs';
import { NFTGallery } from '@/components/NFTImage';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

/**
 * My NFTs Page
 *
 * Displays all NFTs owned by the connected user
 * Shows jailed status and allows clicking to view details
 */
export default function MyNFTsPage() {
  const { address: userAddress } = useAccount();
  const { nfts, isLoading, error } = useUserNFTs();

  if (!userAddress) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-bold text-white">My AppleSnakes</h1>
          <p className="text-gray-400">Connect your wallet to view your NFT collection</p>
          <ConnectButton />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-gray-400">Loading your NFTs...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-6 max-w-md">
          <h2 className="text-red-400 font-semibold mb-2">Error Loading NFTs</h2>
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (nfts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <span className="text-6xl">🐍</span>
          <h2 className="text-2xl font-bold text-white">No AppleSnakes Yet</h2>
          <p className="text-gray-400">You don&apos;t own any AppleSnakes NFTs</p>
          <p className="text-sm text-gray-500">Mint or buy some to get started!</p>
        </div>
      </div>
    );
  }

  const jailedCount = nfts.filter(nft => nft.isJailed).length;
  const freeCount = nfts.length - jailedCount;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">My AppleSnakes</h1>
            <p className="text-gray-400">
              You own <span className="text-white font-semibold">{nfts.length}</span> AppleSnakes
            </p>
          </div>
          <ConnectButton />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-1">Total NFTs</p>
            <p className="text-3xl font-bold text-white">{nfts.length}</p>
          </div>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-green-400 text-sm mb-1">Free</p>
            <p className="text-3xl font-bold text-green-400">{freeCount}</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-red-400 text-sm mb-1">Jailed ⛓️</p>
            <p className="text-3xl font-bold text-red-400">{jailedCount}</p>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
            <p className="text-purple-400 text-sm mb-1">Floor Value</p>
            <p className="text-2xl font-bold text-purple-400">TBD</p>
          </div>
        </div>

        {/* Filters (Optional - can add later) */}
        {/* <div className="flex gap-2">
          <button className="px-4 py-2 bg-gray-800 rounded-lg text-white">All</button>
          <button className="px-4 py-2 bg-gray-800/50 rounded-lg text-gray-400">Free</button>
          <button className="px-4 py-2 bg-gray-800/50 rounded-lg text-gray-400">Jailed</button>
        </div> */}

        {/* NFT Gallery */}
        <NFTGallery
          nfts={nfts}
          onNFTClick={(tokenId) => {
            // Navigate to NFT detail page
            window.location.href = `/nft/${tokenId}`;
          }}
          showJailedBadge={true}
        />
      </div>
    </div>
  );
}
