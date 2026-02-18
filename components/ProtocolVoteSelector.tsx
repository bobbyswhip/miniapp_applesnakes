// components/ProtocolVoteSelector.tsx
// Token Wars Vote Selector - 3-way DEX + 2-way Pair voting
'use client';

import type { DexVote, PairVote, VoteConsensus } from '@/types/token-wars';

// DEX options configuration
const DEX_OPTIONS: Array<{
  value: DexVote;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = [
  {
    value: 'v4',
    label: 'V4 Uniswap',
    color: 'text-[#c5a97b]',
    bgColor: 'bg-[#c5a97b]/10',
    borderColor: 'border-[#c5a97b]',
    description: 'Deploy on Uniswap V4',
  },
  {
    value: 'aerodrome',
    label: 'Aerodrome',
    color: 'text-[#c5a97b]',
    bgColor: 'bg-[#c5a97b]/10',
    borderColor: 'border-[#c5a97b]',
    description: 'Deploy on Aerodrome CL',
  },
  {
    value: 'hydrex',
    label: 'Hydrex',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500',
    description: 'Deploy on Hydrex DEX',
  },
];

// Pair options configuration
const PAIR_OPTIONS: Array<{
  value: PairVote;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  icon?: string;
}> = [
  {
    value: 'eth',
    label: 'ETH',
    color: 'text-[#ffd075]',
    bgColor: 'bg-[#c5a97b]/10',
    borderColor: 'border-[#c5a97b]',
    description: 'Pair with Ethereum',
    icon: '/Images/Ether.png',
  },
  {
    value: 'wass',
    label: 'wASS',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500',
    description: 'Pair with wASS token',
    icon: '/Images/Token.png',
  },
];

interface VoteSelectorProps {
  dexVote: DexVote;
  pairVote: PairVote;
  onDexChange: (vote: DexVote) => void;
  onPairChange: (vote: PairVote) => void;
  consensus?: VoteConsensus | null;
  disabled?: boolean;
  compact?: boolean;
}

export function VoteSelector({
  dexVote,
  pairVote,
  onDexChange,
  onPairChange,
  consensus,
  disabled = false,
  compact = false,
}: VoteSelectorProps) {
  return (
    <div className="space-y-4">
      {/* DEX Vote - 3-way selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[#cecece]">
          Vote for DEX
        </label>
        <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'} gap-2`}>
          {DEX_OPTIONS.map((option) => {
            const isSelected = dexVote === option.value;
            const currentVotes = consensus?.dex?.[option.value]?.votes ?? 0;
            const currentPercent = consensus?.dex?.[option.value]?.percent ?? 33;

            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => onDexChange(option.value)}
                className={`
                  relative p-3 rounded-lg border-2 transition-all text-left
                  ${isSelected
                    ? `${option.bgColor} ${option.borderColor}`
                    : 'border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.15)]'
                  }
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {/* Selection indicator */}
                <div className={`
                  absolute top-2 right-2 w-4 h-4 rounded-full border-2
                  ${isSelected
                    ? `${option.bgColor} ${option.borderColor} flex items-center justify-center`
                    : 'border-[rgba(255,255,255,0.15)]'
                  }
                `}>
                  {isSelected && (
                    <div className={`w-2 h-2 rounded-full ${option.color.replace('text-', 'bg-')}`} />
                  )}
                </div>

                {/* Content */}
                <div>
                  <h4 className={`font-bold text-sm ${isSelected ? option.color : 'text-white'}`}>
                    {option.label}
                  </h4>
                  {!compact && (
                    <p className="text-xs text-[#8a9090] mt-0.5">
                      {option.description}
                    </p>
                  )}

                  {/* Current votes */}
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-[#6b7575]">Votes:</span>
                    <span className={isSelected ? option.color : 'text-[#8a9090]'}>
                      ${currentVotes.toFixed(0)} ({currentPercent.toFixed(0)}%)
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pair Vote - 2-way selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[#cecece]">
          Vote for Pair
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PAIR_OPTIONS.map((option) => {
            const isSelected = pairVote === option.value;
            const currentVotes = consensus?.pair?.[option.value]?.votes ?? 0;
            const currentPercent = consensus?.pair?.[option.value]?.percent ?? 50;

            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => onPairChange(option.value)}
                className={`
                  relative p-3 rounded-lg border-2 transition-all text-left
                  ${isSelected
                    ? `${option.bgColor} ${option.borderColor}`
                    : 'border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.15)]'
                  }
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {/* Selection indicator */}
                <div className={`
                  absolute top-2 right-2 w-4 h-4 rounded-full border-2
                  ${isSelected
                    ? `${option.bgColor} ${option.borderColor} flex items-center justify-center`
                    : 'border-[rgba(255,255,255,0.15)]'
                  }
                `}>
                  {isSelected && (
                    <div className={`w-2 h-2 rounded-full ${option.color.replace('text-', 'bg-')}`} />
                  )}
                </div>

                {/* Content */}
                <div className="flex items-center gap-2">
                  {option.icon && (
                    <img src={option.icon} alt={option.label} className="w-6 h-6" />
                  )}
                  <div>
                    <h4 className={`font-bold ${isSelected ? option.color : 'text-white'}`}>
                      {option.label}
                    </h4>
                    {!compact && (
                      <p className="text-xs text-[#8a9090] mt-0.5">
                        {option.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Current votes */}
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-[#6b7575]">Votes:</span>
                  <span className={isSelected ? option.color : 'text-[#8a9090]'}>
                    ${currentVotes.toFixed(0)} ({currentPercent.toFixed(0)}%)
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-[#6b7575]">
        Every $1 = 1 vote for both DEX and pair. Whole dollars only.
      </p>
    </div>
  );
}

// Legacy support - ProtocolVoteSelector with 3-way DEX voting (V4, Aerodrome, Hydrex)
// Supports both old format (uniswap/aerodrome) and new format (VoteConsensus with dex/pair)
interface LegacyProtocolVoteSelectorProps {
  value: 'uniswap' | 'aerodrome' | 'hydrex';
  onChange: (vote: 'uniswap' | 'aerodrome' | 'hydrex') => void;
  consensus?: VoteConsensus | {
    leadingProtocol: 'uniswap' | 'aerodrome';
    uniswap: { votes: number; percent: number };
    aerodrome: { votes: number; percent: number };
    totalVotes: number;
    isTie: boolean;
  } | null;
  disabled?: boolean;
}

export function ProtocolVoteSelector({
  value,
  onChange,
  consensus,
  disabled = false,
}: LegacyProtocolVoteSelectorProps) {
  // Map legacy protocol votes to new DEX votes
  const dexVote: DexVote = value === 'uniswap' ? 'v4' : value;

  const handleDexChange = (vote: DexVote) => {
    // Map new DEX votes back to protocol votes (v4 -> uniswap)
    onChange(vote === 'v4' ? 'uniswap' : vote);
  };

  // Helper to get vote data - handles both old and new formats
  const getVoteData = (dexOption: DexVote) => {
    if (!consensus) return { votes: 0, percent: 33 };

    // Check for new VoteConsensus format (has 'dex' property)
    if ('dex' in consensus && consensus.dex) {
      return consensus.dex[dexOption] ?? { votes: 0, percent: 33 };
    }

    // Legacy format - map v4 to uniswap, hydrex defaults to 0
    if ('uniswap' in consensus) {
      if (dexOption === 'v4') return consensus.uniswap;
      if (dexOption === 'aerodrome') return consensus.aerodrome;
      return { votes: 0, percent: 0 }; // hydrex not in legacy format
    }

    return { votes: 0, percent: 33 };
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-[#cecece]">
        Vote for DEX
      </label>
      <div className="grid grid-cols-3 gap-2">
        {DEX_OPTIONS.map((option) => {
          // Map v4 to uniswap for legacy compatibility
          const legacyValue = option.value === 'v4' ? 'uniswap' : option.value;
          const isSelected = value === legacyValue;
          // Get votes from the appropriate consensus field (handles both formats)
          const consensusData = getVoteData(option.value);
          const currentVotes = consensusData?.votes ?? 0;
          const currentPercent = consensusData?.percent ?? 33;

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => handleDexChange(option.value)}
              className={`
                relative p-3 rounded-lg border-2 transition-all text-left
                ${isSelected
                  ? `${option.bgColor} ${option.borderColor}`
                  : 'border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.15)]'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <div className={`
                absolute top-2 right-2 w-4 h-4 rounded-full border-2
                ${isSelected
                  ? `${option.bgColor} ${option.borderColor} flex items-center justify-center`
                  : 'border-[rgba(255,255,255,0.15)]'
                }
              `}>
                {isSelected && (
                  <div className={`w-2 h-2 rounded-full ${option.color.replace('text-', 'bg-')}`} />
                )}
              </div>

              <div>
                <h4 className={`font-bold ${isSelected ? option.color : 'text-white'}`}>
                  {option.value === 'v4' ? 'Uniswap' : option.label}
                </h4>
                <p className="text-xs text-[#8a9090] mt-0.5">
                  {option.description}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-[#6b7575]">Votes:</span>
                  <span className={isSelected ? option.color : 'text-[#8a9090]'}>
                    ${typeof currentVotes === 'number' ? currentVotes.toFixed(0) : 0} ({typeof currentPercent === 'number' ? currentPercent.toFixed(1) : 50}%)
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[#6b7575]">
        Your USDC contribution = your vote weight for the liquidity protocol.
      </p>
    </div>
  );
}

export default ProtocolVoteSelector;
