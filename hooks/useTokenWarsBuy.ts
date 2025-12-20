/**
 * useTokenWarsBuy - x402 Payment Hook for Token Wars
 *
 * Correct x402 flow:
 * 1. POST to endpoint → get 402 with payment requirements + sale capacity
 * 2. User signs EIP-3009 TransferWithAuthorization (NO on-chain tx!)
 * 3. Retry SAME endpoint with X-PAYMENT header containing signed authorization
 * 4. SERVER executes transferWithAuthorization and records the buy
 *
 * The frontend does NOT execute USDC transfers - only signs authorizations.
 * The server executes the actual transfer using the signed authorization.
 *
 * Sale Capacity Feature:
 * - Backend may cap the buy amount if approaching sale target
 * - Always use x402.amount (actual) not requested amount
 * - Check x402.wasCapped to inform user of adjustments
 */
'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { base } from 'viem/chains';
import { formatUnits } from 'viem';
import type { DexVote, PairVote } from '@/types/token-wars';

// =============================================================================
// Types
// =============================================================================

export interface SaleInfo {
  id: string;
  name: string;
  totalRaised: number;
  targetAmount: number | null;
  remainingCapacity: number;
  maxBuyAmount: number;
  percentComplete: number | null;
  isSoldOut: boolean;
}

export interface SelloutStatus {
  isSoldOut: boolean;
  readyToLaunch: boolean;
  action: 'none' | 'extended' | 'ready_to_launch' | 'already_processed';
  message: string;
}

export interface BuyResult {
  success: boolean;
  message?: string;
  buy?: {
    warId: string;
    amount: number;
    txHash: string;
    wallet: string;
    timestamp: number;
    dexVote: string;
    pairVote: string;
  };
  war?: {
    id: string;
    name: string;
    symbol: string;
    totalRaised: number;
    targetAmount: number | null;
    participantCount: number;
    endsAt: number;
    timeRemainingMs: number;
    status: string;
    tokenAddress?: string;
    imageUrl?: string;
  };
  wallet?: {
    totalContribution: number;
    sharePercent: number;
  };
  consensus?: {
    dex: {
      leading: string;
      v4: { votes: number; percent: number };
      aerodrome: { votes: number; percent: number };
      hydrex: { votes: number; percent: number };
      isTie: boolean;
    };
    pair: {
      leading: string;
      eth: { votes: number; percent: number };
      wass: { votes: number; percent: number };
      isTie: boolean;
    };
    totalVotes: number;
  };
  sellout?: SelloutStatus;
  error?: string;
}

interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset?: string;
}

interface X402Info {
  version: number;
  appName: string;
  amount: number;
  currency: string;
  requestedAmount?: number;
  wasCapped?: boolean;
  cappedReason?: string;
}

export type BuyStatus =
  | 'idle'
  | 'requesting'
  | 'signing'
  | 'submitting'
  | 'success'
  | 'error';

// =============================================================================
// Constants
// =============================================================================

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// EIP-712 domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS as `0x${string}`,
} as const;

// EIP-3009 TransferWithAuthorization types
const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// Production API
const API_BASE = 'https://api.applesnakes.com';

// USDC balance ABI
const BALANCE_ABI = [{
  inputs: [{ name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate a random 32-byte nonce for EIP-3009
 */
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

/**
 * Parse payment requirements from a 402 response
 * Handles different response formats from the server
 */
function parsePaymentRequirements(responseBody: Record<string, unknown>): PaymentRequirements | null {
  // Format 1: Standard x402 with 'accepts' array
  if (responseBody.accepts && Array.isArray(responseBody.accepts) && responseBody.accepts.length > 0) {
    const requirement = responseBody.accepts.find(
      (req: PaymentRequirements) => req.scheme === 'exact' && req.network === 'base'
    ) || responseBody.accepts[0];

    if (requirement?.maxAmountRequired) {
      return requirement;
    }
  }

  // Format 2: Our custom format with 'paymentRequirements' object
  const paymentReqs = responseBody.paymentRequirements as PaymentRequirements | undefined;
  if (paymentReqs?.maxAmountRequired) {
    return paymentReqs;
  }

  // Format 3: Direct payment requirements in body
  if (responseBody.maxAmountRequired) {
    return responseBody as unknown as PaymentRequirements;
  }

  console.error('[x402] Could not parse payment requirements:', responseBody);
  return null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useTokenWarsBuy() {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: base.id });

  const [status, setStatus] = useState<BuyStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);

  // Sale capacity state
  const [saleInfo, setSaleInfo] = useState<SaleInfo | null>(null);
  const [wasCapped, setWasCapped] = useState(false);
  const [cappedReason, setCappedReason] = useState<string | null>(null);
  const [actualAmount, setActualAmount] = useState<number | null>(null);

  /**
   * Get USDC balance for the connected wallet
   */
  const getUSDCBalance = useCallback(async (): Promise<number> => {
    if (!address || !publicClient) return 0;

    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      return parseFloat(formatUnits(balance, USDC_DECIMALS));
    } catch {
      return 0;
    }
  }, [address, publicClient]);

  /**
   * Fetch sale capacity info without buying
   * Use this to show remaining capacity in the UI before user enters amount
   */
  const fetchSaleInfo = useCallback(async (warId: string): Promise<SaleInfo | null> => {
    try {
      // Request with amount=1 just to get sale info
      const response = await fetch(
        `${API_BASE}/api/token-wars/buy/x402?amount=1`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warId,
            dexVote: 'aerodrome', // Doesn't matter for info fetch
            pairVote: 'eth'
          })
        }
      );

      if (response.status === 402) {
        const data = await response.json();
        if (data.sale) {
          setSaleInfo(data.sale);
          return data.sale;
        }
      } else if (response.status === 400) {
        const data = await response.json();
        // Sale might be sold out
        if (data.sale) {
          setSaleInfo(data.sale);
          return data.sale;
        }
      }
      return null;
    } catch (err) {
      console.error('[TokenWarsBuy] Failed to fetch sale info:', err);
      return null;
    }
  }, []);

  /**
   * Execute buy with x402 payment flow
   * Frontend signs authorization, SERVER executes the transfer
   */
  const buyIn = useCallback(async (params: {
    warId: string;
    amountUsdc: number;
    dexVote: DexVote;
    pairVote: PairVote;
  }): Promise<BuyResult | null> => {
    const { warId, amountUsdc, dexVote, pairVote } = params;

    if (!isConnected || !walletClient || !address) {
      const err = 'Please connect your wallet';
      setError(err);
      setStatus('error');
      return null;
    }

    if (chain?.id !== base.id) {
      const err = 'Please switch to Base network';
      setError(err);
      setStatus('error');
      return null;
    }

    // Validate amount
    const requestedAmount = Math.floor(amountUsdc);
    if (requestedAmount < 1 || requestedAmount > 10000) {
      const err = 'Amount must be between $1 and $10,000';
      setError(err);
      setStatus('error');
      return null;
    }

    // Check USDC balance
    const balance = await getUSDCBalance();
    if (balance < requestedAmount) {
      const err = `Insufficient USDC balance. You have $${balance.toFixed(2)}`;
      setError(err);
      setStatus('error');
      return null;
    }

    setStatus('requesting');
    setStatusMessage('Requesting payment requirements...');
    setError(null);
    setResult(null);
    setWasCapped(false);
    setCappedReason(null);
    setActualAmount(null);

    const requestBody = JSON.stringify({ warId, dexVote, pairVote });

    try {
      // =========================================================================
      // STEP 1: Initial request to get payment requirements (402 response)
      // =========================================================================
      console.log(`[TokenWarsBuy] Step 1: Requesting $${requestedAmount} buy...`);

      const initialResponse = await fetch(
        `${API_BASE}/api/token-wars/buy/x402?amount=${requestedAmount}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        }
      );

      console.log('[TokenWarsBuy] Response status:', initialResponse.status);

      // Handle 400 errors (sold out, insufficient capacity)
      if (initialResponse.status === 400) {
        const errorData = await initialResponse.json();

        // Update sale info if present
        if (errorData.sale) {
          setSaleInfo(errorData.sale);
        }

        // Check if sold out
        if (errorData.sale?.isSoldOut) {
          const err = errorData.message || 'This Token War is sold out!';
          setError(err);
          setStatus('error');
          return { success: false, error: err, message: err };
        }

        // Other validation errors
        const err = errorData.message || errorData.error || 'Validation error';
        setError(err);
        setStatus('error');
        return { success: false, error: err, message: err };
      }

      // If not 402, either already success or an error
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (data.success) {
          setResult(data);
          setStatus('success');
          setStatusMessage('Successfully joined the Token War!');
          return data;
        } else {
          throw new Error(data.error || 'Request failed');
        }
      }

      // =========================================================================
      // STEP 2: Parse 402 response for payment requirements
      // =========================================================================
      const paymentData = await initialResponse.json();
      console.log('[TokenWarsBuy] 402 response:', paymentData);

      const paymentRequirements = parsePaymentRequirements(paymentData);
      if (!paymentRequirements) {
        throw new Error('Invalid payment requirements from server. Response: ' + JSON.stringify(paymentData));
      }

      // Extract sale info
      const sale = paymentData.sale as SaleInfo | undefined;
      if (sale) {
        setSaleInfo(sale);
      }

      // Extract x402 info (includes capping info)
      const x402 = paymentData.x402 as X402Info | undefined;

      // IMPORTANT: Check if amount was capped
      if (x402?.wasCapped) {
        setWasCapped(true);
        setCappedReason(x402.cappedReason || 'Amount adjusted to remaining capacity');
        console.log(`[TokenWarsBuy] Amount capped: $${x402.requestedAmount} → $${x402.amount}`);
        console.log(`[TokenWarsBuy] Reason: ${x402.cappedReason}`);
      }

      // CRITICAL: Use the ACTUAL amount from server (may be capped)
      const finalAmount = x402?.amount ?? requestedAmount;
      setActualAmount(finalAmount);

      console.log(`[TokenWarsBuy] Final amount: $${finalAmount}`);
      console.log('[TokenWarsBuy] Payment requirements:', paymentRequirements);

      // Display amount to user
      const requiredAmount = formatUnits(
        BigInt(paymentRequirements.maxAmountRequired),
        USDC_DECIMALS
      );

      // =========================================================================
      // STEP 3: Sign EIP-3009 TransferWithAuthorization (NO on-chain tx!)
      // =========================================================================
      console.log('[TokenWarsBuy] Step 2: Signing authorization...');
      setStatus('signing');
      setStatusMessage(`Sign payment of $${parseFloat(requiredAmount).toFixed(2)} USDC in your wallet...`);

      const atomicAmount = BigInt(paymentRequirements.maxAmountRequired);
      const nonce = generateNonce();
      const now = Math.floor(Date.now() / 1000);

      // Use clock skew tolerance for validAfter
      const validAfter = BigInt(now - 60); // Valid from 1 minute ago
      const validBefore = BigInt(now + (paymentRequirements.maxTimeoutSeconds || 3600));

      // CRITICAL: Use lowercase addresses for BOTH signing AND payload
      // This ensures the backend can recover the exact same signer
      const fromAddress = address.toLowerCase() as `0x${string}`;
      const toAddress = paymentRequirements.payTo.toLowerCase() as `0x${string}`;

      const message = {
        from: fromAddress,
        to: toAddress,
        value: atomicAmount,
        validAfter,
        validBefore,
        nonce,
      };

      console.log('[TokenWarsBuy] Signing authorization for:', {
        from: fromAddress,
        to: toAddress,
        value: atomicAmount.toString(),
        amount: `$${parseFloat(requiredAmount).toFixed(2)} USDC`,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce: nonce,
      });

      // Sign the authorization - this does NOT execute any on-chain transaction!
      // User just signs a message authorizing the server to transfer USDC
      const signature = await walletClient.signTypedData({
        account: address,
        domain: USDC_DOMAIN,
        types: TRANSFER_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
      });

      console.log('[TokenWarsBuy] Authorization signed (no on-chain tx)');

      // =========================================================================
      // STEP 4: Retry with X-PAYMENT header - SERVER executes transfer
      // =========================================================================
      console.log('[TokenWarsBuy] Step 3: Submitting to server...');
      setStatus('submitting');
      setStatusMessage('Submitting payment and recording buy...');

      // Build x402 payment payload (all numeric values as strings per spec)
      // Use the EXACT same values that were signed
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: fromAddress,
            to: toAddress,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      console.log('[TokenWarsBuy] Payment payload:', JSON.stringify(paymentPayload, null, 2));

      const xPaymentHeader = btoa(JSON.stringify(paymentPayload));

      // IMPORTANT: Use the FINAL (possibly capped) amount in the retry request
      const endpoint = `${API_BASE}/api/token-wars/buy/x402?amount=${finalAmount}`;

      // Retry the endpoint with X-PAYMENT header
      // The SERVER will execute transferWithAuthorization and record the buy
      const paidResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': xPaymentHeader,
        },
        body: requestBody,
      });

      const data = await paidResponse.json();
      console.log('[TokenWarsBuy] Server response:', data);
      console.log('[TokenWarsBuy] Response status:', paidResponse.status);

      // Log detailed error info for debugging
      if (!paidResponse.ok || !data.success) {
        console.error('[TokenWarsBuy] VERIFICATION DEBUG:', {
          status: paidResponse.status,
          error: data.error,
          reason: data.reason,
          details: data.details,
          fullResponse: JSON.stringify(data, null, 2),
          sentPayload: paymentPayload,
          xPaymentHeader: xPaymentHeader.substring(0, 100) + '...',
        });
      }

      // =========================================================================
      // STEP 5: Handle response
      // =========================================================================
      if (paidResponse.ok && data.success) {
        setResult(data);
        setStatus('success');
        setStatusMessage('Successfully joined the Token War!');

        if (data.sellout) {
          console.log('[TokenWarsBuy] Sellout status:', data.sellout);
        }

        return data;
      } else if (paidResponse.status === 402) {
        // Payment verification failed
        if (data.reason) {
          throw new Error(`Payment verification failed: ${data.reason}`);
        }
        throw new Error(data.error || 'Payment not accepted');
      } else {
        throw new Error(data.error || 'Payment failed');
      }

    } catch (err) {
      console.error('[TokenWarsBuy] Error:', err);

      let message = 'Buy failed';
      if (err instanceof Error) {
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction cancelled by user';
        } else if (err.message.includes('insufficient') || err.message.includes('exceeds balance')) {
          message = 'Insufficient USDC balance';
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStatus('error');
      setStatusMessage('');
      return null;
    }
  }, [isConnected, walletClient, address, chain, getUSDCBalance]);

  /**
   * Reset the hook state
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setStatusMessage('');
    setError(null);
    setResult(null);
    setWasCapped(false);
    setCappedReason(null);
    setActualAmount(null);
  }, []);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
    if (status === 'error') {
      setStatus('idle');
      setStatusMessage('');
    }
  }, [status]);

  return {
    // State
    status,
    statusMessage,
    error,
    result,
    isConnected,
    address,

    // Sale capacity state
    saleInfo,
    wasCapped,
    cappedReason,
    actualAmount,

    // Actions
    buyIn,
    fetchSaleInfo,
    reset,
    clearError,
    getUSDCBalance,

    // Computed
    isLoading: ['requesting', 'signing', 'submitting'].includes(status),
    isSigning: status === 'signing',
    isProcessing: status === 'submitting',
    isSuccess: status === 'success',
    isError: status === 'error',
    isSoldOut: saleInfo?.isSoldOut ?? false,
  };
}

export default useTokenWarsBuy;
