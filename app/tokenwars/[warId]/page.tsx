'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Token Wars Share URL Redirect
 *
 * This page handles direct links to specific wars (e.g., shared on social media).
 * It redirects to the main app with query params to auto-open the Trading tab
 * and select the specified war.
 *
 * URL: /tokenwars/{warId}
 * Redirects to: /?tab=trading&view=launch&war={warId}
 */
export default function TokenWarRedirect() {
  const params = useParams();
  const router = useRouter();
  const warId = params.warId as string;

  useEffect(() => {
    // Redirect to main app with query params to auto-open the war
    router.replace(`/?tab=trading&view=launch&war=${warId}`);
  }, [router, warId]);

  // Show loading while redirecting
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#171e1d]">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[rgba(255,208,117,0.2)] border-t-[#ffd075] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#8a9090]">Opening Token Wars...</p>
      </div>
    </main>
  );
}
