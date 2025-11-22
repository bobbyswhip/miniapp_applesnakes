'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserNFT } from '@/hooks/useUserNFTs';
import { useInventory } from '@/contexts/InventoryContext';

interface NFTOptionsModalProps {
  nft: UserNFT | null;
  isOpen: boolean;
  onClose: () => void;
}

export function NFTOptionsModal({ nft, isOpen, onClose }: NFTOptionsModalProps) {
  const router = useRouter();
  const { setIsOpen } = useInventory();
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  // Update timer for unwrap cooldown
  useEffect(() => {
    if (!isOpen || !nft || nft.canUnwrap) return;

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const cooldownEnd = nft.swapMintTime + 3600; // 1 hour = 3600 seconds
      const remaining = cooldownEnd - now;

      if (remaining <= 0) {
        setTimeRemaining('Ready');
      } else {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isOpen, nft]);

  useEffect(() => {
    if (isOpen && nft) {
      // Log all NFT information when modal opens
      console.log('=== NFT Details ===');
      console.log('Token ID:', nft.tokenId);
      console.log('Name:', nft.name);
      console.log('Type:', nft.nftType);
      console.log('Image URL:', nft.imageUrl);
      console.log('--- TokenInfo Struct Data ---');
      console.log('Owner:', nft.owner);
      console.log('Exists:', nft.exists);
      console.log('Is Snake:', nft.isSnake);
      console.log('Is Jailed:', nft.isJailed);
      console.log('Jail Time:', nft.jailTime, nft.jailTime > 0 ? `(${new Date(nft.jailTime * 1000).toLocaleString()})` : '(not jailed)');
      console.log('Is Egg:', nft.isEgg);
      console.log('Mint Time:', nft.mintTime, `(${new Date(nft.mintTime * 1000).toLocaleString()})`);
      console.log('Force Hatched:', nft.forceHatched);
      console.log('Evolved:', nft.evolved);
      console.log('Owner Is Warden:', nft.ownerIsWarden);
      console.log('Owner Is Jail Exempt:', nft.ownerIsJailExempt);
      console.log('Swap Mint Time:', nft.swapMintTime, nft.swapMintTime > 0 ? `(${new Date(nft.swapMintTime * 1000).toLocaleString()})` : '(not swap minted)');
      console.log('Can Unwrap:', nft.canUnwrap);
      console.log('--- IPFS Metadata ---');
      console.log('Full Metadata:', nft.metadata);
      console.log('==================');
    }
  }, [isOpen, nft]);

  if (!isOpen || !nft) return null;

  // Determine display type (treat wardens as humans)
  const displayType = nft.nftType === 'warden' ? 'human' : nft.nftType;
  const isHuman = displayType === 'human';
  const isSnake = displayType === 'snake';
  const isEgg = displayType === 'egg';

  // Get type-specific title and styling
  const getTypeConfig = (type: string) => {
    switch (type) {
      case 'human':
        return {
          title: nft.ownerIsWarden ? 'Warden Options' : 'Human Options',
          emoji: nft.ownerIsWarden ? '⚔️' : '🧑'
        };
      case 'snake':
        return {
          title: 'Snake Options',
          emoji: '🐍'
        };
      case 'egg':
        return {
          title: 'Egg Options',
          emoji: '🥚'
        };
      default:
        return {
          title: 'Options',
          emoji: '❓'
        };
    }
  };

  const typeConfig = getTypeConfig(displayType);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div
        className="rounded-2xl w-full relative"
        style={{
          maxWidth: 'clamp(20rem, 90vw, 28rem)',
          maxHeight: 'clamp(30rem, 85vh, 40rem)',
          overflowY: 'hidden',
          overflowX: 'hidden',
          background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))',
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          border: '2px solid rgba(6, 182, 212, 0.3)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 50px rgba(6, 182, 212, 0.3), 0 0 100px rgba(168, 85, 247, 0.2), inset 0 0 30px rgba(168, 85, 247, 0.05)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Shimmer effect overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.1), transparent)',
            animation: 'shimmer 3s infinite',
            pointerEvents: 'none',
            zIndex: 1,
            borderRadius: '1rem',
          }}
        />

        {/* Content wrapper with higher z-index */}
        <div style={{ position: 'relative', zIndex: 2 }}>
        {/* Header */}
        <div
          className="rounded-t-2xl relative overflow-hidden"
          style={{
            padding: 'clamp(0.75rem, 2.5vh, 1rem)',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.3))',
            borderBottom: '1px solid rgba(6, 182, 212, 0.3)',
          }}
        >
          {/* Gradient shimmer overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.2), transparent)',
              animation: 'shimmer 4s infinite',
              pointerEvents: 'none',
            }}
          />
          <div
            className="flex items-center justify-between relative z-10"
            style={{
              gap: 'clamp(0.5rem, 2vw, 0.75rem)'
            }}
          >
            <div
              className="flex items-center"
              style={{
                gap: 'clamp(0.5rem, 2vw, 0.75rem)'
              }}
            >
              <span style={{ fontSize: 'clamp(1.5rem, 4vh, 1.875rem)' }}>{typeConfig.emoji}</span>
              <div>
                <h2
                  className="font-bold"
                  style={{
                    fontSize: 'clamp(1rem, 2.5vh, 1.25rem)',
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 1), rgba(168, 85, 247, 1))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {typeConfig.title}
                </h2>
                <p
                  className="text-cyan-200"
                  style={{
                    fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)'
                  }}
                >
                  {nft.name}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-cyan-300/80 hover:text-cyan-200 transition-colors"
              style={{
                fontSize: 'clamp(1.25rem, 3vh, 1.5rem)'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* NFT Info */}
        <div
          className="border-b border-cyan-500/20"
          style={{
            padding: 'clamp(0.75rem, 2.5vh, 1rem)'
          }}
        >
          <div
            className="flex items-center"
            style={{
              gap: 'clamp(0.75rem, 2vw, 1rem)'
            }}
          >
            <img
              src={`https://surrounding-amaranth-catshark.myfilebase.com/ipfs/${nft.imageUrl}`}
              alt={nft.name}
              className="rounded-lg object-cover"
              style={{
                width: 'clamp(4rem, 10vh, 5rem)',
                height: 'clamp(4rem, 10vh, 5rem)'
              }}
            />
            <div className="flex-1">
              <p className="text-white" style={{ fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)' }}>Token ID: <span className="font-mono">#{nft.tokenId}</span></p>
              <p className="text-white" style={{ fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)' }}>Type: <span className="capitalize">{nft.nftType}</span></p>
              {nft.isJailed && (
                <p className="text-red-400 flex items-center gap-1 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.8vh, 0.875rem)' }}>
                  ⛓️ Jailed
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Type-Specific Options */}
        <div
          style={{
            padding: 'clamp(0.75rem, 2.5vh, 1rem)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(0.5rem, 1.5vh, 0.75rem)'
          }}
        >
          {/* EGGS: Only show hatch button */}
          {isEgg && (
            <button
              onClick={() => {
                onClose();
                setIsOpen(false);
                router.push('/?fastTravelHatch=true');
              }}
              className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
              style={{
                padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                border: '2px solid rgba(168, 85, 247, 0.5)',
                boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(139, 92, 246, 0.5))';
                e.currentTarget.style.boxShadow = '0 0 25px rgba(168, 85, 247, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(168, 85, 247, 0.2)';
              }}
            >
              <span style={{ fontSize: 'clamp(1.25rem, 3vh, 1.5rem)' }}>✨</span>
              <div>
                <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>Hatch Egg</span>
                <p className="text-purple-100 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>Open the hatching interface</p>
              </div>
            </button>
          )}

          {/* HUMANS/WARDENS: Show all 3 options */}
          {isHuman && (
            <>
              {/* Option 1: Wrap */}
              <button
                onClick={() => {
                  if (nft.canUnwrap) {
                    onClose();
                    setIsOpen(false);
                    router.push('/?openShopWrap=true');
                  }
                }}
                disabled={!nft.canUnwrap}
                className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
                style={{
                  padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                  gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                  background: nft.canUnwrap
                    ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                    : 'linear-gradient(135deg, rgba(75, 85, 99, 0.3), rgba(55, 65, 81, 0.3))',
                  border: nft.canUnwrap
                    ? '2px solid rgba(6, 182, 212, 0.5)'
                    : '2px solid rgba(75, 85, 99, 0.5)',
                  boxShadow: nft.canUnwrap
                    ? '0 0 15px rgba(6, 182, 212, 0.2)'
                    : '0 0 10px rgba(75, 85, 99, 0.1)',
                  cursor: nft.canUnwrap ? 'pointer' : 'not-allowed',
                  opacity: nft.canUnwrap ? 1 : 0.6,
                }}
                onMouseEnter={(e) => {
                  if (nft.canUnwrap) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.5), rgba(59, 130, 246, 0.5))';
                    e.currentTarget.style.boxShadow = '0 0 25px rgba(6, 182, 212, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (nft.canUnwrap) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))';
                    e.currentTarget.style.boxShadow = '0 0 15px rgba(6, 182, 212, 0.2)';
                  }
                }}
              >
                <div className="flex-1">
                  <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>
                    Wrap NFT
                  </span>
                  <p className="text-cyan-100 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>
                    {nft.canUnwrap
                      ? 'Convert to fungible wNFT'
                      : `Cooldown: ${timeRemaining}`
                    }
                  </p>
                </div>
              </button>

              {/* Option 2: Sacrifice */}
              <button
                onClick={() => {
                  onClose();
                  setIsOpen(false);
                  router.push('/?fastTravelBreed=true');
                }}
                className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
                style={{
                  padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                  gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                  border: '2px solid rgba(168, 85, 247, 0.5)',
                  boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(139, 92, 246, 0.5))';
                  e.currentTarget.style.boxShadow = '0 0 25px rgba(168, 85, 247, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))';
                  e.currentTarget.style.boxShadow = '0 0 15px rgba(168, 85, 247, 0.2)';
                }}
              >
                <span style={{ fontSize: 'clamp(1.25rem, 3vh, 1.5rem)' }}>🔮</span>
                <div>
                  <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>Sacrifice</span>
                  <p className="text-purple-100 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>Sacrifice 3 humans to get an applesnake egg</p>
                </div>
              </button>

              {/* Option 3: Jail */}
              <button
                onClick={() => {
                  onClose();
                  setIsOpen(false);
                  router.push('/?fastTravelJail=true');
                }}
                className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
                style={{
                  padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                  gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                  background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(219, 39, 119, 0.3))',
                  border: '2px solid rgba(236, 72, 153, 0.5)',
                  boxShadow: '0 0 15px rgba(236, 72, 153, 0.2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236, 72, 153, 0.5), rgba(219, 39, 119, 0.5))';
                  e.currentTarget.style.boxShadow = '0 0 25px rgba(236, 72, 153, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(219, 39, 119, 0.3))';
                  e.currentTarget.style.boxShadow = '0 0 15px rgba(236, 72, 153, 0.2)';
                }}
              >
                <span style={{ fontSize: 'clamp(1.25rem, 3vh, 1.5rem)' }}>⛓️</span>
                <div>
                  <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>Jail</span>
                  <p className="text-pink-100 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>
                    {nft.ownerIsWarden
                      ? "You're a warden so you can jail other humans at no charge!"
                      : nft.isJailed
                      ? "This NFT can't be transferred while in jail"
                      : "Bribe the warden to jail whoever you want!"
                    }
                  </p>
                </div>
              </button>
            </>
          )}

          {/* SNAKES: Similar to humans but different jail message */}
          {isSnake && (
            <>
              {/* Option 1: Wrap */}
              <button
                onClick={() => {
                  if (nft.canUnwrap) {
                    onClose();
                    setIsOpen(false);
                    router.push('/?openShopWrap=true');
                  }
                }}
                disabled={!nft.canUnwrap}
                className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
                style={{
                  padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                  gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                  background: nft.canUnwrap
                    ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                    : 'linear-gradient(135deg, rgba(75, 85, 99, 0.3), rgba(55, 65, 81, 0.3))',
                  border: nft.canUnwrap
                    ? '2px solid rgba(6, 182, 212, 0.5)'
                    : '2px solid rgba(75, 85, 99, 0.5)',
                  boxShadow: nft.canUnwrap
                    ? '0 0 15px rgba(6, 182, 212, 0.2)'
                    : '0 0 10px rgba(75, 85, 99, 0.1)',
                  cursor: nft.canUnwrap ? 'pointer' : 'not-allowed',
                  opacity: nft.canUnwrap ? 1 : 0.6,
                }}
                onMouseEnter={(e) => {
                  if (nft.canUnwrap) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.5), rgba(59, 130, 246, 0.5))';
                    e.currentTarget.style.boxShadow = '0 0 25px rgba(6, 182, 212, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (nft.canUnwrap) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))';
                    e.currentTarget.style.boxShadow = '0 0 15px rgba(6, 182, 212, 0.2)';
                  }
                }}
              >
                <div className="flex-1">
                  <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>
                    Wrap NFT
                  </span>
                  <p className="text-cyan-100 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>
                    {nft.canUnwrap
                      ? 'Convert to fungible wNFT'
                      : `Cooldown: ${timeRemaining}`
                    }
                  </p>
                </div>
              </button>

              {/* Option 2: Stake Snake */}
              <button
                onClick={() => {
                  onClose();
                  setIsOpen(false);
                  router.push('/?fastTravelStake=true');
                }}
                className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
                style={{
                  padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                  gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))',
                  border: '2px solid rgba(168, 85, 247, 0.5)',
                  boxShadow: '0 0 15px rgba(168, 85, 247, 0.2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(139, 92, 246, 0.5))';
                  e.currentTarget.style.boxShadow = '0 0 25px rgba(168, 85, 247, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.3))';
                  e.currentTarget.style.boxShadow = '0 0 15px rgba(168, 85, 247, 0.2)';
                }}
              >
                <span style={{ fontSize: 'clamp(1.25rem, 3vh, 1.5rem)' }}>💎</span>
                <div>
                  <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>Stake Snake</span>
                  <p className="text-purple-100 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>Stake your snake to earn token rewards</p>
                </div>
              </button>

              {/* Option 3: Jail (can't jail snakes) */}
              <button
                className="w-full text-white rounded-lg transition-all text-left flex items-center relative overflow-hidden"
                style={{
                  padding: 'clamp(0.625rem, 2vh, 0.75rem) clamp(0.75rem, 2.5vw, 1rem)',
                  gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                  background: 'linear-gradient(135deg, rgba(75, 85, 99, 0.3), rgba(55, 65, 81, 0.3))',
                  border: '2px solid rgba(75, 85, 99, 0.5)',
                  boxShadow: '0 0 10px rgba(75, 85, 99, 0.1)',
                  cursor: 'not-allowed',
                  opacity: 0.5,
                }}
              >
                <span style={{ fontSize: 'clamp(1.25rem, 3vh, 1.5rem)' }}>⛓️</span>
                <div>
                  <span className="font-semibold block" style={{ fontSize: 'clamp(0.875rem, 2vh, 1rem)' }}>Jail</span>
                  <p className="text-gray-300 mt-1" style={{ fontSize: 'clamp(0.75rem, 1.6vh, 0.875rem)' }}>
                    You cant fit a 120 foot snake in this jail cell...
                  </p>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t border-cyan-500/20"
          style={{
            padding: 'clamp(0.75rem, 2.5vh, 1rem)'
          }}
        >
          <button
            onClick={onClose}
            className="w-full text-white rounded-lg transition-colors"
            style={{
              padding: 'clamp(0.5rem, 1.5vh, 0.625rem) clamp(0.75rem, 2.5vw, 1rem)',
              fontSize: 'clamp(0.875rem, 2vh, 1rem)',
              background: 'linear-gradient(135deg, rgba(75, 85, 99, 0.8), rgba(55, 65, 81, 0.8))',
              border: '1px solid rgba(6, 182, 212, 0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(168, 85, 247, 0.3))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(75, 85, 99, 0.8), rgba(55, 65, 81, 0.8))';
            }}
          >
            Close
          </button>
        </div>
        </div> {/* Close content wrapper */}

        {/* CSS animations */}
        <style jsx>{`
          @keyframes shimmer {
            0% {
              transform: translateX(-100%);
            }
            100% {
              transform: translateX(100%);
            }
          }
        `}</style>
      </div>
    </div>
  );
}
