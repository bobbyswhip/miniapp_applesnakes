// components/WalletShareCard.tsx
'use client';

import { useAccount } from 'wagmi';
import { useClankerdomeLaunchWithParticipants } from '@/hooks/useClankerdomeLaunchWithParticipants';

interface WalletShareCardProps {
  launchId: string;
}

export function WalletShareCard({ launchId }: WalletShareCardProps) {
  const { address } = useAccount();
  const { walletInfo, launch, loading, error } = useClankerdomeLaunchWithParticipants(
    launchId,
    { walletAddress: address }
  );

  if (!address) {
    return (
      <div className="p-4 bg-gray-800/50 rounded-lg text-center text-gray-500 border border-gray-700">
        Connect wallet to see your share
      </div>
    );
  }

  if (loading) {
    return <div className="animate-pulse p-4 text-gray-400">Loading your position...</div>;
  }

  if (error || !walletInfo) {
    return null;
  }

  if (walletInfo.totalContribution === 0) {
    return (
      <div className="p-4 bg-purple-900/20 rounded-lg text-center border border-purple-500/30">
        <p className="text-purple-300">You haven&apos;t joined this launch yet</p>
        <p className="text-sm text-purple-400 mt-1">Buy in with USDC to get your share!</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gradient-to-r from-green-900/30 to-purple-900/30 rounded-lg border border-green-500/30">
      <h3 className="font-bold text-lg mb-3 text-white">Your Position</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm text-gray-400">Your Contribution</div>
          <div className="text-2xl font-bold text-green-400">
            ${walletInfo.totalContribution.toLocaleString()}
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-400">Your Share</div>
          <div className="text-2xl font-bold text-purple-400">
            {walletInfo.sharePercent.toFixed(2)}%
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-400">Your Rank</div>
          <div className="text-xl font-bold text-white">
            {walletInfo.rank ? `#${walletInfo.rank}` : '-'}
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-400">Buy Count</div>
          <div className="text-xl font-bold text-white">{walletInfo.buyCount}</div>
        </div>
      </div>

      {launch && launch.totalRaised > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="text-sm text-gray-400">Estimated Token Allocation</div>
          <div className="text-xl font-mono font-bold text-cyan-400">
            {Math.floor((walletInfo.totalContribution / launch.totalRaised) * 1_000_000_000).toLocaleString()} tokens
          </div>
          <div className="text-xs text-gray-500">Based on 1B total supply</div>
        </div>
      )}
    </div>
  );
}
