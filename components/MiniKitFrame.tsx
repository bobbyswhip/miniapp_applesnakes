'use client';

import { useEffect } from 'react';
import { useMiniKit, useIsInMiniApp } from '@coinbase/onchainkit/minikit';

/**
 * MiniKitFrame component initializes the MiniKit frame and sets it as ready.
 * This component should be included in the layout to enable Base miniapp features.
 */
export function MiniKitFrame() {
  const { context, isMiniAppReady, setMiniAppReady } = useMiniKit();
  const isInMiniApp = useIsInMiniApp();

  useEffect(() => {
    // Set the miniapp as ready if we're in a miniapp context and not already ready
    if (isInMiniApp && !isMiniAppReady) {
      setMiniAppReady();
    }

    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('MiniKit Status:', {
        isInMiniApp,
        isMiniAppReady,
        hasContext: !!context,
      });
    }
  }, [isInMiniApp, isMiniAppReady, setMiniAppReady, context]);

  // This component doesn't render anything, it just initializes MiniKit
  return null;
}
