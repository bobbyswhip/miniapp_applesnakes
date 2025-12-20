// components/ConsensusBar.tsx
'use client';

import type { VoteConsensus, DexConsensus, PairConsensus } from '@/types/token-wars';

// DEX colors
const DEX_COLORS = {
  v4: { bg: 'bg-purple-500', gradient: 'from-purple-600 to-purple-500', text: 'text-purple-400' },
  aerodrome: { bg: 'bg-blue-500', gradient: 'from-blue-600 to-blue-500', text: 'text-blue-400' },
  hydrex: { bg: 'bg-orange-500', gradient: 'from-orange-600 to-orange-500', text: 'text-orange-400' },
};

// Pair colors
const PAIR_COLORS = {
  eth: { bg: 'bg-indigo-500', gradient: 'from-indigo-600 to-indigo-500', text: 'text-indigo-400' },
  wass: { bg: 'bg-green-500', gradient: 'from-green-600 to-green-500', text: 'text-green-400' },
};

interface ConsensusBarProps {
  consensus: VoteConsensus | null;
  showLabels?: boolean;
  height?: number;
  showDex?: boolean;
  showPair?: boolean;
}

export function ConsensusBar({
  consensus,
  showLabels = true,
  height = 24,
  showDex = true,
  showPair = true,
}: ConsensusBarProps) {
  return (
    <div className="w-full space-y-2 sm:space-y-4">
      {/* DEX Vote Bar - 3-way */}
      {showDex && (
        <DexBar
          dex={consensus?.dex ?? null}
          showLabels={showLabels}
          height={height}
        />
      )}

      {/* Pair Vote Bar - 2-way */}
      {showPair && (
        <PairBar
          pair={consensus?.pair ?? null}
          showLabels={showLabels}
          height={height}
        />
      )}
    </div>
  );
}

// 3-way DEX consensus bar
function DexBar({
  dex,
  showLabels,
  height,
}: {
  dex: DexConsensus | null;
  showLabels: boolean;
  height: number;
}) {
  const v4Percent = dex?.v4.percent ?? 33.33;
  const aerodromePercent = dex?.aerodrome.percent ?? 33.33;
  const hydrexPercent = dex?.hydrex.percent ?? 33.33;
  const leading = dex?.leading ?? 'aerodrome';

  return (
    <div>
      {showLabels && (
        <div className="flex justify-between text-[9px] sm:text-xs mb-1 sm:mb-1.5">
          <div className="flex items-center gap-0.5 sm:gap-1">
            <span className={`font-semibold ${DEX_COLORS.v4.text}`}>Uniswap</span>
            <span className="text-gray-500 hidden xs:inline">${dex?.v4.votes ?? 0}</span>
            <span className={`font-bold ${leading === 'v4' ? DEX_COLORS.v4.text : 'text-gray-500'}`}>
              {v4Percent.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <span className={`font-semibold ${DEX_COLORS.aerodrome.text}`}>Aerodrome</span>
            <span className="text-gray-500 hidden xs:inline">${dex?.aerodrome.votes ?? 0}</span>
            <span className={`font-bold ${leading === 'aerodrome' ? DEX_COLORS.aerodrome.text : 'text-gray-500'}`}>
              {aerodromePercent.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <span className={`font-semibold ${DEX_COLORS.hydrex.text}`}>Hydrex</span>
            <span className="text-gray-500 hidden xs:inline">${dex?.hydrex.votes ?? 0}</span>
            <span className={`font-bold ${leading === 'hydrex' ? DEX_COLORS.hydrex.text : 'text-gray-500'}`}>
              {hydrexPercent.toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      <div className="text-[9px] sm:text-xs text-gray-500 mb-0.5 sm:mb-1">DEX Vote</div>

      <div
        className="relative w-full rounded-full overflow-hidden bg-gray-700 flex"
        style={{ height: Math.max(16, height - 4) }}
      >
        {/* V4 Uniswap segment (purple) */}
        <div
          className={`h-full bg-gradient-to-r ${DEX_COLORS.v4.gradient} transition-all duration-500 flex items-center justify-center`}
          style={{ width: `${v4Percent}%` }}
        >
          {v4Percent > 20 && (
            <span className="text-white text-[8px] sm:text-xs font-bold">{v4Percent.toFixed(0)}%</span>
          )}
        </div>

        {/* Aerodrome segment (blue) */}
        <div
          className={`h-full bg-gradient-to-r ${DEX_COLORS.aerodrome.gradient} transition-all duration-500 flex items-center justify-center`}
          style={{ width: `${aerodromePercent}%` }}
        >
          {aerodromePercent > 20 && (
            <span className="text-white text-[8px] sm:text-xs font-bold">{aerodromePercent.toFixed(0)}%</span>
          )}
        </div>

        {/* Hydrex segment (orange) */}
        <div
          className={`h-full bg-gradient-to-r ${DEX_COLORS.hydrex.gradient} transition-all duration-500 flex items-center justify-center`}
          style={{ width: `${hydrexPercent}%` }}
        >
          {hydrexPercent > 20 && (
            <span className="text-white text-[8px] sm:text-xs font-bold">{hydrexPercent.toFixed(0)}%</span>
          )}
        </div>
      </div>

      {dex?.isTie && (
        <p className="text-center text-[9px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">
          Tie! Aerodrome wins as tiebreaker
        </p>
      )}
    </div>
  );
}

// 2-way Pair consensus bar
function PairBar({
  pair,
  showLabels,
  height,
}: {
  pair: PairConsensus | null;
  showLabels: boolean;
  height: number;
}) {
  const ethPercent = pair?.eth.percent ?? 50;
  const wassPercent = pair?.wass.percent ?? 50;
  const leading = pair?.leading ?? 'eth';

  return (
    <div>
      {showLabels && (
        <div className="flex justify-between text-[9px] sm:text-xs mb-1 sm:mb-1.5">
          <div className="flex items-center gap-0.5 sm:gap-1">
            <img src="/Images/Ether.png" alt="ETH" className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className={`font-semibold ${PAIR_COLORS.eth.text}`}>ETH</span>
            <span className="text-gray-500 hidden xs:inline">${pair?.eth.votes ?? 0}</span>
            <span className={`font-bold ${leading === 'eth' ? PAIR_COLORS.eth.text : 'text-gray-500'}`}>
              {ethPercent.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <span className={`font-bold ${leading === 'wass' ? PAIR_COLORS.wass.text : 'text-gray-500'}`}>
              {wassPercent.toFixed(0)}%
            </span>
            <span className="text-gray-500 hidden xs:inline">${pair?.wass.votes ?? 0}</span>
            <span className={`font-semibold ${PAIR_COLORS.wass.text}`}>wASS</span>
            <img src="/Images/Token.png" alt="wASS" className="w-3 h-3 sm:w-4 sm:h-4" />
          </div>
        </div>
      )}

      <div className="text-[9px] sm:text-xs text-gray-500 mb-0.5 sm:mb-1">Pair Vote</div>

      <div
        className="relative w-full rounded-full overflow-hidden bg-gray-700"
        style={{ height: Math.max(16, height - 4) }}
      >
        {/* ETH side (indigo/purple) */}
        <div
          className={`absolute left-0 top-0 h-full bg-gradient-to-r ${PAIR_COLORS.eth.gradient} transition-all duration-500`}
          style={{ width: `${ethPercent}%` }}
        />

        {/* wASS side (green) */}
        <div
          className={`absolute right-0 top-0 h-full bg-gradient-to-l ${PAIR_COLORS.wass.gradient} transition-all duration-500`}
          style={{ width: `${wassPercent}%` }}
        />

        {/* Center line for tie */}
        {pair?.isTie && (
          <div className="absolute left-1/2 top-0 w-0.5 h-full bg-white/50 transform -translate-x-1/2" />
        )}

        {/* Leading indicator */}
        {!pair?.isTie && (
          <div
            className={`absolute top-1/2 transform -translate-y-1/2 text-white text-[8px] sm:text-xs font-bold px-1 sm:px-2 ${
              leading === 'eth' ? 'left-1 sm:left-2' : 'right-1 sm:right-2'
            }`}
          >
            <span className="hidden xs:inline">LEADING</span>
            <span className="xs:hidden">▶</span>
          </div>
        )}
      </div>

      {pair?.isTie && (
        <p className="text-center text-[9px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">
          Tie! ETH wins as tiebreaker
        </p>
      )}
    </div>
  );
}

// Legacy support - old ProtocolConsensus format (2-way only)
interface LegacyConsensusBarProps {
  consensus: {
    leadingProtocol: 'uniswap' | 'aerodrome';
    uniswap: { votes: number; percent: number };
    aerodrome: { votes: number; percent: number };
    totalVotes: number;
    isTie: boolean;
  } | null;
  showLabels?: boolean;
  height?: number;
}

export function LegacyConsensusBar({
  consensus,
  showLabels = true,
  height = 24
}: LegacyConsensusBarProps) {
  // Convert legacy format to new format for display
  const converted: VoteConsensus | null = consensus ? {
    dex: {
      leading: consensus.leadingProtocol === 'uniswap' ? 'v4' : 'aerodrome',
      v4: { votes: consensus.uniswap.votes, percent: consensus.uniswap.percent },
      aerodrome: consensus.aerodrome,
      hydrex: { votes: 0, percent: 0 },
      isTie: consensus.isTie,
    },
    pair: {
      leading: 'eth',
      eth: { votes: 0, percent: 50 },
      wass: { votes: 0, percent: 50 },
      isTie: true,
    },
    totalVotes: consensus.totalVotes,
  } : null;

  return <ConsensusBar consensus={converted} showLabels={showLabels} height={height} showPair={false} />;
}

export default ConsensusBar;
