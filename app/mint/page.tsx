'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MintPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to main page with fastTravelMint query parameter
    router.replace('/?fastTravelMint=true');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-blue-900 to-purple-900">
      <div className="text-white text-xl">Redirecting to mint...</div>
    </div>
  );
}
