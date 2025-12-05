'use client';

import { useState, useCallback } from 'react';
import { useTokenLauncher } from '@/hooks/useTokenLauncher';
import type { LaunchStatus } from '@/types/tokenLauncher';

const STATUS_COLORS: Record<LaunchStatus, string> = {
  idle: 'bg-gray-700 text-gray-400',
  pending: 'bg-gray-600 text-gray-300',
  uploading: 'bg-blue-600/20 text-blue-400',
  deploying: 'bg-purple-600/20 text-purple-400',
  confirming: 'bg-yellow-600/20 text-yellow-400',
  complete: 'bg-green-600/20 text-green-400',
  error: 'bg-red-600/20 text-red-400',
};

const STATUS_BORDER: Record<LaunchStatus, string> = {
  idle: 'border-gray-700',
  pending: 'border-gray-600',
  uploading: 'border-blue-500/30',
  deploying: 'border-purple-500/30',
  confirming: 'border-yellow-500/30',
  complete: 'border-green-500/30',
  error: 'border-red-500/30',
};

export function TokenLaunchForm() {
  const { progress, isLaunching, launcherStatus, launchToken, reset } = useTokenLauncher();

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    website: '',
    twitter: '',
    initialBuyEth: '0.0001',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

    const buyEth = parseFloat(formData.initialBuyEth);
    if (isNaN(buyEth) || buyEth < 0 || buyEth > 1) {
      setValidationError('Dev buy must be between 0 and 1 ETH');
      return;
    }

    setValidationError(null);

    await launchToken({
      name: formData.name.trim(),
      symbol: formData.symbol.trim().toUpperCase(),
      description: formData.description.trim() || undefined,
      image: imageFile || undefined,
      website: formData.website.trim() || undefined,
      twitter: formData.twitter.trim() || undefined,
      initialBuyEth: buyEth,
    });
  };

  const handleReset = () => {
    reset();
    setFormData({
      name: '',
      symbol: '',
      description: '',
      website: '',
      twitter: '',
      initialBuyEth: '0.0001',
    });
    setImageFile(null);
    setImagePreview(null);
    setValidationError(null);
  };

  // Show launcher status
  const isReady = launcherStatus?.status === 'ready';

  return (
    <div className="space-y-6">
      {/* Launcher Status */}
      {launcherStatus && (
        <div className={`flex items-center justify-between p-3 rounded-lg ${
          isReady ? 'bg-green-950/30 border border-green-500/30' : 'bg-yellow-950/30 border border-yellow-500/30'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isReady ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-sm text-gray-300">
              Launcher: {launcherStatus.status}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            Starting MCap: {launcherStatus.config?.estimatedMcap}
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="My Awesome Token"
              maxLength={32}
              disabled={isLaunching}
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
              placeholder="MAT"
              maxLength={10}
              disabled={isLaunching}
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
            disabled={isLaunching}
            className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50 resize-none"
          />
        </div>

        {/* Image Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Token Image
          </label>
          <div className="flex items-start gap-4">
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="w-20 h-20 object-cover rounded-lg border border-gray-700"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  disabled={isLaunching}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 disabled:opacity-50"
                >
                  x
                </button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center w-20 h-20 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-purple-500 ${isLaunching ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <span className="text-2xl text-gray-500">+</span>
                <span className="text-xs text-gray-500">Upload</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleImageChange}
                  disabled={isLaunching}
                  className="hidden"
                />
              </label>
            )}
            <div className="text-xs text-gray-500">
              <p>PNG, JPG, GIF, or WebP</p>
              <p>Max 5MB, 512x512 recommended</p>
            </div>
          </div>
        </div>

        {/* Website & Twitter Row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Website
            </label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => handleInputChange('website', e.target.value)}
              placeholder="https://mytoken.com"
              disabled={isLaunching}
              className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Twitter
            </label>
            <input
              type="text"
              value={formData.twitter}
              onChange={(e) => handleInputChange('twitter', e.target.value)}
              placeholder="@mytoken"
              disabled={isLaunching}
              className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Dev Buy Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Dev Buy Amount (ETH)
          </label>
          <input
            type="number"
            value={formData.initialBuyEth}
            onChange={(e) => handleInputChange('initialBuyEth', e.target.value)}
            step="0.0001"
            min="0"
            max="1"
            disabled={isLaunching}
            className="w-full px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
          <p className="text-xs text-gray-500 mt-1">
            ETH to swap for your token on launch (0.0001-0.01 recommended)
          </p>
        </div>

        {/* Validation Error */}
        {validationError && (
          <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {validationError}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLaunching || !isReady}
          className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isLaunching ? 'Launching...' : 'Launch Token'}
        </button>
      </form>

      {/* Progress Panel */}
      {progress.status !== 'idle' && (
        <div className={`p-4 rounded-xl border ${STATUS_BORDER[progress.status]} bg-gray-900/50`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${STATUS_COLORS[progress.status]}`}>
              {progress.status}
            </span>
            {progress.totalSteps > 0 && (
              <span className="text-sm text-gray-500">
                Step {progress.step}/{progress.totalSteps}
              </span>
            )}
          </div>

          {/* Progress Bar */}
          {progress.totalSteps > 0 && (
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }}
              />
            </div>
          )}

          {/* Message */}
          <p className="text-gray-300 text-sm">{progress.message}</p>

          {/* Error */}
          {progress.error && (
            <div className="mt-3 p-3 bg-red-950/30 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {progress.error}
            </div>
          )}

          {/* Success Links */}
          {progress.status === 'complete' && progress.data && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <span className="text-xl">&#x2714;</span>
                <span className="font-semibold">Token Launched Successfully!</span>
              </div>

              {progress.data.tokenAddress && (
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Token Address</p>
                  <p className="text-sm text-white font-mono break-all">{progress.data.tokenAddress}</p>
                </div>
              )}

              <div className="flex gap-3">
                {progress.data.dexscreener && (
                  <a
                    href={progress.data.dexscreener}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-purple-400 text-center rounded-lg text-sm transition-colors"
                  >
                    Dexscreener
                  </a>
                )}
                {progress.data.basescan && (
                  <a
                    href={progress.data.basescan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-blue-400 text-center rounded-lg text-sm transition-colors"
                  >
                    Basescan
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Reset Button */}
          {(progress.status === 'complete' || progress.status === 'error') && (
            <button
              onClick={handleReset}
              className="w-full mt-4 py-2 px-4 border border-gray-700 text-gray-400 rounded-lg hover:border-gray-600 hover:text-gray-300 transition-colors"
            >
              Launch Another Token
            </button>
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>Tokens are deployed on Base and paired with WASS via Clanker.</p>
        <p>Pool fee: 0.3% + 0.7% hook fee. Starting market cap: ~$10.</p>
      </div>
    </div>
  );
}
