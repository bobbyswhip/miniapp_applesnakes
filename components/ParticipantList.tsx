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
    return <div className="animate-pulse text-gray-400">Loading participants...</div>;
  }

  if (error) {
    return (
      <div className="text-red-400">
        Error: {error}
        <button onClick={refresh} className="ml-2 underline text-purple-400 hover:text-purple-300">Retry</button>
      </div>
    );
  }

  if (participants.length === 0) {
    return <div className="text-gray-500">No participants yet. Be the first!</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div>
            <div className="text-sm text-gray-400">Participants</div>
            <div className="text-xl font-bold text-white">{stats.totalParticipants}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Total Raised</div>
            <div className="text-xl font-bold text-green-400">${stats.totalRaised.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Avg Contribution</div>
            <div className="text-xl font-bold text-white">${stats.averageContribution.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Largest</div>
            <div className="text-xl font-bold text-yellow-400">${stats.largestContribution.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Participant Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Rank</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Wallet</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase">Amount</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase">Share</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase">Est. Tokens</th>
            </tr>
          </thead>
          <tbody className="bg-gray-900/30 divide-y divide-gray-700/50">
            {participants.map((p) => (
              <tr key={p.wallet} className="hover:bg-gray-800/30">
                <td className="px-4 py-3 text-sm">
                  {p.rank <= 3 ? (
                    <span className={`font-bold ${
                      p.rank === 1 ? 'text-yellow-400' :
                      p.rank === 2 ? 'text-gray-300' :
                      'text-orange-400'
                    }`}>
                      {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : '🥉'} #{p.rank}
                    </span>
                  ) : (
                    <span className="text-gray-500">#{p.rank}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm">
                  <ParticipantIdentityCompact address={p.wallet} identity={getIdentity(p.wallet)} />
                </td>
                <td className="px-4 py-3 text-sm text-right text-white">
                  ${p.totalUsdc.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  <span className="font-medium text-cyan-400">{p.sharePercent.toFixed(2)}%</span>
                </td>
                <td className="px-4 py-3 text-sm text-right font-mono text-gray-300">
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
          <h4 className="text-sm font-medium text-gray-400 mb-2">Recent Transactions</h4>
          <div className="space-y-2">
            {transactions.slice(0, 10).map((tx) => (
              <div key={tx.txHash} className="flex justify-between items-center p-2 bg-gray-800/30 rounded text-sm">
                <span className="font-mono text-gray-400">
                  {tx.wallet.slice(0, 6)}...{tx.wallet.slice(-4)}
                </span>
                <span className="text-green-400">${tx.amount.toLocaleString()}</span>
                <a
                  href={`https://basescan.org/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:underline"
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
        className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}
