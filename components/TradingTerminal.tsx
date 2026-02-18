// components/TradingTerminal.tsx
// Trading terminal showing all launched tokens
'use client';

import { useState } from 'react';
import { useLaunchedTokens, type LaunchedToken, type DexType, type PairType } from '@/hooks/useLaunchedTokens';

// Helper to convert IPFS URLs to HTTP gateway URLs
function getImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('ipfs://')) {
    const hash = url.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${hash}`;
  }
  return url;
}

interface TradingTerminalProps {
  onTradeToken?: (token: LaunchedToken) => void;
}

export function TradingTerminal({ onTradeToken }: TradingTerminalProps) {
  const [dexFilter, setDexFilter] = useState<DexType | undefined>(undefined);
  const [pairFilter, setPairFilter] = useState<PairType | undefined>(undefined);

  const { tokens, stats, loading, error, hasMore, loadMore, refresh } = useLaunchedTokens({
    limit: 20,
    dex: dexFilter,
    pair: pairFilter,
    refreshInterval: 30000,
  });

  if (loading && tokens.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-[rgba(255,208,117,0.3)] border-t-[#ffd075] rounded-full animate-spin mb-3" />
        <p className="text-neon-white/70 text-sm">Loading tokens...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
        <div>
          <p className="text-custom-red text-sm mb-2">{error}</p>
          <button onClick={refresh} className="text-xs text-[#ffd075] hover:text-[#c5a97b]">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Stats Header - Compact */}
      {stats && (
        <div className="flex-shrink-0 flex items-center gap-1 text-xs mb-2 overflow-x-auto pb-1">
          <div className="flex items-center gap-1 px-2 py-1 glass-panel rounded-lg whitespace-nowrap">
            <span className="text-neon-white/70">Launched:</span>
            <span className="font-bold text-neon-white">{stats.totalLaunched}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 glass-panel rounded-lg whitespace-nowrap">
            <span className="text-neon-white/70">Raised:</span>
            <span className="font-bold text-neon-green">${stats.totalRaisedUsdc.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 glass-panel rounded-lg whitespace-nowrap">
            <span className="text-neon-white/70">V4:</span>
            <span className="font-bold text-[#ffd075]">{stats.byDex.v4}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 glass-panel rounded-lg whitespace-nowrap">
            <span className="text-neon-white/70">Aero:</span>
            <span className="font-bold text-[#c5a97b]">{stats.byDex.aerodrome}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 glass-panel rounded-lg whitespace-nowrap">
            <span className="text-neon-white/70">Hydrex:</span>
            <span className="font-bold text-custom-orange">{stats.byDex.hydrex}</span>
          </div>
        </div>
      )}

      {/* Filters - Compact */}
      <div className="flex-shrink-0 flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-neon-white/70">DEX:</span>
          <select
            value={dexFilter || ''}
            onChange={(e) => setDexFilter(e.target.value as DexType || undefined)}
            className="glass-input rounded px-2 py-1 text-xs text-neon-white focus:outline-none focus:border-[rgba(255,208,117,0.5)]"
          >
            <option value="">All</option>
            <option value="v4">V4 Uniswap</option>
            <option value="aerodrome">Aerodrome</option>
            <option value="hydrex">Hydrex</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-neon-white/70">Pair:</span>
          <select
            value={pairFilter || ''}
            onChange={(e) => setPairFilter(e.target.value as PairType || undefined)}
            className="glass-input rounded px-2 py-1 text-xs text-neon-white focus:outline-none focus:border-[rgba(255,208,117,0.5)]"
          >
            <option value="">All</option>
            <option value="eth">ETH</option>
            <option value="wass">wASS</option>
          </select>
        </div>
      </div>

      {/* Token List - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {tokens.length === 0 ? (
          <div className="text-center py-8 text-neon-white/70 text-sm">
            <p>No launched tokens yet</p>
          </div>
        ) : (
          tokens.map((token) => (
            <TokenRow key={token.tokenAddress} token={token} onTrade={onTradeToken} />
          ))
        )}

        {/* Load More */}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="w-full py-2 mt-2 glass-panel hover:bg-white/10 rounded-lg text-xs text-neon-white/70 transition-colors"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        )}
      </div>
    </div>
  );
}

interface TokenRowProps {
  token: LaunchedToken;
  onTrade?: (token: LaunchedToken) => void;
}

function TokenRow({ token, onTrade }: TokenRowProps) {
  const dexColors: Record<DexType, string> = {
    v4: 'text-[#ffd075] bg-[rgba(255,208,117,0.1)]',
    aerodrome: 'text-[#c5a97b] bg-[rgba(197,169,123,0.1)]',
    hydrex: 'text-custom-orange bg-custom-orange/10',
  };

  const timeSinceLaunch = Date.now() - token.launchedAt;
  const days = Math.floor(timeSinceLaunch / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeSinceLaunch % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const timeAgo = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : 'Just now';

  // Show Trade button for ALL tokens - opens swap view with chart
  // V4 tokens have in-app swaps, Aerodrome/Hydrex show external DEX link
  const canTrade = !!onTrade;

  return (
    <div className="flex items-center justify-between p-2 glass-panel rounded-lg hover:bg-white/10 transition-colors">
      {/* Token Info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {token.imageUrl ? (
          <img
            src={getImageUrl(token.imageUrl)}
            alt={token.symbol}
            className="w-8 h-8 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full glass-panel-neon border border-[rgba(255,208,117,0.3)] flex items-center justify-center text-xs font-bold text-neon-white flex-shrink-0">
            {token.symbol.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-neon-white truncate">{token.symbol}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${dexColors[token.dex] || dexColors.hydrex}`}>
              {token.dex === 'v4' ? 'V4' : token.dex === 'aerodrome' ? 'AERO' : token.dex === 'hydrex' ? 'HYDR' : String(token.dex || 'DEX').toUpperCase()}
            </span>
          </div>
          <div className="text-[10px] text-neon-white/50 truncate">{token.name}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-xs text-neon-white/70">Raised</div>
          <div className="text-xs font-medium text-neon-green">${token.totalRaisedUsdc}</div>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-[10px] text-neon-white/70">{timeAgo}</div>
          <div className="text-[10px] text-neon-white/50">{token.participantCount} users</div>
        </div>

        {/* Trade Button - opens swap view with chart for all tokens */}
        {canTrade && (
          <button
            onClick={() => onTrade(token)}
            className="px-3 py-1.5 glass-button-green text-neon-white text-[11px] font-bold rounded-lg transition-all"
          >
            {token.dex === 'v4' ? 'Trade' : 'Chart'}
          </button>
        )}

        {/* Basescan link always available */}
        {token.basescanUrl && (
          <a
            href={token.basescanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1 glass-panel hover:bg-white/10 text-neon-white text-[10px] font-medium rounded transition-colors"
          >
            Scan
          </a>
        )}
      </div>
    </div>
  );
}

export default TradingTerminal;

// Re-export LaunchedToken type for use in parent components
export type { LaunchedToken };
