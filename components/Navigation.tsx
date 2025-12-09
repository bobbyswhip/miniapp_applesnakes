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
import { SwapWrapModal } from './SwapWrapModal';

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { nfts: _nfts } = useNFTContext();
  const { toggleInventory, openInventory, openUnity, showUnity, closeUnity, showNFTHub, nftHubMode, openNFTHub, closeNFTHub } = useInventory();
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
    <>
    <nav className="w-full h-16 bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-40">
      <div className="w-full h-full px-0.5 xs:px-1.5 sm:px-3 md:px-4">
        <div className="flex items-center justify-between gap-0.5 xs:gap-1 sm:gap-2 md:gap-3 h-full">
          {/* Left Side: Mint Counter and Chart locked to left */}
          <div className="flex items-center gap-0.5 xs:gap-0.5 sm:gap-1.5 md:gap-2 min-w-0 flex-1 overflow-hidden">
            {/* Futuristic Mint Counter with Integrated Button */}
            <div
              className={`relative overflow-hidden border rounded-md sm:rounded-lg flex-shrink min-w-0 ${
                mintIsLive
                  ? 'bg-gradient-to-r from-cyan-950/40 via-purple-950/40 to-pink-950/40 border-cyan-500/30 hover:border-cyan-400/50 cursor-pointer'
                  : 'bg-gradient-to-r from-purple-950/40 via-pink-950/40 to-rose-950/40 border-purple-500/30 hover:border-purple-400/50 cursor-pointer'
              } backdrop-blur-sm transition-all duration-300`}
              onClick={mintIsLive ? handleFastTravelMint : () => openInventory('collection')}
              style={{
                boxShadow: mintIsLive
                  ? '0 0 15px rgba(6, 182, 212, 0.1), inset 0 0 15px rgba(168, 85, 247, 0.03)'
                  : '0 0 15px rgba(168, 85, 247, 0.15), inset 0 0 15px rgba(236, 72, 153, 0.05)',
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
              <div className="relative flex items-center gap-0.5 xs:gap-1 sm:gap-2 p-0.5 xs:p-1 sm:p-2">
                {/* Wilfred Icon */}
                <div className="relative flex-shrink-0 w-3 h-3 xs:w-3.5 xs:h-3.5 sm:w-5 sm:h-5">
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
                <div className="flex flex-col min-w-0">
                  <div className={`font-medium tracking-wider text-[7px] xs:text-[8px] sm:text-[10px] md:text-xs truncate ${
                    isLoadingMintCount ? 'text-yellow-400' : mintIsLive ? 'text-cyan-400' : 'text-purple-400'
                  }`}>
                    {isLoadingMintCount ? 'Loading' : mintIsLive ? 'MINT LIVE' : 'Collection'}
                  </div>
                  <div className={`font-bold tracking-wide text-[8px] xs:text-[9px] sm:text-xs md:text-sm truncate ${
                    isLoadingMintCount ? 'text-yellow-300' : mintIsLive ? 'text-white' : 'text-pink-300'
                  }`}>
                    {isLoadingMintCount ? '...' : mintIsLive ? `${nftsRemaining.toLocaleString()}/3K` : 'SOLD OUT'}
                  </div>
                </div>

                {/* Action Button (integrated) - only show when mint is live on larger screens */}
                {!isLoadingMintCount && mintIsLive && (
                  <>
                    {/* Divider */}
                    <div className="w-px h-5 sm:h-6 bg-gradient-to-b from-transparent via-cyan-500/30 to-transparent hidden md:block" />

                    {/* Mint Action - hidden on small screens */}
                    <div className="hidden md:flex items-center gap-1 px-1">
                      <div className="font-semibold text-cyan-300 uppercase tracking-wider text-[10px] sm:text-xs">
                        Mint
                      </div>
                      <svg className="text-cyan-400 w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
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

            {/* Chart Button - Opens trading tab */}
            <button
              onClick={() => openInventory('trading')}
              className="relative overflow-hidden border bg-gradient-to-r from-green-950/40 via-emerald-950/40 to-teal-950/40 border-green-500/30 hover:border-green-400/50 backdrop-blur-sm transition-all duration-300 cursor-pointer flex items-center rounded-md sm:rounded-lg flex-shrink min-w-0"
              style={{
                boxShadow: '0 0 10px rgba(16, 185, 129, 0.1), inset 0 0 10px rgba(16, 185, 129, 0.03)',
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
              <div className="relative flex items-center gap-0.5 xs:gap-1 sm:gap-2 p-0.5 xs:p-1 sm:p-2">
                <svg className="text-green-400 flex-shrink-0 w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium tracking-wider text-green-200 text-[7px] xs:text-[8px] sm:text-[10px] md:text-xs hidden xs:block">
                    CHART
                  </span>
                  <span className="font-bold tracking-wide text-white text-[8px] xs:text-[9px] sm:text-xs md:text-sm truncate">
                    {parseFloat(tokenPrice) > 0 ? `$${tokenPrice}` : '...'}
                  </span>
                </div>
              </div>

              {/* Glow effect on hover */}
              <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ background: 'radial-gradient(circle at center, rgba(16, 185, 129, 0.1), transparent 70%)' }} />
            </button>

            {/* Docs/Home Button - hidden on small screens, shows Home when on /docs */}
            <Link
              href={pathname === '/docs' ? '/' : '/docs'}
              className={`hidden sm:flex relative overflow-hidden border backdrop-blur-sm transition-all duration-300 cursor-pointer items-center rounded-md sm:rounded-lg flex-shrink min-w-0 ${
                pathname === '/docs'
                  ? 'bg-gradient-to-r from-emerald-950/40 via-green-950/40 to-teal-950/40 border-emerald-500/30 hover:border-emerald-400/50'
                  : 'bg-gradient-to-r from-purple-950/40 via-pink-950/40 to-rose-950/40 border-purple-500/30 hover:border-purple-400/50'
              }`}
              style={{
                boxShadow: pathname === '/docs'
                  ? '0 0 10px rgba(16, 185, 129, 0.1), inset 0 0 10px rgba(16, 185, 129, 0.03)'
                  : '0 0 10px rgba(168, 85, 247, 0.1), inset 0 0 10px rgba(168, 85, 247, 0.03)',
              }}
            >
              {/* Shimmer effect */}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: pathname === '/docs'
                    ? 'linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.3), transparent)'
                    : 'linear-gradient(90deg, transparent, rgba(168, 85, 247, 0.3), transparent)',
                  animation: 'shimmer 3s infinite',
                }}
              />

              {/* Content */}
              <div className="relative flex items-center gap-1 sm:gap-2 p-1 sm:p-2">
                {pathname === '/docs' ? (
                  /* Home Icon */
                  <svg className="text-emerald-400 flex-shrink-0 w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                ) : (
                  /* Docs Icon */
                  <svg className="text-purple-400 flex-shrink-0 w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                )}
                <div className="flex flex-col min-w-0">
                  <span className={`font-medium tracking-wider text-[10px] md:text-xs ${pathname === '/docs' ? 'text-emerald-200' : 'text-purple-200'}`}>
                    {pathname === '/docs' ? 'GAME' : 'DOCS'}
                  </span>
                  <span className="font-bold tracking-wide text-white text-xs md:text-sm truncate">
                    <span className="hidden md:inline">{pathname === '/docs' ? 'Home' : 'Whitepaper'}</span>
                    <span className="md:hidden">{pathname === '/docs' ? 'Home' : 'Docs'}</span>
                  </span>
                </div>
              </div>

              {/* Glow effect on hover */}
              <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ background: pathname === '/docs' ? 'radial-gradient(circle at center, rgba(16, 185, 129, 0.1), transparent 70%)' : 'radial-gradient(circle at center, rgba(168, 85, 247, 0.1), transparent 70%)' }} />
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
          <div className="flex items-center flex-shrink-0 ml-auto">
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
                        className="relative overflow-hidden border bg-gradient-to-r from-blue-950/40 via-indigo-950/40 to-purple-950/40 border-blue-500/30 hover:border-blue-400/50 backdrop-blur-sm transition-all duration-300 cursor-pointer rounded-md sm:rounded-lg"
                        style={{
                          boxShadow: '0 0 15px rgba(59, 130, 246, 0.1), inset 0 0 15px rgba(59, 130, 246, 0.03)',
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
                        <div className="relative flex items-center gap-0.5 xs:gap-1 p-0.5 xs:p-1 sm:p-2">
                          <svg className="text-blue-400 w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span className="font-semibold text-blue-300 tracking-wider text-[8px] xs:text-[9px] sm:text-xs md:text-sm whitespace-nowrap">
                            {authenticationStatus === 'loading' ? '...' : 'Connect'}
                          </span>
                        </div>

                        {/* Glow effect on hover */}
                        <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.1), transparent 70%)' }} />
                      </button>
                    ) : (
                      /* Wallet connected - show account button */
                      <div className="flex items-center gap-0.5 xs:gap-1">
                        {/* Futuristic Account Button */}
                        {chain?.unsupported ? (
                          <button
                            onClick={openChainModal}
                            className="relative overflow-hidden border bg-gradient-to-r from-red-950/40 via-rose-950/40 to-pink-950/40 border-red-500/30 hover:border-red-400/50 backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                            style={{
                              boxShadow: '0 0 10px rgba(239, 68, 68, 0.1), inset 0 0 10px rgba(239, 68, 68, 0.03)',
                            }}
                          >
                            <div className="relative flex items-center gap-0.5 xs:gap-1">
                              <svg className="text-red-400 w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <span className="font-medium text-red-300 text-[8px] xs:text-[9px] sm:text-xs whitespace-nowrap">
                                <span className="hidden xs:inline">Wrong Network</span>
                                <span className="xs:hidden">Switch</span>
                              </span>
                            </div>
                          </button>
                        ) : (
                          <>
                          {/* Unity Game Button - Shows Play when closed, Fullscreen/Close when open */}
                          {showUnity ? (
                            <>
                              {/* Fullscreen Button */}
                              <button
                                onClick={() => {
                                  const fullscreen = (window as unknown as Record<string, unknown>).unityFullscreen as (() => void) | undefined;
                                  fullscreen?.();
                                }}
                                className="relative overflow-hidden border bg-gradient-to-r from-green-950/40 via-emerald-950/40 to-teal-950/40 border-green-500/30 hover:border-green-400/50 backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                                style={{
                                  boxShadow: '0 0 10px rgba(34, 197, 94, 0.1), inset 0 0 10px rgba(34, 197, 94, 0.03)',
                                }}
                                title="Fullscreen"
                              >
                                <div className="relative flex items-center gap-0.5 xs:gap-0.5 sm:gap-1">
                                  <svg className="w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                  </svg>
                                </div>
                              </button>
                              {/* Close Game Button */}
                              <button
                                onClick={closeUnity}
                                className="relative overflow-hidden border bg-gradient-to-r from-red-950/40 via-rose-950/40 to-pink-950/40 border-red-500/30 hover:border-red-400/50 backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                                style={{
                                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.1), inset 0 0 10px rgba(239, 68, 68, 0.03)',
                                }}
                                title="Close Game"
                              >
                                <div className="relative flex items-center gap-0.5 xs:gap-0.5 sm:gap-1">
                                  <svg className="w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </div>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={openUnity}
                              className="relative overflow-hidden border bg-gradient-to-r from-purple-950/40 via-indigo-950/40 to-violet-950/40 border-purple-500/30 hover:border-purple-400/50 backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                              style={{
                                boxShadow: '0 0 10px rgba(147, 51, 234, 0.1), inset 0 0 10px rgba(147, 51, 234, 0.03)',
                              }}
                              title="Play Unity Game"
                            >
                              {/* Shimmer effect */}
                              <div
                                className="absolute inset-0 opacity-20"
                                style={{
                                  background: 'linear-gradient(90deg, transparent, rgba(147, 51, 234, 0.3), transparent)',
                                  animation: 'shimmer 4s infinite',
                                }}
                              />
                              <div className="relative flex items-center gap-0.5 xs:gap-0.5 sm:gap-1">
                                <svg className="w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                <span className="font-medium text-purple-300 text-[8px] xs:text-[9px] sm:text-xs hidden sm:inline">Play</span>
                              </div>
                            </button>
                          )}
                          {/* Inventory Button */}
                          <button
                            onClick={toggleInventory}
                            className="relative overflow-hidden border bg-gradient-to-r from-slate-950/40 via-gray-950/40 to-zinc-950/40 border-slate-500/30 hover:border-slate-400/50 backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                            style={{
                              boxShadow: '0 0 10px rgba(100, 116, 139, 0.1), inset 0 0 10px rgba(100, 116, 139, 0.03)',
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

                            <div className="relative flex items-center gap-0.5 xs:gap-0.5 sm:gap-1.5">
                              <div className="w-1 h-1 xs:w-1.5 xs:h-1.5 sm:w-2 sm:h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50" />
                              <span className="font-medium text-slate-300 text-[8px] xs:text-[9px] sm:text-xs md:text-sm truncate max-w-[40px] xs:max-w-[50px] sm:max-w-[80px] md:max-w-none">
                                {displayName}
                              </span>
                              {hasBasename && (
                                <svg className="text-blue-400 w-2 h-2 xs:w-2.5 xs:h-2.5 flex-shrink-0 hidden xs:block" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </button>
                          </>
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

    {/* SwapWrapModal - Universal NFT Hub */}
    <SwapWrapModal
      isOpen={showNFTHub}
      onClose={closeNFTHub}
      nftContractAddress={contracts.nft.address}
      initialMode={nftHubMode}
    />

    </>
  );
}
