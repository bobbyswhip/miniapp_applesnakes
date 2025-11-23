'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EthGlobalPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to main page with fastTravelPrediction query parameter
    router.replace('/?fastTravelPrediction=true');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-purple-900 to-indigo-900">
      <div className="text-white text-xl">Redirecting to Prediction Market...</div>
    </div>
  );
}
