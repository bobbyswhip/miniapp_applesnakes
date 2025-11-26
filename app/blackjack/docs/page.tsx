'use client';

import { useState } from 'react';
import Link from 'next/link';

// Fee constants from contracts
const FEES = {
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

type Section = 'overview' | 'trading' | 'fees' | 'earnings' | 'mechanics' | 'faq';

export default function PredictionMarketDocs() {
  const [activeSection, setActiveSection] = useState<Section>('overview');

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📖' },
    { id: 'trading', label: 'Trading', icon: '📊' },
    { id: 'fees', label: 'Fees', icon: '💰' },
    { id: 'earnings', label: 'Earnings', icon: '🏆' },
    { id: 'mechanics', label: 'Game Mechanics', icon: '🎰' },
    { id: 'faq', label: 'FAQ', icon: '❓' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900/20 to-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-purple-500/30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🃏</span>
            <div>
              <h1 className="text-xl font-bold text-white">PredictionJack Docs</h1>
              <p className="text-xs text-purple-400">Prediction Market Blackjack</p>
            </div>
          </div>
          <Link
            href="/?fastTravelPrediction=true"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <span>Play Now</span>
            <span>→</span>
          </Link>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="sticky top-[73px] z-40 bg-gray-900/90 backdrop-blur-sm border-b border-gray-700/50">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex overflow-x-auto gap-1 py-2 scrollbar-hide">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-all ${
                  activeSection === section.id
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <span className="mr-2">{section.icon}</span>
                {section.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Overview Section */}
        {activeSection === 'overview' && (
          <div className="space-y-8">
            <div className="bg-gray-800/50 rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🎯</span> What is PredictionJack?
              </h2>
              <p className="text-gray-300 leading-relaxed mb-4">
                PredictionJack combines classic Blackjack with prediction markets. When you start a game,
                other players can bet on whether you&apos;ll win or lose. Trade YES/NO shares based on your
                prediction of the game outcome.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-purple-900/30 rounded-xl p-4 border border-purple-500/20">
                  <div className="text-3xl mb-2">🃏</div>
                  <h3 className="font-bold text-white mb-1">Play Blackjack</h3>
                  <p className="text-sm text-gray-400">Classic 21 gameplay with real stakes</p>
                </div>
                <div className="bg-green-900/30 rounded-xl p-4 border border-green-500/20">
                  <div className="text-3xl mb-2">📈</div>
                  <h3 className="font-bold text-white mb-1">Trade Outcomes</h3>
                  <p className="text-sm text-gray-400">Buy YES or NO shares on any game</p>
                </div>
                <div className="bg-yellow-900/30 rounded-xl p-4 border border-yellow-500/20">
                  <div className="text-3xl mb-2">💰</div>
                  <h3 className="font-bold text-white mb-1">Earn Fees</h3>
                  <p className="text-sm text-gray-400">Game creators earn from trades</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>⚡</span> How It Works
              </h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">1</div>
                  <div>
                    <h3 className="font-bold text-white">Start a Game</h3>
                    <p className="text-gray-400">Pay {FEES.START_GAME_FEE} ETH to start. You&apos;ll receive your initial cards.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">2</div>
                  <div>
                    <h3 className="font-bold text-white">Trading Period</h3>
                    <p className="text-gray-400">A {FEES.TRADING_DELAY}-second trading window opens. Anyone can buy YES/NO shares.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">3</div>
                  <div>
                    <h3 className="font-bold text-white">Play Your Hand</h3>
                    <p className="text-gray-400">After trading ends, Hit or Stand to complete your hand.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-white">4</div>
                  <div>
                    <h3 className="font-bold text-white">Resolution</h3>
                    <p className="text-gray-400">Winning shares pay out 1 token each. Losers get nothing.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                <span>🎲</span> Chainlink VRF Integration
              </h2>
              <p className="text-gray-300">
                All card draws use Chainlink VRF (Verifiable Random Function) for provably fair randomness.
                Each card is cryptographically verified on-chain, ensuring no manipulation is possible.
              </p>
            </div>
          </div>
        )}

        {/* Trading Section */}
        {activeSection === 'trading' && (
          <div className="space-y-8">
            <div className="bg-gray-800/50 rounded-2xl p-6 border border-green-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>📊</span> Understanding Shares
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-green-900/30 rounded-xl p-5 border border-green-500/30">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-4xl">✅</span>
                    <div>
                      <h3 className="font-bold text-green-400 text-lg">YES Shares</h3>
                      <p className="text-sm text-gray-400">Player wins</p>
                    </div>
                  </div>
                  <p className="text-gray-300">
                    Buy YES if you think the player will beat the dealer.
                    Each YES share pays out 1 token if the player wins.
                  </p>
                </div>
                <div className="bg-red-900/30 rounded-xl p-5 border border-red-500/30">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-4xl">❌</span>
                    <div>
                      <h3 className="font-bold text-red-400 text-lg">NO Shares</h3>
                      <p className="text-sm text-gray-400">Dealer wins</p>
                    </div>
                  </div>
                  <p className="text-gray-300">
                    Buy NO if you think the dealer will win.
                    Each NO share pays out 1 token if the player loses.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>💹</span> Share Pricing (LMSR)
              </h2>
              <p className="text-gray-300 mb-4">
                Share prices are determined by the <strong className="text-purple-400">Logarithmic Market Scoring Rule (LMSR)</strong>,
                a proven market maker algorithm. Prices automatically adjust based on demand:
              </p>
              <div className="bg-gray-900/50 rounded-xl p-4 font-mono text-sm mb-4">
                <div className="text-purple-400 mb-2">{`// Price calculation`}</div>
                <div className="text-gray-300">Price = e^(shares/b) / (e^(yesShares/b) + e^(noShares/b))</div>
                <div className="text-gray-500 mt-2">{`// b = liquidity parameter (controls price sensitivity)`}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900/50 rounded-lg p-4">
                  <h4 className="font-bold text-white mb-2">More YES bought →</h4>
                  <p className="text-gray-400 text-sm">YES price increases, NO price decreases</p>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-4">
                  <h4 className="font-bold text-white mb-2">More NO bought →</h4>
                  <p className="text-gray-400 text-sm">NO price increases, YES price decreases</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-yellow-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>⏱️</span> Trading Windows
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-yellow-600/30 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">🎬</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Initial Deal</h3>
                    <p className="text-gray-400">After cards are dealt, a {FEES.TRADING_DELAY}-second trading window opens. This is when most trading happens as players assess the initial odds.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-yellow-600/30 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">🃏</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">After Each Action</h3>
                    <p className="text-gray-400">Each Hit or Stand triggers a new trading window, allowing traders to react to the new game state.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-red-600/30 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">🚫</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">No Market Cases</h3>
                    <p className="text-gray-400">Blackjack (21 on first two cards) or guaranteed outcomes skip market creation entirely.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fees Section */}
        {activeSection === 'fees' && (
          <div className="space-y-8">
            <div className="bg-gray-800/50 rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>💸</span> Fee Structure
              </h2>
              <p className="text-gray-300 mb-6">
                Fees are distributed to game creators, stakers, and the protocol. All fees are automatically handled on-chain.
              </p>

              {/* Trading Fees */}
              <div className="mb-8">
                <h3 className="text-lg font-bold text-purple-400 mb-4 flex items-center gap-2">
                  <span>📈</span> Trading Fees (Token Trades)
                </h3>
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-700">
                    <span className="text-white font-bold">Total Trading Fee</span>
                    <span className="text-2xl font-bold text-purple-400">{FEES.TOTAL_TRADING_FEE}%</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                        <span className="text-gray-300">Game Creator</span>
                      </div>
                      <span className="text-green-400 font-semibold">{FEES.CREATOR_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                        <span className="text-gray-300">Stakers Pool</span>
                      </div>
                      <span className="text-blue-400 font-semibold">{FEES.STAKING_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
                        <span className="text-gray-300">Protocol</span>
                      </div>
                      <span className="text-purple-400 font-semibold">{FEES.PROTOCOL_FEE}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ETH Trading Fees */}
              <div className="mb-8">
                <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                  <span>⟠</span> ETH Trading Fees
                </h3>
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-700">
                    <span className="text-white font-bold">Total ETH Fee</span>
                    <span className="text-2xl font-bold text-blue-400">1%</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                        <span className="text-gray-300">Game Creator</span>
                      </div>
                      <span className="text-green-400 font-semibold">{FEES.ETH_CREATOR_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
                        <span className="text-gray-300">Protocol</span>
                      </div>
                      <span className="text-purple-400 font-semibold">{FEES.ETH_PROTOCOL_FEE}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Game Fees */}
              <div>
                <h3 className="text-lg font-bold text-yellow-400 mb-4 flex items-center gap-2">
                  <span>🎮</span> Game Fees
                </h3>
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-700">
                      <div>
                        <span className="text-white font-bold">Start Game Fee</span>
                        <p className="text-sm text-gray-500">Required to start a new game</p>
                      </div>
                      <span className="text-xl font-bold text-yellow-400">{FEES.START_GAME_FEE} ETH</span>
                    </div>
                    <div className="flex items-center justify-between pb-3 border-b border-gray-700">
                      <div>
                        <span className="text-gray-300">Protocol Fee (from start fee)</span>
                      </div>
                      <span className="text-purple-400 font-semibold">{FEES.START_GAME_PROTOCOL_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-gray-300">No-Market Rake</span>
                        <p className="text-sm text-gray-500">When market skipped (blackjack, etc.)</p>
                      </div>
                      <span className="text-orange-400 font-semibold">{FEES.NO_MARKET_RAKE}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 rounded-2xl p-6 border border-green-500/30">
              <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                <span>💡</span> Fee Example
              </h3>
              <p className="text-gray-300 mb-4">
                If $1,000 worth of tokens are traded on your game:
              </p>
              <div className="bg-gray-900/50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Your earnings (creator)</span>
                  <span className="text-green-400 font-bold">$3.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Stakers pool</span>
                  <span className="text-blue-400">$6.50</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Protocol</span>
                  <span className="text-purple-400">$0.50</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Earnings Section */}
        {activeSection === 'earnings' && (
          <div className="space-y-8">
            <div className="bg-gray-800/50 rounded-2xl p-6 border border-green-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🏆</span> Ways to Earn
              </h2>

              <div className="space-y-6">
                {/* As a Player */}
                <div className="bg-purple-900/30 rounded-xl p-5 border border-purple-500/20">
                  <h3 className="text-lg font-bold text-purple-400 mb-3 flex items-center gap-2">
                    <span>🃏</span> As a Game Creator
                  </h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-start gap-2">
                      <span className="text-green-400">•</span>
                      <span>Earn <strong className="text-green-400">{FEES.CREATOR_FEE}%</strong> of all token trading volume on your game</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400">•</span>
                      <span>Earn <strong className="text-green-400">{FEES.ETH_CREATOR_FEE}%</strong> of all ETH trading volume</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400">•</span>
                      <span>More trading = more earnings (high-stakes games attract more traders)</span>
                    </li>
                  </ul>
                </div>

                {/* As a Trader */}
                <div className="bg-green-900/30 rounded-xl p-5 border border-green-500/20">
                  <h3 className="text-lg font-bold text-green-400 mb-3 flex items-center gap-2">
                    <span>📈</span> As a Trader
                  </h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-start gap-2">
                      <span className="text-green-400">•</span>
                      <span>Buy shares when you think odds are mispriced</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400">•</span>
                      <span>Winning shares pay out <strong className="text-green-400">1 token each</strong></span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400">•</span>
                      <span>Profit = (Shares × 1 token) - Cost of shares</span>
                    </li>
                  </ul>
                </div>

                {/* As a Staker */}
                <div className="bg-blue-900/30 rounded-xl p-5 border border-blue-500/20">
                  <h3 className="text-lg font-bold text-blue-400 mb-3 flex items-center gap-2">
                    <span>🏦</span> As a Staker
                  </h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-400">•</span>
                      <span>Stake tokens to earn <strong className="text-blue-400">{FEES.STAKING_FEE}%</strong> of all trading fees</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-400">•</span>
                      <span>Passive income from platform trading activity</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-400">•</span>
                      <span>Proportional share based on your stake amount</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>📊</span> Trading Strategy Tips
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <h4 className="font-bold text-green-400 mb-2">Buy YES When:</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>• Player has 19-21 vs dealer showing 2-6</li>
                    <li>• Player has strong hand, dealer has bust card</li>
                    <li>• Market odds are below true probability</li>
                  </ul>
                </div>
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <h4 className="font-bold text-red-400 mb-2">Buy NO When:</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>• Player has 12-16 vs dealer showing 7+</li>
                    <li>• Dealer has strong up card (10, A)</li>
                    <li>• Market is too optimistic on player</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-yellow-900/30 to-orange-900/30 rounded-2xl p-6 border border-yellow-500/30">
              <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                <span>⚠️</span> Risk Warning
              </h3>
              <p className="text-gray-300">
                Trading prediction market shares involves risk. You can lose your entire investment if your
                prediction is wrong. Only trade with funds you can afford to lose. Past performance does not
                guarantee future results.
              </p>
            </div>
          </div>
        )}

        {/* Mechanics Section */}
        {activeSection === 'mechanics' && (
          <div className="space-y-8">
            <div className="bg-gray-800/50 rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🎰</span> Blackjack Rules
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-bold text-purple-400 mb-3">Card Values</h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex justify-between">
                      <span>2-10</span>
                      <span className="text-gray-400">Face value</span>
                    </li>
                    <li className="flex justify-between">
                      <span>J, Q, K</span>
                      <span className="text-gray-400">10 points</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Ace</span>
                      <span className="text-gray-400">1 or 11 points</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold text-purple-400 mb-3">Winning Conditions</h3>
                  <ul className="space-y-2 text-gray-300">
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>Get closer to 21 than dealer</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>Dealer busts (over 21)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>Blackjack (A + 10-value card)</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🔄</span> Game States
              </h2>
              <div className="space-y-3">
                {[
                  { state: 'Inactive', desc: 'No active game', color: 'gray' },
                  { state: 'Pending Initial Deal', desc: 'Waiting for VRF to deal cards', color: 'yellow' },
                  { state: 'Active', desc: 'Your turn - Hit or Stand', color: 'green' },
                  { state: 'Pending Hit', desc: 'Waiting for VRF to deal hit card', color: 'yellow' },
                  { state: 'Pending Stand', desc: 'Waiting for dealer to play', color: 'yellow' },
                  { state: 'Busted', desc: 'Player went over 21', color: 'red' },
                  { state: 'Finished', desc: 'Game complete - claim winnings', color: 'purple' },
                ].map((item) => (
                  <div key={item.state} className="flex items-center gap-4 bg-gray-900/50 rounded-lg p-3">
                    <div className={`w-3 h-3 rounded-full bg-${item.color}-500`}></div>
                    <div>
                      <span className="font-semibold text-white">{item.state}</span>
                      <span className="text-gray-400 ml-2">— {item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>📋</span> Market Outcomes
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-green-900/30 rounded-xl p-4 border border-green-500/20 text-center">
                  <div className="text-3xl mb-2">🏆</div>
                  <h3 className="font-bold text-green-400">WIN</h3>
                  <p className="text-sm text-gray-400 mt-1">YES shares pay 1 token each</p>
                </div>
                <div className="bg-red-900/30 rounded-xl p-4 border border-red-500/20 text-center">
                  <div className="text-3xl mb-2">💀</div>
                  <h3 className="font-bold text-red-400">LOSE</h3>
                  <p className="text-sm text-gray-400 mt-1">NO shares pay 1 token each</p>
                </div>
                <div className="bg-yellow-900/30 rounded-xl p-4 border border-yellow-500/20 text-center">
                  <div className="text-3xl mb-2">🤝</div>
                  <h3 className="font-bold text-yellow-400">PUSH</h3>
                  <p className="text-sm text-gray-400 mt-1">All deposits refunded</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-orange-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span>⏰</span> Timeouts & Recovery
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-orange-600/30 rounded-lg flex items-center justify-center">
                    <span className="text-xl">⏱️</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">VRF Timeout: {FEES.VRF_TIMEOUT / 60} minutes</h3>
                    <p className="text-gray-400">If Chainlink VRF doesn&apos;t respond within {FEES.VRF_TIMEOUT / 60} minutes, the game can be cancelled and refunded.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-orange-600/30 rounded-lg flex items-center justify-center">
                    <span className="text-xl">🔄</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Stuck Game Recovery</h3>
                    <p className="text-gray-400">If a game gets stuck, the &quot;Cancel Stuck Game&quot; option becomes available after the timeout period.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FAQ Section */}
        {activeSection === 'faq' && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <span>❓</span> Frequently Asked Questions
            </h2>

            {[
              {
                q: 'What happens if I get Blackjack?',
                a: 'If you get a natural Blackjack (Ace + 10-value card on the first two cards), you win immediately! No market is created since the outcome is guaranteed.',
              },
              {
                q: 'Can I trade on my own game?',
                a: 'Yes! You can trade on your own game just like any other player. Many creators buy YES shares on their own games to increase their potential winnings.',
              },
              {
                q: 'What happens in a Push (tie)?',
                a: 'If both you and the dealer have the same total, it\'s a Push. All trading deposits are refunded to their original owners.',
              },
              {
                q: 'How are card draws verified?',
                a: 'All cards are drawn using Chainlink VRF (Verifiable Random Function), providing cryptographically proven randomness that cannot be manipulated.',
              },
              {
                q: 'Why can\'t I act on my game immediately?',
                a: `After each action, there's a ${FEES.TRADING_DELAY}-second trading window. This gives traders time to react to the new game state before you can Hit or Stand again.`,
              },
              {
                q: 'What is the minimum trade amount?',
                a: 'There\'s no minimum, but very small trades may not be economical due to gas fees. Consider trading larger amounts for better efficiency.',
              },
              {
                q: 'How do I claim my winnings?',
                a: 'After a game resolves, go to the "Closed" tab to see your claimable rewards. Click "Claim" to receive your tokens.',
              },
              {
                q: 'What if Chainlink VRF is slow?',
                a: `If VRF doesn't respond within ${FEES.VRF_TIMEOUT / 60} minutes, you can cancel the stuck game and get a refund.`,
              },
              {
                q: 'Can I see other players\' games?',
                a: 'Yes! The "Live" tab shows all active games. You can watch any game and trade on outcomes you have opinions about.',
              },
              {
                q: 'How do staking rewards work?',
                a: `Stakers receive ${FEES.STAKING_FEE}% of all token trading fees, distributed proportionally based on stake amount.`,
              },
            ].map((faq, i) => (
              <details key={i} className="bg-gray-800/50 rounded-xl border border-gray-700/50 group">
                <summary className="p-4 cursor-pointer font-semibold text-white flex items-center justify-between hover:bg-gray-700/30 rounded-xl transition-colors">
                  <span>{faq.q}</span>
                  <span className="text-purple-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-4 text-gray-300">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-700/50 text-center">
          <p className="text-gray-500 text-sm mb-4">
            PredictionJack is a decentralized prediction market game built on Base.
          </p>
          <Link
            href="/?fastTravelPrediction=true"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors"
          >
            <span>🃏</span>
            <span>Start Playing</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
