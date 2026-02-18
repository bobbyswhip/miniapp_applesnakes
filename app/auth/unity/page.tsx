'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { SiweMessage } from 'siwe';
import { base } from 'viem/chains';

type AuthStatus = 'idle' | 'connecting' | 'signing' | 'verifying' | 'success' | 'error';

export default function UnityAuthPage() {
  const { address, isConnected, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);

  // Fetch nonce on mount
  useEffect(() => {
    const fetchNonce = async () => {
      try {
        const response = await fetch('/api/auth/nonce');
        const data = await response.json();
        setNonce(data.nonce);
      } catch (err) {
        console.error('Failed to fetch nonce:', err);
        setError('Failed to initialize authentication');
      }
    };
    fetchNonce();
  }, []);

  // Send message to Unity opener
  const sendToUnity = useCallback((message: { type: string; [key: string]: unknown }) => {
    if (window.opener) {
      window.opener.postMessage(message, '*');
    }
  }, []);

  // Handle authentication flow
  const handleAuthenticate = useCallback(async () => {
    if (!address || !nonce) return;

    try {
      setStatus('signing');
      setError(null);

      // Create SIWE message
      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to AppleSnakes',
        uri: window.location.origin,
        version: '1',
        chainId: chain?.id || base.id,
        nonce,
      });

      const message = siweMessage.prepareMessage();

      // Request signature
      const signature = await signMessageAsync({ message });

      setStatus('verifying');

      // Verify signature with backend
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, nonce }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setStatus('success');

      // Send success message to Unity
      sendToUnity({
        type: 'AUTH_SUCCESS',
        token: data.token,
        address: data.address,
        chainId: data.chainId,
      });

      // Close popup after short delay
      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err) {
      console.error('Authentication error:', err);
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      setError(errorMessage);

      sendToUnity({
        type: 'AUTH_ERROR',
        error: errorMessage,
      });
    }
  }, [address, nonce, chain, signMessageAsync, sendToUnity]);

  // Auto-trigger auth when wallet is connected
  useEffect(() => {
    if (isConnected && address && nonce && status === 'idle') {
      handleAuthenticate();
    }
  }, [isConnected, address, nonce, status, handleAuthenticate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#171e1d] to-[#0a0d0c] flex items-center justify-center p-4">
      <div className="bg-[#1a2221] rounded-2xl p-8 max-w-md w-full shadow-2xl border border-[rgba(255,255,255,0.08)]">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">
            🐍 AppleSnakes Login
          </h1>
          <p className="text-[#8a9090] text-sm">
            Connect your wallet to sign in to the game
          </p>
        </div>

        {/* Status Messages */}
        {status === 'signing' && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-500 border-t-transparent" />
              <span className="text-yellow-500">Please sign the message in your wallet...</span>
            </div>
          </div>
        )}

        {status === 'verifying' && (
          <div className="bg-[rgba(255,208,117,0.06)] border border-[rgba(255,208,117,0.2)] rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-[rgba(255,208,117,0.4)] border-t-transparent" />
              <span className="text-[#ffd075]">Verifying signature...</span>
            </div>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✅</span>
              <div>
                <span className="text-green-500 font-medium block">Authentication successful!</span>
                <span className="text-green-400/70 text-sm">This window will close automatically...</span>
              </div>
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl">❌</span>
              <div>
                <span className="text-red-500 font-medium block">Authentication failed</span>
                <span className="text-red-400/70 text-sm">{error}</span>
              </div>
            </div>
          </div>
        )}

        {/* Wallet Connection */}
        <div className="flex flex-col items-center gap-4">
          {!isConnected ? (
            <>
              <p className="text-[#cecece] text-center mb-2">
                Connect your wallet to continue
              </p>
              <ConnectButton />
            </>
          ) : (
            <>
              <div className="w-full bg-[#1f2827]/50 rounded-lg p-4 mb-4">
                <div className="text-[#8a9090] text-xs mb-1">Connected Wallet</div>
                <div className="text-white font-mono text-sm truncate">
                  {address}
                </div>
                <div className="text-[#8a9090] text-xs mt-2">
                  Chain: {chain?.name || 'Unknown'}
                </div>
              </div>

              {status === 'idle' && (
                <button
                  onClick={handleAuthenticate}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                >
                  Sign In
                </button>
              )}

              {status === 'error' && (
                <button
                  onClick={handleAuthenticate}
                  className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                >
                  Try Again
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-[rgba(255,255,255,0.08)]">
          <p className="text-[#6b7575] text-xs text-center">
            By signing in, you confirm ownership of your wallet address.
            <br />
            No transaction fees will be charged.
          </p>
        </div>
      </div>
    </div>
  );
}
