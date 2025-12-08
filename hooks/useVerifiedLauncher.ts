'use client';

import { useState, useCallback, useMemo } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseUnits, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_DECIMALS = 6;

// Payment recipient wallet
const PAYMENT_WALLET = '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098' as const;

// USDC ABI for balanceOf and transfer
const USDC_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Step types for the 2-step flow
export type LaunchStep = 'idle' | 'verifying' | 'launching' | 'polling' | 'complete' | 'error';

// Verification result
export interface VerificationResult {
  verified: boolean;
  confidence: number;
  reason: string;
  verificationToken: string | null;
  tempImageUrl: string | null;
  tokenExpiry?: number;
}

// Launch result
export interface LaunchResult {
  queueId: string;
  imageUrl: string;
  devBuyBudget: number;
  contractAddress?: string;
}

// Hook state
interface LaunchState {
  step: LaunchStep;
  verification: VerificationResult | null;
  launch: LaunchResult | null;
  error: string | null;
  statusMessage: string;
}

// X402 payment requirements from 402 response
interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
}

/**
 * Hook for verified token launching with x402 payments
 * Uses server-side x402 middleware for payment handling
 * Falls back to direct USDC transfer for miniapp compatibility
 *
 * Flow:
 * 1. verifyImage() - Verify image matches art style ($0.50 USDC)
 * 2. launchToken() - Deploy token via Clanker ($5+ USDC)
 */
export function useVerifiedLauncher() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { data: walletClient } = useWalletClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [state, setState] = useState<LaunchState>({
    step: 'idle',
    verification: null,
    launch: null,
    error: null,
    statusMessage: '',
  });

  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [pendingTxHash, setPendingTxHash] = useState<`0x${string}` | null>(null);

  // Check if wallet is ready to sign
  const canSign = isConnected && address && walletClient;

  // Helper to make a USDC transfer and return the tx hash
  const makeUSDCPayment = useCallback(async (
    amountUSDC: number,
    recipient: string = PAYMENT_WALLET
  ): Promise<`0x${string}`> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    const amountInUnits = parseUnits(amountUSDC.toString(), USDC_DECIMALS);

    // Encode the USDC transfer call
    const data = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, amountInUnits],
    });

    // Send the transaction
    const hash = await sendTransactionAsync({
      to: USDC_ADDRESS,
      data,
    });

    return hash;
  }, [walletClient, address, sendTransactionAsync]);

  // Fetch with x402 payment handling - tries server-side first, falls back to direct transfer
  const fetchWithX402 = useMemo(() => {
    return async (url: string, options?: RequestInit): Promise<Response> => {
      // First, make the request without payment
      const response = await fetch(url, options);

      // If not 402, return as-is
      if (response.status !== 402) {
        return response;
      }

      // Parse 402 payment requirements
      const paymentInfo = await response.json();
      console.log('[x402] Payment required:', paymentInfo);

      // Extract payment requirements
      let paymentRequirements: PaymentRequirements | undefined;
      if (paymentInfo.accepts && Array.isArray(paymentInfo.accepts)) {
        paymentRequirements = paymentInfo.accepts.find(
          (req: PaymentRequirements) => req.scheme === 'exact' && req.network === 'base'
        ) || paymentInfo.accepts[0];
      }

      if (!paymentRequirements) {
        throw new Error('No valid payment requirements in 402 response');
      }

      // Calculate amount in USDC
      const amountUSDC = parseFloat(formatUnits(BigInt(paymentRequirements.maxAmountRequired), USDC_DECIMALS));
      console.log(`[x402] Payment amount: $${amountUSDC} USDC`);

      // Make the USDC payment
      const txHash = await makeUSDCPayment(amountUSDC, paymentRequirements.payTo);
      console.log(`[x402] Payment tx: ${txHash}`);
      setPendingTxHash(txHash);

      // Wait for transaction confirmation
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      // Retry the original request with payment proof
      const retryOptions = {
        ...options,
        headers: {
          ...options?.headers,
          'X-PAYMENT-TX': txHash,
          'X-PAYMENT-PAYER': address || '',
        },
      };

      return fetch(url, retryOptions);
    };
  }, [makeUSDCPayment, address, publicClient]);

  // Fetch USDC balance
  const fetchUSDCBalance = useCallback(async () => {
    if (!address || !publicClient) {
      setUsdcBalance(null);
      return;
    }
    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      setUsdcBalance(formatUnits(balance, USDC_DECIMALS));
    } catch {
      setUsdcBalance('0');
    }
  }, [address, publicClient]);

  // Step 1: Verify image with AI + auto-upload ($0.50 USDC)
  const verifyImage = useCallback(async (imageFile: File): Promise<VerificationResult | null> => {
    if (!isConnected || !address) {
      setState(s => ({ ...s, error: 'Please connect your wallet first', step: 'error' }));
      return null;
    }

    if (!walletClient) {
      setState(s => ({ ...s, error: 'Wallet not ready to sign. Please wait...', step: 'error' }));
      return null;
    }

    if (chain?.id !== base.id) {
      setState(s => ({ ...s, error: 'Please switch to Base network', step: 'error' }));
      return null;
    }

    setState(s => ({ ...s, step: 'verifying', error: null, statusMessage: 'Requesting verification...' }));

    try {
      const formData = new FormData();
      formData.append('file', imageFile);
      formData.append('walletAddress', address);

      console.log('[x402] Starting image verification request...');
      setState(s => ({ ...s, statusMessage: 'Please approve the USDC payment ($0.50)...' }));

      // Use the x402 payment flow:
      // 1. Makes initial POST request
      // 2. If 402, parses payment requirements and makes USDC transfer
      // 3. Retries request with payment proof headers
      const response = await fetchWithX402('/api/verified-launcher/verify', {
        method: 'POST',
        body: formData,
      });

      console.log('[x402] Verification response:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Verification failed (${response.status})`);
      }

      const result = await response.json();

      const verification: VerificationResult = {
        verified: result.verified,
        confidence: result.confidence,
        reason: result.reason,
        verificationToken: result.verificationToken || null,
        tempImageUrl: result.tempImageUrl || null,
        tokenExpiry: result.tokenExpiry,
      };

      if (verification.verified && verification.verificationToken) {
        setVerificationToken(verification.verificationToken);
      }

      setState(s => ({
        ...s,
        verification,
        step: verification.verified ? 'idle' : 'error',
        statusMessage: verification.verified ? 'Image verified!' : '',
        error: verification.verified ? null : `Image verification failed: ${verification.reason}`,
      }));

      return verification;
    } catch (err) {
      console.error('[x402 Verify] Error:', err);
      let errorMessage = err instanceof Error ? err.message : 'Verification failed';

      // Provide better error messages
      if (errorMessage.includes('rejected') || errorMessage.includes('denied') || errorMessage.includes('User rejected')) {
        errorMessage = 'Payment rejected by user';
      } else if (errorMessage.includes('insufficient') || errorMessage.includes('exceeds balance')) {
        errorMessage = 'Insufficient USDC balance';
      }

      setState(s => ({ ...s, step: 'error', error: errorMessage, statusMessage: '' }));
      return null;
    }
  }, [isConnected, address, chain?.id, walletClient, fetchWithX402]);

  // Step 2: Launch token ($5+ USDC)
  const launchToken = useCallback(async (
    tokenName: string,
    tokenSymbol: string,
    description: string,
    devBuyBudget: number = 5
  ): Promise<LaunchResult | null> => {
    if (!isConnected || !address) {
      setState(s => ({ ...s, error: 'Please connect your wallet first', step: 'error' }));
      return null;
    }

    if (!walletClient) {
      setState(s => ({ ...s, error: 'Wallet not ready to sign. Please wait...', step: 'error' }));
      return null;
    }

    if (!verificationToken) {
      setState(s => ({ ...s, error: 'Must verify image before launching', step: 'error' }));
      return null;
    }

    setState(s => ({ ...s, step: 'launching', error: null, statusMessage: `Please approve the USDC payment ($${devBuyBudget.toFixed(2)})...` }));

    try {
      const body = {
        walletAddress: address,
        verificationToken,
        tokenName,
        tokenSymbol,
        description,
        devBuyBudget, // Include dev buy budget in request
      };

      console.log('[x402] Starting token launch request...');

      // Use the x402 payment flow with direct USDC transfer
      const response = await fetchWithX402('/api/verified-launcher/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      console.log('[x402] Launch response:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Launch failed (${response.status})`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Launch failed');
      }

      // Token consumed after successful launch
      setVerificationToken(null);

      const launch: LaunchResult = {
        queueId: result.launch.queueId,
        imageUrl: result.launch.imageUrl,
        devBuyBudget: result.launch.devBuyBudget,
      };

      setState(s => ({ ...s, launch, step: 'polling', statusMessage: 'Waiting for deployment...' }));

      // Start polling for completion
      await pollForCompletion(launch.queueId);

      return launch;
    } catch (err) {
      console.error('[x402 Launch] Error:', err);
      let errorMessage = err instanceof Error ? err.message : 'Launch failed';

      // Provide better error messages
      if (errorMessage.includes('rejected') || errorMessage.includes('denied') || errorMessage.includes('User rejected')) {
        errorMessage = 'Payment rejected by user';
      } else if (errorMessage.includes('insufficient') || errorMessage.includes('exceeds balance')) {
        errorMessage = 'Insufficient USDC balance';
      }

      setState(s => ({ ...s, step: 'error', error: errorMessage, statusMessage: '' }));
      return null;
    }
  }, [isConnected, address, walletClient, verificationToken, fetchWithX402]);

  // Poll for deployment completion
  const pollForCompletion = async (queueId: string) => {
    let pollAttempts = 0;
    const maxAttempts = 60; // 5 minutes at 5 second intervals

    while (pollAttempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        const response = await fetch(`/api/verified-launcher/status?queueId=${queueId}`);
        const status = await response.json();

        if (status.status === 'complete' && status.contractAddress) {
          setState(s => ({
            ...s,
            step: 'complete',
            launch: s.launch ? { ...s.launch, contractAddress: status.contractAddress } : null,
            statusMessage: 'Token launched successfully!',
          }));
          return;
        }

        if (status.status === 'failed') {
          throw new Error(status.error || 'Token deployment failed');
        }

        pollAttempts++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Polling failed';
        setState(s => ({ ...s, step: 'error', error: errorMessage, statusMessage: '' }));
        return;
      }
    }

    setState(s => ({ ...s, step: 'error', error: 'Token deployment timed out', statusMessage: '' }));
  };

  // Complete flow: verify → launch
  const launchVerifiedToken = useCallback(async (
    imageFile: File,
    tokenName: string,
    tokenSymbol: string,
    description: string,
    devBuyBudget: number = 5
  ) => {
    // Step 1: Verify + Upload
    const verification = await verifyImage(imageFile);
    if (!verification?.verified) {
      return;
    }

    // Step 2: Launch
    await launchToken(tokenName, tokenSymbol, description, devBuyBudget);
  }, [verifyImage, launchToken]);

  // Reset state
  const reset = useCallback(() => {
    setState({
      step: 'idle',
      verification: null,
      launch: null,
      error: null,
      statusMessage: '',
    });
    setVerificationToken(null);
  }, []);

  return {
    ...state,
    usdcBalance,
    verificationToken,
    pendingTxHash,
    isConnected,
    address,
    chainId: chain?.id,
    canSign,
    isLoading: ['verifying', 'launching', 'polling'].includes(state.step),
    verifyImage,
    launchToken,
    launchVerifiedToken,
    fetchUSDCBalance,
    reset,
  };
}
