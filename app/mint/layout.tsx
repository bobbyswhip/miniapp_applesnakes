import { generateFarcasterMetadata } from '@/lib/farcaster/metadata';

// Get base URL from environment variable
const getBaseUrl = () => {
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://applesnakes.com';
};

export const metadata = generateFarcasterMetadata({
  title: 'Mint AppleSnakes NFT',
  description: 'Mint your AppleSnakes NFT and start playing! Fee-less NFT gaming on Base with breeding, exploration, and 90-day token vesting.',
  imageUrl: `${getBaseUrl()}/Images/Wilfred.png`,
  buttonTitle: 'Mint Now',
  actionType: 'launch_frame',
  appName: 'AppleSnakes',
  appUrl: `${getBaseUrl()}/?fastTravelMint=true`,
  splashImageUrl: `${getBaseUrl()}/Images/Wilfred.png`,
  splashBackgroundColor: '#87CEEB',
  ogTitle: 'Mint AppleSnakes NFT',
  ogDescription: 'Mint your AppleSnakes NFT and join the adventure in Apple Valley!',
  ogImageUrl: `${getBaseUrl()}/Images/Wilfred.png`,
});

export default function MintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
