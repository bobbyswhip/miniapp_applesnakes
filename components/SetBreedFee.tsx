'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getContracts } from '@/config';
import { parseEther } from 'viem';
import { base } from 'wagmi/chains';

/**
 * SetBreedFee Component
 *
 * Allows contract owner to set the breed fee
 * This should only be visible to the contract owner
 */
export function SetBreedFee() {
  const { chain, address: userAddress } = useAccount();
  const contracts = getContracts(chain?.id || base.id);
  const [feeAmount, setFeeAmount] = useState('0.01');

  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const handleSetBreedFee = async () => {
    try {
      const feeInWei = parseEther(feeAmount);

      writeContract({
        address: contracts.nft.address,
        abi: contracts.nft.abi,
        functionName: 'setBreedFee',
        args: [feeInWei],
      });
    } catch (err) {
      console.error('Error setting breed fee:', err);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="border-b border-gray-700/50 pb-3">
          <h2 className="text-xl font-bold text-white">Set Breed Fee</h2>
          <p className="text-xs text-gray-400 mt-1">Contract Owner Only</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-400 block mb-2">Fee Amount (ETH)</label>
            <input
              type="number"
              step="0.001"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
              placeholder="0.01"
            />
          </div>

          <button
            onClick={handleSetBreedFee}
            disabled={isPending || isConfirming || !userAddress}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {isPending && 'Waiting for approval...'}
            {isConfirming && 'Setting fee...'}
            {!isPending && !isConfirming && 'Set Breed Fee'}
          </button>

          {isSuccess && (
            <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-3">
              <p className="text-green-400 text-sm">✅ Breed fee updated successfully!</p>
              <a
                href={`https://basescan.org/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-300 hover:underline mt-1 block"
              >
                View transaction →
              </a>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
              <p className="text-red-400 text-sm">❌ Error: {error.message}</p>
            </div>
          )}

          <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-3">
            <p className="text-blue-400 text-xs">
              💡 <strong>Note:</strong> Only the contract owner can set the breed fee.
              Max allowed: 0.03 ETH
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
