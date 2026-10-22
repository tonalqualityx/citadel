'use client';

import { useEffect } from 'react';
import { isChunkError, reloadOnceForChunkError } from '@/lib/chunk-recovery';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkError(error);

  useEffect(() => {
    if (chunk) reloadOnceForChunkError();
  }, [chunk]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem 1.5rem', textAlign: 'center' }}>
        {chunk ? (
          <p>A newer version of Citadel is loading.</p>
        ) : (
          <>
            <h1 style={{ fontSize: '1.25rem' }}>Something went wrong</h1>
            <p>An unexpected error occurred.</p>
            <button type="button" onClick={() => reset()}>Try again</button>
          </>
        )}
      </body>
    </html>
  );
}
