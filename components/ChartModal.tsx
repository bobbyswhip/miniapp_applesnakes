'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useBalance } from 'wagmi';
import { parseEther, formatEther, formatUnits, parseUnits, encodeFunctionData, maxUint160, maxUint48 } from 'viem';
import { getContracts, QUOTER_ADDRESS, QUOTER_ABI, UNIVERSAL_ROUTER_ADDRESS, PERMIT2_ADDRESS, POOL_MANAGER_ADDRESS } from '@/config';
import { base } from 'wagmi/chains';
import { useTransactions } from '@/contexts/TransactionContext';

// V4 Command constants for Universal Router
const V4_SWAP = 0x10; // V4_SWAP command
const SWAP_EXACT_IN_SINGLE = 0x06; // Single pool exact input swap
const SETTLE_ALL = 0x0c; // Settle all tokens
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

export function ChartModal({ isOpen, onClose, tokenPrice }: ChartModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const contracts = getContracts(base.id);
  const { addTransaction, updateTransaction } = useTransactions();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('1h');
  const [priceChange, setPriceChange] = useState<{ value: number; percent: number } | null>(null);

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

  // Pool address for the wASS/ETH pair (for GeckoTerminal)
  const poolAddress = '0xa113103448f7b09199e019656f377988c87f8f312ddcebc6fea9e78bcd6ec2af';

  // Get ETH balance
  const { data: ethBalanceData } = useBalance({
    address: address,
    chainId: base.id,
  });

  // Get token balance
  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  const ethBalance = ethBalanceData ? formatEther(ethBalanceData.value) : '0';
  const tokenBalance = tokenBalanceData ? formatUnits(tokenBalanceData as bigint, 18) : '0';

  // Check ERC20 allowance for Permit2
  const { data: permit2Allowance, refetch: refetchPermit2Allowance } = useReadContract({
    address: contracts.token.address,
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
    args: address ? [address, contracts.token.address, UNIVERSAL_ROUTER_ADDRESS] : undefined,
    chainId: base.id,
  });

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
  }, [swapTab, address, inputAmount, permit2Allowance, routerAllowanceData]);

  // Fetch OHLCV data from GeckoTerminal API
  const fetchOHLCVData = useCallback(async (tf: TimeFrame): Promise<OHLCVData[]> => {
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

    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=300&currency=usd`;

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
  }, [poolAddress]);

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

  // Fetch and update data when timeframe changes
  useEffect(() => {
    if (!isOpen || !seriesRef.current) return;

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchOHLCVData(timeFrame);

        if (data.length === 0) {
          setError('No data available');
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

        if (data.length >= 2) {
          const firstPrice = data[0].open;
          const lastPrice = data[data.length - 1].close;
          const change = lastPrice - firstPrice;
          const percentChange = (change / firstPrice) * 100;
          setPriceChange({ value: change, percent: percentChange });
        }
      } catch (err) {
        console.error('Error fetching chart data:', err);
        setError('Failed to load chart data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [isOpen, timeFrame, fetchOHLCVData]);

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

        const poolKey = await publicClient.readContract({
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
            poolKey: poolKey,
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
  }, [inputAmount, swapTab, publicClient, contracts.nft.address, contracts.nft.abi]);

  // Handle successful transaction
  useEffect(() => {
    if (isSuccess && txHash) {
      updateTransaction(txHash, 'success');
      refetchTokenBalance();
      refetchPermit2Allowance();
      refetchRouterAllowance();
      setInputAmount('');
      setOutputAmount('');
      setTimeout(() => resetWrite(), 2000);
    }
  }, [isSuccess, txHash, updateTransaction, refetchTokenBalance, refetchPermit2Allowance, refetchRouterAllowance, resetWrite]);

  // Handle Buy (OTC)
  const handleBuy = () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) return;

    const ethValue = parseEther(inputAmount);
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
  };

  // Handle Permit2 Approval (Step 1: Approve Permit2 to spend tokens)
  const handleApprovePermit2 = async () => {
    if (!address) return;

    try {
      writeContract({
        address: contracts.token.address,
        abi: contracts.token.abi,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, maxUint160],
      });

      if (txHash) {
        addTransaction(txHash, 'Approving Permit2');
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
        args: [contracts.token.address, UNIVERSAL_ROUTER_ADDRESS, maxUint160, expiration],
      });

      if (txHash) {
        addTransaction(txHash, 'Approving Router');
      }
    } catch (err) {
      console.error('Router approval error:', err);
      setSwapError('Failed to approve Router');
    }
  };

  // Build V4 swap calldata
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

  // Handle Sell (Step 3: Execute V4 swap)
  const handleSell = async () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0 || !poolKey) {
      setSwapError('Invalid input or pool not loaded');
      return;
    }

    try {
      const sellAmount = parseUnits(inputAmount, 18);
      const minEthOut = outputAmount ? parseEther((parseFloat(outputAmount) * 0.95).toString()) : 0n; // 5% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

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
      setInputAmount(tokenBalance);
    }
  };

  if (!isOpen) return null;

  const timeFrameButtons: { value: TimeFrame; label: string }[] = [
    { value: '5m', label: '5M' },
    { value: '15m', label: '15M' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
  ];

  const isBusy = isPending || isConfirming;
  const canBuy = address && inputAmount && parseFloat(inputAmount) > 0 && parseFloat(inputAmount) <= parseFloat(ethBalance);
  const canSell = address && inputAmount && parseFloat(inputAmount) > 0 && parseFloat(inputAmount) <= parseFloat(tokenBalance);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full flex flex-col"
          style={{
            maxWidth: '500px',
            maxHeight: '90vh',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.03), rgba(17, 24, 39, 0.98), rgba(16, 185, 129, 0.03))',
            backgroundColor: 'rgba(10, 15, 20, 0.98)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '12px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 40px rgba(16, 185, 129, 0.15)',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
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
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>wASS/ETH</span>
              {tokenPrice && parseFloat(tokenPrice) > 0 && (
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
                  style={{
                    width: 24,
                    height: 24,
                    border: '2px solid rgba(16, 185, 129, 0.2)',
                    borderTopColor: '#10b981',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
                <span>You Pay</span>
                <span>
                  Balance: {swapTab === 'buy' ? parseFloat(ethBalance).toFixed(4) : parseFloat(tokenBalance).toFixed(2)} {swapTab === 'buy' ? 'ETH' : 'wASS'}
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
                  {swapTab === 'buy' ? 'ETH' : 'wASS'}
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
                  {swapTab === 'buy' ? 'wASS' : 'ETH'}
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
                  {isBusy ? 'Buying...' : isQuoting ? 'Getting quote...' : 'Buy wASS'}
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
            ) : approvalStep === 'permit2' ? (
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
                {isBusy ? 'Selling...' : isQuoting ? 'Getting quote...' : 'Sell wASS'}
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
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
