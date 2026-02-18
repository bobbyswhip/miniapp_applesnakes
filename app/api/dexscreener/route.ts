import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token parameter' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${token}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) {
      return NextResponse.json({ pairs: [] });
    }

    const data = await res.json();
    const paired: string[] = [];

    if (data.pairs && Array.isArray(data.pairs)) {
      const targetLower = token.toLowerCase();
      for (const pair of data.pairs) {
        if (pair.chainId !== 'base') continue;
        const baseAddr = pair.baseToken?.address?.toLowerCase();
        const quoteAddr = pair.quoteToken?.address?.toLowerCase();
        if (baseAddr === targetLower && quoteAddr) paired.push(quoteAddr);
        if (quoteAddr === targetLower && baseAddr) paired.push(baseAddr);
      }
    }

    return NextResponse.json({ paired: [...new Set(paired)] });
  } catch (err) {
    console.error('[dexscreener proxy] Error:', err);
    return NextResponse.json({ paired: [] });
  }
}
