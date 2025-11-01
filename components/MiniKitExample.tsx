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
    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
      <h3 className="text-lg font-semibold mb-2">Base MiniApp Status</h3>
      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium">MiniApp Ready:</span>{' '}
          <span className={isMiniAppReady ? 'text-green-600' : 'text-gray-600'}>
            {isMiniAppReady ? '✓ Yes' : '○ Initializing'}
          </span>
        </div>
        <div>
          <span className="font-medium">Running in MiniApp:</span>{' '}
          <span className={isInMiniApp ? 'text-green-600' : 'text-gray-600'}>
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
        <div className="mt-4 p-3 bg-white dark:bg-gray-800 rounded border border-blue-300 dark:border-blue-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            🎉 Your app is running as a Base miniapp!
            <br />
            MiniKit features are fully available.
          </p>
        </div>
      )}

      {!isInMiniApp && (
        <div className="mt-4 p-3 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            ℹ️ Running in browser mode.
            <br />
            Test as a Base miniapp by opening in the Base app.
          </p>
        </div>
      )}
    </div>
  );
}
