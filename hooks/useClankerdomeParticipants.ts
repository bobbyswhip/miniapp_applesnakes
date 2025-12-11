// hooks/useClankerdomeParticipants.ts
'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = 'https://api.applesnakes.com';

interface Participant {
  rank: number;
  wallet: string;
  totalUsdc: number;
  sharePercent: number;
  buyCount: number;
  firstBuy?: number;
  lastBuy?: number;
  estimatedTokens: number;
}

interface ParticipantStats {
  totalParticipants: number;
  totalRaised: number;
  averageContribution: number;
  largestContribution: number;
  smallestContribution: number;
  totalBuys?: number;
}

interface Transaction {
  wallet: string;
  amount: number;
  txHash: string;
  timestamp: number;
}

export function useClankerdomeParticipants(launchId: string | null) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [stats, setStats] = useState<ParticipantStats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchParticipants = useCallback(async () => {
    if (!launchId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/${launchId}/participants`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch participants');
      }

      setParticipants(data.participants || []);
      setStats(data.summary || null);
      setTransactions(data.transactions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [launchId]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  return {
    participants,
    stats,
    transactions,
    loading,
    error,
    refresh: fetchParticipants,
  };
}
