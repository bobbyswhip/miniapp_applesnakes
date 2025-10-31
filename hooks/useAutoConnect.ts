'use client';

import { useEffect } from 'react';
import { useAccount, useReconnect } from 'wagmi';

/**
 * Hook to automatically reconnect wallet on app restart
 * Uses wagmi's built-in reconnect functionality
 */
export function useAutoConnect() {
  const { isConnected, isReconnecting, address } = useAccount();
  const { reconnect } = useReconnect();

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    // Log connection status for debugging
    console.log('🔍 Auto-connect check:', {
      isConnected,
      isReconnecting,
      hasAddress: !!address
    });

    // Don't reconnect if already connected or currently reconnecting
    if (isConnected || isReconnecting) {
      console.log('⏭️ Skipping reconnect - already connected or reconnecting');
      return;
    }

    // Check if there's a previous connection to restore
    const hasStoredConnection = localStorage.getItem('wagmi.store');
    const recentConnectorId = localStorage.getItem('wagmi.recentConnectorId');

    if (hasStoredConnection || recentConnectorId) {
      console.log('🔄 Attempting to reconnect to previous wallet...');

      // Small delay to allow wagmi to initialize
      const timer = setTimeout(() => {
        // Use wagmi's reconnect which handles the storage and connector logic
        reconnect(undefined, {
          onSuccess: () => {
            console.log('✅ Auto-reconnect successful');
          },
          onError: (error) => {
            console.log('❌ Auto-reconnect failed:', error.message);
          },
        });
      }, 100);

      return () => clearTimeout(timer);
    } else {
      console.log('ℹ️ No previous wallet connection found');
    }
  }, [isConnected, isReconnecting, address, reconnect]);
}
