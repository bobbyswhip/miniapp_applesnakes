'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { config } from '@/lib/wagmi';
import { ReactNode } from 'react';
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
        <RainbowKitProvider>
          <AutoConnectWrapper>
            <TransactionProvider>
              <NFTProvider>{children}</NFTProvider>
            </TransactionProvider>
          </AutoConnectWrapper>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
