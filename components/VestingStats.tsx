'use client';

import { useAccount, useReadContract } from 'wagmi';
import { getContracts } from '@/config';
import { formatEther } from 'viem';
import { base } from 'wagmi/chains';
import { useEffect, useState } from 'react';

/**
 * VestingStats Component
 *
 * Displays user's vesting information including:
 * - Total vested balance
 * - Claimable amount
 * - Time until next claim
 * - Days until full unlock
 */
export function VestingStats() {
  const { address: userAddress } = useAccount();
  const contracts = getContracts(base.id);
  const [timeUntilClaim, setTimeUntilClaim] = useState<number>(0);
  const [daysUntilUnlock, setDaysUntilUnlock] = useState<number>(0);

  // Read vesting info for user
  const { data: vestingData, isLoading: vestingLoading } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'vesting',
    args: userAddress ? [userAddress] : undefined,
    chainId: base.id,
  });

  // Read claimable amount
  const { data: claimableAmount, isLoading: claimableLoading } = useReadContract({
    address: contracts.nft.address as `0x${string}`,
    abi: contracts.nft.abi,
    functionName: 'claimable',
    args: userAddress ? [userAddress] : undefined,
    chainId: base.id,
  });

  // Parse vesting data
  const vestBalance = vestingData ? (vestingData as any)[0] : 0n;
  const lastMint = vestingData ? Number((vestingData as any)[1]) : 0;
  const lastClaim = vestingData ? Number((vestingData as any)[2]) : 0;

  // Calculate time until next claim and days until unlock
  useEffect(() => {
    const updateTimes = () => {
      const now = Math.floor(Date.now() / 1000);
      const DAY = 86400; // 24 hours in seconds
      const FULL_UNLOCK = 90 * DAY; // 90 days

      // Time until next claim (24 hours after last claim)
      const nextClaimTime = lastClaim + DAY;
      const timeUntil = Math.max(0, nextClaimTime - now);
      setTimeUntilClaim(timeUntil);

      // Days until full unlock (90 days after last mint)
      const unlockTime = lastMint + FULL_UNLOCK;
      const timeUntilUnlock = Math.max(0, unlockTime - now);
      setDaysUntilUnlock(Math.ceil(timeUntilUnlock / DAY));
    };

    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, [lastClaim, lastMint]);

  const isLoading = vestingLoading || claimableLoading;
  const hasVesting = vestBalance > 0n;

  // Format time until claim as HH:MM:SS
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!userAddress) {
    return (
      <div className="w-full max-w-2xl">
        <div className="glass rounded-2xl p-6">
          <div className="text-center py-8 space-y-4">
            <span className="text-6xl">🔐</span>
            <h3 className="text-2xl font-bold text-white">Connect Wallet</h3>
            <p className="text-[#8a9090]">Connect your wallet to view vesting stats</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full max-w-2xl">
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ffd075]"></div>
            <span className="ml-3 text-[#8a9090]">Loading vesting data...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="glass rounded-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-4">
          <h2 className="text-2xl font-bold text-white">Vesting Stats</h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${hasVesting ? 'bg-[#22c55e]' : 'bg-[#6b7575]'}`} />
            <span className="text-sm text-[#8a9090]">
              {hasVesting ? 'Active' : 'No Vesting'}
            </span>
          </div>
        </div>

        {!hasVesting ? (
          <div className="text-center py-12 space-y-4">
            <span className="text-7xl">🪙</span>
            <h3 className="text-2xl font-bold text-white">No Vesting Balance</h3>
            <p className="text-[#8a9090]">
              Swap, breed, jail, or evolve to start vesting tokens
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Total Vested */}
              <div className="relative overflow-hidden bg-gradient-to-br from-[#1a2221] via-[#171e1d] to-[#1a2221] border border-[rgba(255,208,117,0.3)] rounded-xl p-5 space-y-3 backdrop-blur-sm"
                style={{
                  boxShadow: '0 0 20px rgba(255, 208, 117, 0.15), inset 0 0 20px rgba(197, 169, 123, 0.05)'
                }}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255, 208, 117, 0.3), transparent)',
                    animation: 'shimmer 3s infinite',
                  }}
                />

                <div className="relative flex items-center gap-3">
                  <div className="w-8 h-8 flex-shrink-0">
                    <img
                      src="/Images/Wilfred.png"
                      alt="Wilfred"
                      className="w-full h-full object-contain"
                      style={{
                        filter: 'drop-shadow(0 0 8px rgba(255, 208, 117, 0.6))'
                      }}
                    />
                  </div>
                  <h3 className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[#ffd075] to-[#c5a97b]">Total Vested</h3>
                </div>
                <div className="relative space-y-1">
                  <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#ffd075] to-[#c5a97b]">
                    {formatEther(vestBalance)} $wNFTs
                  </p>
                  <p className="text-xs text-[#c5a97b]/80">wrapped nfts (claimable over 90 days)</p>
                </div>
              </div>

              {/* Claimable Now */}
              <div className="relative overflow-hidden bg-gradient-to-br from-[#0a1a0f] via-[#0d1a12] to-[#0a1a10] border border-[#22c55e]/30 rounded-xl p-5 space-y-3 backdrop-blur-sm"
                style={{
                  boxShadow: '0 0 20px rgba(34, 197, 94, 0.15), inset 0 0 20px rgba(34, 197, 94, 0.05)'
                }}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(34, 197, 94, 0.3), transparent)',
                    animation: 'shimmer 3s infinite',
                  }}
                />

                <div className="relative flex items-center gap-2">
                  <span className="text-2xl filter drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]">🎁</span>
                  <h3 className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[#22c55e] to-[#22c55e]">Claimable Now</h3>
                </div>
                <div className="relative space-y-1">
                  <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#22c55e] to-[#22c55e]">
                    {claimableAmount ? formatEther(claimableAmount as bigint) : '0'} $wNFTs
                  </p>
                  <p className="text-xs text-[#22c55e]/80">available to claim right now</p>
                </div>
              </div>
            </div>

            {/* Time Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Next Claim Timer */}
              <div className="relative overflow-hidden bg-gradient-to-br from-[#1a2221] via-[#171e1d] to-[#1a2221] border border-[rgba(255,208,117,0.3)] rounded-xl p-5 space-y-3 backdrop-blur-sm"
                style={{
                  boxShadow: '0 0 20px rgba(255, 208, 117, 0.15), inset 0 0 20px rgba(255, 208, 117, 0.05)'
                }}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255, 208, 117, 0.3), transparent)',
                    animation: 'shimmer 3s infinite',
                  }}
                />

                <div className="relative flex items-center gap-2">
                  <span className="text-2xl filter drop-shadow-[0_0_8px_rgba(255,208,117,0.6)]">⏰</span>
                  <h3 className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[#ffd075] to-[#c5a97b]">Next Claim</h3>
                </div>
                {timeUntilClaim > 0 ? (
                  <>
                    <div className="relative space-y-1">
                      <p className="text-2xl font-bold font-mono text-transparent bg-clip-text bg-gradient-to-r from-[#ffd075] to-[#c5a97b]">
                        {formatTime(timeUntilClaim)}
                      </p>
                      <p className="text-xs text-[#c5a97b]/80">time remaining</p>
                    </div>
                    <p className="relative text-xs text-[#c5a97b]/60">
                      can claim 1% every 24 hours
                    </p>
                  </>
                ) : (
                  <>
                    <div className="relative space-y-1">
                      <p className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#ffd075] to-[#c5a97b]">
                        Ready!
                      </p>
                      <p className="text-xs text-[#c5a97b]/80">claim available</p>
                    </div>
                    <p className="relative text-xs text-[#c5a97b]/60">
                      you can claim now
                    </p>
                  </>
                )}
              </div>

              {/* Days Until Full Unlock */}
              <div className="relative overflow-hidden bg-gradient-to-br from-[#1a2221] via-[#171e1d] to-[#1a2221] border border-[rgba(197,169,123,0.3)] rounded-xl p-5 space-y-3 backdrop-blur-sm"
                style={{
                  boxShadow: '0 0 20px rgba(197, 169, 123, 0.15), inset 0 0 20px rgba(197, 169, 123, 0.05)'
                }}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(197, 169, 123, 0.3), transparent)',
                    animation: 'shimmer 3s infinite',
                  }}
                />

                <div className="relative flex items-center gap-2">
                  <span className="text-2xl filter drop-shadow-[0_0_8px_rgba(197,169,123,0.6)]">🔓</span>
                  <h3 className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[#c5a97b] to-[#ffd075]">Full Unlock</h3>
                </div>
                {daysUntilUnlock > 0 ? (
                  <>
                    <div className="relative space-y-1">
                      <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#c5a97b] to-[#ffd075]">
                        {daysUntilUnlock}
                      </p>
                      <p className="text-xs text-[#c5a97b]/80">days remaining</p>
                    </div>
                    <p className="relative text-xs text-[#c5a97b]/60">
                      until 100% unlock (90 days)
                    </p>
                  </>
                ) : (
                  <>
                    <div className="relative space-y-1">
                      <p className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#ffd075] to-[#c5a97b]">
                        Unlocked!
                      </p>
                      <p className="text-xs text-[#c5a97b]/80">fully vested</p>
                    </div>
                    <p className="relative text-xs text-[#c5a97b]/60">
                      all tokens available
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="bg-[#1a2221]/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[#8a9090]">Vesting Progress</span>
                <span className="text-[#cecece]">{Math.max(0, 90 - daysUntilUnlock)} / 90 days</span>
              </div>
              <div className="w-full bg-[#1f2827] rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-[#ffd075] to-[#c5a97b] h-3 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, ((90 - daysUntilUnlock) / 90) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-[#6b7575] text-center">
                {daysUntilUnlock === 0 ? '100% unlocked - Claim entire balance anytime' : `${Math.min(100, Math.round(((90 - daysUntilUnlock) / 90) * 100))}% - Claim 1% per day or wait for full unlock`}
              </p>
            </div>

            {/* Info Box */}
            <div className="bg-[rgba(255,208,117,0.08)] border border-[rgba(255,208,117,0.2)] rounded-lg p-4 space-y-2">
              <div className="flex items-start gap-3">
                <span className="text-[#ffd075] text-xl">ℹ️</span>
                <div className="flex-1 space-y-1">
                  <p className="text-[#ffd075] text-sm font-semibold">How Vesting Works</p>
                  <ul className="text-[#e0e0e0] text-xs space-y-1">
                    <li>• Claim 1% of your balance every 24 hours</li>
                    <li>• Or wait 90 days to claim 100% at once</li>
                    <li>• Each new action (swap/breed/jail/evolve) resets the 90-day timer</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Pairable Link */}
            <div className="text-center pt-2">
              <a
                href="https://pairable.io/#/contracts/superstrat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-lg font-bold transition-all duration-300"
                style={{
                  color: 'rgba(255, 208, 117, 0.9)',
                  textShadow: '0 0 10px rgba(255, 208, 117, 0.5), 0 0 20px rgba(255, 208, 117, 0.3)',
                  filter: 'drop-shadow(0 0 8px rgba(255, 208, 117, 0.4))',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'rgba(255, 208, 117, 1)';
                  e.currentTarget.style.textShadow = '0 0 15px rgba(255, 208, 117, 0.8), 0 0 30px rgba(255, 208, 117, 0.5)';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'rgba(255, 208, 117, 0.9)';
                  e.currentTarget.style.textShadow = '0 0 10px rgba(255, 208, 117, 0.5), 0 0 20px rgba(255, 208, 117, 0.3)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                pairable
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Shimmer animation keyframes */}
      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}
