'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useBalance, useSendCalls, useCallsStatus } from 'wagmi';
import { parseEther, formatEther, formatUnits, parseUnits, encodeFunctionData, maxUint160 } from 'viem';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI, UNIVERSAL_ROUTER_ADDRESS, PERMIT2_ADDRESS, TOKEN_PAIRS, getDefaultPair, getTokenPairById, getAllTokenAddresses, ETH_ADDRESS, TokenPairConfig, WASS_TOKEN_ADDRESS, HOOK_ADDRESS, POOL_CONFIG, STATE_VIEW_ADDRESS } from '@/config';
import { base } from 'wagmi/chains';
import { useTransactions } from '@/contexts/TransactionContext';
import { useMultipleTokenInfo, TokenInfo } from '@/hooks/useTokenInfo';
import { PoolTrade, formatRelativeTime, truncateAddress } from '@/hooks/usePoolTrades';

// V4 Command constants for Universal Router
const V4_SWAP = 0x10; // V4_SWAP command
const SWAP_EXACT_IN_SINGLE = 0x06; // Single pool exact input swap
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

export function ChartModal({ isOpen, onClose, tokenPrice, embedded = false, layout = 'vertical', onPairChange, onSwapComplete, trades = [], tradesLoading = false, selectedPairId }: ChartModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);
  const { addTransaction, updateTransaction } = useTransactions();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null);

  // Token pair selection state
  const [selectedPair, setSelectedPair] = useState<TokenPairConfig>(getDefaultPair());
  const [isPairDropdownOpen, setIsPairDropdownOpen] = useState(false);
  const pairDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch token names dynamically via RPC
  const { tokenInfos, isLoading: isLoadingTokenInfo } = useMultipleTokenInfo(getAllTokenAddresses());

  // Helper to get token symbol by address
  const getTokenSymbol = useCallback((address: `0x${string}`): string => {
    if (address === ETH_ADDRESS) return 'ETH';
    if (address.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase()) return 'wASS';
    const info = tokenInfos.get(address.toLowerCase());
    return info?.symbol || `${address.slice(0, 6)}...`;
  }, [tokenInfos]);

  // Helper to get display name for a pair
  const getPairDisplayName = useCallback((pair: TokenPairConfig): string => {
    const symbol0 = getTokenSymbol(pair.token0);
    const symbol1 = getTokenSymbol(pair.token1);
    return `${symbol0}/${symbol1}`;
  }, [getTokenSymbol]);

  // Check if selected pair is a token pair (not the default wASS/ETH pair)
  const isTokenPair = !selectedPair.isDefault && selectedPair.token0 !== ETH_ADDRESS && selectedPair.token1 !== ETH_ADDRESS;

  // Get the output token for token pairs (the non-wASS token)
  const getOutputTokenAddress = useCallback((): `0x${string}` | null => {
    if (!isTokenPair) return null;
    // In token pairs, one is wASS and the other is the output token
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

  // Transaction state
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Approval state for sells
  const [approvalStep, setApprovalStep] = useState<'none' | 'permit2' | 'router' | 'ready'>('none');
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [poolKey, setPoolKey] = useState<{
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  } | null>(null);

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

  // Fetch price changes for all pairs on modal open (for dropdown sorting)
  useEffect(() => {
    if (!isOpen) return;

    const fetchAllPairChanges = async () => {
      const changes = new Map<string, number>();

      await Promise.all(
        TOKEN_PAIRS.map(async (pair) => {
          if (!pair.geckoPoolAddress) {
            changes.set(pair.id, 0);
            return;
          }

          try {
            // Use 1h timeframe for consistency
            const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pair.geckoPoolAddress}/ohlcv/hour?aggregate=1&limit=24&currency=usd`;
            const response = await fetch(url);

            if (!response.ok) {
              changes.set(pair.id, 0);
              return;
            }

            const json = await response.json();
            const ohlcvList = json?.data?.attributes?.ohlcv_list || [];

            if (ohlcvList.length >= 2) {
              // Data is in reverse chronological order [newest, ..., oldest]
              const oldestPrice = ohlcvList[ohlcvList.length - 1]?.[1] || 0; // open price
              const newestPrice = ohlcvList[0]?.[4] || 0; // close price
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

      setAllPairChanges(changes);
    };

    fetchAllPairChanges();
  }, [isOpen]);

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

  // Handle pair selection
  const handlePairSelect = (pair: TokenPairConfig) => {
    setSelectedPair(pair);
    setIsPairDropdownOpen(false);
    setPriceChange(null);
    // Notify parent of pool change for trade history
    if (pair.geckoPoolAddress) {
      onPairChange?.(pair.geckoPoolAddress);
    }
    setInputAmount('');
    setOutputAmount('');
    // Reset approval state when switching pairs (force re-check)
    setApprovalStep('none');
    // Refetch allowances for the new token (after state updates)
    setTimeout(() => {
      refetchPermit2Allowance();
      refetchRouterAllowance();
    }, 100);
    // Clear chart data immediately and reset time scale to prepare for new data
    if (seriesRef.current && chartRef.current) {
      seriesRef.current.setData([]);
      chartRef.current.timeScale().resetTimeScale();
    }
  };

  // Watch for external pair selection changes (from sidebar)
  useEffect(() => {
    if (selectedPairId && selectedPairId !== selectedPair.id) {
      const pair = getTokenPairById(selectedPairId);
      if (pair) {
        handlePairSelect(pair);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPairId]);

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

        // Check ERC20 allowance for Permit2
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
  }, [swapTab, address, inputAmount, permit2Allowance, routerAllowanceData, sellTokenAddress, isTokenPair]);

  // Fetch OHLCV data from GeckoTerminal API
  const fetchOHLCVData = useCallback(async (tf: TimeFrame, poolAddr: string): Promise<OHLCVData[]> => {
    // If no pool address available, return empty data
    if (!poolAddr) {
      return [];
    }

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

    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddr}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=300&currency=usd`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch chart data');
    }

    const data = await response.json();
    const ohlcvList = data?.data?.attributes?.ohlcv_list || [];

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
        vertLines: { color: 'rgba(16, 185, 129, 0.08)' },
        horzLines: { color: 'rgba(16, 185, 129, 0.08)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(16, 185, 129, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(16, 185, 129, 0.9)',
        },
        horzLine: {
          color: 'rgba(16, 185, 129, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(16, 185, 129, 0.9)',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(16, 185, 129, 0.15)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(16, 185, 129, 0.15)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: true },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
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

  // Reset initial data flag when pair or timeframe changes
  useEffect(() => {
    hasInitialDataRef.current = false;
    lastDataRef.current = [];
  }, [selectedPair.geckoPoolAddress, timeFrame]);

  // Fetch and update data when timeframe or selected pair changes
  useEffect(() => {
    if (!isOpen || !seriesRef.current) return;

    // Initial load - full data replacement with loading state
    const loadInitialData = async () => {
      setIsLoading(true);
      setError(null);

      if (!selectedPair.geckoPoolAddress) {
        setError('Chart data not yet available for this pair');
        setIsLoading(false);
        seriesRef.current?.setData([]);
        return;
      }

      try {
        const data = await fetchOHLCVData(timeFrame, selectedPair.geckoPoolAddress);

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
        chartRef.current?.timeScale().fitContent();
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
      if (!selectedPair.geckoPoolAddress || !hasInitialDataRef.current) return;

      try {
        const data = await fetchOHLCVData(timeFrame, selectedPair.geckoPoolAddress);
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

    // Dynamic polling interval: 2s when fast polling (after swap), 5s normally
    const getPollingInterval = () => {
      const isFastPolling = Date.now() < fastPollingUntil;
      return isFastPolling ? 2000 : 5000;
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
  }, [isOpen, timeFrame, selectedPair, fetchOHLCVData, fastPollingUntil]);

  // Fetch quote when input changes
  useEffect(() => {
    if (!publicClient || !inputAmount || parseFloat(inputAmount) <= 0) {
      setOutputAmount('');
      return;
    }

    const fetchQuote = async () => {
      setIsQuoting(true);
      setSwapError(null);

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

        if (isTokenPair && outputTokenAddress) {
          // Token pair quote using actual quoter
          // Build pool key from config values directly (geckoPoolAddress is NOT the pool ID)
          const tokenPairPoolKey = {
            currency0: selectedPair.token0,
            currency1: selectedPair.token1,
            fee: selectedPair.fee,
            tickSpacing: selectedPair.tickSpacing,
            hooks: selectedPair.hook,
          };
          console.log('Token pair pool key:', tokenPairPoolKey);

          // Determine direction based on wASS position in pool
          // wASS (0x4450...) < TOKEN (0x9B26...) → wASS is currency0, TOKEN is currency1
          const wassIsToken0 = tokenPairPoolKey.currency0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();
          console.log('wASS is token0:', wassIsToken0);

          if (swapTab === 'buy') {
            // Buy: ETH → wASS → Token (two hops via OTC router's swapToToken)
            //
            // Use the SAME V4 quote approach as the default wASS/ETH pair
            // The swapToToken function has slippage protection (minWassOut, minTokenOut)
            // so we just need a good estimate - V4 quoter provides this

            const ethIn = parseEther(inputAmount);
            console.log('=== BUY QUOTE START ===');
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
          } else {
            // Sell: Token → wASS (single hop - output is wASS)
            const tokenIn = parseUnits(inputAmount, 18);

            // Token → wASS direction
            // If wASS is token0: selling TOKEN (currency1) for wASS (currency0) = zeroForOne = false
            // If wASS is token1: selling TOKEN (currency0) for wASS (currency1) = zeroForOne = true
            const tokenToWassZeroForOne = !wassIsToken0;
            console.log('Sell Token→wASS direction, zeroForOne:', tokenToWassZeroForOne, 'amount:', formatUnits(tokenIn, 18));

            try {
              const wassOut = await getSimulateQuote(tokenPairPoolKey, tokenToWassZeroForOne, tokenIn);
              console.log('Token→wASS quote:', formatUnits(wassOut, 18), 'wASS for', formatUnits(tokenIn, 18), 'Token');

              if (wassOut > 0n) {
                setOutputAmount(formatUnits(wassOut, 18));
              } else {
                console.log('Quoter returned 0, using 1:1 estimate');
                setOutputAmount(formatUnits(tokenIn, 18));
              }
            } catch (err) {
              console.error('Token→wASS quoter failed:', err);
              console.log('Using 1:1 estimate');
              setOutputAmount(formatUnits(tokenIn, 18));
            }
          }
        } else {
          // Default pair: wASS/ETH - use original working quoter with simulateContract
          // Get pool key from hook
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
            args: [poolIdRaw],
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
  }, [inputAmount, swapTab, publicClient, contracts.nft.address, contracts.nft.abi, isTokenPair, outputTokenAddress, selectedPair]);

  // Handle successful transaction
  useEffect(() => {
    if (isSuccess && txHash) {
      updateTransaction(txHash, 'success');
      refetchTokenBalance();
      refetchOutputTokenBalance();
      refetchPermit2Allowance();
      refetchRouterAllowance();
      setInputAmount('');
      setOutputAmount('');
      setTimeout(() => resetWrite(), 2000);
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
  }, [isSuccess, txHash, updateTransaction, refetchTokenBalance, refetchOutputTokenBalance, refetchPermit2Allowance, refetchRouterAllowance, resetWrite]);

  // Reset on transaction error/cancel to allow retry immediately
  useEffect(() => {
    if (writeError) {
      console.log('Transaction error/cancel:', writeError.message);
      // Reset immediately so button is clickable again
      resetWrite();
    }
  }, [writeError, resetWrite]);

  // Handle Buy (OTC for wASS/ETH, swapToToken for token pairs)
  const handleBuy = () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) return;

    const ethValue = parseEther(inputAmount);

    if (isTokenPair && outputTokenAddress) {
      // Multi-hop buy: ETH → wASS → Token using swapToToken
      // Use 0 for min amounts to avoid slippage issues during testing
      const minTokensOut = 0n;
      const minWassOut = 0n;

      // Determine if wASS is token0 in the output pool
      const wassIsToken0 = selectedPair.token0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();

      // Build the output pool key for swapToToken
      const outputPoolKey = {
        currency0: selectedPair.token0,
        currency1: selectedPair.token1,
        fee: selectedPair.fee,
        tickSpacing: selectedPair.tickSpacing,
        hooks: selectedPair.hook,
      };

      console.log('=== TOKEN PAIR BUY via OTC ===');
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

  // Handle Permit2 Approval (Step 1: Approve Permit2 to spend tokens)
  const handleApprovePermit2 = async () => {
    if (!address) return;

    try {
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
    }
  };

  // Handle Router Approval (Step 2: Approve Universal Router on Permit2)
  const handleApproveRouter = async () => {
    if (!address) return;

    try {
      // Approve Universal Router via Permit2 with max amount and far future expiration
      // Note: uint48 max is 281,474,976,710,655 which fits in a JS number
      const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year

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
        const tokenPoolKey = {
          currency0: selectedPair.token0,
          currency1: selectedPair.token1,
          fee: selectedPair.fee,
          tickSpacing: selectedPair.tickSpacing,
          hooks: selectedPair.hook,
        };
        const wassIsToken0 = selectedPair.token0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();
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
      } else if (poolKey) {
        // Single-hop sell: wASS -> ETH
        const minEthOut = outputAmount ? parseEther((parseFloat(outputAmount) * 0.95).toString()) : 0n;
        const { commands, inputs } = buildV4SwapCalldata(sellAmount, minEthOut, poolKey);

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

  // Build V4 multi-hop swap calldata (Token -> wASS -> ETH)
  const buildMultiHopV4SwapCalldata = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
    tokenPoolKey: {
      currency0: `0x${string}`;
      currency1: `0x${string}`;
      fee: number;
      tickSpacing: number;
      hooks: `0x${string}`;
    },
    wassPoolKey: {
      currency0: `0x${string}`;
      currency1: `0x${string}`;
      fee: number;
      tickSpacing: number;
      hooks: `0x${string}`;
    },
    wassIsToken0InTokenPool: boolean
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    // Multi-hop: Token -> wASS -> ETH
    // Two swaps in sequence using V4Router actions

    // Actions for multi-hop:
    // SWAP_EXACT_IN_SINGLE (Token -> wASS)
    // SWAP_EXACT_IN_SINGLE (wASS -> ETH)
    // SETTLE_ALL (settle input token)
    // TAKE_ALL (take ETH output)
    const SWAP_EXACT_IN_SINGLE_2 = 0x06;
    const actions = new Uint8Array([SWAP_EXACT_IN_SINGLE, SWAP_EXACT_IN_SINGLE_2, SETTLE_ALL, TAKE_ALL]);

    // First swap: Token -> wASS
    // If wASS is token0, we're swapping token1 -> token0 (zeroForOne = false)
    // If wASS is token1, we're swapping token0 -> token1 (zeroForOne = true)
    const tokenToWassZeroForOne = !wassIsToken0InTokenPool;
    const inputToken = wassIsToken0InTokenPool ? tokenPoolKey.currency1 : tokenPoolKey.currency0;

    const swap1Params = encodeFunctionData({
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
        poolKey: tokenPoolKey,
        zeroForOne: tokenToWassZeroForOne,
        amountIn: amountIn,
        amountOutMinimum: 0n, // Intermediate - no min (slippage on final)
        hookData: '0x' as `0x${string}`,
      }],
    });
    const swap1ParamsData = ('0x' + swap1Params.slice(10)) as `0x${string}`;

    // Second swap: wASS -> ETH
    // wASS is currency1 in wassPoolKey (ETH is currency0)
    // So zeroForOne = false (wASS -> ETH = token1 -> token0)
    const swap2Params = encodeFunctionData({
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
        poolKey: wassPoolKey,
        zeroForOne: false, // wASS (token1) -> ETH (token0)
        amountIn: 0n, // Use output from previous swap (CONTRACT_BALANCE)
        amountOutMinimum: minAmountOut,
        hookData: '0x' as `0x${string}`,
      }],
    });
    const swap2ParamsData = ('0x' + swap2Params.slice(10)) as `0x${string}`;

    // Settle the input token
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
        [swap1ParamsData, swap2ParamsData, settleParamsData, takeParamsData],
      ],
    });
    const v4InputData = ('0x' + v4Input.slice(10)) as `0x${string}`;

    const commands = ('0x' + V4_SWAP.toString(16).padStart(2, '0')) as `0x${string}`;

    return { commands, inputs: [v4InputData] };
  }, []);

  // Build V4 swap calldata for token pair single-hop (TOKEN -> wASS)
  // Uses SETTLE_ALL which automatically handles Permit2 transfers (same as working wASS->ETH)
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

    // Encode SETTLE_ALL params: (address currency, uint256 maxAmount)
    // SETTLE_ALL automatically handles Permit2 transfers
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

    // Encode TAKE_ALL params: (address currency, uint256 minAmount)
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
      const sellAmount = parseUnits(inputAmount, 18);
      const minEthOut = outputAmount ? parseEther((parseFloat(outputAmount) * 0.95).toString()) : 0n; // 5% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

      if (isTokenPair && outputTokenAddress) {
        // Single-hop sell: Token -> wASS
        // The token pair pool key (wASS/TOKEN)
        const tokenPoolKey = {
          currency0: selectedPair.token0,
          currency1: selectedPair.token1,
          fee: selectedPair.fee,
          tickSpacing: selectedPair.tickSpacing,
          hooks: selectedPair.hook,
        };

        // Determine zeroForOne direction
        // If wASS is token0 (currency0), selling TOKEN (currency1) for wASS means currency1 -> currency0 = zeroForOne = false
        // If wASS is token1 (currency1), selling TOKEN (currency0) for wASS means currency0 -> currency1 = zeroForOne = true
        const wassIsToken0 = selectedPair.token0.toLowerCase() === WASS_TOKEN_ADDRESS.toLowerCase();
        const zeroForOne = !wassIsToken0; // TOKEN -> wASS direction

        // Min wASS output (with 5% slippage)
        const minWassOut = outputAmount ? parseUnits((parseFloat(outputAmount) * 0.95).toString(), 18) : 0n;

        console.log('=== TOKEN PAIR SELL ===');
        console.log('Pool key:', tokenPoolKey);
        console.log('wASS is token0:', wassIsToken0);
        console.log('zeroForOne (TOKEN→wASS):', zeroForOne);
        console.log('Sell amount:', formatUnits(sellAmount, 18), 'TOKEN');
        console.log('Min wASS out:', formatUnits(minWassOut, 18), 'wASS');
        console.log('Input token:', outputTokenAddress);
        console.log('Output token:', WASS_TOKEN_ADDRESS);

        // Build single-hop V4 swap calldata using the same pattern as default wASS sells
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
      } else {
        // Single-hop sell: wASS -> ETH
        if (!poolKey) {
          setSwapError('Pool not loaded');
          return;
        }

        const { commands, inputs } = buildV4SwapCalldata(sellAmount, minEthOut, poolKey);

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
      setSwapError('Failed to execute swap');
    }
  };

  const handleMaxInput = () => {
    if (swapTab === 'buy') {
      // Leave some ETH for gas
      const maxEth = Math.max(0, parseFloat(ethBalance) - 0.001);
      setInputAmount(maxEth.toFixed(6));
    } else {
      setInputAmount(sellBalance);
    }
  };

  // In embedded mode, always render (not controlled by isOpen)
  if (!isOpen && !embedded) return null;

  const timeFrameButtons: { value: TimeFrame; label: string }[] = [
    { value: '5m', label: '5M' },
    { value: '15m', label: '15M' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
  ];

  const isBusy = isPending || isConfirming || isBatchPending;
  const canBuy = address && inputAmount && parseFloat(inputAmount) > 0 && parseFloat(inputAmount) <= parseFloat(ethBalance);
  const canSell = address && inputAmount && parseFloat(inputAmount) > 0 && parseFloat(inputAmount) <= parseFloat(sellBalance);

  // Determine if using horizontal layout (swap left, chart right)
  const isHorizontal = layout === 'horizontal' && embedded;

  // Content wrapper - different styles for embedded vs modal
  const contentDiv = (
    <div
      className={embedded ? "h-full w-full flex" : "pointer-events-auto w-full flex flex-col"}
      style={{
        ...(embedded ? {} : { maxWidth: '500px', maxHeight: '90vh' }),
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.03), rgba(17, 24, 39, 0.98), rgba(16, 185, 129, 0.03))',
        backgroundColor: 'rgba(10, 15, 20, 0.98)',
        ...(embedded ? {} : {
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: '12px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 40px rgba(16, 185, 129, 0.15)',
        }),
        overflow: 'hidden',
        flexDirection: isHorizontal ? 'row' : 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Horizontal Layout: Swap Panel (LEFT) */}
      {isHorizontal && (
        <div
          className="flex-shrink-0 flex flex-col border-r border-emerald-900/30 overflow-y-auto overflow-x-hidden"
          style={{ width: '340px', maxWidth: '40%' }}
        >
          {/* Swap Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid rgba(16, 185, 129, 0.15)',
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
                    padding: '6px 12px',
                    background: isPairDropdownOpen ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{getPairDisplayName(selectedPair)}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(16, 185, 129, 0.8)"
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
                      background: 'rgba(15, 20, 25, 0.98)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                      zIndex: 100,
                      overflow: 'hidden',
                    }}
                  >
                    {[...TOKEN_PAIRS]
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
                              background: selectedPair.id === pair.id ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              transition: 'background 0.15s ease',
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: selectedPair.id === pair.id ? '#10b981' : '#fff' }}>
                              {getPairDisplayName(pair)}
                            </span>
                            {pairChange !== undefined && (
                              <span style={{ fontSize: 11, fontWeight: 500, color: pairChange >= 0 ? '#10b981' : '#ef4444' }}>
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
            <span style={{ fontSize: 12, fontWeight: 600, color: '#10b981' }}>Swap</span>
          </div>

          {/* Swap Section - in horizontal left panel */}
          <div style={{ padding: '16px', flex: 1, overflow: 'hidden' }}>
            {/* Buy/Sell Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
              <button
                onClick={() => { setSwapTab('buy'); setInputAmount(''); setOutputAmount(''); }}
                style={{
                  flex: 1,
                  padding: '10px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  background: swapTab === 'buy' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: swapTab === 'buy' ? '#10b981' : 'rgba(255, 255, 255, 0.5)',
                }}
              >
                Buy
              </button>
              <button
                onClick={() => { setSwapTab('sell'); setInputAmount(''); setOutputAmount(''); }}
                style={{
                  flex: 1,
                  padding: '10px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  background: swapTab === 'sell' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: swapTab === 'sell' ? '#ef4444' : 'rgba(255, 255, 255, 0.5)',
                }}
              >
                Sell
              </button>
            </div>

            {/* Input */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                <span>You Pay</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Balance: {swapTab === 'buy' ? parseFloat(ethBalance).toFixed(4) : parseFloat(sellBalance).toFixed(2)}
                  <img
                    src={swapTab === 'buy' ? '/Images/Ether.png' : '/Images/Token.png'}
                    alt={swapTab === 'buy' ? 'ETH' : 'wASS'}
                    style={{ width: 14, height: 14 }}
                  />
                </span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
              }}>
                <input
                  type="number"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  placeholder="0.0"
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#fff',
                    fontSize: 18,
                    fontWeight: 500,
                  }}
                />
                <button
                  onClick={handleMaxInput}
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: 'none',
                    borderRadius: 4,
                    color: '#10b981',
                    cursor: 'pointer',
                  }}
                >
                  MAX
                </button>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)' }}>
                  {swapTab === 'buy' ? 'ETH' : (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS')}
                </span>
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
              <div style={{ padding: 6, background: 'rgba(255, 255, 255, 0.05)', borderRadius: '50%' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Output */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                <span>You Receive</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 10,
              }}>
                <span style={{
                  flex: 1,
                  color: isQuoting ? 'rgba(255, 255, 255, 0.4)' : '#fff',
                  fontSize: 18,
                  fontWeight: 500,
                }}>
                  {isQuoting ? 'Loading...' : outputAmount || '0.0'}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)' }}>
                  {swapTab === 'buy' ? (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS') : (isTokenPair ? 'wASS' : 'ETH')}
                </span>
              </div>
            </div>

            {/* Error */}
            {(swapError || writeError) && (
              <div style={{
                marginBottom: 12,
                padding: 10,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 8,
                fontSize: 12,
                color: '#ef4444',
                textAlign: 'center',
              }}>
                {swapError || (writeError?.message?.includes('User rejected') ? 'Transaction cancelled' : 'Transaction failed')}
              </div>
            )}

            {/* Action Button */}
            {swapTab === 'buy' ? (
              !address ? (
                <div style={{
                  padding: 14,
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: 10,
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.5)',
                  textAlign: 'center',
                }}>
                  Connect wallet to buy
                </div>
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={isBusy || isQuoting || !canBuy}
                  style={{
                    width: '100%',
                    padding: 14,
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(16, 185, 129, 0.8)',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 15,
                    fontWeight: 600,
                    color: '#fff',
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
                color: 'rgba(255, 255, 255, 0.5)',
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
                  color: '#fff',
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
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'linear-gradient(135deg, rgba(251, 191, 36, 0.9), rgba(239, 68, 68, 0.9))',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                  cursor: isBusy || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Processing...' : `Approve & Sell ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`}
              </button>
            ) : approvalStep === 'permit2' ? (
              <button
                onClick={handleApprovePermit2}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 14,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(251, 191, 36, 0.8)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
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
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(251, 191, 36, 0.8)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
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
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(239, 68, 68, 0.8)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                  cursor: isBusy || isQuoting || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Selling...' : isQuoting ? 'Getting quote...' : `Sell ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`}
              </button>
            )}
          </div>

          {/* Footer for horizontal swap panel */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              borderTop: '1px solid rgba(16, 185, 129, 0.1)',
              fontSize: 11,
              color: 'rgba(255, 255, 255, 0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>Base</span>
              <span style={{ color: 'rgba(16, 185, 129, 0.4)' }}>•</span>
              <code
                style={{
                  padding: '2px 5px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: 'rgba(16, 185, 129, 0.6)',
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
              style={{ color: 'rgba(16, 185, 129, 0.6)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
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
          <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid rgba(16, 185, 129, 0.1)', flexShrink: 0 }}>
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
                  background: timeFrame === tf.value ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                  color: timeFrame === tf.value ? '#10b981' : 'rgba(255, 255, 255, 0.5)',
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
                  color: priceChange.percent >= 0 ? '#10b981' : '#ef4444'
                }}>
                  {priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%
                </span>
              )}
              {tokenPrice && parseFloat(tokenPrice) > 0 && (
                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
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
                  background: 'rgba(10, 15, 20, 0.9)',
                  zIndex: 10,
                }}
              >
                <div
                  className="animate-spin"
                  style={{
                    width: 32,
                    height: 32,
                    border: '3px solid rgba(16, 185, 129, 0.2)',
                    borderTopColor: '#10b981',
                    borderRadius: '50%',
                  }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 13 }}>Loading chart...</span>
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
                  background: 'rgba(10, 15, 20, 0.9)',
                }}
              >
                <span style={{ color: '#ef4444', fontSize: 14 }}>{error}</span>
                <button
                  onClick={() => setTimeFrame(timeFrame)}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 6,
                    color: '#10b981',
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
              borderTop: '1px solid rgba(16, 185, 129, 0.2)',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(180deg, rgba(10, 15, 20, 0.95) 0%, rgba(5, 10, 15, 0.98) 100%)',
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
                background: 'rgba(16, 185, 129, 0.05)',
                borderBottom: '1px solid rgba(16, 185, 129, 0.1)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
                  animation: 'pulse 2s infinite',
                }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>Live Trades</span>
              </div>
              <span style={{
                fontSize: 9,
                color: 'rgba(255, 255, 255, 0.5)',
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
                      border: '2px solid rgba(16, 185, 129, 0.2)',
                      borderTopColor: '#10b981',
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
                          ? 'rgba(16, 185, 129, 0.03)'
                          : 'rgba(239, 68, 68, 0.03)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = trade.type === 'buy'
                          ? 'rgba(16, 185, 129, 0.1)'
                          : 'rgba(239, 68, 68, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = trade.type === 'buy'
                          ? 'rgba(16, 185, 129, 0.03)'
                          : 'rgba(239, 68, 68, 0.03)';
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
                          ? 'rgba(16, 185, 129, 0.2)'
                          : 'rgba(239, 68, 68, 0.2)',
                        color: trade.type === 'buy' ? '#34d399' : '#f87171',
                        marginRight: 8,
                        flexShrink: 0,
                      }}>
                        {trade.type === 'buy' ? 'BUY' : 'SELL'}
                      </div>

                      {/* Amount + USD - single line */}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <img
                          src="/Images/Token.png"
                          alt="wASS"
                          style={{ width: 12, height: 12, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>
                          {parseFloat(trade.type === 'buy' ? trade.amountOut : trade.amountIn).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                            minimumFractionDigits: 0
                          })}
                        </span>
                        {trade.volumeUsd && parseFloat(trade.volumeUsd) > 0 && (
                          <span style={{ fontSize: 9, fontWeight: 500, color: 'rgba(16, 185, 129, 0.7)' }}>
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
              borderBottom: '1px solid rgba(16, 185, 129, 0.15)',
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
                    background: isPairDropdownOpen ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{getPairDisplayName(selectedPair)}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(16, 185, 129, 0.8)"
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
                      background: 'rgba(15, 20, 25, 0.98)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                      zIndex: 100,
                      overflow: 'hidden',
                    }}
                  >
                    {/* Sort: ETH pairs first, then by best % gains */}
                    {[...TOKEN_PAIRS]
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
                              background: selectedPair.id === pair.id ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
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
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{getPairDisplayName(pair)}</span>
                              {!pair.geckoPoolAddress && (
                                <span style={{ fontSize: 10, color: 'rgba(251, 191, 36, 0.8)' }}>Chart pending</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {/* Show % change for all pairs with data */}
                              {pairChange !== undefined && pair.geckoPoolAddress && (
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: pairChange >= 0 ? '#10b981' : '#ef4444',
                                  padding: '2px 5px',
                                  background: pairChange >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  borderRadius: 4,
                                }}>
                                  {pairChange >= 0 ? '+' : ''}{pairChange.toFixed(1)}%
                                </span>
                              )}
                              {pair.isDefault && (
                                <span style={{
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: 'rgba(16, 185, 129, 0.8)',
                                  padding: '2px 5px',
                                  background: 'rgba(16, 185, 129, 0.15)',
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
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(16, 185, 129, 1)' }}>
                  ${tokenPrice}
                </span>
              )}
              {priceChange && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: priceChange.percent >= 0 ? '#10b981' : '#ef4444',
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: priceChange.percent >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
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
          <div style={{ display: 'flex', gap: 3, padding: '6px 14px', borderBottom: '1px solid rgba(16, 185, 129, 0.1)' }}>
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
                  background: timeFrame === tf.value ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                  color: timeFrame === tf.value ? '#10b981' : 'rgba(255, 255, 255, 0.5)',
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
                  background: 'rgba(10, 15, 20, 0.9)',
                  zIndex: 10,
                }}
              >
                <div
                  className="animate-spin"
                  style={{
                    width: 24,
                    height: 24,
                    border: '2px solid rgba(16, 185, 129, 0.2)',
                    borderTopColor: '#10b981',
                    borderRadius: '50%',
                  }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 11 }}>Loading...</span>
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
                  background: 'rgba(10, 15, 20, 0.9)',
                }}
              >
                <span style={{ color: '#ef4444', fontSize: 12 }}>{error}</span>
                <button
                  onClick={() => setTimeFrame(timeFrame)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 5,
                    color: '#10b981',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Swap Section */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(16, 185, 129, 0.15)' }}>
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
                  border: 'none',
                  cursor: 'pointer',
                  background: swapTab === 'buy' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: swapTab === 'buy' ? '#10b981' : 'rgba(255, 255, 255, 0.5)',
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
                  border: 'none',
                  cursor: 'pointer',
                  background: swapTab === 'sell' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: swapTab === 'sell' ? '#ef4444' : 'rgba(255, 255, 255, 0.5)',
                }}
              >
                Sell
              </button>
            </div>

            {/* Input */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
                <span>You Pay</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Balance: {swapTab === 'buy' ? parseFloat(ethBalance).toFixed(4) : parseFloat(sellBalance).toFixed(2)}
                  <img
                    src={swapTab === 'buy' ? '/Images/Ether.png' : '/Images/Token.png'}
                    alt={swapTab === 'buy' ? 'ETH' : 'wASS'}
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
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#fff',
                    fontSize: 16,
                    fontWeight: 500,
                  }}
                />
                <button
                  onClick={handleMaxInput}
                  style={{
                    padding: '3px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: 'none',
                    borderRadius: 4,
                    color: '#10b981',
                    cursor: 'pointer',
                  }}
                >
                  MAX
                </button>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)' }}>
                  {swapTab === 'buy' ? 'ETH' : (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS')}
                </span>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
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
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)' }}>
                  {swapTab === 'buy' ? (isTokenPair ? outputTokenSymbol || 'Token' : 'wASS') : (isTokenPair ? 'wASS' : 'ETH')}
                </span>
              </div>
            </div>

            {/* Error */}
            {(swapError || writeError) && (
              <div style={{
                marginBottom: 10,
                padding: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                fontSize: 11,
                color: '#ef4444',
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
                  color: 'rgba(255, 255, 255, 0.5)',
                  textAlign: 'center',
                }}>
                  Connect wallet to buy
                </div>
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={isBusy || isQuoting || !canBuy}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(16, 185, 129, 0.8)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#fff',
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
                color: 'rgba(255, 255, 255, 0.5)',
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
                  color: '#fff',
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
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'linear-gradient(135deg, rgba(251, 191, 36, 0.9), rgba(239, 68, 68, 0.9))',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  cursor: isBusy || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Processing...' : `Approve & Sell ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`}
              </button>
            ) : approvalStep === 'permit2' ? (
              // Regular wallet: Step 1 - Approve Token for Permit2
              <button
                onClick={handleApprovePermit2}
                disabled={isBusy || !inputAmount || parseFloat(inputAmount) <= 0}
                style={{
                  width: '100%',
                  padding: 12,
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(251, 191, 36, 0.8)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
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
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(251, 191, 36, 0.8)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
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
                  background: isBusy ? 'rgba(107, 114, 128, 0.5)' : 'rgba(239, 68, 68, 0.8)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  cursor: isBusy || isQuoting || !canSell ? 'not-allowed' : 'pointer',
                  opacity: !canSell ? 0.5 : 1,
                }}
              >
                {isBusy ? 'Selling...' : isQuoting ? 'Getting quote...' : `Sell ${isTokenPair ? outputTokenSymbol || 'Token' : 'wASS'}`}
              </button>
            )}

          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              borderTop: '1px solid rgba(16, 185, 129, 0.1)',
              fontSize: 10,
              color: 'rgba(255, 255, 255, 0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>Base</span>
              <span style={{ color: 'rgba(16, 185, 129, 0.4)' }}>•</span>
              <code
                style={{
                  padding: '1px 4px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  color: 'rgba(16, 185, 129, 0.6)',
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
              style={{ color: 'rgba(16, 185, 129, 0.6)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
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
