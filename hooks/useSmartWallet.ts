import { useAccount, useCapabilities } from 'wagmi';
import { useMemo } from 'react';
import { base } from 'wagmi/chains';

/**
 * Hook to detect if the connected wallet is a smart wallet that supports
 * atomic batch transactions (EIP-5792).
 *
 * Smart wallets like Coinbase Smart Wallet can batch multiple transactions
 * (e.g., approve + action) into a single user confirmation.
 *
 * @see https://docs.base.org/base-account/improve-ux/batch-transactions
 */
export function useSmartWallet() {
  const { address, isConnected, connector } = useAccount();

  // useCapabilities is wagmi's hook for EIP-5792 wallet capabilities
  const { data: capabilities, isLoading: isLoadingCapabilities } = useCapabilities({
    query: {
      enabled: isConnected && !!address,
    },
  });

  const smartWalletInfo = useMemo(() => {
    if (!capabilities || !isConnected) {
      return {
        isSmartWallet: false,
        supportsAtomicBatch: false,
        supportsPaymaster: false,
        chainId: base.id,
      };
    }

    // Check capabilities for Base mainnet
    const baseCapabilities = capabilities[base.id];

    // atomicBatch.supported indicates the wallet can batch transactions atomically
    const supportsAtomicBatch = baseCapabilities?.atomicBatch?.supported === true;

    // paymasterService indicates gas sponsorship is available
    const supportsPaymaster = baseCapabilities?.paymasterService?.supported === true;

    // A smart wallet typically supports atomic batching
    const isSmartWallet = supportsAtomicBatch;

    return {
      isSmartWallet,
      supportsAtomicBatch,
      supportsPaymaster,
      chainId: base.id,
      capabilities: baseCapabilities,
    };
  }, [capabilities, isConnected]);

  return {
    ...smartWalletInfo,
    isLoading: isLoadingCapabilities,
    address,
    isConnected,
    connectorName: connector?.name,
  };
}

/**
 * Check if the wallet is likely a Coinbase Smart Wallet based on connector name
 * This is a fallback detection method
 */
export function isCoinbaseSmartWallet(connectorName?: string): boolean {
  if (!connectorName) return false;
  const name = connectorName.toLowerCase();
  return name.includes('coinbase') || name.includes('smart wallet');
}
