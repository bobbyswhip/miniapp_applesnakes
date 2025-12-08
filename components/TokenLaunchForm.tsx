'use client';

import { useState, useCallback, useEffect } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';
import { base } from 'viem/chains';
import { useVerifiedLauncher, type LaunchStep } from '@/hooks/useVerifiedLauncher';

// 2-step flow: Verify+Upload → Launch
const STEP_CONFIG = [
  { id: 'verify', label: 'Verify', description: 'AI validates & uploads' },
  { id: 'launch', label: 'Launch', description: 'Deploy token' },
  { id: 'complete', label: 'Complete', description: 'Token live!' },
];

const STEP_MAP: Record<LaunchStep, number> = {
  idle: 0,
  verifying: 1,
  launching: 2,
  polling: 2,
  complete: 3,
  error: -1,
};

export function TokenLaunchForm() {
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const {
    step: currentStep,
    verification,
    launch,
    error,
    statusMessage,
    usdcBalance,
    verificationToken,
    isConnected,
    chainId,
    isLoading,
    verifyImage,
    launchToken,
    fetchUSDCBalance,
    reset,
    address,
  } = useVerifiedLauncher();

  const isWrongNetwork = isConnected && chainId !== base.id;

  // Handle disconnect and reset
  const handleDisconnect = useCallback(() => {
    disconnect();
    reset();
  }, [disconnect, reset]);

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    devBuyBudget: '5',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Fetch USDC balance on mount and periodically
  useEffect(() => {
    fetchUSDCBalance();
    const interval = setInterval(fetchUSDCBalance, 30000);
    return () => clearInterval(interval);
  }, [fetchUSDCBalance]);

  const handleInputChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setValidationError(null);
  }, []);

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        setValidationError('Image must be less than 5MB');
        return;
      }

      // Validate file type
      const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        setValidationError('Image must be PNG, JPG, GIF, or WebP');
        return;
      }

      setImageFile(file);
      setValidationError(null);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
  }, []);

  // Step 1: Verify + Upload image ($0.50)
  const handleVerify = async () => {
    if (!imageFile) {
      setValidationError('Please select an image to verify');
      return;
    }
    setValidationError(null);
    await verifyImage(imageFile);
  };

  // Step 2: Launch token ($5+ USDC)
  const handleLaunch = async () => {
    // Validate required fields
    if (!formData.name.trim()) {
      setValidationError('Token name is required');
      return;
    }
    if (!formData.symbol.trim()) {
      setValidationError('Token symbol is required');
      return;
    }
    if (formData.name.length > 32) {
      setValidationError('Token name must be 32 characters or less');
      return;
    }
    if (formData.symbol.length > 10) {
      setValidationError('Token symbol must be 10 characters or less');
      return;
    }

    const devBuy = parseFloat(formData.devBuyBudget);
    if (isNaN(devBuy) || devBuy < 5) {
      setValidationError('Dev buy budget must be at least $5 USDC');
      return;
    }

    setValidationError(null);

    await launchToken(
      formData.name.trim(),
      formData.symbol.trim().toUpperCase(),
      formData.description.trim() || '',
      devBuy
    );
  };

  const handleReset = () => {
    reset();
    setFormData({
      name: '',
      symbol: '',
      description: '',
      devBuyBudget: '5',
    });
    setImageFile(null);
    setImagePreview(null);
    setValidationError(null);
  };

  const currentStepIndex = STEP_MAP[currentStep];
  const verificationCost = 0.50;
  const devBuyAmount = parseFloat(formData.devBuyBudget) || 5;
  const totalCost = verificationCost + devBuyAmount;

  // Determine what action is available
  const canVerify = currentStep === 'idle' && imageFile && !verification?.verified;
  const canLaunch = verification?.verified && verificationToken && currentStep === 'idle';

  // Show connect wallet prompt if not connected
  if (!isConnected) {
    return (
      <div className="space-y-6">
        <div className="p-6 bg-gray-900/50 border border-gray-700 rounded-xl text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-purple-500/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Connect Your Wallet</h3>
            <p className="text-sm text-gray-400">
              Connect your wallet to launch tokens on Base. Payments are made in USDC.
            </p>
          </div>
          <button
            onClick={() => openConnectModal?.()}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 transition-all"
          >
            Connect Wallet
          </button>
        </div>

        {/* Info even when disconnected */}
        <div className="text-xs text-gray-500 space-y-1">
          <p>Tokens are deployed on Base and paired with WASS via Clanker.</p>
          <p>Cost: $0.50 verification + $5+ dev buy (paid in USDC)</p>
        </div>
      </div>
    );
  }

  // Show wrong network prompt
  if (isWrongNetwork) {
    return (
      <div className="space-y-6">
        <div className="p-6 bg-red-950/30 border border-red-500/30 rounded-xl text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Wrong Network</h3>
            <p className="text-sm text-gray-400">
              Please switch to Base network to launch tokens.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Wallet Connection Status */}
      <div className="flex items-center justify-between p-3 bg-gray-900/50 border border-gray-700 rounded-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm text-gray-400">Connected:</span>
          <span className="text-sm text-white font-mono">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </span>
        </div>
        <button
          onClick={handleDisconnect}
          className="px-3 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded transition-colors"
        >
          Disconnect
        </button>
      </div>

      {/* Progress Steps - 2-step flow */}
      <div className="relative">
        <div className="flex justify-between items-center">
          {STEP_CONFIG.map((step, index) => {
            const isActive = currentStepIndex === index + 1;
            const isComplete = currentStepIndex > index + 1 || currentStep === 'complete';
            const isPending = currentStepIndex < index + 1;

            return (
              <div key={step.id} className="flex-1 flex flex-col items-center relative">
                {/* Connector line */}
                {index < STEP_CONFIG.length - 1 && (
                  <div className={`absolute top-4 left-1/2 w-full h-0.5 ${
                    isComplete ? 'bg-green-500' : isActive ? 'bg-purple-500' : 'bg-gray-700'
                  }`} />
                )}

                {/* Step circle */}
                <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  isComplete ? 'bg-green-500 border-green-500 text-white' :
                  isActive ? 'bg-purple-600 border-purple-500 text-white animate-pulse' :
                  'bg-gray-800 border-gray-600 text-gray-400'
                }`}>
                  {isComplete ? '✓' : index + 1}
                </div>

                {/* Step label */}
                <span className={`text-xs mt-1 ${
                  isComplete ? 'text-green-400' :
                  isActive ? 'text-purple-400' :
                  'text-gray-500'
                }`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className={`p-3 rounded-lg text-sm ${
          currentStep === 'error' ? 'bg-red-950/30 border border-red-500/30 text-red-400' :
          currentStep === 'complete' ? 'bg-green-950/30 border border-green-500/30 text-green-400' :
          'bg-purple-950/30 border border-purple-500/30 text-purple-300'
        }`}>
          {isLoading && (
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
          )}
          {statusMessage}
        </div>
      )}

      {/* Error Display */}
      {(error || validationError) && (
        <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error || validationError}
        </div>
      )}

      {/* Verification Result */}
      {verification && (
        <div className={`p-4 rounded-lg border ${
          verification.verified
            ? 'bg-green-950/20 border-green-500/30'
            : 'bg-red-950/20 border-red-500/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`font-semibold ${verification.verified ? 'text-green-400' : 'text-red-400'}`}>
              {verification.verified ? '✓ Image Verified & Uploaded' : '✗ Verification Failed'}
            </span>
            <span className="text-sm text-gray-400">
              {(verification.confidence * 100).toFixed(0)}% confidence
            </span>
          </div>
          <p className="text-sm text-gray-300">{verification.reason}</p>
          {verification.tempImageUrl && (
            <p className="text-xs text-gray-500 mt-2">Image uploaded and ready for deployment</p>
          )}
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        {/* Image Upload - Always visible */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Token Image <span className="text-red-400">*</span>
            <span className="text-xs text-purple-400 ml-2">(AppleSnakes style required)</span>
          </label>
          <div className="flex items-start gap-4">
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="w-24 h-24 object-cover rounded-lg border border-gray-700"
                />
                {!isLoading && !verification?.verified && (
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center w-24 h-24 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-purple-500 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <span className="text-2xl text-gray-500">+</span>
                <span className="text-xs text-gray-500">Upload</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleImageChange}
                  disabled={isLoading}
                  className="hidden"
                />
              </label>
            )}
            <div className="text-xs text-gray-500 space-y-1">
              <p>PNG, JPG, GIF, or WebP</p>
              <p>Max 5MB, 512x512 recommended</p>
              <p className="text-purple-400">Must match AppleSnakes art style</p>
            </div>
          </div>
        </div>

        {/* Step 1: Verify + Upload Button */}
        {canVerify && (
          <button
            onClick={handleVerify}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? 'Verifying...' : `Verify & Upload ($${verificationCost.toFixed(2)} USDC)`}
          </button>
        )}

        {/* Token Details - Show after verification */}
        {canLaunch && (
          <>
            {/* Name & Symbol Row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Token Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="My AppleSnakes Token"
                  maxLength={32}
                  disabled={isLoading}
                  className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                />
                <div className="text-xs text-gray-500 mt-1">{formData.name.length}/32</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Symbol <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.symbol}
                  onChange={(e) => handleInputChange('symbol', e.target.value.toUpperCase())}
                  placeholder="AST"
                  maxLength={10}
                  disabled={isLoading}
                  className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50 uppercase"
                />
                <div className="text-xs text-gray-500 mt-1">{formData.symbol.length}/10</div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Describe your token..."
                rows={3}
                disabled={isLoading}
                className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50 resize-none"
              />
            </div>

            {/* Dev Buy Budget */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Dev Buy Budget (USDC)
              </label>
              <input
                type="number"
                value={formData.devBuyBudget}
                onChange={(e) => handleInputChange('devBuyBudget', e.target.value)}
                step="1"
                min="5"
                disabled={isLoading}
                className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum $5 USDC. This becomes your dev buy on launch.
              </p>
            </div>

            {/* Step 2: Launch Button */}
            <button
              onClick={handleLaunch}
              disabled={isLoading || !formData.name.trim() || !formData.symbol.trim()}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? 'Launching...' : `Launch Token ($${devBuyAmount.toFixed(2)} USDC)`}
            </button>
          </>
        )}
      </div>

      {/* Success Panel */}
      {currentStep === 'complete' && launch && (
        <div className="p-4 rounded-xl border border-green-500/30 bg-green-950/20 space-y-4">
          <div className="flex items-center gap-2 text-green-400">
            <span className="text-2xl">✓</span>
            <span className="font-semibold text-lg">Token Launched Successfully!</span>
          </div>

          {launch.contractAddress && (
            <div className="p-3 bg-gray-800/50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Contract Address</p>
              <p className="text-sm text-white font-mono break-all">{launch.contractAddress}</p>
            </div>
          )}

          <div className="flex gap-3">
            {launch.contractAddress && (
              <>
                <a
                  href={`https://dexscreener.com/base/${launch.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-purple-400 text-center rounded-lg text-sm transition-colors"
                >
                  Dexscreener
                </a>
                <a
                  href={`https://basescan.org/token/${launch.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-blue-400 text-center rounded-lg text-sm transition-colors"
                >
                  Basescan
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reset Button */}
      {(currentStep === 'complete' || currentStep === 'error') && (
        <button
          onClick={handleReset}
          className="w-full py-2 px-4 border border-gray-700 text-gray-400 rounded-lg hover:border-gray-600 hover:text-gray-300 transition-colors"
        >
          Launch Another Token
        </button>
      )}

      {/* Cost Summary & Balance */}
      <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-700 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Your USDC Balance</span>
          <span className="text-white font-mono">
            {usdcBalance !== null ? `$${parseFloat(usdcBalance).toFixed(2)}` : '—'}
          </span>
        </div>

        <div className="border-t border-gray-700 pt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Verification + Upload</span>
            <span className="text-gray-400">$0.50</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Dev Buy Budget</span>
            <span className="text-gray-400">${devBuyAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm font-semibold pt-2 border-t border-gray-700">
            <span className="text-gray-300">Total Cost</span>
            <span className="text-purple-400">${totalCost.toFixed(2)} USDC</span>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>Tokens are deployed on Base and paired with WASS via Clanker.</p>
        <p>Pool fee: 0.3% + 0.7% hook fee. Starting market cap: ~$10.</p>
        <p className="text-purple-400">Images must match AppleSnakes art style to pass verification.</p>
      </div>
    </div>
  );
}
