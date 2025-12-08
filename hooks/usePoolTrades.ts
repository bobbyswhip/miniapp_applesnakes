'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDefaultPair, TOKEN_PAIRS } from '@/config';

// GeckoTerminal trades API response types
interface GeckoTradeAttributes {
  block_number: number;
  block_timestamp: string;
  tx_hash: string;
  tx_from_address: string;
  from_token_amount: string;
  to_token_amount: string;
  price_from_in_currency_token: string;
  price_to_in_currency_token: string;
  price_from_in_usd: string;
  price_to_in_usd: string;
  kind: 'buy' | 'sell';
  volume_in_usd: string;
  from_token_address: string;
  to_token_address: string;
}

interface GeckoTradeItem {
  id: string;
  type: string;
  attributes: GeckoTradeAttributes;
}

interface GeckoTradesResponse {
  data: GeckoTradeItem[];
}

// Basescan API response types for token transfers
interface BasescanTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  tokenDecimal: string;
}

interface BasescanResponse {
  status: string;
  message: string;
  result: BasescanTransfer[];
}

// Normalized trade type for UI
export interface PoolTrade {
  txHash: string;
  timestamp: Date;
  type: 'buy' | 'sell';
  amountIn: string;
  amountOut: string;
  priceUsd: string;
  volumeUsd: string;
  wallet: string;
  blockNumber: number;
}

interface UsePoolTradesReturn {
  trades: PoolTrade[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// Helper to format relative time
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// Helper to truncate wallet address
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Get token address from pool ID (geckoPoolAddress)
function getTokenAddressFromPool(poolAddress: string): string | null {
  // Find the token pair that matches this pool address
  const pair = TOKEN_PAIRS.find(p => p.geckoPoolAddress === poolAddress);
  if (pair) {
    // Return the non-ETH token address
    return pair.token1 !== '0x0000000000000000000000000000000000000000'
      ? pair.token1
      : pair.token0;
  }
  return null;
}

// Known router/pool addresses that indicate a swap
const ROUTER_ADDRESSES = [
  '0x6ff5693b99212da76ad316178a184ab56d299b43', // Universal Router V4
  '0x498581fF718922c3f8e6A244956aF099B2652b2b', // Pool Manager
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal Router
  '0x2626664c2603336e57b271c5c0b26f421741e481', // Uniswap V3 Router
].map(a => a.toLowerCase());

export function usePoolTrades(poolAddress?: string): UsePoolTradesReturn {
  const [trades, setTrades] = useState<PoolTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);
  const lastPoolRef = useRef<string | undefined>(undefined);
  const isFirstFetchRef = useRef<boolean>(true);

  // Use default pool if none provided
  const effectivePoolAddress = poolAddress || getDefaultPair().geckoPoolAddress;

  const fetchTrades = useCallback(async (forceRefresh = false) => {
    if (!effectivePoolAddress) {
      setError('No pool address available');
      setIsLoading(false);
      return;
    }

    // Check if pool address changed - always fetch immediately on pool change
    const poolChanged = effectivePoolAddress !== lastPoolRef.current;
    if (poolChanged) {
      lastPoolRef.current = effectivePoolAddress;
      // Clear existing trades immediately when pool changes to prevent showing stale data
      setTrades([]);
    }

    // Throttle fetches to prevent excessive API calls (unless forced or pool changed)
    const now = Date.now();
    if (!forceRefresh && !poolChanged && now - lastFetchRef.current < 3000) {
      return; // Skip if last fetch was less than 3s ago
    }
    lastFetchRef.current = now;

    // Only show loading spinner on first fetch or when pool changes
    // This prevents screen flicker on background refreshes
    if (isFirstFetchRef.current || poolChanged) {
      setIsLoading(true);
      isFirstFetchRef.current = false;
    }
    setError(null);

    try {
      // Get the token address for Basescan API
      const tokenAddress = getTokenAddressFromPool(effectivePoolAddress);

      // Try Basescan API first for comprehensive 7+ day history
      if (tokenAddress) {
        try {
          // Calculate timestamp for 7 days ago
          const oneWeekAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

          // Basescan token transfer API - no API key needed for basic usage
          const basescanUrl = `https://api.basescan.org/api?module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=200&startblock=0&endblock=99999999&sort=desc`;

          const basescanResponse = await fetch(basescanUrl, {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store',
          });

          if (basescanResponse.ok) {
            const basescanData: BasescanResponse = await basescanResponse.json();

            if (basescanData.status === '1' && basescanData.result && basescanData.result.length > 0) {
              // Filter for swap transactions (involving router/pool addresses)
              // and within the last 7 days
              const swapTransfers = basescanData.result.filter(tx => {
                const txTimestamp = parseInt(tx.timeStamp);
                const isRecent = txTimestamp >= oneWeekAgo;
                const isSwap = ROUTER_ADDRESSES.includes(tx.from.toLowerCase()) ||
                               ROUTER_ADDRESSES.includes(tx.to.toLowerCase());
                return isRecent && isSwap;
              });

              // Group by transaction hash to identify buys vs sells
              const txMap = new Map<string, BasescanTransfer[]>();
              swapTransfers.forEach(tx => {
                const existing = txMap.get(tx.hash) || [];
                existing.push(tx);
                txMap.set(tx.hash, existing);
              });

              // Convert to PoolTrade format
              const basescanTrades: PoolTrade[] = [];
              txMap.forEach((transfers, hash) => {
                // Find the most relevant transfer for this tx
                const transfer = transfers[0];
                const isBuy = ROUTER_ADDRESSES.includes(transfer.from.toLowerCase());
                const decimals = parseInt(transfer.tokenDecimal) || 18;
                const amount = parseFloat(transfer.value) / Math.pow(10, decimals);

                basescanTrades.push({
                  txHash: hash,
                  timestamp: new Date(parseInt(transfer.timeStamp) * 1000),
                  type: isBuy ? 'buy' : 'sell',
                  amountIn: isBuy ? '0' : amount.toFixed(4),
                  amountOut: isBuy ? amount.toFixed(4) : '0',
                  priceUsd: '0', // Basescan doesn't provide price
                  volumeUsd: '0', // Would need price to calculate
                  wallet: isBuy ? transfer.to : transfer.from,
                  blockNumber: parseInt(transfer.blockNumber),
                });
              });

              // Sort by timestamp descending (newest first)
              basescanTrades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

              if (basescanTrades.length > 0) {
                setTrades(basescanTrades);
                setIsLoading(false);
                return;
              }
            }
          }
        } catch (basescanErr) {
          console.warn('Basescan API failed, falling back to GeckoTerminal:', basescanErr);
        }
      }

      // Fallback to GeckoTerminal (limited history but has price data)
      const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${effectivePoolAddress}/trades?trade_volume_in_usd_greater_than=0`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data: GeckoTradesResponse = await response.json();

      // Normalize trades for UI - data is wrapped in attributes
      const normalizedTrades: PoolTrade[] = (data.data || []).map((item) => {
        const trade = item.attributes;
        return {
          txHash: trade.tx_hash,
          timestamp: new Date(trade.block_timestamp),
          type: trade.kind,
          amountIn: trade.from_token_amount,
          amountOut: trade.to_token_amount,
          priceUsd: trade.price_to_in_usd || trade.price_from_in_usd || '0',
          volumeUsd: trade.volume_in_usd || '0',
          wallet: trade.tx_from_address,
          blockNumber: trade.block_number,
        };
      });

      setTrades(normalizedTrades);
    } catch (err) {
      console.error('Error fetching pool trades:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch trades');
    } finally {
      setIsLoading(false);
    }
  }, [effectivePoolAddress]);

  // Fetch on mount and when pool changes
  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  // Auto-refresh every 5 seconds for real-time updates
  useEffect(() => {
    const interval = setInterval(() => fetchTrades(false), 5000);
    return () => clearInterval(interval);
  }, [fetchTrades]);

  // Force refresh function that bypasses throttle
  const forceRefetch = useCallback(() => {
    fetchTrades(true);
  }, [fetchTrades]);

  return {
    trades,
    isLoading,
    error,
    refetch: forceRefetch,
  };
}
