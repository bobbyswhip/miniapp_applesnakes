'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useUserNFTs, UserNFT } from '@/hooks/useUserNFTs';

interface NFTContextType {
  nfts: UserNFT[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const NFTContext = createContext<NFTContextType | undefined>(undefined);

export function NFTProvider({ children }: { children: ReactNode }) {
  const { nfts, isLoading, error, refetch } = useUserNFTs();

  return (
    <NFTContext.Provider value={{ nfts, isLoading, error, refetch }}>
      {children}
    </NFTContext.Provider>
  );
}

export function useNFTContext() {
  const context = useContext(NFTContext);
  if (context === undefined) {
    throw new Error('useNFTContext must be used within NFTProvider');
  }
  return context;
}
