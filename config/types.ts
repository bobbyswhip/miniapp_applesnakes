/**
 * Contract Configuration Types
 */

export interface ContractConfig {
  address: `0x${string}`;
  abi: readonly any[];
  name: string;
}

export interface ChainContracts {
  nft: ContractConfig;
  token: ContractConfig;
  wrapper: ContractConfig;
  staking: ContractConfig;
  prediction: ContractConfig; // Legacy combined contract
  blackjack: ContractConfig; // New game-only contract
  predictionHub: ContractConfig; // New market hub contract
  otc: ContractConfig; // wASS OTC hybrid swap contract
}

export interface AppContracts {
  base: ChainContracts;
  baseSepolia: ChainContracts;
}
