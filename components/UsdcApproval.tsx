// components/UsdcApproval.tsx
'use client';

import { useReadContract, useWriteContract, useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { USDC_ADDRESS, USDC_ABI, USDC_DECIMALS } from '@/lib/abis/usdc';

interface Props {
  marketAddress: string;
  requiredAmount: number;
  children: React.ReactNode;
}

export function UsdcApproval({ marketAddress, requiredAmount, children }: Props) {
  const { address } = useAccount();

  // Check current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: [address!, marketAddress as `0x${string}`],
    query: { enabled: !!address && !!marketAddress }
  });

  // Check balance
  const { data: balance } = useReadContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: { enabled: !!address }
  });

  const { writeContract: approve, isPending: isApproving } = useWriteContract();

  const requiredAtomic = parseUnits(requiredAmount.toString(), USDC_DECIMALS);
  const hasAllowance = allowance && (allowance as bigint) >= requiredAtomic;
  const formattedBalance = balance ? parseFloat(formatUnits(balance as bigint, USDC_DECIMALS)) : 0;

  const handleApprove = () => {
    approve({
      address: USDC_ADDRESS as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [marketAddress as `0x${string}`, parseUnits('1000000', USDC_DECIMALS)] // Approve 1M USDC
    }, {
      onSuccess: () => {
        setTimeout(() => refetchAllowance(), 2000);
      }
    });
  };

  if (!address) {
    return <div className="text-gray-400 text-center p-3">Connect wallet to bet</div>;
  }

  if (formattedBalance < requiredAmount) {
    return (
      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
        Insufficient USDC balance. You have ${formattedBalance.toFixed(2)}
      </div>
    );
  }

  if (!hasAllowance) {
    return (
      <button
        onClick={handleApprove}
        disabled={isApproving}
        className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors"
      >
        {isApproving ? 'Approving USDC...' : 'Approve USDC to Bet'}
      </button>
    );
  }

  return <>{children}</>;
}

// Hook version for more flexible usage
export function useUsdcApproval(marketAddress: string | null) {
  const { address } = useAccount();

  // Check current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: [address!, marketAddress as `0x${string}`],
    query: { enabled: !!address && !!marketAddress }
  });

  // Check balance
  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: { enabled: !!address }
  });

  const { writeContract: approveWrite, isPending: isApproving } = useWriteContract();

  const formattedBalance = balance ? parseFloat(formatUnits(balance as bigint, USDC_DECIMALS)) : 0;
  const formattedAllowance = allowance ? parseFloat(formatUnits(allowance as bigint, USDC_DECIMALS)) : 0;

  const approve = (amount?: number) => {
    if (!marketAddress) return;

    const approveAmount = amount
      ? parseUnits(amount.toString(), USDC_DECIMALS)
      : parseUnits('1000000', USDC_DECIMALS); // Default 1M USDC

    approveWrite({
      address: USDC_ADDRESS as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [marketAddress as `0x${string}`, approveAmount]
    }, {
      onSuccess: () => {
        setTimeout(() => refetchAllowance(), 2000);
      }
    });
  };

  const hasEnoughAllowance = (amount: number) => {
    return formattedAllowance >= amount;
  };

  const hasEnoughBalance = (amount: number) => {
    return formattedBalance >= amount;
  };

  return {
    balance: formattedBalance,
    allowance: formattedAllowance,
    approve,
    isApproving,
    hasEnoughAllowance,
    hasEnoughBalance,
    refetch: () => {
      refetchAllowance();
      refetchBalance();
    }
  };
}
