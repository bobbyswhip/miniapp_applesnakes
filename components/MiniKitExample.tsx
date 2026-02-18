'use client';

import { useMiniKit, useIsInMiniApp, usePrimaryButton, useOpenUrl } from '@coinbase/onchainkit/minikit';

/**
 * MiniKitExample component demonstrates how to use MiniKit hooks
 * This component shows examples of:
 * - Detecting if app is running in a miniapp
 * - Accessing miniapp context
 * - Using primary button
 * - Opening URLs
 *
 * Use this as a reference for integrating MiniKit features into your app
 */
export function MiniKitExample() {
  const { context, isMiniAppReady } = useMiniKit();
  const isInMiniApp = useIsInMiniApp();
  const openUrl = useOpenUrl();

  // Example: Configure primary button when in miniapp
  usePrimaryButton(
    {
      text: isInMiniApp ? 'Open in Browser' : 'Not in MiniApp',
      disabled: !isInMiniApp,
    },
    () => {
      if (isInMiniApp) {
        openUrl(window.location.href);
      }
    }
  );

  if (!isMiniAppReady && !isInMiniApp) {
    return null;
  }

  return (
    <div className="p-4 bg-[rgba(255,208,117,0.05)] dark:bg-[rgba(255,208,117,0.06)] rounded-lg border border-[rgba(255,208,117,0.2)] dark:border-[rgba(255,208,117,0.15)]">
      <h3 className="text-lg font-semibold mb-2">Base MiniApp Status</h3>
      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium">MiniApp Ready:</span>{' '}
          <span className={isMiniAppReady ? 'text-green-600' : 'text-[#6b7575]'}>
            {isMiniAppReady ? '✓ Yes' : '○ Initializing'}
          </span>
        </div>
        <div>
          <span className="font-medium">Running in MiniApp:</span>{' '}
          <span className={isInMiniApp ? 'text-green-600' : 'text-[#6b7575]'}>
            {isInMiniApp ? '✓ Yes' : '✗ No (Browser)'}
          </span>
        </div>
        {context && (
          <div>
            <span className="font-medium">Context Available:</span>{' '}
            <span className="text-green-600">✓ Yes</span>
          </div>
        )}
      </div>

      {isInMiniApp && (
        <div className="mt-4 p-3 bg-white dark:bg-[#1a2221] rounded border border-[rgba(255,208,117,0.2)] dark:border-[rgba(255,208,117,0.2)]">
          <p className="text-xs text-[#6b7575] dark:text-[#8a9090]">
            🎉 Your app is running as a Base miniapp!
            <br />
            MiniKit features are fully available.
          </p>
        </div>
      )}

      {!isInMiniApp && (
        <div className="mt-4 p-3 bg-white dark:bg-[#1a2221] rounded border border-[rgba(255,255,255,0.1)] dark:border-[rgba(255,255,255,0.08)]">
          <p className="text-xs text-[#6b7575] dark:text-[#8a9090]">
            ℹ️ Running in browser mode.
            <br />
            Test as a Base miniapp by opening in the Base app.
          </p>
        </div>
      )}
    </div>
  );
}
