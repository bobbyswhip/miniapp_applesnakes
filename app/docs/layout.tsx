import { Metadata } from 'next'
import { farcasterPageMetadata } from '@/lib/farcaster/metadata'

export const metadata: Metadata = farcasterPageMetadata.docs()

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
