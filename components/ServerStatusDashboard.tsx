'use client';

import { useServerStatus, tickToMarketCap, calcHeapPercent } from '@/hooks/useServerStatus';

interface StatusIndicatorProps {
  status: 'online' | 'degraded' | 'offline';
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  const colors = {
    online: 'bg-green-500',
    degraded: 'bg-yellow-500',
    offline: 'bg-red-500',
  };

  const labels = {
    online: 'Online',
    degraded: 'Degraded',
    offline: 'Offline',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className={`w-3 h-3 rounded-full ${colors[status]}`} />
        {status === 'online' && (
          <div className={`absolute inset-0 w-3 h-3 rounded-full ${colors[status]} animate-ping opacity-75`} />
        )}
      </div>
      <span className={`text-sm font-medium ${
        status === 'online' ? 'text-green-400' :
        status === 'degraded' ? 'text-yellow-400' : 'text-red-400'
      }`}>
        {labels[status]}
      </span>
    </div>
  );
}

interface ProgressBarProps {
  percent: number;
  colorClass?: string;
}

function ProgressBar({ percent, colorClass = 'from-green-500 to-yellow-500' }: ProgressBarProps) {
  return (
    <div className="w-full bg-[#1f2827]/50 rounded-full h-2 overflow-hidden">
      <div
        className={`h-full bg-gradient-to-r ${colorClass} transition-all duration-300`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

interface ServiceBadgeProps {
  name: string;
  configured: boolean;
}

function ServiceBadge({ name, configured }: ServiceBadgeProps) {
  return (
    <div className="flex items-center justify-between bg-[#171e1d]/50 rounded-lg px-3 py-2">
      <span className="text-sm text-[#cecece]">{name}</span>
      <span className={`text-sm font-medium ${configured ? 'text-green-400' : 'text-[#6b7575]'}`}>
        {configured ? '✓' : '✗'}
      </span>
    </div>
  );
}

interface FeatureBadgeProps {
  name: string;
  enabled: boolean;
}

function FeatureBadge({ name, enabled }: FeatureBadgeProps) {
  const displayName = name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
      enabled
        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
        : 'bg-[#1f2827]/50 text-[#6b7575] border border-[rgba(255,255,255,0.04)]'
    }`}>
      {enabled ? '✓' : '✗'} {displayName}
    </span>
  );
}

export function ServerStatusDashboard() {
  const { data, error, loading, rateLimited, lastUpdated, refetch } = useServerStatus({
    pollInterval: 10000,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-[rgba(255,208,117,0.4)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[#8a9090]">Loading server status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">⚠️</span>
          <h3 className="text-lg font-semibold text-red-400">Connection Error</h3>
        </div>
        <p className="text-[#8a9090] mb-4">{error}</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-red-600/50 hover:bg-red-600/70 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-[#6b7575]">
        No status data available
      </div>
    );
  }

  const { server, memory, wallet, tokenLauncher, services, features, rateLimiter } = data.status;
  const heapPercent = calcHeapPercent(memory.heapUsedBytes, memory.heapTotalBytes);

  return (
    <div className="space-y-6">
      {/* Rate Limited Warning */}
      {rateLimited && (
        <div className="bg-yellow-950/30 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
          <span className="text-xl">⏳</span>
          <div>
            <p className="text-yellow-400 font-medium">Rate Limited</p>
            <p className="text-sm text-[#8a9090]">Waiting to retry...</p>
          </div>
        </div>
      )}

      {/* Server Status Header */}
      <div className="bg-gradient-to-br from-[#171e1d]/80 to-[#1a2221]/80 border border-[rgba(255,255,255,0.06)] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <StatusIndicator status={server.status} />
            <span className="text-xs px-2 py-1 rounded bg-[#1a2221] text-[#8a9090] border border-[rgba(255,255,255,0.08)]">
              {server.environment}
            </span>
          </div>
          <div className="text-sm text-[#6b7575]">
            Uptime: <span className="text-white font-medium">{server.uptime.formatted}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-[#6b7575]">Node</span>
            <p className="text-white">{server.nodeVersion}</p>
          </div>
          <div>
            <span className="text-[#6b7575]">Platform</span>
            <p className="text-white">{server.platform}</p>
          </div>
          <div>
            <span className="text-[#6b7575]">Started</span>
            <p className="text-white">{new Date(server.startedAt).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-[#6b7575]">Active IPs</span>
            <p className="text-white">{rateLimiter.trackedIPs}</p>
          </div>
        </div>
      </div>

      {/* Memory & Wallet Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Memory Status */}
        <div className="bg-[#171e1d]/50 border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#8a9090] mb-4 flex items-center gap-2">
            <span>💾</span> Memory Usage
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[#8a9090]">Heap</span>
                <span className={`font-medium ${heapPercent > 80 ? 'text-yellow-400' : 'text-[#cecece]'}`}>
                  {heapPercent}%
                </span>
              </div>
              <ProgressBar
                percent={heapPercent}
                colorClass={heapPercent > 80 ? 'from-yellow-500 to-red-500' : 'from-[#22c55e] to-[#c5a97b]'}
              />
              <p className="text-xs text-[#6b7575] mt-1">
                {memory.heapUsed} / {memory.heapTotal}
              </p>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6b7575]">RSS (Total)</span>
              <span className="text-[#cecece]">{memory.rss}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6b7575]">External</span>
              <span className="text-[#cecece]">{memory.external}</span>
            </div>
          </div>
        </div>

        {/* Wallet Status */}
        <div className="bg-[#171e1d]/50 border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#8a9090] mb-4 flex items-center gap-2">
            <span>👛</span> Wallet
          </h3>
          {wallet.configured ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7575]">Address</span>
                <span className="text-white font-mono">{wallet.address}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7575]">Network</span>
                <span className={`font-medium ${
                  wallet.network.includes('mainnet') ? 'text-[#c5a97b]' : 'text-yellow-400'
                }`}>
                  {wallet.network}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-yellow-400">
              <span>⚠️</span>
              <span className="text-sm">Wallet not configured</span>
            </div>
          )}
        </div>
      </div>

      {/* Token Launcher */}
      <div className="bg-[#171e1d]/50 border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#8a9090] mb-4 flex items-center gap-2">
          <span>🚀</span> Token Launcher
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-[#6b7575] uppercase tracking-wide">Status</span>
            <p className={`font-medium ${tokenLauncher.enabled ? 'text-green-400' : 'text-red-400'}`}>
              {tokenLauncher.enabled ? '✓ Enabled' : '✗ Disabled'}
            </p>
          </div>
          <div>
            <span className="text-xs text-[#6b7575] uppercase tracking-wide">Starting MCap</span>
            <p className="text-white font-medium">{tickToMarketCap(tokenLauncher.currentTick)}</p>
            <span className="text-xs text-[#6b7575]">tick: {tokenLauncher.currentTick}</span>
          </div>
          <div className="md:col-span-2">
            <span className="text-xs text-[#6b7575] uppercase tracking-wide">WASS Address</span>
            <p className="text-white font-mono text-sm truncate">{tokenLauncher.wassAddress}</p>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      <div className="bg-[#171e1d]/50 border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#8a9090] mb-4 flex items-center gap-2">
          <span>🔌</span> External Services
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ServiceBadge name="OpenAI" configured={services.openai.configured} />
          <ServiceBadge name="CDP" configured={services.cdp.configured} />
          <ServiceBadge name="Filebase" configured={services.filebase.configured} />
          <ServiceBadge name="Twilio" configured={services.twilio.configured} />
        </div>
      </div>

      {/* Features */}
      <div className="bg-[#171e1d]/50 border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#8a9090] mb-4 flex items-center gap-2">
          <span>✨</span> Features
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(features).map(([key, enabled]) => (
            <FeatureBadge key={key} name={key} enabled={enabled as boolean} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-[#6b7575] pt-2">
        <span>
          Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Never'}
        </span>
        <button
          onClick={() => refetch()}
          className="text-[#c5a97b] hover:text-[#ffd075] transition-colors"
          disabled={rateLimited}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
