'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient } from 'wagmi';
import { base } from 'wagmi/chains';

// ═══════════════════════════════════════════════════════════════════════════
// ItemBridge v1.02 Hook
// ═══════════════════════════════════════════════════════════════════════════

const ITEM_BRIDGE_ADDRESS = '0xF799bDC992f7B7F78a138FC17913908e7a332710' as const;
const BONDED_ITEMS_ADDRESS = '0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd' as const;

// ABIs
const BONDED_ITEMS_ABI = [
  {
    name: 'isApprovedForAll',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'operator', type: 'address' }],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }],
    outputs: []
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }],
    outputs: [{ type: 'uint256' }]
  },
] as const;

const ITEM_BRIDGE_ABI = [
  {
    name: 'getBridgeFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'itemCount', type: 'uint256' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'bridgeIn',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' }
    ],
    outputs: []
  },
  {
    name: 'getCooldownRemaining',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
] as const;

// Types
interface Balance {
  [tokenId: number]: number;
}

interface Inventory {
  address: string;
  balances: Balance;
  totalItems: number;
  canFulfil: boolean;
  fulfilCooldownRemaining: number;
  canWithdraw: boolean;
  withdrawCooldownRemaining: number;
}

export function useItemBridge() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [walletNFTs, setWalletNFTs] = useState<Balance>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync, data: hash, isPending, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Check if bridge is approved for NFT transfers
  const { data: isApproved, refetch: refetchApproval } = useReadContract({
    address: BONDED_ITEMS_ADDRESS,
    abi: BONDED_ITEMS_ABI,
    functionName: 'isApprovedForAll',
    args: address ? [address, ITEM_BRIDGE_ADDRESS] : undefined,
    chainId: base.id,
    query: { enabled: !!address }
  });

  // =============================================
  // FETCH OFF-CHAIN BALANCE (from backend API)
  // =============================================
  const fetchInventory = useCallback(async () => {
    if (!address) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/item-bridge?action=inventory&address=${address}`);
      const data = await response.json();

      if (data.success) {
        setInventory(data.inventory);
      } else {
        setError(data.error || 'Failed to fetch inventory');
      }
    } catch (err) {
      setError('Network error fetching inventory');
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  // =============================================
  // FETCH WALLET NFTs (from blockchain)
  // =============================================
  const fetchWalletNFTs = useCallback(async (tokenIds: number[]) => {
    if (!address || !publicClient || tokenIds.length === 0) return;

    try {
      const balances: Balance = {};

      for (const tokenId of tokenIds) {
        const balance = await publicClient.readContract({
          address: BONDED_ITEMS_ADDRESS,
          abi: BONDED_ITEMS_ABI,
          functionName: 'balanceOf',
          args: [address, BigInt(tokenId)]
        });
        balances[tokenId] = Number(balance);
      }

      setWalletNFTs(balances);
    } catch (err) {
      console.error('Error fetching wallet NFTs:', err);
    }
  }, [address, publicClient]);

  // =============================================
  // APPROVE BRIDGE FOR NFT TRANSFERS
  // =============================================
  const approve = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');

    const txHash = await writeContractAsync({
      address: BONDED_ITEMS_ADDRESS,
      abi: BONDED_ITEMS_ABI,
      functionName: 'setApprovalForAll',
      args: [ITEM_BRIDGE_ADDRESS, true]
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
      await refetchApproval();
    }

    return txHash;
  }, [address, writeContractAsync, publicClient, refetchApproval]);

  // =============================================
  // BRIDGE IN - Deposit NFTs to bridge (on-chain)
  // =============================================
  const bridgeIn = useCallback(async (tokenIds: number[], amounts: number[]) => {
    if (!address) throw new Error('Wallet not connected');
    if (!publicClient) throw new Error('Public client not available');
    if (tokenIds.length !== amounts.length) throw new Error('Arrays must match');

    // Check approval first
    if (!isApproved) {
      console.log('[useItemBridge] Approving bridge...');
      await approve();
    }

    // Calculate total items for fee
    const totalItems = amounts.reduce((a, b) => a + b, 0);

    // Get fee from contract
    const fee = await publicClient.readContract({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ITEM_BRIDGE_ABI,
      functionName: 'getBridgeFee',
      args: [BigInt(totalItems)]
    });

    // Add 2% buffer for price slippage
    const feeWithBuffer = (fee * 102n) / 100n;

    console.log('[useItemBridge] Executing bridgeIn...', { tokenIds, amounts, fee: feeWithBuffer.toString() });

    const txHash = await writeContractAsync({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ITEM_BRIDGE_ABI,
      functionName: 'bridgeIn',
      args: [
        tokenIds.map(id => BigInt(id)),
        amounts.map(amt => BigInt(amt))
      ],
      value: feeWithBuffer
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    console.log('[useItemBridge] Bridge tx confirmed:', txHash);

    // Auto-fulfil after bridge
    console.log('[useItemBridge] Auto-fulfil...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for indexer
    await fulfil();

    return txHash;
  }, [address, publicClient, isApproved, approve, writeContractAsync]);

  // =============================================
  // FULFIL - Claim pending deposits (off-chain API)
  // =============================================
  const fulfil = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/item-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fulfil',
          address
        })
      });

      const data = await response.json();

      if (data.success) {
        // Refresh inventory after fulfil
        await fetchInventory();
        return data;
      } else {
        throw new Error(data.error || 'Fulfil failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fulfil failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, fetchInventory]);

  // =============================================
  // WITHDRAW - Get NFTs back from balance (off-chain API)
  // =============================================
  const withdraw = useCallback(async (tokenIds: number[], amounts: number[]) => {
    if (!address) throw new Error('Wallet not connected');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/item-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'withdraw',
          address,
          tokenIds,
          amounts
        })
      });

      const data = await response.json();

      if (data.success) {
        // Refresh inventory after withdraw
        await fetchInventory();
        return data;
      } else {
        throw new Error(data.error || 'Withdraw failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Withdraw failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, fetchInventory]);

  // Auto-fetch inventory when address changes
  useEffect(() => {
    if (address) {
      fetchInventory();
    }
  }, [address, fetchInventory]);

  // Refetch approval after successful transaction
  useEffect(() => {
    if (isSuccess) {
      refetchApproval();
      fetchInventory();
    }
  }, [isSuccess, refetchApproval, fetchInventory]);

  // Reset function
  const reset = useCallback(() => {
    setError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    // State
    inventory,
    walletNFTs,
    isApproved: !!isApproved,
    isLoading: isLoading || isPending || isConfirming,
    error,
    txHash: hash,
    isConfirming,
    isSuccess,

    // Derived from inventory for convenience
    offChainBalance: inventory?.balances ?? {},
    totalOffChainItems: inventory?.totalItems ?? 0,
    canFulfil: inventory?.canFulfil ?? true,
    canWithdraw: inventory?.canWithdraw ?? true,
    fulfilCooldown: inventory?.fulfilCooldownRemaining ?? 0,
    withdrawCooldown: inventory?.withdrawCooldownRemaining ?? 0,
    canBridge: true, // No cooldown for bridgeIn

    // Actions
    approve,
    bridgeIn,
    fulfil,
    withdraw,
    fetchInventory,
    fetchWalletNFTs,
    refetchApproval,
    reset,

    // Aliases for compatibility
    fulfilDeposits: fulfil,
    requestWithdraw: withdraw,
    loadOffChainBalance: fetchInventory,
  };
}

// Export addresses for use elsewhere
export { ITEM_BRIDGE_ADDRESS, BONDED_ITEMS_ADDRESS };
