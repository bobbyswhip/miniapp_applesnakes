'use client';

import { useAccount, useBalance, useDisconnect } from 'wagmi';
import { base } from 'wagmi/chains';

export function WalletDisplay() {
  const { address, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({
    address,
    chainId: chain?.id || base.id,
  });

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const copyToClipboard = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      alert('Address copied to clipboard!');
    }
  };

  return (
    <div className="space-y-4">
      {/* Wallet Address */}
      <div className="glass rounded-xl p-5 space-y-3">
        <p className="text-xs text-[#8a9090] uppercase tracking-wide font-medium">
          Wallet Address
        </p>
        <div className="flex items-center justify-between gap-3">
          <code className="text-lg font-mono text-[#ffd075]">
            {address ? formatAddress(address) : '0x...'}
          </code>
          <button
            onClick={copyToClipboard}
            className="p-2 hover:bg-[#1a2221] rounded-lg transition-colors"
            title="Copy address"
          >
            <svg
              className="w-5 h-5 text-[#8a9090] hover:text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[#6b7575] font-mono break-all">{address}</p>
      </div>

      {/* Balance */}
      {balance && (
        <div className="glass rounded-xl p-5 space-y-3">
          <p className="text-xs text-[#8a9090] uppercase tracking-wide font-medium">
            Balance
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">
              {parseFloat(balance.formatted).toFixed(4)}
            </span>
            <span className="text-lg text-[#8a9090] font-medium">{balance.symbol}</span>
          </div>
        </div>
      )}

      {/* Network Info */}
      <div className="glass rounded-xl p-5 space-y-3">
        <p className="text-xs text-[#8a9090] uppercase tracking-wide font-medium">
          Network
        </p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-pulse" />
          <span className="text-base font-medium text-white">{chain?.name || 'Base'}</span>
        </div>
      </div>

      {/* Disconnect Button */}
      <button
        onClick={() => disconnect()}
        className="w-full glass hover:border-[#FF3B5C]/50 hover:bg-[#FF3B5C]/10 text-white font-medium py-3 px-4 rounded-xl transition-all duration-200"
      >
        Disconnect Wallet
      </button>
    </div>
  );
}
