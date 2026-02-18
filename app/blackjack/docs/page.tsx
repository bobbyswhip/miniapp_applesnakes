'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect old /blackjack/docs to main /docs page
export default function BlackjackDocsRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to main docs page - the PredictionJack section is now part of main docs
    router.replace('/docs');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#171e1d] flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">🃏</div>
        <p className="text-[#8a9090]">Redirecting to docs...</p>
      </div>
    </div>
  );
}
