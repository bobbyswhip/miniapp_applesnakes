/**
 * Example hook for reading ERC20 token balance
 * Demonstrates how to use the contract configuration
 */

import { useAccount, useReadContract } from 'wagmi';
import { getContracts } from '@/config/contracts';
import { formatUnits } from 'viem';

export function useTokenBalance() {
  const { address, chain } = useAccount();
  const contracts = chain ? getContracts(chain.id) : null;

  // Get token decimals
  const { data: decimals } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'decimals',
    query: {
      enabled: !!contracts,
    },
  });

  // Get token balance
  const { data: balance, isLoading, error } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!contracts,
    },
  });

  // Get token symbol
  const { data: symbol } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'symbol',
    query: {
      enabled: !!contracts,
    },
  });

  // Format balance
  const formattedBalance =
    balance && decimals
      ? formatUnits(balance as bigint, decimals as number)
      : '0';

  return {
    balance: balance as bigint | undefined,
    formattedBalance,
    decimals: decimals as number | undefined,
    symbol: symbol as string | undefined,
    isLoading,
    error,
  };
}
