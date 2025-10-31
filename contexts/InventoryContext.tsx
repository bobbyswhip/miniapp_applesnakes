'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface InventoryContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleInventory: () => void;
  // UI coordination
  showSwapMint: boolean;
  setShowSwapMint: (open: boolean) => void;
  showChat: boolean;
  setShowChat: (open: boolean) => void;
  showHatch: boolean;
  setShowHatch: (open: boolean) => void;
  showBreed: boolean;
  setShowBreed: (open: boolean) => void;
  // Coordinated open functions that close other UIs
  openInventory: () => void;
  openSwapMint: () => void;
  openChat: () => void;
  openHatch: () => void;
  openBreed: () => void;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSwapMint, setShowSwapMint] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showHatch, setShowHatch] = useState(false);
  const [showBreed, setShowBreed] = useState(false);

  const toggleInventory = () => setIsOpen(prev => !prev);

  // Coordinated open functions that close other UIs
  const openInventory = () => {
    setIsOpen(true);
    setShowSwapMint(false);
    setShowChat(false);
    setShowHatch(false);
    setShowBreed(false);
  };

  const openSwapMint = () => {
    setShowSwapMint(true);
    setIsOpen(false);
    setShowChat(false);
    setShowHatch(false);
    setShowBreed(false);
  };

  const openChat = () => {
    setShowChat(true);
    setIsOpen(false);
    setShowSwapMint(false);
    setShowHatch(false);
    setShowBreed(false);
  };

  const openHatch = () => {
    setShowHatch(true);
    setIsOpen(false);
    setShowSwapMint(false);
    setShowChat(false);
    setShowBreed(false);
  };

  const openBreed = () => {
    setShowBreed(true);
    setIsOpen(false);
    setShowSwapMint(false);
    setShowChat(false);
    setShowHatch(false);
  };

  return (
    <InventoryContext.Provider
      value={{
        isOpen,
        setIsOpen,
        toggleInventory,
        showSwapMint,
        setShowSwapMint,
        showChat,
        setShowChat,
        showHatch,
        setShowHatch,
        showBreed,
        setShowBreed,
        openInventory,
        openSwapMint,
        openChat,
        openHatch,
        openBreed,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (context === undefined) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
}
