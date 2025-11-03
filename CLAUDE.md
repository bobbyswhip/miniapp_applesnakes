# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AppleSnakes is a Next.js 16 NFT gaming application on Base blockchain featuring fee-less NFT gameplay with 90-day token vesting mechanics. The app supports Base miniapps (Farcaster Frames), standard web3 wallets, and includes game mechanics like breeding, jailing, wrapping tokens, and inventory management.

## Development Commands

### Local Development
```bash
# Start dev server with Turbopack (default in Next.js 16)
npm run dev

# If port 3000 is in use, kill the process first
lsof -ti:3000 | xargs kill -9  # then run npm run dev

# Type checking (runs during build, optional standalone check)
npm run type-check

# Code validation (type check + linting)
npm run validate

# Linting (TypeScript errors only - no ESLint errors displayed)
# Note: Next.js 16 removed built-in linting from build process
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues where possible

# Production build (includes TypeScript checking, no linting)
npm run build

# Production start
npm start
```

### Port Management
- Dev server MUST run on port 3000
- Use `lsof -ti:3000 | xargs kill -9` if port is already in use before starting dev server

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

### Farcaster Metadata System (lib/farcaster/metadata.ts)

Standardized Farcaster Frame/MiniApp metadata generation:

**Core Function**: `generateFarcasterMetadata(options)`
- Generates `fc:miniapp` and `fc:frame` tags with embedded JSON
- Version 1 format with structured button actions
- Includes OpenGraph and Twitter card metadata
- Environment-aware base URL (uses `NEXT_PUBLIC_BASE_URL` or falls back to production)

**Configuration Options**:
- `title`, `description` - Page title and description
- `imageUrl` - Preview image for the frame
- `buttonTitle` - Call-to-action button text (max 32 chars)
- `actionType` - `'launch_frame'` or `'launch_miniapp'`
- `appName` - Application name
- `appUrl` - Target URL when button is clicked
- `splashImageUrl` - Splash screen image for miniapp launch
- `splashBackgroundColor` - Splash screen background color
- `ogTitle`, `ogDescription`, `ogImageUrl` - OpenGraph overrides

**Pre-configured Page Metadata** (`farcasterPageMetadata`):
- `home()` - Main game interface
- `myNFTs()` - NFT collection page
- `wrap()` - Token wrapping interface
- `docs()` - Documentation page
- `location(name, image)` - Dynamic location pages

**Usage Example**:
```typescript
// In app/[page]/layout.tsx
import { generateFarcasterMetadata } from '@/lib/farcaster/metadata';

export const metadata = generateFarcasterMetadata({
  title: 'Page Title',
  description: 'Page description',
  buttonTitle: 'Click Me',
  appUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/page`,
});
```

**Important**: Always use this system for pages that should be shareable on Farcaster to ensure proper miniapp embed formatting.

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

### Bundler Configuration (Next.js 16)
**Turbopack** (stable, default bundler):
- 2-5× faster production builds
- Up to 10× faster Fast Refresh
- File system caching available via `experimental.turbopackFileSystemCacheForDev: true`
- Fallback webpack config for compatibility:
  - Disabled: `fs`, `net`, `tls` (browser compatibility)
  - External: `pino-pretty`, `lokijs`, `encoding` (wallet SDK compatibility)
  - Alias: `@react-native-async-storage/async-storage` set to false (MetaMask SDK fix)

### Linting & Quality Checks (Next.js 16 Changes)

**Important Breaking Change**: Next.js 16 removed the built-in `next lint` command and automatic linting during builds.

**Current Setup**:
- ESLint 8.57.1 with legacy `.eslintrc.json` configuration
- TypeScript checking runs during `npm run build` (catches type errors)
- No automatic linting during build process
- Manual linting available via `npm run lint` but has limitations

**Recommended Workflow**:
1. **Before Committing**: Run `npm run validate` (runs type-check + lint)
2. **During Development**: Rely on TypeScript errors (shown in IDE and build)
3. **Type Safety**: `npm run type-check` catches all TypeScript errors
4. **Production Builds**: Only TypeScript errors will fail the build

**ESLint Configuration** (.eslintrc.json):
```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_"
    }],
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "@next/next/no-sync-scripts": "error"
  }
}
```

**Migration Note**: Next.js 16 documentation recommends migrating to Biome or using ESLint directly. Current setup uses ESLint 8 with legacy config for compatibility.

### Page Structure
- **/** - Main game interface with location system
- **/my-nfts** - User's NFT collection gallery
- **/wrap** - Token wrapping interface
- **/docs** - Documentation/help page
- **/mint** - Mint page with Farcaster Frame metadata (redirects to `/?fastTravelMint=true`)

### Build Notes
- React 19.2 (includes View Transitions, useEffectEvent, Activity component)
- React strict mode enabled
- Build activity indicator disabled
- Dev indicator position: bottom-right
- Using Next.js App Router (not Pages Router)
- Turbopack is the default bundler (webpack available via `--webpack` flag)

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

- Hot reload works automatically with Turbopack - significantly faster than previous bundler
- When adding new pages, update routing configuration if using clean URLs
- Dev server must be killed and restarted if changing environment variables
- Use Playwright MCP for browser automation testing (don't write Playwright tests manually)
- Don't close browser after Playwright MCP tasks
- TypeScript errors will fail builds, but ESLint errors won't (Next.js 16 change)
- Run `npm run validate` before committing to catch both TypeScript and ESLint issues
