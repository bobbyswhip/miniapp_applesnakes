/**
 * Example hook for reading NFT balance
 * Demonstrates how to use the contract configuration
 */

import { useAccount, useReadContract } from 'wagmi';
import { getContracts } from '@/config/contracts';

export function useNFTBalance() {
  const { address, chain } = useAccount();
  const contracts = chain ? getContracts(chain.id) : null;

  const { data: balance, isLoading, error } = useReadContract({
    address: contracts?.nft.address,
    abi: contracts?.nft.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!contracts,
    },
  });

  return {
    balance: balance as bigint | undefined,
    isLoading,
    error,
  };
}
