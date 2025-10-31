'use client';

import { useAccount, useReadContract } from 'wagmi';
import { getContracts } from '@/config';
import { formatEther } from 'viem';
import { base } from 'wagmi/chains';

/**
 * ContractFees Component
 *
 * Displays all fees from the NFT contract to verify connection
 * Fees include: Breed Fee, Jail Fee, Unhatch Fee, Evolve Fee
 */
export function ContractFees() {
  const { chain, isConnected, address: userAddress } = useAccount();
  const contracts = getContracts(chain?.id || base.id);

  // Use address presence as connection indicator (more reliable than isConnected)
  const isWalletConnected = !!userAddress;

  // Read breed fee - PUBLIC function, no wallet required
  const {
    data: breedFee,
    isLoading: breedLoading,
    error: breedError,
    refetch: refetchBreedFee
  } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'breedFee',
    chainId: base.id,
  });

  // Read jail fee - PUBLIC function, no wallet required
  const {
    data: jailFee,
    isLoading: jailLoading,
    error: jailError
  } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'jailFee',
    chainId: base.id,
  });

  // Read unhatch fee - PUBLIC function, no wallet required
  const {
    data: unhatchFee,
    isLoading: unhatchLoading,
    error: unhatchError
  } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'unhatchFee',
    chainId: base.id,
  });

  // Read evolve fee - PUBLIC function, no wallet required
  const {
    data: evolveFee,
    isLoading: evolveLoading,
    error: evolveError
  } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'evolveFee',
    chainId: base.id,
  });

  // Debug logging
  console.log('ContractFees State:', {
    isWalletConnected,
    chainId: chain?.id,
    breedFee: breedFee?.toString(),
    jailFee: jailFee?.toString(),
    unhatchFee: unhatchFee?.toString(),
    evolveFee: evolveFee?.toString(),
    breedLoading,
    jailLoading,
    unhatchLoading,
    evolveLoading,
    breedError: breedError ? (breedError as Error).message : null,
  });

  const isLoading = breedLoading || jailLoading || unhatchLoading || evolveLoading;
  const hasError = breedError || jailError || unhatchError || evolveError;
  const isWrongNetwork = isWalletConnected && chain?.id !== base.id;

  return (
    <div className="w-full max-w-2xl">
      <div className="glass rounded-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700/50 pb-4">
          <h2 className="text-2xl font-bold text-white">Contract Fees</h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isWalletConnected && !isWrongNetwork ? 'bg-green-500' : isWrongNetwork ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-400">
              {isWalletConnected ? (isWrongNetwork ? 'Wrong Network' : 'Connected') : 'Not Connected'}
            </span>
          </div>
        </div>

        {/* Contract Info */}
        <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
          <p className="text-xs text-gray-400 uppercase">NFT Contract</p>
          <code className="text-sm font-mono text-blue-400 break-all">
            {contracts.nft.address}
          </code>
          <p className="text-xs text-gray-500">
            Network: {chain?.name || 'Base Mainnet'} (Chain ID: {chain?.id || base.id})
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-400">Loading fees...</span>
          </div>
        )}

        {/* Info Message - Removed wallet requirement */}

        {/* Wrong Network Warning */}
        {isWrongNetwork && (
          <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 flex items-center gap-3">
            <span className="text-yellow-400 text-xl">⚠️</span>
            <div className="flex-1">
              <p className="text-yellow-400 text-sm font-semibold">Wrong Network Detected</p>
              <p className="text-yellow-300 text-xs mt-1">
                You're connected to {chain?.name || 'unknown network'}. Please switch to Base Mainnet (Chain ID: {base.id}) to view fees.
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {isWalletConnected && !isWrongNetwork && hasError && !isLoading && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-red-400 text-xl">❌</span>
              <div className="flex-1">
                <p className="text-red-400 text-sm font-semibold">Error Loading Contract Fees</p>
                <p className="text-red-300 text-xs mt-1">
                  Unable to read fees from contract. This may be due to contract access restrictions or network issues.
                </p>
              </div>
            </div>
            <div className="bg-red-500/5 rounded p-3 space-y-2">
              <p className="text-xs text-red-200 font-mono">Debug Information:</p>
              {breedError && (
                <div className="text-xs text-red-300">
                  <span className="font-semibold">Breed Fee Error:</span>
                  <pre className="mt-1 overflow-x-auto">{String((breedError as Error)?.message || 'Unknown error')}</pre>
                </div>
              )}
              {jailError && (
                <div className="text-xs text-red-300 mt-2">
                  <span className="font-semibold">Jail Fee Error:</span>
                  <pre className="mt-1 overflow-x-auto">{String((jailError as Error)?.message || 'Unknown error')}</pre>
                </div>
              )}
              {unhatchError && (
                <div className="text-xs text-red-300 mt-2">
                  <span className="font-semibold">Unhatch Fee Error:</span>
                  <pre className="mt-1 overflow-x-auto">{String((unhatchError as Error)?.message || 'Unknown error')}</pre>
                </div>
              )}
              {evolveError && (
                <div className="text-xs text-red-300 mt-2">
                  <span className="font-semibold">Evolve Fee Error:</span>
                  <pre className="mt-1 overflow-x-auto">{String((evolveError as Error)?.message || 'Unknown error')}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fees Display */}
        {isWalletConnected && !isWrongNetwork && !isLoading && !hasError && (breedFee !== undefined || jailFee || unhatchFee || evolveFee) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Breed Fee */}
            <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border border-purple-500/30 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🧬</span>
                <h3 className="font-semibold text-white">Breed Fee</h3>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-purple-400">
                  {breedFee !== undefined ? formatEther(breedFee as bigint) : '...'}
                </p>
                <p className="text-xs text-gray-400">ETH</p>
              </div>
              <p className="text-xs text-gray-500">
                Fee to breed 3 humans into a snake
              </p>
            </div>

            {/* Jail Fee */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 border border-orange-500/30 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">⛓️</span>
                <h3 className="font-semibold text-white">Jail Fee</h3>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-orange-400">
                  {jailFee ? formatEther(jailFee as bigint) : '0'}
                </p>
                <p className="text-xs text-gray-400">ETH</p>
              </div>
              <p className="text-xs text-gray-500">
                Fee to jail/unjail an NFT
              </p>
            </div>

            {/* Unhatch Fee */}
            <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/10 border border-cyan-500/30 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🥚</span>
                <h3 className="font-semibold text-white">Unhatch Fee</h3>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-cyan-400">
                  {unhatchFee ? formatEther(unhatchFee as bigint) : '0'}
                </p>
                <p className="text-xs text-gray-400">ETH</p>
              </div>
              <p className="text-xs text-gray-500">
                Fee to unhatch an egg NFT
              </p>
            </div>

            {/* Evolve Fee */}
            <div className="bg-gradient-to-br from-pink-500/10 to-pink-600/10 border border-pink-500/30 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">✨</span>
                <h3 className="font-semibold text-white">Evolve Fee</h3>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-pink-400">
                  {evolveFee ? formatEther(evolveFee as bigint) : '0'}
                </p>
                <p className="text-xs text-gray-400">ETH</p>
              </div>
              <p className="text-xs text-gray-500">
                Fee to evolve an NFT
              </p>
            </div>
          </div>
        )}

        {/* Success Message */}
        {isWalletConnected && !isWrongNetwork && !isLoading && !hasError && (breedFee !== undefined || jailFee || unhatchFee || evolveFee) && (
          <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-center gap-3">
            <span className="text-green-400 text-xl">✅</span>
            <p className="text-green-400 text-sm">
              Successfully connected to NFT contract on {chain?.name || 'Base Mainnet'}!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
