'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_DECIMALS = 6;

// AI Wallet that receives payments (checksummed)
const PAYMENT_WALLET = '0xE5E9108B4467158C498E8C6b6E39Ae12F8b0A098' as const;

// EIP-712 domain for USDC on Base
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453, // Base mainnet
  verifyingContract: USDC_ADDRESS,
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

// USDC balanceOf ABI
const USDC_BALANCE_ABI = [{
  inputs: [{ name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

interface LaunchResult {
  success: boolean;
  payment?: {
    amount: number;
    currency: string;
    txHash: string;
    from: string;
  };
  token?: {
    name: string;
    symbol: string;
    address?: string;
  };
  launchId?: string;
  error?: string;
}

type LaunchStatus = 'idle' | 'preparing' | 'requesting' | 'signing' | 'submitting' | 'success' | 'error';

// x402 payment requirements from 402 response
interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export function X402TokenLauncher() {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: base.id });
  const { openConnectModal } = useConnectModal();

  // Form state
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenDescription, setTokenDescription] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('1.00');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // UI state
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [status, setStatus] = useState<LaunchStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch USDC balance
  const fetchUSDCBalance = useCallback(async () => {
    if (!address || !publicClient) {
      setUsdcBalance(null);
      return;
    }

    try {
      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address],
      });

      setUsdcBalance(formatUnits(balance, USDC_DECIMALS));
    } catch (err) {
      console.error('Error fetching USDC balance:', err);
      setUsdcBalance('0');
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchUSDCBalance();
  }, [fetchUSDCBalance]);

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB');
        return;
      }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Generate random nonce for EIP-3009
  const generateNonce = (): `0x${string}` => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
  };

  // Create x402 payment header with EIP-3009 signature
  // Uses maxAmountRequired from the 402 response to ensure value >= required
  const createX402PaymentHeader = async (
    paymentRequirements: PaymentRequirements
  ): Promise<string> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    // Use maxAmountRequired from server - this is already in atomic units (e.g., "1000000" for 1 USDC)
    const amountInAtomicUnits = BigInt(paymentRequirements.maxAmountRequired);
    const nonce = generateNonce();
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now - 60; // Valid from 1 minute ago
    // Use maxTimeoutSeconds from payment requirements, default to 1 hour
    const validBefore = now + (paymentRequirements.maxTimeoutSeconds || 3600);

    // Use payTo from payment requirements (the actual recipient)
    const recipientAddress = paymentRequirements.payTo as `0x${string}`;

    console.log('Creating x402 payment header:', {
      from: address,
      to: recipientAddress,
      value: amountInAtomicUnits.toString(),
      validAfter,
      validBefore,
      maxAmountRequired: paymentRequirements.maxAmountRequired,
    });

    // EIP-712 message object - uses BigInt for uint256 types during signing
    const signingMessage = {
      from: address,
      to: recipientAddress,
      value: amountInAtomicUnits, // BigInt for EIP-712 signing
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    };

    // Sign the EIP-712 typed data
    const signature = await walletClient.signTypedData({
      domain: USDC_DOMAIN,
      types: TRANSFER_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: signingMessage,
    });

    // x402 authorization object - all numeric values as strings per x402 spec
    const authorization = {
      from: address,
      to: recipientAddress,
      value: amountInAtomicUnits.toString(), // numeric string
      validAfter: validAfter.toString(), // unix timestamp as numeric string
      validBefore: validBefore.toString(), // unix timestamp as numeric string
      nonce, // 0x-prefixed hex string
    };

    // Create x402 payment payload
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'base',
      payload: {
        signature, // 0x-prefixed hex string
        authorization,
      },
    };

    console.log('x402 payload:', JSON.stringify(payload, null, 2));

    // Encode as base64
    return btoa(JSON.stringify(payload));
  };

  // Main launch function
  const handleLaunch = async () => {
    if (!isConnected || !walletClient || !address) {
      setError('Please connect your wallet first');
      return;
    }

    if (chain?.id !== base.id) {
      setError('Please switch to Base network');
      return;
    }

    if (!tokenName.trim()) {
      setError('Token name is required');
      return;
    }

    if (!tokenSymbol.trim()) {
      setError('Token symbol is required');
      return;
    }

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount < 0.01) {
      setError('Minimum payment is $0.01 USDC');
      return;
    }

    // Check balance
    if (usdcBalance && parseFloat(usdcBalance) < amount) {
      setError(`Insufficient USDC balance. You have $${parseFloat(usdcBalance).toFixed(2)} USDC`);
      return;
    }

    setStatus('preparing');
    setStatusMessage('Preparing request...');
    setError(null);
    setResult(null);

    try {
      // Step 1: Create form data
      const formData = new FormData();
      formData.append('name', tokenName.trim());
      formData.append('symbol', tokenSymbol.trim().toUpperCase());
      if (tokenDescription.trim()) {
        formData.append('description', tokenDescription.trim());
      }
      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      // Step 2: Make initial request (will get 402)
      setStatus('requesting');
      setStatusMessage('Requesting payment requirements...');

      const initialResponse = await fetch('/api/token-launcher/x402', {
        method: 'POST',
        body: formData,
      });

      // Step 3: Handle 402 Payment Required
      if (initialResponse.status === 402) {
        const paymentInfo = await initialResponse.json();
        console.log('Payment required (raw):', paymentInfo);

        // x402 returns payment requirements - could be in 'accepts' array or directly
        // The 402 response format: { accepts: [PaymentRequirements, ...] } or { paymentRequirements: PaymentRequirements }
        let paymentRequirements: PaymentRequirements | undefined;

        if (paymentInfo.accepts && Array.isArray(paymentInfo.accepts) && paymentInfo.accepts.length > 0) {
          // Standard x402 format - find USDC payment option
          paymentRequirements = paymentInfo.accepts.find(
            (req: PaymentRequirements) => req.scheme === 'exact' && req.network === 'base'
          ) || paymentInfo.accepts[0];
        } else if (paymentInfo.paymentRequirements) {
          paymentRequirements = paymentInfo.paymentRequirements;
        } else if (paymentInfo.maxAmountRequired) {
          // Direct format
          paymentRequirements = paymentInfo;
        }

        if (!paymentRequirements || !paymentRequirements.maxAmountRequired) {
          console.error('Invalid payment requirements:', paymentInfo);
          setError('Invalid payment requirements from server');
          setStatus('error');
          return;
        }

        console.log('Using payment requirements:', paymentRequirements);

        // Display the required amount to user
        const requiredAmount = formatUnits(BigInt(paymentRequirements.maxAmountRequired), USDC_DECIMALS);
        setStatusMessage(`Payment required: $${parseFloat(requiredAmount).toFixed(2)} USDC. Please sign in your wallet...`);
        setStatus('signing');

        // Step 4: Create signed payment header using server's requirements
        const paymentHeader = await createX402PaymentHeader(paymentRequirements);

        // Step 5: Retry with payment
        setStatus('submitting');
        setStatusMessage('Sending payment and launching token...');

        // Need to recreate FormData for retry
        const retryFormData = new FormData();
        retryFormData.append('name', tokenName.trim());
        retryFormData.append('symbol', tokenSymbol.trim().toUpperCase());
        if (tokenDescription.trim()) {
          retryFormData.append('description', tokenDescription.trim());
        }
        if (selectedFile) {
          retryFormData.append('file', selectedFile);
        }

        const paidResponse = await fetch('/api/token-launcher/x402', {
          method: 'POST',
          headers: {
            'X-PAYMENT': paymentHeader,
          },
          body: retryFormData,
        });

        const responseData = await paidResponse.json();

        if (paidResponse.ok && responseData.success) {
          setResult(responseData);
          setStatus('success');
          setStatusMessage('Token launch initiated successfully!');

          // Clear form
          setTokenName('');
          setTokenSymbol('');
          setTokenDescription('');
          setSelectedFile(null);
          setImagePreview(null);

          // Refresh balance
          fetchUSDCBalance();
        } else if (paidResponse.status === 402) {
          // Payment failed
          if (responseData.code === 'INSUFFICIENT_BALANCE') {
            setError('Insufficient USDC balance. Please add funds.');
          } else if (responseData.code === 'PAYMENT_EXPIRED') {
            setError('Payment authorization expired. Please try again.');
          } else {
            setError(responseData.error || 'Payment not accepted');
          }
          setStatus('error');
          setStatusMessage('');
        } else {
          setError(responseData.error || 'Launch failed');
          setStatus('error');
          setStatusMessage('');
        }
      } else if (initialResponse.ok) {
        // Unexpected success without payment
        const responseData = await initialResponse.json();
        setResult(responseData);
        setStatus('success');
        setStatusMessage('Success!');
      } else {
        const errorData = await initialResponse.json();
        setError(errorData.error || 'Request failed');
        setStatus('error');
        setStatusMessage('');
      }
    } catch (err) {
      console.error('Launch error:', err);
      if (err instanceof Error) {
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          setError('Transaction cancelled by user');
        } else {
          setError(err.message);
        }
      } else {
        setError('Launch failed');
      }
      setStatus('error');
      setStatusMessage('');
    }
  };

  const isLaunching = status !== 'idle' && status !== 'success' && status !== 'error';
  const canLaunch = isConnected && tokenName.trim() && tokenSymbol.trim() && !isLaunching;

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-white mb-4">
        Launch Token with USDC Payment (x402)
      </h3>

      {/* Wallet Connection */}
      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
        {isConnected ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 text-sm">Connected</span>
              </div>
              <div className="text-white font-mono text-sm mt-1">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <div className="text-gray-400 text-xs mt-1">
                USDC Balance: ${usdcBalance !== null ? parseFloat(usdcBalance).toFixed(2) : '--'}
              </div>
            </div>
            {chain?.id !== base.id && (
              <span className="text-yellow-400 text-xs">Switch to Base</span>
            )}
          </div>
        ) : (
          <button
            onClick={openConnectModal}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm transition-colors"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Payment Info */}
      <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg">
        <div className="text-blue-400 font-medium text-sm mb-1">Payment Info</div>
        <div className="text-gray-400 text-xs space-y-0.5">
          <div>Currency: USDC on Base</div>
          <div>Recipient: {PAYMENT_WALLET.slice(0, 10)}...{PAYMENT_WALLET.slice(-6)}</div>
          <div>Your payment amount becomes the dev buy budget</div>
        </div>
      </div>

      {/* Token Form */}
      <div className="space-y-3">
        {/* Token Name */}
        <div>
          <label className="block text-gray-400 text-xs mb-1">
            Token Name *
          </label>
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="My Awesome Token"
            disabled={isLaunching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Token Symbol */}
        <div>
          <label className="block text-gray-400 text-xs mb-1">
            Token Symbol *
          </label>
          <input
            type="text"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
            placeholder="TKN"
            maxLength={10}
            disabled={isLaunching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-gray-400 text-xs mb-1">
            Description (optional)
          </label>
          <textarea
            value={tokenDescription}
            onChange={(e) => setTokenDescription(e.target.value)}
            placeholder="Token description..."
            rows={2}
            disabled={isLaunching}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50 resize-none"
          />
        </div>

        {/* Image Upload */}
        <div>
          <label className="block text-gray-400 text-xs mb-1">
            Token Image (optional, max 5MB)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleImageSelect}
              disabled={isLaunching}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-700 file:text-gray-300 disabled:opacity-50"
            />
            {imagePreview && (
              <div className="w-10 h-10 rounded overflow-hidden border border-gray-600 flex-shrink-0">
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
        </div>

        {/* Payment Amount */}
        <div>
          <label className="block text-gray-400 text-xs mb-1">
            Payment Amount (USDC) *
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              min="0.01"
              step="0.01"
              disabled={isLaunching}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
            <span className="text-gray-400 text-sm">USDC</span>
          </div>
          <div className="text-gray-500 text-xs mt-1">
            This amount will be used as the dev buy budget
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Status Message */}
        {statusMessage && status !== 'error' && (
          <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded text-yellow-300 text-sm flex items-center gap-2">
            {isLaunching && (
              <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            )}
            {statusMessage}
          </div>
        )}

        {/* Success Result */}
        {result?.success && (
          <div className="p-3 bg-green-900/30 border border-green-700/50 rounded">
            <div className="text-green-400 font-medium text-sm mb-2">
              Token Launch Initiated!
            </div>
            {result.payment && (
              <div className="text-gray-300 text-xs space-y-1">
                <div>Payment: ${result.payment.amount} {result.payment.currency}</div>
                {result.payment.txHash && (
                  <div>
                    TX:{' '}
                    <a
                      href={`https://basescan.org/tx/${result.payment.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {result.payment.txHash.slice(0, 16)}...
                    </a>
                  </div>
                )}
              </div>
            )}
            {result.token && (
              <div className="text-gray-300 text-xs mt-2">
                <div>Token: {result.token.name} ({result.token.symbol})</div>
                {result.token.address && (
                  <div>
                    Address:{' '}
                    <a
                      href={`https://basescan.org/token/${result.token.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline font-mono"
                    >
                      {result.token.address.slice(0, 10)}...
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Launch Button */}
        <button
          onClick={handleLaunch}
          disabled={!canLaunch}
          className={`w-full py-3 rounded font-semibold text-sm transition-all ${
            !canLaunch
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg hover:shadow-green-500/20'
          }`}
        >
          {isLaunching
            ? 'Processing...'
            : `Launch Token (Pay $${paymentAmount} USDC)`}
        </button>
      </div>
    </div>
  );
}
