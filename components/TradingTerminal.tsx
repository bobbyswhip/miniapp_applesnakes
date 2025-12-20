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
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
        <p className="text-gray-400 text-sm">Loading tokens...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-400 text-sm mb-2">{error}</p>
        <button onClick={refresh} className="text-xs text-blue-400 hover:text-blue-300">Retry</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats Header - Compact */}
      {stats && (
        <div className="flex-shrink-0 flex items-center gap-1 text-xs mb-2 overflow-x-auto pb-1">
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
            <span className="text-gray-400">Launched:</span>
            <span className="font-bold text-white">{stats.totalLaunched}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
            <span className="text-gray-400">Raised:</span>
            <span className="font-bold text-green-400">${stats.totalRaisedUsdc.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
            <span className="text-gray-400">V4:</span>
            <span className="font-bold text-purple-400">{stats.byDex.v4}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
            <span className="text-gray-400">Aero:</span>
            <span className="font-bold text-blue-400">{stats.byDex.aerodrome}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg whitespace-nowrap">
            <span className="text-gray-400">Hydrex:</span>
            <span className="font-bold text-orange-400">{stats.byDex.hydrex}</span>
          </div>
        </div>
      )}

      {/* Filters - Compact */}
      <div className="flex-shrink-0 flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">DEX:</span>
          <select
            value={dexFilter || ''}
            onChange={(e) => setDexFilter(e.target.value as DexType || undefined)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="">All</option>
            <option value="v4">V4 Uniswap</option>
            <option value="aerodrome">Aerodrome</option>
            <option value="hydrex">Hydrex</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">Pair:</span>
          <select
            value={pairFilter || ''}
            onChange={(e) => setPairFilter(e.target.value as PairType || undefined)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500"
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
          <div className="text-center py-8 text-gray-400 text-sm">
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
            className="w-full py-2 mt-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
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
    v4: 'text-purple-400 bg-purple-500/10',
    aerodrome: 'text-blue-400 bg-blue-500/10',
    hydrex: 'text-orange-400 bg-orange-500/10',
  };

  const timeSinceLaunch = Date.now() - token.launchedAt;
  const days = Math.floor(timeSinceLaunch / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeSinceLaunch % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const timeAgo = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : 'Just now';

  // Show Trade button for ALL tokens - opens swap view with chart
  // V4 tokens have in-app swaps, Aerodrome/Hydrex show external DEX link
  const canTrade = !!onTrade;

  return (
    <div className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors">
      {/* Token Info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {token.imageUrl ? (
          <img
            src={getImageUrl(token.imageUrl)}
            alt={token.symbol}
            className="w-8 h-8 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {token.symbol.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-white truncate">{token.symbol}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${dexColors[token.dex]}`}>
              {token.dex === 'v4' ? 'V4' : token.dex === 'aerodrome' ? 'AERO' : 'HYDR'}
            </span>
          </div>
          <div className="text-[10px] text-gray-400 truncate">{token.name}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-xs text-gray-400">Raised</div>
          <div className="text-xs font-medium text-green-400">${token.totalRaisedUsdc}</div>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-[10px] text-gray-400">{timeAgo}</div>
          <div className="text-[10px] text-gray-500">{token.participantCount} users</div>
        </div>

        {/* Trade Button - opens swap view with chart for all tokens */}
        {canTrade && (
          <button
            onClick={() => onTrade(token)}
            className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-white text-[11px] font-bold rounded-lg transition-all shadow-lg shadow-emerald-500/20"
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
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-[10px] font-medium rounded transition-colors"
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
