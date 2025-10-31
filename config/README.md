# Contract Configuration

This directory contains contract addresses and ABI configurations for the Base Wallet app.

## Structure

```
config/
├── contracts.ts    # Main contract addresses and configuration
├── types.ts        # TypeScript types for contracts
└── README.md       # This file

abis/
├── erc20.ts       # Standard ERC20 token ABI
└── nft.ts         # Your custom NFT ABI (replace placeholder)
```

## Configured Contracts

### Base Mainnet (Chain ID: 8453)
- **NFT Contract**: `0x184239bd036e8a4bcada7bbeba60c82a80e0e845`
- **Token Contract**: `0xcc3440d13e1A7805e45b1Bde3376DA5d90d95d55`

### Base Sepolia Testnet (Chain ID: 84532)
- Update addresses in `contracts.ts` when you deploy to testnet

## How to Use

### 1. Update NFT ABI

Replace the placeholder in `abis/nft.ts` with your actual NFT contract ABI:

```typescript
// Get your ABI from:
// - Etherscan/Basescan: Search your contract address
// - Hardhat/Foundry: Build artifacts after compilation
// - Contract deployment files

export const NFT_ABI = [
  // Your actual ABI here
] as const;
```

### 2. Import and Use Contracts

```typescript
import { getContracts, NFT_ADDRESS, TOKEN_ADDRESS } from '@/config/contracts';
import { useAccount, useReadContract } from 'wagmi';

function MyComponent() {
  const { chain } = useAccount();
  const contracts = getContracts(chain?.id || 8453);

  // Read from NFT contract
  const { data } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'balanceOf',
    args: [userAddress],
  });
}
```

### 3. Use Custom Hooks

Two example hooks are provided:

**useNFTBalance**
```typescript
import { useNFTBalance } from '@/hooks/useNFTBalance';

function MyComponent() {
  const { balance, isLoading } = useNFTBalance();
  return <div>NFT Balance: {balance?.toString()}</div>;
}
```

**useTokenBalance**
```typescript
import { useTokenBalance } from '@/hooks/useTokenBalance';

function MyComponent() {
  const { formattedBalance, symbol, isLoading } = useTokenBalance();
  return <div>Token Balance: {formattedBalance} {symbol}</div>;
}
```

### 4. Write Contract Functions

```typescript
import { useWriteContract } from 'wagmi';
import { getContracts } from '@/config/contracts';

function TransferButton() {
  const { chain } = useAccount();
  const { writeContract } = useWriteContract();
  const contracts = getContracts(chain?.id || 8453);

  const handleTransfer = async () => {
    writeContract({
      address: contracts.token.address,
      abi: contracts.token.abi,
      functionName: 'transfer',
      args: [recipientAddress, amount],
    });
  };

  return <button onClick={handleTransfer}>Transfer</button>;
}
```

## Adding New Contracts

To add more contracts:

1. **Add ABI** in `abis/` folder:
```typescript
// abis/myContract.ts
export const MY_CONTRACT_ABI = [...] as const;
```

2. **Update types** in `config/types.ts`:
```typescript
export interface ChainContracts {
  nft: ContractConfig;
  token: ContractConfig;
  myContract: ContractConfig; // Add new contract
}
```

3. **Add addresses** in `config/contracts.ts`:
```typescript
export const BASE_MAINNET_CONTRACTS = {
  nft: { ... },
  token: { ... },
  myContract: {
    address: '0x...',
    abi: MY_CONTRACT_ABI,
    name: 'My Contract',
  },
};
```

## Network Configuration

The app supports multiple networks:

- **Base Mainnet** (8453)
- **Base Sepolia** (84532)

The `getContracts(chainId)` helper automatically returns the correct contracts based on the connected network.

## Best Practices

1. **Never commit private keys** - Use environment variables for sensitive data
2. **Test on testnet first** - Always deploy and test on Base Sepolia before mainnet
3. **Verify contracts** - Verify your contracts on Basescan for transparency
4. **Update ABIs** - Keep ABIs in sync with deployed contract versions
5. **Type safety** - Use TypeScript types for all contract interactions

## Resources

- [Wagmi Documentation](https://wagmi.sh)
- [Viem Documentation](https://viem.sh)
- [Base Documentation](https://docs.base.org)
- [Basescan](https://basescan.org) - View contracts and transactions
