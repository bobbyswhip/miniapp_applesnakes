import { generateFarcasterMetadata } from '@/lib/farcaster/metadata';

// Get base URL from environment variable
const getBaseUrl = () => {
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://applesnakes.com';
};

export const metadata = generateFarcasterMetadata({
  title: 'Blackjack - AppleSnakes Prediction Market',
  description: 'Join the AppleSnakes Prediction Market! Bet on blackjack games with YES/NO shares on Base blockchain.',
  imageUrl: `${getBaseUrl()}/Images/MountainHut.png`,
  buttonTitle: 'Play Blackjack',
  actionType: 'launch_frame',
  appName: 'AppleSnakes',
  appUrl: `${getBaseUrl()}/blackjack`,
  splashImageUrl: `${getBaseUrl()}/Images/MountainHut.png`,
  splashBackgroundColor: '#4A5568',
  ogTitle: 'Blackjack - AppleSnakes Prediction Market',
  ogDescription: 'Bet on blackjack outcomes in the AppleSnakes Prediction Market!',
  ogImageUrl: `${getBaseUrl()}/Images/MountainHut.png`,
});

export default function BlackjackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
