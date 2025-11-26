'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { base } from 'wagmi/chains';
import { useSmartWallet } from './useSmartWallet';
import { numberToHex } from 'viem';

export interface SubAccount {
  address: `0x${string}`;
  label?: string;
  createdAt?: number;
}

export interface SubaccountsResult {
  // Subaccount support
  supportsSubaccounts: boolean;
  isLoading: boolean;

  // Main account
  mainAccount: `0x${string}` | undefined;

  // Subaccounts list
  subaccounts: SubAccount[];
  activeAccount: `0x${string}` | undefined;

  // Actions
  createSubaccount: (label?: string) => Promise<SubAccount | null>;
  switchToSubaccount: (address: `0x${string}`) => void;
  switchToMainAccount: () => void;
  refreshSubaccounts: () => Promise<void>;

  // Status
  isCreating: boolean;
  error: string | null;
}

/**
 * Hook for managing wallet subaccounts (EIP-7715)
 * Subaccounts allow users to create separate accounts for different purposes
 * like gaming, while keeping their main wallet funds separate.
 *
 * @see https://docs.base.org/base-account/improve-ux/sub-accounts
 */
export function useSubaccounts(): SubaccountsResult {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { isSmartWallet, capabilities } = useSmartWallet();

  const [subaccounts, setSubaccounts] = useState<SubAccount[]>([]);
  const [activeAccount, setActiveAccount] = useState<`0x${string}` | undefined>(address);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if wallet supports subaccounts
  // The addSubAccount capability indicates subaccount support
  const supportsSubaccounts = !!(
    isSmartWallet &&
    capabilities &&
    (capabilities as Record<string, { supported?: boolean }>)?.addSubAccount?.supported
  );

  /**
   * Fetch existing subaccounts from the wallet
   */
  const refreshSubaccounts = useCallback(async () => {
    if (!walletClient || !address || !supportsSubaccounts) {
      setSubaccounts([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use wallet_getSubAccounts RPC method
      const result = await walletClient.request({
        method: 'wallet_getSubAccounts' as 'eth_accounts',
        params: [{
          account: address,
          domain: typeof window !== 'undefined' ? window.location.origin : '',
        }] as unknown as undefined,
      });

      const response = result as { subAccounts?: Array<{ address: `0x${string}`; label?: string }> };

      if (response?.subAccounts) {
        setSubaccounts(
          response.subAccounts.map((sub) => ({
            address: sub.address,
            label: sub.label,
          }))
        );
      }
    } catch (err) {
      console.log('Failed to fetch subaccounts:', err);
      // Not an error - wallet might not have any subaccounts yet
      setSubaccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, address, supportsSubaccounts]);

  /**
   * Create a new subaccount
   */
  const createSubaccount = useCallback(async (label?: string): Promise<SubAccount | null> => {
    if (!walletClient || !address) {
      setError('Wallet not connected');
      return null;
    }

    if (!supportsSubaccounts) {
      setError('Wallet does not support subaccounts');
      return null;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Use wallet_addSubAccount RPC method to create a new subaccount
      const result = await walletClient.request({
        method: 'wallet_addSubAccount' as 'eth_accounts',
        params: [{
          account: {
            type: 'create',
            ...(label && { label }),
          },
          chainId: numberToHex(base.id),
        }] as unknown as undefined,
      });

      const response = result as unknown as { address: `0x${string}` } | undefined;

      if (response?.address) {
        const newSubaccount: SubAccount = {
          address: response.address,
          label,
          createdAt: Date.now(),
        };

        setSubaccounts((prev) => [...prev, newSubaccount]);
        console.log('Created subaccount:', newSubaccount.address);

        return newSubaccount;
      }

      throw new Error('Failed to create subaccount - no address returned');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create subaccount';
      console.error('Subaccount creation error:', err);
      setError(message);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [walletClient, address, supportsSubaccounts]);

  /**
   * Switch active account to a subaccount
   */
  const switchToSubaccount = useCallback((subaccountAddress: `0x${string}`) => {
    const found = subaccounts.find((s) => s.address.toLowerCase() === subaccountAddress.toLowerCase());
    if (found) {
      setActiveAccount(subaccountAddress);
      console.log('Switched to subaccount:', subaccountAddress);
    }
  }, [subaccounts]);

  /**
   * Switch back to main account
   */
  const switchToMainAccount = useCallback(() => {
    setActiveAccount(address);
    console.log('Switched to main account:', address);
  }, [address]);

  // Update active account when main address changes
  useEffect(() => {
    if (address && !activeAccount) {
      setActiveAccount(address);
    }
  }, [address, activeAccount]);

  // Fetch subaccounts on mount and when wallet changes
  useEffect(() => {
    if (isConnected && supportsSubaccounts) {
      refreshSubaccounts();
    }
  }, [isConnected, supportsSubaccounts, refreshSubaccounts]);

  return {
    supportsSubaccounts,
    isLoading,
    mainAccount: address,
    subaccounts,
    activeAccount,
    createSubaccount,
    switchToSubaccount,
    switchToMainAccount,
    refreshSubaccounts,
    isCreating,
    error,
  };
}

/**
 * Helper to get a shortened address display
 */
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
