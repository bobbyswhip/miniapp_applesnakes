// components/ProtocolVoteSelector.tsx
'use client';

import type { ProtocolVote, ProtocolConsensus } from '@/types/clankerdome';

interface ProtocolVoteSelectorProps {
  value: ProtocolVote;
  onChange: (vote: ProtocolVote) => void;
  consensus?: ProtocolConsensus | null;
  disabled?: boolean;
}

export function ProtocolVoteSelector({
  value,
  onChange,
  consensus,
  disabled = false,
}: ProtocolVoteSelectorProps) {
  const options: Array<{
    value: ProtocolVote;
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    description: string;
  }> = [
    {
      value: 'uniswap',
      label: 'Uniswap',
      color: 'text-pink-500',
      bgColor: 'bg-pink-500/10',
      borderColor: 'border-pink-500',
      description: 'Deploy on Uniswap V3',
    },
    {
      value: 'aerodrome',
      label: 'Aerodrome',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500',
      description: 'Deploy on Aerodrome CL',
    },
  ];

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">
        Vote for Liquidity Protocol
      </label>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = value === option.value;
          const currentVotes = consensus?.[option.value]?.votes ?? 0;
          const currentPercent = consensus?.[option.value]?.percent ?? 50;

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`
                relative p-3 rounded-lg border-2 transition-all text-left
                ${isSelected
                  ? `${option.bgColor} ${option.borderColor}`
                  : 'border-gray-600 hover:border-gray-500'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {/* Selection indicator */}
              <div className={`
                absolute top-2 right-2 w-4 h-4 rounded-full border-2
                ${isSelected
                  ? `${option.bgColor} ${option.borderColor} flex items-center justify-center`
                  : 'border-gray-500'
                }
              `}>
                {isSelected && (
                  <div className={`w-2 h-2 rounded-full ${option.color.replace('text-', 'bg-')}`} />
                )}
              </div>

              {/* Content */}
              <div>
                <h4 className={`font-bold ${isSelected ? option.color : 'text-white'}`}>
                  {option.label}
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  {option.description}
                </p>

                {/* Current votes */}
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-500">Votes:</span>
                  <span className={isSelected ? option.color : 'text-gray-400'}>
                    ${currentVotes.toFixed(0)} ({currentPercent.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        Your USDC contribution = your vote weight for the liquidity protocol.
      </p>
    </div>
  );
}

export default ProtocolVoteSelector;
