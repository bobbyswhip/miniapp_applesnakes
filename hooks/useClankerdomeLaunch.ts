// hooks/useClankerdomeLaunch.ts
'use client';

import { useState, useCallback } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';

// Use local API proxy to avoid CORS issues with X402 headers
const API_BASE_URL = '';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AI_WALLET = '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098';

interface LaunchProgress {
  status: 'idle' | 'uploading' | 'creating' | 'active' | 'error';
  step: number;
  totalSteps: number;
  message: string;
}

export interface Launch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  status: string;
  isActive: boolean;
  targetAmount?: number;
  totalRaised: number;
  participantCount: number;
  creatorWallet: string;
  tokenAddress?: string;
}

interface LauncherConfig {
  presaleDuration: string;
  tokenPairing: string;
  wassAddress: string;
  feeStructure: {
    total: string;
    aiAgent: string;
    creator: string;
    protocol: string;
  };
}

interface LauncherStats {
  totalLaunches: number;
  activeLaunches: number;
  totalRaisedUsdc: number;
  totalParticipants: number;
}

interface LauncherStatus {
  status: string;
  wallet: string;
  capabilities: {
    createLaunch: boolean;
    uploadImage: boolean;
    executeLaunch: boolean;
    predictionMarkets: boolean;
    sseProgress: boolean;
  };
  config: LauncherConfig;
  stats: LauncherStats;
  currentLaunches: Launch[];
}

interface CreateLaunchParams {
  name: string;
  symbol: string;
  description?: string;
  creatorWallet: string;
  image?: File | string;
  targetAmount?: number;
  durationHours?: number;
  amountUsdc: number;  // Minimum $1 USDC - split 50/50 between PM seed and presale
}

interface CreateLaunchResult {
  success: boolean;
  launchId?: string;
  launch?: Launch;
  predictionMarket?: {
    id: string;
    seededAmount: number;
  };
  payment?: {
    total: number;
    pmSeed: number;
    presale: number;
  };
  error?: string;
}

export function useClankerdomeLaunch() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [progress, setProgress] = useState<LaunchProgress>({
    status: 'idle',
    step: 0,
    totalSteps: 0,
    message: ''
  });
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatus | null>(null);

  // Fetch launcher status and current launches
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`);
      const data = await response.json();
      setLauncherStatus(data);
      return data;
    } catch (err) {
      console.error('Failed to fetch launcher status:', err);
      return null;
    }
  }, []);

  // Create a new launch party with X402 payment
  // Payment is split: 50% seeds prediction market, 50% goes to presale
  const createLaunch = useCallback(async (params: CreateLaunchParams): Promise<CreateLaunchResult | null> => {
    if (!address) {
      setError('Connect wallet first');
      return null;
    }

    if (params.amountUsdc < 1) {
      setError('Minimum $1 USDC required to create a launch');
      return null;
    }

    setError(null);
    setProgress({ status: 'uploading', step: 1, totalSteps: 4, message: 'Preparing payment authorization...' });

    try {
      // Step 1: Create EIP-3009 authorization for X402 payment
      const atomicAmount = BigInt(Math.floor(params.amountUsdc * 1_000_000)); // USDC has 6 decimals
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      // Generate 32 bytes (64 hex chars) for bytes32 nonce
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = `0x${Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

      console.log('[CreateLaunch] Signing authorization...', {
        from: address,
        to: AI_WALLET,
        value: atomicAmount.toString(),
        validAfter,
        validBefore,
        nonce,
      });

      setProgress({ status: 'uploading', step: 2, totalSteps: 4, message: 'Sign the payment authorization in your wallet...' });

      // Step 2: Sign the authorization
      const signature = await signTypedDataAsync({
        domain: {
          name: 'USD Coin',
          version: '2',
          chainId: 8453, // Base mainnet
          verifyingContract: USDC_ADDRESS as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address,
          to: AI_WALLET as `0x${string}`,
          value: atomicAmount,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      });

      console.log('[CreateLaunch] Signature obtained:', signature);

      // Step 3: Build X402 payment payload
      // CRITICAL: All numeric values MUST be strings for JSON serialization
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature,
          authorization: {
            from: address,
            to: AI_WALLET,
            value: atomicAmount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));

      setProgress({ status: 'creating', step: 3, totalSteps: 4, message: 'Creating launch party with payment...' });

      // Step 4: Send create request with payment
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({
          action: 'create',
          name: params.name,
          symbol: params.symbol,
          description: params.description,
          image: params.image instanceof File ? undefined : params.image,
          creatorWallet: params.creatorWallet,
          targetAmount: params.targetAmount,
          durationHours: params.durationHours || 24,
        }),
      });

      const result = await response.json();
      console.log('[CreateLaunch] Response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to create launch');
      }

      setLaunch(result.launch);
      setProgress({
        status: 'active',
        step: 4,
        totalSteps: 4,
        message: 'Launch party created! Prediction market seeded and presale is now active.'
      });

      return {
        success: true,
        launchId: result.launchId,
        launch: result.launch,
        predictionMarket: result.predictionMarket,
        payment: result.payment,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CreateLaunch] Error:', message, err);
      setError(message);
      setProgress({
        status: 'error',
        step: 0,
        totalSteps: 4,
        message
      });
      return { success: false, error: message };
    }
  }, [address, signTypedDataAsync]);

  // Upload image only
  const uploadImage = useCallback(async (file: File, fileName?: string) => {
    setError(null);
    setProgress({ status: 'uploading', step: 1, totalSteps: 1, message: 'Uploading image...' });

    try {
      const formData = new FormData();
      formData.append('action', 'upload');
      formData.append('file', file);
      if (fileName) formData.append('fileName', fileName);

      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      setProgress({ status: 'idle', step: 1, totalSteps: 1, message: 'Image uploaded!' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setProgress({ status: 'error', step: 0, totalSteps: 1, message });
      throw err;
    }
  }, []);

  // Check launch status
  const checkLaunchStatus = useCallback(async (launchId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          launchId
        })
      });

      const result = await response.json();
      if (result.launch) {
        setLaunch(result.launch);
      }
      return result;
    } catch (err) {
      console.error('Failed to check launch status:', err);
      return null;
    }
  }, []);

  // Subscribe to SSE progress stream
  const subscribeToProgress = useCallback((launchId: string, onProgress: (data: LaunchProgress) => void) => {
    const eventSource = new EventSource(
      `${API_BASE_URL}/api/clankerdome/launch/stream?launchId=${launchId}`
    );

    eventSource.addEventListener('connected', (e) => {
      console.log('SSE Connected:', JSON.parse(e.data));
    });

    eventSource.addEventListener('progress', (e) => {
      const progressData = JSON.parse(e.data);
      setProgress(progressData);
      onProgress(progressData);

      // Close on completion or error
      if (progressData.status === 'complete' || progressData.status === 'error') {
        eventSource.close();
      }
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, []);

  const reset = useCallback(() => {
    setProgress({ status: 'idle', step: 0, totalSteps: 0, message: '' });
    setLaunch(null);
    setError(null);
  }, []);

  return {
    progress,
    launch,
    error,
    launcherStatus,
    createLaunch,
    uploadImage,
    checkLaunchStatus,
    fetchStatus,
    subscribeToProgress,
    reset,
    isLoading: progress.status === 'uploading' || progress.status === 'creating'
  };
}
