'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ============================================================================
// Configuration - Using simple payment headers (NOT X-PAYMENT base64)
// ============================================================================

const X402_CONFIG = {
  // Use local proxy routes which forward to https://api.applesnakes.com
  API_BASE_URL: '',

  // Payment recipient (AI Wallet) - checksummed
  PAYMENT_RECIPIENT: '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098' as const,

  // USDC on Base
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  USDC_DECIMALS: 6,

  // Prices
  VERIFY_PRICE_USDC: 0.50,
  MIN_LAUNCH_PRICE_USDC: 1.00,
};

const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

// ============================================================================
// Types
// ============================================================================

interface VerificationResult {
  success: boolean;
  verified: boolean;
  confidence: number;
  reason: string;
  ipfsUrl: string | null;
  imageCid: string | null;
  hasCuteFace?: boolean;
}

interface LaunchResult {
  success: boolean;
  launchId?: string;
  tokenAddress?: string;
  error?: string;
  message?: string;
  token?: {
    name: string;
    symbol: string;
    imageUrl: string;
  };
  result?: {
    tokenAddress: string;
  };
}

type LauncherStep = 'select' | 'details' | 'complete';
type LauncherStatus = 'idle' | 'paying' | 'verifying' | 'launching' | 'error';

// ============================================================================
// Main Component
// ============================================================================

export function VerifiedTokenLauncher() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { openConnectModal } = useConnectModal();
  const { writeContractAsync } = useWriteContract();

  // Step tracking
  const [step, setStep] = useState<LauncherStep>('select');
  const [status, setStatus] = useState<LauncherStatus>('idle');

  // Form state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [devBuyBudget, setDevBuyBudget] = useState(5);

  // Results
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [launch, setLaunch] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Get USDC balance
  const { data: balanceData } = useReadContract({
    address: X402_CONFIG.USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address }
  });

  useEffect(() => {
    if (balanceData) {
      setUsdcBalance(formatUnits(balanceData, X402_CONFIG.USDC_DECIMALS));
    }
  }, [balanceData]);

  // ============================================================================
  // Payment Helper - Direct USDC transfer
  // ============================================================================

  const payUsdc = useCallback(async (amountUsdc: number): Promise<string> => {
    if (!address) throw new Error('Wallet not connected');

    const amountRaw = parseUnits(amountUsdc.toString(), X402_CONFIG.USDC_DECIMALS);
    console.log(`[X402] Paying ${amountUsdc} USDC (${amountRaw} units) to ${X402_CONFIG.PAYMENT_RECIPIENT}`);

    const txHash = await writeContractAsync({
      address: X402_CONFIG.USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [X402_CONFIG.PAYMENT_RECIPIENT, amountRaw]
    });

    console.log(`[X402] Payment tx: ${txHash}`);

    // Wait for confirmation
    if (publicClient) {
      setStatusMessage('Waiting for payment confirmation...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`[X402] Payment confirmed`);
    }

    return txHash;
  }, [address, writeContractAsync, publicClient]);

  // ============================================================================
  // File to Base64
  // ============================================================================

  const fileToBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ============================================================================
  // Image Selection
  // ============================================================================

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      setError('Image must be less than 1MB');
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('Image must be PNG, JPG, GIF, or WebP');
      return;
    }

    setImageFile(file);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ============================================================================
  // Step 1: Verify Image ($0.50 USDC)
  // ============================================================================

  const handleVerify = async () => {
    if (!imageFile || !address) return;

    setStatus('verifying');
    setError(null);
    setStatusMessage('Preparing verification...');

    try {
      const base64 = await fileToBase64(imageFile);

      // Step 1: Make initial request (will get 402)
      console.log('[X402] Making initial verify request...');
      setStatusMessage('Requesting verification...');

      const initialResponse = await fetch(`${X402_CONFIG.API_BASE_URL}/api/verified-launcher/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: base64,
          walletAddress: address,
          contentType: imageFile.type
        })
      });

      // If not 402, handle the response
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (!initialResponse.ok) {
          throw new Error(data.error || 'Verification request failed');
        }
        // Unexpected success without payment
        setVerification(data);
        if (data.verified) {
          setStep('details');
        }
        setStatus('idle');
        return;
      }

      // Step 2: Got 402, parse payment details
      console.log('[X402] Got 402, parsing payment details...');
      const paymentInfo = await initialResponse.json();
      console.log('[X402] Payment info:', paymentInfo);

      // Step 3: Pay USDC
      setStatusMessage('Please confirm USDC payment in your wallet...');
      setStatus('paying');

      const txHash = await payUsdc(X402_CONFIG.VERIFY_PRICE_USDC);

      // Step 4: Retry with simple payment headers
      console.log('[X402] Retrying with payment headers...');
      setStatusMessage('Processing verification...');
      setStatus('verifying');

      const retryResponse = await fetch(`${X402_CONFIG.API_BASE_URL}/api/verified-launcher/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Amount': X402_CONFIG.VERIFY_PRICE_USDC.toString(),
          'X-Payment-Tx-Hash': txHash,
          'X-Payment-From': address
        },
        body: JSON.stringify({
          imageData: base64,
          walletAddress: address,
          contentType: imageFile.type
        })
      });

      const result = await retryResponse.json();

      if (!retryResponse.ok) {
        throw new Error(result.error || 'Verification failed after payment');
      }

      console.log('[X402] Verification result:', result);
      setVerification(result);

      if (result.verified) {
        setStep('details');
        setStatusMessage('');
      } else {
        setError(`Image not verified: ${result.reason}`);
      }

      setStatus('idle');

    } catch (err) {
      console.error('[X402] Verification error:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStatus('error');
      setStatusMessage('');
    }
  };

  // ============================================================================
  // Step 2: Launch Token ($1+ USDC)
  // ============================================================================

  const handleLaunch = async () => {
    if (!address || !tokenName || !tokenSymbol) return;

    setStatus('launching');
    setError(null);
    setStatusMessage('Preparing launch...');

    try {
      // Step 1: Make initial request (will get 402)
      console.log('[X402] Making initial launch request...');
      setStatusMessage('Requesting launch...');

      const initialResponse = await fetch(`${X402_CONFIG.API_BASE_URL}/api/verified-launcher/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tokenName,
          symbol: tokenSymbol.toUpperCase(),
          description,
          walletAddress: address,
          devBuyBudget
        })
      });

      // If not 402, handle the response
      if (initialResponse.status !== 402) {
        const data = await initialResponse.json();
        if (!initialResponse.ok) {
          throw new Error(data.error || 'Launch request failed');
        }
        setLaunch(data);
        setStep('complete');
        setStatus('idle');
        return;
      }

      // Step 2: Got 402, pay USDC
      console.log('[X402] Got 402, paying for launch...');
      setStatusMessage('Please confirm USDC payment in your wallet...');
      setStatus('paying');

      const txHash = await payUsdc(devBuyBudget);

      // Step 3: Retry with simple payment headers
      console.log('[X402] Retrying with payment headers...');
      setStatusMessage('Launching token (this may take a minute)...');
      setStatus('launching');

      const retryResponse = await fetch(`${X402_CONFIG.API_BASE_URL}/api/verified-launcher/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Amount': devBuyBudget.toString(),
          'X-Payment-Tx-Hash': txHash,
          'X-Payment-From': address
        },
        body: JSON.stringify({
          name: tokenName,
          symbol: tokenSymbol.toUpperCase(),
          description,
          walletAddress: address,
          devBuyBudget
        })
      });

      const result = await retryResponse.json();

      if (!retryResponse.ok) {
        throw new Error(result.error || 'Launch failed after payment');
      }

      console.log('[X402] Launch result:', result);
      setLaunch(result);
      setStep('complete');
      setStatus('idle');
      setStatusMessage('');

    } catch (err) {
      console.error('[X402] Launch error:', err);
      setError(err instanceof Error ? err.message : 'Launch failed');
      setStatus('error');
      setStatusMessage('');
    }
  };

  // ============================================================================
  // Reset
  // ============================================================================

  const handleReset = () => {
    setStep('select');
    setStatus('idle');
    setImageFile(null);
    setImagePreview(null);
    setTokenName('');
    setTokenSymbol('');
    setDescription('');
    setDevBuyBudget(5);
    setVerification(null);
    setLaunch(null);
    setError(null);
    setStatusMessage('');
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!isConnected) {
    return (
      <div className="p-6 bg-amber-900/50 rounded-xl border border-amber-600/30 text-center">
        <h2 className="text-xl font-bold text-amber-100 mb-4">Connect Your Wallet</h2>
        <p className="text-amber-200/70 mb-4">Connect your wallet to launch tokens</p>
        <button
          onClick={openConnectModal}
          className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  const isProcessing = status !== 'idle' && status !== 'error';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-amber-100">Token Launcher</h2>
        {usdcBalance && (
          <div className="text-sm text-amber-200/70">
            USDC Balance: <span className="text-amber-100 font-mono">${parseFloat(usdcBalance).toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Status Message */}
      {statusMessage && (
        <div className="p-4 bg-blue-900/50 border border-blue-500/50 rounded-lg text-blue-200 text-center">
          <div className="animate-pulse">{statusMessage}</div>
        </div>
      )}

      {/* Step 1: Select Image */}
      {step === 'select' && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-amber-600/50 rounded-xl p-8 text-center bg-amber-900/20">
            {imagePreview ? (
              <div>
                <img src={imagePreview} alt="Preview" className="max-w-xs mx-auto mb-4 rounded-lg" />
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); }}
                  className="text-red-400 hover:text-red-300"
                >
                  Remove Image
                </button>
              </div>
            ) : (
              <div>
                <p className="text-amber-200 mb-2">Select an image for your token</p>
                <p className="text-sm text-amber-200/50 mb-4">PNG, JPG, GIF, or WebP (max 1MB)</p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleImageSelect}
                  className="hidden"
                  id="image-upload"
                />
                <label
                  htmlFor="image-upload"
                  className="cursor-pointer inline-block px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg transition-colors"
                >
                  Choose Image
                </label>
              </div>
            )}
          </div>

          {imageFile && (
            <button
              onClick={handleVerify}
              disabled={isProcessing}
              className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-bold rounded-lg transition-colors"
            >
              {isProcessing ? 'Processing...' : `Verify Image ($${X402_CONFIG.VERIFY_PRICE_USDC.toFixed(2)} USDC)`}
            </button>
          )}

          <p className="text-sm text-amber-200/50 text-center">
            Verification costs ${X402_CONFIG.VERIFY_PRICE_USDC.toFixed(2)} USDC. Your image will be checked against the AppleSnakes art style.
          </p>
        </div>
      )}

      {/* Step 2: Enter Token Details */}
      {step === 'details' && verification && (
        <div className="space-y-6">
          {/* Verification Success */}
          <div className="p-4 bg-green-900/50 border border-green-500/50 rounded-lg">
            <h3 className="font-bold text-green-300 mb-2">Image Verified!</h3>
            <p className="text-green-200">Confidence: {verification.confidence}%</p>
            <p className="text-sm text-green-200/70">{verification.reason}</p>
          </div>

          {/* Show verified image */}
          {verification.ipfsUrl && (
            <div className="text-center">
              <img src={verification.ipfsUrl} alt="Verified" className="max-w-xs mx-auto rounded-lg shadow-lg" />
              <p className="text-xs text-amber-200/50 mt-2">Stored on IPFS</p>
            </div>
          )}

          {/* Token Details Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-200 mb-1">Token Name</label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="My Awesome Token"
                className="w-full px-4 py-3 bg-amber-900/50 border border-amber-600/50 rounded-lg text-amber-100 placeholder-amber-200/30"
                maxLength={50}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-amber-200 mb-1">Token Symbol</label>
              <input
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                placeholder="MYTKN"
                className="w-full px-4 py-3 bg-amber-900/50 border border-amber-600/50 rounded-lg text-amber-100 placeholder-amber-200/30"
                maxLength={10}
              />
              <p className="text-xs text-amber-200/50 mt-1">2-10 characters</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-amber-200 mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of your token..."
                className="w-full px-4 py-3 bg-amber-900/50 border border-amber-600/50 rounded-lg text-amber-100 placeholder-amber-200/30"
                rows={3}
                maxLength={500}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-amber-200 mb-1">
                Dev Buy Amount: ${devBuyBudget} USDC
              </label>
              <input
                type="range"
                min={1}
                max={100}
                value={devBuyBudget}
                onChange={(e) => setDevBuyBudget(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-amber-200/50">
                <span>$1 (minimum)</span>
                <span>$100</span>
              </div>
              <p className="text-xs text-amber-200/50 mt-1">
                This becomes your dev buy (minus 1% admin fee). Higher = larger initial position.
              </p>
            </div>
          </div>

          <button
            onClick={handleLaunch}
            disabled={isProcessing || !tokenName || !tokenSymbol || tokenSymbol.length < 2}
            className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white font-bold rounded-lg transition-colors"
          >
            {isProcessing ? 'Processing...' : `Launch Token ($${devBuyBudget} USDC)`}
          </button>
        </div>
      )}

      {/* Step 3: Complete */}
      {step === 'complete' && launch && (
        <div className="space-y-4">
          <div className="p-6 bg-green-900/50 border border-green-500/50 rounded-lg text-center">
            <h3 className="text-2xl font-bold text-green-300 mb-2">Token Launched!</h3>
            <p className="text-green-200 mb-4">{launch.message}</p>

            {(launch.tokenAddress || launch.result?.tokenAddress) && (
              <div className="bg-black/30 p-4 rounded-lg mb-4">
                <p className="text-sm text-amber-200/70">Token Address:</p>
                <p className="font-mono text-sm text-amber-100 break-all">
                  {launch.tokenAddress || launch.result?.tokenAddress}
                </p>
                <a
                  href={`https://basescan.org/token/${launch.tokenAddress || launch.result?.tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm"
                >
                  View on BaseScan
                </a>
              </div>
            )}

            {launch.token?.imageUrl && (
              <img
                src={launch.token.imageUrl}
                alt={launch.token.name}
                className="max-w-32 mx-auto rounded-lg"
              />
            )}
          </div>

          <button
            onClick={handleReset}
            className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg transition-colors"
          >
            Launch Another Token
          </button>
        </div>
      )}

      {/* Footer Info */}
      <div className="p-4 bg-amber-900/30 rounded-lg text-sm text-amber-200/70">
        <h4 className="font-bold text-amber-200 mb-2">How it works:</h4>
        <ol className="list-decimal list-inside space-y-1">
          <li>Upload an image and pay $0.50 USDC to verify it matches the art style</li>
          <li>If verified, enter your token name and symbol</li>
          <li>Pay $1-100 USDC - this becomes your dev buy budget</li>
          <li>Your token is launched on Base via Clanker, paired with WASS</li>
        </ol>
      </div>
    </div>
  );
}
