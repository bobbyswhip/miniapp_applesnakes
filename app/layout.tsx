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
import { generateFarcasterMetadata } from "@/lib/farcaster/metadata";

const inter = Inter({ subsets: ["latin"] });

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://applesnakes.com";

// Generate Farcaster-compatible metadata with all existing metadata preserved
const farcasterMetadata = generateFarcasterMetadata({
  title: "AppleSnakes",
  description: "Fee-less NFT gaming on Base. Breed snakes, explore Apple Valley, collect items with 90-day token vesting mechanics.",
  imageUrl: `${baseUrl}/Images/WebBackground.png`,
  buttonTitle: "Play AppleSnakes",
  actionType: "launch_frame",
  appName: "AppleSnakes",
  appUrl: baseUrl,
  splashImageUrl: `${baseUrl}/Images/Wilfred.png`,
  splashBackgroundColor: "#87CEEB",
  ogTitle: "AppleSnakes",
  ogDescription: "Fee-less NFT gameplay with breeding, jailing, and token vesting. Join the adventure in Apple Valley!",
  ogImageUrl: `${baseUrl}/Images/WebBackground.png`,
});

export const metadata: Metadata = {
  ...farcasterMetadata,
  keywords: "NFT gaming, blockchain games, Base network, snake breeding, token vesting, play-to-earn, NFT collectibles, on-chain gaming, web3 games, crypto gaming",
  authors: [{ name: "AppleSnakes" }],
  metadataBase: new URL(baseUrl),
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    ...farcasterMetadata.openGraph,
    type: "website",
    locale: "en_US",
    siteName: "AppleSnakes",
    images: [
      {
        url: "/Images/WebBackground.png",
        width: 1200,
        height: 630,
        alt: "AppleSnakes - NFT Gaming on Base",
      },
    ],
  },
  twitter: {
    ...farcasterMetadata.twitter,
    creator: "@AppleSnakes",
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
