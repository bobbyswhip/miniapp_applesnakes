// hooks/useTokenWarsLaunch.ts
// Version 3.0 - Direct EIP-3009 (No x402)
// Endpoint: /api/token-wars/create
'use client';

import { useState, useCallback } from 'react';
import { useWalletClient, usePublicClient } from 'wagmi';
import { formatUnits, getAddress } from 'viem';
import type { DexVote, PairVote, TokenWar } from '@/types/token-wars';

// ===== CONSTANTS - DO NOT MODIFY =====
// USDC on Base mainnet - CHECKSUM ADDRESS
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// AI Wallet that receives payments - CHECKSUM ADDRESS
const AI_WALLET = '0xE5e9033C57B4332283Cda19B39431CD716340098';

// EIP-712 domain - MUST match exactly what USDC contract expects
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS as `0x${string}`,
} as const;

// EIP-3009 TransferWithAuthorization types
const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// Generate cryptographically secure 32-byte nonce
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')) as `0x${string}`;
}

interface LaunchProgress {
  status: 'idle' | 'uploading' | 'creating' | 'active' | 'error';
  step: number;
  totalSteps: number;
  message: string;
}

export interface War {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted?: string;
  status: string;
  isActive: boolean;
  targetAmount?: number;
  totalRaised: number;
  participantCount: number;
  creatorWallet: string;
  tokenAddress?: string;
  locks?: {
    lockedDex: DexVote | null;
    lockedPair: PairVote | null;
    isRawIco: boolean;
    isDexLocked: boolean;
    isPairLocked: boolean;
  };
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
  totalWars: number;
  activeWars: number;
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
  currentWars: War[];
}

interface CreateWarParams {
  name: string;
  symbol: string;
  description?: string;
  image?: File | string;
  targetAmount?: number;
  durationHours?: number;
  amountUsdc: number;          // Amount in USD (minimum $0.01)
  dexVote: DexVote;
  pairVote: PairVote;
  lockedDex?: DexVote;         // Lock DEX choice (RAW ICO mode)
  lockedPair?: PairVote;       // Lock pair choice (RAW ICO mode)
}

interface CreateWarResult {
  success: boolean;
  warId?: string;
  war?: TokenWar;
  predictionMarkets?: {
    dexMarketId?: string;
    pairMarketId?: string;
    selloutMarketId?: string;
  };
  payment?: {
    total: number;
    pmSeed: number;
    presale: number;
  };
  error?: string;
}

export function useTokenWarsLaunch() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [progress, setProgress] = useState<LaunchProgress>({
    status: 'idle',
    step: 0,
    totalSteps: 0,
    message: ''
  });
  const [war, setWar] = useState<TokenWar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatus | null>(null);

  // Check USDC balance before signing
  const checkUsdcBalance = useCallback(async (address: string, requiredAmount: number): Promise<boolean> => {
    if (!publicClient) return false;

    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: [{
          name: 'balanceOf',
          type: 'function',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view'
        }],
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      });

      const balanceUsdc = parseFloat(formatUnits(balance as bigint, 6));
      console.log(`[CreateWar] USDC balance: $${balanceUsdc}, required: $${requiredAmount}`);
      return balanceUsdc >= requiredAmount;
    } catch (err) {
      console.error('[CreateWar] Failed to check balance:', err);
      return false;
    }
  }, [publicClient]);

  // Fetch launcher status and current wars
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/token-wars/launch');
      const data = await response.json();
      setLauncherStatus(data);
      return data;
    } catch (err) {
      console.error('Failed to fetch launcher status:', err);
      return null;
    }
  }, []);

  // Create a new token war with direct EIP-3009 payment (v3.0)
  const createWar = useCallback(async (params: CreateWarParams): Promise<CreateWarResult | null> => {
    if (!walletClient) {
      setError('Connect wallet first');
      return null;
    }

    const address = walletClient.account?.address;
    if (!address) {
      setError('No wallet address');
      return null;
    }

    // Validate amount (minimum $0.01)
    if (params.amountUsdc < 0.01) {
      setError('Minimum $0.01 USDC required');
      return null;
    }

    setError(null);
    setProgress({ status: 'uploading', step: 1, totalSteps: 5, message: 'Checking USDC balance...' });

    try {
      // ===== STEP 1: Check USDC balance =====
      const hasBalance = await checkUsdcBalance(address, params.amountUsdc);
      if (!hasBalance) {
        throw new Error(`Insufficient USDC balance. You need at least $${params.amountUsdc} USDC.`);
      }

      // ===== STEP 2: Calculate atomic amount =====
      // USDC has 6 decimals: $1 = 1,000,000 atomic units
      const atomicAmount = BigInt(Math.round(params.amountUsdc * 1_000_000));
      console.log(`[CreateWar] Amount: $${params.amountUsdc} = ${atomicAmount} atomic units`);

      setProgress({ status: 'uploading', step: 2, totalSteps: 5, message: 'Sign the payment authorization in your wallet...' });

      // ===== STEP 3: Generate secure nonce =====
      const nonce = generateNonce();
      console.log(`[CreateWar] Nonce: ${nonce}`);

      // ===== STEP 4: Calculate validity window =====
      const now = Math.floor(Date.now() / 1000);
      const validBefore = now + 3600; // 1 hour from now
      console.log(`[CreateWar] Valid window: 0 to ${validBefore}`);

      // ===== STEP 5: Build authorization message for signing =====
      // CRITICAL: Use checksummed addresses with getAddress()
      const authMessage = {
        from: getAddress(address),           // Checksummed sender address
        to: getAddress(AI_WALLET),           // Checksummed AI wallet address
        value: atomicAmount,                 // BigInt for signing
        validAfter: BigInt(0),               // BigInt for signing
        validBefore: BigInt(validBefore),    // BigInt for signing
        nonce: nonce,                        // 32-byte hex string
      };

      console.log('[CreateWar] Auth message for signing:', {
        from: authMessage.from,
        to: authMessage.to,
        value: authMessage.value.toString(),
        validAfter: authMessage.validAfter.toString(),
        validBefore: authMessage.validBefore.toString(),
        nonce: authMessage.nonce,
      });

      // ===== STEP 6: Sign with EIP-712 =====
      console.log('[CreateWar] Requesting signature...');
      const signature = await walletClient.signTypedData({
        account: address,
        domain: USDC_DOMAIN,
        types: TRANSFER_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: authMessage,
      });

      console.log('[CreateWar] Got signature:', signature.slice(0, 20) + '...');

      setProgress({ status: 'creating', step: 3, totalSteps: 5, message: 'Processing payment...' });

      // ===== STEP 7: Build x402 payment payload =====
      // CRITICAL: All numeric values MUST be STRINGS in the payload!
      const paymentPayload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature: signature,
          authorization: {
            from: authMessage.from,                    // Checksummed address
            to: authMessage.to,                        // Checksummed address
            value: atomicAmount.toString(),            // STRING! Not number!
            validAfter: '0',                           // STRING! Not number!
            validBefore: validBefore.toString(),       // STRING! Not number!
            nonce: nonce,                              // Already a string
          },
        },
      };

      // Debug: Validate payload before sending
      console.log('[CreateWar] Payment payload:', JSON.stringify(paymentPayload, null, 2));

      // Validate all required fields are strings
      const auth = paymentPayload.payload.authorization;
      if (typeof auth.value !== 'string') throw new Error('value must be string');
      if (typeof auth.validAfter !== 'string') throw new Error('validAfter must be string');
      if (typeof auth.validBefore !== 'string') throw new Error('validBefore must be string');
      if (nonce.length !== 66) throw new Error(`nonce must be 66 chars, got ${nonce.length}`);

      // ===== STEP 8: Encode as base64 =====
      const paymentHeader = btoa(JSON.stringify(paymentPayload));
      console.log('[CreateWar] X-PAYMENT header length:', paymentHeader.length);

      setProgress({ status: 'creating', step: 4, totalSteps: 5, message: 'Creating token war...' });

      // ===== STEP 9: Build form data =====
      const formData = new FormData();
      formData.append('name', params.name);
      formData.append('symbol', params.symbol.toUpperCase());
      if (params.description) formData.append('description', params.description);
      if (params.targetAmount) formData.append('targetAmount', params.targetAmount.toString());
      if (params.durationHours) formData.append('durationHours', Math.max(8, Math.min(720, params.durationHours)).toString());
      formData.append('dexVote', params.dexVote);
      formData.append('pairVote', params.pairVote);

      // RAW ICO mode - lock voting options
      if (params.lockedDex) formData.append('lockedDex', params.lockedDex);
      if (params.lockedPair) formData.append('lockedPair', params.lockedPair);

      // Include image file if provided
      if (params.image instanceof File) {
        formData.append('image', params.image);
      } else if (params.image) {
        // String URL (already uploaded)
        formData.append('imageUrl', params.image);
      }

      // ===== STEP 10: Send request to NEW ENDPOINT (v3.0) =====
      // IMPORTANT: /api/token-wars/create (NOT /api/token-wars)
      console.log('[CreateWar] Sending request to https://api.applesnakes.com/api/token-wars/create');
      const response = await fetch('https://api.applesnakes.com/api/token-wars/create', {
        method: 'POST',
        headers: {
          'X-PAYMENT': paymentHeader,
        },
        body: formData,
      });

      const result = await response.json();
      console.log('[CreateWar] Response:', result);

      if (!response.ok || !result.success) {
        // Handle debug info from server
        if (result.debug) {
          console.error('[CreateWar] Server debug info:', {
            resourceUrl: result.debug.resourceUrl,
            network: result.debug.network,
            payTo: result.debug.payTo,
            maxAmountRequired: result.debug.maxAmountRequired,
          });
        }

        // Show detailed error info if available
        if (result.detail) {
          throw new Error(`${result.error}: ${result.detail}`);
        }
        throw new Error(result.error || result.reason || 'Failed to create war');
      }

      setWar(result.war);
      setProgress({
        status: 'active',
        step: 5,
        totalSteps: 5,
        message: 'Token war created! Prediction markets active and presale is now live.'
      });

      return {
        success: true,
        warId: result.warId,
        war: result.war,
        predictionMarkets: result.predictionMarkets,
        payment: result.payment,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CreateWar] Error:', message, err);
      setError(message);
      setProgress({
        status: 'error',
        step: 0,
        totalSteps: 5,
        message
      });
      return { success: false, error: message };
    }
  }, [walletClient, checkUsdcBalance]);

  // Upload image only
  const uploadImage = useCallback(async (file: File, fileName?: string) => {
    setError(null);
    setProgress({ status: 'uploading', step: 1, totalSteps: 1, message: 'Uploading image...' });

    try {
      const formData = new FormData();
      formData.append('action', 'upload');
      formData.append('file', file);
      if (fileName) formData.append('fileName', fileName);

      const response = await fetch('/api/token-wars/launch', {
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

  // Check war status
  const checkWarStatus = useCallback(async (warId: string) => {
    try {
      const response = await fetch('/api/token-wars/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          warId
        })
      });

      const result = await response.json();
      if (result.war) {
        setWar(result.war);
      }
      return result;
    } catch (err) {
      console.error('Failed to check war status:', err);
      return null;
    }
  }, []);

  // Subscribe to SSE progress stream
  const subscribeToProgress = useCallback((warId: string, onProgress: (data: LaunchProgress) => void) => {
    const eventSource = new EventSource(
      `/api/token-wars/launch/stream?warId=${warId}`
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
    setWar(null);
    setError(null);
  }, []);

  return {
    progress,
    war,
    error,
    launcherStatus,
    createWar,
    uploadImage,
    checkWarStatus,
    fetchStatus,
    subscribeToProgress,
    reset,
    checkUsdcBalance,
    isLoading: progress.status === 'uploading' || progress.status === 'creating'
  };
}

// Legacy export for backwards compatibility
export { useTokenWarsLaunch as useClankerdomeLaunch };
export type { War as Launch };
