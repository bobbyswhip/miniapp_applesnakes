# Contract Configuration Setup Guide

## 📁 Project Structure

Your contract configuration is now organized as follows:

```
miniapp/
├── abis/                          # Contract ABIs
│   ├── index.ts                   # Central export for all ABIs
│   ├── erc20.ts                   # ✅ Standard ERC20 ABI (ready to use)
│   └── nft.ts                     # ⚠️ PLACEHOLDER - Replace with your NFT ABI
│
├── config/                        # Contract addresses & configuration
│   ├── index.ts                   # Central export for config
│   ├── contracts.ts               # ✅ Contract addresses configured
│   ├── types.ts                   # TypeScript type definitions
│   └── README.md                  # Detailed documentation
│
└── hooks/                         # Example usage hooks
    ├── useNFTBalance.ts          # Example: Read NFT balance
    └── useTokenBalance.ts        # Example: Read token balance
```

## 🎯 Currently Configured

### Base Mainnet (Chain ID: 8453)

**NFT Contract:**
- Address: `0x184239bd036e8a4bcada7bbeba60c82a80e0e845`
- ABI: `NFT_ABI` from `abis/nft.ts`
- Status: ⚠️ **Placeholder ABI - Replace with actual**

**Token Contract:**
- Address: `0xcc3440d13e1A7805e45b1Bde3376DA5d90d95d55`
- ABI: `ERC20_ABI` from `abis/erc20.ts`
- Status: ✅ **Ready to use**

## 🚀 Quick Start

### Step 1: Add Your NFT ABI

1. Get your NFT contract ABI from:
   - **Basescan**: Visit https://basescan.org/address/0x184239bd036e8a4bcada7bbeba60c82a80e0e845
   - Click "Contract" tab → "Code" → Copy the ABI JSON
   - Or from your contract compilation artifacts

2. Replace the placeholder in `abis/nft.ts`:
```typescript
export const NFT_ABI = [
  // Paste your actual ABI here
  {
    inputs: [...],
    name: "yourFunction",
    outputs: [...],
    stateMutability: "view",
    type: "function"
  },
  // ... more functions
] as const;
```

### Step 2: Use in Your Components

**Import contracts:**
```typescript
import { getContracts, NFT_ADDRESS, TOKEN_ADDRESS } from '@/config';
```

**Use with wagmi hooks:**
```typescript
import { useAccount, useReadContract } from 'wagmi';
import { getContracts } from '@/config';

function MyComponent() {
  const { chain } = useAccount();
  const contracts = getContracts(chain?.id || 8453);

  // Read NFT balance
  const { data: nftBalance } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'balanceOf',
    args: [userAddress],
  });

  // Read token balance
  const { data: tokenBalance } = useReadContract({
    address: contracts.token.address,
    abi: contracts.token.abi,
    functionName: 'balanceOf',
    args: [userAddress],
  });

  return (
    <div>
      <p>NFTs: {nftBalance?.toString()}</p>
      <p>Tokens: {tokenBalance?.toString()}</p>
    </div>
  );
}
```

### Step 3: Use Pre-built Hooks

**NFT Balance:**
```typescript
import { useNFTBalance } from '@/hooks/useNFTBalance';

function NFTDisplay() {
  const { balance, isLoading } = useNFTBalance();

  if (isLoading) return <p>Loading...</p>;

  return <p>You own {balance?.toString()} NFTs</p>;
}
```

**Token Balance:**
```typescript
import { useTokenBalance } from '@/hooks/useTokenBalance';

function TokenDisplay() {
  const { formattedBalance, symbol, isLoading } = useTokenBalance();

  if (isLoading) return <p>Loading...</p>;

  return <p>Balance: {formattedBalance} {symbol}</p>;
}
```

## 📝 Common Use Cases

### Read NFT Data
```typescript
import { useReadContract } from 'wagmi';
import { getContracts } from '@/config';

function NFTCard({ tokenId }: { tokenId: bigint }) {
  const contracts = getContracts(8453); // Base mainnet

  const { data: owner } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  const { data: tokenURI } = useReadContract({
    address: contracts.nft.address,
    abi: contracts.nft.abi,
    functionName: 'tokenURI',
    args: [tokenId],
  });

  return (
    <div>
      <p>Owner: {owner}</p>
      <p>URI: {tokenURI}</p>
    </div>
  );
}
```

### Transfer Tokens
```typescript
import { useWriteContract } from 'wagmi';
import { getContracts } from '@/config';
import { parseUnits } from 'viem';

function TransferToken() {
  const contracts = getContracts(8453);
  const { writeContract, isPending } = useWriteContract();

  const handleTransfer = async (to: string, amount: string) => {
    writeContract({
      address: contracts.token.address,
      abi: contracts.token.abi,
      functionName: 'transfer',
      args: [to as `0x${string}`, parseUnits(amount, 18)],
    });
  };

  return (
    <button onClick={() => handleTransfer('0x...', '100')}>
      {isPending ? 'Transferring...' : 'Transfer Tokens'}
    </button>
  );
}
```

### Approve Token Spending
```typescript
import { useWriteContract } from 'wagmi';
import { getContracts } from '@/config';
import { parseUnits } from 'viem';

function ApproveToken() {
  const contracts = getContracts(8453);
  const { writeContract } = useWriteContract();

  const handleApprove = async (spender: string, amount: string) => {
    writeContract({
      address: contracts.token.address,
      abi: contracts.token.abi,
      functionName: 'approve',
      args: [spender as `0x${string}`, parseUnits(amount, 18)],
    });
  };

  return <button onClick={() => handleApprove('0x...', '1000')}>Approve</button>;
}
```

## 🔧 Configuration for Testnet

When you're ready to test on Base Sepolia:

1. Deploy your contracts to Base Sepolia testnet
2. Update addresses in `config/contracts.ts`:
```typescript
export const BASE_SEPOLIA_CONTRACTS = {
  nft: {
    address: '0xYOUR_TESTNET_NFT_ADDRESS',
    abi: NFT_ABI,
    name: 'NFT Contract (Testnet)',
  },
  token: {
    address: '0xYOUR_TESTNET_TOKEN_ADDRESS',
    abi: ERC20_ABI,
    name: 'Token Contract (Testnet)',
  },
};
```

3. The app will automatically use testnet contracts when connected to Sepolia!

## 📚 Additional Resources

- **Wagmi Docs**: https://wagmi.sh
- **Viem Docs**: https://viem.sh
- **Base Docs**: https://docs.base.org
- **Basescan**: https://basescan.org
- **Base Sepolia Faucet**: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet

## 🎯 Next Steps

1. ✅ Contract addresses configured
2. ✅ ERC20 ABI ready
3. ⚠️ **TODO**: Replace NFT ABI placeholder with your actual ABI
4. ⚠️ **TODO**: Add testnet contract addresses (optional)
5. ⚠️ **TODO**: Test contract interactions in your app

## 💡 Tips

- Always test on testnet first
- Verify your contracts on Basescan
- Keep ABIs in sync with deployed contracts
- Use TypeScript for type safety
- Handle loading and error states in UI

Your contract configuration is ready! Just add your NFT ABI and start building! 🚀
