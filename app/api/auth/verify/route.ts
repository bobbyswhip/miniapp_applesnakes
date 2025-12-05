import { NextRequest, NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';
import jwt from 'jsonwebtoken';
import { nonceStore } from '@/lib/nonceStore';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set in environment variables');
}

export async function POST(request: NextRequest) {
  try {
    const { message, signature, nonce } = await request.json();

    if (!message || !signature || !nonce) {
      return NextResponse.json(
        { error: 'Missing required fields: message, signature, nonce' },
        { status: 400 }
      );
    }

    if (!JWT_SECRET) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Validate nonce exists and not expired
    if (!nonceStore.validate(nonce)) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce - please try again' },
        { status: 400 }
      );
    }

    // Parse and verify the SIWE message
    const siweMessage = new SiweMessage(message);

    // Verify the signature
    const { data: fields } = await siweMessage.verify({
      signature,
      nonce,
    });

    // Clean up used nonce
    nonceStore.delete(nonce);

    // Create JWT token
    const token = jwt.sign(
      {
        address: fields.address,
        chainId: fields.chainId,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return NextResponse.json({
      success: true,
      token,
      address: fields.address,
      chainId: fields.chainId,
    });
  } catch (error) {
    console.error('Auth verify error:', error);

    if (error instanceof Error) {
      if (error.message.includes('Signature')) {
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }
}
