'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useRouter } from 'next/navigation';

const HOOK_ADDRESS = '0xca51C787E7136dB1cbFd92a24287ea8E9363b0c8';

export function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { isConnected } = useAccount();
  const router = useRouter();

  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem('hasSeenWelcome');
    if (!hasSeenWelcome) {
      const timer = setTimeout(() => setIsOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (isConnected && isOpen) {
      handleClose();
    }
  }, [isConnected, isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem('hasSeenWelcome', 'true');
  };

  const handleWhitepaperClick = () => {
    handleClose();
    router.push('/docs');
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in"
        onClick={handleClose}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto max-w-lg w-full glass rounded-2xl overflow-hidden animate-slide-up"
          style={{
            boxShadow: '0 0 40px rgba(59, 130, 246, 0.3), inset 0 0 60px rgba(59, 130, 246, 0.05)',
            border: '2px solid rgba(59, 130, 246, 0.2)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="relative overflow-hidden p-6 pb-5"
            style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%)',
              borderBottom: '1px solid rgba(59, 130, 246, 0.2)',
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.4), transparent)',
                animation: 'shimmer 3s infinite',
              }}
            />

            <div className="relative text-center">
              <h1
                className="text-3xl font-bold mb-2"
                style={{
                  background: 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #EC4899 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Welcome to Apple Valley
              </h1>
              <p className="text-sm text-gray-400">
                Every action vests tokens in your wallet
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-5">
            {/* Main Message */}
            <div
              className="bg-gradient-to-br from-blue-950/40 via-purple-950/40 to-pink-950/40 border border-blue-500/30 rounded-xl p-5"
              style={{
                boxShadow: '0 0 20px rgba(59, 130, 246, 0.15), inset 0 0 20px rgba(147, 51, 234, 0.05)',
              }}
            >
              <p className="text-gray-200 leading-relaxed text-sm mb-3">
                There are no fees here. Every action is a swap through our new{' '}
                <a
                  href={`https://basescan.org/address/${HOOK_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline transition-colors"
                >
                  V4 Super Strategy Hook
                </a>
                . You receive 100% of your tokens from actions over 90 days.
              </p>

              <div className="pt-3 border-t border-purple-500/20 space-y-1.5 text-xs text-gray-400">
                <p>Claim 1% daily and after 90 they fully unlock!</p>
                <p>
                  Make your own NFT strategy at{' '}
                  <a
                    href="https://pairable.io/#/contracts/superstrat"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-300 hover:text-purple-200 underline"
                  >
                    pairable.io
                  </a>
                </p>
              </div>
            </div>

            {/* Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleWhitepaperClick}
                className="px-4 py-3 rounded-lg font-medium text-sm text-white transition-all hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(147, 51, 234, 0.2) 100%)',
                  border: '2px solid rgba(59, 130, 246, 0.4)',
                }}
              >
                Read Docs
              </button>

              <div
                className="rounded-lg"
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)',
                  border: '2px solid rgba(16, 185, 129, 0.4)',
                }}
              >
                <ConnectButton.Custom>
                  {({ openConnectModal }) => (
                    <button
                      onClick={openConnectModal}
                      className="w-full h-full px-4 py-3 font-medium text-sm text-white hover:text-emerald-300 transition-colors"
                    >
                      Connect Wallet
                    </button>
                  )}
                </ConnectButton.Custom>
              </div>
            </div>

            {/* Skip */}
            <div className="text-center">
              <button
                onClick={handleClose}
                className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
              >
                Skip and explore
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(30px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }

        .animate-slide-up {
          animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </>
  );
}
