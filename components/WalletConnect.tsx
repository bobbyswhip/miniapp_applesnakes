'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useState, useCallback } from 'react';

export function WalletConnect() {
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleConnectClick = useCallback((openModal: () => void) => {
    setConnectionError(null);
    try {
      openModal();
    } catch (error) {
      console.error('Failed to open connect modal:', error);
      setConnectionError('Failed to open wallet connection. Please try again.');
    }
  }, []);

  return (
    <div className="w-full space-y-2">
      {connectionError && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-sm text-red-400">
          {connectionError}
        </div>
      )}

      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted,
        }) => {
          // Check if truly connected (has account, chain, and authenticated)
          const connected =
            mounted &&
            account &&
            chain &&
            (!authenticationStatus || authenticationStatus === 'authenticated');

          // Only hide during initial mount (prevents flash), but NOT during loading
          const isInitializing = !mounted;

          return (
            <div
              {...(isInitializing && {
                'aria-hidden': true,
                style: {
                  opacity: 0,
                  pointerEvents: 'none',
                  userSelect: 'none',
                },
              })}
            >
              {(() => {
                // Show connect button when not connected (including during reconnection attempts)
                if (!connected) {
                  const isLoading = authenticationStatus === 'loading';

                  return (
                    <button
                      onClick={() => handleConnectClick(openConnectModal)}
                      type="button"
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98] border border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={isLoading}
                    >
                      {isLoading ? 'Connecting...' : 'Connect Wallet'}
                    </button>
                  );
                }

                if (chain.unsupported) {
                  return (
                    <button
                      onClick={openChainModal}
                      type="button"
                      className="w-full bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-400 font-semibold py-4 px-6 rounded-xl transition-all duration-200"
                    >
                      Wrong Network
                    </button>
                  );
                }

                return (
                  <div className="flex gap-3">
                    <button
                      onClick={openChainModal}
                      className="flex items-center gap-2 glass hover:border-blue-500/50 text-white font-medium py-3 px-5 rounded-xl transition-all duration-200"
                      type="button"
                    >
                      {chain.hasIcon && (
                        <div
                          className="w-5 h-5 rounded-full overflow-hidden"
                          style={{
                            background: chain.iconBackground,
                          }}
                        >
                          {chain.iconUrl && (
                            <img
                              alt={chain.name ?? 'Chain icon'}
                              src={chain.iconUrl}
                              className="w-5 h-5"
                            />
                          )}
                        </div>
                      )}
                      {chain.name}
                    </button>

                    <button
                      onClick={openAccountModal}
                      type="button"
                      className="flex-1 glass hover:border-blue-500/50 text-white font-medium py-3 px-5 rounded-xl transition-all duration-200 truncate"
                    >
                      {account.displayName}
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        }}
      </ConnectButton.Custom>
    </div>
  );
}
