'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useBalance, useSendCalls, useCallsStatus, useSendTransaction, useWalletClient } from 'wagmi';
import { parseEther, formatEther, formatUnits, parseUnits, encodeFunctionData, maxUint160, decodeErrorResult, concat, toHex } from 'viem';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI, UNIVERSAL_ROUTER_ADDRESS, PERMIT2_ADDRESS, TOKEN_PAIRS, getDefaultPair, getTokenPairById, getAllTokenAddresses, ETH_ADDRESS, TokenPairConfig, WASS_TOKEN_ADDRESS, HOOK_ADDRESS, POOL_CONFIG, STATE_VIEW_ADDRESS, AERODROME_ROUTER_ADDRESS, WETH_ADDRESS } from '@/config';
import { AERODROME_ROUTER_ABI, AERODROME_FACTORY_ADDRESS, AERODROME_FACTORY_ABI, AERODROME_POOL_ABI, AERODROME_MIXED_QUOTER_ADDRESS, AERODROME_MIXED_QUOTER_ABI, AERODROME_CL_POOL_ABI, AERODROME_CL_FACTORY_ADDRESS, AERODROME_CL_FACTORY_ABI, SLIPSTREAM_SWAP_ROUTER_ADDRESS, SLIPSTREAM_SWAP_ROUTER_ABI, type AerodromeRoute } from '@/abis/aerodromeRouter';
import { KYBERSWAP_ROUTER_ADDRESS, KYBERSWAP_NATIVE_TOKEN, getKyberSwapQuote, buildKyberSwapTransaction, type KyberSwapRouteSummary } from '@/abis/hydrexRouter';
import { ERC20_ABI } from '@/abis/erc20';
import { base } from 'wagmi/chains';
import { useTransactions } from '@/contexts/TransactionContext';
import { useMultipleTokenInfo, TokenInfo } from '@/hooks/useTokenInfo';
import { PoolTrade, formatRelativeTime, truncateAddress } from '@/hooks/usePoolTrades';

// V4 Command constants for Universal Router
const V4_SWAP = 0x10; // V4_SWAP command
const SWAP_EXACT_IN_SINGLE = 0x06; // Single pool exact input swap
const SWAP_EXACT_IN = 0x07; // Multi-hop exact input swap with path (NOT 0x00!)
const SETTLE_ALL = 0x0c; // Settle all tokens (handles Permit2 automatically)
const TAKE_ALL = 0x0f; // Take all output tokens

// Permit2 ABI for approval
const PERMIT2_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Universal Router V4 ABI for execute
const UNIVERSAL_ROUTER_ABI = [
  {
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

// Extended pair type for Token Wars integration
interface ExtendedPair extends TokenPairConfig {
  isTokenWars?: boolean;
  tokenWarsData?: {
    name: string;
    symbol: string;
    imageUrl: string | null;
    dex?: 'v4' | 'aerodrome' | 'hydrex';
    poolAddress?: string; // Original pool address for Aerodrome/Hydrex swaps
    dexScreenerUrl?: string | null;
  };
}

interface ChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenPrice?: string;
  embedded?: boolean;
  layout?: 'vertical' | 'horizontal';
  onPairChange?: (poolAddress: string) => void;
  onSwapComplete?: () => void;
  trades?: PoolTrade[];
  tradesLoading?: boolean;
  selectedPairId?: string; // External control of selected pair
  externalPairData?: ExtendedPair; // Full pair data for Token Wars or custom pairs
  additionalPairs?: ExtendedPair[]; // Additional pairs from Token Wars
  externalPairChanges?: Map<string, number>; // Price changes passed from parent to avoid duplicate API calls
}

type TimeFrame = '5m' | '15m' | '1h' | '4h' | '1d';
type SwapTab = 'buy' | 'sell';

interface OHLCVData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function ChartModal({ isOpen, onClose, tokenPrice, embedded = false, layout = 'vertical', onPairChange, onSwapComplete, trades = [], tradesLoading = false, selectedPairId, externalPairData, additionalPairs = [], externalPairChanges }: ChartModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);
  const { addTransaction, updateTransaction } = useTransactions();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null);

  // Token pair selection state (using ExtendedPair to preserve isTokenWars flag)
  const [selectedPair, setSelectedPair] = useState<ExtendedPair>(getDefaultPair() as ExtendedPair);
  const [isPairDropdownOpen, setIsPairDropdownOpen] = useState(false);
  const pairDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch token names dynamically via RPC
  const { tokenInfos, isLoading: isLoadingTokenInfo } = useMultipleTokenInfo(getAllTokenAddresses());

  // Combine static TOKEN_PAIRS with additional pairs from Token Wars
  const allPairs = useMemo((): ExtendedPair[] => {
    const staticPairs: ExtendedPair[] = TOKEN_PAIRS.map(p => ({ ...p, isTokenWars: false }));
    return [...staticPairs, ...additionalPairs];
  }, [additionalPairs]);

  // Create maps for Token Wars token symbols and images
  const tokenWarsSymbolMap = useMemo(() => {
    const map = new Map<string, string>();
    additionalPairs.forEach(pair => {
      if (pair.tokenWarsData?.symbol) {
        map.set(pair.token1.toLowerCase(), pair.tokenWarsData.symbol);
      }
    });
    return map;
  }, [additionalPairs]);

  const tokenWarsImageMap = useMemo(() => {
    const map = new Map<string, string>();
    additionalPairs.forEach(pair => {
      if (pair.tokenWarsData?.imageUrl) {
        // Convert IPFS URLs to HTTP gateway URLs
        let imageUrl = pair.tokenWarsData.imageUrl;
        if (imageUrl.startsWith('ipfs://')) {
          imageUrl = `https://ipfs.io/ipfs/${imageUrl.replace('ipfs://', '')}`;
        }
        map.set(pair.token1.toLowerCase(), imageUrl);
      }
    });
    return map;
  }, [additionalPairs]);

  // Helper to get token symbol by address (with Token Wars support)
  const getTokenSymbol = useCallback((address: `0x${string}`): string => {
    if (address === ETH_ADDRESS) return 'ETH';
    if (address.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) return 'wASS';
    // Check Token Wars tokens first
    const twSymbol = tokenWarsSymbolMap.get(address.toLowerCase());
    if (twSymbol) return twSymbol;
    // Fall back to RPC token info
    const info = tokenInfos.get(address.toLowerCase());
    return info?.symbol || `${address.slice(0, 6)}...`;
  }, [tokenInfos, tokenWarsSymbolMap]);

  // Helper to get token image (for Token Wars tokens)
  const getTokenImage = useCallback((address: `0x${string}`): string | null => {
    if (address === ETH_ADDRESS) return '/Images/Ether.png';
    if (address.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) return '/Images/Token.png';
    // MANTIS - our primary token
    if (address.toLowerCase() === '0x92c4cc88e010d772cee651fbfcebc4f0e12d500') return '/Images/Mantis.png';
    // Check Token Wars tokens
    const twImage = tokenWarsImageMap.get(address.toLowerCase());
    if (twImage) return twImage;
    return null;
  }, [tokenWarsImageMap]);

  // Helper to get display name for a pair
  const getPairDisplayName = useCallback((pair: TokenPairConfig): string => {
    const symbol0 = getTokenSymbol(pair.token0);
    const symbol1 = getTokenSymbol(pair.token1);
    return `${symbol0}/${symbol1}`;
  }, [getTokenSymbol]);

  // Check if selected pair is a token pair (not the default wASS/ETH pair)
  // Token Wars pairs with ETH (e.g., ETH/GGG) should also be recognized as token pairs
  const isTokenPair = useMemo(() => {
    // Token Wars pairs are always considered token pairs (even if one side is ETH)
    if (selectedPair.isTokenWars) return true;
    // For non-Token Wars pairs, require both tokens to NOT be ETH (wASS/TOKEN pairs)
    return !selectedPair.isDefault && selectedPair.token0 !== ETH_ADDRESS && selectedPair.token1 !== ETH_ADDRESS;
  }, [selectedPair]);

  // Check if this is a Token Wars ETH pair (ETH/TOKEN, not wASS/TOKEN)
  // These pairs need DIRECT V4 swaps, not multi-hop through wASS
  const isTokenWarsEthPair = useMemo(() => {
    if (!selectedPair.isTokenWars) return false;
    // Check if either token is ETH
    return selectedPair.token0 === ETH_ADDRESS || selectedPair.token1 === ETH_ADDRESS;
  }, [selectedPair]);

  // Check if current pair is an Aerodrome pair
  // First check selectedPair directly (for externalPairData fallback), then allPairs as backup
  const isAerodromePair = useMemo(() => {
    // Direct check on selectedPair (works for externalPairData passed directly)
    if (selectedPair.tokenWarsData?.dex === 'aerodrome') {
      console.log('[isAerodromePair] Detected Aerodrome pair from selectedPair.tokenWarsData');
      return true;
    }
    // Fallback: check allPairs lookup
    const pair = allPairs.find(p => p.id === selectedPair.id);
    const result = pair?.tokenWarsData?.dex === 'aerodrome';
    if (result) {
      console.log('[isAerodromePair] Detected Aerodrome pair from allPairs lookup');
    }
    return result;
  }, [selectedPair, allPairs]);

  // Check if current pair is a Hydrex pair (uses KyberSwap aggregator)
  const isHydrexPair = useMemo(() => {
    // Direct check on selectedPair (works for externalPairData passed directly)
    if (selectedPair.tokenWarsData?.dex === 'hydrex') {
      console.log('[isHydrexPair] Detected Hydrex pair from selectedPair.tokenWarsData');
      return true;
    }
    // Fallback: check allPairs lookup
    const pair = allPairs.find(p => p.id === selectedPair.id);
    const result = pair?.tokenWarsData?.dex === 'hydrex';
    if (result) {
      console.log('[isHydrexPair] Detected Hydrex pair from allPairs lookup');
    }
    return result;
  }, [selectedPair, allPairs]);

  // Check if this Aerodrome pair uses wASS as the base token (instead of WETH)
  // For wASS-paired tokens, we swap wASS ↔ Token instead of ETH ↔ Token
  const isWassPairedAerodrome = useMemo(() => {
    if (!isAerodromePair) return false;
    // Check if token0 or token1 is wASS (and the other is NOT ETH/WETH)
    const token0Lower = selectedPair.token0.toLowerCase();
    const token1Lower = selectedPair.token1.toLowerCase();
    const wassLower = WASS_TOKEN_ADDRESS.toLowerCase();
    const wethLower = WETH_ADDRESS.toLowerCase();
    const ethLower = ETH_ADDRESS.toLowerCase();

    // If token0 is wASS and token1 is NOT WETH/ETH → wASS-paired
    if (token0Lower === wassLower && token1Lower !== wethLower && token1Lower !== ethLower) {
      console.log('[isWassPairedAerodrome] Detected wASS as token0');
      return true;
    }
    // If token1 is wASS and token0 is NOT WETH/ETH → wASS-paired
    if (token1Lower === wassLower && token0Lower !== wethLower && token0Lower !== ethLower) {
      console.log('[isWassPairedAerodrome] Detected wASS as token1');
      return true;
    }
    return false;
  }, [isAerodromePair, selectedPair.token0, selectedPair.token1]);

  // Get the base token address for Aerodrome pairs (WETH for ETH-paired, wASS for wASS-paired)
  const aerodromeBaseToken = useMemo((): `0x${string}` => {
    if (isWassPairedAerodrome) {
      return WASS_TOKEN_ADDRESS;
    }
    return WETH_ADDRESS;
  }, [isWassPairedAerodrome]);

  // Get the output token for token pairs (the non-ETH/non-wASS token)
  const getOutputTokenAddress = useCallback((): `0x${string}` | null => {
    if (!isTokenPair) return null;

    // For Token Wars ETH pairs (ETH/TOKEN), return the non-ETH token
    if (selectedPair.isTokenWars) {
      if (selectedPair.token0 === ETH_ADDRESS) {
        return selectedPair.token1;
      }
      if (selectedPair.token1 === ETH_ADDRESS) {
        return selectedPair.token0;
      }
      // For Token Wars wASS pairs (wASS/TOKEN), return the non-wASS token
      if (selectedPair.token0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) {
        return selectedPair.token1;
      }
      return selectedPair.token0;
    }

    // For non-Token Wars pairs, one is wASS and the other is the output token
    if (selectedPair.token0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) {
      return selectedPair.token1;
    }
    return selectedPair.token0;
  }, [isTokenPair, selectedPair]);

  const outputTokenAddress = getOutputTokenAddress();
  const outputTokenSymbol = outputTokenAddress ? getTokenSymbol(outputTokenAddress) : null;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('1h');
  const [priceChange, setPriceChange] = useState<{ value: number; percent: number } | null>(null);

  // Fast polling mode - increased refresh rate after swaps for faster chart updates
  const [fastPollingUntil, setFastPollingUntil] = useState<number>(0);
  const lastSwapPriceRef = useRef<number | null>(null);
  // Track if initial chart data has been loaded (for incremental updates)
  const hasInitialDataRef = useRef<boolean>(false);
  const lastDataRef = useRef<OHLCVData[]>([]);

  // Price changes for all pairs (for dropdown sorting and display)
  const [allPairChanges, setAllPairChanges] = useState<Map<string, number>>(new Map());

  // Swap state
  const [swapTab, setSwapTab] = useState<SwapTab>('buy');
  const [inputAmount, setInputAmount] = useState<string>('');
  const [outputAmount, setOutputAmount] = useState<string>('');
  const [isQuoting, setIsQuoting] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  // Aerodrome pool info detected during quoting (stable/volatile, pool address)
  const [aerodromePoolInfo, setAerodromePoolInfo] = useState<{ stable: boolean; poolAddress: `0x${string}`; tickSpacing?: number } | null>(null);
  // Hydrex/KyberSwap route info for swaps
  const [hydrexRouteInfo, setHydrexRouteInfo] = useState<{ routeSummary: KyberSwapRouteSummary; routerAddress: string } | null>(null);
  // Discovered pool address for chart loading (used when geckoPoolAddress is empty)
  const [discoveredChartPoolAddress, setDiscoveredChartPoolAddress] = useState<string | null>(null);
  // Input currency for buy mode (ETH or wASS) - wASS only available for token pairs
  const [buyInputCurrency, setBuyInputCurrency] = useState<'eth' | 'wass'>('eth');
  // Output currency for sell mode (wASS or ETH) - ETH requires multi-hop for token pairs
  const [sellOutputCurrency, setSellOutputCurrency] = useState<'wass' | 'eth'>('wass');

  // Transaction state
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { sendTransaction, data: sendTxHash, isPending: isSendPending, error: sendError, reset: resetSendTx } = useSendTransaction();
  const { data: walletClient } = useWalletClient();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash || sendTxHash });

  // Approval state for sells
  const [approvalStep, setApprovalStep] = useState<'none' | 'permit2' | 'router' | 'ready'>('none');
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  // Track what type of transaction is pending (to handle success differently)
  const [pendingTxType, setPendingTxType] = useState<'swap' | 'approval-permit2' | 'approval-router' | 'approval-aerodrome' | 'approval-hydrex' | 'approval-wass-permit2' | 'approval-wass-router' | 'approval-wass-aerodrome' | null>(null);
  // Approval state for buying with wASS (only for token pairs)
  const [buyWassApprovalStep, setBuyWassApprovalStep] = useState<'none' | 'permit2' | 'router' | 'ready'>('none');
  const [isCheckingBuyWassApproval, setIsCheckingBuyWassApproval] = useState(false);
  // Approval state for buying with wASS on Aerodrome pairs (direct approval to router, no Permit2)
  const [wassAerodromeApprovalNeeded, setWassAerodromeApprovalNeeded] = useState(false);
  const [poolKey, setPoolKey] = useState<{
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  } | null>(null);

  // Pool ID for sell operations with deeper liquidity
  const SELL_POOL_ID = '0x6a634d3c93c0b9402392bff565c8315f621558a49e2a00973922322ce19d4abb' as const;

  // Smart wallet batching support (EIP-5792)
  const [isSmartWallet, setIsSmartWallet] = useState(false);
  const [batchCallId, setBatchCallId] = useState<string | null>(null);
  const { sendCalls, isPending: isBatchPending, data: sendCallsData } = useSendCalls();
  const { data: callsStatus } = useCallsStatus({
    id: batchCallId ?? '',
    query: {
      enabled: !!batchCallId,
    },
  });

  // Reset to default pair when modal opens
  useEffect(() => {
    if (isOpen) {
      const defaultPair = getDefaultPair();
      setSelectedPair(defaultPair);
      setIsPairDropdownOpen(false);
      // Notify parent of initial pool for trade history
      if (defaultPair.geckoPoolAddress) {
        onPairChange?.(defaultPair.geckoPoolAddress);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Detect smart wallet (contract account) for batched transactions
  useEffect(() => {
    if (!address || !publicClient) {
      setIsSmartWallet(false);
      return;
    }

    const detectSmartWallet = async () => {
      try {
        // Check if address has bytecode (is a smart contract wallet)
        const bytecode = await publicClient.getBytecode({ address });
        setIsSmartWallet(bytecode !== undefined && bytecode !== '0x');
      } catch {
        setIsSmartWallet(false);
      }
    };

    detectSmartWallet();
  }, [address, publicClient]);

  // Use external price changes when provided (from parent InventorySack)
  // This eliminates duplicate API calls - parent already fetches for sidebar display
  useEffect(() => {
    if (!isOpen) return;

    // If external price changes are provided, use them directly
    if (externalPairChanges && externalPairChanges.size > 0) {
      setAllPairChanges(externalPairChanges);
      return;
    }

    // Fallback: fetch price changes if not provided externally
    // This is only used when ChartModal is used standalone (not embedded)
    const fetchAllPairChanges = async () => {
      const changes = new Map<string, number>();

      // Batch requests to avoid rate limiting (3 at a time)
      const batchSize = 3;
      const pairs = allPairs.filter(p => p.geckoPoolAddress);

      for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (pair) => {
            try {
              const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pair.geckoPoolAddress}/ohlcv/hour?aggregate=1&limit=24&currency=usd`;
              const response = await fetch(url);

              if (!response.ok) {
                changes.set(pair.id, 0);
                return;
              }

              const json = await response.json();
              const ohlcvList = json?.data?.attributes?.ohlcv_list || [];

              if (ohlcvList.length >= 2) {
                const oldestPrice = ohlcvList[ohlcvList.length - 1]?.[1] || 0;
                const newestPrice = ohlcvList[0]?.[4] || 0;
                if (oldestPrice > 0) {
                  const percentChange = ((newestPrice - oldestPrice) / oldestPrice) * 100;
                  changes.set(pair.id, percentChange);
                } else {
                  changes.set(pair.id, 0);
                }
              } else {
                changes.set(pair.id, 0);
              }
            } catch {
              changes.set(pair.id, 0);
            }
          })
        );

        // Small delay between batches
        if (i + batchSize < pairs.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Set 0 for pairs without geckoPoolAddress
      allPairs.forEach(pair => {
        if (!pair.geckoPoolAddress && !changes.has(pair.id)) {
          changes.set(pair.id, 0);
        }
      });

      setAllPairChanges(changes);
    };

    fetchAllPairChanges();
  }, [isOpen, allPairs, externalPairChanges]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pairDropdownRef.current && !pairDropdownRef.current.contains(event.target as Node)) {
        setIsPairDropdownOpen(false);
      }
    };

    if (isPairDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPairDropdownOpen]);

  // Handle pair selection (accepts ExtendedPair to preserve isTokenWars flag)
  const handlePairSelect = (pair: ExtendedPair | TokenPairConfig) => {
    setSelectedPair(pair as ExtendedPair);
    setIsPairDropdownOpen(false);
    setPriceChange(null);
    // Notify parent of pool change for trade history
    if (pair.geckoPoolAddress) {
      onPairChange?.(pair.geckoPoolAddress);
    }
    setInputAmount('');
    setOutputAmount('');
    // Reset buy input currency to ETH when switching pairs (wASS only available for token pairs)
    setBuyInputCurrency('eth');
    // Reset sell output currency based on pair type
    // Token Wars ETH pairs can ONLY sell to ETH (no wASS in the pool)
    const extPair = pair as ExtendedPair;
    const isEthPair = extPair.isTokenWars && (extPair.token0 === ETH_ADDRESS || extPair.token1 === ETH_ADDRESS);
    setSellOutputCurrency(isEthPair ? 'eth' : 'wass');
    // Reset approval states when switching pairs (force re-check)
    setApprovalStep('none');
    setBuyWassApprovalStep('none');
    // Refetch allowances for the new token (after state updates)
    setTimeout(() => {
      refetchPermit2Allowance();
      refetchRouterAllowance();
      refetchWassPermit2Allowance();
      refetchWassRouterAllowance();
    }, 100);
    // Clear chart data and reset time scale to prepare for new data
    // This ensures the chart starts fresh and fitContent() can properly adjust the view
    if (seriesRef.current && chartRef.current) {
      seriesRef.current.setData([]);
      // Reset time scale to ensure clean state for new pair
      chartRef.current.timeScale().resetTimeScale();
    }
  };

  // Watch for external pair selection changes (from sidebar)
  // Supports both static pairs (via selectedPairId) and custom pairs (via externalPairData)
  useEffect(() => {
    // First check for externalPairData (used for Token Wars pairs)
    if (externalPairData && externalPairData.id !== selectedPair.id) {
      console.log(`[ChartModal] Received external pair data:`, {
        id: externalPairData.id,
        geckoPoolAddress: externalPairData.geckoPoolAddress,
        isTokenWars: externalPairData.isTokenWars,
        tokenWarsData: externalPairData.tokenWarsData,
      });
      handlePairSelect(externalPairData);
      return;
    }
    // Fall back to selectedPairId for static pairs
    if (selectedPairId && selectedPairId !== selectedPair.id) {
      const pair = getTokenPairById(selectedPairId);
      if (pair) {
        handlePairSelect(pair);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPairId, externalPairData]);

  // Discover pool address for Aerodrome pairs when geckoPoolAddress is empty
  // This enables chart loading for Aerodrome CL pools by looking up the pool from the factory
  useEffect(() => {
    const discoverAerodromePoolAddress = async () => {
      // Reset discovered address when pair changes
      setDiscoveredChartPoolAddress(null);

      // Only proceed if this is an Aerodrome pair with no geckoPoolAddress
      if (!isAerodromePair || !outputTokenAddress || !publicClient) return;

      const currentGeckoAddr = selectedPair.geckoPoolAddress;
      if (currentGeckoAddr && currentGeckoAddr !== '0x' && currentGeckoAddr.length > 10) {
        // Already have a valid address
        return;
      }

      console.log('[Chart] Discovering pool address for Aerodrome pair...');

      // Try common CL tickSpacings to find the pool
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;
      const tickSpacingsToTry = [2000, 200, 100, 50, 1];

      for (const tickSpacing of tickSpacingsToTry) {
        try {
          const discoveredPool = await publicClient.readContract({
            address: AERODROME_CL_FACTORY_ADDRESS,
            abi: AERODROME_CL_FACTORY_ABI,
            functionName: 'getPool',
            args: [WETH_ADDRESS, outputTokenAddress, tickSpacing],
          }) as `0x${string}`;

          if (discoveredPool && discoveredPool !== ZERO_ADDRESS) {
            console.log('[Chart] Discovered CL pool:', discoveredPool, 'tickSpacing:', tickSpacing);
            setDiscoveredChartPoolAddress(discoveredPool);
            return;
          }
        } catch {
          // Try next tickSpacing
        }
      }

      // Try V2 factory as fallback
      try {
        // Volatile pool
        const volatilePool = await publicClient.readContract({
          address: AERODROME_FACTORY_ADDRESS,
          abi: AERODROME_FACTORY_ABI,
          functionName: 'getPool',
          args: [WETH_ADDRESS, outputTokenAddress, false],
        }) as `0x${string}`;

        if (volatilePool && volatilePool !== ZERO_ADDRESS) {
          console.log('[Chart] Discovered V2 volatile pool:', volatilePool);
          setDiscoveredChartPoolAddress(volatilePool);
          return;
        }
      } catch {
        // Continue to stable check
      }

      try {
        // Stable pool
        const stablePool = await publicClient.readContract({
          address: AERODROME_FACTORY_ADDRESS,
          abi: AERODROME_FACTORY_ABI,
          functionName: 'getPool',
          args: [WETH_ADDRESS, outputTokenAddress, true],
        }) as `0x${string}`;

        if (stablePool && stablePool !== ZERO_ADDRESS) {
          console.log('[Chart] Discovered V2 stable pool:', stablePool);
          setDiscoveredChartPoolAddress(stablePool);
          return;
        }
      } catch {
        console.log('[Chart] Failed to discover any Aerodrome pool');
      }
    };

    discoverAerodromePoolAddress();
  }, [isAerodromePair, outputTokenAddress, selectedPair.geckoPoolAddress, publicClient]);

  // Get ETH balance
  const { data: ethBalanceData } = useBalance({
    address: address,
    chainId: base.id,
  });

  // Get wASS token balance
  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  // Get output token balance for token pairs
  const { data: outputTokenBalanceData, refetch: refetchOutputTokenBalance } = useReadContract({
    address: outputTokenAddress || '0x0000000000000000000000000000000000000000',
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address && outputTokenAddress ? [address] : undefined,
    chainId: base.id,
  });

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';
  const tokenBalance = tokenBalanceData ? formatUnits(tokenBalanceData as bigint, 18) : '0';
  const outputTokenBalance = outputTokenBalanceData ? formatUnits(outputTokenBalanceData as bigint, 18) : '0';

  // Get the correct sell balance based on whether it's a token pair
  const sellBalance = isTokenPair ? outputTokenBalance : tokenBalance;

  // Determine which token to check approval for (wASS for default, output token for token pairs)
  const sellTokenAddress = isTokenPair && outputTokenAddress ? outputTokenAddress : contracts.token.address;

  // Check ERC20 allowance for Permit2
  const { data: permit2Allowance, refetch: refetchPermit2Allowance } = useReadContract({
    address: sellTokenAddress,
    abi: contracts.token.abi,
    functionName: 'allowance',
    args: address ? [address, PERMIT2_ADDRESS] : undefined,
    chainId: base.id,
  });

  // Check Permit2 allowance for Universal Router
  const { data: routerAllowanceData, refetch: refetchRouterAllowance } = useReadContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: address ? [address, sellTokenAddress, UNIVERSAL_ROUTER_ADDRESS] : undefined,
    chainId: base.id,
  });

  // Check wASS allowance for Permit2 (for buying with wASS on token pairs)
  const { data: wassPermit2Allowance, refetch: refetchWassPermit2Allowance } = useReadContract({
    address: contracts.token.address as `0x${string}`,
    abi: contracts.token.abi,
    functionName: 'allowance',
    args: address ? [address, PERMIT2_ADDRESS] : undefined,
    chainId: base.id,
  });

  // Check wASS Permit2 allowance for Universal Router (for buying with wASS on token pairs)
  const { data: wassRouterAllowanceData, refetch: refetchWassRouterAllowance } = useReadContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: address ? [address, contracts.token.address, UNIVERSAL_ROUTER_ADDRESS] : undefined,
    chainId: base.id,
  });

  // Check wASS allowance for Aerodrome Router (for buying on wASS-paired Aerodrome tokens)
  const { data: wassAerodromeAllowance, refetch: refetchWassAerodromeAllowance } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, AERODROME_ROUTER_ADDRESS] : undefined,
    chainId: base.id,
  });

  // Check wASS allowance for Slipstream Router (for buying on wASS-paired CL pools)
  const { data: wassSlipstreamAllowance, refetch: refetchWassSlipstreamAllowance } = useReadContract({
    address: WASS_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, SLIPSTREAM_SWAP_ROUTER_ADDRESS] : undefined,
    chainId: base.id,
  });

  // Handle sendCalls result - set batchCallId when we get a response
  useEffect(() => {
    if (sendCallsData?.id) {
      setBatchCallId(sendCallsData.id);
      addTransaction(sendCallsData.id as `0x${string}`, `Batched Transaction`);
    }
  }, [sendCallsData, addTransaction]);

  // Handle batch call completion (for smart wallet batched transactions)
  useEffect(() => {
    if (!callsStatus || !batchCallId) return;

    if (callsStatus.status === 'success') {
      // Batch call succeeded - refetch balances and allowances
      refetchTokenBalance();
      refetchOutputTokenBalance();
      refetchPermit2Allowance();
      refetchRouterAllowance();
      setInputAmount('');
      setOutputAmount('');
      setBatchCallId(null);
      setApprovalStep('none');
      // Enable fast polling mode for faster chart updates after swap
      enableFastPolling();
      // Apply optimistic chart update with last known price
      if (lastSwapPriceRef.current) {
        applyOptimisticUpdate(lastSwapPriceRef.current);
      }
      // Notify parent to refresh trade history
      onSwapComplete?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsStatus, batchCallId, refetchTokenBalance, refetchOutputTokenBalance, refetchPermit2Allowance, refetchRouterAllowance]);

  // Fetch pool key on mount
  useEffect(() => {
    if (!publicClient || poolKey) return;

    const fetchPoolKey = async () => {
      try {
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

        const key = await publicClient.readContract({
          address: hookAddress,
          abi: [{
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [{
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
            }],
            stateMutability: 'view',
            type: 'function',
          }],
          functionName: 'getPoolKey',
          args: [poolIdRaw],
        }) as unknown as {
          currency0: `0x${string}`;
          currency1: `0x${string}`;
          fee: number;
          tickSpacing: number;
          hooks: `0x${string}`;
        };

        setPoolKey(key);
      } catch (err) {
        console.error('Error fetching pool key:', err);
      }
    };

    fetchPoolKey();
  }, [publicClient, contracts.nft.address, contracts.nft.abi, poolKey]);

  // Check approval status when tab changes to sell or input changes
  useEffect(() => {
    if (swapTab !== 'sell' || !address || !inputAmount || parseFloat(inputAmount) <= 0) {
      setApprovalStep('none');
      return;
    }

    const checkApprovals = async () => {
      setIsCheckingApproval(true);
      try {
        const sellAmount = parseUnits(inputAmount, 18);

        // For Aerodrome pairs, check direct ERC20 approval to the correct router
        // CL pools use Slipstream SwapRouter, V2 pools use Aerodrome Router
        if (isAerodromePair && outputTokenAddress && publicClient) {
          const isCLPool = aerodromePoolInfo?.tickSpacing !== undefined && aerodromePoolInfo.tickSpacing > 0;
          const routerToCheck = isCLPool ? SLIPSTREAM_SWAP_ROUTER_ADDRESS : AERODROME_ROUTER_ADDRESS;

          const aerodromeAllowance = await publicClient.readContract({
            address: outputTokenAddress,
            abi: [{
              inputs: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
              ],
              name: 'allowance',
              outputs: [{ name: '', type: 'uint256' }],
              stateMutability: 'view',
              type: 'function',
            }],
            functionName: 'allowance',
            args: [address, routerToCheck],
          }) as bigint;

          console.log(`${isCLPool ? 'Slipstream' : 'Aerodrome'} Router allowance:`, formatUnits(aerodromeAllowance, 18));
          console.log('Sell amount:', formatUnits(sellAmount, 18));
          console.log('Router to approve:', routerToCheck);

          if (aerodromeAllowance < sellAmount) {
            setApprovalStep('permit2'); // Reuse 'permit2' step for Aerodrome approval
            setIsCheckingApproval(false);
            return;
          }

          setApprovalStep('ready');
          setIsCheckingApproval(false);
          return;
        }

        // For Hydrex pairs, check direct ERC20 approval to KyberSwap Router
        if (isHydrexPair && outputTokenAddress && publicClient) {
          const kyberAllowance = await publicClient.readContract({
            address: outputTokenAddress,
            abi: [{
              inputs: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
              ],
              name: 'allowance',
              outputs: [{ name: '', type: 'uint256' }],
              stateMutability: 'view',
              type: 'function',
            }],
            functionName: 'allowance',
            args: [address, KYBERSWAP_ROUTER_ADDRESS],
          }) as bigint;

          console.log('[Hydrex] KyberSwap Router allowance:', formatUnits(kyberAllowance, 18));
          console.log('[Hydrex] Sell amount:', formatUnits(sellAmount, 18));

          if (kyberAllowance < sellAmount) {
            setApprovalStep('permit2'); // Reuse 'permit2' step for Hydrex approval
            setIsCheckingApproval(false);
            return;
          }

          setApprovalStep('ready');
          setIsCheckingApproval(false);
          return;
        }

        // Check ERC20 allowance for Permit2 (for V4 pairs)
        const erc20Allowance = permit2Allowance as bigint | undefined;
        if (!erc20Allowance || erc20Allowance < sellAmount) {
          setApprovalStep('permit2');
          return;
        }

        // Check Permit2 allowance for Universal Router
        const allowanceResult = routerAllowanceData as unknown as readonly [bigint, bigint, bigint] | undefined;
        const [amount, expiration] = allowanceResult || [0n, 0n, 0n];
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        if (amount < BigInt(sellAmount.toString()) || expiration < currentTime) {
          setApprovalStep('router');
          return;
        }

        setApprovalStep('ready');
      } catch (err) {
        console.error('Error checking approvals:', err);
        setApprovalStep('permit2'); // Default to needing approval on error
      } finally {
        setIsCheckingApproval(false);
      }
    };

    checkApprovals();
  }, [swapTab, address, inputAmount, permit2Allowance, routerAllowanceData, sellTokenAddress, isTokenPair, isAerodromePair, isHydrexPair, outputTokenAddress, publicClient, aerodromePoolInfo]);

  // Check approvals when buying with wASS (only for token pairs)
  useEffect(() => {
    // Only check when buying with wASS on token pairs
    if (swapTab !== 'buy' || buyInputCurrency !== 'wass' || !isTokenPair) {
      setBuyWassApprovalStep('none');
      return;
    }

    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) {
      setBuyWassApprovalStep('none');
      return;
    }

    const checkWassApprovals = async () => {
      setIsCheckingBuyWassApproval(true);
      try {
        const buyAmount = parseUnits(inputAmount, 18);

        // Check wASS ERC20 allowance for Permit2
        const erc20Allowance = wassPermit2Allowance as bigint | undefined;
        if (!erc20Allowance || erc20Allowance < buyAmount) {
          setBuyWassApprovalStep('permit2');
          return;
        }

        // Check wASS Permit2 allowance for Universal Router
        const allowanceResult = wassRouterAllowanceData as unknown as readonly [bigint, bigint, bigint] | undefined;
        const [amount, expiration] = allowanceResult || [0n, 0n, 0n];
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        if (amount < BigInt(buyAmount.toString()) || expiration < currentTime) {
          setBuyWassApprovalStep('router');
          return;
        }

        setBuyWassApprovalStep('ready');
      } catch (err) {
        console.error('Error checking wASS approvals:', err);
        setBuyWassApprovalStep('permit2'); // Default to needing approval on error
      } finally {
        setIsCheckingBuyWassApproval(false);
      }
    };

    checkWassApprovals();
  }, [swapTab, buyInputCurrency, address, inputAmount, wassPermit2Allowance, wassRouterAllowanceData, isTokenPair]);

  // Check wASS approval for wASS-paired Aerodrome tokens (direct approval to router)
  useEffect(() => {
    // Only check when buying on wASS-paired Aerodrome tokens
    if (swapTab !== 'buy' || !isWassPairedAerodrome) {
      setWassAerodromeApprovalNeeded(false);
      return;
    }

    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) {
      setWassAerodromeApprovalNeeded(false);
      return;
    }

    const checkWassAerodromeApproval = async () => {
      const buyAmount = parseUnits(inputAmount, 18);

      // Check if this is a CL pool or V2 pool
      const isCLPool = aerodromePoolInfo?.tickSpacing !== undefined && aerodromePoolInfo.tickSpacing > 0;

      if (isCLPool) {
        // CL pool: Check approval to Slipstream Router
        const allowance = wassSlipstreamAllowance as bigint | undefined;
        const needsApproval = !allowance || allowance < buyAmount;
        console.log('[wASS-Aerodrome CL] Approval check:', { allowance: allowance?.toString(), buyAmount: buyAmount.toString(), needsApproval });
        setWassAerodromeApprovalNeeded(needsApproval);
      } else {
        // V2 pool: Check approval to Aerodrome Router
        const allowance = wassAerodromeAllowance as bigint | undefined;
        const needsApproval = !allowance || allowance < buyAmount;
        console.log('[wASS-Aerodrome V2] Approval check:', { allowance: allowance?.toString(), buyAmount: buyAmount.toString(), needsApproval });
        setWassAerodromeApprovalNeeded(needsApproval);
      }
    };

    checkWassAerodromeApproval();
  }, [swapTab, isWassPairedAerodrome, address, inputAmount, wassAerodromeAllowance, wassSlipstreamAllowance, aerodromePoolInfo?.tickSpacing]);

  // Auto-set buyInputCurrency to 'wass' for wASS-paired Aerodrome tokens
  // (can't use ETH directly - no ETH pool exists)
  useEffect(() => {
    if (isWassPairedAerodrome && buyInputCurrency !== 'wass') {
      console.log('[wASS-paired Aerodrome] Auto-setting buyInputCurrency to wass');
      setBuyInputCurrency('wass');
    }
  }, [isWassPairedAerodrome, buyInputCurrency]);

  // Get DEX type for current selected pair
  const selectedPairDex = useMemo((): 'v4' | 'aerodrome' | 'hydrex' | undefined => {
    // Find the pair in allPairs to get its tokenWarsData
    const pair = allPairs.find(p => p.id === selectedPair.id);
    return pair?.tokenWarsData?.dex;
  }, [allPairs, selectedPair.id]);

  // Check if current pair is tradeable in-app (V4, Aerodrome, and Hydrex supported)
  const isTradeableInApp = useMemo(() => {
    // Static pairs (wASS/ETH) are always tradeable
    if (!selectedPair.isDefault) {
      const pair = allPairs.find(p => p.id === selectedPair.id);
      // V4, Aerodrome, and Hydrex Token Wars tokens are tradeable in-app
      if (pair?.isTokenWars && pair?.tokenWarsData?.dex) {
        const supportedDexes = ['v4', 'aerodrome', 'hydrex'];
        if (!supportedDexes.includes(pair.tokenWarsData.dex)) {
          return false;
        }
      }
    }
    return true;
  }, [selectedPair, allPairs]);

  // Get external DEX URL for non-V4 tokens
  const externalDexUrl = useMemo(() => {
    const pair = allPairs.find(p => p.id === selectedPair.id);
    if (!pair?.tokenWarsData) return null;

    const { dex, poolAddress, dexScreenerUrl } = pair.tokenWarsData;

    if (dex === 'aerodrome' && poolAddress) {
      // Aerodrome swap URL
      return `https://aerodrome.finance/swap?to=${pair.token1}`;
    }
    if (dex === 'hydrex' && poolAddress) {
      // Hydrex swap URL - adjust based on actual Hydrex URL structure
      return `https://hydrex.exchange/swap?token=${pair.token1}`;
    }
    // Fallback to DexScreener if available
    return dexScreenerUrl || null;
  }, [selectedPair.id, allPairs]);

  // Fetch OHLCV data from GeckoTerminal API
  // All Base DEXes (V4, Aerodrome, Hydrex) use the same 'base' network ID
  const fetchOHLCVData = useCallback(async (tf: TimeFrame, poolAddr: string, dex?: 'v4' | 'aerodrome' | 'hydrex'): Promise<OHLCVData[]> => {
    // If no pool address available, return empty data
    if (!poolAddr) {
      console.log('[Chart] No pool address available for chart');
      return [];
    }

    console.log(`[Chart] Fetching OHLCV for pool: ${poolAddr} (dex: ${dex || 'default'})`);

    const timeframeMap: Record<TimeFrame, string> = {
      '5m': 'minute',
      '15m': 'minute',
      '1h': 'hour',
      '4h': 'hour',
      '1d': 'day',
    };

    const aggregateMap: Record<TimeFrame, number> = {
      '5m': 5,
      '15m': 15,
      '1h': 1,
      '4h': 4,
      '1d': 1,
    };

    const timeframe = timeframeMap[tf];
    const aggregate = aggregateMap[tf];

    // Use 'base' network for all pools (GeckoTerminal uses same network ID for all Base DEXes)
    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddr}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=300&currency=usd`;
    console.log("[Chart] Fetching from URL:", url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch chart data');
    }

    const data = await response.json();
    const ohlcvList = data?.data?.attributes?.ohlcv_list || [];
    console.log('[Chart] API response:', { hasData: !!data, ohlcvCount: ohlcvList.length, poolId: data?.data?.id });

    return ohlcvList.map((item: number[]) => ({
      time: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5],
    })).reverse();
  }, []);

  // Apply optimistic update to chart after swap - immediately shows trade impact
  const applyOptimisticUpdate = useCallback((swapPrice: number | null) => {
    if (!seriesRef.current || !swapPrice) return;

    // Get current data from series
    const series = seriesRef.current as ISeriesApi<'Candlestick'>;

    // Use series.update() to modify the last candle with the new price
    // This creates an instant visual update while waiting for GeckoTerminal to index
    const now = Math.floor(Date.now() / 1000);
    const lastCandleTime = now - (now % 3600); // Round to current hour

    // Update the current candle to show price impact
    series.update({
      time: lastCandleTime as Time,
      open: swapPrice,
      high: swapPrice,
      low: swapPrice,
      close: swapPrice,
    });

    // Scroll to show the update
    chartRef.current?.timeScale().scrollToRealTime();
  }, []);

  // Enable fast polling mode for 30 seconds after a swap
  const enableFastPolling = useCallback(() => {
    setFastPollingUntil(Date.now() + 30000); // 30 seconds of fast polling
  }, []);

  // Initialize chart
  useEffect(() => {
    if (!isOpen || !chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: 'rgba(255, 255, 255, 0.7)',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 208, 117, 0.08)' },
        horzLines: { color: 'rgba(255, 208, 117, 0.08)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(255, 208, 117, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(255, 208, 117, 0.9)',
        },
        horzLine: {
          color: 'rgba(255, 208, 117, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(255, 208, 117, 0.9)',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 208, 117, 0.15)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(255, 208, 117, 0.15)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: true },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#FF3B5C',
      borderUpColor: '#22c55e',
      borderDownColor: '#FF3B5C',
      wickUpColor: '#22c55e',
      wickDownColor: '#FF3B5C',
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [isOpen]);

  // Compute effective pool address for chart (use discovered address as fallback for Aerodrome)
  const effectiveChartPoolAddress = useMemo(() => {
    const geckoAddr = selectedPair.geckoPoolAddress;
    // Debug: Log chart pool address resolution
    console.log('[Chart] Pool address resolution:', { pairId: selectedPair.id, geckoPoolAddress: geckoAddr, isTokenWars: selectedPair.isTokenWars, isAerodromePair });
    // If geckoPoolAddress is valid, use it
    if (geckoAddr && geckoAddr !== '0x' && geckoAddr.length > 10) {
      return geckoAddr;
    }
    // For Aerodrome pairs, use discovered address
    if (isAerodromePair && discoveredChartPoolAddress) {
      return discoveredChartPoolAddress;
    }
    return null;
  }, [selectedPair.geckoPoolAddress, isAerodromePair, discoveredChartPoolAddress]);

  // Reset initial data flag when pair or timeframe changes
  useEffect(() => {
    hasInitialDataRef.current = false;
    lastDataRef.current = [];
  }, [effectiveChartPoolAddress, timeFrame]);

  // Fetch and update data when timeframe or selected pair changes
  useEffect(() => {
    if (!isOpen || !seriesRef.current) return;

    // Initial load - full data replacement with loading state
    const loadInitialData = async () => {
      setIsLoading(true);
      setError(null);

      if (!effectiveChartPoolAddress) {
        // For Aerodrome pairs, show a more helpful message
        if (isAerodromePair) {
          setError('Discovering pool address...');
        } else {
          setError('Chart data not yet available for this pair');
        }
        setIsLoading(false);
        seriesRef.current?.setData([]);
        return;
      }

      try {
        const data = await fetchOHLCVData(timeFrame, effectiveChartPoolAddress, selectedPairDex);

        if (data.length === 0) {
          setError('No data available');
          setIsLoading(false);
          return;
        }

        const chartData: CandlestickData<Time>[] = data.map((item) => ({
          time: item.time as Time,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
        }));

        seriesRef.current?.setData(chartData);
        // Use multiple requestAnimationFrame calls to ensure chart has fully processed new data
        // A single rAF may not be enough as TradingView charts can take multiple frames to render
        // This fixes the issue where switching pairs shows a blank screen (view stuck on old range)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (chartRef.current) {
              chartRef.current.timeScale().fitContent();
              // Also scroll to the most recent data to ensure visibility
              chartRef.current.timeScale().scrollToRealTime();
            }
          });
        });
        hasInitialDataRef.current = true;
        lastDataRef.current = data;

        if (data.length >= 2) {
          const firstPrice = data[0].open;
          const lastPrice = data[data.length - 1].close;
          const change = lastPrice - firstPrice;
          const percentChange = (change / firstPrice) * 100;
          setPriceChange({ value: change, percent: percentChange });
          lastSwapPriceRef.current = lastPrice;
        }
      } catch (err) {
        console.error('Error fetching chart data:', err);
        setError('Failed to load chart data');
      } finally {
        setIsLoading(false);
      }
    };

    // Incremental update - use series.update() to avoid flicker
    // Per TradingView docs: https://tradingview.github.io/lightweight-charts/tutorials/demos/realtime-updates
    const updateData = async () => {
      if (!effectiveChartPoolAddress || !hasInitialDataRef.current) return;

      try {
        const data = await fetchOHLCVData(timeFrame, effectiveChartPoolAddress, selectedPairDex);
        if (data.length === 0) return;

        const series = seriesRef.current as ISeriesApi<'Candlestick'>;
        if (!series) return;

        // Compare with last data to find new/updated candles
        const lastData = lastDataRef.current;

        // Find candles that are new or updated (same time but different values)
        for (const item of data) {
          const existingCandle = lastData.find(d => d.time === item.time);

          if (!existingCandle ||
              existingCandle.close !== item.close ||
              existingCandle.high !== item.high ||
              existingCandle.low !== item.low) {
            // Use series.update() for incremental updates - no flicker!
            series.update({
              time: item.time as Time,
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
            });
          }
        }

        // Store for next comparison
        lastDataRef.current = data;

        // Update price change display
        if (data.length >= 2) {
          const firstPrice = data[0].open;
          const lastPrice = data[data.length - 1].close;
          const change = lastPrice - firstPrice;
          const percentChange = (change / firstPrice) * 100;
          setPriceChange({ value: change, percent: percentChange });
          lastSwapPriceRef.current = lastPrice;
        }
      } catch (err) {
        // Silent fail for background updates - don't disrupt UI
        console.warn('Background chart update failed:', err);
      }
    };

    // Load initial data
    loadInitialData();

    // Dynamic polling interval:
    // - 5s when fast polling (after swap) to quickly show trade impact
    // - 30s normally to reduce API load (GeckoTerminal has rate limits)
    // This is a significant reduction from the previous 5s default to avoid rate limiting
    const getPollingInterval = () => {
      const isFastPolling = Date.now() < fastPollingUntil;
      return isFastPolling ? 5000 : 30000;
    };

    // Use incremental updates for polling (no flicker)
    let timeoutId: NodeJS.Timeout;
    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        updateData(); // Use incremental update, not full reload
        scheduleNext();
      }, getPollingInterval());
    };
    scheduleNext();

    return () => clearTimeout(timeoutId);
  }, [isOpen, timeFrame, selectedPair, fetchOHLCVData, fastPollingUntil, selectedPairDex, effectiveChartPoolAddress, isAerodromePair]);

  // Fetch quote when input changes
  useEffect(() => {
    if (!publicClient || !inputAmount || parseFloat(inputAmount) <= 0) {
      setOutputAmount('');
      return;
    }

    const fetchQuote = async () => {
      setIsQuoting(true);
      setSwapError(null);

      // Debug logging for Token Wars quote flow
      console.log('=== QUOTE FLOW DEBUG START ===');
      console.log('Selected pair:', {
        id: selectedPair.id,
        token0: selectedPair.token0,
        token1: selectedPair.token1,
        fee: selectedPair.fee,
        tickSpacing: selectedPair.tickSpacing,
        hook: selectedPair.hook,
        isTokenWars: selectedPair.isTokenWars,
        tokenWarsData: selectedPair.tokenWarsData,
        geckoPoolAddress: selectedPair.geckoPoolAddress,
      });
      console.log('Quote path flags:', {
        isTokenPair,
        isTokenWarsEthPair,
        isAerodromePair,
        isHydrexPair,
        swapTab,
        buyInputCurrency,
        sellOutputCurrency,
        outputTokenAddress,
      });

      try {
        // Helper to get quote using simulateContract (works for ETH/wASS pool)
        const getSimulateQuote = async (
          poolKeyData: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` },
          zeroForOne: boolean,
          exactAmount: bigint
        ): Promise<bigint> => {
          const result = await publicClient.simulateContract({
            address: QUOTER_ADDRESS,
            abi: QUOTER_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{
              poolKey: poolKeyData,
              zeroForOne: zeroForOne,
              exactAmount: BigInt(exactAmount.toString()),
              hookData: '0x',
            }],
          });
          const [amountOut] = result.result as [bigint, bigint];
          return amountOut;
        };

        // Helper to sort tokens (Aerodrome stores pools with sorted tokens)
        const sortTokens = (tokenA: `0x${string}`, tokenB: `0x${string}`): [`0x${string}`, `0x${string}`] => {
          return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
        };

        // Helper to check if Aerodrome pool exists and get its address
        const getAerodromePool = async (
          tokenA: `0x${string}`,
          tokenB: `0x${string}`,
          stable: boolean
        ): Promise<`0x${string}` | null> => {
          try {
            // CRITICAL: Sort tokens before factory lookup
            // Aerodrome factory stores pools with sorted tokens (lower address first)
            const [token0, token1] = sortTokens(tokenA, tokenB);

            console.log(`[Aerodrome] getPool lookup: token0=${token0}, token1=${token1}, stable=${stable}`);

            const poolAddress = await publicClient.readContract({
              address: AERODROME_FACTORY_ADDRESS,
              abi: AERODROME_FACTORY_ABI,
              functionName: 'getPool',
              args: [token0, token1, stable],
            }) as `0x${string}`;

            // Check if pool exists (not zero address)
            if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
              console.log(`[Aerodrome] Found pool at ${poolAddress}`);
              return poolAddress;
            }
            console.log(`[Aerodrome] No pool found for ${token0}/${token1} stable=${stable}`);
            return null;
          } catch (err) {
            console.warn(`[Aerodrome] getPool failed for ${tokenA}/${tokenB} stable=${stable}:`, err);
            return null;
          }
        };

        // Aerodrome quote using path-based MixedQuoter (works for both CL and V2 pools)
        // Path encoding: tokenIn (20 bytes) + filler (3 bytes as int24) + tokenOut (20 bytes)
        // For CL pools: filler = tickSpacing
        // For V2 volatile: filler = 0x400000 (4194304)
        // For V2 stable: filler = 0x200000 (2097152)
        const getAerodromeQuote = async (
          tokenIn: `0x${string}`,
          tokenOut: `0x${string}`,
          amountIn: bigint
        ): Promise<{ amountOut: bigint; stable: boolean; poolAddress: `0x${string}`; tickSpacing?: number }> => {
          let storedPoolAddress = selectedPair.tokenWarsData?.poolAddress as `0x${string}` | undefined;
          const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;
          const V2_VOLATILE_FILLER = 0x400000; // 4194304
          const V2_STABLE_FILLER = 0x200000;   // 2097152

          console.log('[Aerodrome] Quote request:', {
            tokenIn,
            tokenOut,
            amountIn: formatUnits(amountIn, 18),
            storedPoolAddress,
          });

          let amountOut: bigint = 0n;
          let isStable = false;
          let poolAddress = storedPoolAddress || ZERO_ADDRESS;
          let detectedTickSpacing: number | undefined = undefined;
          let confirmedPoolType: 'cl' | 'v2' | undefined = undefined;

          // VALIDATE stored pool address contains our expected tokens
          // This prevents using wrong pool when tokenWarsData.poolAddress is stale/incorrect
          if (storedPoolAddress && storedPoolAddress !== ZERO_ADDRESS) {
            try {
              const [poolToken0, poolToken1] = await Promise.all([
                publicClient.readContract({
                  address: storedPoolAddress,
                  abi: AERODROME_POOL_ABI,
                  functionName: 'token0',
                }) as Promise<`0x${string}`>,
                publicClient.readContract({
                  address: storedPoolAddress,
                  abi: AERODROME_POOL_ABI,
                  functionName: 'token1',
                }) as Promise<`0x${string}`>,
              ]);

              const token0Lower = poolToken0.toLowerCase();
              const token1Lower = poolToken1.toLowerCase();
              const inLower = tokenIn.toLowerCase();
              const outLower = tokenOut.toLowerCase();

              // Check if pool contains both our tokens (in either order)
              const poolHasTokenIn = token0Lower === inLower || token1Lower === inLower;
              const poolHasTokenOut = token0Lower === outLower || token1Lower === outLower;

              if (!poolHasTokenIn || !poolHasTokenOut) {
                console.log('[Aerodrome] Stored pool address INVALID - tokens do not match:', {
                  poolToken0,
                  poolToken1,
                  expectedTokenIn: tokenIn,
                  expectedTokenOut: tokenOut,
                });
                // Clear the stored pool address to force factory lookup
                storedPoolAddress = undefined;
                poolAddress = ZERO_ADDRESS;
              } else {
                console.log('[Aerodrome] Stored pool address VALIDATED - tokens match');
              }
            } catch (err) {
              console.log('[Aerodrome] Could not validate stored pool, clearing it:', err);
              storedPoolAddress = undefined;
              poolAddress = ZERO_ADDRESS;
            }
          }

          // If no stored pool address, try to look it up from the V2 factory
          // Try both token orderings since getPool may be order-sensitive
          if (!storedPoolAddress || storedPoolAddress === ZERO_ADDRESS) {
            console.log('[Aerodrome] No stored pool address, looking up from V2 factory...');
            console.log('[Aerodrome] tokenIn:', tokenIn, 'tokenOut:', tokenOut);

            // Try volatile pool first with tokenIn, tokenOut order
            try {
              const volatilePool = await publicClient.readContract({
                address: AERODROME_FACTORY_ADDRESS,
                abi: AERODROME_FACTORY_ABI,
                functionName: 'getPool',
                args: [tokenIn, tokenOut, false], // false = volatile
              }) as `0x${string}`;
              console.log('[Aerodrome] V2 volatile lookup (in,out):', volatilePool);
              if (volatilePool && volatilePool !== ZERO_ADDRESS) {
                storedPoolAddress = volatilePool;
                poolAddress = volatilePool;
                isStable = false;
                confirmedPoolType = 'v2';
                console.log('[Aerodrome] Found V2 volatile pool:', volatilePool);
              }
            } catch (err) {
              console.log('[Aerodrome] V2 volatile pool lookup (in,out) failed:', err);
            }

            // Try volatile pool with REVERSED token order
            if (!storedPoolAddress || storedPoolAddress === ZERO_ADDRESS) {
              try {
                const volatilePoolReverse = await publicClient.readContract({
                  address: AERODROME_FACTORY_ADDRESS,
                  abi: AERODROME_FACTORY_ABI,
                  functionName: 'getPool',
                  args: [tokenOut, tokenIn, false], // REVERSED order
                }) as `0x${string}`;
                console.log('[Aerodrome] V2 volatile lookup (out,in):', volatilePoolReverse);
                if (volatilePoolReverse && volatilePoolReverse !== ZERO_ADDRESS) {
                  storedPoolAddress = volatilePoolReverse;
                  poolAddress = volatilePoolReverse;
                  isStable = false;
                  confirmedPoolType = 'v2';
                  console.log('[Aerodrome] Found V2 volatile pool (reversed):', volatilePoolReverse);
                }
              } catch (err) {
                console.log('[Aerodrome] V2 volatile pool lookup (reversed) failed:', err);
              }
            }

            // If no volatile pool, try stable with both orderings
            if (!storedPoolAddress || storedPoolAddress === ZERO_ADDRESS) {
              try {
                const stablePool = await publicClient.readContract({
                  address: AERODROME_FACTORY_ADDRESS,
                  abi: AERODROME_FACTORY_ABI,
                  functionName: 'getPool',
                  args: [tokenIn, tokenOut, true], // true = stable
                }) as `0x${string}`;
                console.log('[Aerodrome] V2 stable lookup (in,out):', stablePool);
                if (stablePool && stablePool !== ZERO_ADDRESS) {
                  storedPoolAddress = stablePool;
                  poolAddress = stablePool;
                  isStable = true;
                  confirmedPoolType = 'v2';
                  console.log('[Aerodrome] Found V2 stable pool:', stablePool);
                }
              } catch (err) {
                console.log('[Aerodrome] V2 stable pool lookup failed:', err);
              }
            }

            // Try stable with REVERSED order
            if (!storedPoolAddress || storedPoolAddress === ZERO_ADDRESS) {
              try {
                const stablePoolReverse = await publicClient.readContract({
                  address: AERODROME_FACTORY_ADDRESS,
                  abi: AERODROME_FACTORY_ABI,
                  functionName: 'getPool',
                  args: [tokenOut, tokenIn, true], // REVERSED order
                }) as `0x${string}`;
                console.log('[Aerodrome] V2 stable lookup (out,in):', stablePoolReverse);
                if (stablePoolReverse && stablePoolReverse !== ZERO_ADDRESS) {
                  storedPoolAddress = stablePoolReverse;
                  poolAddress = stablePoolReverse;
                  isStable = true;
                  confirmedPoolType = 'v2';
                  console.log('[Aerodrome] Found V2 stable pool (reversed):', stablePoolReverse);
                }
              } catch (err) {
                console.log('[Aerodrome] V2 stable pool lookup (reversed) failed:', err);
              }
            }
          }

          // FIRST: If we have a stored pool address, definitively determine if it's CL or V2
          if (storedPoolAddress && storedPoolAddress !== ZERO_ADDRESS && confirmedPoolType === undefined) {
            try {
              // Try to get tickSpacing - if it exists, it's a CL pool
              const tickSpacing = await publicClient.readContract({
                address: storedPoolAddress,
                abi: AERODROME_CL_POOL_ABI,
                functionName: 'tickSpacing',
              }) as number;

              detectedTickSpacing = tickSpacing;
              confirmedPoolType = 'cl';
              console.log('[Aerodrome] CONFIRMED CL pool with tickSpacing:', tickSpacing);

              // Use path-based quote for CL pool
              const tickSpacingHex = toHex(tickSpacing, { size: 3 });
              const path = concat([tokenIn, tickSpacingHex, tokenOut]);

              try {
                const result = await publicClient.simulateContract({
                  address: AERODROME_MIXED_QUOTER_ADDRESS,
                  abi: AERODROME_MIXED_QUOTER_ABI,
                  functionName: 'quoteExactInput',
                  args: [path, amountIn],
                });
                const quoteResult = result.result as [bigint, bigint[], number[], bigint];
                amountOut = quoteResult[0];
                console.log('[Aerodrome] CL path quote result:', formatUnits(amountOut, 18));
              } catch (pathErr) {
                console.log('[Aerodrome] CL path quote failed:', pathErr);
              }
            } catch {
              // Not a CL pool, it's a V2 pool
              confirmedPoolType = 'v2';
              console.log('[Aerodrome] CONFIRMED V2 pool (no tickSpacing)');
              try {
                isStable = await publicClient.readContract({
                  address: storedPoolAddress,
                  abi: AERODROME_POOL_ABI,
                  functionName: 'stable',
                }) as boolean;
                console.log('[Aerodrome] V2 pool stable status:', isStable);
              } catch {
                // Default to volatile
                isStable = false;
              }
            }
          }

          // If we confirmed it's a V2 pool, ONLY try V2 quotes (don't try CL)
          if (confirmedPoolType === 'v2' && amountOut === 0n) {
            // FIRST: Try direct pool quote (most reliable when we have pool address)
            if (storedPoolAddress && storedPoolAddress !== ZERO_ADDRESS) {
              console.log('[Aerodrome] Trying direct V2 pool getAmountOut FIRST...');
              try {
                amountOut = await publicClient.readContract({
                  address: storedPoolAddress,
                  abi: AERODROME_POOL_ABI,
                  functionName: 'getAmountOut',
                  args: [amountIn, tokenIn],
                }) as bigint;
                poolAddress = storedPoolAddress;
                console.log('[Aerodrome] Direct V2 pool quote SUCCESS:', formatUnits(amountOut, 18));
              } catch (directErr) {
                console.error('[Aerodrome] Direct V2 pool quote failed:', directErr);
              }
            }

            // Fallback: Try Mixed Quoter V2 volatile path
            if (amountOut === 0n) {
              try {
                console.log('[Aerodrome] Trying V2 volatile path via Mixed Quoter...');
                const volatileFillerHex = toHex(V2_VOLATILE_FILLER, { size: 3 });
                const volatilePath = concat([tokenIn, volatileFillerHex, tokenOut]);

                const result = await publicClient.simulateContract({
                  address: AERODROME_MIXED_QUOTER_ADDRESS,
                  abi: AERODROME_MIXED_QUOTER_ABI,
                  functionName: 'quoteExactInput',
                  args: [volatilePath, amountIn],
                });
                const quoteResult = result.result as [bigint, bigint[], number[], bigint];
                if (quoteResult[0] > 0n) {
                  amountOut = quoteResult[0];
                  isStable = false;
                  console.log('[Aerodrome] V2 volatile quote:', formatUnits(amountOut, 18));
                }
              } catch {
                console.log('[Aerodrome] V2 volatile path failed');
              }
            }

            // Fallback: Try Mixed Quoter V2 stable path
            if (amountOut === 0n) {
              try {
                console.log('[Aerodrome] Trying V2 stable path via Mixed Quoter...');
                const stableFillerHex = toHex(V2_STABLE_FILLER, { size: 3 });
                const stablePath = concat([tokenIn, stableFillerHex, tokenOut]);

                const result = await publicClient.simulateContract({
                  address: AERODROME_MIXED_QUOTER_ADDRESS,
                  abi: AERODROME_MIXED_QUOTER_ABI,
                  functionName: 'quoteExactInput',
                  args: [stablePath, amountIn],
                });
                const quoteResult = result.result as [bigint, bigint[], number[], bigint];
                if (quoteResult[0] > 0n) {
                  amountOut = quoteResult[0];
                  isStable = true;
                  console.log('[Aerodrome] V2 stable quote:', formatUnits(amountOut, 18));
                }
              } catch {
                console.log('[Aerodrome] V2 stable path failed');
              }
            }

            // FALLBACK: If stored pool quote failed, try factory lookup with both orderings
            if (amountOut === 0n) {
              console.log('[Aerodrome] Stored pool quote failed, trying factory lookup as fallback...');
              console.log('[Aerodrome] Fallback tokenIn:', tokenIn, 'tokenOut:', tokenOut);

              // Helper to try getting quote from a pool
              const tryPoolQuote = async (pool: `0x${string}`, poolType: string): Promise<boolean> => {
                try {
                  const out = await publicClient.readContract({
                    address: pool,
                    abi: AERODROME_POOL_ABI,
                    functionName: 'getAmountOut',
                    args: [amountIn, tokenIn],
                  }) as bigint;
                  if (out > 0n) {
                    amountOut = out;
                    poolAddress = pool;
                    console.log(`[Aerodrome] ${poolType} pool quote SUCCESS:`, formatUnits(out, 18));
                    return true;
                  }
                } catch (err) {
                  console.log(`[Aerodrome] ${poolType} pool getAmountOut failed:`, err);
                }
                return false;
              };

              // Try volatile pool with both token orderings
              for (const [a, b] of [[tokenIn, tokenOut], [tokenOut, tokenIn]]) {
                if (amountOut > 0n) break;
                try {
                  const volatilePool = await publicClient.readContract({
                    address: AERODROME_FACTORY_ADDRESS,
                    abi: AERODROME_FACTORY_ABI,
                    functionName: 'getPool',
                    args: [a, b, false],
                  }) as `0x${string}`;
                  console.log(`[Aerodrome] Factory volatile lookup (${a.slice(0,8)},${b.slice(0,8)}):`, volatilePool);
                  if (volatilePool && volatilePool !== ZERO_ADDRESS) {
                    isStable = false;
                    if (await tryPoolQuote(volatilePool, 'Factory volatile')) break;
                  }
                } catch (err) {
                  console.log('[Aerodrome] Factory volatile lookup failed:', err);
                }
              }

              // Try stable pool with both token orderings
              if (amountOut === 0n) {
                for (const [a, b] of [[tokenIn, tokenOut], [tokenOut, tokenIn]]) {
                  if (amountOut > 0n) break;
                  try {
                    const stablePool = await publicClient.readContract({
                      address: AERODROME_FACTORY_ADDRESS,
                      abi: AERODROME_FACTORY_ABI,
                      functionName: 'getPool',
                      args: [a, b, true],
                    }) as `0x${string}`;
                    console.log(`[Aerodrome] Factory stable lookup (${a.slice(0,8)},${b.slice(0,8)}):`, stablePool);
                    if (stablePool && stablePool !== ZERO_ADDRESS) {
                      isStable = true;
                      if (await tryPoolQuote(stablePool, 'Factory stable')) break;
                    }
                  } catch (err) {
                    console.log('[Aerodrome] Factory stable lookup failed:', err);
                  }
                }
              }
            }

          }

          // If no confirmed pool type, try discovery (CL first, then V2)
          if (confirmedPoolType === undefined && amountOut === 0n) {
            // Common tick spacings for Aerodrome CL pools
            const tickSpacingsToTry = [2000, 200, 100, 50, 1];

            for (const tickSpacing of tickSpacingsToTry) {
              try {
                console.log('[Aerodrome] Trying CL path with tickSpacing:', tickSpacing);
                const tickSpacingHex = toHex(tickSpacing, { size: 3 });
                const path = concat([tokenIn, tickSpacingHex, tokenOut]);

                const result = await publicClient.simulateContract({
                  address: AERODROME_MIXED_QUOTER_ADDRESS,
                  abi: AERODROME_MIXED_QUOTER_ABI,
                  functionName: 'quoteExactInput',
                  args: [path, amountIn],
                });
                const quoteResult = result.result as [bigint, bigint[], number[], bigint];
                if (quoteResult[0] > 0n) {
                  amountOut = quoteResult[0];
                  detectedTickSpacing = tickSpacing;
                  console.log('[Aerodrome] CL quote success! tickSpacing:', tickSpacing, 'amountOut:', formatUnits(amountOut, 18));
                  break;
                }
              } catch {
                // Try next tickSpacing
              }
            }
          }

          // If still no quote and no confirmed pool type, try V2 paths
          if (confirmedPoolType === undefined && amountOut === 0n) {
            // Try volatile V2 path
            try {
              console.log('[Aerodrome] Trying V2 volatile path...');
              const volatileFillerHex = toHex(V2_VOLATILE_FILLER, { size: 3 });
              const volatilePath = concat([tokenIn, volatileFillerHex, tokenOut]);

              const result = await publicClient.simulateContract({
                address: AERODROME_MIXED_QUOTER_ADDRESS,
                abi: AERODROME_MIXED_QUOTER_ABI,
                functionName: 'quoteExactInput',
                args: [volatilePath, amountIn],
              });
              const quoteResult = result.result as [bigint, bigint[], number[], bigint];
              if (quoteResult[0] > 0n) {
                amountOut = quoteResult[0];
                isStable = false;
                console.log('[Aerodrome] V2 volatile quote:', formatUnits(amountOut, 18));
              }
            } catch {
              console.log('[Aerodrome] V2 volatile path failed');
            }
          }

          if (confirmedPoolType === undefined && amountOut === 0n) {
            // Try stable V2 path
            try {
              console.log('[Aerodrome] Trying V2 stable path...');
              const stableFillerHex = toHex(V2_STABLE_FILLER, { size: 3 });
              const stablePath = concat([tokenIn, stableFillerHex, tokenOut]);

              const result = await publicClient.simulateContract({
                address: AERODROME_MIXED_QUOTER_ADDRESS,
                abi: AERODROME_MIXED_QUOTER_ABI,
                functionName: 'quoteExactInput',
                args: [stablePath, amountIn],
              });
              const quoteResult = result.result as [bigint, bigint[], number[], bigint];
              if (quoteResult[0] > 0n) {
                amountOut = quoteResult[0];
                isStable = true;
                console.log('[Aerodrome] V2 stable quote:', formatUnits(amountOut, 18));
              }
            } catch {
              console.log('[Aerodrome] V2 stable path failed');
            }
          }

          // Last resort: direct pool quote if we have stored address
          if (amountOut === 0n && storedPoolAddress && storedPoolAddress !== ZERO_ADDRESS) {
            console.log('[Aerodrome] Trying direct pool getAmountOut...');
            try {
              amountOut = await publicClient.readContract({
                address: storedPoolAddress,
                abi: AERODROME_POOL_ABI,
                functionName: 'getAmountOut',
                args: [amountIn, tokenIn],
              }) as bigint;
              poolAddress = storedPoolAddress;
              console.log('[Aerodrome] Direct pool quote:', formatUnits(amountOut, 18));
            } catch (directErr) {
              console.error('[Aerodrome] Direct pool quote failed:', directErr);
            }
          }

          if (amountOut === 0n) {
            throw new Error('Quote returned 0 - pool may have insufficient liquidity or unsupported pool type');
          }

          // If we detected a CL pool but don't have the pool address, look it up from the CL Factory
          if (detectedTickSpacing !== undefined && detectedTickSpacing > 0 &&
              (!poolAddress || poolAddress === ZERO_ADDRESS || poolAddress === '0x')) {
            try {
              console.log('[Aerodrome] Looking up CL pool address from factory...');
              const discoveredPool = await publicClient.readContract({
                address: AERODROME_CL_FACTORY_ADDRESS,
                abi: AERODROME_CL_FACTORY_ABI,
                functionName: 'getPool',
                args: [tokenIn, tokenOut, detectedTickSpacing],
              }) as `0x${string}`;

              if (discoveredPool && discoveredPool !== ZERO_ADDRESS) {
                poolAddress = discoveredPool;
                console.log('[Aerodrome] Discovered CL pool address:', poolAddress);
              }
            } catch (lookupErr) {
              console.log('[Aerodrome] Failed to look up pool address:', lookupErr);
            }
          }

          console.log('[Aerodrome] Final quote:', {
            amountOut: formatUnits(amountOut, 18),
            stable: isStable,
            poolAddress,
            tickSpacing: detectedTickSpacing,
          });

          return { amountOut, stable: isStable, poolAddress, tickSpacing: detectedTickSpacing };
        };

        // Aerodrome pair quote
        // For wASS-paired tokens, we swap wASS ↔ Token instead of ETH ↔ Token
        if (isAerodromePair && outputTokenAddress) {
          const baseTokenLabel = isWassPairedAerodrome ? 'wASS' : 'ETH';

          if (swapTab === 'buy') {
            // Base token → Output Token quote (ETH or wASS → Token)
            const baseIn = parseUnits(inputAmount, 18); // Both ETH and wASS are 18 decimals
            console.log(`=== AERODROME BUY QUOTE START (${baseTokenLabel} → Token) ===`);
            console.log('Input:', inputAmount, baseTokenLabel);
            console.log('Base token:', aerodromeBaseToken);
            console.log('Output token:', outputTokenAddress);
            console.log('isWassPairedAerodrome:', isWassPairedAerodrome);
            console.log('selectedPair.tokenWarsData:', selectedPair.tokenWarsData);

            try {
              const { amountOut: tokenOut, stable, poolAddress, tickSpacing } = await getAerodromeQuote(aerodromeBaseToken, outputTokenAddress, baseIn);
              console.log(`Aerodrome ${baseTokenLabel}→Token quote:`, {
                tokenOut: formatUnits(tokenOut, 18),
                baseIn: formatUnits(baseIn, 18),
                stable,
                poolAddress,
                tickSpacing,
              });
              setOutputAmount(formatUnits(tokenOut, 18));
              // Store pool info for swap execution (includes tickSpacing for CL pools)
              setAerodromePoolInfo({ stable, poolAddress, tickSpacing });
            } catch (err) {
              console.error('Aerodrome quote failed:', err);
              const errorMsg = err instanceof Error ? err.message : 'Unable to get quote';
              setSwapError(`Aerodrome: ${errorMsg}`);
              setOutputAmount('');
              setAerodromePoolInfo(null);
            }
          } else {
            // Token → Base token quote (sell: Token → ETH or wASS)
            const tokenIn = parseUnits(inputAmount, 18);
            console.log(`=== AERODROME SELL QUOTE START (Token → ${baseTokenLabel}) ===`);
            console.log('Input:', inputAmount, 'TOKEN');
            console.log('Token:', outputTokenAddress);
            console.log('Base token:', aerodromeBaseToken);

            try {
              const { amountOut: baseOut, stable, poolAddress, tickSpacing } = await getAerodromeQuote(outputTokenAddress, aerodromeBaseToken, tokenIn);
              console.log(`Aerodrome Token→${baseTokenLabel} quote:`, {
                baseOut: formatUnits(baseOut, 18),
                tokenIn: formatUnits(tokenIn, 18),
                stable,
                poolAddress,
                tickSpacing,
              });
              setOutputAmount(formatUnits(baseOut, 18));
              // Store pool info for swap execution (includes tickSpacing for CL pools)
              setAerodromePoolInfo({ stable, poolAddress, tickSpacing });
            } catch (err) {
              console.error('Aerodrome quote failed:', err);
              const errorMsg = err instanceof Error ? err.message : 'Unable to get quote';
              setSwapError(`Aerodrome: ${errorMsg}`);
              setOutputAmount('');
              setAerodromePoolInfo(null);
            }
          }
          setIsQuoting(false);
          return;
        }

        // Hydrex pair quote using KyberSwap aggregator API
        if (isHydrexPair && outputTokenAddress) {
          console.log('=== HYDREX QUOTE START ===');
          console.log('swapTab:', swapTab);
          console.log('Input:', inputAmount);
          console.log('Token:', outputTokenAddress);

          try {
            let tokenIn: string;
            let tokenOut: string;
            let amountInWei: string;
            let decimalsOut: number;

            if (swapTab === 'buy') {
              // ETH → Token (buy)
              tokenIn = KYBERSWAP_NATIVE_TOKEN; // Native ETH
              tokenOut = outputTokenAddress;
              amountInWei = parseEther(inputAmount).toString();
              decimalsOut = 18;
            } else {
              // Token → ETH (sell)
              tokenIn = outputTokenAddress;
              tokenOut = KYBERSWAP_NATIVE_TOKEN; // Native ETH
              amountInWei = parseUnits(inputAmount, 18).toString();
              decimalsOut = 18;
            }

            console.log('[Hydrex] KyberSwap quote request:', { tokenIn, tokenOut, amountInWei });

            const response = await getKyberSwapQuote(tokenIn, tokenOut, amountInWei, 50);

            if (response.code !== 0 || !response.data) {
              throw new Error(response.message || 'Failed to get KyberSwap quote');
            }

            const { routeSummary, routerAddress } = response.data;
            const amountOutFormatted = formatUnits(BigInt(routeSummary.amountOut), decimalsOut);

            console.log('[Hydrex] Quote result:', {
              amountOut: amountOutFormatted,
              amountOutUsd: routeSummary.amountOutUsd,
              gas: routeSummary.gas,
              gasUsd: routeSummary.gasUsd,
              routerAddress,
            });

            setOutputAmount(amountOutFormatted);
            // Store route info for swap execution
            setHydrexRouteInfo({ routeSummary, routerAddress });
            setSwapError(null);
          } catch (err) {
            console.error('[Hydrex] Quote failed:', err);
            const errorMsg = err instanceof Error ? err.message : 'Unable to get quote';
            setSwapError(`Hydrex: ${errorMsg}`);
            setOutputAmount('');
            setHydrexRouteInfo(null);
          }

          setIsQuoting(false);
          return;
        }

        if (isTokenPair && outputTokenAddress) {
          // Token pair quote using actual quoter
          // Build pool key from config values - V4 pools require SORTED tokens!
          // Sort tokens: smaller address = currency0, larger = currency1
          const [sortedCurrency0, sortedCurrency1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
            ? [selectedPair.token0, selectedPair.token1]
            : [selectedPair.token1, selectedPair.token0];

          const tokenPairPoolKey = {
            currency0: sortedCurrency0,
            currency1: sortedCurrency1,
            fee: selectedPair.fee,
            tickSpacing: selectedPair.tickSpacing,
            hooks: selectedPair.hook,
          };

          console.log('[V4 Quote] Pool key (sorted):', {
            currency0: sortedCurrency0,
            currency1: sortedCurrency1,
            fee: selectedPair.fee,
            tickSpacing: selectedPair.tickSpacing,
            hooks: selectedPair.hook,
            isTokenWars: selectedPair.isTokenWars,
          });

          // Determine direction based on wASS position in SORTED pool
          // After sorting: check if wASS is currency0
          const wassIsToken0 = sortedCurrency0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();
          const ethIsToken0 = sortedCurrency0 === ETH_ADDRESS;
          console.log('[V4 Quote] wASS is token0:', wassIsToken0, ', ETH is token0:', ethIsToken0);

          if (swapTab === 'buy') {
            // Check if buying with wASS input (direct wASS → Token swap)
            if (buyInputCurrency === 'wass') {
              // Direct wASS → Token quote (single hop from the pool)
              const wassIn = parseUnits(inputAmount, 18);
              console.log('=== BUY WITH wASS QUOTE START ===');
              console.log('Input:', inputAmount, 'wASS');

              // wASS → TOKEN direction
              // If wASS is token0: buying TOKEN (currency1) for wASS (currency0) = zeroForOne = true
              // If wASS is token1: buying TOKEN (currency0) for wASS (currency1) = zeroForOne = false
              const wassToTokenZeroForOne = wassIsToken0;
              console.log('wASS→Token direction, zeroForOne:', wassToTokenZeroForOne, 'amount:', formatUnits(wassIn, 18));

              try {
                // Try direct quote first
                const tokenOut = await getSimulateQuote(tokenPairPoolKey, wassToTokenZeroForOne, wassIn);
                console.log('wASS→Token quote:', formatUnits(tokenOut, 18), 'Token for', formatUnits(wassIn, 18), 'wASS');

                if (tokenOut > 0n) {
                  setOutputAmount(formatUnits(tokenOut, 18));
                  console.log('=== BUY WITH wASS QUOTE FINAL:', formatUnits(tokenOut, 18), 'TOKEN for', inputAmount, 'wASS ===');
                } else {
                  // Fallback: Use inverted sell rate
                  console.log('Direct quote returned 0, using inverted sell rate');
                  const sellDirection = !wassIsToken0;
                  const oneToken = parseUnits('1', 18);
                  const wassPerToken = await getSimulateQuote(tokenPairPoolKey, sellDirection, oneToken);

                  if (wassPerToken > 0n) {
                    const tokenEstimate = (wassIn * oneToken) / wassPerToken;
                    console.log('Inverted estimate:', formatUnits(tokenEstimate, 18), 'TOKEN');
                    setOutputAmount(formatUnits(tokenEstimate, 18));
                  } else {
                    setOutputAmount(formatUnits(wassIn, 18)); // 1:1 fallback
                  }
                }
              } catch (err) {
                console.error('wASS→Token quoter failed:', err);
                // Fallback: Use inverted sell rate
                try {
                  const sellDirection = !wassIsToken0;
                  const oneToken = parseUnits('1', 18);
                  const wassPerToken = await getSimulateQuote(tokenPairPoolKey, sellDirection, oneToken);

                  if (wassPerToken > 0n) {
                    const tokenEstimate = (wassIn * oneToken) / wassPerToken;
                    console.log('Fallback inverted estimate:', formatUnits(tokenEstimate, 18), 'TOKEN');
                    setOutputAmount(formatUnits(tokenEstimate, 18));
                  } else {
                    setOutputAmount(formatUnits(wassIn, 18)); // 1:1 fallback
                  }
                } catch {
                  console.log('Using 1:1 estimate');
                  setOutputAmount(formatUnits(wassIn, 18));
                }
              }
            } else if (isTokenWarsEthPair) {
              // Token Wars ETH pair: DIRECT ETH → Token V4 swap (single hop)
              // These pools have ETH as one side, so no need for multi-hop through wASS
              const ethIn = parseEther(inputAmount);
              console.log('=== TOKEN WARS ETH PAIR BUY QUOTE START ===');
              console.log('Input:', inputAmount, 'ETH');
              console.log('Direct V4 pool key:', tokenPairPoolKey);

              // Determine direction: ETH → TOKEN (using sorted ethIsToken0 computed above)
              // If ETH (0x0) is token0: zeroForOne = true (buying token1 for token0)
              // If ETH is token1: zeroForOne = false (buying token0 for token1)
              const zeroForOne = ethIsToken0; // true = ETH→TOKEN when ETH is token0
              console.log('[V4 Quote] ETH pair buy, ethIsToken0:', ethIsToken0, ', zeroForOne:', zeroForOne);

              try {
                const tokenOut = await getSimulateQuote(tokenPairPoolKey, zeroForOne, ethIn);
                console.log('Direct V4 quote:', formatUnits(tokenOut, 18), 'TOKEN for', inputAmount, 'ETH');
                setOutputAmount(formatUnits(tokenOut, 18));
              } catch (err) {
                console.error('Token Wars ETH pair quote failed:', err);
                setSwapError('Unable to get quote for this pool');
                setOutputAmount('');
              }
            } else {
              // wASS/TOKEN pair: ETH → wASS → Token (two hops via OTC router's swapToToken)
              //
              // Use the SAME V4 quote approach as the default wASS/ETH pair
              // The swapToToken function has slippage protection (minWassOut, minTokenOut)
              // so we just need a good estimate - V4 quoter provides this

              const ethIn = parseEther(inputAmount);
              console.log('=== BUY QUOTE START (multi-hop) ===');
              console.log('Input:', inputAmount, 'ETH');

            // Get pool key for ETH/wASS (same as default pair uses)
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

            const wassEthPoolKey = await publicClient.readContract({
              address: hookAddress,
              abi: [{
                inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
                name: 'getPoolKey',
                outputs: [{
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
                }],
                stateMutability: 'view',
                type: 'function',
              }],
              functionName: 'getPoolKey',
              args: [poolIdRaw],
            }) as unknown as {
              currency0: `0x${string}`;
              currency1: `0x${string}`;
              fee: number;
              tickSpacing: number;
              hooks: `0x${string}`;
            };

            // Step 1: Get ETH → wASS quote using same approach as default pair
            // Then apply OTC fee reduction since swapToToken uses OTC hybrid
            const v4WassQuote = await getSimulateQuote(wassEthPoolKey, true, ethIn);
            console.log('Step 1 - V4 quote:', formatUnits(v4WassQuote, 18), 'wASS for', inputAmount, 'ETH');

            // Get OTC fee info and calculate realistic wASS output
            // The OTC hybrid swap splits ETH: some goes through V4, some through OTC pool
            // We need to quote each portion separately
            let wassOut = v4WassQuote;
            try {
              const otcQuoteResult = await publicClient.readContract({
                address: contracts.otc.address as `0x${string}`,
                abi: contracts.otc.abi,
                functionName: 'quote',
                args: [ethIn],
              }) as [bigint, bigint, bigint, bigint, bigint, boolean];

              const [swapPortion, otcPortion, , , currentOtcFeeBps, hasOtc] = otcQuoteResult;
              console.log('OTC info - swapPortion:', formatEther(swapPortion), 'otcPortion:', formatEther(otcPortion), 'feeBps:', currentOtcFeeBps.toString(), 'hasOtc:', hasOtc);

              if (hasOtc && swapPortion > 0n && otcPortion > 0n) {
                // Quote V4 portion separately (this has price impact for smaller amount)
                const v4PortionWass = await getSimulateQuote(wassEthPoolKey, true, swapPortion);
                console.log('V4 portion quote:', formatUnits(v4PortionWass, 18), 'wASS for', formatEther(swapPortion), 'ETH');

                // For OTC portion, assume same rate as V4 but then apply fee
                // (OTC pool aims to provide similar rate to reduce price impact)
                const otcWassBeforeFee = (v4WassQuote * otcPortion) / ethIn;
                const otcFee = (otcWassBeforeFee * currentOtcFeeBps) / 10000n;
                const otcPortionWass = otcWassBeforeFee - otcFee;
                console.log('OTC portion:', formatUnits(otcWassBeforeFee, 18), 'wASS - fee', formatUnits(otcFee, 18), '=', formatUnits(otcPortionWass, 18), 'wASS');

                // Total is V4 portion (with price impact) + OTC portion (with fee)
                wassOut = v4PortionWass + otcPortionWass;
                console.log('Combined:', formatUnits(v4PortionWass, 18), '+', formatUnits(otcPortionWass, 18), '=', formatUnits(wassOut, 18), 'wASS');
              } else if (hasOtc && otcPortion > 0n) {
                // All goes through OTC (unlikely but handle it)
                const otcFee = (v4WassQuote * currentOtcFeeBps) / 10000n;
                wassOut = v4WassQuote - otcFee;
              }
              // else: no OTC, use full V4 quote as-is
            } catch (otcErr) {
              console.error('OTC quote failed, using V4 quote:', otcErr);
            }
            console.log('Step 1 FINAL:', formatUnits(wassOut, 18), 'wASS');

            // Step 2: wASS → TOKEN estimate
            // The V4 quoter REVERTS for this direction, so we use inverted sell rate
            // with empirical correction factor based on observed quote vs simulation gap
            console.log('Step 2 - Calculating TOKEN output from wASS');

            try {
              // Get sell rate: TOKEN → wASS (this direction works)
              const sellDirection = !wassIsToken0;
              const oneToken = parseUnits('1', 18);
              const wassPerToken = await getSimulateQuote(tokenPairPoolKey, sellDirection, oneToken);
              console.log('Sell rate: 1 TOKEN →', formatUnits(wassPerToken, 18), 'wASS');

              if (wassPerToken > 0n) {
                // Basic inversion: wassOut / wassPerToken
                const basicEstimate = (wassOut * oneToken) / wassPerToken;
                console.log('Raw inverted estimate:', formatUnits(basicEstimate, 18), 'TOKEN');

                // EMPIRICAL CORRECTION: The inverted sell rate consistently over-estimates
                // by ~20-25% compared to actual swap simulations. This is due to:
                // 1. OTC portion in Step 1 may give worse rate than V4
                // 2. Buy direction has worse rate than inverted sell rate (AMM mechanics)
                // 3. Additional fees/slippage in the two-hop path
                //
                // Apply 23% reduction (multiply by 0.77) to match observed simulation results
                const correctedEstimate = (basicEstimate * 77n) / 100n;

                console.log('Corrected estimate (77% of raw):', formatUnits(correctedEstimate, 18), 'TOKEN');
                console.log('=== BUY QUOTE FINAL:', formatUnits(correctedEstimate, 18), 'TOKEN for', inputAmount, 'ETH ===');
                setOutputAmount(formatUnits(correctedEstimate, 18));
              } else {
                console.log('Sell quote returned 0, using wassOut as fallback');
                setOutputAmount(formatUnits(wassOut, 18));
              }
            } catch (err) {
              console.error('Step 2 quote failed:', err);
              setOutputAmount(formatUnits(wassOut, 18));
            }
            }
          } else if (isTokenWarsEthPair) {
            // Token Wars ETH pair sell: DIRECT Token → ETH V4 quote (single hop)
            const tokenIn = parseUnits(inputAmount, 18);
            console.log('=== TOKEN WARS ETH PAIR SELL QUOTE START ===');
            console.log('Input:', inputAmount, 'TOKEN');
            console.log('Direct V4 pool key:', tokenPairPoolKey);

            // Determine direction: Token → ETH (using sorted ethIsToken0 computed above)
            // If ETH is token0: selling token1 for token0, zeroForOne = false
            // If ETH is token1: selling token0 for token1, zeroForOne = true
            const zeroForOne = !ethIsToken0; // Token → ETH
            console.log('[V4 Quote] ETH pair sell, ethIsToken0:', ethIsToken0, ', zeroForOne:', zeroForOne);

            try {
              const ethOut = await getSimulateQuote(tokenPairPoolKey, zeroForOne, tokenIn);
              console.log('Direct V4 sell quote:', formatEther(ethOut), 'ETH for', formatUnits(tokenIn, 18), 'TOKEN');
              if (ethOut > 0n) {
                setOutputAmount(formatEther(ethOut));
              } else {
                setSwapError('Unable to get quote for this pool');
                setOutputAmount('');
              }
            } catch (err) {
              console.error('Token Wars ETH pair sell quote failed:', err);
              setSwapError('Unable to get quote for this pool');
              setOutputAmount('');
            }
          } else {
            // wASS/TOKEN pair Sell: Token → wASS or Token → wASS → ETH (multi-hop)
            const tokenIn = parseUnits(inputAmount, 18);

            // Token → wASS direction
            // If wASS is token0: selling TOKEN (currency1) for wASS (currency0) = zeroForOne = false
            // If wASS is token1: selling TOKEN (currency0) for wASS (currency1) = zeroForOne = true
            const tokenToWassZeroForOne = !wassIsToken0;
            console.log('Sell Token→wASS direction, zeroForOne:', tokenToWassZeroForOne, 'amount:', formatUnits(tokenIn, 18));

            try {
              // Step 1: Get Token → wASS quote
              const wassOut = await getSimulateQuote(tokenPairPoolKey, tokenToWassZeroForOne, tokenIn);
              console.log('Token→wASS quote:', formatUnits(wassOut, 18), 'wASS for', formatUnits(tokenIn, 18), 'Token');

              if (sellOutputCurrency === 'eth') {
                // Multi-hop sell: Token → wASS → ETH
                console.log('=== MULTI-HOP SELL QUOTE: Token → wASS → ETH ===');

                if (wassOut > 0n) {
                  // Step 2: Get wASS → ETH quote using the default pool from NFT contract
                  // Note: SELL_POOL_ID lives on the config HOOK_ADDRESS, but the NFT's hook()
                  // may point to a different contract. Use poolIdRaw (default pool) which is
                  // always available on the NFT's hook and matches the execution path.
                  const [sellHookPoolIdRaw, sellHookAddress] = await Promise.all([
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

                  console.log('[ChartModal] Multi-hop sell: Using default wASS/ETH pool for quote, hook:', sellHookAddress);

                  const wassEthPoolKey = await publicClient.readContract({
                    address: sellHookAddress,
                    abi: [{
                      inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
                      name: 'getPoolKey',
                      outputs: [{
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
                      }],
                      stateMutability: 'view',
                      type: 'function',
                    }],
                    functionName: 'getPoolKey',
                    args: [sellHookPoolIdRaw],
                  }) as unknown as {
                    currency0: `0x${string}`;
                    currency1: `0x${string}`;
                    fee: number;
                    tickSpacing: number;
                    hooks: `0x${string}`;
                  };

                  // wASS → ETH direction: ETH is currency0 (0x0), wASS is currency1
                  // Selling wASS (currency1) for ETH (currency0) = zeroForOne = false
                  const ethOut = await getSimulateQuote(wassEthPoolKey, false, wassOut);
                  console.log('wASS→ETH quote:', formatEther(ethOut), 'ETH for', formatUnits(wassOut, 18), 'wASS');
                  console.log('=== MULTI-HOP FINAL:', formatEther(ethOut), 'ETH for', formatUnits(tokenIn, 18), 'Token ===');

                  if (ethOut > 0n) {
                    setOutputAmount(formatEther(ethOut));
                  } else {
                    // Fallback: estimate ETH from wASS at 1:1 USD
                    console.log('wASS→ETH quote returned 0, using wASS amount as fallback');
                    setOutputAmount(formatUnits(wassOut, 18));
                  }
                } else {
                  console.log('Token→wASS quote returned 0, using 1:1 estimate');
                  setOutputAmount(formatUnits(tokenIn, 18));
                }
              } else {
                // Single-hop sell: Token → wASS (output is wASS)
                if (wassOut > 0n) {
                  setOutputAmount(formatUnits(wassOut, 18));
                } else {
                  console.log('Quoter returned 0, using 1:1 estimate');
                  setOutputAmount(formatUnits(tokenIn, 18));
                }
              }
            } catch (err) {
              console.error('Sell quoter failed:', err);
              if (sellOutputCurrency === 'eth') {
                setSwapError('Unable to get sell quote for ETH');
                setOutputAmount('');
              } else {
                console.log('Using 1:1 estimate for wASS');
                setOutputAmount(formatUnits(tokenIn, 18));
              }
            }
          }
        } else {
          // Default pair: wASS/ETH - use original working quoter with simulateContract
          // Get pool key from hook - use different pool for sells (deeper liquidity)
          const hookAddress = await publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'hook',
            args: [],
          }) as `0x${string}`;

          // Use the default pool from NFT contract (poolIdRaw) for both buys and sells
          // Note: SELL_POOL_ID lives on a different hook contract than the NFT's hook(),
          // so we use the default pool which is always available on the current hook.
          const poolIdToUse = await publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'poolIdRaw',
            args: [],
          }) as `0x${string}`;

          console.log('[ChartModal] Using default pool for quote:', poolIdToUse);

          const poolKeyData = await publicClient.readContract({
            address: hookAddress,
            abi: [{
              inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
              name: 'getPoolKey',
              outputs: [{
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
              }],
              stateMutability: 'view',
              type: 'function',
            }],
            functionName: 'getPoolKey',
            args: [poolIdToUse],
          }) as unknown as {
            currency0: `0x${string}`;
            currency1: `0x${string}`;
            fee: number;
            tickSpacing: number;
            hooks: `0x${string}`;
          };

          // Determine swap direction
          const zeroForOne = swapTab === 'buy'; // Buy: ETH->Token, Sell: Token->ETH
          const exactAmount = swapTab === 'buy'
            ? parseEther(inputAmount)
            : parseUnits(inputAmount, 18);

          const result = await publicClient.simulateContract({
            address: QUOTER_ADDRESS,
            abi: QUOTER_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{
              poolKey: poolKeyData,
              zeroForOne: zeroForOne,
              exactAmount: BigInt(exactAmount.toString()),
              hookData: '0x',
            }],
          });

          const [amountOut] = result.result as [bigint, bigint];

          if (swapTab === 'buy') {
            // Output is tokens
            setOutputAmount(formatUnits(amountOut, 18));
          } else {
            // Output is ETH
            setOutputAmount(formatEther(amountOut));
          }
        }
      } catch (err) {
        console.error('Quote error:', err);
        setSwapError('Unable to get quote');
        setOutputAmount('');
      } finally {
        setIsQuoting(false);
      }
    };

    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [inputAmount, swapTab, buyInputCurrency, sellOutputCurrency, publicClient, contracts.nft.address, contracts.nft.abi, isTokenPair, isTokenWarsEthPair, isHydrexPair, isAerodromePair, isWassPairedAerodrome, aerodromeBaseToken, outputTokenAddress, selectedPair]);

  // Handle successful transaction (from either writeContract or sendTransaction)
  useEffect(() => {
    const successHash = txHash || sendTxHash;
    if (isSuccess && successHash) {
      updateTransaction(successHash, 'success');

      // Handle differently based on transaction type
      if (pendingTxType === 'approval-permit2') {
        // Permit2 approval succeeded - advance to router approval step
        console.log('[Approval] Permit2 approval succeeded, advancing to router step');
        refetchPermit2Allowance();
        setApprovalStep('router');
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      if (pendingTxType === 'approval-router') {
        // Router approval succeeded - now ready to sell
        console.log('[Approval] Router approval succeeded, ready to sell');
        refetchRouterAllowance();
        setApprovalStep('ready');
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      if (pendingTxType === 'approval-aerodrome') {
        // Aerodrome approval succeeded - ready to sell
        console.log('[Approval] Aerodrome approval succeeded, ready to sell');
        setApprovalStep('ready');
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      if (pendingTxType === 'approval-hydrex') {
        // Hydrex/KyberSwap approval succeeded - ready to sell
        console.log('[Approval] Hydrex/KyberSwap approval succeeded, ready to sell');
        setApprovalStep('ready');
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      if (pendingTxType === 'approval-wass-aerodrome') {
        // wASS approval for Aerodrome succeeded - ready to buy
        console.log('[Approval] wASS approval for Aerodrome succeeded, ready to buy');
        setWassAerodromeApprovalNeeded(false);
        refetchWassAerodromeAllowance();
        refetchWassSlipstreamAllowance();
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      if (pendingTxType === 'approval-wass-permit2') {
        // wASS Permit2 approval succeeded - advance to router step
        console.log('[Approval] wASS Permit2 approval succeeded, advancing to router step');
        refetchWassPermit2Allowance();
        setBuyWassApprovalStep('router');
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      if (pendingTxType === 'approval-wass-router') {
        // wASS Router approval succeeded - ready to buy
        console.log('[Approval] wASS Router approval succeeded, ready to buy');
        refetchWassRouterAllowance();
        setBuyWassApprovalStep('ready');
        setPendingTxType(null);
        setTimeout(() => resetWrite(), 500);
        return;
      }

      // For swaps: full reset
      refetchTokenBalance();
      refetchOutputTokenBalance();
      refetchPermit2Allowance();
      refetchRouterAllowance();
      refetchWassPermit2Allowance();
      refetchWassRouterAllowance();
      setInputAmount('');
      setOutputAmount('');
      setBuyWassApprovalStep('none'); // Reset wASS approval state after successful transaction
      setPendingTxType(null);
      // Reset both hooks to clear state
      setTimeout(() => {
        resetWrite();
        resetSendTx();
      }, 2000);
      // Enable fast polling mode for faster chart updates after swap
      enableFastPolling();
      // Apply optimistic chart update with last known price
      if (lastSwapPriceRef.current) {
        applyOptimisticUpdate(lastSwapPriceRef.current);
      }
      // Notify parent to refresh trade history
      onSwapComplete?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, txHash, sendTxHash, updateTransaction, refetchTokenBalance, refetchOutputTokenBalance, refetchPermit2Allowance, refetchRouterAllowance, refetchWassPermit2Allowance, refetchWassRouterAllowance, resetWrite, resetSendTx, pendingTxType]);

  // Reset on transaction error/cancel to allow retry immediately
  useEffect(() => {
    if (writeError) {
      console.log('Transaction error/cancel (writeContract):', writeError.message);
      // Reset immediately so button is clickable again
      setPendingTxType(null);
      resetWrite();
    }
  }, [writeError, resetWrite]);

  // Reset on sendTransaction error/cancel
  useEffect(() => {
    if (sendError) {
      console.log('Transaction error/cancel (sendTransaction):', sendError.message);
      // Reset immediately so button is clickable again
      setPendingTxType(null);
      resetSendTx();
    }
  }, [sendError, resetSendTx]);

  // Track sendTransaction hash when it appears (for Hydrex buy)
  useEffect(() => {
    if (sendTxHash && pendingTxType === 'swap' && isHydrexPair) {
      console.log('[Hydrex] Buy tx submitted via sendTransaction:', sendTxHash);
      addTransaction(sendTxHash, `Buying ${outputTokenSymbol || 'Token'} with ETH via Hydrex`);
    }
  }, [sendTxHash, pendingTxType, isHydrexPair, addTransaction, outputTokenSymbol]);

  // Handle Buy (OTC for wASS/ETH, swapToToken for token pairs, V4 swap for wASS→Token)
  const handleBuy = () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) return;

    // Handle buying with wASS on token pairs (wASS → Token via V4)
    // Skip for Aerodrome pairs - they use their own router (handled below at isAerodromePair check)
    if (buyInputCurrency === 'wass' && isTokenPair && outputTokenAddress && !isAerodromePair) {
      handleBuyWithWass();
      return;
    }

    setPendingTxType('swap');
    const ethValue = parseEther(inputAmount);

    // Hydrex pair: Use KyberSwap aggregator for swaps
    if (isHydrexPair && outputTokenAddress && hydrexRouteInfo) {
      // Reset any stale errors from previous operations
      resetWrite();
      resetSendTx();
      setSwapError(null);

      console.log('=== HYDREX BUY: ETH → Token via KyberSwap ===');
      console.log('ETH value:', formatEther(ethValue));
      console.log('Token address:', outputTokenAddress);
      console.log('Route summary:', hydrexRouteInfo.routeSummary);
      console.log('Router address:', hydrexRouteInfo.routerAddress);

      // Build swap transaction using KyberSwap API
      buildKyberSwapTransaction(
        hydrexRouteInfo.routeSummary,
        address,
        address,
        50, // 0.5% slippage
        Math.floor(Date.now() / 1000) + 1200 // 20 min deadline
      ).then((buildResponse) => {
        if (buildResponse.code !== 0 || !buildResponse.data) {
          console.error('[Hydrex] Failed to build swap tx:', buildResponse.message);
          setSwapError(`Hydrex: ${buildResponse.message || 'Failed to build transaction'}`);
          setPendingTxType(null);
          return;
        }

        const { data: encodedData, routerAddress } = buildResponse.data;
        console.log('[Hydrex] Swap tx built:', { routerAddress, dataLength: encodedData.length });
        console.log('[Hydrex] Sending buy transaction via sendTransaction hook...');

        // Execute the swap with raw calldata using sendTransaction
        sendTransaction({
          to: routerAddress as `0x${string}`,
          data: encodedData as `0x${string}`,
          value: ethValue,
        });

        // Note: Transaction tracking happens via sendTxHash in useEffect
      }).catch((err) => {
        console.error('[Hydrex] Build error:', err);
        setSwapError(`Hydrex: ${err instanceof Error ? err.message : 'Build failed'}`);
        setPendingTxType(null);
      });

      return;
    }

    // Aerodrome pair: Use Slipstream SwapRouter for CL pools, V2 Router for V2 pools
    if (isAerodromePair && outputTokenAddress) {
      const minTokensOut = outputAmount ? parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18) : 0n; // 5% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

      // Check if this is a CL pool (has tickSpacing) or V2 pool
      const isCLPool = aerodromePoolInfo?.tickSpacing !== undefined && aerodromePoolInfo.tickSpacing > 0;
      const poolStable = aerodromePoolInfo?.stable ?? false;

      // Determine base token (wASS for wASS-paired, WETH for ETH-paired)
      const baseToken = aerodromeBaseToken;
      const isWassBase = isWassPairedAerodrome;
      const baseTokenLabel = isWassBase ? 'wASS' : 'ETH';

      console.log(`=== AERODROME BUY: ${baseTokenLabel} → Token ===`);
      console.log(`${baseTokenLabel} value:`, formatEther(ethValue));
      console.log('Token address:', outputTokenAddress);
      console.log('Min tokens out:', formatUnits(minTokensOut, 18));
      console.log('Pool type:', isCLPool ? `CL (tickSpacing=${aerodromePoolInfo?.tickSpacing})` : (poolStable ? 'V2 stable' : 'V2 volatile'));
      console.log('Pool address:', aerodromePoolInfo?.poolAddress);
      console.log('Is wASS-paired:', isWassBase);

      if (isCLPool) {
        // CL Pool: Use Slipstream SwapRouter.exactInputSingle
        console.log('Using Slipstream SwapRouter:', SLIPSTREAM_SWAP_ROUTER_ADDRESS);

        const swapParams = {
          tokenIn: baseToken,
          tokenOut: outputTokenAddress,
          tickSpacing: aerodromePoolInfo!.tickSpacing!,
          recipient: address,
          deadline: deadline,
          amountIn: ethValue,
          amountOutMinimum: minTokensOut,
          sqrtPriceLimitX96: 0n, // No price limit
        };

        console.log('Swap params:', swapParams);

        if (isWassBase) {
          // wASS-paired: Token-to-token swap, no ETH value
          writeContract({
            address: SLIPSTREAM_SWAP_ROUTER_ADDRESS,
            abi: SLIPSTREAM_SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [swapParams],
          });
        } else {
          // ETH-paired: Send ETH value
          writeContract({
            address: SLIPSTREAM_SWAP_ROUTER_ADDRESS,
            abi: SLIPSTREAM_SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [swapParams],
            value: ethValue,
          });
        }
      } else {
        // V2 Pool
        console.log('Using V2 Router:', AERODROME_ROUTER_ADDRESS);

        const routes: AerodromeRoute[] = [{
          from: baseToken,
          to: outputTokenAddress,
          stable: poolStable,
          factory: AERODROME_FACTORY_ADDRESS,
        }];

        console.log('Route:', routes);

        if (isWassBase) {
          // wASS-paired: Use swapExactTokensForTokens (token-to-token)
          writeContract({
            address: AERODROME_ROUTER_ADDRESS,
            abi: AERODROME_ROUTER_ABI,
            functionName: 'swapExactTokensForTokens',
            args: [ethValue, minTokensOut, routes as readonly { from: `0x${string}`; to: `0x${string}`; stable: boolean; factory: `0x${string}`; }[], address, deadline],
          });
        } else {
          // ETH-paired: Use swapExactETHForTokens
          writeContract({
            address: AERODROME_ROUTER_ADDRESS,
            abi: AERODROME_ROUTER_ABI,
            functionName: 'swapExactETHForTokens',
            args: [minTokensOut, routes as readonly { from: `0x${string}`; to: `0x${string}`; stable: boolean; factory: `0x${string}`; }[], address, deadline],
            value: ethValue,
          });
        }
      }

      if (txHash) {
        addTransaction(txHash, `Buying ${outputTokenSymbol || 'Token'}`);
      }
      return;
    }

    if (isTokenWarsEthPair && outputTokenAddress) {
      // Token Wars ETH pair: DIRECT V4 swap (ETH → Token, single hop)
      // Use Universal Router with V4 commands
      const minTokensOut = outputAmount ? parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18) : 0n; // 5% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

      // Build pool key for ETH/Token pair - V4 pools require SORTED tokens!
      const [sortedCurrency0, sortedCurrency1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
        ? [selectedPair.token0, selectedPair.token1]
        : [selectedPair.token1, selectedPair.token0];

      const ethPoolKey = {
        currency0: sortedCurrency0,
        currency1: sortedCurrency1,
        fee: selectedPair.fee,
        tickSpacing: selectedPair.tickSpacing,
        hooks: selectedPair.hook,
      };

      // Determine direction: ETH → TOKEN (using sorted pool key)
      const ethIsToken0 = sortedCurrency0 === ETH_ADDRESS;
      const zeroForOne = ethIsToken0;

      console.log('=== TOKEN WARS ETH PAIR BUY (Direct V4) ===');
      console.log('ETH value:', formatEther(ethValue));
      console.log('Pool key (sorted):', JSON.stringify(ethPoolKey, null, 2));
      console.log('ETH is token0:', ethIsToken0);
      console.log('zeroForOne:', zeroForOne);
      console.log('minTokensOut:', formatUnits(minTokensOut, 18));

      // Build V4 swap calldata for ETH → Token
      const { commands, inputs } = buildV4SwapCalldataForEthBuy(
        ethValue,
        minTokensOut,
        ethPoolKey,
        zeroForOne
      );

      writeContract({
        address: UNIVERSAL_ROUTER_ADDRESS,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, inputs, deadline],
        value: ethValue,
      });

      if (txHash) {
        addTransaction(txHash, `Buying ${outputTokenSymbol || 'Token'}`);
      }
    } else if (isTokenPair && outputTokenAddress) {
      // wASS/TOKEN pair: Multi-hop buy: ETH → wASS → Token using swapToToken
      // Use 0 for min amounts to avoid slippage issues during testing
      const minTokensOut = 0n;
      const minWassOut = 0n;

      // Sort tokens for V4 pool key (currency0 must be lower address)
      const [sortedC0, sortedC1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
        ? [selectedPair.token0, selectedPair.token1]
        : [selectedPair.token1, selectedPair.token0];
      const wassIsToken0 = sortedC0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();

      // Build the output pool key for swapToToken
      const outputPoolKey = {
        currency0: sortedC0,
        currency1: sortedC1,
        fee: selectedPair.fee,
        tickSpacing: selectedPair.tickSpacing,
        hooks: selectedPair.hook,
      };

      console.log('=== wASS/TOKEN PAIR BUY via OTC (multi-hop) ===');
      console.log('ETH value:', formatEther(ethValue));
      console.log('Pool key:', outputPoolKey);
      console.log('wassIsToken0:', wassIsToken0);
      console.log('minWassOut:', minWassOut.toString());
      console.log('minTokensOut:', minTokensOut.toString());

      writeContract({
        address: contracts.otc.address as `0x${string}`,
        abi: contracts.otc.abi,
        functionName: 'swapToToken',
        args: [outputPoolKey, minWassOut, minTokensOut, wassIsToken0],
        value: ethValue,
      });

      if (txHash) {
        addTransaction(txHash, `Buying ${outputTokenSymbol || 'Token'}`);
      }
    } else {
      // Default: ETH → wASS using OTC swap
      const minTokensOut = outputAmount ? parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18) : 0n; // 5% slippage

      writeContract({
        address: contracts.otc.address as `0x${string}`,
        abi: contracts.otc.abi,
        functionName: 'swap',
        args: [minTokensOut],
        value: ethValue,
      });

      if (txHash) {
        addTransaction(txHash, 'Buying wASS');
      }
    }
  };

  // Handle buying with wASS input (wASS → Token via V4 swap)
  const handleBuyWithWass = async () => {
    if (!address || !inputAmount || !outputTokenAddress || !publicClient) return;

    try {
      setPendingTxType('swap');
      const wassAmount = parseUnits(inputAmount, 18);
      // TEMPORARY: Use 0 minOut to test if swap works at all (bypasses slippage check)
      // Normal: parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18)
      const minTokensOut = 0n; // TODO: Restore slippage protection after debugging
      console.log('⚠️ TESTING MODE: minTokensOut = 0 (no slippage protection)');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

      // wASS → Token is a single-hop V4 swap
      // Sort tokens for V4 pool key (currency0 must be lower address)
      const [sortedC0, sortedC1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
        ? [selectedPair.token0, selectedPair.token1]
        : [selectedPair.token1, selectedPair.token0];
      const wassIsToken0 = sortedC0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();

      // Build pool key for wASS/Token pair
      const tokenPoolKey = {
        currency0: sortedC0,
        currency1: sortedC1,
        fee: selectedPair.fee,
        tickSpacing: selectedPair.tickSpacing,
        hooks: selectedPair.hook,
      };

      console.log('=== wASS → TOKEN V4 SWAP (BUY) ===');
      console.log('wASS amount (input):', formatUnits(wassAmount, 18));
      console.log('Min tokens out:', formatUnits(minTokensOut, 18));
      console.log('Pool key:', JSON.stringify(tokenPoolKey, null, 2));
      console.log('wassIsToken0:', wassIsToken0);
      console.log('zeroForOne:', wassIsToken0); // wASS → TOKEN = token0 → token1 if wASS is token0
      console.log('Input token (wASS):', WASS_TOKEN_ADDRESS);
      console.log('Output token:', outputTokenAddress);
      console.log('Universal Router:', UNIVERSAL_ROUTER_ADDRESS);
      console.log('Permit2:', PERMIT2_ADDRESS);

      // Verify wASS approvals before attempting swap
      console.log('=== CHECKING wASS APPROVALS ===');
      const wassErc20Allowance = wassPermit2Allowance as bigint | undefined;
      console.log('wASS ERC20 allowance for Permit2:', wassErc20Allowance?.toString() || '0');
      console.log('Required amount:', wassAmount.toString());
      if (!wassErc20Allowance || wassErc20Allowance < wassAmount) {
        setSwapError('Insufficient wASS approval for Permit2. Please approve first.');
        return;
      }

      const routerAllowance = wassRouterAllowanceData as unknown as readonly [bigint, bigint, bigint] | undefined;
      const [routerAmount, routerExpiration] = routerAllowance || [0n, 0n, 0n];
      const currentTime = BigInt(Math.floor(Date.now() / 1000));
      console.log('Permit2 router allowance amount:', routerAmount.toString());
      console.log('Permit2 router allowance expiration:', routerExpiration.toString());
      console.log('Current time:', currentTime.toString());
      if (routerAmount < wassAmount || routerExpiration < currentTime) {
        setSwapError('Insufficient Permit2 router allowance. Please approve first.');
        return;
      }
      console.log('=== APPROVALS VERIFIED ===');

      // Use the same proper V4 Router format as the working sell function
      // Actions: SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f)
      const { commands, inputs } = buildV4SwapCalldataForTokenPair(
        wassAmount,
        minTokensOut,
        tokenPoolKey,
        wassIsToken0, // zeroForOne: if wASS is token0, swap 0→1
        WASS_TOKEN_ADDRESS as `0x${string}`, // input token (wASS)
        outputTokenAddress // output token (the token we're buying)
      );

      console.log('Commands (should be 0x10):', commands);
      console.log('Inputs array length:', inputs.length);
      console.log('V4 Input data:', inputs[0]?.substring(0, 200) + '...');

      // Simulate the transaction first to get detailed error messages
      console.log('=== SIMULATING TRANSACTION ===');
      try {
        const simulation = await publicClient.simulateContract({
          address: UNIVERSAL_ROUTER_ADDRESS,
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
          account: address,
        });
        console.log('Simulation successful:', simulation);
      } catch (simError: unknown) {
        console.error('=== SIMULATION FAILED ===');
        console.error('Simulation error:', simError);

        // Try to decode V4TooLittleReceived error to get actual values
        const V4_ERROR_ABI = [{
          type: 'error',
          name: 'V4TooLittleReceived',
          inputs: [
            { name: 'minAmountOutReceived', type: 'uint256' },
            { name: 'amountReceived', type: 'uint256' }
          ]
        }] as const;

        // Extract error data from the error message
        const errorObj = simError as { cause?: { data?: `0x${string}` }; data?: `0x${string}` };
        const errorData = errorObj?.cause?.data || errorObj?.data;

        if (errorData && errorData.startsWith('0x8b063d73')) {
          try {
            const decoded = decodeErrorResult({
              abi: V4_ERROR_ABI,
              data: errorData
            });
            console.error('=== V4TooLittleReceived DECODED ===');
            console.error('minAmountOutReceived:', decoded.args[0]?.toString());
            console.error('amountReceived:', decoded.args[1]?.toString());
            setSwapError(`Swap failed: Expected min ${formatUnits(decoded.args[0] || 0n, 18)} but got ${formatUnits(decoded.args[1] || 0n, 18)} tokens`);
          } catch (decodeErr) {
            console.error('Failed to decode error:', decodeErr);
            console.error('Raw error data:', errorData);
          }
        }

        if (simError instanceof Error) {
          console.error('Error message:', simError.message);
          // Extract revert reason if available
          const errorMessage = simError.message;

          // Also try to extract error data from message
          const dataMatch = errorMessage.match(/data: "(0x[a-fA-F0-9]+)"/);
          if (dataMatch && dataMatch[1]?.startsWith('0x8b063d73')) {
            try {
              const decoded = decodeErrorResult({
                abi: V4_ERROR_ABI,
                data: dataMatch[1] as `0x${string}`
              });
              console.error('=== V4TooLittleReceived DECODED (from message) ===');
              console.error('minAmountOutReceived:', decoded.args[0]?.toString());
              console.error('amountReceived:', decoded.args[1]?.toString());
              setSwapError(`Swap failed: Expected min ${formatUnits(decoded.args[0] || 0n, 18)} but got ${formatUnits(decoded.args[1] || 0n, 18)} tokens`);
              return;
            } catch (decodeErr) {
              console.error('Failed to decode from message:', decodeErr);
            }
          }

          if (errorMessage.includes('execution reverted')) {
            const revertMatch = errorMessage.match(/reason: (.+?)(?:\n|$)/);
            if (revertMatch) {
              setSwapError(`Swap simulation failed: ${revertMatch[1]}`);
            } else {
              setSwapError('Swap simulation failed: execution reverted');
            }
          } else {
            setSwapError(`Swap simulation failed: ${simError.message.substring(0, 100)}`);
          }
        }
        return;
      }

      writeContract({
        address: UNIVERSAL_ROUTER_ADDRESS,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, inputs, deadline],
      });
    } catch (err) {
      console.error('Buy with wASS error:', err);
      if (err instanceof Error) {
        setSwapError(`Failed to execute swap: ${err.message.substring(0, 100)}`);
      } else {
        setSwapError('Failed to execute swap');
      }
    }
  };

  // Handle Permit2 Approval (Step 1: Approve Permit2 to spend tokens)
  const handleApprovePermit2 = async () => {
    if (!address) return;

    try {
      setPendingTxType('approval-permit2');
      writeContract({
        address: sellTokenAddress,
        abi: contracts.token.abi,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, maxUint160],
      });

      if (txHash) {
        addTransaction(txHash, `Approving ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`);
      }
    } catch (err) {
      console.error('Permit2 approval error:', err);
      setSwapError('Failed to approve Permit2');
      setPendingTxType(null);
    }
  };

  // Handle Router Approval (Step 2: Approve Universal Router on Permit2)
  const handleApproveRouter = async () => {
    if (!address) return;

    try {
      // Approve Universal Router via Permit2 with max amount and far future expiration
      // Note: uint48 max is 281,474,976,710,655 which fits in a JS number
      const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year

      setPendingTxType('approval-router');
      writeContract({
        address: PERMIT2_ADDRESS,
        abi: PERMIT2_ABI,
        functionName: 'approve',
        args: [sellTokenAddress, UNIVERSAL_ROUTER_ADDRESS, maxUint160, expiration],
      });

      if (txHash) {
        addTransaction(txHash, 'Approving Router');
      }
    } catch (err) {
      console.error('Router approval error:', err);
      setSwapError('Failed to approve Router');
      setPendingTxType(null);
    }
  };

  // Handle Aerodrome Router Approval (for selling on Aerodrome)
  // Uses Slipstream SwapRouter for CL pools, V2 Router for V2 pools
  const handleApproveAerodrome = async () => {
    if (!address || !outputTokenAddress) return;

    // Determine which router to approve based on pool type
    const isCLPool = aerodromePoolInfo?.tickSpacing !== undefined && aerodromePoolInfo.tickSpacing > 0;
    const routerToApprove = isCLPool ? SLIPSTREAM_SWAP_ROUTER_ADDRESS : AERODROME_ROUTER_ADDRESS;
    const routerName = isCLPool ? 'Slipstream' : 'Aerodrome';

    console.log(`Approving ${routerName} Router:`, routerToApprove);

    try {
      setPendingTxType('approval-aerodrome');
      writeContract({
        address: outputTokenAddress,
        abi: [{
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          name: 'approve',
          outputs: [{ name: '', type: 'bool' }],
          stateMutability: 'nonpayable',
          type: 'function',
        }],
        functionName: 'approve',
        args: [routerToApprove, maxUint160],
      });

      if (txHash) {
        addTransaction(txHash, `Approving ${outputTokenSymbol || 'Token'} for ${routerName}`);
      }
    } catch (err) {
      console.error(`${routerName} approval error:`, err);
      setSwapError(`Failed to approve for ${routerName}`);
      setPendingTxType(null);
    }
  };

  // Handle Hydrex/KyberSwap Router Approval (for selling on Hydrex)
  const handleApproveHydrex = async () => {
    if (!address || !outputTokenAddress) return;

    console.log('[Hydrex] Approving KyberSwap Router:', KYBERSWAP_ROUTER_ADDRESS);

    try {
      setPendingTxType('approval-hydrex');
      writeContract({
        address: outputTokenAddress,
        abi: [{
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          name: 'approve',
          outputs: [{ name: '', type: 'bool' }],
          stateMutability: 'nonpayable',
          type: 'function',
        }],
        functionName: 'approve',
        args: [KYBERSWAP_ROUTER_ADDRESS, maxUint160],
      });

      if (txHash) {
        addTransaction(txHash, `Approving ${outputTokenSymbol || 'Token'} for Hydrex`);
      }
    } catch (err) {
      console.error('[Hydrex] Approval error:', err);
      setSwapError('Failed to approve for Hydrex');
      setPendingTxType(null);
    }
  };

  // Handle wASS approval for Aerodrome (for buying with wASS on wASS-paired Aerodrome tokens)
  const handleApproveWassAerodrome = async () => {
    if (!address) return;

    // Check if this is a CL pool or V2 pool
    const isCLPool = aerodromePoolInfo?.tickSpacing !== undefined && aerodromePoolInfo.tickSpacing > 0;
    const routerAddress = isCLPool ? SLIPSTREAM_SWAP_ROUTER_ADDRESS : AERODROME_ROUTER_ADDRESS;
    const routerName = isCLPool ? 'Slipstream' : 'Aerodrome';

    console.log(`[wASS-Aerodrome] Approving wASS to ${routerName} Router:`, routerAddress);

    try {
      setPendingTxType('approval-wass-aerodrome');
      writeContract({
        address: WASS_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [routerAddress, maxUint160],
      });

      if (txHash) {
        addTransaction(txHash, `Approving wASS for ${routerName}`);
      }
    } catch (err) {
      console.error('[wASS-Aerodrome] Approval error:', err);
      setSwapError(`Failed to approve wASS for ${routerName}`);
      setPendingTxType(null);
    }
  };

  // Handle wASS Permit2 Approval (for buying with wASS on token pairs)
  const handleApproveWassPermit2 = async () => {
    if (!address) return;

    try {
      setPendingTxType('approval-wass-permit2');
      writeContract({
        address: contracts.token.address as `0x${string}`,
        abi: contracts.token.abi,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, maxUint160],
      });

      if (txHash) {
        addTransaction(txHash, 'Approving wASS');
      }
    } catch (err) {
      console.error('wASS Permit2 approval error:', err);
      setSwapError('Failed to approve wASS');
      setPendingTxType(null);
    }
  };

  // Handle wASS Router Approval (for buying with wASS on token pairs)
  const handleApproveWassRouter = async () => {
    if (!address) return;

    try {
      const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year

      setPendingTxType('approval-wass-router');
      writeContract({
        address: PERMIT2_ADDRESS,
        abi: PERMIT2_ABI,
        functionName: 'approve',
        args: [contracts.token.address, UNIVERSAL_ROUTER_ADDRESS, maxUint160, expiration],
      });

      if (txHash) {
        addTransaction(txHash, 'Approving Router for wASS');
      }
    } catch (err) {
      console.error('wASS Router approval error:', err);
      setSwapError('Failed to approve Router for wASS');
      setPendingTxType(null);
    }
  };

  // Handle batched approve + swap for smart wallets (one-click)
  const handleBatchedApproveAndSell = async () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) return;

    try {
      const sellAmount = parseUnits(inputAmount, 18);
      const minWassOut = outputAmount ? parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18) : 0n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes
      const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year

      // Build the calls array based on what approvals are needed
      const calls: Array<{
        to: `0x${string}`;
        data: `0x${string}`;
        value?: bigint;
      }> = [];

      // Check if Permit2 approval is needed
      const erc20Allowance = permit2Allowance as bigint | undefined;
      if (!erc20Allowance || erc20Allowance < sellAmount) {
        // Add ERC20 approve for Permit2
        const approveData = encodeFunctionData({
          abi: contracts.token.abi,
          functionName: 'approve',
          args: [PERMIT2_ADDRESS, maxUint160],
        });
        calls.push({
          to: sellTokenAddress,
          data: approveData,
        });
      }

      // Check if Router approval on Permit2 is needed
      const allowanceResult = routerAllowanceData as unknown as readonly [bigint, bigint, bigint] | undefined;
      const [amount, routerExpiration] = allowanceResult || [0n, 0n, 0n];
      const currentTime = BigInt(Math.floor(Date.now() / 1000));
      if (amount < sellAmount || routerExpiration < currentTime) {
        // Add Permit2 approve for Universal Router
        const permit2ApproveData = encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [sellTokenAddress, UNIVERSAL_ROUTER_ADDRESS, maxUint160, expiration],
        });
        calls.push({
          to: PERMIT2_ADDRESS,
          data: permit2ApproveData,
        });
      }

      // Build and add the swap call
      if (isTokenPair && outputTokenAddress) {
        // Single-hop sell: Token -> wASS
        // Sort tokens for V4 pool key (currency0 must be lower address)
        const [sortedC0, sortedC1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
          ? [selectedPair.token0, selectedPair.token1]
          : [selectedPair.token1, selectedPair.token0];
        const tokenPoolKey = {
          currency0: sortedC0,
          currency1: sortedC1,
          fee: selectedPair.fee,
          tickSpacing: selectedPair.tickSpacing,
          hooks: selectedPair.hook,
        };
        const wassIsToken0 = sortedC0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();
        const zeroForOne = !wassIsToken0;

        const { commands, inputs } = buildV4SwapCalldataForTokenPair(
          sellAmount,
          minWassOut,
          tokenPoolKey,
          zeroForOne,
          outputTokenAddress,
          WASS_TOKEN_ADDRESS as `0x${string}`
        );

        const swapData = encodeFunctionData({
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });
        calls.push({
          to: UNIVERSAL_ROUTER_ADDRESS,
          data: swapData,
        });
      } else if (publicClient) {
        // Single-hop sell: wASS -> ETH using default pool from NFT contract
        const [batchSellHookAddress, batchSellPoolId] = await Promise.all([
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'hook',
            args: [],
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'poolIdRaw',
            args: [],
          }) as Promise<`0x${string}`>,
        ]);

        const sellPoolKeyData = await publicClient.readContract({
          address: batchSellHookAddress,
          abi: [{
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [{
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
            }],
            stateMutability: 'view',
            type: 'function',
          }],
          functionName: 'getPoolKey',
          args: [batchSellPoolId],
        }) as unknown as {
          currency0: `0x${string}`;
          currency1: `0x${string}`;
          fee: number;
          tickSpacing: number;
          hooks: `0x${string}`;
        };

        const minEthOut = outputAmount ? parseEther((parseFloat(outputAmount) * 0.95).toString()) : 0n;
        console.log('[ChartModal] Batched sell using default pool:', batchSellPoolId);
        const { commands, inputs } = buildV4SwapCalldata(sellAmount, minEthOut, sellPoolKeyData);

        const swapData = encodeFunctionData({
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });
        calls.push({
          to: UNIVERSAL_ROUTER_ADDRESS,
          data: swapData,
        });
      }

      if (calls.length === 0) {
        setSwapError('No calls to execute');
        return;
      }

      // Send batched calls - result comes via sendCallsData
      sendCalls({
        calls,
        chainId: base.id,
      });
    } catch (err) {
      console.error('Batched approve+swap error:', err);
      setSwapError('Failed to execute batched transaction');
    }
  };

  // Build V4 swap calldata for single-hop (wASS -> ETH)
  const buildV4SwapCalldata = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
    key: NonNullable<typeof poolKey>
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    // For selling tokens (Token -> ETH), zeroForOne is false because token1 -> currency0 (ETH)
    // currency0 is ETH (0x000...), currency1 is our token
    const zeroForOne = false;

    // Encode the actions for V4Router
    // Actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const actions = new Uint8Array([SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);

    // Encode SWAP_EXACT_IN_SINGLE params
    // struct ExactInputSingleParams {
    //     PoolKey poolKey;
    //     bool zeroForOne;
    //     uint128 amountIn;
    //     uint128 amountOutMinimum;
    //     bytes hookData;
    // }
    const swapParams = encodeFunctionData({
      abi: [{
        name: 'swap',
        type: 'function',
        inputs: [{
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'poolKey', type: 'tuple', components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ]},
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        }],
        outputs: [],
      }],
      functionName: 'swap',
      args: [{
        poolKey: {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          tickSpacing: key.tickSpacing,
          hooks: key.hooks,
        },
        zeroForOne: zeroForOne,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        hookData: '0x' as `0x${string}`,
      }],
    });

    // Remove function selector (first 4 bytes)
    const swapParamsData = ('0x' + swapParams.slice(10)) as `0x${string}`;

    // Encode SETTLE_ALL params: (address currency, uint256 maxAmount)
    // Settle the input token (our token)
    const settleParams = encodeFunctionData({
      abi: [{
        name: 'settle',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'maxAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'settle',
      args: [key.currency1, amountIn], // Settle our token
    });
    const settleParamsData = ('0x' + settleParams.slice(10)) as `0x${string}`;

    // Encode TAKE_ALL params: (address currency, uint256 minAmount)
    // Take ETH output
    const takeParams = encodeFunctionData({
      abi: [{
        name: 'take',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'minAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'take',
      args: [key.currency0, minAmountOut], // Take ETH
    });
    const takeParamsData = ('0x' + takeParams.slice(10)) as `0x${string}`;

    // Build the V4 swap input
    // V4_SWAP input format: (bytes actions, bytes[] params)
    const v4Input = encodeFunctionData({
      abi: [{
        name: 'v4Swap',
        type: 'function',
        inputs: [
          { name: 'actions', type: 'bytes' },
          { name: 'params', type: 'bytes[]' },
        ],
        outputs: [],
      }],
      functionName: 'v4Swap',
      args: [
        ('0x' + Buffer.from(actions).toString('hex')) as `0x${string}`,
        [swapParamsData, settleParamsData, takeParamsData],
      ],
    });
    const v4InputData = ('0x' + v4Input.slice(10)) as `0x${string}`;

    // Commands: just V4_SWAP
    const commands = ('0x' + V4_SWAP.toString(16).padStart(2, '0')) as `0x${string}`;

    return { commands, inputs: [v4InputData] };
  }, []);

  // Build V4 swap calldata for Token Wars ETH pairs: ETH -> Token (single-hop)
  // For buying tokens with ETH in Token Wars pools (no hook, 1% fee)
  const buildV4SwapCalldataForEthBuy = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
    key: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` },
    zeroForOne: boolean // true if ETH is token0 (ETH -> Token), false if ETH is token1
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    console.log('[buildV4SwapCalldataForEthBuy] Building calldata');
    console.log('[buildV4SwapCalldataForEthBuy] poolKey:', JSON.stringify(key, null, 2));
    console.log('[buildV4SwapCalldataForEthBuy] zeroForOne:', zeroForOne);
    console.log('[buildV4SwapCalldataForEthBuy] amountIn:', amountIn.toString());
    console.log('[buildV4SwapCalldataForEthBuy] minAmountOut:', minAmountOut.toString());

    // Encode the actions for V4Router: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const actions = new Uint8Array([SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);

    // Encode SWAP_EXACT_IN_SINGLE params
    const swapParams = encodeFunctionData({
      abi: [{
        name: 'swap',
        type: 'function',
        inputs: [{
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'poolKey', type: 'tuple', components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ]},
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        }],
        outputs: [],
      }],
      functionName: 'swap',
      args: [{
        poolKey: {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          tickSpacing: key.tickSpacing,
          hooks: key.hooks,
        },
        zeroForOne: zeroForOne,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        hookData: '0x' as `0x${string}`,
      }],
    });
    const swapParamsData = ('0x' + swapParams.slice(10)) as `0x${string}`;

    // Determine which currency is ETH (input) and which is Token (output)
    const ethCurrency = zeroForOne ? key.currency0 : key.currency1;
    const tokenCurrency = zeroForOne ? key.currency1 : key.currency0;

    // Encode SETTLE_ALL params: settle ETH (the input)
    const settleParams = encodeFunctionData({
      abi: [{
        name: 'settle',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'maxAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'settle',
      args: [ethCurrency, amountIn],
    });
    const settleParamsData = ('0x' + settleParams.slice(10)) as `0x${string}`;

    // Encode TAKE_ALL params: take Token (the output)
    const takeParams = encodeFunctionData({
      abi: [{
        name: 'take',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'minAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'take',
      args: [tokenCurrency, minAmountOut],
    });
    const takeParamsData = ('0x' + takeParams.slice(10)) as `0x${string}`;

    // Build the V4 swap input
    const v4Input = encodeFunctionData({
      abi: [{
        name: 'v4Swap',
        type: 'function',
        inputs: [
          { name: 'actions', type: 'bytes' },
          { name: 'params', type: 'bytes[]' },
        ],
        outputs: [],
      }],
      functionName: 'v4Swap',
      args: [
        ('0x' + Buffer.from(actions).toString('hex')) as `0x${string}`,
        [swapParamsData, settleParamsData, takeParamsData],
      ],
    });
    const v4InputData = ('0x' + v4Input.slice(10)) as `0x${string}`;

    // Commands: just V4_SWAP
    const commands = ('0x' + V4_SWAP.toString(16).padStart(2, '0')) as `0x${string}`;

    console.log('[buildV4SwapCalldataForEthBuy] commands:', commands);
    console.log('[buildV4SwapCalldataForEthBuy] inputs[0] length:', v4InputData.length);

    return { commands, inputs: [v4InputData] };
  }, []);

  // Build V4 swap calldata for Token Wars ETH pairs: Token -> ETH (single-hop sell)
  // For selling tokens for ETH in Token Wars pools (needs Permit2 for input token)
  const buildV4SwapCalldataForTokenSell = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
    key: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` },
    zeroForOne: boolean, // direction based on token positions
    inputToken: `0x${string}` // the token being sold (not ETH)
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    console.log('[buildV4SwapCalldataForTokenSell] Building calldata');
    console.log('[buildV4SwapCalldataForTokenSell] poolKey:', JSON.stringify(key, null, 2));
    console.log('[buildV4SwapCalldataForTokenSell] zeroForOne:', zeroForOne);
    console.log('[buildV4SwapCalldataForTokenSell] amountIn:', amountIn.toString());
    console.log('[buildV4SwapCalldataForTokenSell] minAmountOut:', minAmountOut.toString());
    console.log('[buildV4SwapCalldataForTokenSell] inputToken:', inputToken);

    // Encode the actions for V4Router: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const actions = new Uint8Array([SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);

    // Encode SWAP_EXACT_IN_SINGLE params
    const swapParams = encodeFunctionData({
      abi: [{
        name: 'swap',
        type: 'function',
        inputs: [{
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'poolKey', type: 'tuple', components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ]},
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        }],
        outputs: [],
      }],
      functionName: 'swap',
      args: [{
        poolKey: {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          tickSpacing: key.tickSpacing,
          hooks: key.hooks,
        },
        zeroForOne: zeroForOne,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        hookData: '0x' as `0x${string}`,
      }],
    });
    const swapParamsData = ('0x' + swapParams.slice(10)) as `0x${string}`;

    // Encode SETTLE_ALL params: settle the input Token (uses Permit2)
    const settleParams = encodeFunctionData({
      abi: [{
        name: 'settle',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'maxAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'settle',
      args: [inputToken, amountIn],
    });
    const settleParamsData = ('0x' + settleParams.slice(10)) as `0x${string}`;

    // Encode TAKE_ALL params: take ETH (the output)
    const takeParams = encodeFunctionData({
      abi: [{
        name: 'take',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'minAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'take',
      args: [ETH_ADDRESS, minAmountOut],
    });
    const takeParamsData = ('0x' + takeParams.slice(10)) as `0x${string}`;

    // Build the V4 swap input
    const v4Input = encodeFunctionData({
      abi: [{
        name: 'v4Swap',
        type: 'function',
        inputs: [
          { name: 'actions', type: 'bytes' },
          { name: 'params', type: 'bytes[]' },
        ],
        outputs: [],
      }],
      functionName: 'v4Swap',
      args: [
        ('0x' + Buffer.from(actions).toString('hex')) as `0x${string}`,
        [swapParamsData, settleParamsData, takeParamsData],
      ],
    });
    const v4InputData = ('0x' + v4Input.slice(10)) as `0x${string}`;

    // Commands: just V4_SWAP
    const commands = ('0x' + V4_SWAP.toString(16).padStart(2, '0')) as `0x${string}`;

    console.log('[buildV4SwapCalldataForTokenSell] commands:', commands);
    console.log('[buildV4SwapCalldataForTokenSell] inputs[0] length:', v4InputData.length);

    return { commands, inputs: [v4InputData] };
  }, []);

  // Build V4 swap calldata for token pair single-hop (TOKEN -> wASS or wASS -> TOKEN)
  // Uses SETTLE_ALL which automatically handles Permit2 transfers (same as working wASS->ETH)
  // Uses same encodeFunctionData pattern as working buildV4SwapCalldata
  const buildV4SwapCalldataForTokenPair = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
    poolKeyData: {
      currency0: `0x${string}`;
      currency1: `0x${string}`;
      fee: number;
      tickSpacing: number;
      hooks: `0x${string}`;
    },
    zeroForOne: boolean,
    inputToken: `0x${string}`,
    outputToken: `0x${string}`
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    // Actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    // SETTLE_ALL (0x0c) automatically handles Permit2 - same pattern as working wASS->ETH
    const actions = new Uint8Array([SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);

    console.log('[buildV4SwapCalldataForTokenPair] Using encodeFunctionData (matching working pattern)');
    console.log('[buildV4SwapCalldataForTokenPair] poolKey:', JSON.stringify(poolKeyData, null, 2));
    console.log('[buildV4SwapCalldataForTokenPair] zeroForOne:', zeroForOne);
    console.log('[buildV4SwapCalldataForTokenPair] amountIn:', amountIn.toString());
    console.log('[buildV4SwapCalldataForTokenPair] minAmountOut:', minAmountOut.toString());
    console.log('[buildV4SwapCalldataForTokenPair] inputToken:', inputToken);
    console.log('[buildV4SwapCalldataForTokenPair] outputToken:', outputToken);

    // Encode SWAP_EXACT_IN_SINGLE params - same pattern as working buildV4SwapCalldata
    const swapParams = encodeFunctionData({
      abi: [{
        name: 'swap',
        type: 'function',
        inputs: [{
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'poolKey', type: 'tuple', components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ]},
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        }],
        outputs: [],
      }],
      functionName: 'swap',
      args: [{
        poolKey: {
          currency0: poolKeyData.currency0,
          currency1: poolKeyData.currency1,
          fee: poolKeyData.fee,
          tickSpacing: poolKeyData.tickSpacing,
          hooks: poolKeyData.hooks,
        },
        zeroForOne: zeroForOne,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        hookData: '0x' as `0x${string}`,
      }],
    });
    const swapParamsData = ('0x' + swapParams.slice(10)) as `0x${string}`;

    // Encode SETTLE_ALL params: (Currency currency, uint256 maxAmount)
    const settleParams = encodeFunctionData({
      abi: [{
        name: 'settle',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'maxAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'settle',
      args: [inputToken, amountIn],
    });
    const settleParamsData = ('0x' + settleParams.slice(10)) as `0x${string}`;

    // Encode TAKE_ALL params: (Currency currency, uint256 minAmount)
    const takeParams = encodeFunctionData({
      abi: [{
        name: 'take',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'minAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'take',
      args: [outputToken, minAmountOut],
    });
    const takeParamsData = ('0x' + takeParams.slice(10)) as `0x${string}`;

    console.log('[buildV4SwapCalldataForTokenPair] swapParamsData length:', swapParamsData.length);
    console.log('[buildV4SwapCalldataForTokenPair] settleParamsData:', settleParamsData);
    console.log('[buildV4SwapCalldataForTokenPair] takeParamsData:', takeParamsData);

    // Build the V4 swap input - same pattern as working buildV4SwapCalldata
    const v4Input = encodeFunctionData({
      abi: [{
        name: 'v4Swap',
        type: 'function',
        inputs: [
          { name: 'actions', type: 'bytes' },
          { name: 'params', type: 'bytes[]' },
        ],
        outputs: [],
      }],
      functionName: 'v4Swap',
      args: [
        ('0x' + Buffer.from(actions).toString('hex')) as `0x${string}`,
        [swapParamsData, settleParamsData, takeParamsData],
      ],
    });
    const v4InputData = ('0x' + v4Input.slice(10)) as `0x${string}`;

    console.log('[buildV4SwapCalldataForTokenPair] actions hex:', ('0x' + Buffer.from(actions).toString('hex')));
    console.log('[buildV4SwapCalldataForTokenPair] v4InputData length:', v4InputData.length);

    const commands = ('0x' + V4_SWAP.toString(16).padStart(2, '0')) as `0x${string}`;

    return { commands, inputs: [v4InputData] };
  }, []);

  // Build multi-hop V4 swap calldata for Token → wASS → ETH sells
  // Uses SWAP_EXACT_IN (0x07) with PathKey encoding per Uniswap V4 docs
  // Uses same encodeFunctionData pattern as working buildV4SwapCalldata
  const buildV4MultiHopSwapCalldata = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
    tokenPoolKey: {
      currency0: `0x${string}`;
      currency1: `0x${string}`;
      fee: number;
      tickSpacing: number;
      hooks: `0x${string}`;
    },
    wassEthPoolKey: {
      currency0: `0x${string}`;
      currency1: `0x${string}`;
      fee: number;
      tickSpacing: number;
      hooks: `0x${string}`;
    },
    tokenToWassZeroForOne: boolean,
    inputToken: `0x${string}`
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    // For multi-hop swaps, use SWAP_EXACT_IN (0x07) with PathKey[] encoding
    // Actions: SWAP_EXACT_IN, SETTLE_ALL, TAKE_ALL
    const actions = new Uint8Array([SWAP_EXACT_IN, SETTLE_ALL, TAKE_ALL]);

    // Path for Token → wASS → ETH:
    // PathKey[0]: describes first hop to wASS (intermediateCurrency = wASS)
    // PathKey[1]: describes second hop to ETH (intermediateCurrency = ETH = 0x0)
    //
    // PathKey structure:
    // {
    //   Currency intermediateCurrency; // The output currency of this hop
    //   uint24 fee;
    //   int24 tickSpacing;
    //   IHooks hooks;
    //   bytes hookData;
    // }

    // First PathKey: Token → wASS pool info, output is wASS
    const pathKey1 = {
      intermediateCurrency: WASS_TOKEN_ADDRESS as `0x${string}`,
      fee: tokenPoolKey.fee,
      tickSpacing: tokenPoolKey.tickSpacing,
      hooks: tokenPoolKey.hooks,
      hookData: '0x' as `0x${string}`,
    };

    // Second PathKey: wASS → ETH pool info, output is ETH (0x0)
    const pathKey2 = {
      intermediateCurrency: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      fee: wassEthPoolKey.fee,
      tickSpacing: wassEthPoolKey.tickSpacing,
      hooks: wassEthPoolKey.hooks,
      hookData: '0x' as `0x${string}`,
    };

    console.log('[buildV4MultiHopSwapCalldata] Using encodeFunctionData (matching working pattern)');
    console.log('[buildV4MultiHopSwapCalldata] PathKey1 (Token→wASS):', JSON.stringify(pathKey1, null, 2));
    console.log('[buildV4MultiHopSwapCalldata] PathKey2 (wASS→ETH):', JSON.stringify(pathKey2, null, 2));
    console.log('[buildV4MultiHopSwapCalldata] currencyIn:', inputToken);
    console.log('[buildV4MultiHopSwapCalldata] amountIn:', amountIn.toString());
    console.log('[buildV4MultiHopSwapCalldata] minAmountOut:', minAmountOut.toString());

    // Encode SWAP_EXACT_IN params using encodeFunctionData
    // struct ExactInputParams {
    //     Currency currencyIn;
    //     PathKey[] path;
    //     uint128 amountIn;
    //     uint128 amountOutMinimum;
    // }
    // Note: maxHopSlippage was added in Universal Router v2.1 but Base deployment may not have it
    const swapParams = encodeFunctionData({
      abi: [{
        name: 'swap',
        type: 'function',
        inputs: [{
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'currencyIn', type: 'address' },
            { name: 'path', type: 'tuple[]', components: [
              { name: 'intermediateCurrency', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
              { name: 'hookData', type: 'bytes' },
            ]},
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
          ],
        }],
        outputs: [],
      }],
      functionName: 'swap',
      args: [{
        currencyIn: inputToken,
        path: [pathKey1, pathKey2],
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
      }],
    });
    const swapParamsData = ('0x' + swapParams.slice(10)) as `0x${string}`;

    // Encode SETTLE_ALL params: (Currency currency, uint256 maxAmount)
    const settleParams = encodeFunctionData({
      abi: [{
        name: 'settle',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'maxAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'settle',
      args: [inputToken, amountIn],
    });
    const settleParamsData = ('0x' + settleParams.slice(10)) as `0x${string}`;

    // Encode TAKE_ALL params: (Currency currency, uint256 minAmount)
    // Take ETH (address(0) for native ETH)
    const takeParams = encodeFunctionData({
      abi: [{
        name: 'take',
        type: 'function',
        inputs: [
          { name: 'currency', type: 'address' },
          { name: 'minAmount', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'take',
      args: ['0x0000000000000000000000000000000000000000' as `0x${string}`, minAmountOut],
    });
    const takeParamsData = ('0x' + takeParams.slice(10)) as `0x${string}`;

    console.log('[buildV4MultiHopSwapCalldata] swapParamsData length:', swapParamsData.length);
    console.log('[buildV4MultiHopSwapCalldata] settleParamsData:', settleParamsData);
    console.log('[buildV4MultiHopSwapCalldata] takeParamsData:', takeParamsData);

    // Build the V4 swap input - same pattern as working buildV4SwapCalldata
    const v4Input = encodeFunctionData({
      abi: [{
        name: 'v4Swap',
        type: 'function',
        inputs: [
          { name: 'actions', type: 'bytes' },
          { name: 'params', type: 'bytes[]' },
        ],
        outputs: [],
      }],
      functionName: 'v4Swap',
      args: [
        ('0x' + Buffer.from(actions).toString('hex')) as `0x${string}`,
        [swapParamsData, settleParamsData, takeParamsData],
      ],
    });
    const v4InputData = ('0x' + v4Input.slice(10)) as `0x${string}`;

    console.log('[buildV4MultiHopSwapCalldata] actions hex:', ('0x' + Buffer.from(actions).toString('hex')));
    console.log('[buildV4MultiHopSwapCalldata] v4InputData length:', v4InputData.length);

    const commands = ('0x' + V4_SWAP.toString(16).padStart(2, '0')) as `0x${string}`;

    return { commands, inputs: [v4InputData] };
  }, []);

  // Handle Sell (V4 swap for wASS, multi-hop V4 for token pairs)
  const handleSell = async () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) {
      setSwapError('Invalid input');
      return;
    }

    try {
      setPendingTxType('swap');
      const sellAmount = parseUnits(inputAmount, 18);
      // TEMPORARY: Use 0 minOut to test if swap works at all (bypasses slippage check)
      // Normal: outputAmount ? parseEther((parseFloat(outputAmount) * 0.95).toString()) : 0n
      const minEthOut = 0n; // TODO: Restore slippage protection after debugging
      console.log('⚠️ TESTING MODE: minEthOut = 0 (no slippage protection)');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

      // Hydrex pair: Use KyberSwap aggregator for sells
      if (isHydrexPair && outputTokenAddress && hydrexRouteInfo) {
        // Reset any stale errors from previous operations
        resetWrite();
        resetSendTx();
        setSwapError(null);

        console.log('=== HYDREX SELL: Token → ETH via KyberSwap ===');
        console.log('Sell amount:', formatUnits(sellAmount, 18), 'TOKEN');
        console.log('Token address:', outputTokenAddress);
        console.log('Route summary:', hydrexRouteInfo.routeSummary);
        console.log('Router address:', hydrexRouteInfo.routerAddress);

        // Build swap transaction using KyberSwap API
        const buildResponse = await buildKyberSwapTransaction(
          hydrexRouteInfo.routeSummary,
          address,
          address,
          50, // 0.5% slippage
          Math.floor(Date.now() / 1000) + 1200 // 20 min deadline
        );

        if (buildResponse.code !== 0 || !buildResponse.data) {
          console.error('[Hydrex] Failed to build swap tx:', buildResponse.message);
          setSwapError(`Hydrex: ${buildResponse.message || 'Failed to build transaction'}`);
          setPendingTxType(null);
          return;
        }

        const { data: encodedData, routerAddress } = buildResponse.data;
        console.log('[Hydrex] Swap tx built:', { routerAddress, dataLength: encodedData.length });
        console.log('[Hydrex] encodedData starts with:', encodedData.slice(0, 20));
        console.log('[Hydrex] encodedData type:', typeof encodedData);

        // Execute the swap with raw calldata using walletClient directly
        // We use walletClient.sendTransaction() to bypass wagmi hooks that try to encode ABI functions
        if (!walletClient) {
          console.error('[Hydrex] No wallet client available');
          setSwapError('Wallet not connected');
          setPendingTxType(null);
          return;
        }

        try {
          console.log('[Hydrex] Sending sell transaction via walletClient.sendTransaction...');
          const hash = await walletClient.sendTransaction({
            to: routerAddress as `0x${string}`,
            data: encodedData as `0x${string}`,
            account: walletClient.account,
            chain: walletClient.chain,
          });
          console.log('[Hydrex] Sell tx hash:', hash);
          addTransaction(hash, `Selling ${outputTokenSymbol || 'Token'} for ETH via Hydrex`);
          // Transaction submitted successfully - state will be updated by useWaitForTransactionReceipt
          // Reset pending type since we're using walletClient directly (no wagmi hooks tracking this)
          setPendingTxType(null);
          // Trigger refetch after a delay to update balances
          setTimeout(() => {
            refetchTokenBalance();
            refetchOutputTokenBalance();
          }, 3000);
        } catch (err) {
          console.error('[Hydrex] Sell tx error:', err);
          const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
          // Check for user rejection
          if (errorMessage.toLowerCase().includes('reject') || errorMessage.toLowerCase().includes('denied')) {
            setSwapError('Transaction cancelled');
          } else {
            setSwapError(`Hydrex: ${errorMessage}`);
          }
          setPendingTxType(null);
        }
        return;
      }

      // Aerodrome pair: Use Slipstream SwapRouter for CL pools, V2 Router for V2 pools
      if (isAerodromePair && outputTokenAddress) {
        // Check if this is a CL pool (has tickSpacing) or V2 pool
        const isCLPool = aerodromePoolInfo?.tickSpacing !== undefined && aerodromePoolInfo.tickSpacing > 0;
        const poolStable = aerodromePoolInfo?.stable ?? false;

        // Determine base token (wASS for wASS-paired, WETH for ETH-paired)
        const baseToken = aerodromeBaseToken;
        const isWassBase = isWassPairedAerodrome;
        const baseTokenLabel = isWassBase ? 'wASS' : 'ETH';

        console.log(`=== AERODROME SELL: Token → ${baseTokenLabel} ===`);
        console.log('Pool type:', isCLPool ? `CL (tickSpacing=${aerodromePoolInfo?.tickSpacing})` : (poolStable ? 'V2 stable' : 'V2 volatile'));
        console.log('Pool address:', aerodromePoolInfo?.poolAddress || 'unknown');
        console.log('Sell amount:', formatUnits(sellAmount, 18), 'TOKEN');
        console.log('Token address:', outputTokenAddress);
        console.log(`Min ${baseTokenLabel} out:`, formatEther(minEthOut));
        console.log('Is wASS-paired:', isWassBase);

        if (isCLPool) {
          // CL Pool: Use Slipstream SwapRouter.exactInputSingle
          console.log('Using Slipstream SwapRouter:', SLIPSTREAM_SWAP_ROUTER_ADDRESS);

          const swapParams = {
            tokenIn: outputTokenAddress, // The token being sold
            tokenOut: baseToken, // WETH or wASS depending on pair
            tickSpacing: aerodromePoolInfo!.tickSpacing!,
            recipient: address, // User receives WETH or wASS
            deadline: deadline,
            amountIn: sellAmount,
            amountOutMinimum: minEthOut,
            sqrtPriceLimitX96: 0n, // No price limit
          };

          console.log('Swap params:', swapParams);

          writeContract({
            address: SLIPSTREAM_SWAP_ROUTER_ADDRESS,
            abi: SLIPSTREAM_SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [swapParams],
          });
        } else {
          // V2 Pool
          console.log('Using V2 Router:', AERODROME_ROUTER_ADDRESS);

          const routes: AerodromeRoute[] = [{
            from: outputTokenAddress, // The token being sold
            to: baseToken, // WETH or wASS depending on pair
            stable: poolStable, // Use detected pool type (volatile/stable)
            factory: AERODROME_FACTORY_ADDRESS,
          }];

          console.log('Route:', routes);

          if (isWassBase) {
            // wASS-paired: Use swapExactTokensForTokens (token-to-token)
            writeContract({
              address: AERODROME_ROUTER_ADDRESS,
              abi: AERODROME_ROUTER_ABI,
              functionName: 'swapExactTokensForTokens',
              args: [sellAmount, minEthOut, routes as readonly { from: `0x${string}`; to: `0x${string}`; stable: boolean; factory: `0x${string}`; }[], address, deadline],
            });
          } else {
            // ETH-paired: Use swapExactTokensForETH
            writeContract({
              address: AERODROME_ROUTER_ADDRESS,
              abi: AERODROME_ROUTER_ABI,
              functionName: 'swapExactTokensForETH',
              args: [sellAmount, minEthOut, routes as readonly { from: `0x${string}`; to: `0x${string}`; stable: boolean; factory: `0x${string}`; }[], address, deadline],
            });
          }
        }

        if (txHash) {
          addTransaction(txHash, `Selling ${outputTokenSymbol || 'Token'} for ${baseTokenLabel}`);
        }
        return;
      }

      if (isTokenWarsEthPair && outputTokenAddress) {
        // Token Wars ETH pair: DIRECT Token → ETH V4 swap (single hop)
        // V4 pools require SORTED tokens!
        const [sortedCurrency0, sortedCurrency1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
          ? [selectedPair.token0, selectedPair.token1]
          : [selectedPair.token1, selectedPair.token0];

        const ethPoolKey = {
          currency0: sortedCurrency0,
          currency1: sortedCurrency1,
          fee: selectedPair.fee,
          tickSpacing: selectedPair.tickSpacing,
          hooks: selectedPair.hook,
        };

        // Determine direction: Token → ETH (using sorted pool key)
        // If ETH is token0: selling token1 for token0, zeroForOne = false
        // If ETH is token1: selling token0 for token1, zeroForOne = true
        const ethIsToken0 = sortedCurrency0 === ETH_ADDRESS;
        const zeroForOne = !ethIsToken0; // Token → ETH

        console.log('=== TOKEN WARS ETH PAIR SELL (Direct V4) ===');
        console.log('Pool key (sorted):', JSON.stringify(ethPoolKey, null, 2));
        console.log('ETH is token0:', ethIsToken0);
        console.log('zeroForOne:', zeroForOne);
        console.log('Sell amount:', formatUnits(sellAmount, 18), 'TOKEN');
        console.log('Min ETH out:', formatEther(minEthOut));

        // Build V4 swap calldata for Token → ETH (opposite direction of buy)
        const { commands, inputs } = buildV4SwapCalldataForTokenSell(
          sellAmount,
          minEthOut,
          ethPoolKey,
          zeroForOne,
          outputTokenAddress
        );

        writeContract({
          address: UNIVERSAL_ROUTER_ADDRESS,
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });

        if (txHash) {
          addTransaction(txHash, `Selling ${outputTokenSymbol || 'Token'} for ETH`);
        }
      } else if (isTokenPair && outputTokenAddress) {
        // wASS/TOKEN pair sell: either single-hop to wASS or multi-hop to ETH
        // Sort tokens for V4 pool key (currency0 must be lower address)
        const [sortedC0, sortedC1] = selectedPair.token0.toLowerCase() < selectedPair.token1.toLowerCase()
          ? [selectedPair.token0, selectedPair.token1]
          : [selectedPair.token1, selectedPair.token0];
        const tokenPoolKey = {
          currency0: sortedC0,
          currency1: sortedC1,
          fee: selectedPair.fee,
          tickSpacing: selectedPair.tickSpacing,
          hooks: selectedPair.hook,
        };

        // Determine zeroForOne direction
        const wassIsToken0 = sortedC0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();
        const zeroForOne = !wassIsToken0; // TOKEN -> wASS direction

        if (sellOutputCurrency === 'eth') {
          // Multi-hop sell: Token → wASS → ETH
          console.log('=== MULTI-HOP TOKEN PAIR SELL: Token → wASS → ETH ===');
          console.log('Action: SWAP_EXACT_IN (0x07), SETTLE_ALL (0x0c), TAKE_ALL (0x0f)');
          console.log('Token pool key:', JSON.stringify(tokenPoolKey, null, 2));
          console.log('wASS is token0 in Token pool:', wassIsToken0);
          console.log('Input token (being sold):', outputTokenAddress);
          console.log('Intermediate: wASS at', WASS_TOKEN_ADDRESS);
          console.log('Output: ETH (native)');
          console.log('Sell amount:', formatUnits(sellAmount, 18), 'TOKEN');
          console.log('Min ETH out:', formatEther(minEthOut), 'ETH');

          // Get wASS/ETH pool key
          if (!poolKey) {
            setSwapError('wASS/ETH pool not loaded');
            return;
          }

          console.log('wASS/ETH pool key:', JSON.stringify(poolKey, null, 2));
          console.log('Universal Router:', UNIVERSAL_ROUTER_ADDRESS);

          // Build multi-hop V4 swap calldata
          const { commands, inputs } = buildV4MultiHopSwapCalldata(
            sellAmount,
            minEthOut,
            tokenPoolKey,
            poolKey, // wASS/ETH pool key
            zeroForOne,
            outputTokenAddress // input token (the token being sold)
          );

          console.log('Multi-hop Commands (should be 0x10):', commands);
          console.log('Multi-hop Inputs array length:', inputs.length);
          console.log('V4 Input data (first 200 chars):', inputs[0]?.substring(0, 200) + '...');

          // Simulate the transaction first to get detailed error messages
          if (publicClient) {
            console.log('=== SIMULATING MULTI-HOP TRANSACTION ===');
            try {
              const simulation = await publicClient.simulateContract({
                address: UNIVERSAL_ROUTER_ADDRESS,
                abi: UNIVERSAL_ROUTER_ABI,
                functionName: 'execute',
                args: [commands, inputs, deadline],
                account: address,
              });
              console.log('Multi-hop simulation successful:', simulation);
            } catch (simError: unknown) {
              console.error('=== MULTI-HOP SIMULATION FAILED ===');
              console.error('Simulation error:', simError);

              // Try to decode V4TooLittleReceived error to get actual values
              const V4_ERROR_ABI = [{
                type: 'error',
                name: 'V4TooLittleReceived',
                inputs: [
                  { name: 'minAmountOutReceived', type: 'uint256' },
                  { name: 'amountReceived', type: 'uint256' }
                ]
              }] as const;

              // Extract error data from the error object
              const errorObj = simError as { cause?: { data?: `0x${string}` }; data?: `0x${string}` };
              const errorData = errorObj?.cause?.data || errorObj?.data;

              if (errorData && errorData.startsWith('0x8b063d73')) {
                try {
                  const decoded = decodeErrorResult({
                    abi: V4_ERROR_ABI,
                    data: errorData
                  });
                  console.error('=== V4TooLittleReceived DECODED ===');
                  console.error('minAmountOutReceived:', decoded.args[0]?.toString());
                  console.error('amountReceived:', decoded.args[1]?.toString());
                  setSwapError(`Multi-hop swap failed: Expected min ${formatUnits(decoded.args[0] || 0n, 18)} but got ${formatUnits(decoded.args[1] || 0n, 18)} ETH`);
                  return;
                } catch (decodeErr) {
                  console.error('Failed to decode error:', decodeErr);
                  console.error('Raw error data:', errorData);
                }
              }

              if (simError instanceof Error) {
                console.error('Error message:', simError.message);
                const errorMessage = simError.message;

                // Also try to extract error data from message
                const dataMatch = errorMessage.match(/data: "(0x[a-fA-F0-9]+)"/);
                if (dataMatch && dataMatch[1]?.startsWith('0x8b063d73')) {
                  try {
                    const decoded = decodeErrorResult({
                      abi: V4_ERROR_ABI,
                      data: dataMatch[1] as `0x${string}`
                    });
                    console.error('=== V4TooLittleReceived DECODED (from message) ===');
                    console.error('minAmountOutReceived:', decoded.args[0]?.toString());
                    console.error('amountReceived:', decoded.args[1]?.toString());
                    setSwapError(`Multi-hop swap failed: Expected min ${formatUnits(decoded.args[0] || 0n, 18)} but got ${formatUnits(decoded.args[1] || 0n, 18)} ETH`);
                    return;
                  } catch (decodeErr) {
                    console.error('Failed to decode from message:', decodeErr);
                  }
                }

                if (errorMessage.includes('execution reverted')) {
                  const revertMatch = errorMessage.match(/reason: (.+?)(?:\n|$)/);
                  if (revertMatch) {
                    setSwapError(`Multi-hop swap simulation failed: ${revertMatch[1]}`);
                  } else {
                    setSwapError('Multi-hop swap simulation failed: execution reverted');
                  }
                } else {
                  setSwapError(`Multi-hop swap simulation failed: ${simError.message.substring(0, 100)}`);
                }
              }
              return;
            }
          }

          writeContract({
            address: UNIVERSAL_ROUTER_ADDRESS,
            abi: UNIVERSAL_ROUTER_ABI,
            functionName: 'execute',
            args: [commands, inputs, deadline],
          });
        } else {
          // Single-hop sell: Token -> wASS
          // TEMPORARY: Use 0 minOut to test if swap works at all (bypasses slippage check)
          // Normal: outputAmount ? parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18) : 0n
          const minWassOut = 0n; // TODO: Restore slippage protection after debugging
          console.log('⚠️ TESTING MODE: minWassOut = 0 (no slippage protection)');

          console.log('=== TOKEN PAIR SELL: Token → wASS ===');
          console.log('Pool key:', tokenPoolKey);
          console.log('wASS is token0:', wassIsToken0);
          console.log('zeroForOne (TOKEN→wASS):', zeroForOne);
          console.log('Sell amount:', formatUnits(sellAmount, 18), 'TOKEN');
          console.log('Min wASS out:', formatUnits(minWassOut, 18), 'wASS');
          console.log('Input token:', outputTokenAddress);
          console.log('Output token:', WASS_TOKEN_ADDRESS);

          // Build single-hop V4 swap calldata
          const { commands, inputs } = buildV4SwapCalldataForTokenPair(
            sellAmount,
            minWassOut,
            tokenPoolKey,
            zeroForOne,
            outputTokenAddress, // input token (the token being sold)
            WASS_TOKEN_ADDRESS as `0x${string}` // output token (wASS)
          );

          console.log('Commands:', commands);
          console.log('Inputs:', inputs);

          writeContract({
            address: UNIVERSAL_ROUTER_ADDRESS,
            abi: UNIVERSAL_ROUTER_ABI,
            functionName: 'execute',
            args: [commands, inputs, deadline],
          });

          if (txHash) {
            addTransaction(txHash, `Selling ${outputTokenSymbol || 'Token'} for wASS`);
          }
        }
      } else {
        // Single-hop sell: wASS -> ETH using default pool from NFT contract
        if (!publicClient) {
          setSwapError('Client not ready');
          return;
        }

        const [singleSellHookAddress, singleSellPoolId] = await Promise.all([
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'hook',
            args: [],
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: contracts.nft.address as `0x${string}`,
            abi: contracts.nft.abi,
            functionName: 'poolIdRaw',
            args: [],
          }) as Promise<`0x${string}`>,
        ]);

        console.log('[ChartModal] Fetching default pool for sell:', singleSellPoolId);

        const sellPoolKeyData = await publicClient.readContract({
          address: singleSellHookAddress,
          abi: [{
            inputs: [{ internalType: 'bytes32', name: 'id', type: 'bytes32' }],
            name: 'getPoolKey',
            outputs: [{
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
            }],
            stateMutability: 'view',
            type: 'function',
          }],
          functionName: 'getPoolKey',
          args: [singleSellPoolId],
        }) as unknown as {
          currency0: `0x${string}`;
          currency1: `0x${string}`;
          fee: number;
          tickSpacing: number;
          hooks: `0x${string}`;
        };

        console.log('[ChartModal] Default sell pool loaded:', sellPoolKeyData);
        const { commands, inputs } = buildV4SwapCalldata(sellAmount, minEthOut, sellPoolKeyData);

        writeContract({
          address: UNIVERSAL_ROUTER_ADDRESS,
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });

        if (txHash) {
          addTransaction(txHash, 'Selling wASS');
        }
      }
    } catch (err) {
      console.error('Sell error:', err);
      if (err instanceof Error) {
        console.error('Error details:', err.message);
        console.error('Error stack:', err.stack);
        setSwapError(`Failed to execute swap: ${err.message.substring(0, 150)}`);
      } else {
        setSwapError('Failed to execute swap - unknown error');
      }
    }
  };

  // Handle percentage-based input (replaces MAX button)
  const handlePercentageInput = (percent: number) => {
    if (swapTab === 'buy') {
      if (buyInputCurrency === 'eth') {
        // Leave some ETH for gas when using max percentage
        const gasReserve = percent === 80 ? 0.001 : 0;
        const maxEth = Math.max(0, parseFloat(ethBalance) - gasReserve);
        const amount = (maxEth * percent / 100).toFixed(6);
        setInputAmount(amount);
      } else {
        // Using wASS as input (only for token pairs)
        const maxWass = parseFloat(tokenBalance);
        const amount = (maxWass * percent / 100).toFixed(2);
        setInputAmount(amount);
      }
    } else {
      // Sell mode
      const maxSell = parseFloat(sellBalance);
      const amount = (maxSell * percent / 100).toFixed(sellBalance.includes('.') ? Math.min(6, sellBalance.split('.')[1]?.length || 2) : 2);
      setInputAmount(amount);
    }
  };

  // Get the current buy balance based on input currency
  const buyBalance = buyInputCurrency === 'eth' ? ethBalance : tokenBalance;

  // In embedded mode, always render (not controlled by isOpen)
  if (!isOpen && !embedded) return null;

  const timeFrameButtons: { value: TimeFrame; label: string }[] = [
    { value: '5m', label: '5M' },
    { value: '15m', label: '15M' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
  ];

  // Percentage buttons for quick input
  const percentageButtons = [
    { value: 10, label: '10%' },
    { value: 30, label: '30%' },
    { value: 55, label: '55%' },
    { value: 80, label: '80%' },
  ];

  const isBusy = isPending || isConfirming || isBatchPending;
  // canBuy now checks the correct balance based on input currency
  const canBuy = address && inputAmount && parseFloat(inputAmount) > 0 && parseFloat(inputAmount) <= parseFloat(buyBalance);
  const canSell = address && inputAmount && parseFloat(inputAmount) > 0 && parseFloat(inputAmount) <= parseFloat(sellBalance);

  // Determine if using horizontal layout (swap left, chart right)
  const isHorizontal = layout === 'horizontal' && embedded;

  // Content wrapper - different styles for embedded vs modal
  const contentDiv = (
    <div
      className={embedded ? "h-full w-full flex" : "pointer-events-auto w-full flex flex-col"}
      style={{
        ...(embedded ? {} : { maxWidth: '500px', maxHeight: '90vh' }),
        background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.03), rgba(10, 13, 12, 0.98), rgba(255, 208, 117, 0.03))',
        backgroundColor: '#0a0d0c',
        ...(embedded ? {} : {
          border: '1px solid rgba(255, 208, 117, 0.25)',
          borderRadius: '12px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 40px rgba(255, 208, 117, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        }),
        overflow: 'hidden',
        flexDirection: isHorizontal ? 'row' : 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Horizontal Layout: Swap Panel (LEFT) - responsive: scales down on mobile */}
      {isHorizontal && (
        <div
          className="flex-shrink flex flex-col border-r border-glass-border overflow-y-auto overflow-x-hidden w-[140px] xs:w-[160px] sm:w-[200px] md:w-[260px] lg:w-[300px] xl:w-[340px]"
        >
          {/* Swap Header */}
          <div
            className="flex justify-between items-center p-1.5 sm:p-2 md:p-3 border-b border-[rgba(255,208,117,0.15)]"
          >
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Token Pair Dropdown */}
              <div ref={pairDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setIsPairDropdownOpen(!isPairDropdownOpen)}
                  className="flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 md:px-3 md:py-1.5 rounded text-[10px] sm:text-xs md:text-sm"
                  style={{
                    background: isPairDropdownOpen ? 'rgba(255, 208, 117, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 208, 117, 0.3)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span className="font-bold text-[#f0ece4]">{getPairDisplayName(selectedPair)}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(255, 208, 117, 0.8)"
                    strokeWidth="2"
                    style={{
                      transform: isPairDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isPairDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 4,
                      minWidth: 160,
                      background: 'rgba(10, 13, 12, 0.98)',
                      border: '1px solid rgba(255, 208, 117, 0.3)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 208, 117, 0.1)',
                      zIndex: 100,
                      overflow: 'hidden',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    {[...allPairs]
                      .sort((a, b) => {
                        if (a.isDefault && !b.isDefault) return -1;
                        if (!a.isDefault && b.isDefault) return 1;
                        const aChange = allPairChanges.get(a.id) || 0;
                        const bChange = allPairChanges.get(b.id) || 0;
                        return bChange - aChange;
                      })
                      .map((pair) => {
                        const pairChange = allPairChanges.get(pair.id);
                        return (
                          <button
                            key={pair.id}
                            onClick={() => handlePairSelect(pair)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 12px',
                              background: selectedPair.id === pair.id ? 'rgba(255, 208, 117, 0.15)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              transition: 'background 0.15s ease',
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: selectedPair.id === pair.id ? '#ffd075' : '#f0ece4' }}>
                              {getPairDisplayName(pair)}
                            </span>
                            {pairChange !== undefined && (
                              <span style={{ fontSize: 11, fontWeight: 500, color: pairChange >= 0 ? '#22c55e' : '#FF3B5C' }}>
                                {pairChange >= 0 ? '+' : ''}{pairChange.toFixed(2)}%
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#ffd075' }}>
              {isTradeableInApp ? 'Swap' : `Trade on ${selectedPairDex === 'aerodrome' ? 'Aerodrome' : selectedPairDex === 'hydrex' ? 'Hydrex' : 'DEX'}`}
            </span>
          </div>

          {/* Swap Section - in horizontal left panel */}
          <div className="p-1.5 sm:p-2 md:p-3 lg:p-4 flex-1 overflow-hidden">
            {/* External DEX Link - shown for non-V4 tokens (Aerodrome, Hydrex) */}
            {!isTradeableInApp && externalDexUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20 }}>
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: selectedPairDex === 'aerodrome' ? 'rgba(197, 169, 123, 0.15)' : 'rgba(255, 107, 0, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={selectedPairDex === 'aerodrome' ? '#c5a97b' : '#FF6B00'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#f0ece4', marginBottom: 8 }}>
                    This token trades on {selectedPairDex === 'aerodrome' ? 'Aerodrome' : selectedPairDex === 'hydrex' ? 'Hydrex' : 'an external DEX'}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(240, 236, 228, 0.5)', marginBottom: 16 }}>
                    Click below to swap on the native DEX
                  </div>
                </div>
                <a
                  href={externalDexUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '14px 32px',
                    background: selectedPairDex === 'aerodrome'
                      ? 'linear-gradient(135deg, rgba(197, 169, 123, 0.9), rgba(160, 130, 80, 0.9))'
                      : 'linear-gradient(135deg, rgba(255, 107, 0, 0.9), rgba(200, 80, 0, 0.9))',
                    borderRadius: 12,
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 15,
                    color: '#f0ece4',
                    boxShadow: selectedPairDex === 'aerodrome'
                      ? '0 4px 16px rgba(197, 169, 123, 0.3)'
                      : '0 4px 16px rgba(255, 107, 0, 0.3)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = selectedPairDex === 'aerodrome'
                      ? '0 6px 20px rgba(197, 169, 123, 0.4)'
                      : '0 6px 20px rgba(255, 107, 0, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = selectedPairDex === 'aerodrome'
                      ? '0 4px 16px rgba(197, 169, 123, 0.3)'
                      : '0 4px 16px rgba(255, 107, 0, 0.3)';
                  }}
                >
                  Trade on {selectedPairDex === 'aerodrome' ? 'Aerodrome' : selectedPairDex === 'hydrex' ? 'Hydrex' : 'DEX'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
                {/* Also show DexScreener link if available */}
                {(() => {
                  const pair = allPairs.find(p => p.id === selectedPair.id);
                  const dexScreenerUrl = pair?.tokenWarsData?.dexScreenerUrl;
                  if (dexScreenerUrl) {
                    return (
                      <a
                        href={dexScreenerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: 'rgba(240, 236, 228, 0.5)',
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        View on DexScreener
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      </a>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Regular Swap UI - shown for V4 tokens */}
            {isTradeableInApp && (
              <>
            {/* Buy/Sell Tabs */}
            <div className="flex gap-1 mb-2 sm:mb-3 md:mb-4">
              <button
                onClick={() => { setSwapTab('buy'); setInputAmount(''); setOutputAmount(''); }}
                className="flex-1 py-1.5 sm:py-2 md:py-2.5 text-[10px] sm:text-xs md:text-sm font-semibold rounded-lg cursor-pointer"
                style={{
                  border: swapTab === 'buy' ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                  background: swapTab === 'buy' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  boxShadow: swapTab === 'buy' ? '0 0 15px rgba(34, 197, 94, 0.2)' : 'none',
                  color: swapTab === 'buy' ? '#22c55e' : 'rgba(240, 236, 228, 0.5)',
                }}
              >
                Buy
              </button>
              <button
                onClick={() => { setSwapTab('sell'); setInputAmount(''); setOutputAmount(''); }}
                className="flex-1 py-1.5 sm:py-2 md:py-2.5 text-[10px] sm:text-xs md:text-sm font-semibold rounded-lg cursor-pointer"
                style={{
                  border: swapTab === 'sell' ? '1px solid rgba(255, 59, 92, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                  background: swapTab === 'sell' ? 'rgba(255, 59, 92, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  boxShadow: swapTab === 'sell' ? '0 0 15px rgba(255, 59, 92, 0.2)' : 'none',
                  color: swapTab === 'sell' ? '#FF3B5C' : 'rgba(240, 236, 228, 0.5)',
                }}
              >
                Sell
              </button>
            </div>

            {/* Input */}
            <div className="mb-1.5 sm:mb-2 md:mb-2.5">
              <div className="flex justify-between items-center mb-1 text-[8px] sm:text-[10px] md:text-xs text-[rgba(232,244,255,0.5)]">
                <span>You Pay</span>
                <span className="flex items-center gap-1">
                  <span className="hidden sm:inline">Bal:</span> {swapTab === 'buy'
                    ? (buyInputCurrency === 'eth' ? parseFloat(ethBalance).toFixed(4) : parseFloat(tokenBalance).toFixed(2))
                    : parseFloat(sellBalance).toFixed(2)}
                  <img
                    src={swapTab === 'buy'
                      ? (buyInputCurrency === 'eth' ? '/Images/Ether.png' : '/Images/Token.png')
                      : (isTokenPair && outputTokenAddress ? (getTokenImage(outputTokenAddress) || '/Images/Token.png') : '/Images/Token.png')}
                    className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-3.5 md:h-3.5"
                  />
                </span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 md:p-3 rounded-lg"
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <input
                  type="number"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-[#f0ece4] text-sm sm:text-base md:text-lg font-medium"
                />
                {/* Currency toggle for buy mode on token pairs (hide for wASS-paired Aerodrome - wASS only) */}
                {swapTab === 'buy' && isTokenPair && !isWassPairedAerodrome && (
                  <button
                    onClick={() => {
                      setBuyInputCurrency(buyInputCurrency === 'eth' ? 'wass' : 'eth');
                      setInputAmount('');
                      setOutputAmount('');
                    }}
                    className="px-1 py-0.5 text-[8px] sm:text-[10px] font-semibold bg-[rgba(255,208,117,0.2)] border-none rounded text-[#ffd075] cursor-pointer flex items-center flex-shrink-0"
                    title="Switch input currency"
                  >
                    <span>⇄</span>
                  </button>
                )}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <img
                    src={swapTab === 'buy'
                      ? (buyInputCurrency === 'eth' ? '/Images/Ether.png' : '/Images/Token.png')
                      : (isTokenPair && outputTokenAddress ? (getTokenImage(outputTokenAddress) || '/Images/Token.png') : '/Images/Token.png')}
                    alt={swapTab === 'buy' ? (buyInputCurrency === 'eth' ? 'ETH' : 'wASS') : 'Token'}
                    className="w-3 h-3 sm:w-4 sm:h-4"
                  />
                  <span className="text-[10px] sm:text-xs md:text-sm font-semibold text-white/70 whitespace-nowrap">
                    {swapTab === 'buy'
                      ? (buyInputCurrency === 'eth' ? 'ETH' : 'wASS')
                      : (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS')}
                  </span>
                </div>
              </div>
              {/* Percentage buttons */}
              <div className="flex gap-0.5 sm:gap-1 mt-1 sm:mt-1.5 md:mt-2">
                {percentageButtons.map((btn) => (
                  <button
                    key={btn.value}
                    onClick={() => handlePercentageInput(btn.value)}
                    className="flex-1 py-1 sm:py-1.5 text-[8px] sm:text-[10px] md:text-xs font-semibold rounded cursor-pointer"
                    style={{
                      background: 'rgba(255, 208, 117, 0.15)',
                      border: '1px solid rgba(255, 208, 117, 0.3)',
                      color: '#ffd075',
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center my-1 sm:my-1.5">
              <div className="p-1 sm:p-1.5 bg-white/5 rounded-full">
                <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Output */}
            <div className="mb-2 sm:mb-3 md:mb-4">
              <div className="flex justify-between mb-1 text-[8px] sm:text-[10px] md:text-xs text-[rgba(232,244,255,0.5)]">
                <span>You Receive</span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 md:p-3 rounded-lg"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <span className="flex-1 text-sm sm:text-base md:text-lg font-medium"
                  style={{ color: isQuoting ? 'rgba(255, 255, 255, 0.4)' : '#fff' }}
                >
                  {isQuoting ? '...' : outputAmount || '0.0'}
                </span>
                {/* Sell output currency toggle for wASS/TOKEN pairs only (not Token Wars ETH pairs) */}
                {/* Token Wars ETH pairs can ONLY sell to ETH since there's no wASS in the pool */}
                {swapTab === 'sell' && isTokenPair && !isTokenWarsEthPair && (
                  <button
                    onClick={() => {
                      setSellOutputCurrency(sellOutputCurrency === 'wass' ? 'eth' : 'wass');
                      setOutputAmount('');
                    }}
                    className="px-1 py-0.5 text-[8px] sm:text-[10px] font-semibold bg-[rgba(255,208,117,0.2)] border-none rounded text-[#ffd075] cursor-pointer flex items-center gap-1"
                    title="Switch output currency"
                  >
                    <span>⇄</span>
                  </button>
                )}
                <div className="flex items-center gap-1">
                  <img
                    src={swapTab === 'buy'
                      ? (isTokenPair && outputTokenAddress
                        ? (getTokenImage(outputTokenAddress) || '/Images/Token.png')
                        : '/Images/Token.png')
                      : (isTokenWarsEthPair
                        ? '/Images/Ether.png' // Token Wars ETH pairs always sell to ETH
                        : (isTokenPair
                          ? (sellOutputCurrency === 'eth' ? '/Images/Ether.png' : '/Images/Token.png')
                          : '/Images/Ether.png'))}
                    alt={swapTab === 'buy' ? (outputTokenSymbol || 'Token') : (isTokenWarsEthPair ? 'ETH' : (sellOutputCurrency === 'eth' ? 'ETH' : 'wASS'))}
                    className="w-3 h-3 sm:w-4 sm:h-4"
                  />
                  <span className="text-[10px] sm:text-xs md:text-sm font-semibold text-white/70">
                    {swapTab === 'buy'
                      ? (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS')
                      : (isTokenWarsEthPair ? 'ETH' : (isTokenPair ? (sellOutputCurrency === 'eth' ? 'ETH' : 'wASS') : 'ETH'))}
                  </span>
                </div>
              </div>
            </div>

            {/* Error */}
            {(swapError || writeError) && (
              <div className="mb-2 p-1.5 sm:p-2 rounded-lg text-[8px] sm:text-[10px] md:text-xs text-center"
                style={{
                  background: 'rgba(255, 59, 92, 0.1)',
                  border: '1px solid rgba(255, 59, 92, 0.3)',
                  color: '#FF3B5C',
                }}
              >
                {swapError || (writeError?.message?.includes('User rejected') ? 'Cancelled' : 'Failed')}
              </div>
            )}

            {/* Action Button */}
            {swapTab === 'buy' ? (
              !address ? (
                <div className="py-2 sm:py-2.5 md:py-3 rounded-lg text-[10px] sm:text-xs md:text-sm text-center"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'rgba(240, 236, 228, 0.5)',
                  }}
                >
                  Connect wallet
                </div>
              ) : isWassPairedAerodrome && wassAerodromeApprovalNeeded ? (
                // wASS-paired Aerodrome: Need direct wASS approval to router
                <button
                  onClick={handleApproveWassAerodrome}
                  disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                  className="w-full py-2 sm:py-2.5 md:py-3 border-none rounded-lg text-[10px] sm:text-xs md:text-sm font-semibold text-[#f0ece4]"
                  style={{
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isBusy ? 'Approving...' : 'Approve wASS'}
                </button>
              ) : isWassPairedAerodrome ? (
                // wASS-paired Aerodrome: Approved, show buy button
                <button
                  onClick={handleBuy}
                  disabled={isBusy || isQuoting || !canBuy}
                  className="w-full py-2 sm:py-2.5 md:py-3 border-none rounded-lg text-[10px] sm:text-xs md:text-sm font-semibold text-[#f0ece4]"
                  style={{
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                    cursor: isBusy || isQuoting || !canBuy ? 'not-allowed' : 'pointer',
                    opacity: !canBuy ? 0.5 : 1,
                  }}
                >
                  {isBusy ? 'Buying...' : isQuoting ? 'Quote...' : 'Buy'}
                </button>
              ) : buyInputCurrency === 'wass' && isTokenPair ? (
                // Token Wars V4: Buying with wASS - show Permit2 approval flow
                isCheckingBuyWassApproval ? (
                  <button
                    disabled
                    style={{
                      width: '100%',
                      padding: 14,
                      background: 'rgba(107, 114, 128, 0.5)',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: 'not-allowed',
                    }}
                  >
                    Checking approvals...
                  </button>
                ) : buyWassApprovalStep === 'permit2' ? (
                  <button
                    onClick={handleApproveWassPermit2}
                    disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                    style={{
                      width: '100%',
                      padding: 14,
                      background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isBusy ? 'Approving...' : 'Step 1: Approve wASS'}
                  </button>
                ) : buyWassApprovalStep === 'router' ? (
                  <button
                    onClick={handleApproveWassRouter}
                    disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                    style={{
                      width: '100%',
                      padding: 14,
                      background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isBusy ? 'Approving...' : 'Step 2: Approve Router'}
                  </button>
                ) : (
                  <button
                    onClick={handleBuy}
                    disabled={isBusy || isQuoting || !canBuy || buyWassApprovalStep !== 'ready'}
                    style={{
                      width: '100%',
                      padding: 14,
                      background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: isBusy || isQuoting || !canBuy ? 'not-allowed' : 'pointer',
                      opacity: !canBuy ? 0.5 : 1,
                    }}
                  >
                    {isBusy ? 'Buying...' : isQuoting ? 'Getting quote...' : `Buy ${outputTokenSymbol || 'Token'} with wASS`}
                  </button>
                )
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={isBusy || isQuoting || !canBuy}
                  style={{
                    width: '100%',
                    padding: 14,
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 15,
                    fontWeight: 600,
                    color: '#f0ece4',
                    cursor: isBusy || isQuoting || !canBuy ? 'not-allowed' : 'pointer',
                    opacity: !canBuy ? 0.5 : 1,
                  }}
                >
                  {isBusy ? 'Buying...' : isQuoting ? 'Getting quote...' : `Buy ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`}
                </button>
              )
            ) : !address ? (
              <div style={{
                padding: 14,
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 10,
                fontSize: 14,
                color: 'rgba(240, 236, 228, 0.5)',
                textAlign: 'center',
              }}>
                Connect wallet to sell
              </div>
            ) : isCheckingApproval ? (
              <button
                disabled
                style={{
                  width: '100%',
                  padding: 14,
                  background: 'rgba(107, 114, 128, 0.5)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: 'not-allowed',
                }}
              >
                Checking approvals...
              </button>
            ) : (approvalStep === 'permit2' || approvalStep === 'router') && isSmartWallet ? (
              <button
                onClick={handleBatchedApproveAndSell}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0 || !canSell}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'linear-gradient(135deg, rgba(255, 208, 117, 0.9), rgba(255, 59, 92, 0.9))',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Processing...' : `Approve & Sell ${isTokenPair ? `${outputTokenSymbol || 'Token'} for ${sellOutputCurrency === 'eth' ? 'ETH' : 'wASS'}` : 'wASS'}`}
              </button>
            ) : approvalStep === 'permit2' && isAerodromePair ? (
              // Aerodrome: Single approval step directly to Aerodrome Router
              <button
                onClick={handleApproveAerodrome}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(197, 169, 123, 0.8)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : `Approve ${outputTokenSymbol || 'Token'}`}
              </button>
            ) : approvalStep === 'permit2' && isHydrexPair ? (
              // Hydrex: Single approval step directly to KyberSwap Router
              <button
                onClick={handleApproveHydrex}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : `Approve ${outputTokenSymbol || 'Token'} for Hydrex`}
              </button>
            ) : approvalStep === 'permit2' ? (
              <button
                onClick={handleApprovePermit2}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : 'Step 1: Approve Token'}
              </button>
            ) : approvalStep === 'router' ? (
              <button
                onClick={handleApproveRouter}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : 'Step 2: Approve Router'}
              </button>
            ) : (
              <button
                onClick={handleSell}
                disabled={isBusy || isQuoting || !canSell || approvalStep !== 'ready'}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 59, 92, 0.8)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy || isQuoting || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Selling...' : isQuoting ? 'Getting quote...' : `Sell ${isTokenPair ? `${outputTokenSymbol || 'Token'} for ${sellOutputCurrency === 'eth' ? 'ETH' : 'wASS'}` : 'wASS'}`}
              </button>
            )}
            </>
            )}
          </div>

          {/* Footer for horizontal swap panel */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              borderTop: '1px solid rgba(255, 208, 117, 0.1)',
              fontSize: 11,
              color: 'rgba(255, 255, 255, 0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>Base</span>
              <span style={{ color: 'rgba(255, 208, 117, 0.4)' }}>•</span>
              <code
                style={{
                  padding: '2px 5px',
                  background: 'rgba(255, 208, 117, 0.1)',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: 'rgba(255, 208, 117, 0.6)',
                  cursor: 'pointer',
                }}
                onClick={() => navigator.clipboard.writeText(contracts.token.address)}
                title="Click to copy"
              >
                {contracts.token.address.slice(0, 6)}...{contracts.token.address.slice(-4)}
              </code>
            </div>
            <a
              href={`https://basescan.org/token/${contracts.token.address}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'rgba(255, 208, 117, 0.6)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              BaseScan
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* Horizontal Layout: Chart Panel (RIGHT) */}
      {isHorizontal && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Timeframe selector */}
          <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid rgba(255, 208, 117, 0.1)', flexShrink: 0 }}>
            {timeFrameButtons.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setTimeFrame(tf.value)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: timeFrame === tf.value ? 'rgba(255, 208, 117, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                  color: timeFrame === tf.value ? '#22c55e' : 'rgba(240, 236, 228, 0.5)',
                }}
              >
                {tf.label}
              </button>
            ))}
            {/* Price display in header */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {priceChange !== null && (
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: priceChange.percent >= 0 ? '#22c55e' : '#FF3B5C'
                }}>
                  {priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%
                </span>
              )}
              {tokenPrice && parseFloat(tokenPrice) > 0 && (
                <span style={{ fontSize: 14, fontWeight: 700, color: '#f0ece4' }}>
                  ${parseFloat(tokenPrice).toFixed(6)}
                </span>
              )}
            </div>
          </div>

          {/* Chart Container - takes 2/3 of remaining vertical space */}
          <div
            ref={chartContainerRef}
            style={{
              flex: 2,
              minHeight: 0,
              position: 'relative',
            }}
          >
            {isLoading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'rgba(10, 13, 12, 0.9)',
                  zIndex: 10,
                }}
              >
                <div
                  className="animate-spin"
                  style={{
                    width: 32,
                    height: 32,
                    border: '3px solid rgba(255, 208, 117, 0.2)',
                    borderTopColor: '#22c55e',
                    borderRadius: '50%',
                  }}
                />
                <span style={{ color: 'rgba(240, 236, 228, 0.5)', fontSize: 13 }}>Loading chart...</span>
              </div>
            )}
            {error && !isLoading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'rgba(10, 13, 12, 0.9)',
                }}
              >
                <span style={{ color: '#FF3B5C', fontSize: 14 }}>{error}</span>
                <button
                  onClick={() => setTimeFrame(timeFrame)}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    background: 'rgba(255, 208, 117, 0.2)',
                    border: '1px solid rgba(255, 208, 117, 0.3)',
                    borderRadius: 6,
                    color: '#ffd075',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Transaction History Section - takes 1/3 of remaining vertical space */}
          <div
            style={{
              borderTop: '1px solid rgba(255, 208, 117, 0.2)',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(180deg, rgba(10, 13, 12, 0.95) 0%, rgba(10, 13, 12, 0.98) 100%)',
              overflow: 'hidden',
            }}
          >
            {/* Header - compact */}
            <div
              style={{
                padding: '6px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(255, 208, 117, 0.05)',
                borderBottom: '1px solid rgba(255, 208, 117, 0.1)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 6px rgba(255, 208, 117, 0.6)',
                  animation: 'pulse 2s infinite',
                }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#f0ece4' }}>Live Trades</span>
              </div>
              <span style={{
                fontSize: 9,
                color: 'rgba(240, 236, 228, 0.5)',
              }}>
                {trades.length}
              </span>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
              {tradesLoading ? (
                <div style={{ padding: 32, textAlign: 'center' }}>
                  <div
                    className="animate-spin"
                    style={{
                      width: 24,
                      height: 24,
                      margin: '0 auto 12px',
                      border: '2px solid rgba(255, 208, 117, 0.2)',
                      borderTopColor: '#22c55e',
                      borderRadius: '50%',
                    }}
                  />
                  <span style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: 12 }}>Loading trades...</span>
                </div>
              ) : trades.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📊</div>
                  <span style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: 12 }}>No recent trades</span>
                </div>
              ) : (
                <div style={{ padding: '2px 0' }}>
                  {trades.slice(0, 50).map((trade, idx) => (
                    <a
                      key={`${trade.txHash}-${idx}`}
                      href={`https://basescan.org/tx/${trade.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px 10px',
                        margin: '0 4px 1px',
                        borderRadius: 4,
                        textDecoration: 'none',
                        transition: 'all 0.1s ease',
                        background: trade.type === 'buy'
                          ? 'rgba(255, 208, 117, 0.03)'
                          : 'rgba(255, 59, 92, 0.03)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = trade.type === 'buy'
                          ? 'rgba(255, 208, 117, 0.1)'
                          : 'rgba(255, 59, 92, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = trade.type === 'buy'
                          ? 'rgba(255, 208, 117, 0.03)'
                          : 'rgba(255, 59, 92, 0.03)';
                      }}
                    >
                      {/* Type badge - compact */}
                      <div style={{
                        width: 34,
                        padding: '2px 0',
                        borderRadius: 3,
                        textAlign: 'center',
                        fontSize: 9,
                        fontWeight: 700,
                        background: trade.type === 'buy'
                          ? 'rgba(255, 208, 117, 0.2)'
                          : 'rgba(255, 59, 92, 0.2)',
                        color: trade.type === 'buy' ? '#22c55e' : '#FF3B5C',
                        marginRight: 8,
                        flexShrink: 0,
                      }}>
                        {trade.type === 'buy' ? 'BUY' : 'SELL'}
                      </div>

                      {/* Amount + USD - single line */}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <img
                          src={isTokenPair && outputTokenAddress ? (getTokenImage(outputTokenAddress) || "/Images/Token.png") : "/Images/Token.png"}
                          alt={outputTokenSymbol || "Token"}
                          style={{ width: 12, height: 12, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#f0ece4' }}>
                          {parseFloat(trade.type === 'buy' ? trade.amountOut : trade.amountIn).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                            minimumFractionDigits: 0
                          })}
                        </span>
                        {trade.volumeUsd && parseFloat(trade.volumeUsd) > 0 && (
                          <span style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255, 208, 117, 0.7)' }}>
                            ${parseFloat(trade.volumeUsd).toFixed(2)}
                          </span>
                        )}
                        <span style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.4)' }}>
                          {truncateAddress(trade.wallet)}
                        </span>
                      </div>

                      {/* Time - compact */}
                      <div style={{
                        fontSize: 9,
                        color: 'rgba(255, 255, 255, 0.35)',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}>
                        {formatRelativeTime(trade.timestamp)}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vertical Layout: Original structure (for modal mode) */}
      {!isHorizontal && (
        <>
      {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255, 208, 117, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Token Pair Dropdown */}
              <div ref={pairDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setIsPairDropdownOpen(!isPairDropdownOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    background: isPairDropdownOpen ? 'rgba(255, 208, 117, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 208, 117, 0.3)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f0ece4' }}>{getPairDisplayName(selectedPair)}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(255, 208, 117, 0.8)"
                    strokeWidth="2"
                    style={{
                      transform: isPairDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isPairDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 4,
                      minWidth: 160,
                      background: 'rgba(23, 30, 29, 0.98)',
                      border: '1px solid rgba(255, 208, 117, 0.3)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                      zIndex: 100,
                      overflow: 'hidden',
                    }}
                  >
                    {/* Sort: ETH pairs first, then by best % gains */}
                    {[...allPairs]
                      .sort((a, b) => {
                        // ETH pairs (isDefault) always first
                        if (a.isDefault && !b.isDefault) return -1;
                        if (!a.isDefault && b.isDefault) return 1;
                        // Then sort by % gains descending
                        const aChange = allPairChanges.get(a.id) || 0;
                        const bChange = allPairChanges.get(b.id) || 0;
                        return bChange - aChange;
                      })
                      .map((pair) => {
                        const pairChange = allPairChanges.get(pair.id);
                        return (
                          <button
                            key={pair.id}
                            onClick={() => handlePairSelect(pair)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '10px 12px',
                              background: selectedPair.id === pair.id ? 'rgba(255, 208, 117, 0.15)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'background 0.1s ease',
                            }}
                            onMouseEnter={(e) => {
                              if (selectedPair.id !== pair.id) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (selectedPair.id !== pair.id) {
                                e.currentTarget.style.background = 'transparent';
                              }
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#f0ece4' }}>{getPairDisplayName(pair)}</span>
                              {!pair.geckoPoolAddress && (
                                <span style={{ fontSize: 10, color: 'rgba(255, 208, 117, 0.85)' }}>Chart pending</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {/* Show % change for all pairs with data */}
                              {pairChange !== undefined && pair.geckoPoolAddress && (
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: pairChange >= 0 ? '#22c55e' : '#FF3B5C',
                                  padding: '2px 5px',
                                  background: pairChange >= 0 ? 'rgba(255, 208, 117, 0.15)' : 'rgba(255, 59, 92, 0.15)',
                                  borderRadius: 4,
                                }}>
                                  {pairChange >= 0 ? '+' : ''}{pairChange.toFixed(1)}%
                                </span>
                              )}
                              {pair.isDefault && (
                                <span style={{
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: 'rgba(255, 208, 117, 0.8)',
                                  padding: '2px 5px',
                                  background: 'rgba(255, 208, 117, 0.15)',
                                  borderRadius: 4,
                                }}>
                                  ETH
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Price and Change */}
              {tokenPrice && parseFloat(tokenPrice) > 0 && selectedPair.isDefault && (
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255, 208, 117, 1)' }}>
                  ${tokenPrice}
                </span>
              )}
              {priceChange && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: priceChange.percent >= 0 ? '#22c55e' : '#FF3B5C',
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: priceChange.percent >= 0 ? 'rgba(255, 208, 117, 0.15)' : 'rgba(255, 59, 92, 0.15)',
                  }}
                >
                  {priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: 14,
                cursor: 'pointer',
                padding: '3px 8px',
                borderRadius: 5,
              }}
            >
              ✕
            </button>
          </div>

          {/* Timeframe selector */}
          <div style={{ display: 'flex', gap: 3, padding: '6px 14px', borderBottom: '1px solid rgba(255, 208, 117, 0.1)' }}>
            {timeFrameButtons.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setTimeFrame(tf.value)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: 'none',
                  cursor: 'pointer',
                  background: timeFrame === tf.value ? 'rgba(255, 208, 117, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                  color: timeFrame === tf.value ? '#22c55e' : 'rgba(240, 236, 228, 0.5)',
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Smaller Chart Container */}
          <div
            ref={chartContainerRef}
            style={{
              height: '200px',
              minHeight: '200px',
              position: 'relative',
            }}
          >
            {isLoading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'rgba(10, 13, 12, 0.9)',
                  zIndex: 10,
                }}
              >
                <div
                  className="animate-spin"
                  style={{
                    width: 24,
                    height: 24,
                    border: '2px solid rgba(255, 208, 117, 0.2)',
                    borderTopColor: '#22c55e',
                    borderRadius: '50%',
                  }}
                />
                <span style={{ color: 'rgba(240, 236, 228, 0.5)', fontSize: 11 }}>Loading...</span>
              </div>
            )}
            {error && !isLoading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: 'rgba(10, 13, 12, 0.9)',
                }}
              >
                <span style={{ color: '#FF3B5C', fontSize: 12 }}>{error}</span>
                <button
                  onClick={() => setTimeFrame(timeFrame)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    background: 'rgba(255, 208, 117, 0.2)',
                    border: '1px solid rgba(255, 208, 117, 0.3)',
                    borderRadius: 5,
                    color: '#ffd075',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Swap Section */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255, 208, 117, 0.15)' }}>
            {/* External DEX Link - shown for non-V4 tokens (Aerodrome, Hydrex) */}
            {!isTradeableInApp && externalDexUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: 16 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: selectedPairDex === 'aerodrome' ? 'rgba(197, 169, 123, 0.15)' : 'rgba(255, 107, 0, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={selectedPairDex === 'aerodrome' ? '#c5a97b' : '#FF6B00'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0ece4', marginBottom: 4 }}>
                    Trade on {selectedPairDex === 'aerodrome' ? 'Aerodrome' : selectedPairDex === 'hydrex' ? 'Hydrex' : 'DEX'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(240, 236, 228, 0.5)' }}>
                    This token trades on an external DEX
                  </div>
                </div>
                <a
                  href={externalDexUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 24px',
                    background: selectedPairDex === 'aerodrome'
                      ? 'linear-gradient(135deg, rgba(197, 169, 123, 0.9), rgba(160, 130, 80, 0.9))'
                      : 'linear-gradient(135deg, rgba(255, 107, 0, 0.9), rgba(200, 80, 0, 0.9))',
                    borderRadius: 10,
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 13,
                    color: '#f0ece4',
                  }}
                >
                  Swap
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
              </div>
            )}

            {/* Regular Swap UI - shown for V4 tokens */}
            {isTradeableInApp && (
              <>
            {/* Buy/Sell Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              <button
                onClick={() => { setSwapTab('buy'); setInputAmount(''); setOutputAmount(''); }}
                style={{
                  flex: 1,
                  padding: '8px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: swapTab === 'buy' ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer',
                  background: swapTab === 'buy' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  boxShadow: swapTab === 'buy' ? '0 0 15px rgba(34, 197, 94, 0.2)' : 'none',
                  color: swapTab === 'buy' ? '#22c55e' : 'rgba(240, 236, 228, 0.5)',
                }}
              >
                Buy
              </button>
              <button
                onClick={() => { setSwapTab('sell'); setInputAmount(''); setOutputAmount(''); }}
                style={{
                  flex: 1,
                  padding: '8px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: swapTab === 'sell' ? '1px solid rgba(255, 59, 92, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer',
                  background: swapTab === 'sell' ? 'rgba(255, 59, 92, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  boxShadow: swapTab === 'sell' ? '0 0 15px rgba(255, 59, 92, 0.2)' : 'none',
                  color: swapTab === 'sell' ? '#FF3B5C' : 'rgba(240, 236, 228, 0.5)',
                }}
              >
                Sell
              </button>
            </div>

            {/* Input */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'rgba(240, 236, 228, 0.5)' }}>
                <span>You Pay</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Balance: {swapTab === 'buy'
                    ? (buyInputCurrency === 'eth' ? parseFloat(ethBalance).toFixed(4) : parseFloat(tokenBalance).toFixed(2))
                    : parseFloat(sellBalance).toFixed(2)}
                  <img
                    src={swapTab === 'buy'
                      ? (buyInputCurrency === 'eth' ? '/Images/Ether.png' : '/Images/Token.png')
                      : (isTokenPair && outputTokenAddress ? (getTokenImage(outputTokenAddress) || '/Images/Token.png') : '/Images/Token.png')}
                    style={{ width: 12, height: 12 }}
                  />
                </span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
              }}>
                <input
                  type="number"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  placeholder="0.0"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#f0ece4',
                    fontSize: 16,
                    fontWeight: 500,
                  }}
                />
                {/* Currency toggle for buy mode on token pairs (hide for wASS-paired Aerodrome - wASS only) */}
                {swapTab === 'buy' && isTokenPair && !isWassPairedAerodrome && (
                  <button
                    onClick={() => {
                      setBuyInputCurrency(buyInputCurrency === 'eth' ? 'wass' : 'eth');
                      setInputAmount('');
                      setOutputAmount('');
                    }}
                    style={{
                      padding: '3px 6px',
                      fontSize: 9,
                      fontWeight: 600,
                      background: 'rgba(255, 208, 117, 0.2)',
                      border: 'none',
                      borderRadius: 4,
                      color: '#ffd075',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                    title="Switch input currency"
                  >
                    <span>⇄</span>
                  </button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <img
                    src={swapTab === 'buy'
                      ? (buyInputCurrency === 'eth' ? '/Images/Ether.png' : '/Images/Token.png')
                      : (isTokenPair && outputTokenAddress ? (getTokenImage(outputTokenAddress) || '/Images/Token.png') : '/Images/Token.png')}
                    alt={swapTab === 'buy' ? (buyInputCurrency === 'eth' ? 'ETH' : 'wASS') : 'Token'}
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)', whiteSpace: 'nowrap' }}>
                    {swapTab === 'buy'
                      ? (buyInputCurrency === 'eth' ? 'ETH' : 'wASS')
                      : (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS')}
                  </span>
                </div>
              </div>
              {/* Percentage buttons */}
              <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                {percentageButtons.map((btn) => (
                  <button
                    key={btn.value}
                    onClick={() => handlePercentageInput(btn.value)}
                    style={{
                      flex: 1,
                      padding: '5px 3px',
                      fontSize: 10,
                      fontWeight: 600,
                      background: 'rgba(255, 208, 117, 0.15)',
                      border: '1px solid rgba(255, 208, 117, 0.3)',
                      borderRadius: 5,
                      color: '#ffd075',
                      cursor: 'pointer',
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
              <div style={{ padding: 4, background: 'rgba(255, 255, 255, 0.05)', borderRadius: '50%' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Output */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'rgba(240, 236, 228, 0.5)' }}>
                <span>You Receive</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
              }}>
                <span style={{
                  flex: 1,
                  color: isQuoting ? 'rgba(255, 255, 255, 0.4)' : '#fff',
                  fontSize: 16,
                  fontWeight: 500,
                }}>
                  {isQuoting ? 'Loading...' : outputAmount || '0.0'}
                </span>
                {/* Sell output currency toggle for wASS/TOKEN pairs only (not Token Wars ETH pairs) */}
                {/* Token Wars ETH pairs can ONLY sell to ETH since there's no wASS in the pool */}
                {swapTab === 'sell' && isTokenPair && !isTokenWarsEthPair && (
                  <button
                    onClick={() => {
                      setSellOutputCurrency(sellOutputCurrency === 'wass' ? 'eth' : 'wass');
                      setOutputAmount('');
                    }}
                    style={{
                      padding: '3px 6px',
                      fontSize: 9,
                      fontWeight: 600,
                      background: 'rgba(255, 208, 117, 0.2)',
                      border: 'none',
                      borderRadius: 4,
                      color: '#ffd075',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    title="Switch output currency"
                  >
                    <span>⇄</span>
                  </button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <img
                    src={swapTab === 'buy'
                      ? (isTokenPair && outputTokenAddress ? (getTokenImage(outputTokenAddress) || '/Images/Token.png') : '/Images/Token.png')
                      : (isTokenWarsEthPair
                        ? '/Images/Ether.png' // Token Wars ETH pairs always sell to ETH
                        : (isTokenPair
                          ? (sellOutputCurrency === 'eth' ? '/Images/Ether.png' : '/Images/Token.png')
                          : '/Images/Ether.png'))}
                    alt={swapTab === 'buy' ? 'Token' : (isTokenWarsEthPair ? 'ETH' : (sellOutputCurrency === 'eth' ? 'ETH' : 'wASS'))}
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)' }}>
                    {swapTab === 'buy'
                      ? (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS')
                      : (isTokenWarsEthPair ? 'ETH' : (isTokenPair ? (sellOutputCurrency === 'eth' ? 'ETH' : 'wASS') : 'ETH'))}
                  </span>
                </div>
              </div>
            </div>

            {/* Error */}
            {(swapError || writeError) && (
              <div style={{
                marginBottom: 10,
                padding: 8,
                background: 'rgba(255, 59, 92, 0.1)',
                border: '1px solid rgba(255, 59, 92, 0.3)',
                borderRadius: 6,
                fontSize: 11,
                color: '#FF3B5C',
                textAlign: 'center',
              }}>
                {swapError || (writeError?.message?.includes('User rejected') ? 'Transaction cancelled' : 'Transaction failed')}
              </div>
            )}

            {/* Action Button */}
            {swapTab === 'buy' ? (
              !address ? (
                <div style={{
                  padding: 12,
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: 8,
                  fontSize: 13,
                  color: 'rgba(240, 236, 228, 0.5)',
                  textAlign: 'center',
                }}>
                  Connect wallet to buy
                </div>
              ) : isWassPairedAerodrome && wassAerodromeApprovalNeeded ? (
                // wASS-paired Aerodrome: Need direct wASS approval to router
                <button
                  onClick={handleApproveWassAerodrome}
                  disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#f0ece4',
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isBusy ? 'Approving...' : 'Approve wASS for Aerodrome'}
                </button>
              ) : isWassPairedAerodrome ? (
                // wASS-paired Aerodrome: Approved, show buy button
                <button
                  onClick={handleBuy}
                  disabled={isBusy || isQuoting || !canBuy}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#f0ece4',
                    cursor: isBusy || isQuoting || !canBuy ? 'not-allowed' : 'pointer',
                    opacity: !canBuy ? 0.5 : 1,
                  }}
                >
                  {isBusy ? 'Buying...' : isQuoting ? 'Getting quote...' : `Buy ${outputTokenSymbol || 'Token'} with wASS`}
                </button>
              ) : buyInputCurrency === 'wass' && isTokenPair ? (
                // Token Wars V4: Buying with wASS - show Permit2 approval flow
                isCheckingBuyWassApproval ? (
                  <button
                    disabled
                    style={{
                      width: '100%',
                      padding: 12,
                      background: 'rgba(107, 114, 128, 0.5)',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: 'not-allowed',
                    }}
                  >
                    Checking approvals...
                  </button>
                ) : buyWassApprovalStep === 'permit2' ? (
                  <button
                    onClick={handleApproveWassPermit2}
                    disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                    style={{
                      width: '100%',
                      padding: 12,
                      background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isBusy ? 'Approving...' : 'Step 1: Approve wASS'}
                  </button>
                ) : buyWassApprovalStep === 'router' ? (
                  <button
                    onClick={handleApproveWassRouter}
                    disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                    style={{
                      width: '100%',
                      padding: 12,
                      background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isBusy ? 'Approving...' : 'Step 2: Approve Router'}
                  </button>
                ) : (
                  <button
                    onClick={handleBuy}
                    disabled={isBusy || isQuoting || !canBuy || buyWassApprovalStep !== 'ready'}
                    style={{
                      width: '100%',
                      padding: 12,
                      background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#f0ece4',
                      cursor: isBusy || isQuoting || !canBuy ? 'not-allowed' : 'pointer',
                      opacity: !canBuy ? 0.5 : 1,
                    }}
                  >
                    {isBusy ? 'Buying...' : isQuoting ? 'Getting quote...' : `Buy ${outputTokenSymbol || 'Token'} with wASS`}
                  </button>
                )
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={isBusy || isQuoting || !canBuy}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#f0ece4',
                    cursor: isBusy || isQuoting || !canBuy ? 'not-allowed' : 'pointer',
                    opacity: !canBuy ? 0.5 : 1,
                  }}
                >
                  {isBusy ? 'Buying...' : isQuoting ? 'Getting quote...' : `Buy ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`}
                </button>
              )
            ) : !address ? (
              <div style={{
                padding: 12,
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 8,
                fontSize: 13,
                color: 'rgba(240, 236, 228, 0.5)',
                textAlign: 'center',
              }}>
                Connect wallet to sell
              </div>
            ) : isCheckingApproval ? (
              <button
                disabled
                style={{
                  width: '100%',
                  padding: 12,
                  background: 'rgba(107, 114, 128, 0.5)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: 'not-allowed',
                }}
              >
                Checking approvals...
              </button>
            ) : (approvalStep === 'permit2' || approvalStep === 'router') && isSmartWallet ? (
              // Smart wallet: One-click approve + sell (batched transaction)
              <button
                onClick={handleBatchedApproveAndSell}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0 || !canSell}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'linear-gradient(135deg, rgba(255, 208, 117, 0.9), rgba(255, 59, 92, 0.9))',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Processing...' : `Approve & Sell ${isTokenPair ? `${outputTokenSymbol || 'Token'} for ${sellOutputCurrency === 'eth' ? 'ETH' : 'wASS'}` : 'wASS'}`}
              </button>
            ) : approvalStep === 'permit2' && isAerodromePair ? (
              // Aerodrome: Single approval step directly to Aerodrome Router
              <button
                onClick={handleApproveAerodrome}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(197, 169, 123, 0.8)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : `Approve ${outputTokenSymbol || 'Token'}`}
              </button>
            ) : approvalStep === 'permit2' && isHydrexPair ? (
              // Hydrex: Single approval step directly to KyberSwap Router
              <button
                onClick={handleApproveHydrex}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.8)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : `Approve ${outputTokenSymbol || 'Token'} for Hydrex`}
              </button>
            ) : approvalStep === 'permit2' ? (
              // Regular wallet: Step 1 - Approve Token for Permit2
              <button
                onClick={handleApprovePermit2}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : 'Step 1: Approve Token'}
              </button>
            ) : approvalStep === 'router' ? (
              // Regular wallet: Step 2 - Approve Router on Permit2
              <button
                onClick={handleApproveRouter}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 208, 117, 0.85)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isBusy ? 'Approving...' : 'Step 2: Approve Router'}
              </button>
            ) : (
              // Ready to sell
              <button
                onClick={handleSell}
                disabled={isBusy || isQuoting || !canSell || approvalStep !== 'ready'}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(255, 59, 92, 0.8)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#f0ece4',
                  cursor: isBusy || isQuoting || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Selling...' : isQuoting ? 'Getting quote...' : `Sell ${isTokenPair ? `${outputTokenSymbol || 'Token'} for ${sellOutputCurrency === 'eth' ? 'ETH' : 'wASS'}` : 'wASS'}`}
              </button>
            )}
            </>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              borderTop: '1px solid rgba(255, 208, 117, 0.1)',
              fontSize: 10,
              color: 'rgba(255, 255, 255, 0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>Base</span>
              <span style={{ color: 'rgba(255, 208, 117, 0.4)' }}>•</span>
              <code
                style={{
                  padding: '1px 4px',
                  background: 'rgba(255, 208, 117, 0.1)',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  color: 'rgba(255, 208, 117, 0.6)',
                  cursor: 'pointer',
                }}
                onClick={() => navigator.clipboard.writeText(contracts.token.address)}
                title="Click to copy"
              >
                {contracts.token.address.slice(0, 6)}...{contracts.token.address.slice(-4)}
              </code>
            </div>
            <a
              href={`https://basescan.org/token/${contracts.token.address}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'rgba(255, 208, 117, 0.6)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              BaseScan
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </>
      )}
    </div>
  );

  // Embedded mode: render content directly without modal wrapper
  if (embedded) {
    return contentDiv;
  }

  // Modal mode: render with backdrop and centered container
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 pointer-events-none">
        {contentDiv}
      </div>
    </>
  );
}
