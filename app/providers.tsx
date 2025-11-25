'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { MiniKitProvider as MiniKitProviderOriginal } from '@coinbase/onchainkit/minikit';
import { config } from '@/lib/wagmi';
import { ReactNode, ComponentType } from 'react';

// Type workaround for React 19 compatibility with MiniKitProvider
const MiniKitProvider = MiniKitProviderOriginal as ComponentType<{
  children: ReactNode;
  enabled?: boolean;
  notificationProxyUrl?: string;
  autoConnect?: boolean;
}>;
import { NFTProvider } from '@/contexts/NFTContext';
import { TransactionProvider } from '@/contexts/TransactionContext';
import { useAutoConnect } from '@/hooks/useAutoConnect';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AutoConnectWrapper({ children }: { children: ReactNode }) {
  // Auto-reconnect wallet on mount if previously connected
  useAutoConnect();

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config} reconnectOnMount={true}>
      <QueryClientProvider client={queryClient}>
        <MiniKitProvider
          enabled={true}
          notificationProxyUrl="/api/notify"
          autoConnect={true}
        >
          <RainbowKitProvider>
            <AutoConnectWrapper>
              <TransactionProvider>
                <NFTProvider>{children}</NFTProvider>
              </TransactionProvider>
            </AutoConnectWrapper>
          </RainbowKitProvider>
        </MiniKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
