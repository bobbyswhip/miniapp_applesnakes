import { NextResponse } from 'next/server';
import { generateNonce } from 'siwe';
import { nonceStore } from '@/lib/nonceStore';

export async function GET() {
  const nonce = generateNonce();

  // Store nonce with 5 minute expiry
  nonceStore.set(nonce, 5 * 60 * 1000);

  return NextResponse.json({ nonce });
}
