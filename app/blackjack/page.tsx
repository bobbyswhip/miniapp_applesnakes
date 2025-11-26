'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function BlackjackRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const gameId = searchParams.get('id');

    // Redirect to main page with fastTravelPrediction and optional gameId
    if (gameId) {
      router.replace(`/?fastTravelPrediction=true&gameId=${gameId}`);
    } else {
      router.replace('/?fastTravelPrediction=true');
    }
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-purple-900 to-indigo-900">
      <div className="text-white text-xl">Redirecting to Blackjack...</div>
    </div>
  );
}

export default function BlackjackPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-purple-900 to-indigo-900">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <BlackjackRedirect />
    </Suspense>
  );
}
