import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { getContracts } from '@/config/contracts';

const JWT_SECRET = process.env.JWT_SECRET;

// Create a public client for Base
const publicClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.NEXT_PUBLIC_COINBASE_RPC_KEY
      ? `https://api.developer.coinbase.com/rpc/v1/base/${process.env.NEXT_PUBLIC_COINBASE_RPC_KEY}`
      : process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
      : 'https://mainnet.base.org'
  ),
});

interface JWTPayload {
  address: string;
  chainId: number;
  iat: number;
  exp: number;
}

export async function GET(request: NextRequest) {
  try {
    // Get Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    if (!JWT_SECRET) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Verify JWT token
    let payload: JWTPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const userAddress = payload.address as `0x${string}`;
    const contracts = getContracts(base.id);

    // Fetch user data in parallel
    const [ethBalance, tokenBalance, tokenDecimals, tokenSymbol, nftBalance] = await Promise.all([
      // ETH balance
      publicClient.getBalance({ address: userAddress }),
      // Token balance
      publicClient.readContract({
        address: contracts.token.address as `0x${string}`,
        abi: contracts.token.abi,
        functionName: 'balanceOf',
        args: [userAddress],
      }),
      // Token decimals
      publicClient.readContract({
        address: contracts.token.address as `0x${string}`,
        abi: contracts.token.abi,
        functionName: 'decimals',
        args: [],
      }),
      // Token symbol
      publicClient.readContract({
        address: contracts.token.address as `0x${string}`,
        abi: contracts.token.abi,
        functionName: 'symbol',
        args: [],
      }),
      // NFT balance
      publicClient.readContract({
        address: contracts.nft.address as `0x${string}`,
        abi: contracts.nft.abi,
        functionName: 'balanceOf',
        args: [userAddress],
      }),
    ]);

    // Format balances
    const formattedEthBalance = formatUnits(ethBalance, 18);
    const formattedTokenBalance = formatUnits(tokenBalance as bigint, tokenDecimals as number);

    return NextResponse.json({
      success: true,
      user: {
        walletAddress: userAddress,
        chainId: payload.chainId,
        ethBalance: formattedEthBalance,
        tokenBalance: {
          balance: (tokenBalance as bigint).toString(),
          formattedBalance: formattedTokenBalance,
          decimals: tokenDecimals as number,
          symbol: tokenSymbol as string,
        },
        nftCount: Number(nftBalance),
      },
    });
  } catch (error) {
    console.error('User me error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user data' },
      { status: 500 }
    );
  }
}
