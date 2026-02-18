'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, usePublicClient, useWriteContract, useSendTransaction } from 'wagmi';
import { encodeFunctionData, maxUint160 } from 'viem';
import { base } from 'wagmi/chains';
import { useTokenMigration, type DetectedToken } from '@/hooks/useTokenMigration';
import { useTransactions } from '@/contexts/TransactionContext';
import {
  WASS_TOKEN_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS,
  PERMIT2_ADDRESS,
  MIGRATION_TARGET_TOKEN,
  HOOK_ADDRESS,
  QUOTER_ADDRESS,
} from '@/config/contracts';
import { ERC20_ABI } from '@/abis/erc20';
import { QUOTER_ABI } from '@/abis/quoter';

// Universal Router command for V4 swap
const V4_SWAP = 0x10;

// V4 Router action types
const SWAP_EXACT_IN = 0x07;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

// ETH = address(0) in V4
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Permit2 ABI
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

// Universal Router ABI
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

type SwapStatus = 'idle' | 'quoting' | 'approving' | 'swapping' | 'done' | 'error';

interface TokenSwapState {
  token: DetectedToken;
  selected: boolean;
  status: SwapStatus;
  error?: string;
  txHash?: string;
}

export function MigrationModal() {
  const { address } = useAccount();
  const { detectedTokens, shouldShowModal, dismiss } = useTokenMigration();
  const { addTransaction, updateTransaction } = useTransactions();
  const publicClient = usePublicClient({ chainId: base.id });
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [tokenStates, setTokenStates] = useState<TokenSwapState[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);

  useEffect(() => {
    if (detectedTokens.length > 0) {
      setTokenStates(
        detectedTokens.map((token) => ({
          token,
          selected: true,
          status: 'idle',
        }))
      );
    }
  }, [detectedTokens]);

  const toggleToken = useCallback((index: number) => {
    if (isProcessing) return;
    setTokenStates((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s))
    );
  }, [isProcessing]);

  const updateTokenStatus = useCallback(
    (index: number, update: Partial<TokenSwapState>) => {
      setTokenStates((prev) =>
        prev.map((s, i) => (i === index ? { ...s, ...update } : s))
      );
    },
    []
  );

  const hasErrors = tokenStates.some((s) => s.status === 'error');

  const retryFailed = useCallback(() => {
    setTokenStates((prev) =>
      prev.map((s) => (s.status === 'error' ? { ...s, status: 'idle' as SwapStatus, error: undefined } : s))
    );
  }, []);

  // Get V4 quote for ZORA → ETH (single hop)
  const getZoraEthQuote = useCallback(async (amountIn: bigint): Promise<bigint> => {
    if (!publicClient) return 0n;

    const zoraAddr = MIGRATION_TARGET_TOKEN as `0x${string}`;
    const result = await publicClient.simulateContract({
      address: QUOTER_ADDRESS,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: {
          currency0: ETH_ADDRESS,
          currency1: zoraAddr,
          fee: 3000,
          tickSpacing: 60,
          hooks: ETH_ADDRESS,
        },
        zeroForOne: false,
        exactAmount: amountIn,
        hookData: '0x',
      }],
    });
    return (result.result as [bigint, bigint])[0];
  }, [publicClient]);

  // Get V4 quote for ETH → wASS (single hop)
  const getEthWassQuote = useCallback(async (amountIn: bigint): Promise<bigint> => {
    if (!publicClient) return 0n;

    const wassAddr = WASS_TOKEN_ADDRESS as `0x${string}`;
    const result = await publicClient.simulateContract({
      address: QUOTER_ADDRESS,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: {
          currency0: ETH_ADDRESS,
          currency1: wassAddr,
          fee: 3000,
          tickSpacing: 60,
          hooks: HOOK_ADDRESS as `0x${string}`,
        },
        zeroForOne: true,
        exactAmount: amountIn,
        hookData: '0x',
      }],
    });
    return (result.result as [bigint, bigint])[0];
  }, [publicClient]);

  // Build V4 swap calldata for ZORA → ETH → wASS (2-hop)
  const buildZoraSwapCalldata = useCallback((
    amountIn: bigint,
    minAmountOut: bigint,
  ): { commands: `0x${string}`; inputs: `0x${string}`[] } => {
    const zoraAddr = MIGRATION_TARGET_TOKEN as `0x${string}`;
    const wassAddr = WASS_TOKEN_ADDRESS as `0x${string}`;

    const actions = new Uint8Array([SWAP_EXACT_IN, SETTLE_ALL, TAKE_ALL]);

    const pathKeys = [
      {
        intermediateCurrency: ETH_ADDRESS,
        fee: 3000,
        tickSpacing: 60,
        hooks: ETH_ADDRESS,
        hookData: '0x' as `0x${string}`,
      },
      {
        intermediateCurrency: wassAddr,
        fee: 3000,
        tickSpacing: 60,
        hooks: HOOK_ADDRESS as `0x${string}`,
        hookData: '0x' as `0x${string}`,
      },
    ];

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
        currencyIn: zoraAddr,
        path: pathKeys,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
      }],
    });
    const swapParamsData = ('0x' + swapParams.slice(10)) as `0x${string}`;

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
      args: [zoraAddr, amountIn],
    });
    const settleParamsData = ('0x' + settleParams.slice(10)) as `0x${string}`;

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
      args: [wassAddr, minAmountOut],
    });
    const takeParamsData = ('0x' + takeParams.slice(10)) as `0x${string}`;

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

  const swapAll = useCallback(async () => {
    if (!address || isProcessing || !publicClient) return;

    const selectedIdle = tokenStates.filter((s) => s.selected && s.status === 'idle');
    if (selectedIdle.length === 0) return;

    setIsProcessing(true);

    for (let i = 0; i < tokenStates.length; i++) {
      if (!tokenStates[i].selected || tokenStates[i].status !== 'idle') continue;

      const { token } = tokenStates[i];
      setCurrentIndex(i);

      try {
        const amountIn = BigInt(token.balance);

        // Step 1: Quote ZORA → ETH → wASS
        updateTokenStatus(i, { status: 'quoting' });
        console.log('[Migration] Getting V4 quote for', token.symbol, 'balance:', token.balanceFormatted);

        const ethOut = await getZoraEthQuote(amountIn);
        if (ethOut === 0n) {
          updateTokenStatus(i, { status: 'error', error: 'No ZORA/ETH route' });
          continue;
        }
        const estimatedOut = await getEthWassQuote(ethOut);
        if (estimatedOut === 0n) {
          updateTokenStatus(i, { status: 'error', error: 'No ETH/wASS route' });
          continue;
        }
        console.log(`[Migration] ZORA route: ${token.symbol} → ${ethOut} ETH → ${estimatedOut} wASS`);
        const minAmountOut = (estimatedOut * 95n) / 100n; // 5% slippage
        const swapCalldata = buildZoraSwapCalldata(amountIn, minAmountOut);

        // Step 2: Approvals
        updateTokenStatus(i, { status: 'approving' });

        const erc20Allowance = await publicClient.readContract({
          address: token.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, PERMIT2_ADDRESS],
        }) as bigint;

        if (erc20Allowance < amountIn) {
          const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
          const approveHash = await writeContractAsync({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [PERMIT2_ADDRESS, maxUint256],
            chainId: base.id,
          });
          addTransaction(approveHash, `Approve ${token.symbol} for Permit2`);
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, approveReceipt.status === 'success' ? 'success' : 'error');
        }

        const [permit2Amount, permit2Expiration] = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: PERMIT2_ABI,
          functionName: 'allowance',
          args: [address, token.address, UNIVERSAL_ROUTER_ADDRESS],
        }) as [bigint, number, number];

        const now = Math.floor(Date.now() / 1000);
        if (permit2Amount < amountIn || permit2Expiration < now) {
          const expiration = now + 2592000;
          const permit2Hash = await writeContractAsync({
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ABI,
            functionName: 'approve',
            args: [token.address, UNIVERSAL_ROUTER_ADDRESS, maxUint160, expiration],
            chainId: base.id,
          });
          addTransaction(permit2Hash, `Permit2 approve ${token.symbol}`);
          const permit2Receipt = await publicClient.waitForTransactionReceipt({ hash: permit2Hash });
          updateTransaction(permit2Hash, permit2Receipt.status === 'success' ? 'success' : 'error');
        }

        // Step 3: Execute V4 swap
        updateTokenStatus(i, { status: 'swapping' });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

        const swapHash = await sendTransactionAsync({
          to: UNIVERSAL_ROUTER_ADDRESS,
          data: encodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            functionName: 'execute',
            args: [swapCalldata.commands, swapCalldata.inputs, deadline],
          }),
        });

        addTransaction(swapHash, `Swap ${token.symbol} → wASS (V4)`);
        const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
        updateTransaction(swapHash, swapReceipt.status === 'success' ? 'success' : 'error');
        updateTokenStatus(i, {
          status: swapReceipt.status === 'success' ? 'done' : 'error',
          txHash: swapHash,
          ...(swapReceipt.status !== 'success' ? { error: 'Transaction reverted' } : {}),
        });

      } catch (err) {
        console.error(`[Migration] Error for ${token.symbol}:`, err);
        const msg = err instanceof Error ? err.message : 'Swap failed';
        const shortMsg = msg.includes('User rejected') ? 'User rejected' :
                         msg.includes('denied') ? 'User denied' :
                         msg.length > 60 ? msg.slice(0, 57) + '...' : msg;
        updateTokenStatus(i, { status: 'error', error: shortMsg });
      }
    }

    setIsProcessing(false);
    setCurrentIndex(-1);
  }, [
    address,
    isProcessing,
    tokenStates,
    publicClient,
    getZoraEthQuote,
    getEthWassQuote,
    buildZoraSwapCalldata,
    writeContractAsync,
    sendTransactionAsync,
    addTransaction,
    updateTransaction,
    updateTokenStatus,
  ]);

  const allDone = tokenStates.length > 0 && tokenStates.every(
    (s) => !s.selected || s.status === 'done' || s.status === 'error'
  );
  const allSuccess = tokenStates.length > 0 && tokenStates.every(
    (s) => !s.selected || s.status === 'done'
  );

  if (!shouldShowModal) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        style={{ animation: 'fadeIn 0.3s ease-out' }}
        onClick={!isProcessing ? dismiss : undefined}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto max-w-lg w-full rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #1e2726 0%, #171e1d 100%)',
            boxShadow: '0 0 40px rgba(255, 208, 117, 0.2), inset 0 0 60px rgba(255, 208, 117, 0.03)',
            border: '2px solid rgba(255, 208, 117, 0.15)',
            animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative overflow-hidden p-5 pb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 208, 117, 0.1) 0%, rgba(197, 169, 123, 0.08) 100%)',
              borderBottom: '1px solid rgba(255, 208, 117, 0.15)',
            }}
          >
            <div className="relative text-center">
              <h2
                className="text-xl font-bold mb-1"
                style={{
                  background: 'linear-gradient(135deg, #ffd075 0%, #c5a97b 50%, #a68b5b 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Token Migration Available
              </h2>
              <p className="text-xs text-[#8a9090]">
                Swap ZORA into wASS via Uniswap V4
              </p>
            </div>
          </div>

          <div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">
            {tokenStates.map((state, index) => (
              <TokenRow
                key={state.token.address}
                state={state}
                index={index}
                isProcessing={isProcessing}
                isCurrent={currentIndex === index}
                onToggle={toggleToken}
              />
            ))}
          </div>

          <div className="p-4 pt-2 space-y-3" style={{ borderTop: '1px solid rgba(255, 208, 117, 0.1)' }}>
            {allDone ? (
              <div className="space-y-2">
                {hasErrors && (
                  <button
                    onClick={retryFailed}
                    className="w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-200"
                    style={{
                      background: 'rgba(255, 59, 92, 0.1)',
                      color: '#FF3B5C',
                      border: '1px solid rgba(255, 59, 92, 0.3)',
                    }}
                  >
                    Retry Failed
                  </button>
                )}
                <button
                  onClick={dismiss}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-[#0a0d0c] transition-all duration-200"
                  style={{
                    background: 'linear-gradient(135deg, #ffd075 0%, #c5a97b 100%)',
                    border: '1px solid rgba(255, 208, 117, 0.3)',
                  }}
                >
                  {allSuccess ? 'Done' : 'Close'}
                </button>
              </div>
            ) : (
              <button
                onClick={swapAll}
                disabled={isProcessing || tokenStates.every((s) => !s.selected || s.status !== 'idle')}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isProcessing
                    ? 'rgba(255, 208, 117, 0.1)'
                    : 'linear-gradient(135deg, #ffd075 0%, #c5a97b 100%)',
                  color: isProcessing ? '#ffd075' : '#0a0d0c',
                  border: '1px solid rgba(255, 208, 117, 0.3)',
                }}
              >
                {isProcessing ? 'Swapping...' : 'Swap ZORA → wASS'}
              </button>
            )}

            {!isProcessing && !allDone && (
              <button
                onClick={dismiss}
                className="w-full text-xs text-[#6b7575] hover:text-[#8a9090] transition-colors py-1"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}

function TokenRow({
  state,
  index,
  isProcessing,
  isCurrent,
  onToggle,
}: {
  state: TokenSwapState;
  index: number;
  isProcessing: boolean;
  isCurrent: boolean;
  onToggle: (index: number) => void;
}) {
  const { token, selected, status, error: swapError } = state;

  const statusLabel = {
    idle: '',
    quoting: 'Finding route...',
    approving: 'Approving...',
    swapping: 'Swapping...',
    done: 'Swapped!',
    error: swapError || 'Failed',
  }[status];

  const statusColor = {
    idle: '',
    quoting: '#ffd075',
    approving: '#ffd075',
    swapping: '#ffd075',
    done: '#22c55e',
    error: '#FF3B5C',
  }[status];

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer"
      style={{
        background: selected ? 'rgba(255, 208, 117, 0.06)' : 'rgba(255, 255, 255, 0.02)',
        border: `1px solid ${
          isCurrent
            ? 'rgba(255, 208, 117, 0.4)'
            : selected
            ? 'rgba(255, 208, 117, 0.15)'
            : 'rgba(255, 255, 255, 0.05)'
        }`,
      }}
      onClick={() => onToggle(index)}
    >
      <div
        className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center"
        style={{
          background: selected ? 'linear-gradient(135deg, #ffd075, #c5a97b)' : 'rgba(255, 255, 255, 0.08)',
          border: selected ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
        }}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="#0a0d0c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-white truncate">{token.symbol}</span>
        <p className="text-xs text-[#6b7575] truncate">{token.name}</p>
      </div>

      <div className="text-right flex-shrink-0">
        {status === 'idle' ? (
          <span className="text-sm text-[#e0e0e0] font-mono">{token.balanceFormatted}</span>
        ) : (
          <span className="text-xs font-medium" style={{ color: statusColor }}>{statusLabel}</span>
        )}
      </div>
    </div>
  );
}
