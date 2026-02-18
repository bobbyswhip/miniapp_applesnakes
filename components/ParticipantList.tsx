// components/ParticipantList.tsx
'use client';

import { useMemo } from 'react';
import { useClankerdomeParticipants } from '@/hooks/useClankerdomeParticipants';
import { useBatchIdentities } from '@/hooks/useBatchIdentities';
import { ParticipantIdentityCompact } from './ParticipantIdentity';

interface ParticipantListProps {
  launchId: string;
  showTransactions?: boolean;
}

export function ParticipantList({ launchId, showTransactions }: ParticipantListProps) {
  const { participants, stats, transactions, loading, error, refresh } = useClankerdomeParticipants(launchId);

  // Batch fetch identities for all participants
  const participantAddresses = useMemo(
    () => participants.map(p => p.wallet),
    [participants]
  );
  const { getIdentity } = useBatchIdentities(participantAddresses);

  if (loading) {
    return <div className="animate-pulse text-[#8a9090]">Loading participants...</div>;
  }

  if (error) {
    return (
      <div className="text-red-400">
        Error: {error}
        <button onClick={refresh} className="ml-2 underline text-[#ffd075] hover:text-[#ffe0a0]">Retry</button>
      </div>
    );
  }

  if (participants.length === 0) {
    return <div className="text-[#6b7575]">No participants yet. Be the first!</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-[#1a2221]/50 rounded-lg border border-[rgba(255,255,255,0.06)]">
          <div>
            <div className="text-sm text-[#8a9090]">Participants</div>
            <div className="text-xl font-bold text-white">{stats.totalParticipants}</div>
          </div>
          <div>
            <div className="text-sm text-[#8a9090]">Total Raised</div>
            <div className="text-xl font-bold text-green-400">${stats.totalRaised.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-sm text-[#8a9090]">Avg Contribution</div>
            <div className="text-xl font-bold text-white">${stats.averageContribution.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-sm text-[#8a9090]">Largest</div>
            <div className="text-xl font-bold text-yellow-400">${stats.largestContribution.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Participant Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgba(255,255,255,0.06)]">
          <thead className="bg-[#1a2221]/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-[#8a9090] uppercase">Rank</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[#8a9090] uppercase">Wallet</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8a9090] uppercase">Amount</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8a9090] uppercase">Share</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8a9090] uppercase">Est. Tokens</th>
            </tr>
          </thead>
          <tbody className="bg-[#171e1d]/30 divide-y divide-[rgba(255,255,255,0.04)]">
            {participants.map((p) => (
              <tr key={p.wallet} className="hover:bg-[#1a2221]/30">
                <td className="px-4 py-3 text-sm">
                  {p.rank <= 3 ? (
                    <span className={`font-bold ${
                      p.rank === 1 ? 'text-yellow-400' :
                      p.rank === 2 ? 'text-[#cecece]' :
                      'text-orange-400'
                    }`}>
                      {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : '🥉'} #{p.rank}
                    </span>
                  ) : (
                    <span className="text-[#6b7575]">#{p.rank}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm">
                  <ParticipantIdentityCompact address={p.wallet} identity={getIdentity(p.wallet)} />
                </td>
                <td className="px-4 py-3 text-sm text-right text-white">
                  ${p.totalUsdc.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  <span className="font-medium text-[#ffd075]">{p.sharePercent.toFixed(2)}%</span>
                </td>
                <td className="px-4 py-3 text-sm text-right font-mono text-[#cecece]">
                  {p.estimatedTokens.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transactions Section */}
      {showTransactions && transactions.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-[#8a9090] mb-2">Recent Transactions</h4>
          <div className="space-y-2">
            {transactions.slice(0, 10).map((tx) => (
              <div key={tx.txHash} className="flex justify-between items-center p-2 bg-[#1a2221]/30 rounded text-sm">
                <span className="font-mono text-[#8a9090]">
                  {tx.wallet.slice(0, 6)}...{tx.wallet.slice(-4)}
                </span>
                <span className="text-green-400">${tx.amount.toLocaleString()}</span>
                <a
                  href={`https://basescan.org/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ffd075] hover:underline"
                >
                  View TX
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={refresh}
        className="w-full py-2 text-sm text-[#8a9090] hover:text-white transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}
