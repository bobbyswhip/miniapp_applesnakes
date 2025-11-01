import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navigation } from "@/components/Navigation";
import { TransactionNotifications } from "@/components/TransactionNotifications";
import { InventorySack } from "@/components/InventorySack";
import { MiniKitFrame } from "@/components/MiniKitFrame";
import { WelcomeModal } from "@/components/WelcomeModal";
import { InventoryProvider } from "@/contexts/InventoryContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Apple Valley - AppleSnakes NFT",
  description: "A revolutionary fee-less NFT gaming ecosystem on Base where every action vests tokens over 90 days",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <InventoryProvider>
            <MiniKitFrame />
            <WelcomeModal />
            <Navigation />
            {children}
            <TransactionNotifications />
            <InventorySack />
          </InventoryProvider>
        </Providers>
      </body>
    </html>
  );
}
