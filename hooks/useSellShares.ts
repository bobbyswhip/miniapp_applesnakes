// hooks/useSellShares.ts
// Hook for selling prediction market shares
// Endpoint: /api/prediction-market/sell/verified
'use client';

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { API_BASE, SELL_COOLDOWN_MS } from '@/lib/prediction-market-constants';

interface SellParams {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  sharesToSell: number;
}

interface SellResult {
  success: boolean;
  usdcReturned?: number;
  txHash?: string;
  remainingShares?: number;
  error?: string;
  waitMs?: number;  // If cooldown active
}

interface SellStatus {
  cooldownActive: boolean;
  cooldownWaitMs: number;
  pendingTx: boolean;
  pendingTxHash?: string;
}

interface Position {
  marketId: string;
  outcomeIndex: number;
  side: 'yes' | 'no';
  shares: number;
  totalCost: number;
  averagePrice: number;
  currentPrice: number;
  estimatedValue: number;
  canSell: boolean;
}

interface SellStatusResponse {
  success: boolean;
  wallet: string;
  status: SellStatus;
  positions: Position[];
  minSellValue: number;
}

export function useSellShares() {
  const { address } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SellStatus | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);

  // Check if user can sell and get their positions
  const checkStatus = useCallback(async (marketId?: string): Promise<SellStatusResponse | null> => {
    if (!address) return null;

    try {
      const url = new URL(`${API_BASE}/api/prediction-market/sell/verified`);
      url.searchParams.set('wallet', address);
      if (marketId) url.searchParams.set('marketId', marketId);

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.success) {
        setStatus(data.status);
        setPositions(data.positions || []);
        return data;
      }
      return null;
    } catch (err) {
      console.error('[SellShares] Failed to check status:', err);
      return null;
    }
  }, [address]);

  // Execute sell
  const sellShares = useCallback(async (params: SellParams): Promise<SellResult> => {
    if (!address) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (params.sharesToSell <= 0) {
      return { success: false, error: 'Invalid share amount' };
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('[SellShares] Selling shares:', params);

      const response = await fetch(`${API_BASE}/api/prediction-market/sell/verified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketId: params.marketId,
          outcomeIndex: params.outcomeIndex,
          side: params.side,
          sharesToSell: params.sharesToSell,
          walletAddress: address,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle rate limiting / cooldown
        if (data.code === 'COOLDOWN_ACTIVE') {
          console.log('[SellShares] Cooldown active, wait:', data.waitMs);
          return {
            success: false,
            error: data.error || 'Please wait before selling again',
            waitMs: data.waitMs,
          };
        }
        if (data.code === 'TX_PENDING') {
          console.log('[SellShares] Transaction pending:', data.pendingTxHash);
          return {
            success: false,
            error: data.error || 'Previous transaction still processing',
          };
        }
        if (data.code === 'USDC_SEND_FAILED') {
          console.error('[SellShares] USDC send failed');
          return {
            success: false,
            error: data.error || 'Failed to send USDC. Please contact support.',
          };
        }
        throw new Error(data.error || 'Sell failed');
      }

      console.log('[SellShares] Sell successful:', data);
      return {
        success: true,
        usdcReturned: data.sale?.usdcReturned,
        txHash: data.sale?.txHash,
        remainingShares: data.remainingPosition?.shares,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[SellShares] Error:', message, err);
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    sellShares,
    checkStatus,
    isLoading,
    error,
    clearError,
    status,
    positions,
    address,
    // Constants for UI
    cooldownMs: SELL_COOLDOWN_MS,
  };
}
