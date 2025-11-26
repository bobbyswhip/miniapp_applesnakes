'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useBalance, useReadContract } from 'wagmi';
import { parseEther, formatUnits, formatEther } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI } from '@/config';
import { useNFTContext } from '@/contexts/NFTContext';
import { useInventory } from '@/contexts/InventoryContext';
import { useWTokensNFTs } from '@/hooks/useWTokensNFTs';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useRouter, useSearchParams } from 'next/navigation';
import { JailInterface } from '@/components/JailInterface';
import { StakingInterface } from '@/components/StakingInterface';
import { PredictionJackApp } from '@/components/PredictionJackApp';
import { useSmartWallet } from '@/hooks/useSmartWallet';
import { useBatchTransaction } from '@/hooks/useBatchTransaction';

type TimeOfDay = 'day' | 'sunset' | 'dusk' | 'moonrise' | 'night' | 'moonset' | 'dawn' | 'sunrise';

type LocationId = 'main' | 'mountain' | 'meteor' | 'cave' | 'town' | 'jailhouse' | 'store' | 'wizardhouse' | 'mountainhut';
type LocationClassification = 'Valley' | 'Snow' | 'Cave';

interface Location {
  id: LocationId;
  name: string;
  backgroundImage: string;
  description?: string;
  classification: LocationClassification;
  musicPath: string;
  musicVolume: number; // Base multiplier for this song (0.0 - 1.0)
}

// Location configurations
const LOCATIONS: Record<LocationId, Location> = {
  main: {
    id: 'main',
    name: 'Apple Valley',
    backgroundImage: '/Images/WebBackground.png',
    description: 'The main village',
    classification: 'Valley',
    musicPath: '/Music/Grassy_Valley_River_Basin.wav',
    musicVolume: 1.0
  },
  mountain: {
    id: 'mountain',
    name: 'Mount Blowamanjaro',
    backgroundImage: '/Images/Mountain.png',
    description: 'A mysterious mountain',
    classification: 'Snow',
    musicPath: '/Music/Frozen_Heights.wav',
    musicVolume: 1.0
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor Crater',
    backgroundImage: '/Images/SnowBlind.png',
    description: 'A massive meteor impact site',
    classification: 'Snow',
    musicPath: '/Music/Frozen_Heights.wav',
    musicVolume: 1.0
  },
  cave: {
    id: 'cave',
    name: 'The Hollow',
    backgroundImage: '/Images/CaveBackground.png',
    description: 'A dark and mysterious cave',
    classification: 'Cave',
    musicPath: '/Music/Echoes_in_the_Hollow.wav',
    musicVolume: 1.0
  },
  town: {
    id: 'town',
    name: 'Apple Town',
    backgroundImage: '/Images/TownBackground.png',
    description: 'The bustling town center',
    classification: 'Valley',
    musicPath: '/Music/Grassy_Valley_River_Basin.wav',
    musicVolume: 1.0
  },
  jailhouse: {
    id: 'jailhouse',
    name: 'Jail House',
    backgroundImage: '/Images/GreenScreen.png',
    description: 'The town jail house',
    classification: 'Valley',
    musicPath: '/Music/Grassy_Valley_River_Basin.wav',
    musicVolume: 1.0
  },
  store: {
    id: 'store',
    name: 'Town Store',
    backgroundImage: '/Images/StoreBackground.png',
    description: 'The town general store',
    classification: 'Valley',
    musicPath: '/Music/Grassy_Valley_River_Basin.wav',
    musicVolume: 1.0
  },
  wizardhouse: {
    id: 'wizardhouse',
    name: 'Wizard House',
    backgroundImage: '/Images/WizardHouseBackground.png',
    description: 'The wizard\'s mysterious dwelling',
    classification: 'Valley',
    musicPath: '/Music/Grassy_Valley_River_Basin.wav',
    musicVolume: 1.0
  },
  mountainhut: {
    id: 'mountainhut',
    name: 'Mountain Hut',
    backgroundImage: '/Images/MountianHutBackground.png',
    description: 'A cozy mountain shelter',
    classification: 'Snow',
    musicPath: '/Music/Frozen_Heights.wav',
    musicVolume: 1.0
  }
};

function HomeContent() {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const [currentLocation, setCurrentLocation] = useState<LocationId>('main');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [masterVolume] = useState(0.3); // 30% volume
  const [isSpooky, setIsSpooky] = useState(false); // For cave spooky effects
  const [townFrame, setTownFrame] = useState(0); // Town sprite animation frame (0-3)
  const [wizardHouseFrame, setWizardHouseFrame] = useState(0); // WizardHouse sprite animation frame (0-3)
  const [currentCharacter, setCurrentCharacter] = useState<string>(''); // Current character being talked to

  // NFT Context for refetching after minting and accessing user's NFTs
  const { nfts, isLoading, refetch: refetchNFTs } = useNFTContext();

  // UI coordination from InventoryContext
  const { showSwapMint, setShowSwapMint, showChat, setShowChat, showHatch, setShowHatch, showBreed, setShowBreed, showPredictionJack, setShowPredictionJack, openSwapMint, openChat, openHatch, openBreed, openInventory, openPredictionJack } = useInventory();

  // Track if we've already triggered refresh for current mint (prevent duplicate refreshes)
  const hasRefreshedRef = useRef(false);

  // Connect modal hook
  const { openConnectModal } = useConnectModal();

  // Router for navigation
  const router = useRouter();
  const searchParams = useSearchParams();

  // Character button configuration - each character can have different button text
  const characterButtons: { [key: string]: string } = {
    'Shopkeeper': 'Open Shop',
    'Wizard': 'Hatch Eggs',
    'Warden': 'Open Jail',
    'Wilfred': 'Feed Wilfred',
    'MountainMan': 'Play Game',
  };

  // Shop tab state (mint or wrap)
  const [shopTab, setShopTab] = useState<'mint' | 'wrap'>('mint');

  // Breed/Stake tab state
  const [breedStakeTab, setBreedStakeTab] = useState<'breed' | 'stake'>('breed');

  // Swap state management
  const [ethAmount, setEthAmount] = useState<string>('');
  const [tokenEstimate, setTokenEstimate] = useState<string>('0');
  const [_slippage, _setSlippage] = useState<number>(0.5);
  const [isLoadingQuote, setIsLoadingQuote] = useState<boolean>(false);

  // Wrap state management
  const [selectedNFTs, setSelectedNFTs] = useState<Set<number>>(new Set());
  const [wrapMode, setWrapMode] = useState<'wrap' | 'unwrap' | 'swap'>('wrap');

  // Swap state
  const [selectedUserNFT, setSelectedUserNFT] = useState<number | null>(null);
  const [selectedWTokenNFT, setSelectedWTokenNFT] = useState<number | null>(null);

  // Fetch wTokens NFTs (secondary data, loads after user NFTs)
  const {
    nfts: wTokensNFTs,
    isLoading: wTokensLoading,
    refetch: refetchWTokensNFTs,
    totalHeld: wTokensTotalHeld
  } = useWTokensNFTs(true, isLoading);
  const [unwrapCount, setUnwrapCount] = useState(1);
  const [unwrapError, setUnwrapError] = useState<string>('');
  const [currentOperationType, setCurrentOperationType] = useState<'mint' | 'hatch' | 'breed' | 'wrap' | 'unwrap' | 'swap' | null>(null);

  // Hatch state management
  const [selectedEggs, setSelectedEggs] = useState<Set<number>>(new Set());
  const [showHatchSuccess, setShowHatchSuccess] = useState(false);
  const [hatchedNFTs, setHatchedNFTs] = useState<Array<{tokenId: number, name: string, imageUrl: string}>>([]);
  const [recentlyHatchedEggs, setRecentlyHatchedEggs] = useState<Set<number>>(new Set()); // Track eggs hatched in this session

  // Breed state management
  const [selectedHumans, setSelectedHumans] = useState<Set<number>>(new Set());
  const [showBreedSuccess, setShowBreedSuccess] = useState(false);
  const [bredNFT, setBredNFT] = useState<{tokenId: number, name: string, imageUrl: string} | null>(null);
  const [recentlyBredWardens, setRecentlyBredWardens] = useState<Set<number>>(new Set()); // Track wardens used in breeding

  // Staking state management
  const [selectedSnakesForStaking, setSelectedSnakesForStaking] = useState<Set<number>>(new Set());
  const [selectedStakedSnakes, setSelectedStakedSnakes] = useState<Set<number>>(new Set());
  const [_stakedNFTs, _setStakedNFTs] = useState<number[]>([]);
  const [_pendingRewards, _setPendingRewards] = useState<string>('0');
  const [_isLoadingStaked, _setIsLoadingStaked] = useState(false);

  // Jail state management
  const [showJail, setShowJail] = useState(false);

  // Note: PredictionJack state now managed via InventoryContext (showPredictionJack, openPredictionJack)
  // Shared game ID from URL for direct navigation to a specific game
  const [sharedGameId, setSharedGameId] = useState<bigint | null>(null);

  // Wagmi hooks for wallet and contract interaction
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const publicClient = usePublicClient({ chainId: base.id });

  // Smart wallet detection for batch transactions
  const { supportsAtomicBatch: mainPageSupportsAtomicBatch } = useSmartWallet();
  const {
    executeBatch: mainPageExecuteBatch,
    isPending: isMainPageBatchPending,
    isConfirming: isMainPageBatchConfirming,
    isSuccess: isMainPageBatchSuccess,
    reset: resetMainPageBatch,
  } = useBatchTransaction();

  // Use address presence as connection indicator (more reliable than isConnected)
  const isWalletConnected = !!address;

  // Fetch user's ETH balance
  const { data: ethBalanceData } = useBalance({
    address: address,
    chainId: base.id,
  });

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';

  // Contract write hook for swapMint
  const {
    data: hash,
    writeContract,
    isPending: isTransactionPending,
    error: transactionError
  } = useWriteContract();

  // Wait for transaction confirmation
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed
  } = useWaitForTransactionReceipt({
    hash,
  });

  // Fetch total swap minted count for mint counter
  const { data: totalSwapMintedData } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'totalSwapMinted',
    chainId: base.id,
    query: {
      refetchInterval: (data) => {
        const remaining = data ? 3000 - Number(data) : 3000;
        return remaining > 0 ? 1000 : false;
      },
    },
  });
  const nftsRemaining = totalSwapMintedData ? 3000 - Number(totalSwapMintedData) : 3000;

  // Fetch unhatch fee from contract
  const { data: unhatchFee } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'unhatchFee',
    chainId: base.id,
  });

  // Fetch breed fee from contract
  const { data: breedFee } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'breedFee',
    chainId: base.id,
  });

  // Fetch wrap fee from wrapper contract
  const { data: wrapFee } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getWrapFee',
    chainId: base.id,
  });

  // Fetch swap fee from wrapper contract
  const { data: swapFee } = useReadContract({
    address: contracts.wrapper.address,
    abi: contracts.wrapper.abi,
    functionName: 'getSwapFee',
    chainId: base.id,
  });

  // Read approval status for wrapper
  const { data: isWrapperApproved } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'isApprovedForAll',
    args: address && contracts.wrapper.address ? [address, contracts.wrapper.address] : undefined,
    chainId: base.id,
  });

  // Read wToken balance
  const { data: wTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  // Log NFT count updates to console
  useEffect(() => {
    if (totalSwapMintedData !== undefined) {
      console.log(`[NFT Counter] Total minted: ${totalSwapMintedData} | Remaining: ${nftsRemaining}`);
    }
  }, [totalSwapMintedData, nftsRemaining]);

  // Auto-detect shop tab based on mint status
  useEffect(() => {
    if (totalSwapMintedData !== undefined) {
      // If mint is live (has NFTs remaining), open to mint tab
      // If mint is sold out (0 remaining), open to wrap tab
      setShopTab(nftsRemaining > 0 ? 'mint' : 'wrap');
    }
  }, [totalSwapMintedData, nftsRemaining]);

  // Fetch real Uniswap V4 quote
  useEffect(() => {
    const fetchQuote = async () => {
      if (!ethAmount || parseFloat(ethAmount) <= 0 || !publicClient) {
        setTokenEstimate('0');
        setIsLoadingQuote(false);
        return;
      }

      setIsLoadingQuote(true);

      try {
        const exactAmount = parseEther(ethAmount);

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

        // Step 3: Get quote using the real poolKey
        const result = await publicClient.simulateContract({
          address: QUOTER_ADDRESS,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: poolKey,
              zeroForOne: true, // ETH -> Token
              exactAmount: BigInt(exactAmount.toString()),
              hookData: '0x',
            },
          ],
        });

        // Extract amountOut from the result
        const [amountOut] = result.result as [bigint, bigint];
        const tokenAmount = formatUnits(amountOut, 18);
        setTokenEstimate(parseFloat(tokenAmount).toFixed(4));
      } catch (error) {
        console.error('Quote error:', error);
        // Fallback: just show that you'll get tokens without specific amount
        setTokenEstimate('...');
      } finally {
        setIsLoadingQuote(false);
      }
    };

    // Debounce quote fetching
    const timeoutId = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timeoutId);
  }, [ethAmount, publicClient, contracts]);

  // Calculate ETH needed for target NFT count using quoter
  const calculateETHForNFTs = async (targetNFTCount: number): Promise<string> => {
    if (!publicClient) {
      console.warn('Public client not available for price calculation');
      return '0';
    }

    try {
      // Use a probe amount to get current price ratio
      const probeAmount = parseEther('0.0001');

      // Step 1: Get pool configuration
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

      // Step 3: Get quote for probe amount
      const result = await publicClient.simulateContract({
        address: QUOTER_ADDRESS,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: poolKey,
            zeroForOne: true,
            exactAmount: BigInt(probeAmount.toString()),
            hookData: '0x',
          },
        ],
      });

      // Extract token amount from quote
      const [amountOut] = result.result as [bigint, bigint];
      const tokensForProbe = parseFloat(formatUnits(amountOut, 18));

      // Calculate ETH per token ratio
      const ethPerToken = 0.0001 / tokensForProbe;

      // Calculate ETH needed for target NFT count with 10% buffer
      const ethNeeded = ethPerToken * targetNFTCount * 1.10;

      console.log(`💰 Quote calculation for ${targetNFTCount} NFT(s):`);
      console.log(`  Probe: 0.0001 ETH → ${tokensForProbe.toFixed(4)} tokens`);
      console.log(`  Ratio: ${ethPerToken.toFixed(8)} ETH per token`);
      console.log(`  Target: ${targetNFTCount} NFT(s) = ${(ethPerToken * targetNFTCount).toFixed(8)} ETH`);
      console.log(`  With 10% buffer: ${ethNeeded.toFixed(8)} ETH`);

      return ethNeeded.toFixed(8);
    } catch (error) {
      console.error('Failed to calculate ETH for NFTs:', error);
      throw error;
    }
  };

  // Handler for executing the swap mint
  const handleSwapMint = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (!ethAmount || parseFloat(ethAmount) <= 0) {
      console.log('⚠️ Please enter a valid ETH amount');
      return;
    }

    try {
      // Call the swapMint function with ETH value
      writeContract({
        address: contracts.nft.address as `0x${string}`,
        abi: contracts.nft.abi,
        functionName: 'swapMint',
        args: [],
        value: parseEther(ethAmount),
      });
    } catch (error) {
      console.error('Swap error:', error);
    }
  };

  // Hatch handler functions
  const toggleEgg = (tokenId: number) => {
    const newSelected = new Set(selectedEggs);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      newSelected.add(tokenId);
    }
    setSelectedEggs(newSelected);
  };

  const toggleSelectAllEggs = () => {
    const userEggs = nfts.filter(nft => nft.isEgg && !recentlyHatchedEggs.has(nft.tokenId));
    if (selectedEggs.size === userEggs.length) {
      setSelectedEggs(new Set());
    } else {
      setSelectedEggs(new Set(userEggs.map(nft => nft.tokenId)));
    }
  };

  // Breed warden/human selection (filter for humans and wardens, exclude recently bred)
  const toggleHuman = (tokenId: number) => {
    const newSelected = new Set(selectedHumans);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      // Only allow selecting up to 3 wardens/humans
      if (newSelected.size < 3) {
        newSelected.add(tokenId);
      }
    }
    setSelectedHumans(newSelected);
  };

  const toggleSelectAllHumans = () => {
    const availableWardens = nfts.filter(nft =>
      !nft.isEgg &&
      (nft.nftType === 'human' || nft.nftType === 'warden') &&
      !recentlyBredWardens.has(nft.tokenId)
    );
    if (selectedHumans.size === Math.min(3, availableWardens.length) && availableWardens.length > 0) {
      setSelectedHumans(new Set());
    } else {
      // Select first 3 available wardens/humans
      setSelectedHumans(new Set(availableWardens.slice(0, 3).map(nft => nft.tokenId)));
    }
  };

  const handleHatch = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (selectedEggs.size === 0) {
      console.log('⚠️ Please select at least one egg');
      return;
    }

    try {
      const tokenIds = Array.from(selectedEggs);
      const totalFee = unhatchFee ? BigInt(unhatchFee as bigint) * BigInt(tokenIds.length) : 0n;

      writeContract({
        address: contracts.nft.address as `0x${string}`,
        abi: contracts.nft.abi,
        functionName: 'unhatch',
        args: [tokenIds],
        value: totalFee,
      });
    } catch (error) {
      console.error('Hatch error:', error);
    }
  };

  const handleBreed = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (selectedHumans.size !== 3) {
      console.log('⚠️ Please select exactly 3 humans');
      return;
    }

    try {
      const humanIds = Array.from(selectedHumans);
      const fee = breedFee ? BigInt(breedFee as bigint) : 0n;

      writeContract({
        address: contracts.nft.address as `0x${string}`,
        abi: contracts.nft.abi,
        functionName: 'breed',
        args: [humanIds[0], humanIds[1], humanIds[2]],
        value: fee,
      });
    } catch (error) {
      console.error('Breed error:', error);
    }
  };

  // Wrap handlers
  const handleWrapperApprove = async () => {
    try {
      writeContract({
        address: contracts.nft.address as `0x${string}`,
        abi: contracts.nft.abi,
        functionName: 'setApprovalForAll',
        args: [contracts.wrapper.address, true],
      });
    } catch (error) {
      console.error('Approve error:', error);
    }
  };

  const handleWrap = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (selectedNFTs.size === 0) {
      console.log('⚠️ Please select at least one NFT to wrap');
      return;
    }

    try {
      const tokenIds = Array.from(selectedNFTs);
      const totalFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(tokenIds.length) : 0n;

      setCurrentOperationType('wrap'); // Track operation type to skip NFT refetch

      writeContract({
        address: contracts.wrapper.address as `0x${string}`,
        abi: contracts.wrapper.abi,
        functionName: 'wrapNFTs',
        args: [contracts.nft.address, tokenIds],
        value: totalFee,
      });
    } catch (error) {
      console.error('Wrap error:', error);
      setCurrentOperationType(null); // Clear on error
    }
  };

  const handleUnwrap = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (unwrapCount < 1) {
      console.log('⚠️ Please enter a valid unwrap count');
      return;
    }

    try {
      const totalFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(unwrapCount) : 0n;

      setCurrentOperationType('unwrap'); // Track operation type

      writeContract({
        address: contracts.wrapper.address as `0x${string}`,
        abi: contracts.wrapper.abi,
        functionName: 'unwrapNFTs',
        args: [contracts.nft.address, BigInt(unwrapCount)],
        value: totalFee,
      });
    } catch (error) {
      console.error('Unwrap error:', error);
      setCurrentOperationType(null); // Clear on error
    }
  };

  const handleSwap = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (selectedUserNFT === null || selectedWTokenNFT === null) {
      console.log('⚠️ Please select both NFTs to swap');
      return;
    }

    try {
      const totalFee = swapFee ? BigInt(swapFee as bigint) : 0n;

      setCurrentOperationType('swap'); // Track operation type

      writeContract({
        address: contracts.wrapper.address as `0x${string}`,
        abi: contracts.wrapper.abi,
        functionName: 'swapNFT',
        args: [contracts.nft.address, BigInt(selectedUserNFT), BigInt(selectedWTokenNFT)],
        value: totalFee,
      });
    } catch (error) {
      console.error('Swap error:', error);
      setCurrentOperationType(null); // Clear on error
    }
  };

  // Smart wallet: batch approve + wrap in single transaction
  const handleApproveAndWrap = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (selectedNFTs.size === 0) {
      console.log('⚠️ Please select at least one NFT to wrap');
      return;
    }

    try {
      const tokenIds = Array.from(selectedNFTs);
      const totalFee = wrapFee ? BigInt(wrapFee as bigint) * BigInt(tokenIds.length) : 0n;

      setCurrentOperationType('wrap');

      await mainPageExecuteBatch([
        {
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
        },
        {
          address: contracts.wrapper.address as `0x${string}`,
          abi: contracts.wrapper.abi,
          functionName: 'wrapNFTs',
          args: [contracts.nft.address, tokenIds],
          value: totalFee,
        },
      ]);
    } catch (error) {
      console.error('Approve and wrap error:', error);
      setCurrentOperationType(null);
    }
  };

  // Smart wallet: batch approve + swap in single transaction
  const handleApproveAndSwap = async () => {
    if (!isWalletConnected) {
      console.log('⚠️ Please connect your wallet first');
      return;
    }

    if (selectedUserNFT === null || selectedWTokenNFT === null) {
      console.log('⚠️ Please select both NFTs to swap');
      return;
    }

    try {
      const totalFee = swapFee ? BigInt(swapFee as bigint) : 0n;

      setCurrentOperationType('swap');

      await mainPageExecuteBatch([
        {
          address: contracts.nft.address as `0x${string}`,
          abi: contracts.nft.abi,
          functionName: 'setApprovalForAll',
          args: [contracts.wrapper.address, true],
        },
        {
          address: contracts.wrapper.address as `0x${string}`,
          abi: contracts.wrapper.abi,
          functionName: 'swapNFT',
          args: [contracts.nft.address, BigInt(selectedUserNFT), BigInt(selectedWTokenNFT)],
          value: totalFee,
        },
      ]);
    } catch (error) {
      console.error('Approve and swap error:', error);
      setCurrentOperationType(null);
    }
  };

  // Toggle NFT selection for wrapping
  const toggleNFTForWrap = (tokenId: number) => {
    const newSelected = new Set(selectedNFTs);
    if (newSelected.has(tokenId)) {
      newSelected.delete(tokenId);
    } else {
      newSelected.add(tokenId);
    }
    setSelectedNFTs(newSelected);
  };

  // Handle transaction errors (including user rejection)
  useEffect(() => {
    if (transactionError) {
      console.error('❌ Transaction error:', transactionError.message);
      // UI automatically resets when user tries again since isPending/isConfirming are managed by hooks
    }
  }, [transactionError]);

  // Handle batch transaction success for main page
  useEffect(() => {
    if (isMainPageBatchSuccess) {
      console.log('✅ Batch transaction successful! Refreshing NFTs...');
      setTimeout(() => {
        refetchNFTs();
        refetchWTokensNFTs();
        setSelectedNFTs(new Set());
        setSelectedUserNFT(null);
        setSelectedWTokenNFT(null);
        resetMainPageBatch();
        console.log('✅ Batch transaction complete');
      }, 3000);
    }
  }, [isMainPageBatchSuccess, refetchNFTs, refetchWTokensNFTs, resetMainPageBatch]);

  // Reset refresh flag when starting a new transaction
  useEffect(() => {
    if (isTransactionPending) {
      hasRefreshedRef.current = false;
      console.log('🔄 Transaction started, reset refresh flag');
    }
  }, [isTransactionPending]);

  // Refresh NFT inventory after successful mint/hatch (single refresh with delay)
  useEffect(() => {
    if (isConfirmed && !hasRefreshedRef.current) {
      hasRefreshedRef.current = true;
      console.log(`✅ Transaction confirmed! Operation: ${currentOperationType || 'unknown'}`);

      // Skip NFT refetch for wrap operations (NFTs are removed via optimistic update)
      if (currentOperationType === 'wrap') {
        console.log('⏭️ Skipping NFT refetch for wrap operation (using optimistic update)');
        setCurrentOperationType(null);
        return;
      }

      // Handle successful swap - refetch both user and pool NFTs
      if (currentOperationType === 'swap') {
        console.log('🔄 Swap successful! Refreshing user and pool NFTs...');
        setTimeout(() => {
          refetchNFTs();
          refetchWTokensNFTs();
          setSelectedUserNFT(null);
          setSelectedWTokenNFT(null);
          setCurrentOperationType(null);
          console.log('✅ Swap complete, NFT inventories refreshed');
        }, 3000);
        return;
      }

      // Handle successful hatch - show success UI with revealed images
      if (selectedEggs.size > 0) {
        console.log('🥚 Hatch successful! Showing revealed NFTs...');
        const hatchedTokenIds = Array.from(selectedEggs);

        // Create NFT data with revealed image URLs (replace Egg.png with tokenId.png)
        const nftData = hatchedTokenIds.map((tokenId) => {
          // Find the egg in the nfts array to get its imageUrl pattern
          const egg = nfts.find(nft => nft.tokenId === tokenId && nft.isEgg);

          // Replace Egg.png with tokenId.png to show revealed snake
          let imageUrl = `QmSdqQRWUoUFEVcMfr7Y3gVCqjf9zGf8Nw7fW6sqpACYZe/${tokenId}.png`; // fallback
          if (egg?.imageUrl) {
            imageUrl = egg.imageUrl.replace(/Egg\.png$/i, `${tokenId}.png`);
            console.log(`🖼️ Token ${tokenId}: ${egg.imageUrl} → ${imageUrl}`);
          }

          return {
            tokenId,
            name: `Snake #${tokenId}`,
            imageUrl
          };
        });

        console.log(`✅ Prepared ${nftData.length} hatched NFTs for display`);
        setHatchedNFTs(nftData);
        setShowHatchSuccess(true);

        // Track these eggs as hatched to filter them out
        setRecentlyHatchedEggs(prev => new Set([...prev, ...hatchedTokenIds]));
        setSelectedEggs(new Set());
      }

      // Handle successful breed - show success UI with new egg
      if (selectedHumans.size === 3) {
        console.log('🐍 Breed successful! Snake egg created...');

        const usedWardenIds = Array.from(selectedHumans);

        // Try to find the newly minted egg by looking for new eggs in the NFT list after refresh
        // For now, show a placeholder and let the refresh cycle reveal the actual egg
        const eggData = {
          tokenId: 0, // Will be set after NFT refresh finds new egg
          name: 'Snake Egg',
          imageUrl: 'QmSdqQRWUoUFEVcMfr7Y3gVCqjf9zGf8Nw7fW6sqpACYZe/Egg.png'
        };

        console.log('✅ Breed successful, showing egg and tracking used wardens');
        setBredNFT(eggData);
        setShowBreedSuccess(true);

        // Track wardens used in this breeding to filter them out
        setRecentlyBredWardens(prev => new Set([...prev, ...usedWardenIds]));
        setSelectedHumans(new Set());
      }

      // Single refresh after 3 second delay for Alchemy indexing
      setTimeout(() => {
        console.log('🔄 Refreshing NFT inventory (3s delay for Alchemy indexing)...');
        refetchNFTs();
        console.log('✅ NFT inventory refresh triggered');
      }, 3000);
    }
  }, [isConfirmed, refetchNFTs, selectedEggs.size, setShowHatch]);

  // Reset to normal mode when opening hatch UI
  useEffect(() => {
    if (showHatch) {
      setShowHatchSuccess(false);
    }
  }, [showHatch]);

  // Reset to normal mode when opening breed UI
  useEffect(() => {
    if (showBreed) {
      setShowBreedSuccess(false);
    }
  }, [showBreed]);

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.volume = masterVolume * LOCATIONS['main'].musicVolume;
    audio.src = LOCATIONS['main'].musicPath;

    // Attempt to play, but handle autoplay restrictions
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          console.log('🎵 Background music started successfully');
        })
        .catch((_e) => {
          console.log('⚠️ Audio autoplay prevented by browser. Music will start on first user interaction.');
          // Try to play on first user click anywhere
          const startAudio = () => {
            audio.play()
              .then(() => console.log('🎵 Music started after user interaction'))
              .catch(err => console.log('Audio play error:', err));
            document.removeEventListener('click', startAudio);
          };
          document.addEventListener('click', startAudio);
        });
    }

    setAudioElement(audio);

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [masterVolume]);

  // Fast travel to mint (triggered by header mint button)
  useEffect(() => {
    const shouldFastTravel = searchParams.get('fastTravelMint') === 'true';

    if (shouldFastTravel) {
      console.log('⚡ Fast travel to mint triggered!');

      // Clear the query param
      router.replace('/');

      // Start fast travel sequence
      setIsTransitioning(true);

      setTimeout(() => {
        // Change to store location (where shopkeeper is)
        setCurrentLocation('store');

        // Change music if needed (handled by location change effect)
        if (audioElement && LOCATIONS['store'].musicPath !== LOCATIONS[currentLocation].musicPath) {
          const targetVolume = masterVolume * LOCATIONS['store'].musicVolume;

          // Fade out current music
          const fadeOut = setInterval(() => {
            if (audioElement.volume > 0.05) {
              audioElement.volume = Math.max(0, audioElement.volume - 0.05);
            } else {
              clearInterval(fadeOut);
              audioElement.pause();

              // Switch to new music
              audioElement.src = LOCATIONS['store'].musicPath;
              audioElement.volume = 0;

              audioElement.play()
                .then(() => {
                  console.log(`🎵 Playing ${LOCATIONS['store'].musicPath.split('/').pop()} from beginning`);

                  // Fade in new music
                  const fadeIn = setInterval(() => {
                    if (audioElement.volume < targetVolume - 0.05) {
                      audioElement.volume = Math.min(targetVolume, audioElement.volume + 0.05);
                    } else {
                      audioElement.volume = targetVolume;
                      clearInterval(fadeIn);
                    }
                  }, 50);
                })
                .catch(err => console.error('Error playing music:', err));
            }
          }, 50);
        }

        // Open mint UI after screen fades
        setTimeout(() => {
          openSwapMint();
          setIsTransitioning(false);
          console.log('✨ Fast travel complete - mint UI opened');
        }, 600);
      }, 400);
    }
  }, [searchParams, audioElement, currentLocation, masterVolume, router]);

  // Fast travel to hatch (triggered by inventory hatch button)
  useEffect(() => {
    const shouldFastTravel = searchParams.get('fastTravelHatch') === 'true';

    if (shouldFastTravel) {
      console.log('⚡ Fast travel to hatch triggered!');

      // Clear the query param
      router.replace('/');

      // Start fast travel sequence
      setIsTransitioning(true);

      setTimeout(() => {
        // Change to wizardhouse location
        setCurrentLocation('wizardhouse');

        // Change music if needed
        if (audioElement && LOCATIONS['wizardhouse'].musicPath !== LOCATIONS[currentLocation].musicPath) {
          const targetVolume = masterVolume * LOCATIONS['wizardhouse'].musicVolume;

          // Fade out current music
          const fadeOut = setInterval(() => {
            if (audioElement.volume > 0.05) {
              audioElement.volume = Math.max(0, audioElement.volume - 0.05);
            } else {
              clearInterval(fadeOut);
              audioElement.pause();

              // Switch to new music
              audioElement.src = LOCATIONS['wizardhouse'].musicPath;
              audioElement.volume = 0;

              audioElement.play()
                .then(() => {
                  console.log(`🎵 Playing ${LOCATIONS['wizardhouse'].musicPath.split('/').pop()} from beginning`);

                  // Fade in new music
                  const fadeIn = setInterval(() => {
                    if (audioElement.volume < targetVolume - 0.05) {
                      audioElement.volume = Math.min(targetVolume, audioElement.volume + 0.05);
                    } else {
                      audioElement.volume = targetVolume;
                      clearInterval(fadeIn);
                    }
                  }, 50);
                })
                .catch(err => console.error('Error playing music:', err));
            }
          }, 50);
        }

        // Open hatch UI after screen fades
        setTimeout(() => {
          openHatch();
          setIsTransitioning(false);
          console.log('✨ Fast travel complete - hatch UI opened');
        }, 600);
      }, 400);
    }
  }, [searchParams, audioElement, currentLocation, masterVolume, router, openHatch]);

  // Fast travel to breed (triggered by inventory sacrifice button)
  useEffect(() => {
    const shouldFastTravel = searchParams.get('fastTravelBreed') === 'true';

    if (shouldFastTravel) {
      console.log('⚡ Fast travel to breed triggered!');

      // Clear the query param
      router.replace('/');

      // Start fast travel sequence
      setIsTransitioning(true);

      setTimeout(() => {
        // Change to cave location
        setCurrentLocation('cave');

        // Change music if needed (cave has different music!)
        if (audioElement && LOCATIONS['cave'].musicPath !== LOCATIONS[currentLocation].musicPath) {
          const targetVolume = masterVolume * LOCATIONS['cave'].musicVolume;

          // Fade out current music
          const fadeOut = setInterval(() => {
            if (audioElement.volume > 0.05) {
              audioElement.volume = Math.max(0, audioElement.volume - 0.05);
            } else {
              clearInterval(fadeOut);
              audioElement.pause();

              // Switch to new music
              audioElement.src = LOCATIONS['cave'].musicPath;
              audioElement.volume = 0;

              audioElement.play()
                .then(() => {
                  console.log(`🎵 Playing ${LOCATIONS['cave'].musicPath.split('/').pop()} from beginning`);

                  // Fade in new music
                  const fadeIn = setInterval(() => {
                    if (audioElement.volume < targetVolume - 0.05) {
                      audioElement.volume = Math.min(targetVolume, audioElement.volume + 0.05);
                    } else {
                      audioElement.volume = targetVolume;
                      clearInterval(fadeIn);
                    }
                  }, 50);
                })
                .catch(err => console.error('Error playing music:', err));
            }
          }, 50);
        }

        // Open breed UI after screen fades
        setTimeout(() => {
          openBreed();
          setIsTransitioning(false);
          console.log('✨ Fast travel complete - breed UI opened');
        }, 600);
      }, 400);
    }
  }, [searchParams, audioElement, currentLocation, masterVolume, router, openBreed]);

  // Fast travel to staking (triggered by inventory stake button)
  useEffect(() => {
    const shouldFastTravel = searchParams.get('fastTravelStake') === 'true';

    if (shouldFastTravel) {
      console.log('⚡ Fast travel to staking triggered!');

      // Clear the query param
      router.replace('/');

      // Start fast travel sequence
      setIsTransitioning(true);

      setTimeout(() => {
        // Change to cave location
        setCurrentLocation('cave');

        // Change music if needed (cave has different music!)
        if (audioElement && LOCATIONS['cave'].musicPath !== LOCATIONS[currentLocation].musicPath) {
          const targetVolume = masterVolume * LOCATIONS['cave'].musicVolume;

          // Fade out current music
          const fadeOut = setInterval(() => {
            if (audioElement.volume > 0.05) {
              audioElement.volume = Math.max(0, audioElement.volume - 0.05);
            } else {
              clearInterval(fadeOut);
              audioElement.pause();

              // Switch to new music
              audioElement.src = LOCATIONS['cave'].musicPath;
              audioElement.volume = 0;

              audioElement.play()
                .then(() => {
                  console.log(`🎵 Playing ${LOCATIONS['cave'].musicPath.split('/').pop()} from beginning`);

                  // Fade in new music
                  const fadeIn = setInterval(() => {
                    if (audioElement.volume < targetVolume - 0.05) {
                      audioElement.volume = Math.min(targetVolume, audioElement.volume + 0.05);
                    } else {
                      audioElement.volume = targetVolume;
                      clearInterval(fadeIn);
                    }
                  }, 50);
                })
                .catch(err => console.error('Error playing music:', err));
            }
          }, 50);
        }

        // Open breed UI with staking tab after screen fades
        setTimeout(() => {
          setBreedStakeTab('stake');
          openBreed();
          setIsTransitioning(false);
          console.log('✨ Fast travel complete - staking UI opened');
        }, 600);
      }, 400);
    }
  }, [searchParams, audioElement, currentLocation, masterVolume, router, openBreed]);

  // Fast travel to jail (triggered by inventory jail button)
  useEffect(() => {
    const shouldFastTravel = searchParams.get('fastTravelJail') === 'true';

    if (shouldFastTravel) {
      console.log('⚡ Fast travel to jail triggered!');

      // Clear the query param
      router.replace('/');

      // Start fast travel sequence
      setIsTransitioning(true);

      setTimeout(() => {
        // Change to jailhouse location
        setCurrentLocation('jailhouse');

        // Change music if needed
        if (audioElement && LOCATIONS['jailhouse'].musicPath !== LOCATIONS[currentLocation].musicPath) {
          const targetVolume = masterVolume * LOCATIONS['jailhouse'].musicVolume;

          // Fade out current music
          const fadeOut = setInterval(() => {
            if (audioElement.volume > 0.05) {
              audioElement.volume = Math.max(0, audioElement.volume - 0.05);
            } else {
              clearInterval(fadeOut);
              audioElement.pause();

              // Switch to new music
              audioElement.src = LOCATIONS['jailhouse'].musicPath;
              audioElement.volume = 0;

              audioElement.play()
                .then(() => {
                  console.log(`🎵 Playing ${LOCATIONS['jailhouse'].musicPath.split('/').pop()} from beginning`);

                  // Fade in new music
                  const fadeIn = setInterval(() => {
                    if (audioElement.volume < targetVolume - 0.05) {
                      audioElement.volume = Math.min(targetVolume, audioElement.volume + 0.05);
                    } else {
                      audioElement.volume = targetVolume;
                      clearInterval(fadeIn);
                    }
                  }, 50);
                })
                .catch(err => console.error('Error playing music:', err));
            }
          }, 50);
        }

        // Open jail UI after screen fades
        setTimeout(() => {
          setShowJail(true);
          setIsTransitioning(false);
          console.log('✨ Fast travel complete - jail UI opened');
        }, 600);
      }, 400);
    }
  }, [searchParams, audioElement, currentLocation, masterVolume, router]);

  // Fast travel to mountain hut and open prediction market (triggered by /blackjack page)
  useEffect(() => {
    const shouldFastTravel = searchParams.get('fastTravelPrediction') === 'true';
    const gameIdParam = searchParams.get('gameId');

    if (shouldFastTravel) {
      console.log('⚡ Fast travel to mountain hut (prediction market) triggered!');

      // Set shared game ID if provided (for direct navigation to specific game)
      if (gameIdParam) {
        setSharedGameId(BigInt(gameIdParam));
        console.log(`🎮 Opening specific game: #${gameIdParam}`);
      } else {
        setSharedGameId(null);
      }

      // Clear the query param
      router.replace('/');

      // Start fast travel sequence
      setIsTransitioning(true);

      setTimeout(() => {
        // Change to mountainhut location
        setCurrentLocation('mountainhut');

        // Change music if needed
        if (audioElement && LOCATIONS['mountainhut'].musicPath !== LOCATIONS[currentLocation].musicPath) {
          const targetVolume = masterVolume * LOCATIONS['mountainhut'].musicVolume;

          // Fade out current music
          const fadeOut = setInterval(() => {
            if (audioElement.volume > 0.05) {
              audioElement.volume = Math.max(0, audioElement.volume - 0.05);
            } else {
              clearInterval(fadeOut);
              audioElement.pause();

              // Switch to new music
              audioElement.src = LOCATIONS['mountainhut'].musicPath;
              audioElement.volume = 0;

              audioElement.play()
                .then(() => {
                  console.log(`🎵 Playing ${LOCATIONS['mountainhut'].musicPath.split('/').pop()} from beginning`);

                  // Fade in new music
                  const fadeIn = setInterval(() => {
                    if (audioElement.volume < targetVolume - 0.05) {
                      audioElement.volume = Math.min(targetVolume, audioElement.volume + 0.05);
                    } else {
                      audioElement.volume = targetVolume;
                      clearInterval(fadeIn);
                    }
                  }, 50);
                })
                .catch(err => console.error('Error playing music:', err));
            }
          }, 50);
        }

        // Open PredictionJack UI after screen fades
        setTimeout(() => {
          openPredictionJack();
          setIsTransitioning(false);
          console.log('✨ Fast travel complete - prediction market opened');
        }, 600);
      }, 400);
    }
  }, [searchParams, audioElement, currentLocation, masterVolume, router, openPredictionJack]);

  // Handle opening shop with wrap tab from inventory
  useEffect(() => {
    const shouldOpenShopWrap = searchParams.get('openShopWrap') === 'true';
    if (shouldOpenShopWrap) {
      console.log('🛍️ Opening shop with wrap tab');

      // Clear the query param
      router.replace('/');

      // Set shop tab to wrap and open the shop
      setShopTab('wrap');
      openSwapMint();

      console.log('✨ Shop opened with wrap tab');
    }
  }, [searchParams, router, openSwapMint]);

  // Handle location changes with fade-to-black transition and music switching
  const navigateToLocation = (newLocation: LocationId) => {
    setShowChat(false); // Close chat when navigating
    setCurrentCharacter(''); // Clear current character when navigating
    setShowSwapMint(false); // Close swap mint interface when navigating
    setShowHatch(false); // Close hatch interface when navigating
    setIsTransitioning(true);

    // Change music if different from current location
    if (audioElement && LOCATIONS[newLocation].musicPath !== LOCATIONS[currentLocation].musicPath) {
      const targetVolume = masterVolume * LOCATIONS[newLocation].musicVolume;
      const currentVolume = audioElement.volume;
      const fadeSteps = 20; // Number of fade steps
      const fadeInterval = 10; // ms between steps

      // Fade out old music during first 200ms
      let step = 0;
      const fadeOutInterval = setInterval(() => {
        step++;
        const progress = step / fadeSteps;
        audioElement.volume = currentVolume * (1 - progress);

        if (step >= fadeSteps) {
          clearInterval(fadeOutInterval);

          // Change track at the darkest point (200ms mark)
          audioElement.pause();
          audioElement.currentTime = 0; // Reset to beginning
          audioElement.src = LOCATIONS[newLocation].musicPath;
          audioElement.volume = 0;

          // Start playing new track
          audioElement.play()
            .then(() => {
              console.log(`🎵 Playing ${LOCATIONS[newLocation].musicPath.split('/').pop()} from beginning`);

              // Fade in new music during next 200ms
              let fadeInStep = 0;
              const fadeInInterval = setInterval(() => {
                fadeInStep++;
                const fadeInProgress = fadeInStep / fadeSteps;
                audioElement.volume = targetVolume * fadeInProgress;

                if (fadeInStep >= fadeSteps) {
                  clearInterval(fadeInInterval);
                  audioElement.volume = targetVolume;
                }
              }, fadeInterval);
            })
            .catch((e) => console.log('Audio play error:', e));
        }
      }, fadeInterval);
    }

    // Fade to black (200ms), change location at peak, then fade from black (200ms)
    setTimeout(() => {
      setCurrentLocation(newLocation);
      setTimeout(() => {
        setIsTransitioning(false);
      }, 50);
    }, 200);
  };


  // Cycle with transitions where celestial bodies never overlap
  useEffect(() => {
    const cycles: { phase: TimeOfDay; duration: number }[] = [
      { phase: 'day', duration: 12000 },        // 12s daytime - sun visible
      { phase: 'sunset', duration: 5000 },      // 5s sunset - sun sets and fades out
      { phase: 'dusk', duration: 2000 },        // 2s dusk - neither visible, color transition
      { phase: 'moonrise', duration: 5000 },    // 5s moonrise - moon rises and fades in
      { phase: 'night', duration: 12000 },      // 12s nighttime - moon visible
      { phase: 'moonset', duration: 5000 },     // 5s moonset - moon sets and fades out
      { phase: 'dawn', duration: 2000 },        // 2s dawn - neither visible, color transition
      { phase: 'sunrise', duration: 5000 },     // 5s sunrise - sun rises and fades in
    ];

    let currentIndex = 0;

    const scheduleNext = () => {
      const current = cycles[currentIndex];
      setTimeOfDay(current.phase);

      setTimeout(() => {
        currentIndex = (currentIndex + 1) % cycles.length;
        scheduleNext();
      }, current.duration);
    };

    scheduleNext();
  }, []);

  // Occasional spooky effects in the cave
  useEffect(() => {
    if (currentLocation === 'cave') {
      const triggerSpooky = () => {
        setIsSpooky(true);
        setTimeout(() => setIsSpooky(false), 1500); // Spooky effect lasts 1.5 seconds
      };

      // Trigger spooky effect every 8-15 seconds (random)
      const scheduleNext = () => {
        const delay = 8000 + Math.random() * 7000; // Random between 8-15 seconds
        setTimeout(() => {
          triggerSpooky();
          scheduleNext();
        }, delay);
      };

      scheduleNext();
    } else {
      setIsSpooky(false);
    }
  }, [currentLocation]);

  // Calculate opacity for each gradient layer based on current phase
  const getLayerOpacity = (layer: TimeOfDay): number => {
    if (timeOfDay === layer) return 1;
    return 0;
  };

  // Determine animation class for sun
  const getSunAnimationClass = (): string => {
    if (timeOfDay === 'sunrise') return 'animate-sun-rise';
    if (timeOfDay === 'day') return 'animate-sun-idle';
    if (timeOfDay === 'sunset') return 'animate-sun-set';
    // During dusk, moonrise, night, moonset, dawn - sun stays below mountains
    return 'animate-sun-hidden';
  };

  // Determine animation class for moon
  const getMoonAnimationClass = (): string => {
    if (timeOfDay === 'moonrise') return 'animate-moon-rise';
    if (timeOfDay === 'night') return 'animate-moon-idle';
    if (timeOfDay === 'moonset') return 'animate-moon-set';
    // During dawn, sunrise, day, sunset, dusk - moon stays below mountains
    return 'animate-moon-hidden';
  };

  // Town sprite animation - cycle through frames every 0.6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTownFrame((prevFrame) => (prevFrame + 1) % 4); // Cycle 0 -> 1 -> 2 -> 3 -> 0
    }, 600); // 0.6 seconds per frame

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  // Get current town sprite image filename
  const getTownSprite = (): string => {
    if (townFrame === 0) return '/Images/Town.png';
    return `/Images/Town${townFrame}.png`; // Town1.png, Town2.png, Town3.png
  };

  // WizardHouse sprite animation - cycle through frames every 0.6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setWizardHouseFrame((prevFrame) => (prevFrame + 1) % 4); // Cycle 0 -> 1 -> 2 -> 3 -> 0
    }, 600); // 0.6 seconds per frame

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  // Get current WizardHouse sprite image filename
  const getWizardHouseSprite = (): string => {
    if (wizardHouseFrame === 0) return '/Images/WizardHouse.png';
    return `/Images/WizardHouse${wizardHouseFrame}.png`; // WizardHouse1.png, WizardHouse2.png, WizardHouse3.png
  };

  // MountainHut - static image (no sprite animation files available)
  const getMountainHutSprite = (): string => {
    return '/Images/MountainHut.png';
  };

  // Generate stable snow particle configurations to prevent glitchiness
  const snowParticles = useMemo(() => {
    return Array.from({ length: 50 }, (_, i) => ({
      key: i,
      left: Math.random() * 100,
      duration: 8 + Math.random() * 10,
      delay: -Math.random() * 15,
      opacity: Math.random() * 0.8 + 0.2,
    }));
  }, []); // Empty dependency array means this only runs once

  return (
    <main className="relative w-full h-[calc(100vh-64px)]" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
      {/* Base gradient layers - behind everything */}
      {/* Day gradient - clear blue sky */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(65, 140, 240, 0.7) 0%, rgba(90, 170, 255, 0.6) 50%, rgba(120, 190, 255, 0.5) 100%)',
          opacity: getLayerOpacity('day'),
        }}
      />

      {/* Sunset gradient - warm oranges and pinks */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(255, 180, 100, 0.4) 0%, rgba(255, 140, 80, 0.5) 30%, rgba(255, 100, 100, 0.6) 60%, rgba(200, 80, 120, 0.5) 100%)',
          opacity: getLayerOpacity('sunset'),
        }}
      />

      {/* Dusk gradient - transition from warm to dark */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(80, 60, 100, 0.6) 0%, rgba(40, 30, 60, 0.7) 50%, rgba(20, 15, 40, 0.75) 100%)',
          opacity: getLayerOpacity('dusk'),
        }}
      />

      {/* Moonrise gradient - moon rising into dark sky */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(20, 15, 40, 0.75) 0%, rgba(15, 10, 30, 0.8) 50%, rgba(10, 5, 20, 0.85) 100%)',
          opacity: getLayerOpacity('moonrise'),
        }}
      />

      {/* Night gradient - deep dark sky */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(10, 15, 35, 0.8) 0%, rgba(5, 10, 25, 0.85) 50%, rgba(0, 5, 15, 0.9) 100%)',
          opacity: getLayerOpacity('night'),
        }}
      />

      {/* Moonset gradient - moon setting, dark sky */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(10, 5, 20, 0.85) 0%, rgba(15, 10, 30, 0.8) 50%, rgba(20, 15, 40, 0.75) 100%)',
          opacity: getLayerOpacity('moonset'),
        }}
      />

      {/* Dawn gradient - transition from dark to warm */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(40, 30, 60, 0.7) 0%, rgba(80, 50, 80, 0.6) 50%, rgba(120, 80, 100, 0.5) 100%)',
          opacity: getLayerOpacity('dawn'),
        }}
      />

      {/* Sunrise gradient - warm orange transitioning to cool blue */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-[3000ms] ease-in-out"
        style={{
          background: 'linear-gradient(to bottom, rgba(255, 160, 100, 0.4) 0%, rgba(255, 180, 120, 0.35) 25%, rgba(200, 180, 160, 0.3) 50%, rgba(160, 200, 220, 0.35) 75%, rgba(135, 206, 235, 0.4) 100%)',
          opacity: getLayerOpacity('sunrise'),
        }}
      />

      {/* Celestial bodies - positioned in upper left, behind backgrounds - NOT shown in cave */}
      {currentLocation !== 'cave' && (
        <div className="absolute left-8 top-8 z-10 w-32 h-32">
          {/* Sun - rises above mountains during sunrise/day/sunset, stays below otherwise */}
          <div className={`absolute inset-0 ${getSunAnimationClass()}`}>
            <img
              src="/Images/Sun.png"
              alt="Sun"
              className="w-full h-full drop-shadow-2xl"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(255, 200, 0, 0.8))',
              }}
            />
          </div>

          {/* Moon - rises above mountains during moonrise/night/moonset, stays below otherwise */}
          <div className={`absolute inset-0 ${getMoonAnimationClass()}`}>
            <img
              src="/Images/Moon.png"
              alt="Moon"
              className="w-full h-full drop-shadow-2xl"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(200, 200, 255, 0.8))',
              }}
            />
          </div>
        </div>
      )}

      {/* Base Background - WebBackground.png always visible on main */}
      {currentLocation === 'main' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/WebBackground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Small Mountain Image - responsive sizing with aspect ratio preservation */}
      {currentLocation === 'main' && (
        <div
          className="absolute z-30"
          style={{
            top: '47%',
            left: '54%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(100px, min(18.15vw, 18.15vh), 280px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('mountain')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Explore the Mountain"
          >
            <img
              src="/Images/Mountain.png"
              alt="Mountain"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
              }}
            />
          </div>
        </div>
      )}

      {/* Cave Entrance - responsive sizing with aspect ratio preservation */}
      {currentLocation === 'main' && (
        <div
          className="absolute z-30"
          style={{
            top: '62%',
            left: '80%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(35px, min(5.83vw, 5.83vh), 95px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('cave')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Enter the Cave"
          >
            <img
              src="/Images/Cave.png"
              alt="Cave"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'brightness(1.15) drop-shadow(0 0 8px rgba(147, 51, 234, 0.4))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'brightness(1.15) drop-shadow(0 0 20px rgba(147, 51, 234, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'brightness(1.15) drop-shadow(0 0 8px rgba(147, 51, 234, 0.4))';
              }}
            />
          </div>
        </div>
      )}

      {/* Town - responsive sizing with aspect ratio preservation (same size as mountain) */}
      {currentLocation === 'main' && (
        <div
          className="absolute z-30"
          style={{
            top: '70%',
            left: '48%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(100px, min(18.15vw, 18.15vh), 280px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('town')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Visit the Town"
          >
            <img
              src={getTownSprite()}
              alt="Town"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
              }}
            />
          </div>
        </div>
      )}

      {/* Mountain location background - SnowCaps.png full screen */}
      {currentLocation === 'mountain' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/SnowCaps.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Meteor location background - SnowBlind.png full screen */}
      {currentLocation === 'meteor' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/SnowBlind.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Cave location background - CaveBackground.png full screen */}
      {currentLocation === 'cave' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/CaveBackground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Town location background - TownBackground.png full screen */}
      {currentLocation === 'town' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/TownBackground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* JailHouse location background - GreenScreen.png full screen */}
      {currentLocation === 'jailhouse' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/GreenScreen.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Store location background - StoreBackground.png full screen */}
      {currentLocation === 'store' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/StoreBackground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Wizard House location background - WizardHouseBackground.png full screen */}
      {currentLocation === 'wizardhouse' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/WizardHouseBackground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Mountain Hut location background - MountianHutBackground.png */}
      {currentLocation === 'mountainhut' && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/MountianHutBackground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* JailHouse in Town - positioned far left, lower for culdesac vibe */}
      {currentLocation === 'town' && (
        <div
          className="absolute z-30"
          style={{
            top: '60%',
            left: '15%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(120px, min(20vw, 20vh), 320px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('jailhouse')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Jail House"
          >
            <img
              src="/Images/Jailhouse.png"
              alt="Jail House"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
              }}
            />
          </div>
        </div>
      )}

      {/* TownStore in Town - positioned far right, lower for culdesac vibe */}
      {currentLocation === 'town' && (
        <div
          className="absolute z-30"
          style={{
            top: '60%',
            left: '85%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(120px, min(20vw, 20vh), 320px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('store')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Town Store"
          >
            <img
              src="/Images/TownStore.png"
              alt="Town Store"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
              }}
            />
          </div>
        </div>
      )}

      {/* WizardHouse in Town - positioned in the middle with animated sprite, 30% bigger and higher up */}
      {currentLocation === 'town' && (
        <div
          className="absolute z-30"
          style={{
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(156px, min(26vw, 26vh), 416px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('wizardhouse')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Wizard House"
          >
            <img
              src={getWizardHouseSprite()}
              alt="Wizard House"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
              }}
            />
          </div>
        </div>
      )}

      {/* Warden - character sprite positioned left of jailhouse, behind desk */}
      {currentLocation === 'jailhouse' && (
        <div
          className="absolute cursor-pointer transition-all duration-300"
          onClick={() => {
            setCurrentCharacter('Warden');
            if (!showChat) {
              openChat();
            } else {
              setShowChat(false);
            }
          }}
          style={{
            zIndex: 25,
            top: '46%',
            left: '28%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(132px, 22vw, 352px)',
            aspectRatio: '1 / 1',
          }}
          onMouseEnter={(e) => {
            const img = e.currentTarget.querySelector('img');
            if (img) {
              (img as HTMLImageElement).style.filter = 'drop-shadow(0 0 20px rgba(34, 197, 94, 0.8))';
              (img as HTMLImageElement).style.transform = 'scale(1.1)';
            }
          }}
          onMouseLeave={(e) => {
            const img = e.currentTarget.querySelector('img');
            if (img) {
              (img as HTMLImageElement).style.filter = 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))';
              (img as HTMLImageElement).style.transform = 'scale(1)';
            }
          }}
        >
          <img
            src="/Images/Warden.png"
            alt="Warden"
            className="w-full h-full object-contain transition-all duration-300"
            style={{
              filter: 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))',
            }}
          />
        </div>
      )}

      {/* Warden Desk - positioned in front of warden, layered behind jailhouse */}
      {currentLocation === 'jailhouse' && (
        <div
          className="absolute pointer-events-none"
          style={{
            zIndex: 26,
            top: '58%',
            left: '28%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(144px, 28.8vw, 384px)',
            aspectRatio: '1 / 1',
          }}
        >
          <img
            src="/Images/JailhouseDesk.png"
            alt="Jail House Desk"
            className="w-full h-full object-contain"
          />
        </div>
      )}

      {/* JailHouseLarge in JailHouse location - moved 10% to the right, layered over desk */}
      {currentLocation === 'jailhouse' && (
        <div
          className="absolute z-30"
          style={{
            top: '50%',
            left: '60%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(300px, 60vw, 800px)',
            aspectRatio: '1 / 1',
          }}
        >
          <img
            src="/Images/JailhouseLarge.png"
            alt="Jail House Large"
            className="w-full h-full object-contain"
          />
        </div>
      )}

      {/* Store Shopkeep - character sprite positioned in store */}
      {currentLocation === 'store' && (
        <div
          className="absolute cursor-pointer transition-all duration-300"
          onClick={() => {
            setCurrentCharacter('Shopkeeper');
            if (!showChat) {
              openChat();
            } else {
              setShowChat(false);
            }
          }}
          style={{
            zIndex: 25,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(1)',
            width: 'clamp(132px, min(22vw, 22vh), 352px)',
            aspectRatio: '1 / 1',
            backgroundImage: 'url(/Images/StoreShopkeep.png)',
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(34, 197, 94, 0.8))';
            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))';
            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
          }}
        />
      )}

      {/* Store Foreground - overlay on storebackground */}
      {currentLocation === 'store' && (
        <div
          className="absolute inset-0 z-30 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/StoreForeground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Wizard - character sprite positioned in wizard house */}
      {currentLocation === 'wizardhouse' && (
        <div
          className="absolute cursor-pointer transition-all duration-300"
          onClick={() => {
            setCurrentCharacter('Wizard');
            if (!showChat) {
              openChat();
            } else {
              setShowChat(false);
            }
          }}
          style={{
            zIndex: 25,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(1)',
            width: 'clamp(132px, min(22vw, 22vh), 352px)',
            aspectRatio: '1 / 1',
            backgroundImage: 'url(/Images/Wizard.png)',
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(34, 197, 94, 0.8))';
            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))';
            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
          }}
        />
      )}

      {/* Mountain Man - character sprite positioned in mountain hut */}
      {currentLocation === 'mountainhut' && (
        <div
          className="absolute cursor-pointer transition-all duration-300"
          onClick={() => {
            setCurrentCharacter('MountainMan');
            if (!showChat) {
              openChat();
            } else {
              setShowChat(false);
            }
          }}
          style={{
            zIndex: 25,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(1)',
            width: 'clamp(132px, min(22vw, 22vh), 352px)',
            aspectRatio: '1 / 1',
            backgroundImage: 'url(/Images/MountainGuy.png)',
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(34, 197, 94, 0.8))';
            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))';
            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
          }}
        />
      )}

      {/* Wizard House Foreground - overlay on wizardhousebackground */}
      {currentLocation === 'wizardhouse' && (
        <div
          className="absolute inset-0 z-30 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/WizardHouseForeground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Mountain Hut Foreground - overlay on MountianHutBackground */}
      {currentLocation === 'mountainhut' && (
        <div
          className="absolute inset-0 z-30 pointer-events-none"
          style={{
            backgroundImage: 'url(/Images/MountianHutForeground.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Wilfred - character sprite positioned on left side of cave, 2x bigger */}
      {currentLocation === 'cave' && (
        <div
          className="absolute cursor-pointer transition-all duration-300"
          onClick={() => {
            setCurrentCharacter('Wilfred');
            if (!showChat) {
              openChat();
            } else {
              setShowChat(false);
            }
          }}
          style={{
            zIndex: 25,
            top: '75%',
            left: '0%',
            transform: 'translateY(-50%) scaleX(-1) scale(1)',
            width: 'clamp(264px, min(44vw, 44vh), 704px)',
            aspectRatio: '1 / 1',
            backgroundImage: 'url(/Images/Wilfred.png)',
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(34, 197, 94, 0.8))';
            e.currentTarget.style.transform = 'translateY(-50%) scaleX(-1) scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(34, 197, 94, 0))';
            e.currentTarget.style.transform = 'translateY(-50%) scaleX(-1) scale(1)';
          }}
        />
      )}

      {/* Mountain Weather Effects - Snow and Strong Hazy Gradient - Hidden when UI overlays are active */}
      {currentLocation === 'mountain' && !showPredictionJack && (
        <>
          {/* Falling snow particles - z-30 to stay below UI overlays */}
          <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
            {snowParticles.map((particle) => (
              <div
                key={`snow-${particle.key}`}
                className="absolute animate-snow"
                style={{
                  left: `${particle.left}%`,
                  animationDuration: `${particle.duration}s`,
                  animationDelay: `${particle.delay}s`,
                  width: '4px',
                  height: '4px',
                  background: 'white',
                  borderRadius: '50%',
                  opacity: particle.opacity,
                  boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)',
                }}
              />
            ))}
          </div>

          {/* Strong hazy gray gradient overlay to dim sun/moon gradients */}
          <div className="absolute inset-0 z-25 pointer-events-none bg-gradient-to-b from-gray-500/70 via-gray-600/60 to-gray-700/50" />
        </>
      )}

      {/* Meteor Location Weather Effects - Snow and Strong Hazy Gradient - Hidden when UI overlays are active */}
      {currentLocation === 'meteor' && !showPredictionJack && (
        <>
          {/* Falling snow particles - z-30 to stay below UI overlays */}
          <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
            {snowParticles.map((particle) => (
              <div
                key={`meteor-snow-${particle.key}`}
                className="absolute animate-snow"
                style={{
                  left: `${particle.left}%`,
                  animationDuration: `${particle.duration}s`,
                  animationDelay: `${particle.delay}s`,
                  width: '4px',
                  height: '4px',
                  background: 'white',
                  borderRadius: '50%',
                  opacity: particle.opacity,
                  boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)',
                }}
              />
            ))}
          </div>

          {/* Strong hazy gray gradient overlay to dim sun/moon gradients */}
          <div className="absolute inset-0 z-25 pointer-events-none bg-gradient-to-b from-gray-500/70 via-gray-600/60 to-gray-700/50" />
        </>
      )}

      {/* Cave Ambiance - Dark dim atmosphere with shifting spooky effects - Hidden when UI overlays are active */}
      {currentLocation === 'cave' && !showPredictionJack && (
        <>
          {/* Dark cave base ambiance with shifting effect - replaces sun/moon lighting */}
          <div
            className="absolute inset-0 z-30 pointer-events-none animate-cave-shift"
            style={{
              background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.75) 0%, rgba(0, 0, 0, 0.85) 25%, rgba(31, 41, 55, 0.7) 50%, rgba(0, 0, 0, 0.8) 75%, rgba(17, 24, 39, 0.78) 100%)'
            }}
          />

          {/* Occasional spooky flickering darkness effect */}
          {isSpooky && (
            <div
              className="absolute inset-0 z-35 pointer-events-none animate-spooky-flicker"
              style={{
                background: 'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.5) 100%)'
              }}
            />
          )}
        </>
      )}

      {/* Meteor crater and meteor overlay on meteor location page - responsive sizing with aspect ratio preservation */}
      {currentLocation === 'meteor' && (
        <div
          className="absolute z-30"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(300px, min(79.2vw, 85vh), 1200px)',
            aspectRatio: '1 / 1',
          }}
        >
          {/* Meteor Crater Base */}
          <img
            src="/Images/meteorcrater.png"
            alt="Meteor Crater"
            className="absolute inset-0 w-full h-full object-contain"
          />
          {/* Meteor overlaid on top of crater */}
          <img
            src="/Images/meteor.png"
            alt="Meteor"
            className="absolute inset-0 w-full h-full object-contain"
          />
        </div>
      )}

      {/* Mountain Hut on Mountain - positioned on the left side, 10% smaller and moved down 20% */}
      {currentLocation === 'mountain' && (
        <div
          className="absolute z-30"
          style={{
            top: '75%',
            left: '20%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(108px, min(18vw, 18vh), 270px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('mountainhut')}
            className="cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 w-full h-full"
            title="Mountain Hut"
          >
            <img
              src={getMountainHutSprite()}
              alt="Mountain Hut"
              className="w-full h-full object-contain transition-all duration-300"
              style={{
                filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
              }}
            />
          </div>
        </div>
      )}

      {/* Meteor Crater on Mountain - responsive sizing with aspect ratio preservation */}
      {currentLocation === 'mountain' && (
        <div
          className="absolute z-30"
          style={{
            top: '55%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(180px, min(33vw, 33vh), 500px)',
            aspectRatio: '1 / 1',
          }}
        >
          <div
            onClick={() => navigateToLocation('meteor')}
            className="cursor-pointer w-full h-full relative"
            title="Explore the Meteor Crater"
          >
            {/* Meteor Crater Base - static, no hover effects */}
            <img
              src="/Images/meteorcrater.png"
              alt="Meteor Crater"
              className="absolute inset-0 w-full h-full object-contain"
            />
            {/* Meteor on top of crater - scales and glows on hover */}
            <div className="absolute inset-0 transition-all duration-300 hover:scale-110 active:scale-95">
              <img
                src="/Images/meteor.png"
                alt="Meteor"
                className="w-full h-full object-contain transition-all duration-300"
                style={{
                  filter: 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(59, 130, 246, 0))';
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Back button - show when not on main location and prediction market is not open */}
      {currentLocation !== 'main' && !showPredictionJack && (
        <button
          onClick={() => {
            if (currentLocation === 'meteor' || currentLocation === 'mountainhut') {
              navigateToLocation('mountain');
            } else if (currentLocation === 'jailhouse' || currentLocation === 'store' || currentLocation === 'wizardhouse') {
              navigateToLocation('town');
            } else {
              navigateToLocation('main');
            }
          }}
          className="absolute top-4 left-4 z-50 bg-black/50 hover:bg-black/70 text-white px-6 py-3 rounded-lg transition-all duration-300 hover:scale-105 backdrop-blur-sm"
        >
          ← Back to {currentLocation === 'meteor' || currentLocation === 'mountainhut' ? 'Mountain' : (currentLocation === 'jailhouse' || currentLocation === 'store' || currentLocation === 'wizardhouse') ? 'Town' : currentLocation === 'mountain' ? 'Village' : currentLocation === 'cave' ? 'Village' : currentLocation === 'town' ? 'Village' : 'Village'}
        </button>
      )}

      {/* Location Display at Bottom Left - Enhanced Futuristic Style */}
      <div className="absolute bottom-3 left-3 z-50 bg-gradient-to-br from-slate-900/40 to-slate-950/50 backdrop-blur-lg px-5 py-2.5 rounded-xl border border-cyan-400/20"
           style={{
             boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(6, 182, 212, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
           }}>
        <p className="text-cyan-50 text-sm font-semibold tracking-wider"
           style={{
             textShadow: '0 0 10px rgba(6, 182, 212, 0.5), 0 1px 2px rgba(0, 0, 0, 0.8)',
           }}>
          {LOCATIONS[currentLocation].name}
        </p>
      </div>

      {/* Fade to black transition overlay */}
      <div
        className="absolute inset-0 z-[100] bg-black pointer-events-none transition-opacity duration-200"
        style={{
          opacity: isTransitioning ? 1 : 0,
        }}
      />

      {/* Subtle color overlay on top of background for tinting - NOT shown in indoor locations (cave, jailhouse, store, wizardhouse, mountainhut) */}
      {/* Day tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && currentLocation !== 'mountainhut' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(135, 206, 235, 0.15) 0%, rgba(255, 218, 185, 0.1) 100%)',
            opacity: getLayerOpacity('day'),
          }}
        />
      )}

      {/* Sunset tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(255, 165, 0, 0.2) 0%, rgba(255, 99, 71, 0.25) 50%, rgba(147, 112, 219, 0.2) 100%)',
            opacity: getLayerOpacity('sunset'),
          }}
        />
      )}

      {/* Dusk tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(60, 40, 80, 0.2) 0%, rgba(30, 20, 50, 0.25) 100%)',
            opacity: getLayerOpacity('dusk'),
          }}
        />
      )}

      {/* Moonrise tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(15, 10, 30, 0.25) 0%, rgba(5, 5, 20, 0.3) 100%)',
            opacity: getLayerOpacity('moonrise'),
          }}
        />
      )}

      {/* Night tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(10, 15, 35, 0.3) 0%, rgba(0, 5, 15, 0.4) 100%)',
            opacity: getLayerOpacity('night'),
          }}
        />
      )}

      {/* Moonset tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(5, 5, 20, 0.3) 0%, rgba(15, 10, 30, 0.25) 100%)',
            opacity: getLayerOpacity('moonset'),
          }}
        />
      )}

      {/* Dawn tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(30, 20, 50, 0.25) 0%, rgba(80, 50, 80, 0.2) 50%, rgba(120, 80, 100, 0.15) 100%)',
            opacity: getLayerOpacity('dawn'),
          }}
        />
      )}

      {/* Sunrise tint */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && (
        <div
          className="absolute inset-0 z-35 transition-opacity duration-[4000ms] ease-in-out pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(100, 50, 100, 0.15) 0%, rgba(255, 140, 100, 0.12) 70%, rgba(255, 200, 150, 0.08) 100%)',
            opacity: getLayerOpacity('sunrise'),
          }}
        />
      )}

      {/* Lighting overlay - 60% transparent (40% opacity) gradients as topmost layer - NOT shown in indoor locations or when PredictionJack is open */}
      {currentLocation !== 'cave' && currentLocation !== 'jailhouse' && currentLocation !== 'store' && currentLocation !== 'wizardhouse' && !showPredictionJack && (
        <>
          {/* Day lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(65, 140, 240, 0.28) 0%, rgba(90, 170, 255, 0.24) 50%, rgba(120, 190, 255, 0.20) 100%)',
              opacity: getLayerOpacity('day'),
            }}
          />

          {/* Sunset lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(255, 180, 100, 0.16) 0%, rgba(255, 140, 80, 0.20) 30%, rgba(255, 100, 100, 0.24) 60%, rgba(200, 80, 120, 0.20) 100%)',
              opacity: getLayerOpacity('sunset'),
            }}
          />

          {/* Dusk lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(80, 60, 100, 0.24) 0%, rgba(40, 30, 60, 0.28) 50%, rgba(20, 15, 40, 0.30) 100%)',
              opacity: getLayerOpacity('dusk'),
            }}
          />

          {/* Moonrise lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(20, 15, 40, 0.30) 0%, rgba(15, 10, 30, 0.32) 50%, rgba(10, 5, 20, 0.34) 100%)',
              opacity: getLayerOpacity('moonrise'),
            }}
          />

          {/* Night lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(10, 15, 35, 0.32) 0%, rgba(5, 10, 25, 0.34) 50%, rgba(0, 5, 15, 0.36) 100%)',
              opacity: getLayerOpacity('night'),
            }}
          />

          {/* Moonset lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(10, 5, 20, 0.34) 0%, rgba(15, 10, 30, 0.32) 50%, rgba(20, 15, 40, 0.30) 100%)',
              opacity: getLayerOpacity('moonset'),
            }}
          />

          {/* Dawn lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(40, 30, 60, 0.28) 0%, rgba(80, 50, 80, 0.24) 50%, rgba(120, 80, 100, 0.20) 100%)',
              opacity: getLayerOpacity('dawn'),
            }}
          />

          {/* Sunrise lighting */}
          <div
            className="absolute inset-0 z-50 transition-opacity duration-[3000ms] ease-in-out pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(255, 160, 100, 0.16) 0%, rgba(255, 180, 120, 0.14) 25%, rgba(200, 180, 160, 0.12) 50%, rgba(160, 200, 220, 0.14) 75%, rgba(135, 206, 235, 0.16) 100%)',
              opacity: getLayerOpacity('sunrise'),
            }}
          />
        </>
      )}

      {/* Warm candle-like lighting for indoor locations (jailhouse, store, wizardhouse, mountainhut) - positioned behind background to color windows */}
      {(currentLocation === 'wizardhouse' || currentLocation === 'mountainhut') && (
        <div
          className="absolute inset-0 z-15 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255, 200, 120, 0.25) 0%, rgba(255, 160, 100, 0.20) 25%, rgba(255, 140, 80, 0.15) 50%, rgba(200, 100, 60, 0.10) 75%, rgba(120, 60, 40, 0.05) 100%)',
          }}
        />
      )}

      {/* Warm candle-like lighting for indoor locations (jailhouse, store, wizardhouse, mountainhut) - topmost atmospheric layer - hidden when PredictionJack is open */}
      {(currentLocation === 'jailhouse' || currentLocation === 'store' || currentLocation === 'wizardhouse' || currentLocation === 'mountainhut') && !showPredictionJack && (
        <div
          className="absolute inset-0 z-50 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255, 180, 100, 0.15) 0%, rgba(255, 140, 80, 0.12) 30%, rgba(200, 100, 60, 0.08) 60%, rgba(80, 40, 20, 0.05) 100%)',
          }}
        />
      )}

      {/* Chat Interface Backdrop - click outside to close */}
      {showChat && (
        <div
          className="fixed inset-0 cursor-pointer"
          style={{
            zIndex: 99,
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
          }}
          onClick={() => setShowChat(false)}
        />
      )}

      {/* Chat Interface - wide rectangle at bottom with layering */}
      {showChat && (
        <div
          className="fixed animate-chat-float"
          style={{
            zIndex: 100,
            bottom: '0',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'clamp(320px, 90vw, 1000px)',
            height: 'clamp(64px, calc(90vw / 5), min(200px, 20vh))',
          }}
        >
          {/* Chat Interface Below - base layer */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 1,
              backgroundImage: 'url(/Images/ChatInterfaceBelow.png)',
              backgroundSize: '100% 100%',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          />

          {/* Character Head Profile Picture - far left */}
          {currentCharacter && (
            <div
              className="absolute pointer-events-none"
              style={{
                zIndex: 2,
                left: '8.5%',
                top: '49%',
                transform: 'translateY(-50%)',
                width: '12%',
                aspectRatio: '1 / 1',
                backgroundImage: `url(/Images/${currentCharacter}Head.png)`,
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }}
            />
          )}

          {/* Content layer - for future text/buttons */}
          <div
            className="absolute inset-0"
            style={{
              zIndex: 3,
            }}
          />

          {/* Character Name Text - top center */}
          {currentCharacter && (
            <div
              className="absolute pointer-events-none"
              style={{
                zIndex: 6,
                top: '15%',
                left: '50%',
                transform: 'translateX(-50%) rotate(-3.5deg)',
                fontSize: 'clamp(10px, 1.5vw, 18px)',
                fontWeight: 700,
                color: '#FFFFFF',
                textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
                letterSpacing: '0.05em',
              }}
            >
              {currentCharacter}
            </div>
          )}

          {/* Main Chat Text Area - below title, next to profile pic */}
          {currentCharacter && (
            <div
              className="absolute pointer-events-none"
              style={{
                zIndex: 6,
                top: '40%',
                left: '23%',
                right: '25%',
                fontSize: 'clamp(10px, 1.4vw, 16px)',
                fontWeight: 500,
                color: '#FFFFFF',
                textShadow: '1px 1px 3px rgba(0, 0, 0, 0.7)',
                lineHeight: '1.4',
                padding: '0 2%',
              }}
            >
              {currentCharacter === 'Shopkeeper' && nftsRemaining === 0
                ? 'Mint is sold out, but you can still swap tokens or wrap your NFTs!'
                : currentCharacter === 'Shopkeeper'
                ? `Hello traveler! Welcome to my shop. I've got ${nftsRemaining} NFTs for sale, would you like to have a look?`
                : currentCharacter === 'Wizard'
                ? 'I have a spell that can hatch your eggs. Do you have any eggs?'
                : currentCharacter === 'Warden'
                ? 'Be careful or you\'ll end up in here! Would you like to view the jail? ...Of course, a small donation could help you avoid any misunderstandings.'
                : currentCharacter === 'Wilfred'
                ? 'Welcome to my humble cave shop, traveler. The darkness here preserves my wares quite well. Care to browse what I have in stock?'
                : currentCharacter === 'MountainMan'
                ? 'Greetings, traveler! Would you like to play a fun game?'
                : 'Hello traveler! Welcome to my shop. I\'ve got all sorts of potions, tools, and magical items for sale. Let me know if anything catches your eye!'}
            </div>
          )}

          {/* Chat Action Button - right side */}
          {currentCharacter && characterButtons[currentCharacter] && (
            <div
              className="absolute cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95"
              onClick={() => {
                if (currentCharacter === 'Wizard') {
                  openHatch();
                } else if (currentCharacter === 'Warden') {
                  setShowJail(true);
                } else if (currentCharacter === 'Wilfred') {
                  openBreed();
                } else if (currentCharacter === 'MountainMan') {
                  openPredictionJack();
                } else {
                  openSwapMint();
                }
                setShowChat(false);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 20px rgba(168, 85, 247, 0.9))';
                e.currentTarget.style.boxShadow = '0 0 25px rgba(168, 85, 247, 0.6), inset 0 0 15px rgba(168, 85, 247, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(168, 85, 247, 0))';
                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.4)';
              }}
              style={{
                zIndex: 6,
                top: '60%',
                right: '8%',
                transform: 'translateY(-50%)',
                width: '15%',
                minWidth: '90px',
                maxWidth: '130px',
                aspectRatio: '2.5 / 1',
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.95) 0%, rgba(139, 92, 246, 0.95) 100%)',
                border: '2px solid rgba(216, 180, 254, 0.5)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'clamp(11px, 1.3vw, 15px)',
                fontWeight: 700,
                color: '#FFFFFF',
                textShadow: '1px 1px 3px rgba(0, 0, 0, 0.9), 0 0 10px rgba(168, 85, 247, 0.5)',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
                filter: 'drop-shadow(0 0 0px rgba(168, 85, 247, 0))',
              }}
            >
              {characterButtons[currentCharacter]}
            </div>
          )}

          {/* Chat Interface Above - top layer */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 4,
              backgroundImage: 'url(/Images/ChatInterfaceAbove.png)',
              backgroundSize: '100% 100%',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          />

          {/* Content interaction layer */}
          <div
            className="absolute inset-0"
            style={{
              zIndex: 5,
            }}
          />
        </div>
      )}

      {/* Swap Mint Interface Backdrop - click outside to close */}
      {showSwapMint && (
        <div
          className="fixed inset-0 cursor-pointer"
          style={{
            zIndex: 99,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
          }}
          onClick={() => setShowSwapMint(false)}
        />
      )}

      {/* Swap Mint Interface - centered modal */}
      {showSwapMint && (
        <div
          className="fixed"
          style={{
            zIndex: 100,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(280px, 92vw, 500px)',
            maxHeight: '90vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))',
            backgroundColor: 'rgba(17, 24, 39, 0.98)',
            border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
            borderRadius: 'clamp(10px, 2vw, 16px)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(6, 182, 212, 0.3), 0 0 100px rgba(168, 85, 247, 0.2), inset 0 0 30px rgba(168, 85, 247, 0.05)',
            padding: 'clamp(12px, 2.5vw, 20px)',
          }}
        >
          {/* Shimmer effect overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.1), transparent)',
              animation: 'shimmer 3s infinite',
              zIndex: 1,
            }}
          />

          {/* Content wrapper */}
          <div style={{ position: 'relative', zIndex: 2 }}>
          {/* NFTs Remaining Counter - only show in mint tab */}
          {shopTab === 'mint' && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: 'clamp(8px, 1.5vw, 12px) 0',
                marginBottom: 'clamp(8px, 1.5vw, 12px)',
              }}
            >
              <div
                style={{
                  padding: 'clamp(4px, 0.9vw, 6px) clamp(10px, 2vw, 14px)',
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(168, 85, 247, 0.2))',
                  border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.5)',
                  borderRadius: 'clamp(6px, 1.2vw, 8px)',
                  backdropFilter: 'blur(10px)',
                  boxShadow: '0 0 15px rgba(6, 182, 212, 0.3)',
                }}
              >
                <div
                  style={{
                    fontSize: 'clamp(11px, 2.2vw, 13px)',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    textAlign: 'center',
                  }}
                >
                  {nftsRemaining.toLocaleString()} NFTs left
                </div>
              </div>
            </div>
          )}

          {/* Shop Tabs */}
          <div style={{ display: 'flex', gap: 'clamp(6px, 1.2vw, 8px)', marginBottom: 'clamp(12px, 2.5vw, 16px)' }}>
            <button
              onClick={() => setShopTab('mint')}
              style={{
                flex: 1,
                padding: 'clamp(8px, 1.8vw, 12px)',
                borderRadius: 'clamp(8px, 1.5vw, 12px)',
                fontWeight: 700,
                fontSize: 'clamp(12px, 2.8vw, 16px)',
                border: shopTab === 'mint' ? 'clamp(1.5px, 0.3vw, 2px) solid rgba(168, 85, 247, 0.6)' : 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                background: shopTab === 'mint'
                  ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))'
                  : 'rgba(17, 24, 39, 0.8)',
                color: shopTab === 'mint' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: shopTab === 'mint' ? '0 0 15px rgba(168, 85, 247, 0.4)' : 'none',
              }}
            >
              {nftsRemaining > 0 ? '🐍 Swap to Mint' : '🪙 Swap Tokens'}
            </button>
            <button
              onClick={() => setShopTab('wrap')}
              style={{
                flex: 1,
                padding: 'clamp(8px, 1.8vw, 12px)',
                borderRadius: 'clamp(8px, 1.5vw, 12px)',
                fontWeight: 700,
                fontSize: 'clamp(12px, 2.8vw, 16px)',
                border: shopTab === 'wrap' ? 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.6)' : 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                background: shopTab === 'wrap'
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                  : 'rgba(17, 24, 39, 0.8)',
                color: shopTab === 'wrap' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: shopTab === 'wrap' ? '0 0 15px rgba(6, 182, 212, 0.4)' : 'none',
              }}
            >
              🪙 Manage NFTs
            </button>
          </div>

          {/* Mint/Swap Tab Content */}
          {shopTab === 'mint' && (
            <>
          {/* Swap Input Section */}
          <div
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.8)',
              borderRadius: 'clamp(12px, 2vw, 16px)',
              padding: 'clamp(12px, 2.5vw, 18px)',
              marginBottom: 'clamp(12px, 2vw, 16px)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'clamp(8px, 1.5vw, 12px)',
              }}
            >
              <span
                style={{
                  fontSize: 'clamp(11px, 2.2vw, 13px)',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontWeight: 600,
                }}
              >
                You Pay
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px, 1.2vw, 8px)' }}>
                <span
                  style={{
                    fontSize: 'clamp(10px, 2vw, 12px)',
                    color: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  Balance: {parseFloat(ethBalance).toFixed(4)} ETH
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.5vw, 12px)' }}>
              <input
                type="text"
                inputMode="decimal"
                value={ethAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  // Only allow numbers and decimals
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setEthAmount(value);
                  }
                }}
                placeholder="0.0"
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 'clamp(18px, 5vw, 28px)',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  width: '100%',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'clamp(6px, 1.2vw, 8px)',
                  padding: 'clamp(6px, 1.2vw, 8px) clamp(10px, 2vw, 14px)',
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  borderRadius: 'clamp(8px, 1.5vw, 12px)',
                  border: 'clamp(1px, 0.15vw, 1px) solid rgba(59, 130, 246, 0.4)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 'clamp(18px, 3.5vw, 24px)',
                    height: 'clamp(18px, 3.5vw, 24px)',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(99, 102, 241, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'clamp(10px, 2vw, 12px)',
                  }}
                >
                  Ξ
                </div>
                <span
                  style={{
                    fontSize: 'clamp(12px, 2.8vw, 16px)',
                    fontWeight: 700,
                    color: '#FFFFFF',
                  }}
                >
                  ETH
                </span>
              </div>
            </div>

            {/* Quick Mint Buttons */}
            {isWalletConnected && (
              <div style={{ display: 'flex', gap: 'clamp(3px, 0.6vw, 4px)', marginTop: 'clamp(6px, 1.2vw, 8px)', flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    try {
                      setIsLoadingQuote(true);
                      const ethNeeded = await calculateETHForNFTs(1);
                      setEthAmount(ethNeeded);
                      setIsLoadingQuote(false);
                    } catch (error) {
                      console.error('Failed to calculate ETH for 1 NFT:', error);
                      setIsLoadingQuote(false);
                    }
                  }}
                  disabled={isLoadingQuote}
                  style={{
                    padding: 'clamp(3px, 0.6vw, 4px) clamp(6px, 1.2vw, 8px)',
                    backgroundColor: 'rgba(251, 146, 60, 0.2)',
                    border: 'clamp(1px, 0.15vw, 1px) solid rgba(251, 146, 60, 0.4)',
                    borderRadius: 'clamp(4px, 0.8vw, 6px)',
                    fontSize: 'clamp(9px, 2vw, 11px)',
                    fontWeight: 600,
                    color: 'rgba(251, 146, 60, 1)',
                    cursor: isLoadingQuote ? 'not-allowed' : 'pointer',
                    opacity: isLoadingQuote ? 0.5 : 1,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoadingQuote) {
                      e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.2)';
                  }}
                >
                  {isLoadingQuote ? '...' : '1 NFT'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      setIsLoadingQuote(true);
                      const ethNeeded = await calculateETHForNFTs(10);
                      setEthAmount(ethNeeded);
                      setIsLoadingQuote(false);
                    } catch (error) {
                      console.error('Failed to calculate ETH for 10 NFTs:', error);
                      setIsLoadingQuote(false);
                    }
                  }}
                  disabled={isLoadingQuote}
                  style={{
                    padding: 'clamp(3px, 0.6vw, 4px) clamp(6px, 1.2vw, 8px)',
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    border: 'clamp(1px, 0.15vw, 1px) solid rgba(168, 85, 247, 0.4)',
                    borderRadius: 'clamp(4px, 0.8vw, 6px)',
                    fontSize: 'clamp(9px, 2vw, 11px)',
                    fontWeight: 600,
                    color: 'rgba(168, 85, 247, 1)',
                    cursor: isLoadingQuote ? 'not-allowed' : 'pointer',
                    opacity: isLoadingQuote ? 0.5 : 1,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoadingQuote) {
                      e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.2)';
                  }}
                >
                  {isLoadingQuote ? '...' : '10 NFTs'}
                </button>
                {(() => {
                  const tokenAmount = parseFloat(tokenEstimate || '0');
                  const fractionalPart = tokenAmount - Math.floor(tokenAmount);

                  // Show round-up button if they're within 0.3 tokens of the next NFT
                  if (tokenEstimate !== '0' && tokenEstimate !== '...' && tokenAmount > 0 && fractionalPart >= 0.7) {
                    return (
                      <button
                        onClick={async () => {
                          try {
                            setIsLoadingQuote(true);
                            const ethNeeded = await calculateETHForNFTs(Math.ceil(tokenAmount));
                            setEthAmount(ethNeeded);
                            setIsLoadingQuote(false);
                          } catch (error) {
                            console.error('Failed to calculate round-up:', error);
                            setIsLoadingQuote(false);
                          }
                        }}
                        disabled={isLoadingQuote}
                        style={{
                          padding: 'clamp(3px, 0.6vw, 4px) clamp(6px, 1.2vw, 8px)',
                          backgroundColor: 'rgba(251, 191, 36, 0.2)',
                          border: 'clamp(1px, 0.15vw, 1px) solid rgba(251, 191, 36, 0.5)',
                          borderRadius: 'clamp(4px, 0.8vw, 6px)',
                          fontSize: 'clamp(9px, 2vw, 11px)',
                          fontWeight: 600,
                          color: 'rgba(251, 191, 36, 1)',
                          cursor: isLoadingQuote ? 'not-allowed' : 'pointer',
                          opacity: isLoadingQuote ? 0.5 : 1,
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isLoadingQuote) {
                            e.currentTarget.style.backgroundColor = 'rgba(251, 191, 36, 0.3)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(251, 191, 36, 0.2)';
                        }}
                      >
                        {isLoadingQuote ? '...' : `Round up to ${Math.ceil(tokenAmount)} NFTs`}
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Warnings at bottom */}
            {isWalletConnected && (() => {
              const tokenAmount = parseFloat(tokenEstimate || '0');
              const fractionalPart = tokenAmount - Math.floor(tokenAmount);
              const nftCount = Math.floor(tokenAmount);
              const ethNeeded = parseFloat(ethAmount || '0');
              const userEthBalance = parseFloat(ethBalance);

              // Check for insufficient ETH
              if (ethAmount && ethNeeded > 0 && userEthBalance < ethNeeded) {
                return (
                  <div style={{
                    marginTop: '8px',
                    color: 'rgba(239, 68, 68, 1)',
                    fontSize: 'clamp(10px, 1vw, 11px)',
                    textAlign: 'center',
                    lineHeight: '1.3',
                  }}>
                    Insufficient ETH balance ({userEthBalance.toFixed(6)} ETH available)
                  </div>
                );
              }

              // Check for insufficient NFTs remaining
              if (nftCount > 0 && nftCount > nftsRemaining) {
                return (
                  <div style={{
                    marginTop: '8px',
                    color: 'rgba(239, 68, 68, 1)',
                    fontSize: 'clamp(10px, 1vw, 11px)',
                    textAlign: 'center',
                    lineHeight: '1.3',
                  }}>
                    Only {nftsRemaining} NFTs remaining (trying to mint {nftCount})
                  </div>
                );
              }

              // Show round-up warning
              if (tokenEstimate !== '0' && tokenEstimate !== '...' && tokenAmount > 0 && fractionalPart >= 0.7) {
                const tokensNeeded = (Math.ceil(tokenAmount) - tokenAmount).toFixed(4);
                return (
                  <div style={{
                    marginTop: '8px',
                    color: 'rgba(251, 191, 36, 1)',
                    fontSize: 'clamp(10px, 1vw, 11px)',
                    textAlign: 'center',
                    lineHeight: '1.3',
                  }}>
                    Only {tokensNeeded} tokens away from {Math.ceil(tokenAmount)} NFT{Math.ceil(tokenAmount) !== 1 ? 's' : ''}
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Swap Arrow */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              margin: 'clamp(6px, 1.2vw, 8px) 0',
            }}
          >
            <div
              style={{
                width: 'clamp(28px, 5.5vw, 36px)',
                height: 'clamp(28px, 5.5vw, 36px)',
                borderRadius: 'clamp(6px, 1.2vw, 8px)',
                backgroundColor: 'rgba(168, 85, 247, 0.2)',
                border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(168, 85, 247, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'clamp(16px, 3.5vw, 20px)',
                color: 'rgba(168, 85, 247, 1)',
              }}
            >
              ↓
            </div>
          </div>

          {/* What You'll Get Section */}
          <div
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.8)',
              borderRadius: 'clamp(12px, 2vw, 16px)',
              padding: 'clamp(12px, 2.5vw, 18px)',
              marginBottom: 'clamp(12px, 2vw, 16px)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(11px, 2.2vw, 13px)',
                color: 'rgba(255, 255, 255, 0.6)',
                fontWeight: 600,
                marginBottom: 'clamp(8px, 1.5vw, 12px)',
              }}
            >
              You receive {isLoadingQuote && '(Loading...)'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(10px, 2vw, 12px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px, 2vw, 12px)' }}>
                <div
                  style={{
                    fontSize: 'clamp(20px, 5vw, 28px)',
                  }}
                >
                  🪙
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 'clamp(14px, 3.5vw, 18px)',
                      fontWeight: 700,
                      color: tokenEstimate === '0' || tokenEstimate === '...' ? 'rgba(255, 255, 255, 0.4)' : '#FFFFFF',
                      marginBottom: 'clamp(3px, 0.6vw, 4px)',
                    }}
                  >
                    {tokenEstimate === '0' ? '0.00' : tokenEstimate} $wNFTs
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(9px, 1.8vw, 11px)',
                      color: 'rgba(255, 255, 255, 0.5)',
                    }}
                  >
                    $wrapped NFTs (claimable over 90 days)
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px, 2vw, 12px)' }}>
                <div
                  style={{
                    fontSize: 'clamp(20px, 5vw, 28px)',
                  }}
                >
                  🐍
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 'clamp(14px, 3.5vw, 18px)',
                      fontWeight: 700,
                      color: tokenEstimate === '0' || tokenEstimate === '...' ? 'rgba(255, 255, 255, 0.4)' : '#FFFFFF',
                      marginBottom: 'clamp(3px, 0.6vw, 4px)',
                    }}
                  >
                    {tokenEstimate === '0' || tokenEstimate === '...' ? '0' : Math.floor(parseFloat(tokenEstimate))} NFT{Math.floor(parseFloat(tokenEstimate || '0')) !== 1 ? 's' : ''}
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(9px, 1.8vw, 11px)',
                      color: 'rgba(255, 255, 255, 0.5)',
                      lineHeight: '1.4',
                    }}
                  >
                    1 NFT per whole token
                    {(() => {
                      const nftCount = Math.floor(parseFloat(tokenEstimate || '0'));
                      const guaranteedRares = Math.floor(nftCount / 10);

                      if (tokenEstimate !== '0' && tokenEstimate !== '...' && nftCount >= 10) {
                        return (
                          <div style={{ color: 'rgba(34, 197, 94, 1)', marginTop: '2px', fontWeight: 600 }}>
                            ✨ Guaranteed {guaranteedRares} rare{guaranteedRares > 1 ? 's' : ''} for {guaranteedRares * 10} NFT mints!
                          </div>
                        );
                      } else if (tokenEstimate !== '0' && tokenEstimate !== '...' && nftCount > 0 && nftCount < 10) {
                        return (
                          <div style={{ color: 'rgba(251, 146, 60, 1)', marginTop: '2px' }}>
                            ✨ Mint 10 NFTs to guarantee a rare!
                          </div>
                        );
                      }
                      return null;
                    })()}
                    {ethAmount && parseFloat(ethAmount) > 0 && (tokenEstimate === '0' || (tokenEstimate !== '...' && Math.floor(parseFloat(tokenEstimate)) === 0)) && (
                      <div style={{ color: 'rgba(239, 68, 68, 1)', marginTop: '2px' }}>
                        ⚠️ Not enough for 1 NFT - transaction will revert
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Swap Button */}
          <div
            className="cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95"
            onClick={() => {
              if (!isWalletConnected && openConnectModal) {
                openConnectModal();
              } else {
                handleSwapMint();
              }
            }}
            onMouseEnter={(e) => {
              if (!isTransactionPending && !isConfirming) {
                e.currentTarget.style.boxShadow = '0 0 30px rgba(168, 85, 247, 0.7), inset 0 0 20px rgba(168, 85, 247, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.5)';
            }}
            style={{
              width: '100%',
              padding: 'clamp(12px, 2.5vw, 16px)',
              background: isTransactionPending || isConfirming
                ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95) 0%, rgba(75, 85, 99, 0.95) 100%)'
                : !isWalletConnected
                ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.95) 0%, rgba(37, 99, 235, 0.95) 100%)'
                : 'linear-gradient(135deg, rgba(168, 85, 247, 0.95) 0%, rgba(139, 92, 246, 0.95) 100%)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(216, 180, 254, 0.5)',
              borderRadius: 'clamp(12px, 2vw, 16px)',
              fontSize: 'clamp(14px, 3.5vw, 18px)',
              fontWeight: 700,
              color: '#FFFFFF',
              textAlign: 'center',
              textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
              boxShadow: '0 8px 25px rgba(0, 0, 0, 0.5)',
              opacity: (isTransactionPending || isConfirming || (isWalletConnected && (!ethAmount || parseFloat(ethAmount) <= 0))) ? 0.7 : 1,
              pointerEvents: (isTransactionPending || isConfirming) ? 'none' : 'auto',
            }}
          >
            {!isWalletConnected
              ? 'Connect Wallet'
              : isTransactionPending
              ? 'Confirming Transaction...'
              : isConfirming
              ? 'Minting NFTs...'
              : isConfirmed
              ? 'Success! ✓'
              : ethAmount && parseFloat(ethAmount) > 0
              ? 'Swap & Mint NFT'
              : 'Enter Amount'}
          </div>

          {/* Transaction Hash Display */}
          {hash && (
            <a
              href={`https://basescan.org/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer transition-all duration-200"
              style={{
                display: 'block',
                marginTop: 'clamp(10px, 2vw, 12px)',
                padding: 'clamp(10px, 2vw, 12px)',
                backgroundColor: 'rgba(168, 85, 247, 0.1)',
                border: 'clamp(1px, 0.15vw, 1px) solid rgba(168, 85, 247, 0.3)',
                borderRadius: 'clamp(6px, 1.2vw, 8px)',
                fontSize: 'clamp(9px, 1.8vw, 11px)',
                color: 'rgba(168, 85, 247, 0.9)',
                textAlign: 'center',
                wordBreak: 'break-all',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.5)';
                e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.3)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Transaction: {hash.slice(0, 10)}...{hash.slice(-8)} 🔗
            </a>
          )}

          {/* Info Note */}
          <div
            style={{
              marginTop: 'clamp(12px, 2.5vw, 16px)',
              fontSize: 'clamp(9px, 1.8vw, 11px)',
              color: 'rgba(255, 255, 255, 0.5)',
              textAlign: 'center',
              lineHeight: '1.5',
            }}
          >
            powered by the <a href="https://pairable.io/#/contracts/superstrat" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(168, 85, 247, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT super strategy hook
          </div>
          </>
          )}

          {/* Wrap Tab Content */}
          {shopTab === 'wrap' && (
            <>
              {wrapMode === 'wrap' ? (
                /* WRAP MODE */
                <div>
                  {/* NFT Grid First */}
                  {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 'clamp(20px, 4vw, 40px)' }}>
                      <div style={{ display: 'inline-block', width: 'clamp(32px, 6vw, 48px)', height: 'clamp(32px, 6vw, 48px)', border: 'clamp(3px, 0.6vw, 4px) solid rgba(59, 130, 246, 0.3)', borderTop: 'clamp(3px, 0.6vw, 4px) solid rgba(59, 130, 246, 1)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                    </div>
                  ) : nfts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'clamp(20px, 4vw, 40px)' }}>
                      <p style={{ fontSize: 'clamp(14px, 3vw, 18px)', fontWeight: 700, color: '#FFFFFF', marginTop: 'clamp(8px, 1.6vw, 12px)' }}>No NFTs Found</p>
                      <p style={{ fontSize: 'clamp(11px, 2.2vw, 13px)', color: 'rgba(255, 255, 255, 0.6)', marginTop: 'clamp(4px, 0.8vw, 6px)' }}>You don&apos;t own any NFTs to wrap</p>
                    </div>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 18vw, 100px), 1fr))',
                      gap: 'clamp(6px, 1.2vw, 8px)',
                      maxHeight: 'clamp(150px, 25vh, 250px)',
                      overflowY: 'auto',
                      padding: 'clamp(4px, 0.8vw, 6px)',
                    }}>
                      {nfts.map((nft) => {
                        const isSelected = selectedNFTs.has(nft.tokenId);
                        return (
                          <button
                            key={nft.tokenId}
                            onClick={() => toggleNFTForWrap(nft.tokenId)}
                            style={{
                              position: 'relative',
                              borderRadius: 'clamp(6px, 1.2vw, 8px)',
                              overflow: 'hidden',
                              border: isSelected
                                ? 'clamp(2px, 0.4vw, 3px) solid rgba(59, 130, 246, 1)'
                                : 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              boxShadow: isSelected ? '0 0 15px rgba(59, 130, 246, 0.6)' : 'none',
                              transform: isSelected ? 'scale(0.95)' : 'scale(1)',
                            }}
                          >
                            {/* Checkbox */}
                            <div style={{ position: 'absolute', top: 'clamp(3px, 0.6vw, 4px)', left: 'clamp(3px, 0.6vw, 4px)', zIndex: 10 }}>
                              <div style={{
                                width: 'clamp(16px, 3.2vw, 20px)',
                                height: 'clamp(16px, 3.2vw, 20px)',
                                borderRadius: '50%',
                                border: 'clamp(1.5px, 0.3vw, 2px) solid ' + (isSelected ? 'rgba(59, 130, 246, 1)' : 'rgba(107, 114, 128, 1)'),
                                backgroundColor: isSelected ? 'rgba(59, 130, 246, 1)' : 'rgba(17, 24, 39, 0.8)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'clamp(10px, 2vw, 12px)',
                                color: '#FFFFFF',
                              }}>
                                {isSelected && '✓'}
                              </div>
                            </div>

                            {/* NFT Image */}
                            <div style={{ aspectRatio: '1/1', position: 'relative' }}>
                              <img
                                src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                                alt={nft.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            </div>

                            {/* NFT Info */}
                            <div style={{ padding: 'clamp(4px, 0.8vw, 6px)', backgroundColor: 'rgba(17, 24, 39, 0.9)' }}>
                              <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: '#FFFFFF', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nft.name}</p>
                              <p style={{ fontSize: 'clamp(8px, 1.6vw, 10px)', color: 'rgba(255, 255, 255, 0.6)' }}>#{nft.tokenId}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Wrap Summary - Single Consolidated Box */}
                  {nfts.length > 0 && (
                    <div style={{
                      backgroundColor: 'rgba(17, 24, 39, 0.8)',
                      borderRadius: 'clamp(8px, 1.5vw, 12px)',
                      padding: 'clamp(10px, 2vw, 12px)',
                      marginTop: 'clamp(10px, 2vw, 12px)',
                      border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(59, 130, 246, 0.5)',
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(10px, 2vw, 12px)' }}>
                        {/* Left: Balance & Selected */}
                        <div>
                          <div style={{ marginBottom: 'clamp(6px, 1.2vw, 8px)' }}>
                            <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(2px, 0.4vw, 3px)' }}>
                              Your Balance
                            </p>
                            <p style={{ fontSize: 'clamp(14px, 3vw, 16px)', fontWeight: 700, color: '#FFFFFF' }}>
                              {wTokenBalance ? (Number(wTokenBalance) / 1e18).toFixed(2) : '0.00'} wNFTs
                            </p>
                          </div>
                          <div>
                            <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(2px, 0.4vw, 3px)' }}>
                              Selected
                            </p>
                            <p style={{ fontSize: 'clamp(12px, 2.6vw, 14px)', fontWeight: 600, color: '#FFFFFF' }}>
                              {selectedNFTs.size} NFT{selectedNFTs.size !== 1 ? 's' : ''}
                            </p>
                            <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)' }}>
                              Fee: {wrapFee ? formatEther(BigInt(wrapFee as bigint) * BigInt(selectedNFTs.size)) : '0'} ETH
                            </p>
                          </div>
                        </div>
                        {/* Right: You Receive */}
                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(4px, 0.8vw, 6px)' }}>
                            You receive
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(4px, 0.8vw, 6px)', justifyContent: 'flex-end' }}>
                            <div style={{
                              fontSize: 'clamp(20px, 4.5vw, 26px)',
                              fontWeight: 700,
                              color: 'rgba(59, 130, 246, 1)',
                            }}>
                              {selectedNFTs.size}
                            </div>
                            <div style={{ fontSize: 'clamp(14px, 3vw, 16px)', fontWeight: 700, color: '#FFFFFF' }}>
                              wNFTs
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Mode Switcher */}
                      <div style={{
                        marginTop: 'clamp(8px, 1.5vw, 10px)',
                        paddingTop: 'clamp(8px, 1.5vw, 10px)',
                        borderTop: 'clamp(1px, 0.2vw, 1px) solid rgba(75, 85, 99, 0.3)',
                        display: 'flex',
                        gap: 'clamp(12px, 2.5vw, 16px)',
                        justifyContent: 'center'
                      }}>
                        <button
                          onClick={() => setWrapMode('unwrap')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(34, 197, 94, 1)',
                            fontSize: 'clamp(10px, 2vw, 12px)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                          }}
                        >
                          Unwrap NFTs →
                        </button>
                        <span style={{ color: 'rgba(75, 85, 99, 0.6)' }}>|</span>
                        <button
                          onClick={() => setWrapMode('swap')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(168, 85, 247, 1)',
                            fontSize: 'clamp(10px, 2vw, 12px)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                          }}
                        >
                          Swap NFTs →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Wrap Action Button */}
                  {nfts.length > 0 && (
                    <div style={{ marginTop: 'clamp(10px, 2vw, 12px)' }}>
                      {!isWrapperApproved ? (
                        <button
                          onClick={mainPageSupportsAtomicBatch ? handleApproveAndWrap : handleWrapperApprove}
                          disabled={isTransactionPending || isConfirming || isMainPageBatchPending || isMainPageBatchConfirming || (mainPageSupportsAtomicBatch && selectedNFTs.size === 0)}
                          style={{
                            width: '100%',
                            padding: 'clamp(12px, 2.5vw, 16px)',
                            borderRadius: 'clamp(8px, 1.5vw, 12px)',
                            fontWeight: 700,
                            fontSize: 'clamp(14px, 3vw, 16px)',
                            border: 'none',
                            background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.95))',
                            color: '#FFFFFF',
                            cursor: (isTransactionPending || isConfirming || isMainPageBatchPending || isMainPageBatchConfirming) ? 'not-allowed' : 'pointer',
                            opacity: (isTransactionPending || isConfirming || isMainPageBatchPending || isMainPageBatchConfirming) ? 0.7 : 1,
                            transition: 'all 0.2s',
                          }}
                        >
                          {isMainPageBatchPending || isMainPageBatchConfirming
                            ? '⚡ Processing...'
                            : isTransactionPending || isConfirming
                              ? 'Approving...'
                              : mainPageSupportsAtomicBatch
                                ? `⚡ Approve & Wrap ${selectedNFTs.size} NFT${selectedNFTs.size !== 1 ? 's' : ''}`
                                : 'Approve Wrapper Contract'}
                        </button>
                      ) : (
                        <button
                          onClick={handleWrap}
                          disabled={selectedNFTs.size === 0 || isTransactionPending || isConfirming}
                          style={{
                            width: '100%',
                            padding: 'clamp(12px, 2.5vw, 16px)',
                            borderRadius: 'clamp(8px, 1.5vw, 12px)',
                            fontWeight: 700,
                            fontSize: 'clamp(14px, 3vw, 16px)',
                            border: 'none',
                            background: (selectedNFTs.size === 0 || isTransactionPending || isConfirming)
                              ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                              : 'linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95))',
                            color: '#FFFFFF',
                            cursor: (selectedNFTs.size === 0 || isTransactionPending || isConfirming) ? 'not-allowed' : 'pointer',
                            opacity: (selectedNFTs.size === 0 || isTransactionPending || isConfirming) ? 0.7 : 1,
                            transition: 'all 0.2s',
                          }}
                        >
                          {isTransactionPending || isConfirming
                            ? 'Wrapping...'
                            : `Wrap ${selectedNFTs.size} NFT${selectedNFTs.size !== 1 ? 's' : ''} for ${wrapFee ? formatEther(BigInt(wrapFee as bigint) * BigInt(selectedNFTs.size)) : '0'} ETH`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : wrapMode === 'unwrap' ? (
                /* UNWRAP MODE */
                <div>
                  {/* Unwrap Summary - Single Consolidated Box */}
                  <div style={{
                    backgroundColor: 'rgba(17, 24, 39, 0.8)',
                    borderRadius: 'clamp(8px, 1.5vw, 12px)',
                    padding: 'clamp(10px, 2vw, 12px)',
                    marginBottom: 'clamp(10px, 2vw, 12px)',
                    border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(34, 197, 94, 0.5)',
                  }}>
                    <p style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(8px, 1.5vw, 10px)' }}>
                      Unwrap NFTs from the pool (FIFO)
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(10px, 2vw, 12px)' }}>
                      {/* Left: Input & Balance */}
                      <div>
                        <div style={{ marginBottom: 'clamp(6px, 1.2vw, 8px)' }}>
                          <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(2px, 0.4vw, 3px)' }}>
                            Your Balance
                          </p>
                          <p style={{ fontSize: 'clamp(14px, 3vw, 16px)', fontWeight: 700, color: '#FFFFFF' }}>
                            {wTokenBalance ? (Number(wTokenBalance) / 1e18).toFixed(2) : '0.00'} wNFTs
                          </p>
                        </div>
                        <label style={{ display: 'block', fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(4px, 0.8vw, 6px)' }}>
                          Amount to unwrap
                        </label>
                        <input
                          type="text"
                          value={unwrapCount}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Check for decimals
                            if (value.includes('.')) {
                              setUnwrapError('Decimals not allowed - whole numbers only');
                              return;
                            }
                            const num = parseInt(value);
                            if (isNaN(num) || num < 1) {
                              setUnwrapError('Must be at least 1');
                              setUnwrapCount(0);
                            } else {
                              setUnwrapError('');
                              setUnwrapCount(num);
                            }
                          }}
                          style={{
                            width: '100%',
                            backgroundColor: 'rgba(17, 24, 39, 0.8)',
                            border: `clamp(1px, 0.2vw, 1.5px) solid ${unwrapError ? 'rgba(239, 68, 68, 0.6)' : 'rgba(75, 85, 99, 0.4)'}`,
                            borderRadius: 'clamp(6px, 1.2vw, 8px)',
                            padding: 'clamp(8px, 1.5vw, 10px)',
                            color: '#FFFFFF',
                            textAlign: 'center',
                            fontSize: 'clamp(14px, 3vw, 18px)',
                            fontWeight: 700,
                            outline: 'none',
                          }}
                        />
                        {unwrapError && (
                          <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(239, 68, 68, 1)', marginTop: 'clamp(4px, 0.8vw, 6px)' }}>
                            {unwrapError}
                          </p>
                        )}
                        {!unwrapError && (
                          <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.5)', marginTop: 'clamp(4px, 0.8vw, 6px)' }}>
                            Fee: {wrapFee ? formatEther(BigInt(wrapFee as bigint) * BigInt(unwrapCount || 0)) : '0'} ETH
                          </p>
                        )}
                      </div>
                      {/* Right: You Receive */}
                      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(4px, 0.8vw, 6px)' }}>
                          You receive
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(4px, 0.8vw, 6px)', justifyContent: 'flex-end' }}>
                          <div style={{
                            fontSize: 'clamp(20px, 4.5vw, 26px)',
                            fontWeight: 700,
                            color: 'rgba(34, 197, 94, 1)',
                          }}>
                            {unwrapCount}
                          </div>
                          <div style={{ fontSize: 'clamp(14px, 3vw, 16px)', fontWeight: 700, color: '#FFFFFF' }}>
                            NFT{unwrapCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Mode Switcher */}
                    <div style={{
                      marginTop: 'clamp(8px, 1.5vw, 10px)',
                      paddingTop: 'clamp(8px, 1.5vw, 10px)',
                      borderTop: 'clamp(1px, 0.2vw, 1px) solid rgba(75, 85, 99, 0.3)',
                      textAlign: 'center'
                    }}>
                      <button
                        onClick={() => setWrapMode('wrap')}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'rgba(59, 130, 246, 1)',
                          fontSize: 'clamp(10px, 2vw, 12px)',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: 0,
                        }}
                      >
                        ← Wrap NFTs
                      </button>
                    </div>
                  </div>

                  {/* Unwrap Button */}
                  <button
                    onClick={handleUnwrap}
                    disabled={!!unwrapError || unwrapCount < 1 || unwrapCount > (wTokenBalance ? Number(wTokenBalance) / 1e18 : 0) || isTransactionPending || isConfirming}
                    style={{
                      width: '100%',
                      padding: 'clamp(12px, 2.5vw, 16px)',
                      borderRadius: 'clamp(8px, 1.5vw, 12px)',
                      fontWeight: 700,
                      fontSize: 'clamp(14px, 3vw, 16px)',
                      border: 'none',
                      background: (!!unwrapError || unwrapCount < 1 || unwrapCount > (wTokenBalance ? Number(wTokenBalance) / 1e18 : 0) || isTransactionPending || isConfirming)
                        ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                        : 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))',
                      color: '#FFFFFF',
                      cursor: (!!unwrapError || unwrapCount < 1 || unwrapCount > (wTokenBalance ? Number(wTokenBalance) / 1e18 : 0) || isTransactionPending || isConfirming) ? 'not-allowed' : 'pointer',
                      opacity: (!!unwrapError || unwrapCount < 1 || unwrapCount > (wTokenBalance ? Number(wTokenBalance) / 1e18 : 0) || isTransactionPending || isConfirming) ? 0.7 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    {isTransactionPending || isConfirming
                      ? 'Unwrapping...'
                      : `Unwrap ${unwrapCount} NFT${unwrapCount !== 1 ? 's' : ''} for ${wrapFee ? formatEther(BigInt(wrapFee as bigint) * BigInt(unwrapCount || 0)) : '0'} ETH`}
                  </button>

                  {!unwrapError && unwrapCount > (wTokenBalance ? Number(wTokenBalance) / 1e18 : 0) && (
                    <p style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(239, 68, 68, 1)', textAlign: 'center', marginTop: 'clamp(8px, 1.6vw, 10px)' }}>
                      Insufficient balance. You have {wTokenBalance ? (Number(wTokenBalance) / 1e18).toFixed(2) : '0.00'} wNFTs.
                    </p>
                  )}
                </div>
              ) : (
                /* SWAP MODE - Sequential Selection Flow */
                <div>
                  {/* Step indicator */}
                  <p style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(10px, 2vw, 12px)', textAlign: 'center' }}>
                    {selectedWTokenNFT === null
                      ? 'Step 1: Select NFT you want from the pool'
                      : selectedUserNFT === null
                        ? 'Step 2: Select NFT to trade from your collection'
                        : 'Ready to swap!'}
                  </p>

                  {/* Step 1: Pool NFTs Selection (What you want to get) */}
                  {selectedWTokenNFT === null ? (
                    <div>
                      <h3 style={{ fontSize: 'clamp(12px, 2.6vw, 14px)', fontWeight: 700, color: '#FFFFFF', marginBottom: 'clamp(8px, 1.5vw, 10px)', borderBottom: 'clamp(1px, 0.2vw, 1.5px) solid rgba(75, 85, 99, 0.3)', paddingBottom: 'clamp(6px, 1.2vw, 8px)' }}>
                        Pick a NFT you want ({wTokensTotalHeld})
                      </h3>
                      {wTokensLoading ? (
                        <div style={{ textAlign: 'center', padding: 'clamp(20px, 4vw, 40px)' }}>
                          <div style={{ display: 'inline-block', width: 'clamp(24px, 5vw, 32px)', height: 'clamp(24px, 5vw, 32px)', border: 'clamp(2px, 0.4vw, 3px) solid rgba(168, 85, 247, 0.3)', borderTop: 'clamp(2px, 0.4vw, 3px) solid rgba(168, 85, 247, 1)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                        </div>
                      ) : wTokensNFTs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'clamp(12px, 2.5vw, 16px)' }}>
                          <p style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(255, 255, 255, 0.6)' }}>No NFTs in pool</p>
                        </div>
                      ) : (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gap: 'clamp(4px, 0.8vw, 6px)',
                          maxHeight: 'clamp(300px, 40vh, 400px)',
                          overflowY: 'auto',
                          marginBottom: 'clamp(12px, 2.5vw, 16px)',
                        }}>
                          {wTokensNFTs.map((nft) => (
                            <button
                              key={nft.tokenId}
                              onClick={() => setSelectedWTokenNFT(nft.tokenId)}
                              style={{
                                position: 'relative',
                                borderRadius: 'clamp(6px, 1.2vw, 8px)',
                                overflow: 'hidden',
                                border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(75, 85, 99, 0.4)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                transform: 'scale(1)',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.05)';
                                e.currentTarget.style.boxShadow = '0 0 12px rgba(168, 85, 247, 0.6)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                                e.currentTarget.style.boxShadow = 'none';
                              }}
                            >
                              <div style={{ aspectRatio: '1/1' }}>
                                <img
                                  src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                                  alt={nft.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <div style={{ padding: 'clamp(3px, 0.6vw, 4px)', backgroundColor: 'rgba(17, 24, 39, 0.9)' }}>
                                <p style={{ fontSize: 'clamp(8px, 1.6vw, 10px)', color: '#FFFFFF', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{nft.tokenId}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : selectedUserNFT === null ? (
                    /* Step 2: Your NFTs Selection (What you'll give up) */
                    <div>
                      {/* Show selected pool NFT */}
                      <div style={{
                        backgroundColor: 'rgba(17, 24, 39, 0.8)',
                        borderRadius: 'clamp(8px, 1.5vw, 12px)',
                        padding: 'clamp(10px, 2vw, 12px)',
                        marginBottom: 'clamp(12px, 2.5vw, 16px)',
                        border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(168, 85, 247, 0.5)',
                      }}>
                        <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(4px, 0.8vw, 6px)', textAlign: 'center' }}>
                          You will receive: <span style={{ fontWeight: 700, color: '#FFFFFF' }}>#{selectedWTokenNFT}</span>
                        </p>
                        <button
                          onClick={() => setSelectedWTokenNFT(null)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(239, 68, 68, 1)',
                            fontSize: 'clamp(9px, 1.8vw, 11px)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                            display: 'block',
                            margin: '0 auto',
                          }}
                        >
                          ✕ Change selection
                        </button>
                      </div>

                      <h3 style={{ fontSize: 'clamp(12px, 2.6vw, 14px)', fontWeight: 700, color: '#FFFFFF', marginBottom: 'clamp(8px, 1.5vw, 10px)', borderBottom: 'clamp(1px, 0.2vw, 1.5px) solid rgba(75, 85, 99, 0.3)', paddingBottom: 'clamp(6px, 1.2vw, 8px)' }}>
                        Pick your NFT to trade ({nfts.length})
                      </h3>
                      {isLoading ? (
                        <div style={{ textAlign: 'center', padding: 'clamp(20px, 4vw, 40px)' }}>
                          <div style={{ display: 'inline-block', width: 'clamp(24px, 5vw, 32px)', height: 'clamp(24px, 5vw, 32px)', border: 'clamp(2px, 0.4vw, 3px) solid rgba(168, 85, 247, 0.3)', borderTop: 'clamp(2px, 0.4vw, 3px) solid rgba(168, 85, 247, 1)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                        </div>
                      ) : nfts.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'clamp(12px, 2.5vw, 16px)' }}>
                          <p style={{ fontSize: 'clamp(10px, 2vw, 12px)', color: 'rgba(255, 255, 255, 0.6)' }}>No NFTs</p>
                        </div>
                      ) : (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gap: 'clamp(4px, 0.8vw, 6px)',
                          maxHeight: 'clamp(300px, 40vh, 400px)',
                          overflowY: 'auto',
                          marginBottom: 'clamp(12px, 2.5vw, 16px)',
                        }}>
                          {nfts.map((nft) => (
                            <button
                              key={nft.tokenId}
                              onClick={() => setSelectedUserNFT(nft.tokenId)}
                              style={{
                                position: 'relative',
                                borderRadius: 'clamp(6px, 1.2vw, 8px)',
                                overflow: 'hidden',
                                border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(75, 85, 99, 0.4)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                transform: 'scale(1)',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.05)';
                                e.currentTarget.style.boxShadow = '0 0 12px rgba(168, 85, 247, 0.6)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                                e.currentTarget.style.boxShadow = 'none';
                              }}
                            >
                              <div style={{ aspectRatio: '1/1' }}>
                                <img
                                  src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                                  alt={nft.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <div style={{ padding: 'clamp(3px, 0.6vw, 4px)', backgroundColor: 'rgba(17, 24, 39, 0.9)' }}>
                                <p style={{ fontSize: 'clamp(8px, 1.6vw, 10px)', color: '#FFFFFF', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{nft.tokenId}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Step 3: Swap Confirmation */
                    <div>
                      {/* Swap Preview */}
                      <div style={{
                        backgroundColor: 'rgba(17, 24, 39, 0.8)',
                        borderRadius: 'clamp(8px, 1.5vw, 12px)',
                        padding: 'clamp(10px, 2vw, 12px)',
                        marginBottom: 'clamp(12px, 2.5vw, 16px)',
                        border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(168, 85, 247, 0.5)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(8px, 1.5vw, 10px)', marginBottom: 'clamp(8px, 1.5vw, 10px)' }}>
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(2px, 0.4vw, 3px)' }}>You give</p>
                            <p style={{ fontSize: 'clamp(14px, 3vw, 16px)', fontWeight: 700, color: '#FFFFFF' }}>#{selectedUserNFT}</p>
                          </div>
                          <div style={{ fontSize: 'clamp(18px, 4vw, 22px)' }}>↔️</div>
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.6)', marginBottom: 'clamp(2px, 0.4vw, 3px)' }}>You get</p>
                            <p style={{ fontSize: 'clamp(14px, 3vw, 16px)', fontWeight: 700, color: '#FFFFFF' }}>#{selectedWTokenNFT}</p>
                          </div>
                        </div>
                        <p style={{ fontSize: 'clamp(9px, 1.8vw, 11px)', color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center', marginBottom: 'clamp(6px, 1.2vw, 8px)' }}>
                          Fee: {swapFee ? formatEther(BigInt(swapFee as bigint)) : '0'} ETH
                        </p>
                        <button
                          onClick={() => {
                            setSelectedUserNFT(null);
                            setSelectedWTokenNFT(null);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(239, 68, 68, 1)',
                            fontSize: 'clamp(9px, 1.8vw, 11px)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                            display: 'block',
                            margin: '0 auto',
                          }}
                        >
                          ✕ Cancel and start over
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mode Switcher */}
                  <div style={{
                    marginBottom: 'clamp(10px, 2vw, 12px)',
                    paddingBottom: 'clamp(8px, 1.5vw, 10px)',
                    borderBottom: 'clamp(1px, 0.2vw, 1px) solid rgba(75, 85, 99, 0.3)',
                    textAlign: 'center'
                  }}>
                    <button
                      onClick={() => {
                        setWrapMode('wrap');
                        setSelectedUserNFT(null);
                        setSelectedWTokenNFT(null);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(59, 130, 246, 1)',
                        fontSize: 'clamp(10px, 2vw, 12px)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      ← Back to Wrap
                    </button>
                  </div>

                  {/* Swap Button - Only show when both NFTs selected */}
                  {selectedUserNFT !== null && selectedWTokenNFT !== null && (
                    !isWrapperApproved ? (
                      <button
                        onClick={mainPageSupportsAtomicBatch ? handleApproveAndSwap : handleWrapperApprove}
                        disabled={isTransactionPending || isConfirming || isMainPageBatchPending || isMainPageBatchConfirming}
                        style={{
                          width: '100%',
                          padding: 'clamp(12px, 2.5vw, 16px)',
                          borderRadius: 'clamp(8px, 1.5vw, 12px)',
                          fontWeight: 700,
                          fontSize: 'clamp(14px, 3vw, 16px)',
                          border: 'none',
                          background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.95))',
                          color: '#FFFFFF',
                          cursor: (isTransactionPending || isConfirming || isMainPageBatchPending || isMainPageBatchConfirming) ? 'not-allowed' : 'pointer',
                          opacity: (isTransactionPending || isConfirming || isMainPageBatchPending || isMainPageBatchConfirming) ? 0.7 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        {isMainPageBatchPending || isMainPageBatchConfirming
                          ? '⚡ Processing...'
                          : isTransactionPending || isConfirming
                            ? 'Approving...'
                            : mainPageSupportsAtomicBatch
                              ? '⚡ Approve & Swap'
                              : 'Approve Wrapper Contract'}
                      </button>
                    ) : (
                      <button
                        onClick={handleSwap}
                        disabled={isTransactionPending || isConfirming}
                        style={{
                          width: '100%',
                          padding: 'clamp(12px, 2.5vw, 16px)',
                          borderRadius: 'clamp(8px, 1.5vw, 12px)',
                          fontWeight: 700,
                          fontSize: 'clamp(14px, 3vw, 16px)',
                          border: 'none',
                          background: (isTransactionPending || isConfirming)
                            ? 'linear-gradient(135deg, rgba(107, 114, 128, 0.95), rgba(75, 85, 99, 0.95))'
                            : 'linear-gradient(135deg, rgba(168, 85, 247, 0.95), rgba(139, 92, 246, 0.95))',
                          color: '#FFFFFF',
                          cursor: (isTransactionPending || isConfirming) ? 'not-allowed' : 'pointer',
                          opacity: (isTransactionPending || isConfirming) ? 0.7 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        {isTransactionPending || isConfirming
                          ? 'Swapping...'
                          : `Swap NFTs for ${swapFee ? formatEther(BigInt(swapFee as bigint)) : '0'} ETH`}
                      </button>
                    )
                  )}
                </div>
              )}

              {/* Powered by Pairable - NFT Wrapping System */}
              <div
                style={{
                  marginTop: 'clamp(16px, 3vw, 24px)',
                  paddingTop: 'clamp(12px, 2.5vw, 16px)',
                  borderTop: 'clamp(1px, 0.2vw, 1.5px) solid rgba(75, 85, 99, 0.3)',
                  fontSize: 'clamp(9px, 1.8vw, 11px)',
                  color: 'rgba(255, 255, 255, 0.5)',
                  textAlign: 'center',
                  lineHeight: '1.5',
                }}
              >
                powered by the <a href="https://pairable.io/#/nft-strategy" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(59, 130, 246, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT wrapping system
              </div>

            </>
          )}

          </div>{/* Close content wrapper */}
        </div>
      )}

      {/* Hatch Interface Backdrop - click outside to close */}
      {showHatch && (
        <div
          className="fixed inset-0 cursor-pointer"
          style={{
            zIndex: 99,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
          }}
          onClick={() => setShowHatch(false)}
        />
      )}

      {/* Hatch Interface - centered modal */}
      {showHatch && (
        <div
          className="fixed"
          style={{
            zIndex: 100,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(280px, 92vw, 500px)',
            height: 'min(85vh, 600px)',
            maxHeight: 'min(85vh, 600px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))',
            backgroundColor: 'rgba(17, 24, 39, 0.98)',
            border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
            borderRadius: 'clamp(10px, 2vw, 16px)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(6, 182, 212, 0.3), 0 0 100px rgba(168, 85, 247, 0.2), inset 0 0 30px rgba(168, 85, 247, 0.05)',
            padding: 'clamp(8px, 2vw, 16px)',
          }}
        >
          {/* Shimmer effect overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.1), transparent)',
              animation: 'shimmer 3s infinite',
              zIndex: 1,
            }}
          />

          {/* Content wrapper */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {/* Hatch Header */}
          <div
            style={{
              marginBottom: 'clamp(6px, 1.2vw, 10px)',
              marginTop: 'clamp(4px, 1vw, 8px)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 'clamp(14px, 3.5vw, 20px)',
                fontWeight: 700,
                marginBottom: 'clamp(4px, 0.8vw, 6px)',
              }}
            >
              <span
                style={{
                  background: showHatchSuccess
                    ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 50%, #22c55e 100%)'
                    : 'linear-gradient(135deg, #06b6d4 0%, #a855f7 50%, #ec4899 100%)',
                  WebkitBackgroundClip: 'text',
                  MozBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  display: 'inline-block',
                }}
              >
                {showHatchSuccess ? '🎉 Hatching Complete!' : 'Hatch Early'}
              </span>
            </div>
            <div
              style={{
                fontSize: 'clamp(9px, 1.8vw, 11px)',
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 500,
                lineHeight: 1.3,
              }}
            >
              {showHatchSuccess
                ? 'Your snakes have hatched! Click any snake to view in inventory.'
                : 'Swap here to unhatch your eggs, tokens from swaps unlock over 90 days'}
            </div>
          </div>

          {/* Select All/Deselect All Button */}
          {!showHatchSuccess && (
            <div
              style={{
                marginBottom: 'clamp(6px, 1.2vw, 10px)',
                flexShrink: 0,
              }}
            >
              <button
                onClick={toggleSelectAllEggs}
                style={{
                  width: '100%',
                  padding: 'clamp(6px, 1.2vw, 10px)',
                  backgroundColor: 'rgba(6, 182, 212, 0.2)',
                  border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.4)',
                  borderRadius: 'clamp(6px, 1.2vw, 10px)',
                  color: 'rgba(6, 182, 212, 1)',
                  fontSize: 'clamp(11px, 2.2vw, 13px)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(6, 182, 212, 0.3)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(6, 182, 212, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                }}
              >
                {selectedEggs.size === nfts.filter(nft => nft.isEgg && !recentlyHatchedEggs.has(nft.tokenId)).length && nfts.filter(nft => nft.isEgg && !recentlyHatchedEggs.has(nft.tokenId)).length > 0
                  ? 'Deselect All'
                  : 'Select All'}
              </button>
            </div>
          )}

          {/* Success Title */}
          {showHatchSuccess && (
            <div
              style={{
                marginBottom: 'clamp(8px, 1.6vw, 12px)',
                padding: 'clamp(10px, 2vw, 14px)',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderRadius: 'clamp(8px, 1.6vw, 12px)',
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: 'clamp(14px, 3vw, 18px)',
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    background: 'linear-gradient(135deg, rgba(34, 197, 94, 1) 0%, rgba(22, 163, 74, 1) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  You hatched {hatchedNFTs.length} snake{hatchedNFTs.length !== 1 ? 's' : ''}!
                </span>
              </div>
            </div>
          )}

          {/* Eggs Grid / Hatched NFTs Grid */}
          <div
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.8)',
              borderRadius: 'clamp(8px, 1.6vw, 12px)',
              padding: 'clamp(8px, 1.6vw, 12px)',
              marginBottom: 'clamp(6px, 1.2vw, 10px)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 'clamp(150px, 30vh, 250px)',
            }}
          >
            {!showHatchSuccess && (
              <div
                style={{
                  fontSize: 'clamp(10px, 2vw, 12px)',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontWeight: 600,
                  marginBottom: 'clamp(6px, 1.2vw, 10px)',
                  flexShrink: 0,
                }}
              >
                Your Eggs ({nfts.filter(nft => nft.isEgg && !recentlyHatchedEggs.has(nft.tokenId)).length})
              </div>
            )}

            {showHatchSuccess ? (
              // Success mode: Show hatched NFTs
              hatchedNFTs.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 1,
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: 'clamp(12px, 2.5vw, 14px)',
                  }}
                >
                  No hatched snakes
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 14vw, 100px), 1fr))',
                    gap: 'clamp(12px, 2.4vw, 16px)',
                    maxHeight: 'clamp(200px, 40vh, 300px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: 'clamp(8px, 1.6vw, 12px)',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: 'clamp(6px, 1.2vw, 10px)',
                    border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(34, 197, 94, 0.3)',
                    flex: 1,
                    minHeight: 0,
                    alignContent: 'start',
                  }}
                >
                  {hatchedNFTs.map((nft) => (
                    <div
                      key={nft.tokenId}
                      onClick={() => {
                        setShowHatchSuccess(false);
                        openInventory();
                      }}
                      style={{
                        cursor: 'pointer',
                        aspectRatio: '1 / 1',
                        borderRadius: 'clamp(6px, 1.2vw, 10px)',
                        border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(34, 197, 94, 0.4)',
                        overflow: 'hidden',
                        position: 'relative',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                        <img
                          src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
                          alt={nft.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          top: '2px',
                          left: '2px',
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          color: '#FFFFFF',
                          borderRadius: 'clamp(4px, 0.8vw, 6px)',
                          padding: 'clamp(2px, 0.4vw, 4px) clamp(4px, 0.8vw, 6px)',
                          fontSize: 'clamp(8px, 1.6vw, 10px)',
                          fontWeight: 600,
                        }}
                      >
                        #{nft.tokenId}
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '2px',
                          left: '2px',
                          right: '2px',
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          color: '#FFFFFF',
                          borderRadius: 'clamp(4px, 0.8vw, 6px)',
                          padding: 'clamp(2px, 0.4vw, 4px)',
                          fontSize: 'clamp(8px, 1.6vw, 10px)',
                          fontWeight: 600,
                          textAlign: 'center',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {nft.name}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              // Normal mode: Show eggs for selection (excluding recently hatched)
              nfts.filter(nft => nft.isEgg && !recentlyHatchedEggs.has(nft.tokenId)).length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 1,
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: 'clamp(12px, 2.5vw, 14px)',
                  }}
                >
                  No eggs available
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 14vw, 100px), 1fr))',
                    gap: 'clamp(12px, 2.4vw, 16px)',
                    maxHeight: 'clamp(150px, 30vh, 250px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: 'clamp(8px, 1.6vw, 12px)',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: 'clamp(6px, 1.2vw, 10px)',
                    border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.2)',
                  }}
                >
                  {nfts.filter(nft => nft.isEgg && !recentlyHatchedEggs.has(nft.tokenId)).map((egg) => (
                    <div
                      key={egg.tokenId}
                      onClick={() => toggleEgg(egg.tokenId)}
                      style={{
                        cursor: 'pointer',
                        aspectRatio: '1 / 1',
                        borderRadius: 'clamp(6px, 1.2vw, 10px)',
                        border: selectedEggs.has(egg.tokenId)
                          ? 'clamp(2px, 0.4vw, 3px) solid rgba(6, 182, 212, 1)'
                          : 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
                        overflow: 'hidden',
                        position: 'relative',
                        boxShadow: selectedEggs.has(egg.tokenId)
                          ? '0 0 15px rgba(6, 182, 212, 0.6)'
                          : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                        <img
                          src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${egg.imageUrl}`}
                          alt={egg.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      </div>
                      {selectedEggs.has(egg.tokenId) && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            backgroundColor: 'rgba(6, 182, 212, 1)',
                            color: '#FFFFFF',
                            borderRadius: '50%',
                            width: 'clamp(18px, 3.6vw, 24px)',
                            height: 'clamp(18px, 3.6vw, 24px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'clamp(10px, 2vw, 14px)',
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </div>
                      )}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '2px',
                          left: '2px',
                          right: '2px',
                          fontSize: 'clamp(9px, 1.8vw, 11px)',
                          color: 'rgba(255, 255, 255, 0.9)',
                          backgroundColor: 'rgba(0, 0, 0, 0.7)',
                          padding: 'clamp(2px, 0.4vw, 3px)',
                          textAlign: 'center',
                          fontWeight: 600,
                        }}
                      >
                        #{egg.tokenId}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Swap Amount Information */}
          {!showHatchSuccess && (
            <div
              style={{
                backgroundColor: 'rgba(17, 24, 39, 0.8)',
                borderRadius: 'clamp(8px, 1.6vw, 12px)',
                padding: 'clamp(8px, 1.6vw, 12px)',
                marginBottom: 'clamp(6px, 1.2vw, 10px)',
                border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: 'clamp(11px, 2.2vw, 13px)',
                  fontWeight: 600,
                  color: 'rgba(6, 182, 212, 1)',
                }}
              >
                Swap Amount:
              </span>
              <span
                style={{
                  fontSize: 'clamp(12px, 2.6vw, 15px)',
                  fontWeight: 700,
                  color: 'rgba(6, 182, 212, 1)',
                }}
              >
                {unhatchFee && selectedEggs.size > 0
                  ? `${((Number(unhatchFee) * selectedEggs.size) / 1e18).toFixed(6)} ETH`
                  : '0 ETH'}
              </span>
            </div>
          )}

          {/* Hatch Button / Hatch More Button */}
          <button
            onClick={showHatchSuccess ? () => { setShowHatchSuccess(false); setSelectedEggs(new Set()); } : handleHatch}
            disabled={showHatchSuccess ? false : (!isWalletConnected || selectedEggs.size === 0 || isConfirming)}
            style={{
              width: '100%',
              padding: 'clamp(10px, 2vw, 14px)',
              fontSize: 'clamp(13px, 2.6vw, 16px)',
              fontWeight: 700,
              color: '#FFFFFF',
              background: showHatchSuccess
                ? 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))'
                : !isWalletConnected || selectedEggs.size === 0
                ? 'rgba(75, 85, 99, 0.5)'
                : isConfirming
                ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.8), rgba(245, 158, 11, 0.8))'
                : 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))',
              border: 'none',
              borderRadius: 'clamp(10px, 2vw, 14px)',
              cursor: showHatchSuccess
                ? 'pointer'
                : (!isWalletConnected || selectedEggs.size === 0 || isConfirming)
                ? 'not-allowed'
                : 'pointer',
              opacity: showHatchSuccess
                ? 1
                : (!isWalletConnected || selectedEggs.size === 0 || isConfirming)
                ? 0.6
                : 1,
              transition: 'all 0.3s ease',
              flexShrink: 0,
              boxShadow: showHatchSuccess
                ? '0 0 20px rgba(6, 182, 212, 0.5)'
                : (isWalletConnected && selectedEggs.size > 0 && !isConfirming)
                ? '0 0 20px rgba(6, 182, 212, 0.5)'
                : 'none',
            }}
            onMouseEnter={(e) => {
              if (showHatchSuccess || (isWalletConnected && selectedEggs.size > 0 && !isConfirming)) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 0 30px rgba(6, 182, 212, 0.7)';
              }
            }}
            onMouseLeave={(e) => {
              if (showHatchSuccess || (isWalletConnected && selectedEggs.size > 0 && !isConfirming)) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.5)';
              }
            }}
          >
            {showHatchSuccess
              ? 'Hatch More Eggs'
              : !isWalletConnected
              ? 'Connect Wallet'
              : selectedEggs.size === 0
              ? 'Select Eggs to Hatch'
              : isConfirming
              ? '⏳ Hatching...'
              : `Hatch ${selectedEggs.size} Egg${selectedEggs.size !== 1 ? 's' : ''}`}
          </button>

          {/* Transaction Status */}
          {hash && !showHatchSuccess && (
            <div
              style={{
                marginTop: 'clamp(6px, 1.2vw, 10px)',
                padding: 'clamp(6px, 1.2vw, 10px)',
                backgroundColor: 'rgba(6, 182, 212, 0.1)',
                border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.3)',
                borderRadius: 'clamp(6px, 1.2vw, 10px)',
                fontSize: 'clamp(9px, 1.8vw, 11px)',
                color: 'rgba(6, 182, 212, 1)',
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              {isConfirming && '⏳ Confirming...'}
              {!isConfirming && '📝 Submitted'}
              {' • '}
              <a
                href={`https://basescan.org/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'rgba(6, 182, 212, 1)',
                  textDecoration: 'underline',
                }}
              >
                View
              </a>
            </div>
          )}

          {/* Powered by Pairable */}
          <div
            style={{
              marginTop: 'clamp(8px, 1.5vw, 12px)',
              marginBottom: 'clamp(10px, 2vw, 16px)',
              paddingBottom: 'clamp(8px, 1.5vw, 12px)',
              fontSize: 'clamp(9px, 1.8vw, 11px)',
              color: 'rgba(255, 255, 255, 0.4)',
              textAlign: 'center',
              lineHeight: '1.5',
              flexShrink: 0,
            }}
          >
            powered by the <a href="https://pairable.io/#/contracts/superstrat" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(6, 182, 212, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT super strategy hook
          </div>
          </div>{/* Close content wrapper */}
        </div>
      )}

      {/* Breed Interface Backdrop - click outside to close */}
      {showBreed && (
        <div
          className="fixed inset-0 cursor-pointer"
          style={{
            zIndex: 99,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
          }}
          onClick={() => setShowBreed(false)}
        />
      )}

      {/* Breed Interface - centered modal */}
      {showBreed && (
        <div
          className="fixed"
          style={{
            zIndex: 100,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(280px, 92vw, 500px)',
            height: 'min(85vh, 600px)',
            maxHeight: 'min(85vh, 600px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))',
            backgroundColor: 'rgba(17, 24, 39, 0.98)',
            border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
            borderRadius: 'clamp(10px, 2vw, 16px)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(6, 182, 212, 0.3), 0 0 100px rgba(168, 85, 247, 0.2), inset 0 0 30px rgba(168, 85, 247, 0.05)',
            padding: 'clamp(8px, 2vw, 16px)',
          }}
        >
          {/* Shimmer effect overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.1), transparent)',
              animation: 'shimmer 3s infinite',
              zIndex: 1,
            }}
          />

          {/* Content wrapper */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {/* Header Title */}
          {/* Breed/Stake Tabs */}
          <div style={{ display: 'flex', gap: 'clamp(6px, 1.2vw, 8px)', marginBottom: 'clamp(12px, 2.5vw, 16px)', flexShrink: 0 }}>
            <button
              onClick={() => setBreedStakeTab('breed')}
              style={{
                flex: 1,
                padding: 'clamp(8px, 1.8vw, 12px)',
                borderRadius: 'clamp(8px, 1.5vw, 12px)',
                fontWeight: 700,
                fontSize: 'clamp(12px, 2.8vw, 16px)',
                border: breedStakeTab === 'breed' ? 'clamp(1.5px, 0.3vw, 2px) solid rgba(168, 85, 247, 0.6)' : 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                background: breedStakeTab === 'breed'
                  ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))'
                  : 'linear-gradient(135deg, rgba(75, 85, 99, 0.2), rgba(55, 65, 81, 0.2))',
                color: breedStakeTab === 'breed' ? 'rgba(168, 85, 247, 1)' : 'rgba(156, 163, 175, 1)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: breedStakeTab === 'breed' ? '0 0 20px rgba(168, 85, 247, 0.3)' : 'none',
              }}
            >
              🍽️ Feed Wilfred
            </button>
            <button
              onClick={() => setBreedStakeTab('stake')}
              style={{
                flex: 1,
                padding: 'clamp(8px, 1.8vw, 12px)',
                borderRadius: 'clamp(8px, 1.5vw, 12px)',
                fontWeight: 700,
                fontSize: 'clamp(12px, 2.8vw, 16px)',
                border: breedStakeTab === 'stake' ? 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.6)' : 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                background: breedStakeTab === 'stake'
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                  : 'linear-gradient(135deg, rgba(75, 85, 99, 0.2), rgba(55, 65, 81, 0.2))',
                color: breedStakeTab === 'stake' ? 'rgba(6, 182, 212, 1)' : 'rgba(156, 163, 175, 1)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: breedStakeTab === 'stake' ? '0 0 20px rgba(6, 182, 212, 0.3)' : 'none',
              }}
            >
              Apple Staking
            </button>
          </div>

          {/* Description */}
          {!showBreedSuccess && breedStakeTab === 'breed' && (
            <div
              style={{
                fontSize: 'clamp(10px, 2vw, 12px)',
                color: 'rgba(255, 255, 255, 0.6)',
                fontWeight: 500,
                lineHeight: 1.5,
                marginBottom: 'clamp(12px, 2vw, 16px)',
                flexShrink: 0,
              }}
            >
              Feed 3 humans to Wilfred and he will give you an applesnake egg.
            </div>
          )}

          {showBreedSuccess && bredNFT && (
            <div
              style={{
                fontSize: 'clamp(10px, 2vw, 12px)',
                color: 'rgba(255, 255, 255, 0.6)',
                fontWeight: 500,
                lineHeight: 1.5,
                marginBottom: 'clamp(12px, 2vw, 16px)',
                flexShrink: 0,
              }}
            >
              Wilfred has given you a snake egg! Click the egg to view in inventory.
            </div>
          )}

          {/* BREED TAB CONTENT */}
          {breedStakeTab === 'breed' && (
          <>
          {/* Select All/Deselect All Button */}
          {!showBreedSuccess && (
            <div
              style={{
                marginBottom: 'clamp(12px, 2vw, 16px)',
                flexShrink: 0,
              }}
            >
              <button
                onClick={toggleSelectAllHumans}
                style={{
                  width: '100%',
                  padding: 'clamp(8px, 1.6vw, 12px)',
                  backgroundColor: 'rgba(6, 182, 212, 0.2)',
                  border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.4)',
                  borderRadius: 'clamp(8px, 1.5vw, 12px)',
                  color: 'rgba(6, 182, 212, 1)',
                  fontSize: 'clamp(11px, 2.2vw, 13px)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(6, 182, 212, 0.3)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(6, 182, 212, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                }}
              >
                {(() => {
                  const availableHumans = nfts.filter(nft =>
                    !nft.isEgg &&
                    (nft.nftType === 'human' || nft.nftType === 'warden') &&
                    !recentlyBredWardens.has(nft.tokenId)
                  );
                  return selectedHumans.size === Math.min(3, availableHumans.length) && availableHumans.length > 0
                    ? 'Deselect All'
                    : 'Select 3 Humans';
                })()}
              </button>
            </div>
          )}

          {/* Humans Grid / Bred NFT Display */}
          <div
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.8)',
              borderRadius: 'clamp(8px, 1.6vw, 12px)',
              padding: 'clamp(8px, 1.6vw, 12px)',
              marginBottom: 'clamp(6px, 1.2vw, 10px)',
              border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 'clamp(150px, 30vh, 250px)',
            }}
          >
            {!showBreedSuccess && (
              <div
                style={{
                  fontSize: 'clamp(10px, 2vw, 12px)',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontWeight: 600,
                  marginBottom: 'clamp(6px, 1.2vw, 10px)',
                  flexShrink: 0,
                }}
              >
                Your Humans ({nfts.filter(nft =>
                  !nft.isEgg &&
                  (nft.nftType === 'human' || nft.nftType === 'warden') &&
                  !recentlyBredWardens.has(nft.tokenId)
                ).length}) - Select {selectedHumans.size}/3
              </div>
            )}

            {showBreedSuccess && bredNFT ? (
              // Success mode: Show bred egg
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                }}
              >
                <div
                  onClick={() => {
                    setShowBreedSuccess(false);
                    openInventory();
                  }}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: 'clamp(12px, 2vw, 16px)',
                    border: 'clamp(2px, 0.4vw, 3px) solid rgba(34, 197, 94, 0.6)',
                    backgroundColor: 'rgba(17, 24, 39, 0.6)',
                    transition: 'all 0.2s ease',
                    overflow: 'hidden',
                    width: 'clamp(120px, 30vw, 180px)',
                    aspectRatio: '1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.8)';
                    e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)';
                    e.currentTarget.style.backgroundColor = 'rgba(17, 24, 39, 0.6)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img
                      src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${bredNFT.imageUrl}`}
                      alt={bredNFT.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: 'clamp(10px, 1.8vw, 14px)',
                      }}
                      onError={(e) => {
                        // Fallback to a default egg emoji if image fails to load
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.parentElement!.innerHTML = '<div style="font-size: clamp(48px, 12vw, 72px);">🥚</div>';
                      }}
                    />
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 'clamp(6px, 1.2vw, 8px)',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: 'clamp(10px, 2vw, 12px)',
                      color: 'rgba(255, 255, 255, 0.9)',
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      padding: 'clamp(3px, 0.6vw, 4px) clamp(6px, 1.2vw, 8px)',
                      borderRadius: 'clamp(4px, 0.8vw, 6px)',
                      fontWeight: 600,
                    }}
                  >
                    🥚 {bredNFT.name}
                  </div>
                </div>
              </div>
            ) : (
              // Normal mode: Show humans for selection (exclude recently bred)
              (() => {
                const availableHumans = nfts.filter(nft =>
                  !nft.isEgg &&
                  (nft.nftType === 'human' || nft.nftType === 'warden') &&
                  !recentlyBredWardens.has(nft.tokenId)
                );
                return availableHumans.length === 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 1,
                      color: 'rgba(255, 255, 255, 0.4)',
                      fontSize: 'clamp(12px, 2.5vw, 14px)',
                    }}
                  >
                    No humans available
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(70px, 14vw, 100px), 1fr))',
                      gap: 'clamp(12px, 2.4vw, 16px)',
                      maxHeight: 'clamp(150px, 30vh, 250px)',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      padding: 'clamp(8px, 1.6vw, 12px)',
                      backgroundColor: 'rgba(0, 0, 0, 0.2)',
                      borderRadius: 'clamp(6px, 1.2vw, 10px)',
                      border: 'clamp(1px, 0.2vw, 1.5px) solid rgba(6, 182, 212, 0.2)',
                    }}
                  >
                    {availableHumans.map((human) => (
                    <div
                      key={human.tokenId}
                      onClick={() => toggleHuman(human.tokenId)}
                      style={{
                        cursor: 'pointer',
                        aspectRatio: '1 / 1',
                        borderRadius: 'clamp(6px, 1.2vw, 10px)',
                        border: selectedHumans.has(human.tokenId)
                          ? 'clamp(2px, 0.4vw, 3px) solid rgba(6, 182, 212, 1)'
                          : 'clamp(1.5px, 0.3vw, 2px) solid rgba(6, 182, 212, 0.3)',
                        overflow: 'hidden',
                        position: 'relative',
                        boxShadow: selectedHumans.has(human.tokenId)
                          ? '0 0 15px rgba(6, 182, 212, 0.6)'
                          : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                        <img
                          src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${human.imageUrl}`}
                          alt={human.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      </div>
                      {selectedHumans.has(human.tokenId) && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            backgroundColor: 'rgba(6, 182, 212, 1)',
                            color: '#FFFFFF',
                            borderRadius: '50%',
                            width: 'clamp(18px, 3.6vw, 24px)',
                            height: 'clamp(18px, 3.6vw, 24px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'clamp(10px, 2vw, 14px)',
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </div>
                      )}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '2px',
                          left: '2px',
                          right: '2px',
                          fontSize: 'clamp(9px, 1.8vw, 11px)',
                          color: 'rgba(255, 255, 255, 0.9)',
                          backgroundColor: 'rgba(0, 0, 0, 0.7)',
                          padding: 'clamp(2px, 0.4vw, 3px)',
                          textAlign: 'center',
                          fontWeight: 600,
                        }}
                      >
                        #{human.tokenId}
                      </div>
                    </div>
                  ))}
                </div>
                );
              })()
            )}
          </div>

          {/* Wilfred's Fee Information */}
          {!showBreedSuccess && (
            <div
              style={{
                backgroundColor: 'rgba(17, 24, 39, 0.8)',
                borderRadius: 'clamp(8px, 1.6vw, 12px)',
                padding: 'clamp(8px, 1.6vw, 12px)',
                marginBottom: 'clamp(6px, 1.2vw, 10px)',
                border: 'clamp(1.5px, 0.3vw, 2px) solid rgba(75, 85, 99, 0.4)',
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: 'clamp(11px, 2.2vw, 13px)',
                  fontWeight: 600,
                  color: 'rgba(6, 182, 212, 1)',
                }}
              >
                Wilfred&apos;s Fee:
              </span>
              <span
                style={{
                  fontSize: 'clamp(12px, 2.6vw, 15px)',
                  fontWeight: 700,
                  color: 'rgba(6, 182, 212, 1)',
                }}
              >
                {breedFee
                  ? `${(Number(breedFee) / 1e18).toFixed(4)} ETH`
                  : '0.01 ETH'}
              </span>
            </div>
          )}

          {/* Breed Buttons - Two buttons when success, one when breeding */}
          {showBreedSuccess ? (
            <div style={{ display: 'flex', gap: 'clamp(6px, 1.2vw, 10px)', flexShrink: 0 }}>
              {/* Fast Travel to Hatch Button */}
              <button
                onClick={() => {
                  setShowBreedSuccess(false);
                  setShowBreed(false);
                  openHatch();
                }}
                style={{
                  flex: 1,
                  padding: 'clamp(10px, 2vw, 14px)',
                  fontSize: 'clamp(13px, 2.6vw, 16px)',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 1), rgba(139, 92, 246, 1))',
                  border: 'none',
                  borderRadius: 'clamp(10px, 2vw, 14px)',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 0 20px rgba(168, 85, 247, 0.5)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 0 30px rgba(168, 85, 247, 0.7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.5)';
                }}
              >
                🥚 Go to Hatch
              </button>

              {/* Breed More Button */}
              <button
                onClick={() => {
                  setShowBreedSuccess(false);
                  setSelectedHumans(new Set());
                }}
                style={{
                  flex: 1,
                  padding: 'clamp(10px, 2vw, 14px)',
                  fontSize: 'clamp(13px, 2.6vw, 16px)',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  background: 'linear-gradient(135deg, rgba(249, 115, 22, 1), rgba(234, 88, 12, 1))',
                  border: 'none',
                  borderRadius: 'clamp(10px, 2vw, 14px)',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 0 20px rgba(249, 115, 22, 0.5)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 0 30px rgba(249, 115, 22, 0.7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(249, 115, 22, 0.5)';
                }}
              >
                🍽️ Feed Wilfred Again
              </button>
            </div>
          ) : (
            <button
              onClick={handleBreed}
              disabled={!isWalletConnected || selectedHumans.size !== 3 || isConfirming}
              style={{
                width: '100%',
                padding: 'clamp(10px, 2vw, 14px)',
                fontSize: 'clamp(13px, 2.6vw, 16px)',
                fontWeight: 700,
                color: '#FFFFFF',
                background: !isWalletConnected || selectedHumans.size !== 3
                  ? 'rgba(75, 85, 99, 0.5)'
                  : isConfirming
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.8), rgba(168, 85, 247, 0.8))'
                  : 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))',
                border: 'none',
                borderRadius: 'clamp(10px, 2vw, 14px)',
                cursor: (!isWalletConnected || selectedHumans.size !== 3 || isConfirming)
                  ? 'not-allowed'
                  : 'pointer',
                opacity: (!isWalletConnected || selectedHumans.size !== 3 || isConfirming)
                  ? 0.6
                  : 1,
                transition: 'all 0.3s ease',
                flexShrink: 0,
                boxShadow: (isWalletConnected && selectedHumans.size === 3 && !isConfirming)
                  ? '0 0 20px rgba(6, 182, 212, 0.5)'
                  : 'none',
              }}
              onMouseEnter={(e) => {
                if (isWalletConnected && selectedHumans.size === 3 && !isConfirming) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 0 30px rgba(6, 182, 212, 0.7)';
                }
              }}
              onMouseLeave={(e) => {
                if (isWalletConnected && selectedHumans.size === 3 && !isConfirming) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.5)';
                }
              }}
            >
              {!isWalletConnected
                ? 'Connect Wallet'
                : selectedHumans.size !== 3
                ? `Select ${3 - selectedHumans.size} More Human${3 - selectedHumans.size !== 1 ? 's' : ''}`
                : isConfirming
                ? '⏳ Feeding Wilfred...'
                : '🍽️ Feed Wilfred'}
            </button>
          )}
          </>
          )}

          {/* STAKING TAB CONTENT */}
          {breedStakeTab === 'stake' && (
            <StakingInterface
              selectedSnakesForStaking={selectedSnakesForStaking}
              setSelectedSnakesForStaking={setSelectedSnakesForStaking}
              selectedStakedSnakes={selectedStakedSnakes}
              setSelectedStakedSnakes={setSelectedStakedSnakes}
            />
          )}

          {/* Powered by Pairable */}
          <div
            style={{
              marginTop: 'clamp(8px, 1.5vw, 12px)',
              marginBottom: 'clamp(10px, 2vw, 16px)',
              paddingBottom: 'clamp(8px, 1.5vw, 12px)',
              fontSize: 'clamp(9px, 1.8vw, 11px)',
              color: 'rgba(255, 255, 255, 0.4)',
              textAlign: 'center',
              lineHeight: '1.5',
              flexShrink: 0,
            }}
          >
            powered by the <a href="https://pairable.io/#/contracts/superstrat" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(249, 115, 22, 1)', textDecoration: 'none', fontWeight: 600 }}>Pairable</a> NFT super strategy hook
          </div>
          </div>{/* Close content wrapper */}
        </div>
      )}

      {/* Jail Interface */}
      {showJail && <JailInterface onClose={() => setShowJail(false)} />}

      {/* PredictionJack Full-Screen App */}
      {showPredictionJack && (
        <PredictionJackApp
          onClose={() => {
            setShowPredictionJack(false);
            setSharedGameId(null); // Clear shared game ID when closing
          }}
          initialGameId={sharedGameId}
        />
      )}

      {/* CSS animations */}
      <style jsx>{`
        /* Spin animation for loading spinners */
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Idle animations - when sun/moon are at rest in upper left */
        @keyframes sun-bounce-idle {
          0%, 100% {
            transform: translateY(0) rotate(0deg) scale(1);
          }
          25% {
            transform: translateY(-12px) rotate(4deg) scale(1.03);
          }
          50% {
            transform: translateY(-20px) rotate(0deg) scale(1.05);
          }
          75% {
            transform: translateY(-12px) rotate(-4deg) scale(1.03);
          }
        }

        @keyframes moon-float-idle {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          25% {
            transform: translateY(-8px) rotate(-2deg);
          }
          50% {
            transform: translateY(-15px) rotate(0deg);
          }
          75% {
            transform: translateY(-8px) rotate(2deg);
          }
        }

        /* Sun rise animation - rises from below mountains to visible position */
        @keyframes sun-rise {
          0% {
            transform: translateY(600px) rotate(-10deg) scale(0.8);
          }
          100% {
            transform: translateY(0) rotate(0deg) scale(1);
          }
        }

        /* Sun set animation - descends from visible position to below mountains */
        @keyframes sun-set {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
          }
          100% {
            transform: translateY(600px) rotate(10deg) scale(0.8);
          }
        }

        /* Moon rise animation - rises from below mountains to visible position */
        @keyframes moon-rise {
          0% {
            transform: translateY(600px) rotate(10deg) scale(0.75);
          }
          100% {
            transform: translateY(0) rotate(0deg) scale(1);
          }
        }

        /* Moon set animation - descends from visible position to below mountains */
        @keyframes moon-set {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
          }
          100% {
            transform: translateY(600px) rotate(-10deg) scale(0.75);
          }
        }

        /* Hidden state - stays below mountains */
        .animate-sun-hidden {
          transform: translateY(600px);
        }

        .animate-moon-hidden {
          transform: translateY(600px);
        }

        /* Apply animations */
        .animate-sun-idle {
          animation: sun-bounce-idle 4s ease-in-out infinite;
        }

        .animate-moon-idle {
          animation: moon-float-idle 5s ease-in-out infinite;
        }

        .animate-sun-rise {
          animation: sun-rise 5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .animate-sun-set {
          animation: sun-set 5s cubic-bezier(0.64, 0, 0.66, 0.44) forwards;
        }

        .animate-moon-rise {
          animation: moon-rise 5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .animate-moon-set {
          animation: moon-set 5s cubic-bezier(0.64, 0, 0.66, 0.44) forwards;
        }

        /* Spooky cave flicker animation - darkness pulses */
        @keyframes spooky-flicker {
          0% {
            opacity: 0;
          }
          10% {
            opacity: 0.6;
          }
          20% {
            opacity: 0.3;
          }
          30% {
            opacity: 0.8;
          }
          40% {
            opacity: 0.2;
          }
          50% {
            opacity: 0.7;
          }
          60% {
            opacity: 0.4;
          }
          70% {
            opacity: 0.6;
          }
          80% {
            opacity: 0.3;
          }
          90% {
            opacity: 0.5;
          }
          100% {
            opacity: 0;
          }
        }

        .animate-spooky-flicker {
          animation: spooky-flicker 1.5s ease-in-out;
        }
      `}</style>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
