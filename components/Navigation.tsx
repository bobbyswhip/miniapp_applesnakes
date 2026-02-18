'use client';

import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { nfts: _nfts } = useNFTContext();
  const { toggleInventory, openInventory, showNFTHub, nftHubMode, openNFTHub, closeNFTHub } = useInventory();
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
    <nav className="w-full h-16 bg-[#171e1d]/80 backdrop-blur-sm border-b border-[rgba(255,255,255,0.06)] sticky top-0 z-40">
      <div className="w-full h-full px-0.5 xs:px-1.5 sm:px-3 md:px-4">
        <div className="flex items-center justify-between gap-0.5 xs:gap-1 sm:gap-2 md:gap-3 h-full">
          {/* Left Side: Mint Counter and Chart locked to left */}
          <div className="flex items-center gap-0.5 xs:gap-0.5 sm:gap-1.5 md:gap-2 min-w-0 flex-1 overflow-hidden">
            {/* Futuristic Mint Counter with Integrated Button */}
            <div
              className={`relative overflow-hidden border rounded-md sm:rounded-lg flex-shrink min-w-0 ${
                mintIsLive
                  ? 'bg-[rgba(255,208,117,0.08)] border-[rgba(255,208,117,0.2)] hover:border-[rgba(255,208,117,0.35)] cursor-pointer'
                  : 'bg-[rgba(197,169,123,0.08)] border-[rgba(197,169,123,0.2)] hover:border-[rgba(197,169,123,0.35)] cursor-pointer'
              } backdrop-blur-sm transition-all duration-300`}
              onClick={mintIsLive ? handleFastTravelMint : () => openInventory('collection')}
              style={{
                boxShadow: mintIsLive
                  ? '0 0 15px rgba(255, 208, 117, 0.1), inset 0 0 15px rgba(197, 169, 123, 0.03)'
                  : '0 0 15px rgba(197, 169, 123, 0.15), inset 0 0 15px rgba(166, 139, 91, 0.05)',
              }}
            >
              {/* Animated gradient overlay - always show */}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: mintIsLive
                    ? 'linear-gradient(90deg, transparent, rgba(255, 208, 117, 0.3), transparent)'
                    : 'linear-gradient(90deg, transparent, rgba(197, 169, 123, 0.3), transparent)',
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
                        ? 'drop-shadow(0 0 6px rgba(255, 208, 117, 0.6))'
                        : 'drop-shadow(0 0 6px rgba(197, 169, 123, 0.6))'
                    }}
                  />
                </div>

                {/* Counter Info */}
                <div className="flex flex-col min-w-0">
                  <div className={`font-medium tracking-wider text-[7px] xs:text-[8px] sm:text-[10px] md:text-xs truncate ${
                    isLoadingMintCount ? 'text-[#ffd075]' : mintIsLive ? 'text-[#ffd075]' : 'text-[#c5a97b]'
                  }`}>
                    {isLoadingMintCount ? 'Loading' : mintIsLive ? 'MINT LIVE' : 'Collection'}
                  </div>
                  <div className={`font-bold tracking-wide text-[8px] xs:text-[9px] sm:text-xs md:text-sm truncate ${
                    isLoadingMintCount ? 'text-[#ffd075]' : mintIsLive ? 'text-white' : 'text-[#c5a97b]'
                  }`}>
                    {isLoadingMintCount ? '...' : mintIsLive ? `${nftsRemaining.toLocaleString()}/3K` : 'SOLD OUT'}
                  </div>
                </div>

                {/* Action Button (integrated) - only show when mint is live on larger screens */}
                {!isLoadingMintCount && mintIsLive && (
                  <>
                    {/* Divider */}
                    <div className="w-px h-5 sm:h-6 bg-gradient-to-b from-transparent via-[rgba(255,208,117,0.3)] to-transparent hidden md:block" />

                    {/* Mint Action - hidden on small screens */}
                    <div className="hidden md:flex items-center gap-1 px-1">
                      <div className="font-semibold text-[#ffd075] uppercase tracking-wider text-[10px] sm:text-xs">
                        Mint
                      </div>
                      <svg className="text-[#ffd075] w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    background: 'radial-gradient(circle at center, rgba(255, 208, 117, 0.1), transparent 70%)'
                  }}
                />
              )}
            </div>

            {/* Chart Button - Opens trading tab */}
            <button
              onClick={() => openInventory('trading')}
              className="relative overflow-hidden border bg-[rgba(34,197,94,0.06)] border-green-500/30 hover:border-green-400/50 backdrop-blur-sm transition-all duration-300 cursor-pointer flex items-center rounded-md sm:rounded-lg flex-shrink min-w-0"
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
                  <span className="font-medium tracking-wider text-[#22c55e] text-[7px] xs:text-[8px] sm:text-[10px] md:text-xs hidden xs:block">
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
                        className="relative overflow-hidden border bg-[rgba(255,208,117,0.08)] border-[rgba(255,208,117,0.2)] hover:border-[rgba(255,208,117,0.35)] backdrop-blur-sm transition-all duration-300 cursor-pointer rounded-md sm:rounded-lg"
                        style={{
                          boxShadow: '0 0 15px rgba(255, 208, 117, 0.1), inset 0 0 15px rgba(255, 208, 117, 0.03)',
                        }}
                      >
                        {/* Shimmer effect */}
                        <div
                          className="absolute inset-0 opacity-30"
                          style={{
                            background: 'linear-gradient(90deg, transparent, rgba(255, 208, 117, 0.3), transparent)',
                            animation: 'shimmer 3s infinite',
                          }}
                        />

                        {/* Content */}
                        <div className="relative flex items-center gap-0.5 xs:gap-1 p-0.5 xs:p-1 sm:p-2">
                          <svg className="text-[#ffd075] w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span className="font-semibold text-[#ffd075] tracking-wider text-[8px] xs:text-[9px] sm:text-xs md:text-sm whitespace-nowrap">
                            {authenticationStatus === 'loading' ? '...' : 'Connect'}
                          </span>
                        </div>

                        {/* Glow effect on hover */}
                        <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ background: 'radial-gradient(circle at center, rgba(255, 208, 117, 0.1), transparent 70%)' }} />
                      </button>
                    ) : (
                      /* Wallet connected - show account button */
                      <div className="flex items-center gap-0.5 xs:gap-1">
                        {/* Futuristic Account Button */}
                        {chain?.unsupported ? (
                          <button
                            onClick={openChainModal}
                            className="relative overflow-hidden border bg-[rgba(239,68,68,0.08)] border-red-500/30 hover:border-red-400/50 backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                            style={{
                              boxShadow: '0 0 10px rgba(239, 68, 68, 0.1), inset 0 0 10px rgba(239, 68, 68, 0.03)',
                            }}
                          >
                            <div className="relative flex items-center gap-0.5 xs:gap-1">
                              <svg className="text-[#ef4444] w-2.5 h-2.5 xs:w-3 xs:h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <span className="font-medium text-[#ef4444] text-[8px] xs:text-[9px] sm:text-xs whitespace-nowrap">
                                <span className="hidden xs:inline">Wrong Network</span>
                                <span className="xs:hidden">Switch</span>
                              </span>
                            </div>
                          </button>
                        ) : (
                          <>
                          {/* Inventory Button */}
                          <button
                            onClick={toggleInventory}
                            className="relative overflow-hidden border bg-[rgba(255,208,117,0.06)] border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,208,117,0.25)] backdrop-blur-sm transition-all duration-300 rounded-md sm:rounded-lg p-0.5 xs:p-1 sm:p-2"
                            style={{
                              boxShadow: '0 0 10px rgba(197, 169, 123, 0.1), inset 0 0 10px rgba(197, 169, 123, 0.03)',
                            }}
                            title="Open Inventory"
                          >
                            {/* Shimmer effect */}
                            <div
                              className="absolute inset-0 opacity-20"
                              style={{
                                background: 'linear-gradient(90deg, transparent, rgba(255, 208, 117, 0.3), transparent)',
                                animation: 'shimmer 4s infinite',
                              }}
                            />

                            <div className="relative flex items-center gap-0.5 xs:gap-0.5 sm:gap-1.5">
                              <div className="w-1 h-1 xs:w-1.5 xs:h-1.5 sm:w-2 sm:h-2 bg-[#ffd075] rounded-full animate-pulse shadow-lg shadow-[rgba(255,208,117,0.5)]" />
                              <span className="font-medium text-[#cecece] text-[8px] xs:text-[9px] sm:text-xs md:text-sm truncate max-w-[40px] xs:max-w-[50px] sm:max-w-[80px] md:max-w-none">
                                {displayName}
                              </span>
                              {hasBasename && (
                                <svg className="text-[#ffd075] w-2 h-2 xs:w-2.5 xs:h-2.5 flex-shrink-0 hidden xs:block" fill="currentColor" viewBox="0 0 20 20">
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

    {/* SwapWrapModal - NFT Hub (Buy Only) */}
    <SwapWrapModal
      isOpen={showNFTHub}
      onClose={closeNFTHub}
      nftContractAddress={contracts.nft.address}
      initialMode="buy"
      buyOnly={true}
    />

    </>
  );
}
