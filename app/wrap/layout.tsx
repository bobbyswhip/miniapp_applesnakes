import { Metadata } from 'next'
import { farcasterPageMetadata } from '@/lib/farcaster/metadata'

export const metadata: Metadata = farcasterPageMetadata.wrap()

export default function WrapLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
