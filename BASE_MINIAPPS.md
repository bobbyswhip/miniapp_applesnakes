# Base MiniApps Integration Guide

This document explains how Base miniapps support has been integrated into AppleSnakes.

## What are Base MiniApps?

Base miniapps are lightweight web applications that run directly inside the Base app and Farcaster Frames, without needing to open a browser or download anything. They provide a seamless, native-like experience for users.

## Integration Overview

This application now supports Base miniapps through **MiniKit** from `@coinbase/onchainkit`. MiniKit provides:

- Automatic detection of miniapp environment
- Frame context and lifecycle management
- Coinbase Wallet integration hooks
- Notification support
- UI components optimized for miniapps

## What Was Added

### 1. MiniKitProvider Wrapper

**File**: `app/providers.tsx`

The app is now wrapped with `MiniKitProvider` to enable miniapp features:

```typescript
<MiniKitProvider
  enabled={true}
  notificationProxyUrl="/api/notify"
  autoConnect={true}
>
  {/* Rest of the app */}
</MiniKitProvider>
```

### 2. Frame Initialization Component

**File**: `components/MiniKitFrame.tsx`

This component automatically initializes the miniapp frame and sets it as ready:

```typescript
const { isMiniAppReady, setMiniAppReady } = useMiniKit();
const isInMiniApp = useIsInMiniApp();

// Automatically set frame as ready when in miniapp
if (isInMiniApp && !isMiniAppReady) {
  setMiniAppReady();
}
```

### 3. Example Component

**File**: `components/MiniKitExample.tsx`

Demonstrates how to use MiniKit hooks including:
- `useMiniKit()` - Access miniapp context
- `useIsInMiniApp()` - Detect if running in miniapp
- `usePrimaryButton()` - Configure primary action button
- `useOpenUrl()` - Open URLs within miniapp context

### 4. Notification Proxy Endpoint

**File**: `app/api/notify/route.ts`

API endpoint that proxies notification requests to handle CORS restrictions:

```typescript
POST /api/notify
{
  "notificationUrl": "https://...",
  "...notificationData": {}
}
```

### 5. Environment Variables

**File**: `.env.example`

Added configuration options:

```env
# Enable MiniKit for Base miniapps
NEXT_PUBLIC_MINIKIT_ENABLED=true

# Optional: Coinbase RPC for enhanced performance
NEXT_PUBLIC_COINBASE_RPC_KEY=your_key_here
```

## Available MiniKit Hooks

### Core Hooks

```typescript
import {
  useMiniKit,
  useIsInMiniApp,
  usePrimaryButton,
  useOpenUrl,
  useNotification,
  useClose,
  useAuthenticate,
  useViewProfile,
  useAddFrame,
  useComposeCast,
  useViewCast,
  useSwapToken,
  useSendToken,
  useQuickAuth,
} from '@coinbase/onchainkit/minikit';
```

### Usage Examples

#### Detect Miniapp Environment

```typescript
const isInMiniApp = useIsInMiniApp();

if (isInMiniApp) {
  // Show miniapp-specific UI
}
```

#### Configure Primary Button

```typescript
usePrimaryButton(
  {
    text: 'Take Action',
    disabled: false,
  },
  () => {
    // Handle button click
    console.log('Primary button clicked');
  }
);
```

#### Open URLs

```typescript
const openUrl = useOpenUrl();

// Opens URL in miniapp context or new tab
openUrl('https://example.com');
```

#### Send Notifications

```typescript
const { sendNotification } = useNotification();

await sendNotification({
  title: 'Success',
  body: 'Action completed successfully',
});
```

## Testing Miniapps

### In Browser (Development)

The app will work normally in a browser. MiniKit features will be disabled, but the app will function as before.

```bash
npm run dev
```

Visit `http://localhost:3000` to test in browser mode.

### In Base App (Production)

To test as a real miniapp:

1. Deploy your app to a public URL
2. Create a Farcaster frame that links to your app
3. Open the frame in the Base app
4. Your app will now run as a miniapp with full MiniKit features

### Check MiniApp Status

Add the `MiniKitExample` component to any page to see the current status:

```typescript
import { MiniKitExample } from '@/components/MiniKitExample';

export default function Page() {
  return (
    <div>
      <MiniKitExample />
      {/* Your page content */}
    </div>
  );
}
```

## Additional Components

### SafeArea Component

Use the `SafeArea` component to respect device safe areas:

```typescript
import { SafeArea } from '@coinbase/onchainkit/minikit';

<SafeArea>
  {/* Your content will respect safe areas */}
</SafeArea>
```

## Best Practices

1. **Progressive Enhancement**: The app should work in both miniapp and browser environments
2. **Feature Detection**: Always check `useIsInMiniApp()` before using miniapp-specific features
3. **Frame Readiness**: Call `setMiniAppReady()` only after your app is fully loaded
4. **Responsive Design**: Design for mobile-first since miniapps primarily run on mobile devices
5. **Performance**: Keep bundle size small for fast loading in miniapp context

## Deployment Considerations

### Manifest File

Consider adding a miniapp manifest for enhanced integration:

```json
{
  "name": "AppleSnakes",
  "description": "NFT Game on Base",
  "icon": "/icon.png",
  "splash": {
    "image": "/splash.png",
    "backgroundColor": "#000000"
  }
}
```

### Frame Configuration

When creating Farcaster frames, ensure:
- Images are optimized and load quickly
- Buttons clearly indicate the action
- Frame URL points to your deployed app

## Resources

- [Base MiniApps Documentation](https://docs.base.org/mini-apps/overview)
- [MiniKit Documentation](https://docs.base.org/builderkits/minikit/overview)
- [OnchainKit Documentation](https://onchainkit.xyz/)
- [Farcaster Frames](https://docs.farcaster.xyz/reference/frames/spec)

## Troubleshooting

### MiniKit not working

1. Check that `NEXT_PUBLIC_MINIKIT_ENABLED=true` in your `.env.local`
2. Ensure `MiniKitProvider` is wrapping your app in `providers.tsx`
3. Verify `MiniKitFrame` component is included in `layout.tsx`

### Notifications failing

1. Ensure the notification proxy endpoint is accessible at `/api/notify`
2. Check browser console for error messages
3. Verify CORS headers are correctly configured

### TypeScript errors

Some TypeScript errors related to `MiniKitProvider` are expected due to version compatibility. These are suppressed with `@ts-expect-error` and don't affect runtime behavior.

## Migration from Regular Web App

The integration is **backward compatible**. Your app will continue to work normally in browsers. MiniKit features only activate when running inside the Base app or Farcaster frames.

No changes to existing functionality are required. Simply add miniapp-specific features where desired using the hooks provided by MiniKit.
