'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { base } from 'wagmi/chains';

export interface Transaction {
  hash: string;
  description: string;
  status: 'pending' | 'success' | 'error';
  timestamp: number;
}

interface TransactionContextType {
  transactions: Transaction[];
  addTransaction: (hash: string, description: string) => void;
  updateTransaction: (hash: string, status: 'success' | 'error') => void;
  removeTransaction: (hash: string) => void;
  clearAll: () => void;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export function TransactionProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const addTransaction = useCallback((hash: string, description: string) => {
    const newTransaction: Transaction = {
      hash,
      description,
      status: 'pending',
      timestamp: Date.now(),
    };
    setTransactions(prev => [...prev, newTransaction]);
  }, []);

  const updateTransaction = useCallback((hash: string, status: 'success' | 'error') => {
    setTransactions(prev =>
      prev.map(tx =>
        tx.hash === hash ? { ...tx, status } : tx
      )
    );
  }, []);

  const removeTransaction = useCallback((hash: string) => {
    setTransactions(prev => prev.filter(tx => tx.hash !== hash));
  }, []);

  const clearAll = useCallback(() => {
    setTransactions([]);
  }, []);

  return (
    <TransactionContext.Provider
      value={{
        transactions,
        addTransaction,
        updateTransaction,
        removeTransaction,
        clearAll,
      }}
    >
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactions() {
  const context = useContext(TransactionContext);
  if (context === undefined) {
    throw new Error('useTransactions must be used within TransactionProvider');
  }
  return context;
}

// Helper to get basescan URL
export function getBasescanUrl(hash: string, chainId: number = base.id): string {
  if (chainId === base.id) {
    return `https://basescan.org/tx/${hash}`;
  }
  // Base Sepolia
  return `https://sepolia.basescan.org/tx/${hash}`;
}
