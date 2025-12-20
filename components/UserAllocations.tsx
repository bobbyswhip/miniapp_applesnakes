// components/UserAllocations.tsx
// User's token allocations and airdrop progress
'use client';

import { useUserAllocations, type AirdropShare, type ActiveIco } from '@/hooks/useUserAllocations';
import { TokenImage } from '@/components/TokenImage';

interface Props {
  walletAddress: string | null;
}

export function UserAllocations({ walletAddress }: Props) {
  const {
    wallet,
    dripConfig,
    loading,
    error,
    refresh,
    pendingShares,
    completedShares,
    hasAllocations,
    activeIcos,
    hasActiveIcos,
    hasLaunchedTokens,
  } = useUserAllocations(walletAddress);

  if (!walletAddress) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <div className="text-2xl mb-2">🔐</div>
        <p className="text-sm">Connect wallet to view allocations</p>
      </div>
    );
  }

  if (loading && !wallet) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
        <p className="text-gray-400 text-sm">Loading allocations...</p>
      </div>
    );
  }

  if (error) {
    // Show a friendly message for API errors (endpoint may not exist yet)
    const isApiUnavailable = error.includes('API error') || error.includes('non-JSON');
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <div className="text-2xl mb-2">{isApiUnavailable ? '🚀' : '⚠️'}</div>
        <p className="text-sm font-medium text-white">
          {isApiUnavailable ? 'Coming Soon' : 'Error Loading'}
        </p>
        <p className="text-xs mt-1 text-center px-4">
          {isApiUnavailable
            ? 'Token allocation tracking is being set up'
            : error}
        </p>
        <button
          onClick={refresh}
          className="mt-3 text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-blue-400/30 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!hasAllocations && !hasActiveIcos) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <div className="text-2xl mb-2">📦</div>
        <p className="text-sm font-medium">No Token Allocations</p>
        <p className="text-xs mt-1">Participate in Token Wars to earn tokens!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary Header - Compact */}
      <div className="flex-shrink-0 bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-lg p-2 mb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-white">Your Allocations</span>
          <span className="text-[10px] text-gray-400">{(wallet?.activeIcos?.count ?? 0) + (wallet?.launchedAirdrops?.totalSharesCount ?? wallet?.totalSharesCount ?? 0)} positions</span>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-[10px] text-gray-400">Invested</div>
            <div className="text-xs font-bold text-white">${wallet?.summary?.totalUsdcInvested ?? wallet?.totalUsdcInvested ?? 0}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">Active ICOs</div>
            <div className="text-xs font-bold text-green-400">{wallet?.activeIcos?.count ?? 0}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">Airdrops</div>
            <div className="text-xs font-bold text-purple-400">{wallet?.launchedAirdrops?.totalSharesCount ?? wallet?.totalSharesCount ?? 0}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">Completed</div>
            <div className="text-xs font-bold text-yellow-400">{wallet?.launchedAirdrops?.completedCount ?? wallet?.completedCount ?? 0}</div>
          </div>
        </div>

        {/* Overall Progress - only show if there are airdrops */}
        {(wallet?.launchedAirdrops?.totalSharesCount ?? wallet?.totalSharesCount ?? 0) > 0 && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-400">Distribution Progress</span>
            <span className="text-white">{(wallet?.launchedAirdrops?.overallProgress ?? wallet?.overallProgress ?? 0).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${wallet?.launchedAirdrops?.overallProgress ?? wallet?.overallProgress ?? 0}%` }}
            />
          </div>
        </div>
        )}
      </div>

      {/* Drip Info - Very Compact */}
      {dripConfig && (
        <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1.5 bg-gray-800/50 rounded-lg mb-2 text-[10px] text-gray-400">
          <span>Drip: {dripConfig.intervalFormatted}</span>
          <span>•</span>
          <span>{dripConfig.percentPerDrip}%/drip</span>
          <span>•</span>
          <span>Duration: {dripConfig.totalDurationFormatted}</span>
        </div>
      )}

      {/* Allocations List - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {/* Active ICOs (Pre-launch) */}
        {hasActiveIcos && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-white">Active ICOs ({activeIcos.length})</span>
            </div>
            <div className="space-y-1.5">
              {activeIcos.map((ico) => (
                <ActiveIcoCard key={ico.warId} ico={ico} />
              ))}
            </div>
          </div>
        )}

        {/* Pending Airdrops (Post-launch) */}
        {pendingShares.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-white">Active ({pendingShares.length})</span>
            </div>
            <div className="space-y-1.5">
              {pendingShares.map((share) => (
                <AllocationCard key={share.warId} share={share} />
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {completedShares.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              <span className="text-xs font-bold text-white">Completed ({completedShares.length})</span>
            </div>
            <div className="space-y-1.5">
              {completedShares.map((share) => (
                <AllocationCard key={share.warId} share={share} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AllocationCard({ share }: { share: AirdropShare }) {
  return (
    <div className={`p-2 rounded-lg ${share.isComplete ? 'bg-gray-800/50' : 'bg-gray-800/50 border border-yellow-500/20'}`}>
      {/* Header with Token Image */}
      <div className="flex justify-between items-start mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <TokenImage
            warId={share.warId}
            symbol={share.tokenSymbol}
            size={32}
          />
          <div className="min-w-0">
            <div className="font-bold text-sm text-white truncate">{share.tokenSymbol}</div>
            <div className="text-[10px] text-gray-400 truncate">{share.tokenName}</div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-gray-400">Share</div>
          <div className="text-xs font-bold text-purple-400">{share.sharePercent.toFixed(2)}%</div>
        </div>
      </div>

      {/* Token Amounts - Compact Grid */}
      <div className="grid grid-cols-3 gap-2 mb-1.5 text-[10px]">
        <div>
          <div className="text-gray-500">Total</div>
          <div className="font-medium text-white truncate">{share.formatted.totalAllocation}</div>
        </div>
        <div>
          <div className="text-gray-500">Received</div>
          <div className="font-medium text-green-400 truncate">{share.formatted.tokensSent}</div>
        </div>
        <div>
          <div className="text-gray-500">Remaining</div>
          <div className="font-medium text-yellow-400 truncate">{share.formatted.tokensRemaining}</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-1.5">
        <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
          <span>{share.dripCount} drips</span>
          <span>{share.percentDistributed.toFixed(1)}%</span>
        </div>
        <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${share.isComplete ? 'bg-green-500' : 'bg-yellow-500'}`}
            style={{ width: `${share.percentDistributed}%` }}
          />
        </div>
      </div>

      {/* Timing / Status */}
      {!share.isComplete ? (
        <div className="flex justify-between text-[10px]">
          <div>
            <span className="text-gray-500">Next: </span>
            <span className="text-yellow-400 font-mono">{share.timeToNextDripFormatted}</span>
          </div>
          <div>
            <span className="text-gray-500">Done in: </span>
            <span className="text-gray-300">{share.timeToCompleteFormatted}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-green-400 text-[10px]">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>Complete</span>
        </div>
      )}

      {/* Token Link */}
      <a
        href={`https://basescan.org/token/${share.tokenAddress}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 pt-1.5 border-t border-gray-700/50 text-[9px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
      >
        View on Basescan
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}

// Active ICO Card component
function ActiveIcoCard({ ico }: { ico: ActiveIco }) {
  const statusColors: Record<string, string> = {
    active: 'text-green-400',
    launching: 'text-yellow-400',
    ended: 'text-blue-400',
    cancelled: 'text-gray-400',
    failed: 'text-red-400',
  };

  return (
    <div className="p-2 rounded-lg bg-gray-800/50 border border-green-500/20">
      {/* Header with Token Image */}
      <div className="flex justify-between items-start mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <TokenImage
            imageUrl={ico.imageUrl}
            warId={ico.warId}
            symbol={ico.tokenSymbol}
            size={32}
          />
          <div className="min-w-0">
            <div className="font-bold text-sm text-white truncate">{ico.tokenSymbol}</div>
            <div className="text-[10px] text-gray-400 truncate">
              {ico.tokenName}
              <span className={`ml-1 ${statusColors[ico.status]}`}>
                ({ico.status})
              </span>
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-gray-400">Share</div>
          <div className="text-xs font-bold text-purple-400">{ico.userSharePercent.toFixed(2)}%</div>
        </div>
      </div>

      {/* Stats Grid - Compact */}
      <div className="grid grid-cols-3 gap-2 mb-1.5 text-[10px]">
        <div>
          <div className="text-gray-500">Invested</div>
          <div className="font-medium text-white">${ico.userContribution}</div>
        </div>
        <div>
          <div className="text-gray-500">Total Raised</div>
          <div className="font-medium text-green-400">
            ${ico.totalRaised}
            {ico.targetAmount && <span className="text-gray-500">/${ico.targetAmount}</span>}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Participants</div>
          <div className="font-medium text-blue-400">{ico.participantCount}</div>
        </div>
      </div>

      {/* Progress Bar (if target exists) */}
      {ico.targetAmount && (
        <div className="mb-1.5">
          <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
            <span>Funding</span>
            <span>{ico.percentRaised.toFixed(1)}%</span>
          </div>
          <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
              style={{ width: `${Math.min(ico.percentRaised, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Timing & Vote Info */}
      <div className="flex justify-between items-center text-[10px]">
        <div>
          {ico.isEnded ? (
            <span className="text-blue-400">Ended</span>
          ) : (
            <>
              <span className="text-gray-500">Ends in: </span>
              <span className="text-green-400 font-mono">{ico.timeRemainingFormatted}</span>
            </>
          )}
        </div>
        <div className="flex gap-1">
          {ico.isRawIco ? (
            <span className="bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[9px]">
              RAW ICO
            </span>
          ) : (
            <>
              {ico.winningDex && (
                <span className="bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded text-[9px]">
                  {ico.winningDex.toUpperCase()}
                </span>
              )}
              {ico.winningPair && (
                <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[9px]">
                  {ico.winningPair.toUpperCase()}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default UserAllocations;
