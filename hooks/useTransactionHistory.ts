// hooks/useTransactionHistory.ts
// Hook for fetching prediction market transaction history
// Endpoint: /api/prediction-market/history
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { API_BASE, TransactionAction } from '@/lib/prediction-market-constants';

export interface Transaction {
  id: number;
  marketId: string;
  outcomeIndex: number;
  wallet: string;
  side: 'yes' | 'no';
  action: TransactionAction;
  shares: number;
  amount: number;        // USDC amount
  price: number;         // Price at transaction
  txIdentifier: string;
  timestamp: number;
  date: string;          // ISO string
}

export interface MarketInfo {
  id: string;
  title: string;
  marketType: string;
  status: string;
}

export interface HistoryStats {
  totalTransactions: number;
  totalBuys: number;
  totalSells: number;
  totalBuyVolume: number;
  totalSellVolume: number;
}

interface UseHistoryOptions {
  marketId?: string;
  limit?: number;
  action?: TransactionAction;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useTransactionHistory(options: UseHistoryOptions = {}) {
  const { address } = useAccount();
  const {
    marketId,
    limit = 100,
    action,
    autoRefresh = false,
    refreshInterval = 30000,
  } = options;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [markets, setMarkets] = useState<Record<string, MarketInfo>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!address) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = new URL(`${API_BASE}/api/prediction-market/history`);
      url.searchParams.set('wallet', address);
      if (marketId) url.searchParams.set('marketId', marketId);
      if (limit) url.searchParams.set('limit', limit.toString());
      if (action) url.searchParams.set('action', action);

      console.log('[TransactionHistory] Fetching:', url.toString());

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.success) {
        setTransactions(data.transactions || []);
        setStats(data.stats || null);
        setMarkets(data.markets || {});
      } else {
        throw new Error(data.error || 'Failed to fetch history');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[TransactionHistory] Error:', message, err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [address, marketId, limit, action]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchHistory();

    if (autoRefresh && address) {
      const interval = setInterval(fetchHistory, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchHistory, autoRefresh, refreshInterval, address]);

  // Get transactions by action type
  const getByAction = useCallback((actionType: TransactionAction): Transaction[] => {
    return transactions.filter(tx => tx.action === actionType);
  }, [transactions]);

  // Get transactions for a specific market
  const getByMarket = useCallback((id: string): Transaction[] => {
    return transactions.filter(tx => tx.marketId === id);
  }, [transactions]);

  return {
    transactions,
    stats,
    markets,
    isLoading,
    error,
    refresh: fetchHistory,
    // Helpers
    getByAction,
    getByMarket,
    buys: transactions.filter(tx => tx.action === 'buy'),
    sells: transactions.filter(tx => tx.action === 'sell'),
    claims: transactions.filter(tx => tx.action === 'claim'),
    refunds: transactions.filter(tx => tx.action === 'refund'),
  };
}
