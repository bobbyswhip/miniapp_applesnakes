'use client';

import { useTransactions, getBasescanUrl, Transaction } from '@/contexts/TransactionContext';
import { useChainId } from 'wagmi';
import { useEffect } from 'react';

export function TransactionNotifications() {
  const { transactions, removeTransaction } = useTransactions();
  const chainId = useChainId();

  // Auto-remove successful/error transactions after 5 seconds
  useEffect(() => {
    transactions.forEach(tx => {
      if (tx.status === 'success' || tx.status === 'error') {
        const timer = setTimeout(() => {
          removeTransaction(tx.hash);
        }, 5000);
        return () => clearTimeout(timer);
      }
    });
  }, [transactions, removeTransaction]);

  if (transactions.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 space-y-2 pointer-events-none">
      <div className="max-w-md mx-auto space-y-2 pointer-events-auto">
        {transactions.map((tx) => (
          <TransactionCard key={tx.hash} transaction={tx} chainId={chainId} />
        ))}
      </div>
    </div>
  );
}

function TransactionCard({ transaction, chainId }: { transaction: Transaction; chainId: number }) {
  const { removeTransaction } = useTransactions();
  const basescanUrl = getBasescanUrl(transaction.hash, chainId);

  const getStatusConfig = () => {
    switch (transaction.status) {
      case 'pending':
        return {
          bg: 'bg-blue-500/10 border-blue-500/30',
          text: 'text-blue-400',
          icon: '⏳',
          label: 'Pending',
        };
      case 'success':
        return {
          bg: 'bg-green-500/10 border-green-500/30',
          text: 'text-green-400',
          icon: '✅',
          label: 'Success',
        };
      case 'error':
        return {
          bg: 'bg-red-500/10 border-red-500/30',
          text: 'text-red-400',
          icon: '❌',
          label: 'Failed',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      className={`${config.bg} border rounded-xl p-4 shadow-lg backdrop-blur-sm animate-slide-up`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Status Icon */}
          <div className="text-2xl flex-shrink-0 mt-0.5">
            {transaction.status === 'pending' && (
              <div className="animate-spin">
                {config.icon}
              </div>
            )}
            {transaction.status !== 'pending' && config.icon}
          </div>

          {/* Transaction Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`${config.text} font-semibold text-sm`}>
                {config.label}
              </span>
            </div>
            <p className="text-white text-sm mb-2 truncate">
              {transaction.description}
            </p>
            <a
              href={basescanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 transition-colors"
            >
              <span>View on Basescan</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>

        {/* Close Button */}
        {transaction.status !== 'pending' && (
          <button
            onClick={() => removeTransaction(transaction.hash)}
            className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
