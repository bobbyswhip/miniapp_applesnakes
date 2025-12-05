'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useChainId } from 'wagmi';
import { NFT_ADDRESS, TOKEN_ADDRESS, HOOK_ADDRESS, POOL_MANAGER_ADDRESS } from '@/config';
import { ServerStatusDashboard } from '@/components/ServerStatusDashboard';
import { TokenLaunchForm } from '@/components/TokenLaunchForm';
import { X402TokenLauncher } from '@/components/X402TokenLauncher';

// PredictionJack fee constants from contracts
const PREDICTION_FEES = {
  // Trading fees (PredictionMarketHub.sol)
  TOTAL_TRADING_FEE: 1, // 1% total on trades
  CREATOR_FEE: 0.3, // 0.3% to game creator
  STAKING_FEE: 0.65, // 0.65% to stakers
  PROTOCOL_FEE: 0.05, // 0.05% to protocol

  // ETH trading fees
  ETH_CREATOR_FEE: 0.3, // 0.3% to creator
  ETH_PROTOCOL_FEE: 0.7, // 0.7% to protocol

  // Game fees (PredictionJack.sol)
  START_GAME_FEE: 0.00069, // ETH to start game
  START_GAME_PROTOCOL_FEE: 6.9, // 6.9% of start fee to protocol
  NO_MARKET_RAKE: 4.2, // 4.2% rake when no market

  // Timing
  TRADING_DELAY: 60, // 1 minute trading window
  VRF_TIMEOUT: 300, // 5 minute VRF timeout
};

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('overview');
  const chainId = useChainId();

  const sections = [
    { id: 'overview', title: '📖 Overview', emoji: '📖' },
    { id: 'vesting', title: '🔐 Vesting System', emoji: '🔐' },
    { id: 'features', title: '✨ Features', emoji: '✨' },
    { id: 'v4hook', title: '⚡ V4 Super Strategy', emoji: '⚡' },
    { id: 'prediction', title: '🃏 PredictionJack', emoji: '🃏' },
    { id: 'pairable', title: '🤝 Pairable Integration', emoji: '🤝' },
    { id: 'tokenomics', title: '💰 Tokenomics', emoji: '💰' },
    { id: 'token-launcher', title: '🚀 Token Launcher', emoji: '🚀' },
    { id: 'server-status', title: '🖥️ Server Status', emoji: '🖥️' },
  ];

  return (
    <div className="w-full h-screen overflow-y-auto p-4 md:p-8"
      style={{
        background: 'linear-gradient(135deg, #0A0B0D 0%, #1A1B1F 100%)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="glass rounded-2xl p-6 md:p-8 mb-6"
          style={{
            boxShadow: '0 0 40px rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}
        >
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors mb-4"
          >
            ← Back to Valley
          </Link>

          <div className="flex items-center gap-4 mb-4">
            <span className="text-6xl" style={{ filter: 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.6))' }}>
              🍎
            </span>
            <div>
              <h1
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{
                  background: 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #EC4899 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Apple Valley Whitepaper
              </h1>
              <p className="text-gray-400">A Revolutionary Fee-less NFT Gaming Ecosystem</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Navigation Sidebar */}
          <div className="lg:col-span-1">
            <div className="glass rounded-xl p-4 sticky top-4">
              <h3 className="text-lg font-semibold text-white mb-4">Navigation</h3>
              <nav className="space-y-2">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full text-left px-4 py-2 rounded-lg transition-all ${
                      activeSection === section.id
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
                    }`}
                  >
                    <span className="mr-2">{section.emoji}</span>
                    {section.title.replace(section.emoji + ' ', '')}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Overview */}
            {activeSection === 'overview' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                  📖 Welcome to Apple Valley
                </h2>

                <div className="space-y-4 text-gray-300">
                  <p className="text-lg leading-relaxed">
                    Apple Valley is a revolutionary NFT gaming ecosystem built on <span className="font-semibold text-blue-300">Base L2</span> that eliminates
                    traditional protocol fees by transforming every action into an <span className="font-semibold text-purple-300">investment opportunity</span>.
                  </p>

                  <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg p-5 space-y-3">
                    <h3 className="text-xl font-semibold text-blue-300 flex items-center gap-2">
                      <span>💡</span> Core Innovation
                    </h3>
                    <p className="leading-relaxed">
                      Every action in Apple Valley—minting, breeding, jailing, evolving, or hatching—isn&apos;t a fee. It&apos;s a <span className="font-bold">swap</span> through
                      our <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Uniswap V4 Super Strategy Hook</span>.
                      You receive $wNFTs tokens that vest over 90 days, turning protocol interactions into long-term value accumulation.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gradient-to-br from-green-950/40 to-emerald-950/40 border border-green-500/30 rounded-lg p-4">
                      <div className="text-3xl mb-2">🚫</div>
                      <h4 className="font-semibold text-green-300 mb-1">No Fees</h4>
                      <p className="text-sm text-gray-400">Every &quot;fee&quot; is actually a swap that returns value to you</p>
                    </div>

                    <div className="bg-gradient-to-br from-purple-950/40 to-pink-950/40 border border-purple-500/30 rounded-lg p-4">
                      <div className="text-3xl mb-2">🔐</div>
                      <h4 className="font-semibold text-purple-300 mb-1">90-Day Vesting</h4>
                      <p className="text-sm text-gray-400">Claim 1% daily or wait for 100% unlock</p>
                    </div>

                    <div className="bg-gradient-to-br from-blue-950/40 to-cyan-950/40 border border-blue-500/30 rounded-lg p-4">
                      <div className="text-3xl mb-2">⚡</div>
                      <h4 className="font-semibold text-blue-300 mb-1">V4 Powered</h4>
                      <p className="text-sm text-gray-400">Built on Uniswap V4 super strategy hooks</p>
                    </div>
                  </div>

                  <div className="bg-orange-950/30 border border-orange-500/30 rounded-lg p-5">
                    <h3 className="text-xl font-semibold text-orange-300 flex items-center gap-2 mb-3">
                      <span>🎮</span> Game Mechanics
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-start gap-2">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span><strong>Swap Mint:</strong> Convert ETH to NFTs (max 3000)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span><strong>Breeding:</strong> Burn 3 humans to create 1 snake (IDs 3001+)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span><strong>Jail System:</strong> Wardens can jail/unjail for game dynamics</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span><strong>Egg Hatching:</strong> All snakes start as eggs for 7 days</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span><strong>Evolution:</strong> Upgrade your NFTs to evolved forms</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Vesting System */}
            {activeSection === 'vesting' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                  🔐 Vesting System
                </h2>

                <div className="space-y-4 text-gray-300">
                  <p className="text-lg leading-relaxed">
                    The vesting system is the core innovation that transforms Apple Valley from a fee-taking platform
                    into an <span className="font-semibold text-emerald-300">investment vehicle</span>.
                  </p>

                  <div className="bg-gradient-to-br from-cyan-950/40 via-purple-950/40 to-pink-950/40 border border-cyan-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-cyan-300 mb-4">How It Works</h3>
                    <div className="space-y-4">
                      <div className="border-l-4 border-cyan-500 pl-4">
                        <h4 className="font-semibold text-lg text-white mb-2">1. Every Action is a Swap</h4>
                        <p className="text-gray-300">
                          When you perform any action (mint, breed, jail, evolve, hatch), your ETH is swapped through our
                          V4 Super Strategy Hook for $wNFTs tokens. These tokens are immediately added to your vesting balance.
                        </p>
                      </div>

                      <div className="border-l-4 border-purple-500 pl-4">
                        <h4 className="font-semibold text-lg text-white mb-2">2. 90-Day Vesting Period</h4>
                        <p className="text-gray-300">
                          Your $wNFTs vest over 90 days. You have two claiming options:
                        </p>
                        <ul className="mt-2 space-y-1 text-sm">
                          <li className="flex items-center gap-2">
                            <span className="text-green-400">✓</span>
                            <span>Claim <strong>1% per day</strong> (once every 24 hours)</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-green-400">✓</span>
                            <span>Wait <strong>90 days</strong> to claim 100% at once</span>
                          </li>
                        </ul>
                      </div>

                      <div className="border-l-4 border-pink-500 pl-4">
                        <h4 className="font-semibold text-lg text-white mb-2">3. Rolling Vesting</h4>
                        <p className="text-gray-300">
                          Each new action resets the 90-day countdown for that portion of tokens. This encourages active
                          participation while rewarding long-term holders.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-green-950/30 border border-green-500/30 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-green-300 mb-3">Benefits</h4>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">✓</span>
                          <span>Turn fees into investments</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">✓</span>
                          <span>Flexible claiming schedule</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">✓</span>
                          <span>Long-term value accumulation</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">✓</span>
                          <span>Aligned incentives</span>
                        </li>
                      </ul>
                    </div>

                    <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-blue-300 mb-3">Track Your Vesting</h4>
                      <p className="text-sm text-gray-300 mb-3">
                        Monitor your vesting balance, claimable amounts, and unlock timeline:
                      </p>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <span>In-app vesting stats dashboard</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <a
                            href="https://pairable.io/#/contracts/superstrat"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-300 hover:text-purple-200 underline"
                          >
                            Pairable dashboard
                          </a>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Features */}
            {activeSection === 'features' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-pink-400">
                  ✨ Features
                </h2>

                <div className="space-y-6 text-gray-300">
                  {/* Swap Minting */}
                  <div className="bg-gradient-to-br from-blue-950/40 to-cyan-950/40 border border-blue-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-blue-300 mb-3 flex items-center gap-2">
                      <span>🔄</span> Swap Minting
                    </h3>
                    <p className="leading-relaxed mb-3">
                      Convert ETH directly into NFTs through our V4 Super Strategy Hook. Each whole token received = 1 NFT minted.
                    </p>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">
                        <span className="text-blue-400">•</span>
                        <span>Maximum 3000 swap-minted NFTs (IDs 1-3000)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-blue-400">•</span>
                        <span>All tokens from swap vest in your wallet</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-blue-400">•</span>
                        <span>Instant NFT + long-term token value</span>
                      </li>
                    </ul>
                  </div>

                  {/* Breeding */}
                  <div className="bg-gradient-to-br from-purple-950/40 to-pink-950/40 border border-purple-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-purple-300 mb-3 flex items-center gap-2">
                      <span>🐍</span> Breeding System
                    </h3>
                    <p className="leading-relaxed mb-3">
                      Burn 3 human NFTs to create 1 snake NFT. Snakes are unique and start as eggs.
                    </p>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">
                        <span className="text-purple-400">•</span>
                        <span>Snake IDs start at 3001 (unlimited breeding)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-purple-400">•</span>
                        <span>Breeding fee swaps to vesting $wNFTs</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-purple-400">•</span>
                        <span>Creates deflationary pressure on humans</span>
                      </li>
                    </ul>
                  </div>

                  {/* Jail System */}
                  <div className="bg-gradient-to-br from-red-950/40 to-orange-950/40 border border-red-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-red-300 mb-3 flex items-center gap-2">
                      <span>🔒</span> Jail System
                    </h3>
                    <p className="leading-relaxed mb-3">
                      Dynamic game mechanic where wardens can jail NFTs. Jailed for 7 days.
                    </p>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">
                        <span className="text-red-400">•</span>
                        <span>Wardens jail/unjail for free (game dynamics)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-red-400">•</span>
                        <span>Users pay to jail/unjail (swaps & vests)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-red-400">•</span>
                        <span>Adds strategy and community interaction</span>
                      </li>
                    </ul>
                  </div>

                  {/* Egg Hatching */}
                  <div className="bg-gradient-to-br from-yellow-950/40 to-orange-950/40 border border-yellow-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-yellow-300 mb-3 flex items-center gap-2">
                      <span>🥚</span> Egg Hatching
                    </h3>
                    <p className="leading-relaxed mb-3">
                      All bred snakes start as eggs. Natural hatching takes 7 days.
                    </p>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">
                        <span className="text-yellow-400">•</span>
                        <span>Auto-hatch after 7 days (free)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-yellow-400">•</span>
                        <span>Instant hatch available (swaps & vests)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-yellow-400">•</span>
                        <span>Adds excitement and anticipation</span>
                      </li>
                    </ul>
                  </div>

                  {/* Evolution */}
                  <div className="bg-gradient-to-br from-green-950/40 to-emerald-950/40 border border-green-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-green-300 mb-3 flex items-center gap-2">
                      <span>⚡</span> Evolution
                    </h3>
                    <p className="leading-relaxed mb-3">
                      Upgrade your NFTs to evolved forms with enhanced artwork and rarity.
                    </p>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">
                        <span className="text-green-400">•</span>
                        <span>Evolution fee swaps & vests</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-green-400">•</span>
                        <span>Permanent upgrade (cannot revert)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-green-400">•</span>
                        <span>Increased value and rarity</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* V4 Hook */}
            {activeSection === 'v4hook' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                  ⚡ V4 Super Strategy Hook
                </h2>

                <div className="space-y-4 text-gray-300">
                  <p className="text-lg leading-relaxed">
                    Our V4 Super Strategy Hook is built on <span className="font-semibold text-blue-300">Uniswap V4</span>, the latest
                    iteration of the world&apos;s most advanced decentralized exchange protocol.
                  </p>

                  <div className="bg-gradient-to-br from-blue-950/40 via-purple-950/40 to-pink-950/40 border border-blue-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-blue-300 mb-4">What is a Hook?</h3>
                    <p className="leading-relaxed mb-4">
                      Uniswap V4 hooks are programmable contracts that execute custom logic during swap lifecycle events.
                      Our Super Strategy Hook intercepts every protocol interaction to:
                    </p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">1️⃣</span>
                        <span>Convert your ETH payment into a swap through the ETH/$wNFTs pool</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">2️⃣</span>
                        <span>Route all received $wNFTs to your vesting contract</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">3️⃣</span>
                        <span>Update your vesting balance and reset your 90-day timer</span>
                      </li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-purple-300 mb-3">Technical Benefits</h4>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Gas-efficient single transaction</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Guaranteed execution via hooks</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Permissionless and trustless</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Built on battle-tested V4 core</span>
                        </li>
                      </ul>
                    </div>

                    <div className="bg-green-950/30 border border-green-500/30 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-green-300 mb-3">User Benefits</h4>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">•</span>
                          <span>No manual token claiming needed</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">•</span>
                          <span>Transparent on-chain logic</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">•</span>
                          <span>Fair market pricing via AMM</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">•</span>
                          <span>Seamless user experience</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="bg-orange-950/30 border border-orange-500/30 rounded-lg p-5">
                    <h3 className="text-xl font-semibold text-orange-300 flex items-center gap-2 mb-3">
                      <span>🔗</span> Contract Addresses
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-400">NFT Contract:</span>{' '}
                        <code className="text-blue-300 bg-black/30 px-2 py-1 rounded">
                          {NFT_ADDRESS(chainId)}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-400">$wNFTs Token:</span>{' '}
                        <code className="text-blue-300 bg-black/30 px-2 py-1 rounded">
                          {TOKEN_ADDRESS(chainId)}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-400">Pool Manager:</span>{' '}
                        <code className="text-blue-300 bg-black/30 px-2 py-1 rounded">
                          {POOL_MANAGER_ADDRESS}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-400">Hook:</span>{' '}
                        <code className="text-blue-300 bg-black/30 px-2 py-1 rounded">
                          {HOOK_ADDRESS}
                        </code>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PredictionJack - Prediction Market Blackjack */}
            {activeSection === 'prediction' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                  🃏 PredictionJack
                </h2>

                <div className="space-y-4 text-gray-300">
                  <p className="text-lg leading-relaxed">
                    PredictionJack combines classic Blackjack with prediction markets. Start a game, let others bet on your outcome,
                    and earn fees from trading volume. Built with <span className="font-semibold text-blue-300">Chainlink VRF</span> for
                    provably fair randomness.
                  </p>

                  {/* How It Works */}
                  <div className="bg-gradient-to-br from-purple-950/40 via-pink-950/40 to-red-950/40 border border-purple-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-purple-300 mb-4">How It Works</h3>
                    <div className="space-y-4">
                      <div className="flex gap-4">
                        <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">1</div>
                        <div>
                          <h4 className="font-bold text-white">Start a Game</h4>
                          <p className="text-gray-400">Pay {PREDICTION_FEES.START_GAME_FEE} ETH (or equivalent in $wASS) to start. You&apos;ll receive your initial cards via Chainlink VRF.</p>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">2</div>
                        <div>
                          <h4 className="font-bold text-white">Trading Period</h4>
                          <p className="text-gray-400">A {PREDICTION_FEES.TRADING_DELAY}-second trading window opens. Anyone can buy YES/NO shares betting on your outcome.</p>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">3</div>
                        <div>
                          <h4 className="font-bold text-white">Play Your Hand</h4>
                          <p className="text-gray-400">After trading ends, Hit or Stand to complete your hand. Each action opens a new trading window.</p>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">4</div>
                        <div>
                          <h4 className="font-bold text-white">Resolution & Payout</h4>
                          <p className="text-gray-400">Winning shares pay out 1 $wASS token each. Losers get nothing. Push = all deposits refunded.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Trading Shares */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-green-950/30 border border-green-500/30 rounded-xl p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-4xl">✅</span>
                        <div>
                          <h4 className="font-bold text-green-400 text-lg">YES Shares</h4>
                          <p className="text-sm text-gray-400">Player wins</p>
                        </div>
                      </div>
                      <p className="text-gray-300 text-sm">
                        Buy YES if you think the player will beat the dealer. Each share pays 1 token if player wins.
                      </p>
                    </div>
                    <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-4xl">❌</span>
                        <div>
                          <h4 className="font-bold text-red-400 text-lg">NO Shares</h4>
                          <p className="text-sm text-gray-400">Dealer wins</p>
                        </div>
                      </div>
                      <p className="text-gray-300 text-sm">
                        Buy NO if you think the dealer will win. Each share pays 1 token if player loses.
                      </p>
                    </div>
                  </div>

                  {/* Fee Structure */}
                  <div className="bg-blue-950/30 border border-blue-500/30 rounded-xl p-6">
                    <h3 className="text-xl font-semibold text-blue-300 mb-4 flex items-center gap-2">
                      <span>💰</span> Fee Structure
                    </h3>
                    <div className="space-y-4">
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-700">
                          <span className="text-white font-bold">Total Trading Fee</span>
                          <span className="text-xl font-bold text-purple-400">{PREDICTION_FEES.TOTAL_TRADING_FEE}%</span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-400">→ Game Creator</span>
                            <span className="text-green-400 font-semibold">{PREDICTION_FEES.CREATOR_FEE}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">→ Stakers Pool</span>
                            <span className="text-blue-400 font-semibold">{PREDICTION_FEES.STAKING_FEE}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">→ Protocol</span>
                            <span className="text-purple-400 font-semibold">{PREDICTION_FEES.PROTOCOL_FEE}%</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400">
                        Example: $1,000 in trading volume = $3.00 to creator, $6.50 to stakers, $0.50 to protocol
                      </p>
                    </div>
                  </div>

                  {/* Ways to Earn */}
                  <div className="bg-gradient-to-br from-green-950/40 to-emerald-950/40 border border-green-500/30 rounded-xl p-6">
                    <h3 className="text-xl font-semibold text-green-300 mb-4 flex items-center gap-2">
                      <span>🏆</span> Ways to Earn
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h4 className="font-bold text-purple-400 mb-2">🃏 As Creator</h4>
                        <p className="text-sm text-gray-300">Earn {PREDICTION_FEES.CREATOR_FEE}% of all trading on your game. High-stakes games = more fees!</p>
                      </div>
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h4 className="font-bold text-green-400 mb-2">📈 As Trader</h4>
                        <p className="text-sm text-gray-300">Spot mispriced odds and buy shares. Winning shares pay 1 token each.</p>
                      </div>
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h4 className="font-bold text-blue-400 mb-2">🏦 As Staker</h4>
                        <p className="text-sm text-gray-300">Stake $wASS to earn {PREDICTION_FEES.STAKING_FEE}% of all platform trading fees.</p>
                      </div>
                    </div>
                  </div>

                  {/* Blackjack Rules Quick Reference */}
                  <div className="bg-orange-950/30 border border-orange-500/30 rounded-lg p-5">
                    <h3 className="text-xl font-semibold text-orange-300 flex items-center gap-2 mb-3">
                      <span>🎰</span> Quick Blackjack Rules
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <h4 className="font-bold text-white mb-2">Card Values</h4>
                        <ul className="space-y-1 text-gray-300">
                          <li>2-10 = Face value</li>
                          <li>J, Q, K = 10 points</li>
                          <li>Ace = 1 or 11 points</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="font-bold text-white mb-2">Win Conditions</h4>
                        <ul className="space-y-1 text-gray-300">
                          <li>✓ Closer to 21 than dealer</li>
                          <li>✓ Dealer busts (over 21)</li>
                          <li>✓ Blackjack (A + 10-card)</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Play Now CTA */}
                  <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-2 border-purple-500/50 rounded-xl p-6 text-center">
                    <h4 className="text-2xl font-bold text-white mb-3">Ready to Play?</h4>
                    <p className="text-gray-300 mb-4">
                      Start a game, trade on outcomes, or stake to earn passive income
                    </p>
                    <Link
                      href="/?fastTravelPrediction=true"
                      className="inline-block px-8 py-3 rounded-lg font-semibold text-white transition-all transform hover:scale-105"
                      style={{
                        background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
                        boxShadow: '0 0 20px rgba(139, 92, 246, 0.5)',
                      }}
                    >
                      🃏 Open PredictionJack →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Pairable Integration */}
            {activeSection === 'pairable' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                  🤝 Pairable Integration
                </h2>

                <div className="space-y-4 text-gray-300">
                  <p className="text-lg leading-relaxed">
                    <a
                      href="https://pairable.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 hover:from-purple-300 hover:to-pink-300"
                    >
                      Pairable
                    </a> is our sister application that provides advanced portfolio management and analytics for
                    Uniswap V4 super strategy positions.
                  </p>

                  <div className="bg-gradient-to-br from-purple-950/40 via-pink-950/40 to-red-950/40 border border-purple-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-purple-300 mb-4">What is Pairable?</h3>
                    <p className="leading-relaxed mb-4">
                      Pairable is a comprehensive dashboard for tracking and managing your V4 super strategy positions.
                      It integrates seamlessly with Apple Valley to provide:
                    </p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">📊</span>
                        <div>
                          <strong className="text-white">Real-time Analytics</strong>
                          <p className="text-sm text-gray-400">Track your vesting balance, claimable amounts, and ROI across all positions</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">💰</span>
                        <div>
                          <strong className="text-white">Portfolio Management</strong>
                          <p className="text-sm text-gray-400">View all your super strategy positions in one unified dashboard</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">🎯</span>
                        <div>
                          <strong className="text-white">Claiming Interface</strong>
                          <p className="text-sm text-gray-400">Easily claim your vested tokens with optimal gas efficiency</p>
                        </div>
                      </li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-blue-300 mb-3">Apple Valley Features</h4>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <span>Track Apple Valley vesting positions</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <span>View historical swap activity</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <span>Monitor NFT-linked vesting</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <span>Optimize claiming strategy</span>
                        </li>
                      </ul>
                    </div>

                    <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-5">
                      <h4 className="text-lg font-semibold text-purple-300 mb-3">Multi-Protocol Support</h4>
                      <p className="text-sm text-gray-300 mb-3">
                        Pairable works with all V4 super strategy positions:
                      </p>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Apple Valley (AppleSnakes NFT)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Other V4 hook projects</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400">•</span>
                          <span>Cross-protocol analytics</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-2 border-purple-500/50 rounded-xl p-6 text-center">
                    <h4 className="text-2xl font-bold text-white mb-3">Visit Pairable</h4>
                    <p className="text-gray-300 mb-4">
                      Track your Apple Valley vesting positions and claim your tokens
                    </p>
                    <a
                      href="https://pairable.io/#/contracts/superstrat"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-8 py-3 rounded-lg font-semibold text-white transition-all transform hover:scale-105"
                      style={{
                        background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
                        boxShadow: '0 0 20px rgba(139, 92, 246, 0.5)',
                      }}
                    >
                      Open Pairable Dashboard →
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Tokenomics */}
            {activeSection === 'tokenomics' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400">
                  💰 Tokenomics
                </h2>

                <div className="space-y-4 text-gray-300">
                  <p className="text-lg leading-relaxed">
                    $wNFTs (Wrapped NFTs) is the native token of the Apple Valley ecosystem, distributed through protocol interactions.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gradient-to-br from-yellow-950/40 to-orange-950/40 border border-yellow-500/30 rounded-xl p-5">
                      <div className="text-4xl mb-3">🪙</div>
                      <h4 className="text-lg font-semibold text-yellow-300 mb-2">Fair Distribution</h4>
                      <p className="text-sm">
                        All tokens are earned through protocol usage. No pre-mine, no team allocation.
                      </p>
                    </div>

                    <div className="bg-gradient-to-br from-purple-950/40 to-pink-950/40 border border-purple-500/30 rounded-xl p-5">
                      <div className="text-4xl mb-3">🔥</div>
                      <h4 className="text-lg font-semibold text-purple-300 mb-2">Deflationary</h4>
                      <p className="text-sm">
                        Breeding burns NFTs. Evolution and other actions create constant buy pressure.
                      </p>
                    </div>

                    <div className="bg-gradient-to-br from-blue-950/40 to-cyan-950/40 border border-blue-500/30 rounded-xl p-5">
                      <div className="text-4xl mb-3">💎</div>
                      <h4 className="text-lg font-semibold text-blue-300 mb-2">Long-term Value</h4>
                      <p className="text-sm">
                        90-day vesting encourages holding and reduces sell pressure.
                      </p>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-emerald-950/40 via-teal-950/40 to-cyan-950/40 border border-emerald-500/30 rounded-xl p-6">
                    <h3 className="text-2xl font-semibold text-emerald-300 mb-4">Token Utility</h3>
                    <ul className="space-y-3">
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">🎮</span>
                        <div>
                          <strong className="text-white">Governance</strong>
                          <p className="text-sm text-gray-400">Future DAO governance for protocol parameters</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">💱</span>
                        <div>
                          <strong className="text-white">Liquidity</strong>
                          <p className="text-sm text-gray-400">Trade on Uniswap V4 with deep liquidity</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-2xl">🏆</span>
                        <div>
                          <strong className="text-white">Rewards</strong>
                          <p className="text-sm text-gray-400">Earned through all protocol interactions</p>
                        </div>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-orange-950/30 border border-orange-500/30 rounded-lg p-5">
                    <h3 className="text-xl font-semibold text-orange-300 flex items-center gap-2 mb-3">
                      <span>📈</span> Value Accrual
                    </h3>
                    <p className="text-sm leading-relaxed">
                      Every protocol interaction creates buy pressure for $wNFTs through the V4 pool. As the ecosystem grows,
                      so does the liquidity and value of the token. Vesting ensures a healthy supply distribution over time,
                      preventing dumps while rewarding active participants.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Token Launcher */}
            {activeSection === 'token-launcher' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                  🚀 Token Launcher
                </h2>

                <p className="text-lg leading-relaxed text-gray-300">
                  Deploy your own token on Base paired with WASS through Clanker.
                  Tokens launch with automatic liquidity and WASS pairing.
                </p>

                <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-5 space-y-3">
                  <h3 className="text-xl font-semibold text-purple-300 flex items-center gap-2">
                    <span>&#x2728;</span> Launch Features
                  </h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-300">
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">&#x2714;</span>
                      Automatic WASS pairing
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">&#x2714;</span>
                      IPFS image hosting
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">&#x2714;</span>
                      ~$10 starting market cap
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">&#x2714;</span>
                      Optional dev buy
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">&#x2714;</span>
                      Real-time progress tracking
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">&#x2714;</span>
                      Dexscreener listing
                    </li>
                  </ul>
                </div>

                {/* ETH Payment Option */}
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <span className="text-blue-400">Ξ</span> Pay with ETH
                  </h3>
                  <TokenLaunchForm />
                </div>

                {/* USDC Payment Option (x402) */}
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <span className="text-green-400">$</span> Pay with USDC (Gasless)
                  </h3>
                  <p className="text-sm text-gray-400 mb-3">
                    Sign a message to authorize USDC payment - no gas fees required!
                  </p>
                  <X402TokenLauncher />
                </div>
              </div>
            )}

            {/* Server Status */}
            {activeSection === 'server-status' && (
              <div className="glass rounded-xl p-6 md:p-8 space-y-6">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
                  🖥️ Server Status
                </h2>

                <p className="text-lg leading-relaxed text-gray-300">
                  Real-time status of Apple Valley backend systems. Auto-refreshes every 10 seconds.
                </p>

                <ServerStatusDashboard />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
