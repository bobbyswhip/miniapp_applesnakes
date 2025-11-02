# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AppleSnakes is a Next.js 14 NFT gaming application on Base blockchain featuring fee-less NFT gameplay with 90-day token vesting mechanics. The app supports Base miniapps (Farcaster Frames), standard web3 wallets, and includes game mechanics like breeding, jailing, wrapping tokens, and inventory management.

## Development Commands

### Local Development
```bash
# Start dev server (always runs on port 3000)
npm run dev

# If port 3000 is in use, kill the process first
fuser -k 3000/tcp  # then run npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Production build
npm run build

# Production start
npm start
```

### Port Management
- Dev server MUST run on port 3000
- Use `fuser -k 3000/tcp` if port is already in use before starting dev server

## Environment Configuration

Required environment variables (see `.env.example`):

1. **NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID** - Get from https://cloud.walletconnect.com/
2. **NEXT_PUBLIC_IPFS_BASE_URI** - IPFS directory hash for NFT images (without `ipfs://` prefix)
3. **NEXT_PUBLIC_ALCHEMY_API_KEY** - For NFT indexing (https://www.alchemy.com/)
4. **NEXT_PUBLIC_COINBASE_RPC_KEY** - Primary RPC endpoint (https://portal.cdp.coinbase.com/)

## Architecture

### Provider Hierarchy (app/providers.tsx)

The app uses a strict provider nesting order:

```
WagmiProvider (wagmi v2 + Base network config)
  → QueryClientProvider (@tanstack/react-query)
    → MiniKitProvider (Base miniapps support)
      → RainbowKitProvider (wallet connection UI)
        → AutoConnectWrapper (auto-reconnect logic)
          → TransactionProvider (transaction notifications)
            → NFTProvider (NFT data management)
              → InventoryProvider (game inventory state)
```

**Critical**: Never reorder these providers. Each depends on the previous layer.

### Context System

Three global contexts manage application state:

1. **NFTContext** (`contexts/NFTContext.tsx`)
   - Wraps `useUserNFTs` hook for global NFT data access
   - Provides: `nfts`, `isLoading`, `error`, `refetch()`
   - Auto-fetches user's NFTs when wallet connected

2. **TransactionContext** (`contexts/TransactionContext.tsx`)
   - Manages transaction notifications UI
   - Provides: `addTransaction()`, `updateTransaction()`, `removeTransaction()`, `clearAll()`
   - Includes `getBasescanUrl()` helper for block explorer links

3. **InventoryContext** (`contexts/InventoryContext.tsx`)
   - Game-specific inventory state management
   - Handles item collection, display, and interactions

### Contract Architecture (config/contracts.ts)

Multi-chain contract configuration:

- **Base Mainnet** and **Base Sepolia** contract addresses
- Three contract types: NFT, Token (ERC20), Wrapper
- Chain-specific ABIs in `/abis` directory
- Helper functions: `getContracts(chainId)`, `NFT_ADDRESS(chainId)`, `TOKEN_ADDRESS(chainId)`

**Uniswap V4 Integration**:
- Hook address: `HOOK_ADDRESS` for V4 Super Strategy
- Pool Manager: `POOL_MANAGER_ADDRESS`
- Quoter: `QUOTER_ADDRESS` for swap quotes
- Pool config: ETH/Token1 pair with 0.3% fee tier

### Wagmi Configuration (lib/wagmi.ts)

RPC endpoint fallback hierarchy:
1. Coinbase Developer Platform RPC (if `NEXT_PUBLIC_COINBASE_RPC_KEY` set)
2. Alchemy RPC (if `NEXT_PUBLIC_ALCHEMY_API_KEY` set)
3. Public Base RPC (fallback)

All transports configured with:
- Batch requests enabled
- 3 retry attempts
- 30-second timeout

### Custom Hooks (hooks/)

- **useAutoConnect.ts** - Auto-reconnects wallet on mount if previously connected
- **useUserNFTs.ts** - Fetches and manages user's NFT collection (26KB - complex logic)
- **useTokenBalance.ts** - Real-time token balance tracking
- **useNFTBalance.ts** - NFT ownership verification
- **useBasename.ts** - Basename resolution for addresses

### Base MiniApps Integration

The app is MiniKit-enabled for Base miniapps/Farcaster Frames:

- **MiniKitProvider** wraps app in `providers.tsx` with `notificationProxyUrl="/api/notify"`
- **MiniKitFrame** component (`components/MiniKitFrame.tsx`) initializes frame context
- **Notification API** at `/app/api/notify/route.ts` proxies notifications
- See `BASE_MINIAPPS.md` for complete integration guide

**Key behaviors**:
- App works in both browser and miniapp environments (progressive enhancement)
- `useIsInMiniApp()` detects miniapp context
- MiniKit features only activate inside Base app/Farcaster

### Game Architecture (app/page.tsx)

Large complex component (191KB) managing:

- **Location system**: 8 locations with classification (Valley/Snow/Cave)
- **Time-of-day cycle**: 8 phases (day, sunset, dusk, moonrise, night, moonset, dawn, sunrise)
- **Music system**: Dynamic background music per location
- **Game mechanics**: Breeding, jailing, item collection, inventory
- **NFT interactions**: Feeding, training, battle simulation

### UI Components (components/)

Key components:
- **Navigation.tsx** (28KB) - Main nav with wallet integration
- **InventorySack.tsx** (28KB) - Game inventory UI
- **JailInterface.tsx** (44KB) - Jail game mechanic
- **WelcomeModal.tsx** - First-time user onboarding
- **TransactionNotifications.tsx** - Toast-style tx notifications
- **NFTImage.tsx** - Optimized NFT image loading with IPFS fallback
- **WalletConnect.tsx** / **WalletDisplay.tsx** - RainbowKit integration

## Key Technical Details

### TypeScript Configuration
- Strict mode enabled
- Path alias: `@/` maps to root directory
- All components and hooks are fully typed

### Image Optimization
Next.js Image component configured for:
- Alchemy CDN (primary - fastest NFT images)
- Multiple IPFS gateways (fallback)
- See `next.config.js` for complete gateway list

### Webpack Customizations
- Disabled: `fs`, `net`, `tls` (browser compatibility)
- External: `pino-pretty`, `lokijs`, `encoding` (wallet SDK compatibility)
- Alias: `@react-native-async-storage/async-storage` set to false (MetaMask SDK fix)

### Page Structure
- **/** - Main game interface with location system
- **/my-nfts** - User's NFT collection gallery
- **/wrap** - Token wrapping interface
- **/docs** - Documentation/help page

### Build Notes
- React strict mode enabled
- Build activity indicator disabled
- Dev indicator position: bottom-right
- Using Next.js App Router (not Pages Router)

## Common Patterns

### Contract Reads
```typescript
const { data } = useReadContract({
  address: getContracts(chainId).nft.address,
  abi: getContracts(chainId).nft.abi,
  functionName: 'functionName',
  args: [arg1, arg2],
  chainId: base.id,
});
```

### Contract Writes with Transactions
```typescript
const { writeContract } = useWriteContract();
const { addTransaction, updateTransaction } = useTransactions();

const hash = await writeContract({
  address: contractAddress,
  abi: contractAbi,
  functionName: 'functionName',
  args: [arg1, arg2],
});

addTransaction(hash, 'Description');
// Later: updateTransaction(hash, 'success' | 'error');
```

### NFT Data Access
```typescript
const { nfts, isLoading, error, refetch } = useNFTContext();
// nfts is array of UserNFT objects with full metadata
```

### Chain-Specific Logic
```typescript
import { base, baseSepolia } from 'wagmi/chains';
const { chain } = useAccount();
const contracts = getContracts(chain?.id || base.id);
```

## Development Notes

- Hot reload works automatically with Vite/React - no hard refresh needed for changes
- When adding new pages, update routing configuration if using clean URLs
- Dev server must be killed and restarted if changing environment variables
- Use Playwright MCP for browser automation testing (don't write Playwright tests manually)
- Don't close browser after Playwright MCP tasks
