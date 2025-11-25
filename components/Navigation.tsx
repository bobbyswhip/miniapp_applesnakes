'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI } from '@/config';
import { base } from 'wagmi/chains';
import { useNFTContext } from '@/contexts/NFTContext';
import { useInventory } from '@/contexts/InventoryContext';
import { useBasename } from '@/hooks/useBasename';
import { useEffect, useState } from 'react';
import { formatEther, parseEther } from 'viem';

export function Navigation() {
  const _pathname = usePathname();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { nfts: _nfts } = useNFTContext();
  const { toggleInventory } = useInventory();
  const { displayName, hasBasename } = useBasename(address);
  const contracts = getContracts(base.id);
  const publicClient = usePublicClient({ chainId: base.id });

  // Token price state - exported for use in other components
  const [tokenPrice, setTokenPrice] = useState<string>('0');
  const [ethPrice, setEthPrice] = useState<number>(0);

  // Make token price available globally via window for PredictionJack
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__TOKEN_PRICE_USD__ = parseFloat(tokenPrice) || 0;
      (window as any).__ETH_PRICE_USD__ = ethPrice || 0;
    }
  }, [tokenPrice, ethPrice]);

  // Debug logging
  useEffect(() => {
    console.log('🔍 Navigation - Connection Status:', {
      isConnected,
      hasAddress: !!address,
      address: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'none'
    });
  }, [isConnected, address]);

  // Fetch ETH price from Alchemy
  useEffect(() => {
    const fetchETHPrice = async () => {
      const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

      if (!alchemyApiKey) {
        console.warn('⚠️ Alchemy API key not found');
        return;
      }

      try {
        const url = `https://api.g.alchemy.com/prices/v1/${alchemyApiKey}/tokens/by-symbol?symbols=ETH`;

        const response = await fetch(url);

        if (!response.ok) {
          console.warn(`Alchemy API error: ${response.status}`);
          return; // Fail gracefully, price will remain null
        }

        const data = await response.json();
        console.log('🔍 Alchemy ETH response:', data);

        if (data?.data && data.data.length > 0) {
          const ethData = data.data[0];
          const usdPrice = ethData.prices?.find((p: any) => p.currency === 'usd' || p.currency === 'USD')?.value;

          if (usdPrice) {
            const price = parseFloat(usdPrice);
            console.log('💵 ETH price in USD:', price);
            setEthPrice(price);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching ETH price from Alchemy:', error);
      }
    };

    fetchETHPrice();
    // Only fetch once on page load (no interval)
  }, []);

  // Fetch token price using V4 Quoter (in 1 second loop with mint counter)
  useEffect(() => {
    const fetchTokenPrice = async () => {
      if (!publicClient) {
        return; // Don't log when not ready, just skip
      }

      try {
        // Step 1: Read poolIdRaw and hook address from NFT contract
        const [poolIdRaw, hookAddress] = await Promise.all([
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'poolIdRaw',
            args: [],
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'hook',
            args: [],
          }) as Promise<`0x${string}`>,
        ]);

        // Step 2: Get the full PoolKey from the hook contract
        const poolKey = await publicClient.readContract({
          address: hookAddress,
          abi: [
            {
              inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
              name: 'getPoolKey',
              outputs: [
                {
                  components: [
                    { internalType: 'address', name: 'currency0', type: 'address' },
                    { internalType: 'address', name: 'currency1', type: 'address' },
                    { internalType: 'uint24', name: 'fee', type: 'uint24' },
                    { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
                    { internalType: 'address', name: 'hooks', type: 'address' },
                  ],
                  internalType: 'tuple',
                  name: '',
                  type: 'tuple',
                },
              ],
              stateMutability: 'view',
              type: 'function',
            },
          ],
          functionName: 'getPoolKey',
          args: [poolIdRaw],
        }) as unknown as {
          currency0: `0x${string}`;
          currency1: `0x${string}`;
          fee: number;
          tickSpacing: number;
          hooks: `0x${string}`;
        };

        // Step 3: Quote 1 token to get ETH value (Token -> ETH)
        const oneToken = parseEther('1'); // 1 token
        const result = await publicClient.simulateContract({
          address: QUOTER_ADDRESS,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: poolKey,
              zeroForOne: false, // Token -> ETH (opposite of mint direction)
              exactAmount: oneToken,
              hookData: '0x',
            },
          ],
        });

        // Extract amountOut (ETH) from the result
        const [ethOut] = result.result as [bigint, bigint];
        const ethPerToken = parseFloat(formatEther(ethOut));

        // Calculate USD price: (ETH per token) * (USD per ETH)
        // Only update if we have valid ETH price from Alchemy
        if (ethPrice > 0 && ethPerToken > 0) {
          const tokenUSDPrice = ethPerToken * ethPrice;

          // Format with appropriate decimals
          let formattedPrice;
          if (tokenUSDPrice < 0.01) {
            formattedPrice = tokenUSDPrice.toFixed(6);
          } else if (tokenUSDPrice < 1) {
            formattedPrice = tokenUSDPrice.toFixed(4);
          } else {
            formattedPrice = tokenUSDPrice.toFixed(2);
          }

          setTokenPrice(formattedPrice);
        }
        // If ethPrice is 0 or invalid, keep previous tokenPrice (don't overwrite)
      } catch (error) {
        console.error('❌ Error fetching token price from quoter:', error);
        // Don't overwrite tokenPrice on error - keep previous value
      }
    };

    fetchTokenPrice();
    // Refresh price every 10 seconds (reduced from 1s to avoid rate limits)
    // Token prices don't change that frequently in practice
    const interval = setInterval(fetchTokenPrice, 10000);
    return () => clearInterval(interval);
  }, [publicClient, contracts.nft.address, ethPrice]);

  // Fetch total swap minted count for mint counter
  const { data: totalSwapMintedData } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'totalSwapMinted',
    chainId: base.id,
    query: {
      refetchInterval: 10000, // Poll every 10 seconds (reduced from 1s to avoid rate limits)
    },
  });

  // Calculate NFTs remaining (max 3000)
  const isLoadingMintCount = totalSwapMintedData === undefined;
  const nftsRemaining = totalSwapMintedData ? 3000 - Number(totalSwapMintedData) : 3000;

  const mintIsLive = nftsRemaining > 0;

  const handleFastTravelMint = () => {
    router.push('/?fastTravelMint=true');
  };

  const _shortenAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <nav className="w-full bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-40">
      <div className="w-full" style={{ paddingLeft: 'clamp(0.75rem, 2vw, 1.5rem)', paddingRight: 'clamp(0.75rem, 2vw, 1.5rem)', paddingTop: 'clamp(0.4rem, 1.2vw, 0.75rem)', paddingBottom: 'clamp(0.4rem, 1.2vw, 0.75rem)' }}>
        <div className="flex items-center justify-between" style={{ gap: 'clamp(0.5rem, 1.5vw, 0.75rem)' }}>
          {/* Left Side: Mint Counter and Chart locked to left */}
          <div className="flex items-center flex-shrink-0" style={{ gap: 'clamp(0.4rem, 1.2vw, 0.5rem)' }}>
            {/* Futuristic Mint Counter with Integrated Button */}
            <div
              className={`relative overflow-hidden border ${
                mintIsLive
                  ? 'bg-gradient-to-r from-cyan-950/40 via-purple-950/40 to-pink-950/40 border-cyan-500/30 hover:border-cyan-400/50 cursor-pointer'
                  : 'bg-gradient-to-r from-purple-950/40 via-pink-950/40 to-rose-950/40 border-purple-500/30 hover:border-purple-400/50 cursor-pointer'
              } backdrop-blur-sm transition-all duration-300`}
              onClick={mintIsLive ? handleFastTravelMint : () => window.open(`https://opensea.io/assets/base/${contracts.nft.address}`, '_blank')}
              style={{
                boxShadow: mintIsLive
                  ? '0 0 15px rgba(6, 182, 212, 0.1), inset 0 0 15px rgba(168, 85, 247, 0.03)'
                  : '0 0 15px rgba(168, 85, 247, 0.15), inset 0 0 15px rgba(236, 72, 153, 0.05)',
                minHeight: 'clamp(40px, 8vw, 56px)',
                borderRadius: 'clamp(6px, 1vw, 8px)'
              }}
            >
              {/* Animated gradient overlay - always show */}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: mintIsLive
                    ? 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.3), transparent)'
                    : 'linear-gradient(90deg, transparent, rgba(168, 85, 247, 0.3), transparent)',
                  animation: 'shimmer 3s infinite',
                }}
              />

              {/* Content */}
              <div className="relative flex items-center flex-shrink-0" style={{ gap: 'clamp(0.4rem, 1vw, 0.75rem)', padding: 'clamp(0.375rem, 1vw, 0.5rem) clamp(0.625rem, 1.5vw, 0.75rem)' }}>
                {/* Wilfred Icon */}
                <div className="relative flex-shrink-0" style={{ width: 'clamp(18px, 3.5vw, 24px)', height: 'clamp(18px, 3.5vw, 24px)' }}>
                  <img
                    src="/Images/Wilfred.png"
                    alt="Wilfred"
                    className="w-full h-full object-contain animate-pulse"
                    style={{
                      filter: mintIsLive
                        ? 'drop-shadow(0 0 6px rgba(6, 182, 212, 0.6))'
                        : 'drop-shadow(0 0 6px rgba(168, 85, 247, 0.6))'
                    }}
                  />
                </div>

                {/* Counter Info */}
                <div className="flex flex-col">
                  <div className={`font-medium tracking-wider ${
                    isLoadingMintCount ? 'text-yellow-400' : mintIsLive ? 'text-cyan-400' : 'text-purple-400'
                  }`} style={{ fontSize: 'clamp(9px, 1.8vw, 12px)' }}>
                    {isLoadingMintCount ? 'Mint Loading' : mintIsLive ? 'MINT LIVE' : 'View Collection'}
                  </div>
                  <div className={`font-bold tracking-wide ${
                    isLoadingMintCount ? 'text-yellow-300' : mintIsLive ? 'text-white' : 'text-pink-300'
                  }`} style={{ fontSize: 'clamp(11px, 2.2vw, 14px)' }}>
                    {isLoadingMintCount ? 'loading...' : mintIsLive ? `${nftsRemaining.toLocaleString()} / 3,000` : 'SOLD OUT!'}
                  </div>
                </div>

                {/* Action Button (integrated) - only show when mint is live and not loading */}
                {!isLoadingMintCount && mintIsLive && (
                  <>
                    {/* Divider */}
                    <div className="w-px bg-gradient-to-b from-transparent via-cyan-500/30 to-transparent hidden sm:block" style={{ height: 'clamp(20px, 4vw, 28px)' }} />

                    {/* Mint Action */}
                    <div className="flex items-center" style={{ gap: 'clamp(0.25rem, 0.8vw, 0.375rem)', paddingLeft: 'clamp(0.25rem, 0.8vw, 0.5rem)', paddingRight: 'clamp(0.25rem, 0.8vw, 0.5rem)' }}>
                      <div className="font-semibold text-cyan-300 uppercase tracking-wider" style={{ fontSize: 'clamp(9px, 1.8vw, 12px)' }}>
                        <span className="hidden sm:inline">Mint Now</span>
                        <span className="sm:hidden">Mint</span>
                      </div>
                      <svg
                        className="text-cyan-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        style={{ width: 'clamp(12px, 2.5vw, 16px)', height: 'clamp(12px, 2.5vw, 16px)' }}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    </div>
                  </>
                )}
              </div>

              {/* Glow effect on hover */}
              {mintIsLive && (
                <div
                  className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle at center, rgba(6, 182, 212, 0.1), transparent 70%)'
                  }}
                />
              )}
            </div>

            {/* Chart Button */}
            <a
              href={`https://dexscreener.com/base/${contracts.token.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="relative overflow-hidden border bg-gradient-to-r from-green-950/40 via-emerald-950/40 to-teal-950/40 border-green-500/30 hover:border-green-400/50 backdrop-blur-sm transition-all duration-300 cursor-pointer flex items-center"
              style={{
                boxShadow: '0 0 10px rgba(16, 185, 129, 0.1), inset 0 0 10px rgba(16, 185, 129, 0.03)',
                minHeight: 'clamp(40px, 8vw, 56px)',
                borderRadius: 'clamp(6px, 1vw, 8px)'
              }}
            >
              {/* Shimmer effect */}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.3), transparent)',
                  animation: 'shimmer 3s infinite',
                }}
              />

              {/* Content */}
              <div className="relative flex items-center" style={{ gap: 'clamp(0.4rem, 1vw, 0.75rem)', padding: 'clamp(0.375rem, 1vw, 0.5rem) clamp(0.625rem, 1.5vw, 0.75rem)' }}>
                <svg
                  className="text-green-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{ width: 'clamp(14px, 2.8vw, 16px)', height: 'clamp(14px, 2.8vw, 16px)' }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <div className="flex flex-col">
                  <span className="font-medium tracking-wider text-green-200" style={{ fontSize: 'clamp(9px, 1.8vw, 12px)' }}>
                    CHART
                  </span>
                  <span className="font-bold tracking-wide text-white" style={{ fontSize: 'clamp(11px, 2.2vw, 14px)' }}>
                    {parseFloat(tokenPrice) > 0 ? `$${tokenPrice}` : 'Loading...'}
                  </span>
                </div>
              </div>

              {/* Glow effect on hover */}
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{
                  background: 'radial-gradient(circle at center, rgba(16, 185, 129, 0.1), transparent 70%)'
                }}
              />
            </a>

            {/* Docs Button */}
            <Link
              href="/docs"
              className="relative overflow-hidden border bg-gradient-to-r from-purple-950/40 via-pink-950/40 to-rose-950/40 border-purple-500/30 hover:border-purple-400/50 backdrop-blur-sm transition-all duration-300 cursor-pointer flex items-center"
              style={{
                boxShadow: '0 0 10px rgba(168, 85, 247, 0.1), inset 0 0 10px rgba(168, 85, 247, 0.03)',
                minHeight: 'clamp(40px, 8vw, 56px)',
                borderRadius: 'clamp(6px, 1vw, 8px)'
              }}
            >
              {/* Shimmer effect */}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(168, 85, 247, 0.3), transparent)',
                  animation: 'shimmer 3s infinite',
                }}
              />

              {/* Content */}
              <div className="relative flex items-center" style={{ gap: 'clamp(0.4rem, 1vw, 0.75rem)', padding: 'clamp(0.375rem, 1vw, 0.5rem) clamp(0.625rem, 1.5vw, 0.75rem)' }}>
                <svg
                  className="text-purple-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{ width: 'clamp(14px, 2.8vw, 16px)', height: 'clamp(14px, 2.8vw, 16px)' }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <div className="flex flex-col">
                  <span className="font-medium tracking-wider text-purple-200" style={{ fontSize: 'clamp(9px, 1.8vw, 12px)' }}>
                    DOCS
                  </span>
                  <span className="font-bold tracking-wide text-white" style={{ fontSize: 'clamp(11px, 2.2vw, 14px)' }}>
                    Whitepaper
                  </span>
                </div>
              </div>

              {/* Glow effect on hover */}
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{
                  background: 'radial-gradient(circle at center, rgba(168, 85, 247, 0.1), transparent 70%)'
                }}
              />
            </Link>

            {/* Add shimmer animation */}
            <style jsx>{`
              @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
              }
            `}</style>
          </div>

          {/* Right Side: Wallet Section - Always use ConnectButton to handle all states */}
          <div className="flex items-center flex-shrink-0">
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal: _openAccountModal,
                openChainModal,
                openConnectModal,
                authenticationStatus,
                mounted
              }) => {
                const ready = mounted && authenticationStatus !== 'loading';
                const connected =
                  ready &&
                  account &&
                  chain &&
                  (!authenticationStatus || authenticationStatus === 'authenticated');

                return (
                  <div {...(!ready && { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none' } })}>
                    {!connected ? (
                      /* Futuristic Connect Button */
                      <button
                        onClick={openConnectModal}
                        disabled={authenticationStatus === 'loading'}
                        className="relative overflow-hidden border bg-gradient-to-r from-blue-950/40 via-indigo-950/40 to-purple-950/40 border-blue-500/30 hover:border-blue-400/50 backdrop-blur-sm transition-all duration-300 cursor-pointer"
                        style={{
                          boxShadow: '0 0 15px rgba(59, 130, 246, 0.1), inset 0 0 15px rgba(59, 130, 246, 0.03)',
                          borderRadius: 'clamp(6px, 1vw, 8px)'
                        }}
                      >
                        {/* Shimmer effect */}
                        <div
                          className="absolute inset-0 opacity-30"
                          style={{
                            background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.3), transparent)',
                            animation: 'shimmer 3s infinite',
                          }}
                        />

                        {/* Content */}
                        <div className="relative flex items-center" style={{ gap: 'clamp(0.375rem, 0.9vw, 0.375rem)', padding: 'clamp(0.375rem, 1vw, 0.5rem) clamp(0.625rem, 1.5vw, 0.75rem)' }}>
                          <svg
                            className="text-blue-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            style={{ width: 'clamp(14px, 2.8vw, 16px)', height: 'clamp(14px, 2.8vw, 16px)' }}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                          <span className="font-semibold text-blue-300 tracking-wider" style={{ fontSize: 'clamp(11px, 2.2vw, 14px)' }}>
                            {authenticationStatus === 'loading' ? 'Connecting...' : 'Connect Wallet'}
                          </span>
                        </div>

                        {/* Glow effect on hover */}
                        <div
                          className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                          style={{
                            background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.1), transparent 70%)'
                          }}
                        />
                      </button>
                    ) : (
                      /* Wallet connected - show account button */
                      <div className="flex items-center" style={{ gap: 'clamp(0.4rem, 1.2vw, 0.5rem)' }}>
                        {/* Futuristic Account Button */}
                        {chain?.unsupported ? (
                          <button
                            onClick={openChainModal}
                            className="relative overflow-hidden border bg-gradient-to-r from-red-950/40 via-rose-950/40 to-pink-950/40 border-red-500/30 hover:border-red-400/50 backdrop-blur-sm transition-all duration-300"
                            style={{
                              boxShadow: '0 0 10px rgba(239, 68, 68, 0.1), inset 0 0 10px rgba(239, 68, 68, 0.03)',
                              padding: 'clamp(0.375rem, 1vw, 0.5rem) clamp(0.625rem, 1.5vw, 0.75rem)',
                              borderRadius: 'clamp(6px, 1vw, 8px)'
                            }}
                          >
                            <div className="relative flex items-center" style={{ gap: 'clamp(0.375rem, 0.9vw, 0.375rem)' }}>
                              <svg
                                className="text-red-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                style={{ width: 'clamp(13px, 2.6vw, 16px)', height: 'clamp(13px, 2.6vw, 16px)' }}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                />
                              </svg>
                              <span className="font-medium text-red-300" style={{ fontSize: 'clamp(11px, 2.2vw, 14px)' }}>Wrong Network</span>
                            </div>
                          </button>
                        ) : (
                          <button
                            onClick={toggleInventory}
                            className="relative overflow-hidden border bg-gradient-to-r from-slate-950/40 via-gray-950/40 to-zinc-950/40 border-slate-500/30 hover:border-slate-400/50 backdrop-blur-sm transition-all duration-300"
                            style={{
                              boxShadow: '0 0 10px rgba(100, 116, 139, 0.1), inset 0 0 10px rgba(100, 116, 139, 0.03)',
                              padding: 'clamp(0.375rem, 1vw, 0.5rem) clamp(0.625rem, 1.5vw, 0.75rem)',
                              borderRadius: 'clamp(6px, 1vw, 8px)'
                            }}
                            title="Open Inventory"
                          >
                            {/* Shimmer effect */}
                            <div
                              className="absolute inset-0 opacity-20"
                              style={{
                                background: 'linear-gradient(90deg, transparent, rgba(100, 116, 139, 0.3), transparent)',
                                animation: 'shimmer 4s infinite',
                              }}
                            />

                            <div className="relative flex items-center" style={{ gap: 'clamp(0.375rem, 0.9vw, 0.375rem)' }}>
                              <div className="bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50" style={{ width: 'clamp(6px, 1.2vw, 8px)', height: 'clamp(6px, 1.2vw, 8px)' }}></div>
                              <span className="font-medium text-slate-300" style={{ fontSize: 'clamp(11px, 2.2vw, 14px)' }}>
                                {displayName}
                              </span>
                              {hasBasename && (
                                <svg
                                  className="text-blue-400"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                  style={{ width: 'clamp(12px, 2.4vw, 12px)', height: 'clamp(12px, 2.4vw, 12px)' }}
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </div>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          </div>
        </div>
      </div>
    </nav>
  );
}
