'use client';

import { parseUnits, formatUnits } from 'viem';
import type { WalletClient } from 'viem';

// USDC on Base Mainnet
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// EIP-712 Domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS,
} as const;

// EIP-712 Types for TransferWithAuthorization (EIP-3009)
const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset?: string;
  description?: string;
}

interface CustomizeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  tokenId?: number;
  traitChanges?: Record<string, string>;
  result?: {
    normal?: { imageCid: string; metadataCid: string };
    jailed?: { imageCid: string; metadataCid: string };
    published?: boolean;
    bucketCid?: string;
  };
}

/**
 * Generate a random 32-byte nonce
 */
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Create x402 payment header using EIP-3009 signature
 */
async function createX402Payment(
  requirements: PaymentRequirements,
  walletClient: WalletClient
): Promise<string> {
  const account = walletClient.account;
  if (!account) throw new Error('No account in wallet client');

  const now = Math.floor(Date.now() / 1000);
  const nonce = generateNonce();

  const authorization = {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: BigInt(now - 60), // Valid from 1 minute ago (clock skew buffer)
    validBefore: BigInt(now + (requirements.maxTimeoutSeconds || 3600)),
    nonce: nonce,
  };

  console.log('[x402] Signing authorization:', {
    from: authorization.from,
    to: authorization.to,
    amount: `$${formatUnits(authorization.value, USDC_DECIMALS)} USDC`,
    validAfter: new Date(Number(authorization.validAfter) * 1000).toISOString(),
    validBefore: new Date(Number(authorization.validBefore) * 1000).toISOString(),
  });

  // Sign with EIP-712 typed data
  const signature = await walletClient.signTypedData({
    account: account.address,
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });

  console.log('[x402] Authorization signed (gasless)');

  // Build x402 payload
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature: signature,
      authorization: {
        from: authorization.from.toLowerCase(),
        to: authorization.to.toLowerCase(),
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  };

  // Base64 encode
  return btoa(JSON.stringify(payload));
}

/**
 * Customize NFT traits with x402 payment
 * Cost: $0.01 USDC per update
 */
export async function customizeWithX402Payment(
  tokenId: number,
  traits: Record<string, string>,
  type: 'human' | 'snake',
  walletClient: WalletClient,
  autoPublish: boolean = true
): Promise<CustomizeResult> {
  const endpoint = '/api/nft/customize/x402';

  try {
    const requestBody = JSON.stringify({
      tokenId,
      type,
      traits,
      autoPublish,
    });

    console.log('[x402] Requesting customize for NFT #' + tokenId);

    // Step 1: Make initial request (will return 402)
    const initialResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });

    // Step 2: If 402, create payment and retry
    if (initialResponse.status === 402) {
      const body = await initialResponse.json();
      const requirements = body.paymentRequirements as PaymentRequirements;

      if (!requirements) {
        return { success: false, error: 'Failed to parse payment requirements' };
      }

      console.log('[x402] Payment required:', {
        amount: `$${formatUnits(BigInt(requirements.maxAmountRequired), USDC_DECIMALS)} USDC`,
        payTo: requirements.payTo,
      });

      const paymentHeader = await createX402Payment(requirements, walletClient);

      console.log('[x402] Submitting with payment...');

      // Step 3: Retry with payment
      const paidResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: requestBody,
      });

      if (paidResponse.ok) {
        const result = await paidResponse.json();
        console.log('[x402] Success:', result);
        return {
          success: true,
          txHash: result.payment?.txHash,
          tokenId: result.tokenId,
          traitChanges: result.traitChanges,
          result: result.result,
        };
      } else {
        const error = await paidResponse.json();
        console.error('[x402] Payment failed:', error);
        return { success: false, error: error.error || error.reason || 'Payment failed' };
      }
    }

    // Handle non-402 responses
    if (initialResponse.ok) {
      const result = await initialResponse.json();
      return {
        success: true,
        tokenId: result.tokenId,
        traitChanges: result.traitChanges,
        result: result.result,
      };
    } else {
      const error = await initialResponse.json();
      return { success: false, error: error.error || 'Request failed' };
    }
  } catch (error) {
    console.error('[x402] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get USDC balance for an address
 */
export async function getUSDCBalance(address: string): Promise<string> {
  try {
    // Use Base RPC to get USDC balance
    const response = await fetch('https://mainnet.base.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: USDC_ADDRESS,
            data: `0x70a08231000000000000000000000000${address.slice(2)}`, // balanceOf(address)
          },
          'latest',
        ],
        id: 1,
      }),
    });
    const data = await response.json();
    const balance = BigInt(data.result || '0x0');
    return formatUnits(balance, USDC_DECIMALS);
  } catch {
    return '0';
  }
}

/**
 * Check if user has enough USDC for customize
 */
export async function hasEnoughUSDC(address: string, amount: string = '0.01'): Promise<boolean> {
  const balance = await getUSDCBalance(address);
  return parseFloat(balance) >= parseFloat(amount);
}

// Configuration export
export const X402_CUSTOMIZE_CONFIG = {
  network: 'base' as const,
  currency: 'USDC',
  price: '0.01',
  priceDisplay: '$0.01',
  usdcAddress: USDC_ADDRESS,
  usdcDecimals: USDC_DECIMALS,
  endpoint: '/api/nft/customize/x402',
};
