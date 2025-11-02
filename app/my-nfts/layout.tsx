import { Metadata } from 'next'
import { farcasterPageMetadata } from '@/lib/farcaster/metadata'

export const metadata: Metadata = farcasterPageMetadata.myNFTs()

export default function MyNFTsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
