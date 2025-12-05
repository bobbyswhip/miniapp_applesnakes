'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useSignMessage, useChainId, useWriteContract, useWaitForTransactionReceipt, useBalance, useReadContract } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { keccak256, toBytes } from 'viem';
import { useNFTContext } from '@/contexts/NFTContext';
import { useTransactions } from '@/contexts/TransactionContext';
import { getContracts } from '@/config/contracts';
import { formatUnits } from 'viem';
import {
  createSignatureMessage,
  isValidSignatureFormat,
  generateNonce,
  SIGNATURE_STORAGE_KEY,
  MAX_SIGNATURE_AGE_SECONDS,
} from '@/lib/signature';
import { verifySignature, getWalletType } from '@/lib/verifySignature';
import { SiweMessage } from 'siwe';

declare global {
  interface Window {
    createUnityInstance: (
      canvas: HTMLCanvasElement,
      config: UnityConfig,
      onProgress: (progress: number) => void
    ) => Promise<UnityInstance>;
    unityInstance: UnityInstance | null;
  }
}

interface UnityConfig {
  dataUrl: string;
  frameworkUrl: string;
  codeUrl: string;
  streamingAssetsUrl: string;
  companyName: string;
  productName: string;
  productVersion: string;
  showBanner?: (msg: string, type: string) => void;
}

interface UnityInstance {
  SendMessage: (objectName: string, methodName: string, value?: string | number) => void;
  SetFullscreen: (fullscreen: number) => void;
  Quit: () => Promise<void>;
}

interface AuthData {
  token: string;
  address: string;
  chainId: number;
}

interface TransactionRequest {
  requestId: string;
  type: 'mint' | 'jail' | 'bail' | 'breed' | 'feed' | 'transfer' | 'wrap' | 'unwrap' | 'stake' | 'unstake' | 'stakeAll' | 'unstakeAll' | 'claimRewards';
  data: string | Record<string, string | number>; // Unity may send data as JSON string
}

interface GameAction {
  action: string;
  data: string | Record<string, unknown>; // Unity sends data as JSON string
}

interface SignatureData {
  signature: string;
  message: string;          // Full human-readable message that was signed
  hashedMessage: string;
  address: string;
  nonce: string;
  clientIP: string;
  timestamp: number;
  walletType: 'injected' | 'smart';
  isValid: boolean;
  error?: string;
}

interface SignatureRequest {
  requestId: string;
  gameMessage: string;
  storeInBrowser: boolean;
}

interface UnityWebGLProps {
  /** Path to Unity build folder (e.g., '/unity') */
  buildUrl: string;
  /** Must match Unity build filename (e.g., 'WebGLBuild' for WebGLBuild.loader.js) */
  productName?: string;
  /** Container width */
  width?: string | number;
  /** Container height */
  height?: string | number;
  /** Additional CSS classes */
  className?: string;
  /** Called when Unity finishes loading */
  onUnityReady?: () => void;
  /** Called when auth is sent to Unity */
  onAuthSent?: (address: string) => void;
  /** Called when a transaction is requested */
  onTransaction?: (request: TransactionRequest) => void;
  /** Called when a game action is received */
  onGameAction?: (action: GameAction) => void;
  /** Called when close button is clicked */
  onClose?: () => void;
  /** Whether the component is visible */
  visible?: boolean;
  /** Called when stake is requested - parent should open staking UI */
  onStakeRequest?: (tokenId: number) => void;
  /** Called when unstake is requested - parent should open staking UI */
  onUnstakeRequest?: (tokenId: number) => void;
}

// Session storage key for JWT cache
const JWT_CACHE_KEY = 'unity_auth_token';
const JWT_ADDRESS_KEY = 'unity_auth_address';

export default function UnityWebGL({
  buildUrl,
  productName = 'WebGLBuild',
  width = '100%',
  height = '100%',
  className = '',
  onUnityReady,
  onAuthSent,
  onTransaction,
  onGameAction,
  onClose,
  visible = true,
  onStakeRequest,
  onUnstakeRequest,
}: UnityWebGLProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const unityInstanceRef = useRef<UnityInstance | null>(null);
  const authInProgressRef = useRef(false);
  const pendingTxRef = useRef<string | null>(null);
  // Track the TYPE of the pending transaction for lock release
  const pendingTxTypeRef = useRef<string | null>(null);

  // Prevent request spam - track pending requests
  const signatureRequestPendingRef = useRef(false);
  const connectRequestPendingRef = useRef(false);

  // TRANSACTION LOCKING - Prevent duplicate transactions
  // Track pending transactions by type to prevent double-firing
  const pendingTransactionTypesRef = useRef<Set<string>>(new Set());
  // Track processed requestIds to prevent duplicate message handling
  const processedRequestIdsRef = useRef<Set<string>>(new Set());
  // Track pending game actions to prevent duplicate action handling
  const pendingGameActionsRef = useRef<Set<string>>(new Set());
  // Track app visibility for use in callbacks (state can be stale)
  const isAppVisibleRef = useRef(true);
  // Cleanup old requestIds after 30 seconds to prevent memory buildup
  const REQUEST_ID_EXPIRY_MS = 30000;

  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isUnityReady, setIsUnityReady] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<`0x${string}` | undefined>();
  // Track if app is in foreground (visible) - block transactions when in background
  const [isAppVisible, setIsAppVisible] = useState(true);

  // Auth state
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [authStatus, setAuthStatus] = useState<'idle' | 'signing' | 'verifying' | 'ready' | 'error'>('idle');

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();
  const { nfts, refetch: refetchNFTs } = useNFTContext();
  const { addTransaction, updateTransaction } = useTransactions();
  const { writeContractAsync } = useWriteContract();

  // ETH balance
  const { data: ethBalanceData } = useBalance({
    address,
  });

  // Token balance (APPLE token)
  const { data: tokenBalanceData } = useBalance({
    address,
    token: address ? getContracts(chainId).token?.address : undefined,
  });

  // Get staking contract info
  const stakingContract = getContracts(chainId).staking;
  const stakingAddress = stakingContract?.address;
  const stakingAbi = stakingContract?.abi;

  // Get user staking stats from staking contract
  // getUserStats returns: [stakedCount, pendingRewardsAmount, totalClaimedAmount, currentRewardDebt, firstStakeTimestamp, lastStakeTimestamp, lastUnstakeTimestamp, lastClaimTimestamp, stakeDuration]
  const { data: userStakingStats, refetch: refetchStakingStats } = useReadContract({
    address: stakingAddress && stakingAddress !== '0x0000000000000000000000000000000000000000' ? stakingAddress : undefined,
    abi: stakingAbi,
    functionName: 'getUserStats',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!stakingAddress && stakingAddress !== '0x0000000000000000000000000000000000000000',
    },
  }) as { data: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] | undefined; refetch: () => void };

  // Parse staking stats: [stakedCount, pendingRewardsAmount, totalClaimedAmount, ...]
  const stakedCount = userStakingStats ? Number(userStakingStats[0]) : 0;
  const pendingRewardsRaw = userStakingStats ? userStakingStats[1] : BigInt(0);
  const pendingRewards = formatUnits(pendingRewardsRaw, 18);

  // Get staked token IDs for isStaked field
  // getStakedTokenIdsPaginated returns: [tokenIds[], total, hasMore]
  const { data: stakedTokensData, refetch: refetchStakedTokens } = useReadContract({
    address: stakingAddress && stakingAddress !== '0x0000000000000000000000000000000000000000' ? stakingAddress : undefined,
    abi: stakingAbi,
    functionName: 'getStakedTokenIdsPaginated',
    args: address ? [address, BigInt(0), BigInt(100)] : undefined, // Get first 100 staked tokens
    query: {
      enabled: !!address && !!stakingAddress && stakingAddress !== '0x0000000000000000000000000000000000000000',
    },
  }) as { data: readonly [readonly bigint[], bigint, boolean] | undefined; refetch: () => void };

  // Create a Set of staked token IDs for O(1) lookup
  const stakedTokenIds = new Set<string>(
    stakedTokensData?.[0]?.map(id => id.toString()) || []
  );

  // Wait for transaction receipt
  const { isSuccess: txSuccess, isError: txError } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  });

  // Check for cached JWT on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cachedToken = sessionStorage.getItem(JWT_CACHE_KEY);
      const cachedAddress = sessionStorage.getItem(JWT_ADDRESS_KEY);

      if (cachedToken && cachedAddress && cachedAddress === address) {
        // console.log('[Unity] Using cached JWT token');
        setAuthData({
          token: cachedToken,
          address: cachedAddress,
          chainId: chainId,
        });
        setAuthStatus('ready');
      }
    }
  }, [address, chainId]);

  // Auto-authenticate when wallet is connected and Unity is ready
  const performAutoAuth = useCallback(async () => {
    if (!isConnected || !address || authInProgressRef.current) return;
    if (authData && authData.address === address) return; // Already authed

    // Check cache first
    const cachedToken = sessionStorage.getItem(JWT_CACHE_KEY);
    const cachedAddress = sessionStorage.getItem(JWT_ADDRESS_KEY);
    if (cachedToken && cachedAddress === address) {
      setAuthData({ token: cachedToken, address, chainId });
      setAuthStatus('ready');
      return;
    }

    authInProgressRef.current = true;
    setAuthStatus('signing');

    try {
      // 1. Fetch nonce
      const nonceRes = await fetch('/api/auth/nonce');
      const { nonce } = await nonceRes.json();

      // 2. Create SIWE message
      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to AppleSnakes Game',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
      });

      const message = siweMessage.prepareMessage();

      // 3. Request signature (wallet popup appears)
      const signature = await signMessageAsync({ message });

      setAuthStatus('verifying');

      // 4. Verify signature and get JWT
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, nonce }),
      });

      const data = await verifyRes.json();

      if (!verifyRes.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      // 5. Cache the token
      sessionStorage.setItem(JWT_CACHE_KEY, data.token);
      sessionStorage.setItem(JWT_ADDRESS_KEY, address);

      // 6. Set auth state
      setAuthData({
        token: data.token,
        address: data.address,
        chainId: data.chainId,
      });
      setAuthStatus('ready');

      // console.log('[Unity] Auto-auth successful:', data.address);

    } catch (err) {
      // console.error('[Unity] Auto-auth failed:', err);
      setAuthStatus('error');
      // Don't cache errors - user can try again
    } finally {
      authInProgressRef.current = false;
    }
  }, [isConnected, address, chainId, signMessageAsync, authData]);

  // Send auth data to Unity when ready
  useEffect(() => {
    if (!isUnityReady || !authData) return;

    const instance = unityInstanceRef.current;
    if (!instance) return;

    try {
      const authPayload = JSON.stringify({
        token: authData.token,
        address: authData.address,
        chainId: authData.chainId,
      });
      instance.SendMessage('WebGLBridge', 'OnAuthReceived', authPayload);
      // console.log('[Unity] Sent auth to Unity:', authData.address);
      onAuthSent?.(authData.address);
    } catch (e) {
      // console.warn('[Unity] WebGLBridge not ready for auth');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnityReady, authData, onAuthSent]);

  // Send transaction result to Unity
  const sendTransactionResult = useCallback((
    requestId: string,
    success: boolean,
    txHash?: string,
    error?: string
  ) => {
    const instance = unityInstanceRef.current;
    if (!instance) return;

    const result = JSON.stringify({
      requestId,
      success,
      txHash: txHash || '',
      error: error || '',
    });

    try {
      instance.SendMessage('WebGLBridge', 'OnTransactionResult', result);
      // console.log('[Unity] Sent transaction result:', { requestId, success, txHash });
    } catch (e) {
      console.warn('[Unity] Failed to send transaction result');
    }
  }, []);

  // Send action result to Unity (for game actions like staking)
  const sendActionResult = useCallback((
    action: string,
    success: boolean,
    data?: Record<string, unknown>,
    error?: string
  ) => {
    const instance = unityInstanceRef.current;
    if (!instance) return;

    const result = JSON.stringify({
      action,
      success,
      data: JSON.stringify(data || {}),
      error: error || '',
    });

    try {
      instance.SendMessage('WebGLBridge', 'OnGameActionResult', result);
      // console.log('[Unity] Sent action result:', { action, success, data });
    } catch (e) {
      console.warn('[Unity] Failed to send action result');
    }
  }, []);

  // ========== SIGNATURE AUTHENTICATION HELPERS ==========

  // Get client IP address
  const getClientIP = useCallback(async () => {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch {
      return '0.0.0.0'; // Fallback
    }
  }, []);

  // Send signature data to Unity
  const sendSignatureToUnity = useCallback((signatureData: SignatureData) => {
    const instance = unityInstanceRef.current;
    if (!instance) {
      console.error('[Signature] Unity instance not available');
      return;
    }

    try {
      instance.SendMessage(
        'WebGLBridge',
        'OnSignatureDataReceived',
        JSON.stringify(signatureData)
      );
      console.log('📤 [Signature] Sent to Unity:', signatureData.address);
    } catch (e) {
      console.warn('[Signature] Failed to send to Unity');
    }
  }, []);

  // Send signature error to Unity
  const sendSignatureError = useCallback((requestId: string, errorMessage: string) => {
    const errorData: SignatureData = {
      signature: '',
      message: '',           // Empty message for errors
      hashedMessage: '',
      address: '',
      nonce: '',
      clientIP: '',
      timestamp: 0,
      walletType: 'injected',
      isValid: false,
      error: errorMessage
    };

    sendSignatureToUnity(errorData);
  }, [sendSignatureToUnity]);

  // Check if stored signature is still valid
  const isStoredSignatureValid = useCallback((signatureData: SignatureData): boolean => {
    // 1. Must have passed cryptographic verification
    if (!signatureData?.signature || !signatureData?.isValid) return false;

    // 2. CRITICAL: Must have valid AppleSnakes human-readable format
    if (!isValidSignatureFormat(signatureData.message)) {
      console.log('[Signature] Invalid format (not AppleSnakes format)');
      console.log('[Signature] Message preview:', signatureData.message?.substring(0, 100));
      return false;
    }

    // 3. Check if signature is not too old (24 hours)
    const now = Math.floor(Date.now() / 1000);
    const age = now - signatureData.timestamp;

    return age < MAX_SIGNATURE_AGE_SECONDS;
  }, []);

  // Handle stored signature request from Unity
  const handleStoredSignatureRequest = useCallback(() => {
    try {
      const stored = localStorage.getItem(SIGNATURE_STORAGE_KEY);
      if (!stored) {
        console.log('[Signature] No stored signature found');
        return;
      }

      const signatureData: SignatureData = JSON.parse(stored);

      // Validate stored signature
      if (!isStoredSignatureValid(signatureData)) {
        console.log('[Signature] Stored signature expired or invalid');
        localStorage.removeItem(SIGNATURE_STORAGE_KEY);
        return;
      }

      // Check if address matches current wallet
      if (isConnected && address?.toLowerCase() !== signatureData.address?.toLowerCase()) {
        console.log('[Signature] Wallet changed, clearing stored signature');
        localStorage.removeItem(SIGNATURE_STORAGE_KEY);
        return;
      }

      // Send stored signature to Unity
      console.log('[Signature] Using stored signature for auto-login');
      sendSignatureToUnity(signatureData);

    } catch (error) {
      console.error('[Signature] Failed to load stored signature:', error);
      localStorage.removeItem(SIGNATURE_STORAGE_KEY);
    }
  }, [address, isConnected, isStoredSignatureValid, sendSignatureToUnity]);

  // Handle signature request from Unity
  const handleSignatureRequest = useCallback(async (payload: SignatureRequest) => {
    const { requestId, storeInBrowser } = payload;

    // Prevent spam - if a signature request is already pending, ignore
    if (signatureRequestPendingRef.current) {
      console.log('[Signature] Request already pending, ignoring...');
      return;
    }

    if (!isConnected || !address) {
      sendSignatureError(requestId, 'Wallet not connected');
      return;
    }

    // Mark as pending
    signatureRequestPendingRef.current = true;

    try {
      console.log('[Signature] Creating new signature for:', address);

      // 1. Get client IP for security binding
      const clientIP = await getClientIP();

      // 2. Generate cryptographic nonce (16 bytes hex)
      const nonce = generateNonce();

      // 3. Create timestamp
      const timestamp = Math.floor(Date.now() / 1000);

      // 4. Create human-readable message (AppleSnakes format)
      const message = createSignatureMessage(address, nonce, clientIP);

      // 5. Hash the message for verification
      const hashedMessage = keccak256(toBytes(message));

      // 6. Request signature from wallet (sign the human-readable message)
      console.log('[Signature] Requesting wallet signature...');
      const signature = await signMessageAsync({ message });

      // 7. Determine wallet type
      const walletType = await getWalletType(address);

      // 8. Verify signature (supports both EOA and smart wallets)
      const isValid = await verifySignature(address, message, signature);

      // 9. Create signature data object
      const signatureData: SignatureData = {
        signature,
        message,           // Include full human-readable message
        hashedMessage,
        address,
        nonce,
        clientIP,
        timestamp,
        walletType,
        isValid
      };

      // 10. Store in localStorage if requested
      if (storeInBrowser && isValid) {
        localStorage.setItem(SIGNATURE_STORAGE_KEY, JSON.stringify(signatureData));
        console.log('[Signature] Stored in localStorage with AppleSnakes format');
      }

      // 11. Send to Unity
      sendSignatureToUnity(signatureData);

    } catch (error) {
      console.error('[Signature] Request failed:', error);
      sendSignatureError(requestId, error instanceof Error ? error.message : 'Signature failed');
    } finally {
      // Always clear pending flag when done (success or failure)
      signatureRequestPendingRef.current = false;
    }
  }, [address, isConnected, signMessageAsync, getClientIP, sendSignatureToUnity, sendSignatureError]);

  // Handle connect request from Unity
  const handleConnectRequest = useCallback(() => {
    console.log('🔗 [Wallet] handleConnectRequest called', { isConnected, hasOpenConnectModal: !!openConnectModal, isPending: connectRequestPendingRef.current });

    // Prevent spam - if a connect request is already pending, ignore
    if (connectRequestPendingRef.current) {
      console.log('[Wallet] Connect request already pending, ignoring...');
      return;
    }

    if (isConnected) {
      console.log('[Wallet] Already connected:', address);
      // Send connection status to Unity (use ref to avoid stale closure)
      sendConnectionStatusRef.current();
      return;
    }

    // Mark as pending
    connectRequestPendingRef.current = true;

    // Clear pending flag after 30 seconds (timeout for user to complete connect)
    setTimeout(() => {
      connectRequestPendingRef.current = false;
    }, 30000);

    if (openConnectModal) {
      console.log('[Wallet] Opening connect modal via useConnectModal hook');
      openConnectModal();
    } else {
      // Fallback: try to click the connect button in the nav
      console.log('[Wallet] openConnectModal not available, trying fallback...');
      const connectBtn = document.querySelector('[data-testid="rk-connect-button"]') as HTMLButtonElement;
      if (connectBtn) {
        console.log('[Wallet] Found RainbowKit connect button, clicking...');
        connectBtn.click();
      } else {
        // Try to find any button with "Connect" text
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.toLowerCase().includes('connect') && !btn.textContent?.toLowerCase().includes('disconnect')) {
            console.log('[Wallet] Found connect button by text, clicking...');
            btn.click();
            return;
          }
        }
        console.error('[Wallet] Could not find any connect button!');
        connectRequestPendingRef.current = false; // Reset on failure
      }
    }
  }, [isConnected, openConnectModal, address]);

  // Send wallet connection status to Unity
  const sendConnectionStatus = useCallback(() => {
    const instance = unityInstanceRef.current;
    if (!instance) return;

    const status = {
      walletAddress: address || '',
      isConnected: isConnected,
      nftCount: nfts?.length || 0,
      nfts: []
    };

    try {
      instance.SendMessage(
        'WebGLBridge',
        'OnWalletConnectionStatus',
        JSON.stringify(status)
      );
      console.log('[Wallet] Sent connection status:', isConnected ? address : 'disconnected');
    } catch (e) {
      console.warn('[Wallet] Failed to send connection status');
    }
  }, [address, isConnected, nfts?.length]);

  // Handle transaction request from Unity
  const handleTransactionRequest = useCallback(async (request: TransactionRequest) => {
    const { requestId, type, data: rawData } = request;

    console.log(`🔥 [Unity TX] handleTransactionRequest called:`, { requestId, type, hasData: !!rawData });

    // ========== BACKGROUND CHECK - Block transactions when app not visible ==========
    if (!isAppVisibleRef.current) {
      console.warn(`🚫 [Unity TX] BLOCKED: App is in background - transaction "${type}" rejected for safety`);
      sendTransactionResult(requestId, false, undefined, 'Transaction blocked - app is in background. Please bring the app to foreground and try again.');
      return;
    }

    // ========== DUPLICATE PREVENTION CHECKS ==========

    // Only apply duplicate checks if we have a valid requestId
    if (requestId) {
      // Check 1: Have we already processed this exact requestId?
      if (processedRequestIdsRef.current.has(requestId)) {
        console.warn(`🚫 [Unity TX] BLOCKED: Duplicate requestId "${requestId}" - already processed`);
        return;
      }

      // Mark this requestId as processed (with auto-cleanup after 30s)
      processedRequestIdsRef.current.add(requestId);
      setTimeout(() => {
        processedRequestIdsRef.current.delete(requestId);
      }, REQUEST_ID_EXPIRY_MS);
    }

    // Check 2: Is there already a pending transaction of this TYPE?
    if (type && pendingTransactionTypesRef.current.has(type)) {
      console.warn(`🚫 [Unity TX] BLOCKED: Transaction type "${type}" already pending - wait for completion`);
      sendTransactionResult(requestId, false, undefined, `A ${type} transaction is already pending. Please wait.`);
      return;
    }

    // Mark this transaction type as pending (if we have a type)
    if (type) {
      pendingTransactionTypesRef.current.add(type);
      console.log(`🔒 [Unity TX] LOCKED: Transaction type "${type}" now pending (requestId: ${requestId})`);
    }

    // ========== VALIDATION CHECKS ==========

    // Validate prerequisites
    if (!isConnected || !address) {
      console.error('🔥 [Unity TX] ERROR: Wallet not connected!', { isConnected, address });
      if (type) pendingTransactionTypesRef.current.delete(type); // Release lock
      sendTransactionResult(requestId, false, undefined, 'Wallet not connected');
      return;
    }

    if (!writeContractAsync) {
      console.error('🔥 [Unity TX] ERROR: writeContractAsync not available!');
      if (type) pendingTransactionTypesRef.current.delete(type); // Release lock
      sendTransactionResult(requestId, false, undefined, 'Contract write not available');
      return;
    }
    // Unity may send data as JSON string, parse it if needed
    const data: Record<string, string | number> = typeof rawData === 'string'
      ? JSON.parse(rawData || '{}')
      : (rawData || {});

    // console.log('🔥 [Unity TX] Parsed data:', { requestId, type, data, rawDataType: typeof rawData });

    pendingTxRef.current = requestId;
    pendingTxTypeRef.current = type; // Track type for lock release on receipt
    onTransaction?.(request);

    // Use base.id like InventorySack does for consistency
    const contracts = getContracts(base.id);
    // console.log('🔥 [Unity TX] Contracts:', {
    //   stakingAddress: contracts.staking?.address,
    //   nftAddress: contracts.nft?.address,
    //   chainId: base.id
    // });

    if (!contracts.nft) {
      console.error('🔥 [Unity TX] ERROR: Contracts not configured');
      sendTransactionResult(requestId, false, undefined, 'Contracts not configured');
      return;
    }

    try {
      let hash: `0x${string}`;

      switch (type) {
        case 'mint':
          hash = await writeContractAsync({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'mint',
            args: [BigInt(data.quantity || 1)],
          });
          break;

        case 'jail':
          hash = await writeContractAsync({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'jailToken',
            args: [BigInt(data.tokenId)],
          });
          break;

        case 'bail':
          hash = await writeContractAsync({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'bailToken',
            args: [BigInt(data.tokenId)],
          });
          break;

        case 'breed':
          hash = await writeContractAsync({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'breed',
            args: [BigInt(data.parent1), BigInt(data.parent2)],
          });
          break;

        case 'feed':
          hash = await writeContractAsync({
            address: contracts.nft.address,
            abi: contracts.nft.abi,
            functionName: 'feed',
            args: [BigInt(data.tokenId)],
          });
          break;

        case 'wrap':
          if (!contracts.wrapper) throw new Error('Wrapper contract not configured');
          hash = await writeContractAsync({
            address: contracts.wrapper.address,
            abi: contracts.wrapper.abi,
            functionName: 'wrap',
            args: [BigInt(data.amount)],
          });
          break;

        case 'unwrap':
          if (!contracts.wrapper) throw new Error('Wrapper contract not configured');
          hash = await writeContractAsync({
            address: contracts.wrapper.address,
            abi: contracts.wrapper.abi,
            functionName: 'unwrap',
            args: [BigInt(data.tokenId)],
          });
          break;

        // ========== STAKING TRANSACTIONS ==========
        case 'stake': {
          console.log('🥩 [Unity TX] STAKE requested, tokenId:', data.tokenId);
          const tokenIdNum = Number(data.tokenId);

          // Direct transaction - stake the NFT immediately
          if (!contracts.staking || contracts.staking.address === '0x0000000000000000000000000000000000000000') {
            console.error('🔥 [Unity TX] Staking contract not configured!');
            throw new Error('Staking contract not configured');
          }
          const stakeTokenId = BigInt(tokenIdNum);
          console.log('🥩 [Unity TX] Calling staking contract for tokenId:', stakeTokenId.toString());
          hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'stake',
            args: [[stakeTokenId]],
          });
          console.log('🥩 [Unity TX] Stake transaction hash:', hash);
          break;
        }

        case 'unstake': {
          console.log('📤 [Unity TX] UNSTAKE requested, tokenId:', data.tokenId);
          const unstakeTokenIdNum = Number(data.tokenId);

          // Direct transaction - unstake the NFT immediately
          if (!contracts.staking || contracts.staking.address === '0x0000000000000000000000000000000000000000') {
            throw new Error('Staking contract not configured');
          }
          const unstakeTokenId = BigInt(unstakeTokenIdNum);
          console.log('📤 [Unity TX] Calling unstaking contract for tokenId:', unstakeTokenId.toString());
          hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'unstake',
            args: [[unstakeTokenId]],
          });
          console.log('📤 [Unity TX] Unstake transaction hash:', hash);
          break;
        }

        case 'stakeAll':
          if (!contracts.staking || contracts.staking.address === '0x0000000000000000000000000000000000000000') {
            throw new Error('Staking contract not configured');
          }
          // Unity sends tokenIds as array of strings
          const stakeTokenIds = (data.tokenIds as unknown as string[]).map((id: string) => BigInt(id));
          hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'stake',
            args: [stakeTokenIds],
          });
          break;

        case 'unstakeAll':
          if (!contracts.staking || contracts.staking.address === '0x0000000000000000000000000000000000000000') {
            throw new Error('Staking contract not configured');
          }
          // Get all staked tokens and unstake them
          const unstakeTokenIds = Array.from(stakedTokenIds).map((id: string) => BigInt(id));
          if (unstakeTokenIds.length === 0) {
            throw new Error('No staked tokens to unstake');
          }
          hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'unstake',
            args: [unstakeTokenIds],
          });
          break;

        case 'claimRewards':
          if (!contracts.staking || contracts.staking.address === '0x0000000000000000000000000000000000000000') {
            throw new Error('Staking contract not configured');
          }
          hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'claimRewards',
            args: [],
          });
          break;

        default:
          throw new Error(`Unknown transaction type: ${type}`);
      }

      // Add to transaction notifications
      addTransaction(hash, `Unity: ${type}`);
      setPendingTxHash(hash);

      // console.log('[Unity] Transaction submitted:', hash);

    } catch (err) {
      console.error('🔥 [Unity TX] TRANSACTION FAILED:', err);
      const errorMsg = err instanceof Error ? err.message : 'Transaction failed';
      console.error('🔥 [Unity TX] Error message:', errorMsg);
      sendTransactionResult(requestId, false, undefined, errorMsg);
      pendingTxRef.current = null;
      // Release the transaction type lock on error
      if (type) {
        pendingTransactionTypesRef.current.delete(type);
        console.log(`🔓 [Unity TX] UNLOCKED: Transaction type "${type}" released (error)`);
      }
    }
  }, [chainId, writeContractAsync, addTransaction, sendTransactionResult, onTransaction, stakedTokenIds, isConnected, address, onStakeRequest, onUnstakeRequest]);

  // DEBUG: Expose test function to window for manual testing
  useEffect(() => {
    // Test function to simulate Unity message - run this in browser console:
    // window.testUnityStake('1234')
    (window as unknown as Record<string, unknown>).testUnityStake = (tokenId: string) => {
      // console.log('🧪 [TEST] Simulating Unity stake message for tokenId:', tokenId);
      window.postMessage({
        source: 'unity',
        type: 'unity-transaction',
        payload: {
          requestId: `test_${Date.now()}`,
          type: 'stake',
          data: { tokenId }
        }
      }, '*');
    };
    // console.log('🧪 [TEST] window.testUnityStake() available - use testUnityStake("tokenId") to test');
    return () => {
      delete (window as unknown as Record<string, unknown>).testUnityStake;
    };
  }, []);

  // MAIN UNITY MESSAGE HANDLER - Uses refs to avoid stale closures
  // This runs OUTSIDE of loadUnity so it's always active and always uses latest handlers
  useEffect(() => {
    const handleUnityMessage = (event: MessageEvent) => {
      // DEBUG: Log ALL messages to see what's actually being received
      if (event.data && typeof event.data === 'object') {
        // Skip React DevTools and other noise
        if (event.data.source === 'react-devtools-bridge' ||
            event.data.source === 'react-devtools-content-script' ||
            event.data.type === 'webpackHotUpdate') {
          return;
        }
        console.log('🌐 [ALL MSG]', JSON.stringify(event.data).substring(0, 200));
      }

      // Filter for Unity messages
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.source !== 'unity' && !event.data.type?.startsWith('unity-')) {
        // DEBUG: Log messages that ALMOST match (have 'unity' anywhere)
        const dataStr = JSON.stringify(event.data);
        if (dataStr.toLowerCase().includes('unity') || dataStr.includes('transaction') || dataStr.includes('stake')) {
          console.log('⚠️ [FILTERED OUT] Message contains unity/transaction but failed filter:', event.data);
        }
        return;
      }

      const { type, payload } = event.data;
      console.log('✅ [React] Received Unity message:', type, payload);

      switch (type) {
        case 'unity-ready':
          break;

        case 'unity-request-auth':
          // console.log('🔥 [Unity] Auth request - calling performAutoAuth');
          performAutoAuthRef.current();
          break;

        case 'unity-request-user-data':
          // console.log('🔥 [Unity] User data request - calling sendUserDataToUnity');
          sendUserDataToUnityRef.current();
          break;

        case 'unity-transaction':
          console.log('[React] Transaction request:', payload);
          try {
            handleTransactionRequestRef.current(payload as TransactionRequest);
            // console.log('🔥 [Unity] handleTransactionRequestRef.current called (async, check for follow-up logs)');
          } catch (err) {
            console.error('❌ [Unity] Error calling handleTransactionRequest:', err);
          }
          break;

        case 'unity-navigate':
          if (payload?.route) {
            // console.log('🔥 [Unity] Navigate to:', payload.route);
            router.push(payload.route);
          }
          break;

        case 'unity-action':
          // console.log('🔥 [Unity] Game action:', payload);
          handleGameActionRef.current(payload as GameAction);
          break;

        // ========== AUTHENTICATION MESSAGE HANDLERS ==========
        case 'unity-request-connect':
          console.log('🔗 [Unity] Connect request received');
          handleConnectRequestRef.current();
          break;

        case 'unity-request-signature':
          console.log('✍️ [Unity] Signature request received:', payload);
          handleSignatureRequestRef.current(payload as SignatureRequest);
          break;

        case 'unity-request-stored-signature':
          console.log('📦 [Unity] Stored signature request received');
          handleStoredSignatureRequestRef.current();
          break;

        default:
          // console.log('❓ [Unity] Unknown message type:', type);
          break;
      }
    };

    window.addEventListener('message', handleUnityMessage);
    console.log('✅ [Unity] Message listener attached to window at', new Date().toISOString());

    return () => {
      window.removeEventListener('message', handleUnityMessage);
      console.log('🔴 [Unity] Message listener removed at', new Date().toISOString());
    };
  }, [router]); // Only depends on router which is stable

  // GLOBAL FALLBACK LISTENER - Catches ALL postMessages for debugging
  useEffect(() => {
    const globalDebugListener = (event: MessageEvent) => {
      // Only log if it contains unity-related keywords
      if (event.data && typeof event.data === 'object') {
        const dataStr = JSON.stringify(event.data);
        if (dataStr.includes('unity') || dataStr.includes('Unity') ||
            dataStr.includes('stake') || dataStr.includes('transaction') ||
            dataStr.includes('requestId')) {
          console.log('🔥 [GLOBAL] Unity-related message detected:', event.data);
        }
      }
    };

    window.addEventListener('message', globalDebugListener);
    console.log('🎯 [GLOBAL] Debug listener attached');

    return () => {
      window.removeEventListener('message', globalDebugListener);
    };
  }, []);

  // Track page visibility - block transactions when app is in background
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      setIsAppVisible(isVisible);
      isAppVisibleRef.current = isVisible;
      console.log(`👁️ [Visibility] App is now ${isVisible ? 'VISIBLE' : 'HIDDEN'}`);
    };

    // Also track window focus/blur for additional safety
    const handleFocus = () => {
      setIsAppVisible(true);
      isAppVisibleRef.current = true;
      console.log('👁️ [Visibility] Window focused - app VISIBLE');
    };

    const handleBlur = () => {
      setIsAppVisible(false);
      isAppVisibleRef.current = false;
      console.log('👁️ [Visibility] Window blurred - app HIDDEN');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Set initial state
    const initialVisible = document.visibilityState === 'visible';
    setIsAppVisible(initialVisible);
    isAppVisibleRef.current = initialVisible;

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Handle transaction receipt
  useEffect(() => {
    if (!pendingTxHash || !pendingTxRef.current) return;

    if (txSuccess) {
      sendTransactionResult(pendingTxRef.current, true, pendingTxHash);
      updateTransaction(pendingTxHash, 'success');
      refetchNFTs();
      // Release transaction type lock on success
      if (pendingTxTypeRef.current) {
        pendingTransactionTypesRef.current.delete(pendingTxTypeRef.current);
        console.log(`🔓 [Unity TX] UNLOCKED: Transaction type "${pendingTxTypeRef.current}" released (success)`);
        pendingTxTypeRef.current = null;
      }
      pendingTxRef.current = null;
      setPendingTxHash(undefined);
    } else if (txError) {
      sendTransactionResult(pendingTxRef.current, false, pendingTxHash, 'Transaction failed');
      updateTransaction(pendingTxHash, 'error');
      // Release transaction type lock on error
      if (pendingTxTypeRef.current) {
        pendingTransactionTypesRef.current.delete(pendingTxTypeRef.current);
        console.log(`🔓 [Unity TX] UNLOCKED: Transaction type "${pendingTxTypeRef.current}" released (tx error)`);
        pendingTxTypeRef.current = null;
      }
      pendingTxRef.current = null;
      setPendingTxHash(undefined);
    }
  }, [txSuccess, txError, pendingTxHash, sendTransactionResult, updateTransaction, refetchNFTs]);

  // Handle game actions from Unity (staking, feeding, breeding, etc.)
  const handleGameAction = useCallback(async (payload: GameAction) => {
    const { action, data: rawData } = payload;

    // ========== BACKGROUND CHECK - Block transaction actions when app not visible ==========
    const transactionActions = ['stakeAll', 'claimRewards', 'toggleStake', 'feedNFT'];
    if (transactionActions.includes(action) && !isAppVisibleRef.current) {
      console.warn(`🚫 [Unity Action] BLOCKED: App is in background - action "${action}" rejected for safety`);
      sendActionResult(action, false, undefined, 'Action blocked - app is in background. Please bring the app to foreground and try again.');
      return;
    }

    // ========== DUPLICATE PREVENTION FOR GAME ACTIONS ==========
    // Actions that trigger blockchain transactions need lock protection
    if (transactionActions.includes(action)) {
      if (pendingGameActionsRef.current.has(action)) {
        console.warn(`🚫 [Unity Action] BLOCKED: Action "${action}" already pending - wait for completion`);
        sendActionResult(action, false, undefined, `A ${action} action is already pending. Please wait.`);
        return;
      }
      pendingGameActionsRef.current.add(action);
      console.log(`🔒 [Unity Action] LOCKED: Action "${action}" now pending`);
    }

    // Unity sends data as JSON string, parse it
    const data: Record<string, unknown> = typeof rawData === 'string'
      ? JSON.parse(rawData || '{}')
      : (rawData || {});
    // console.log('[Unity] Handling game action:', action, data);

    // Call the optional callback for parent component handling
    onGameAction?.(payload);

    const contracts = getContracts(chainId);

    // Check if staking contract is available
    if (!contracts.staking || contracts.staking.address === '0x0000000000000000000000000000000000000000') {
      if (['stakeAll', 'claimRewards', 'toggleStake'].includes(action)) {
        console.warn('[Unity] Staking contract not configured');
        pendingGameActionsRef.current.delete(action); // Release lock
        sendActionResult(action, false, undefined, 'Staking not available');
        return;
      }
    }

    try {
      switch (action) {
        case 'stakeAll': {
          // Get all unstaked snake NFTs (only snakes can be staked, exclude already staked)
          const unstaked = nfts?.filter(nft =>
            nft.isSnake &&
            !nft.isJailed &&
            !stakedTokenIds.has(nft.tokenId.toString())
          ) || [];
          if (unstaked.length === 0) {
            sendActionResult(action, false, undefined, 'No NFTs available to stake');
            return;
          }

          const tokenIds = unstaked.map(nft => BigInt(nft.tokenId));
          // console.log('[Unity] Staking NFTs:', tokenIds.map(id => id.toString()));

          const hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'stake',
            args: [tokenIds],
          });

          addTransaction(hash, `Stake ${tokenIds.length} NFTs`);
          sendActionResult(action, true, { stakedCount: tokenIds.length, txHash: hash });

          // Refresh data after a delay
          setTimeout(() => {
            refetchNFTs();
            refetchStakingStats();
            refetchStakedTokens();
            sendUserDataToUnityRef.current();
          }, 3000);
          break;
        }

        case 'claimRewards': {
          // console.log('[Unity] Claiming rewards');

          const hash = await writeContractAsync({
            address: contracts.staking.address,
            abi: contracts.staking.abi,
            functionName: 'claimRewards',
            args: [],
          });

          addTransaction(hash, 'Claim staking rewards');
          sendActionResult(action, true, { txHash: hash });

          // Refresh data after a delay
          setTimeout(() => {
            refetchStakingStats();
            refetchStakedTokens();
            sendUserDataToUnityRef.current();
          }, 3000);
          break;
        }

        case 'toggleStake': {
          const tokenId = data.tokenId;
          if (!tokenId) {
            sendActionResult(action, false, undefined, 'No tokenId provided');
            return;
          }

          // Check if token is currently staked using our stakedTokenIds Set
          const isCurrentlyStaked = stakedTokenIds.has(tokenId.toString());
          // console.log('[Unity] Toggle stake for token:', tokenId, 'currently staked:', isCurrentlyStaked);

          if (isCurrentlyStaked) {
            // Unstake
            const hash = await writeContractAsync({
              address: contracts.staking.address,
              abi: contracts.staking.abi,
              functionName: 'unstake',
              args: [[BigInt(tokenId as string)]],
            });

            addTransaction(hash, `Unstake NFT #${tokenId}`);
            sendActionResult(action, true, { tokenId, newStatus: 'unstaked', txHash: hash });
          } else {
            // Stake
            const hash = await writeContractAsync({
              address: contracts.staking.address,
              abi: contracts.staking.abi,
              functionName: 'stake',
              args: [[BigInt(tokenId as string)]],
            });

            addTransaction(hash, `Stake NFT #${tokenId}`);
            sendActionResult(action, true, { tokenId, newStatus: 'staked', txHash: hash });
          }

          // Refresh data after a delay
          setTimeout(() => {
            refetchNFTs();
            refetchStakingStats();
            refetchStakedTokens();
            sendUserDataToUnityRef.current();
          }, 3000);
          break;
        }

        case 'openNFT': {
          // Navigate to NFT detail page
          const tokenId = data.tokenId;
          if (tokenId) {
            router.push(`/nft/${tokenId}`);
          }
          sendActionResult(action, true, { tokenId });
          break;
        }

        case 'feedNFT': {
          // Feeding is handled via transaction request
          const tokenId = data.tokenId;
          if (tokenId) {
            // Trigger feed transaction using ref to ensure latest version
            await handleTransactionRequestRef.current({
              requestId: `feed_${Date.now()}`,
              type: 'feed',
              data: { tokenId: Number(tokenId) },
            });
          }
          sendActionResult(action, true, { tokenId });
          break;
        }

        case 'breedNFT': {
          // Breeding requires selecting two NFTs - just acknowledge for now
          const tokenId = data.tokenId;
          sendActionResult(action, true, { tokenId, message: 'Select second NFT to breed' });
          break;
        }

        default:
          console.warn('[Unity] Unknown action:', action);
          sendActionResult(action, false, undefined, `Unknown action: ${action}`);
      }
    } catch (err) {
      console.error('[Unity] Action failed:', action, err);
      const errorMsg = err instanceof Error ? err.message : 'Action failed';
      sendActionResult(action, false, undefined, errorMsg);
    } finally {
      // Release game action lock after completion (success or error)
      if (pendingGameActionsRef.current.has(action)) {
        pendingGameActionsRef.current.delete(action);
        console.log(`🔓 [Unity Action] UNLOCKED: Action "${action}" released`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, nfts, stakedTokenIds, writeContractAsync, addTransaction, onGameAction, router, refetchStakingStats, refetchStakedTokens, refetchNFTs, sendActionResult]);

  // Wrapper for sendUserDataToUnity that can be called from handleGameAction
  const sendUserDataToUnityRef = useRef<() => void>(() => {});

  // Refs to hold latest handlers to avoid stale closures in message listener
  const handleTransactionRequestRef = useRef<typeof handleTransactionRequest>(handleTransactionRequest);
  const handleGameActionRef = useRef<typeof handleGameAction>(handleGameAction);
  const performAutoAuthRef = useRef<typeof performAutoAuth>(performAutoAuth);
  const handleConnectRequestRef = useRef<typeof handleConnectRequest>(handleConnectRequest);
  const handleSignatureRequestRef = useRef<typeof handleSignatureRequest>(handleSignatureRequest);
  const handleStoredSignatureRequestRef = useRef<typeof handleStoredSignatureRequest>(handleStoredSignatureRequest);
  const sendConnectionStatusRef = useRef<typeof sendConnectionStatus>(sendConnectionStatus);

  // Send user data to Unity (with token balance)
  const sendUserDataToUnity = useCallback(() => {
    const instance = unityInstanceRef.current;
    if (!instance || !isConnected || !address) return;

    const userData = {
      walletAddress: address,
      isConnected: true,
      nftCount: nfts?.length || 0,
      nfts: nfts?.map(nft => {
        const tokenIdStr = nft.tokenId.toString();
        const isStaked = stakedTokenIds.has(tokenIdStr);
        return {
          tokenId: tokenIdStr,
          name: nft.name,
          nftType: nft.nftType,
          imageUrl: nft.imageUrl,
          owner: nft.owner,
          exists: nft.exists,
          isSnake: nft.isSnake,
          isJailed: nft.isJailed,
          jailTime: nft.jailTime,
          isEgg: nft.isEgg,
          mintTime: nft.mintTime,
          forceHatched: nft.forceHatched,
          evolved: nft.evolved,
          ownerIsWarden: nft.ownerIsWarden,
          ownerIsJailExempt: nft.ownerIsJailExempt,
          swapMintTime: nft.swapMintTime,
          canUnwrap: nft.canUnwrap,
          // STAKING STATUS - Required for tabs to work
          isStaked: isStaked,
          stakedAt: 0, // Could track timestamp if needed
        };
      }) || [],
      tokenBalance: tokenBalanceData ? {
        balance: tokenBalanceData.value.toString(),
        formattedBalance: tokenBalanceData.formatted,
        symbol: tokenBalanceData.symbol,
        decimals: tokenBalanceData.decimals,
      } : null,

      // Required for InventoryUI display
      ethBalance: ethBalanceData?.formatted?.slice(0, 8) || '0',
      wTokenBalance: tokenBalanceData?.formatted?.slice(0, 10) || '0', // Use token balance as wrapped token
      stakedCount: stakedCount,
      pendingRewards: pendingRewards.slice(0, 8),
    };

    try {
      instance.SendMessage('WebGLBridge', 'OnUserDataReceived', JSON.stringify(userData));
      // console.log('[Unity] Sent user data:', userData.nftCount, 'NFTs, ETH:', userData.ethBalance);
    } catch (e) {
      // console.warn('[Unity] WebGLBridge not ready');
    }
  }, [isConnected, address, nfts, tokenBalanceData, ethBalanceData, stakedCount, pendingRewards, stakedTokenIds]);

  // Update ref so handleGameAction can call sendUserDataToUnity
  sendUserDataToUnityRef.current = sendUserDataToUnity;

  // Keep refs updated with latest handlers (avoids stale closures)
  useEffect(() => {
    handleTransactionRequestRef.current = handleTransactionRequest;
  }, [handleTransactionRequest]);

  useEffect(() => {
    handleGameActionRef.current = handleGameAction;
  }, [handleGameAction]);

  useEffect(() => {
    performAutoAuthRef.current = performAutoAuth;
  }, [performAutoAuth]);

  useEffect(() => {
    handleConnectRequestRef.current = handleConnectRequest;
  }, [handleConnectRequest]);

  useEffect(() => {
    handleSignatureRequestRef.current = handleSignatureRequest;
  }, [handleSignatureRequest]);

  useEffect(() => {
    handleStoredSignatureRequestRef.current = handleStoredSignatureRequest;
  }, [handleStoredSignatureRequest]);

  useEffect(() => {
    sendConnectionStatusRef.current = sendConnectionStatus;
  }, [sendConnectionStatus]);

  // Clear connect pending flag when wallet connects
  useEffect(() => {
    if (isConnected) {
      connectRequestPendingRef.current = false;
    }
  }, [isConnected]);

  // Send user data when Unity is ready and auth is complete
  useEffect(() => {
    if (isUnityReady && isConnected && authStatus === 'ready') {
      sendUserDataToUnity();
    }
  }, [isUnityReady, isConnected, authStatus, sendUserDataToUnity]);

  // Handle wallet disconnect
  useEffect(() => {
    if (!isConnected && authData) {
      // Clear auth when wallet disconnects
      setAuthData(null);
      setAuthStatus('idle');
      sessionStorage.removeItem(JWT_CACHE_KEY);
      sessionStorage.removeItem(JWT_ADDRESS_KEY);

      // Notify Unity
      const instance = unityInstanceRef.current;
      if (instance) {
        try {
          instance.SendMessage('WebGLBridge', 'OnWalletDisconnected', '');
        } catch (e) {
          // Ignore
        }
      }
    }
  }, [isConnected, authData]);

  // Load Unity - NOTE: Message handling is now in a separate useEffect with refs
  useEffect(() => {
    if (!visible || !canvasRef.current) return;

    let mounted = true;
    const canvas = canvasRef.current;

    // SET UP GLOBAL BRIDGE FUNCTIONS BEFORE UNITY LOADS
    // These functions allow Unity to communicate with React via postMessage
    // Unity may call these from C# via Application.ExternalCall or jslib plugins

    // MONKEY-PATCH: Intercept ALL postMessage calls to debug where Unity is sending messages
    const originalWindowPostMessage = window.postMessage.bind(window);
    const originalParentPostMessage = window.parent?.postMessage?.bind(window.parent);

    // Patch window.postMessage
    window.postMessage = function(message: unknown, targetOrigin?: string, transfer?: Transferable[]) {
      if (message && typeof message === 'object') {
        const msgStr = JSON.stringify(message);
        if (msgStr.includes('unity') || msgStr.includes('stake') || msgStr.includes('transaction') || msgStr.includes('requestId')) {
          console.log('🔧 [PATCHED window.postMessage]', message);
        }
      }
      // Handle undefined targetOrigin (some wallet extensions pass undefined)
      const safeOrigin = targetOrigin || '*';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalWindowPostMessage as any).call(window, message, safeOrigin, transfer);
    } as typeof window.postMessage;

    // Patch window.parent.postMessage if different from window
    if (window.parent && window.parent !== window && window.parent.postMessage) {
      window.parent.postMessage = function(message: unknown, targetOrigin?: string, transfer?: Transferable[]) {
        if (message && typeof message === 'object') {
          const msgStr = JSON.stringify(message);
          if (msgStr.includes('unity') || msgStr.includes('stake') || msgStr.includes('transaction') || msgStr.includes('requestId')) {
            console.log('🔧 [PATCHED parent.postMessage] Intercepted! Forwarding to window:', message);
            // Also post to current window so our listener catches it
            originalWindowPostMessage(message, '*');
          }
        }
        const safeOrigin = targetOrigin || '*';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalParentPostMessage as any)?.call(window.parent, message, safeOrigin, transfer);
      } as typeof window.postMessage;
    }

    console.log('🔧 [PATCH] postMessage interceptors installed');

    // DIRECT CALLABLE FUNCTIONS - Unity might call these directly via jslib
    // Instead of postMessage, Unity C# code might call window.functionName(data)
    (window as unknown as Record<string, unknown>).SendTransactionToReact = (jsonData: string) => {
      console.log('🎯 [DIRECT CALL] SendTransactionToReact:', jsonData);
      const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      window.postMessage({ source: 'unity', type: 'unity-transaction', payload: data }, '*');
    };

    (window as unknown as Record<string, unknown>).UnityMessage = (type: string, jsonData: string) => {
      console.log('🎯 [DIRECT CALL] UnityMessage:', type, jsonData);
      const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      window.postMessage({ source: 'unity', type: type, payload: data }, '*');
    };

    // Intercept console.log to see what Unity is actually calling
    // Unity uses CSS-styled logs: console.log('%c[Unity → React]%c', 'css...', 'css...', 'unity-transaction', data)
    const originalConsoleLog = console.log.bind(console);
    console.log = function(...args: unknown[]) {
      // Check if this is Unity's outgoing message log (handles CSS-styled format)
      const argsStr = args.map(a => typeof a === 'string' ? a : '').join(' ');
      if (argsStr.includes('Unity → React') || argsStr.includes('Unity -> React')) {
        originalConsoleLog('🔍 [INTERCEPTED UNITY LOG]', ...args);

        // Find the message type and data in the args
        // Unity format: ['%c[Unity → React]%c', 'css', 'css', 'unity-request-connect', {data}]
        // Or: ['[Unity → React]', 'unity-request-connect', {data}]
        let messageType: string | null = null;
        let payload: unknown = {};

        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          // Check for all Unity message types
          if (typeof arg === 'string') {
            if (arg.includes('unity-request-connect')) {
              messageType = 'unity-request-connect';
            } else if (arg.includes('unity-request-signature') && !arg.includes('stored')) {
              messageType = 'unity-request-signature';
            } else if (arg.includes('unity-request-stored-signature')) {
              messageType = 'unity-request-stored-signature';
            } else if (arg.includes('unity-request-user-data')) {
              messageType = 'unity-request-user-data';
            } else if (arg.includes('unity-transaction')) {
              messageType = 'unity-transaction';
            } else if (arg.includes('unity-navigate')) {
              messageType = 'unity-navigate';
            } else if (arg.includes('unity-action')) {
              messageType = 'unity-action';
            } else if (arg.includes('unity-ready')) {
              messageType = 'unity-ready';
            }
          }
          // Capture payload object (has requestId or is an object after message type)
          if (arg && typeof arg === 'object') {
            payload = arg;
          }
        }

        if (messageType) {
          // Auto-forward all Unity messages - deduplication handled in message handler
          originalConsoleLog('🔄 [AUTO-FORWARD] Forwarding Unity message to React:', messageType, payload);
          window.postMessage({
            source: 'unity',
            type: messageType,
            payload: payload
          }, '*');
        }
      }
      return originalConsoleLog(...args);
    };

    console.log('🎯 [DIRECT] Direct callable functions and console interceptor installed');

    // Primary bridge function - Unity calls this to send messages to React
    (window as unknown as Record<string, unknown>).sendToReact = (messageType: string, payload: unknown) => {
      console.log('🌉 [Bridge] sendToReact called:', messageType, payload);
      window.postMessage({
        source: 'unity',
        type: messageType,
        payload: payload
      }, '*');
    };

    // Override sendToAppleSnakesParent to post to current window (not parent)
    // This fixes the issue where Unity posts to parent but we're not in an iframe
    (window as unknown as Record<string, unknown>).sendToAppleSnakesParent = (data: unknown) => {
      console.log('🌉 [Bridge] sendToAppleSnakesParent called:', data);
      // Post to current window so our listener catches it
      window.postMessage(data, '*');
      // Also try parent in case we ARE in an iframe
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(data, '*');
      }
    };

    // Unity transaction shortcut
    (window as unknown as Record<string, unknown>).unityTransaction = (requestId: string, type: string, data: unknown) => {
      console.log('🌉 [Bridge] unityTransaction called:', { requestId, type, data });
      window.postMessage({
        source: 'unity',
        type: 'unity-transaction',
        payload: { requestId, type, data }
      }, '*');
    };

    console.log('🌉 [Bridge] Global Unity bridge functions registered');

    const loadUnity = async () => {
      try {
        // Construct paths from props with cache-busting
        const cacheBust = `?v=${Date.now()}`;
        const loaderUrl = `${buildUrl}/Build/${productName}.loader.js${cacheBust}`;
        const dataUrl = `${buildUrl}/Build/${productName}.data${cacheBust}`;
        const frameworkUrl = `${buildUrl}/Build/${productName}.framework.js${cacheBust}`;
        const codeUrl = `${buildUrl}/Build/${productName}.wasm${cacheBust}`;
        const streamingAssetsUrl = `${buildUrl}/StreamingAssets`;

        console.log('[Unity] Loading from:', loaderUrl);

        if (!window.createUnityInstance) {
          const script = document.createElement('script');
          script.src = loaderUrl;
          script.async = true;

          await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load Unity loader from ${loaderUrl}`));
            document.body.appendChild(script);
          });
        }

        if (!mounted) return;

        const config: UnityConfig = {
          dataUrl,
          frameworkUrl,
          codeUrl,
          streamingAssetsUrl,
          companyName: 'AppleSnakes',
          productName,
          productVersion: '1.0',
          showBanner: (msg, type) => {
            // console.log(`[Unity ${type}]`, msg);
            if (type === 'error') setError(msg);
          },
        };

        // console.log('[Unity] Creating instance with config:', { dataUrl, frameworkUrl, codeUrl });

        const instance = await window.createUnityInstance(canvas, config, (progress) => {
          if (mounted) setLoadProgress(Math.round(progress * 100));
        });

        if (!mounted) {
          instance.Quit();
          return;
        }

        unityInstanceRef.current = instance;
        window.unityInstance = instance;
        setIsLoading(false);
        setIsUnityReady(true);

        // console.log('[Unity] Instance created successfully');
        onUnityReady?.();

        // Message handling is now in a separate useEffect that uses refs
        // Auto-authenticate if wallet is already connected
        if (isConnected && address) {
          performAutoAuthRef.current();
        }

      } catch (err) {
        if (mounted) {
          console.error('[Unity] Load error:', err);
          setError(err instanceof Error ? err.message : 'Failed to load Unity');
          setIsLoading(false);
        }
      }
    };

    loadUnity();

    return () => {
      mounted = false;
      // Message listener cleanup is handled by its own useEffect
      if (unityInstanceRef.current) {
        unityInstanceRef.current.Quit().catch(console.error);
        unityInstanceRef.current = null;
        window.unityInstance = null;
      }
      // Clean up bridge functions
      delete (window as unknown as Record<string, unknown>).sendToReact;
      delete (window as unknown as Record<string, unknown>).sendToAppleSnakesParent;
      delete (window as unknown as Record<string, unknown>).unityTransaction;
      console.log('🌉 [Bridge] Global Unity bridge functions removed');
      setIsUnityReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Trigger auth when wallet connects after Unity is loaded
  useEffect(() => {
    if (isUnityReady && isConnected && address && authStatus === 'idle') {
      performAutoAuth();
    }
  }, [isUnityReady, isConnected, address, authStatus, performAutoAuth]);

  const handleFullscreen = useCallback(() => {
    unityInstanceRef.current?.SetFullscreen(1);
  }, []);

  // Expose fullscreen handler to parent via window for Navigation to call
  useEffect(() => {
    (window as unknown as Record<string, unknown>).unityFullscreen = handleFullscreen;
    return () => {
      delete (window as unknown as Record<string, unknown>).unityFullscreen;
    };
  }, [handleFullscreen]);

  if (!visible) return null;

  // Auto-refresh on error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        window.location.reload();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div
      ref={containerRef}
      className={`fixed z-30 transition-all duration-300 top-16 left-0 right-0 bottom-0 ${className}`}
    >
      {/* Unity Canvas Container - Full screen without header */}
      <div className="relative bg-black overflow-hidden w-full h-full">
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-green-900 to-green-950 z-20">
            <div className="text-green-100 text-xl mb-4">Loading {productName}...</div>
            <div className="w-64 h-3 bg-green-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
            <div className="text-green-300 mt-2">{loadProgress}%</div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/90 z-20 p-8">
            <div className="text-red-100 text-xl mb-4">Failed to load game</div>
            <div className="text-red-200 text-sm text-center max-w-md">{error}</div>
            <div className="text-red-300 text-sm mt-2">Refreshing in 3 seconds...</div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          id="unity-canvas"
          className="w-full h-full"
          tabIndex={-1}
          style={{
            display: isLoading || error ? 'none' : 'block',
            width: '100%',
            height: '100%',
          }}
        />
      </div>

    </div>
  );
}
