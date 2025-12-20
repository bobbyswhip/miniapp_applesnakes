// Hydrex uses KyberSwap Meta Aggregation Router V2 for swaps
// Router address on Base: 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5
// https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator

export const KYBERSWAP_ROUTER_ADDRESS = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as const;

// KyberSwap API endpoint for Base chain
export const KYBERSWAP_API_BASE = 'https://aggregator-api.kyberswap.com/base/api/v1' as const;

// Native token address used by KyberSwap
export const KYBERSWAP_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

// Hydrex pool ABI (same as Aerodrome/Solidly ve(3,3) pools)
export const HYDREX_POOL_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: '_reserve0', type: 'uint256' },
      { name: '_reserve1', type: 'uint256' },
      { name: '_blockTimestampLast', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'stable',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Direct quote function on pool
  {
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenIn', type: 'address' },
    ],
    name: 'getAmountOut',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// KyberSwap Meta Aggregation Router V2 ABI (partial - swap functions)
export const KYBERSWAP_ROUTER_ABI = [
  // swap function with execution params
  {
    inputs: [
      {
        components: [
          { name: 'callTarget', type: 'address' },
          { name: 'approveTarget', type: 'address' },
          { name: 'targetData', type: 'bytes' },
          {
            components: [
              { name: 'srcToken', type: 'address' },
              { name: 'dstToken', type: 'address' },
              { name: 'srcReceivers', type: 'address[]' },
              { name: 'srcAmounts', type: 'uint256[]' },
              { name: 'feeReceivers', type: 'address[]' },
              { name: 'feeAmounts', type: 'uint256[]' },
              { name: 'dstReceiver', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'minReturnAmount', type: 'uint256' },
              { name: 'flags', type: 'uint256' },
              { name: 'permit', type: 'bytes' },
            ],
            name: 'desc',
            type: 'tuple',
          },
          { name: 'clientData', type: 'bytes' },
        ],
        name: 'execution',
        type: 'tuple',
      },
    ],
    name: 'swap',
    outputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'gasUsed', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  // swapSimpleMode - simpler interface
  {
    inputs: [
      { name: 'caller', type: 'address' },
      {
        components: [
          { name: 'srcToken', type: 'address' },
          { name: 'dstToken', type: 'address' },
          { name: 'srcReceivers', type: 'address[]' },
          { name: 'srcAmounts', type: 'uint256[]' },
          { name: 'feeReceivers', type: 'address[]' },
          { name: 'feeAmounts', type: 'uint256[]' },
          { name: 'dstReceiver', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'minReturnAmount', type: 'uint256' },
          { name: 'flags', type: 'uint256' },
          { name: 'permit', type: 'bytes' },
        ],
        name: 'desc',
        type: 'tuple',
      },
      { name: 'executorData', type: 'bytes' },
      { name: 'clientData', type: 'bytes' },
    ],
    name: 'swapSimpleMode',
    outputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'gasUsed', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

// Types for KyberSwap API responses
export interface KyberSwapRouteResponse {
  code: number;
  message: string;
  data?: {
    routeSummary: KyberSwapRouteSummary;
    routerAddress: string;
  };
}

export interface KyberSwapRouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasPrice: string;
  gasUsd: string;
  extraFee: {
    feeAmount: string;
    chargeFeeBy: string;
    isInBps: boolean;
    feeReceiver: string;
  };
  route: Array<Array<{
    pool: string;
    tokenIn: string;
    tokenOut: string;
    limitReturnAmount: string;
    swapAmount: string;
    amountOut: string;
    exchange: string;
    poolLength: number;
    poolType: string;
    poolExtra: unknown;
    extra: unknown;
  }>>;
}

export interface KyberSwapBuildResponse {
  code: number;
  message: string;
  data?: {
    amountIn: string;
    amountInUsd: string;
    amountOut: string;
    amountOutUsd: string;
    gas: string;
    gasUsd: string;
    outputChange: {
      amount: string;
      percent: number;
      level: number;
    };
    data: string; // Encoded calldata for the swap
    routerAddress: string;
  };
}

// Helper to get KyberSwap quote
export async function getKyberSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageTolerance: number = 50 // 0.5% default
): Promise<KyberSwapRouteResponse> {
  // Use native token address for ETH
  const inputToken = tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? KYBERSWAP_NATIVE_TOKEN
    : tokenIn;
  const outputToken = tokenOut.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? KYBERSWAP_NATIVE_TOKEN
    : tokenOut;

  const params = new URLSearchParams({
    tokenIn: inputToken,
    tokenOut: outputToken,
    amountIn,
    slippageTolerance: slippageTolerance.toString(),
    gasInclude: 'true',
  });

  const response = await fetch(`${KYBERSWAP_API_BASE}/routes?${params}`, {
    headers: {
      'x-client-id': 'applesnakes',
    },
  });

  return response.json();
}

// Helper to build swap transaction
export async function buildKyberSwapTransaction(
  routeSummary: KyberSwapRouteSummary,
  sender: string,
  recipient: string,
  slippageTolerance: number = 50,
  deadline?: number
): Promise<KyberSwapBuildResponse> {
  const body: Record<string, unknown> = {
    routeSummary,
    sender,
    recipient,
    slippageTolerance,
  };

  if (deadline) {
    body.deadline = deadline;
  }

  const response = await fetch(`${KYBERSWAP_API_BASE}/route/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': 'applesnakes',
    },
    body: JSON.stringify(body),
  });

  return response.json();
}
