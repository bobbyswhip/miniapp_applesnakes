import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navigation } from "@/components/Navigation";
import { TransactionNotifications } from "@/components/TransactionNotifications";
import { InventorySack } from "@/components/InventorySack";
import { InventoryProvider } from "@/contexts/InventoryContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "applesnakes",
  description: "Connect your wallet on Base blockchain",
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
