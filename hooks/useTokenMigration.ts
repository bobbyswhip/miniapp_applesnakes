'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { base } from 'wagmi/chains';
import { MIGRATION_TARGET_TOKEN } from '@/config/contracts';

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const ALCHEMY_BASE_URL = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

export interface DetectedToken {
  address: `0x${string}`;
  balance: string;
  balanceFormatted: string;
  symbol: string;
  name: string;
  decimals: number;
  isPairedToken: boolean;
  isContentCoin: boolean;
}

interface AlchemyTokenBalance {
  contractAddress: string;
  tokenBalance: string;
}

interface AlchemyTokenMetadata {
  decimals: number;
  logo: string | null;
  name: string;
  symbol: string;
}

async function alchemyRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ALCHEMY_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function getTokenBalances(address: string): Promise<AlchemyTokenBalance[]> {
  const result = await alchemyRpc('alchemy_getTokenBalances', [address]) as {
    address: string;
    tokenBalances: AlchemyTokenBalance[];
  };
  return result.tokenBalances.filter(
    (t) => t.tokenBalance !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      && t.tokenBalance !== '0x'
      && t.tokenBalance !== '0x0'
  );
}

async function getTokenMetadata(tokenAddress: string): Promise<AlchemyTokenMetadata> {
  return alchemyRpc('alchemy_getTokenMetadata', [tokenAddress]) as Promise<AlchemyTokenMetadata>;
}

function formatBalance(hexBalance: string, decimals: number): string {
  const raw = BigInt(hexBalance);
  if (raw === 0n) return '0';
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  if (remainder === 0n) return whole.toString();
  const remainderStr = remainder.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
  return remainderStr ? `${whole}.${remainderStr}` : whole.toString();
}

export function useTokenMigration() {
  const { isConnected, address } = useAccount();
  usePublicClient({ chainId: base.id }); // keep provider active
  const [detectedTokens, setDetectedTokens] = useState<DetectedToken[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const hasCheckedRef = useRef<string | null>(null);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
  }, []);

  const detect = useCallback(async (walletAddress: string) => {
    if (!ALCHEMY_KEY) {
      console.warn('[Migration] No Alchemy API key configured');
      return;
    }

    setIsDetecting(true);
    setError(null);

    try {
      console.log('[Migration] Fetching balances for', walletAddress);
      const tokenBalances = await getTokenBalances(walletAddress);
      console.log('[Migration]', tokenBalances.length, 'tokens with balance');

      const targetLower = MIGRATION_TARGET_TOKEN.toLowerCase();
      const detected: DetectedToken[] = [];

      for (const tb of tokenBalances) {
        if (tb.contractAddress.toLowerCase() === targetLower) {
          try {
            const metadata = await getTokenMetadata(tb.contractAddress);
            const formatted = formatBalance(tb.tokenBalance, metadata.decimals);
            if (formatted === '0') {
              console.log('[Migration] Skipping ZORA with dust balance');
              continue;
            }
            detected.push({
              address: tb.contractAddress as `0x${string}`,
              balance: tb.tokenBalance,
              balanceFormatted: formatted,
              symbol: metadata.symbol || 'ZORA',
              name: metadata.name || 'Zora',
              decimals: metadata.decimals || 18,
              isPairedToken: false,
              isContentCoin: false,
            });
          } catch (metaErr) {
            console.warn('[Migration] Metadata failed for ZORA:', metaErr);
          }
        }
      }

      console.log('[Migration] Detected', detected.length, 'tokens:', detected.map(d => `${d.symbol}(${d.balanceFormatted})`));
      setDetectedTokens(detected);
    } catch (err) {
      console.error('[Migration] Detection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to detect tokens');
    } finally {
      setIsDetecting(false);
    }
  }, []);

  useEffect(() => {
    if (!isConnected || !address) {
      setDetectedTokens([]);
      hasCheckedRef.current = null;
      return;
    }

    if (hasCheckedRef.current === address.toLowerCase()) return;
    hasCheckedRef.current = address.toLowerCase();

    localStorage.removeItem(`migration_dismissed_${address.toLowerCase()}`);
    localStorage.removeItem(`migration_v2_dismissed_${address.toLowerCase()}`);

    setIsDismissed(false);
    console.log('[Migration] Starting detection for', address);
    detect(address);
  }, [isConnected, address, detect]);

  const shouldShowModal = detectedTokens.length > 0 && !isDismissed && !isDetecting;

  return {
    detectedTokens,
    isDetecting,
    error,
    isDismissed,
    shouldShowModal,
    dismiss,
  };
}
