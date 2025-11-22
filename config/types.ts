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
  prediction: ContractConfig;
}

export interface AppContracts {
  base: ChainContracts;
  baseSepolia: ChainContracts;
}
