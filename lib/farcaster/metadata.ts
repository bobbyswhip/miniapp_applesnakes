import { Metadata } from 'next'

// Get base URL from environment variable
// Development: https://boomertest.ngrok.dev
// Production: https://applesnakes.com
const getBaseUrl = () => {
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://applesnakes.com'
}

export interface FarcasterMiniAppEmbed {
  version: '1'
  imageUrl: string
  button: {
    title: string
    action: {
      type: 'launch_frame' | 'launch_miniapp'
      name: string
      url?: string
      splashImageUrl?: string
      splashBackgroundColor?: string
    }
  }
}

export interface FarcasterMetadataOptions {
  title?: string
  description?: string
  imageUrl?: string
  buttonTitle?: string
  actionType?: 'launch_frame' | 'launch_miniapp'
  appName?: string
  appUrl?: string
  splashImageUrl?: string
  splashBackgroundColor?: string
  ogTitle?: string
  ogDescription?: string
  ogImageUrl?: string
}

/**
 * Generate Farcaster-compatible metadata for a Next.js page
 * This includes both the fc:miniapp and fc:frame tags for backward compatibility
 */
export function generateFarcasterMetadata(
  options: FarcasterMetadataOptions = {}
): Metadata {
  const baseUrl = getBaseUrl()

  const {
    title = 'AppleSnakes',
    description = 'Fee-less NFT gaming on Base. Breed snakes, explore Apple Valley, collect items with 90-day token vesting mechanics.',
    imageUrl = `${baseUrl}/Images/WebBackground.png`,
    buttonTitle = 'Play AppleSnakes',
    actionType = 'launch_frame',
    appName = 'AppleSnakes',
    appUrl = baseUrl,
    splashImageUrl = `${baseUrl}/Images/Wilfred.png`,
    splashBackgroundColor = '#87CEEB',
    ogTitle = title,
    ogDescription = description,
    ogImageUrl = imageUrl,
  } = options

  const frame: FarcasterMiniAppEmbed = {
    version: '1',
    imageUrl,
    button: {
      title: buttonTitle.slice(0, 32), // Max 32 characters
      action: {
        type: actionType,
        name: appName,
        url: appUrl,
        splashImageUrl,
        splashBackgroundColor,
      },
    },
  }

  const frameString = JSON.stringify(frame)

  return {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      images: [ogImageUrl],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      images: [ogImageUrl],
    },
    other: {
      'fc:miniapp': frameString,
      'fc:frame': frameString, // For backward compatibility
    },
  }
}

/**
 * Generate metadata for specific page types
 */
export const farcasterPageMetadata = {
  home: () => {
    const baseUrl = getBaseUrl()
    return generateFarcasterMetadata({
      title: 'AppleSnakes',
      description: 'Explore Apple Valley with NFT snakes! Breed, battle, collect items with 90-day token vesting on Base blockchain.',
      imageUrl: `${baseUrl}/Images/WebBackground.png`,
      buttonTitle: 'Play AppleSnakes',
      appUrl: baseUrl,
      ogTitle: 'AppleSnakes',
      ogDescription: 'Fee-less NFT gameplay with breeding, jailing, and token vesting. Join the adventure in Apple Valley!',
    })
  },

  myNFTs: () => {
    const baseUrl = getBaseUrl()
    return generateFarcasterMetadata({
      title: 'My NFTs',
      description: 'View and manage your AppleSnakes NFT collection. Feed, train, and prepare your snakes for adventure!',
      imageUrl: `${baseUrl}/Images/TownBackground.png`,
      buttonTitle: 'View My Snakes',
      appUrl: `${baseUrl}/my-nfts`,
      ogTitle: 'My NFTs',
      ogDescription: 'View and manage your AppleSnakes NFT collection',
    })
  },

  wrap: () => {
    const baseUrl = getBaseUrl()
    return generateFarcasterMetadata({
      title: 'Token Wrapping',
      description: 'Wrap AppleSnakes tokens with 90-day vesting. Manage your token inventory and unlock rewards over time.',
      imageUrl: `${baseUrl}/Images/WizardHouseLarge.png`,
      buttonTitle: 'Wrap Tokens',
      appUrl: `${baseUrl}/wrap`,
      ogTitle: 'Token Wrapping',
      ogDescription: 'Wrap your tokens with 90-day vesting mechanics',
    })
  },

  docs: () => {
    const baseUrl = getBaseUrl()
    return generateFarcasterMetadata({
      title: 'Documentation',
      description: 'Learn how to play AppleSnakes! Game mechanics, breeding strategies, location guides, and token vesting details.',
      imageUrl: `${baseUrl}/Images/TownStoreLarge.png`,
      buttonTitle: 'Read Docs',
      appUrl: `${baseUrl}/docs`,
      ogTitle: 'How to Play',
      ogDescription: 'Learn the game mechanics and strategies for AppleSnakes',
    })
  },

  location: (locationName: string, locationImage: string) => {
    const baseUrl = getBaseUrl()
    return generateFarcasterMetadata({
      title: locationName,
      description: `Explore ${locationName} in Apple Valley. Discover items, interact with NPCs, and continue your adventure!`,
      imageUrl: `${baseUrl}${locationImage}`,
      buttonTitle: `Visit ${locationName}`,
      appUrl: baseUrl,
      ogTitle: locationName,
      ogDescription: `Explore ${locationName} in the AppleSnakes universe`,
    })
  },
}
