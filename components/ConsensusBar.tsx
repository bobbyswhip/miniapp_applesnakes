// components/ConsensusBar.tsx
'use client';

import type { ProtocolConsensus } from '@/types/clankerdome';

interface ConsensusBarProps {
  consensus: ProtocolConsensus | null;
  showLabels?: boolean;
  height?: number;
}

export function ConsensusBar({
  consensus,
  showLabels = true,
  height = 24
}: ConsensusBarProps) {
  const uniswapPercent = consensus?.uniswap.percent ?? 50;
  const aerodromePercent = consensus?.aerodrome.percent ?? 50;
  const isTie = consensus?.isTie ?? true;
  const leadingProtocol = consensus?.leadingProtocol ?? 'aerodrome';

  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex justify-between text-sm mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-pink-500">Uniswap</span>
            <span className="text-gray-400">${consensus?.uniswap.votes ?? 0}</span>
            <span className={`font-bold ${leadingProtocol === 'uniswap' ? 'text-pink-500' : 'text-gray-500'}`}>
              {uniswapPercent.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`font-bold ${leadingProtocol === 'aerodrome' ? 'text-blue-500' : 'text-gray-500'}`}>
              {aerodromePercent.toFixed(1)}%
            </span>
            <span className="text-gray-400">${consensus?.aerodrome.votes ?? 0}</span>
            <span className="font-semibold text-blue-500">Aerodrome</span>
          </div>
        </div>
      )}

      <div
        className="relative w-full rounded-full overflow-hidden bg-gray-700"
        style={{ height }}
      >
        {/* Uniswap side (pink) */}
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-pink-600 to-pink-500 transition-all duration-500"
          style={{ width: `${uniswapPercent}%` }}
        />

        {/* Aerodrome side (blue) */}
        <div
          className="absolute right-0 top-0 h-full bg-gradient-to-l from-blue-600 to-blue-500 transition-all duration-500"
          style={{ width: `${aerodromePercent}%` }}
        />

        {/* Center line for tie */}
        {isTie && (
          <div className="absolute left-1/2 top-0 w-0.5 h-full bg-white/50 transform -translate-x-1/2" />
        )}

        {/* Leading indicator */}
        {!isTie && (
          <div
            className={`absolute top-1/2 transform -translate-y-1/2 text-white text-xs font-bold px-2 ${
              leadingProtocol === 'uniswap' ? 'left-2' : 'right-2'
            }`}
          >
            LEADING
          </div>
        )}
      </div>

      {isTie && (
        <p className="text-center text-xs text-gray-400 mt-1">
          Tie! Aerodrome will be used as tiebreaker
        </p>
      )}
    </div>
  );
}

export default ConsensusBar;
