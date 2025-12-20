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
  predictionMarketV2: ContractConfig; // Token Wars Prediction Market V2 (on-chain)
  otc: ContractConfig; // wASS OTC hybrid swap contract
  marketplace: ContractConfig; // NFT marketplace for wASS trading
  bondedItems: ContractConfig; // V7: ERC1155 Items with CPMM + Dynamic Fees
  itemBridge: ContractConfig; // V7: Item Bridge for trait editor
}

export interface AppContracts {
  base: ChainContracts;
  baseSepolia: ChainContracts;
}
