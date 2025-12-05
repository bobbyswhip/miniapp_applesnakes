'use client';

import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { base } from 'wagmi/chains';

const ERC20_NAME_SYMBOL_ABI = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface TokenInfo {
  address: `0x${string}`;
  name: string;
  symbol: string;
}

// Cache for token info to avoid repeated RPC calls
const tokenInfoCache = new Map<string, TokenInfo>();

export function useTokenInfo(tokenAddress: `0x${string}` | undefined) {
  const publicClient = usePublicClient({ chainId: base.id });
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!tokenAddress || !publicClient) return;

    // Check cache first
    const cached = tokenInfoCache.get(tokenAddress.toLowerCase());
    if (cached) {
      setTokenInfo(cached);
      return;
    }

    const fetchTokenInfo = async () => {
      setIsLoading(true);
      try {
        const [name, symbol] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_NAME_SYMBOL_ABI,
            functionName: 'name',
          }),
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_NAME_SYMBOL_ABI,
            functionName: 'symbol',
          }),
        ]);

        const info: TokenInfo = {
          address: tokenAddress,
          name: name as string,
          symbol: symbol as string,
        };

        // Cache the result
        tokenInfoCache.set(tokenAddress.toLowerCase(), info);
        setTokenInfo(info);
      } catch (err) {
        console.error('Error fetching token info:', err);
        // Fallback to address truncation
        setTokenInfo({
          address: tokenAddress,
          name: `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`,
          symbol: 'TOKEN',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTokenInfo();
  }, [tokenAddress, publicClient]);

  return { tokenInfo, isLoading };
}

// Batch fetch multiple token infos
export function useMultipleTokenInfo(tokenAddresses: `0x${string}`[]) {
  const publicClient = usePublicClient({ chainId: base.id });
  const [tokenInfos, setTokenInfos] = useState<Map<string, TokenInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!tokenAddresses.length || !publicClient) return;

    const fetchAll = async () => {
      setIsLoading(true);
      const results = new Map<string, TokenInfo>();

      await Promise.all(
        tokenAddresses.map(async (address) => {
          const key = address.toLowerCase();

          // Check cache first
          const cached = tokenInfoCache.get(key);
          if (cached) {
            results.set(key, cached);
            return;
          }

          try {
            const [name, symbol] = await Promise.all([
              publicClient.readContract({
                address,
                abi: ERC20_NAME_SYMBOL_ABI,
                functionName: 'name',
              }),
              publicClient.readContract({
                address,
                abi: ERC20_NAME_SYMBOL_ABI,
                functionName: 'symbol',
              }),
            ]);

            const info: TokenInfo = {
              address,
              name: name as string,
              symbol: symbol as string,
            };

            tokenInfoCache.set(key, info);
            results.set(key, info);
          } catch (err) {
            console.error(`Error fetching token info for ${address}:`, err);
            results.set(key, {
              address,
              name: `${address.slice(0, 6)}...${address.slice(-4)}`,
              symbol: 'TOKEN',
            });
          }
        })
      );

      setTokenInfos(results);
      setIsLoading(false);
    };

    fetchAll();
  }, [tokenAddresses.join(','), publicClient]);

  return { tokenInfos, isLoading };
}
