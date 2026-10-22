'use client';

import { useEffect } from 'react';
import { isChunkError, reloadOnceForChunkError } from '@/lib/chunk-recovery';

/** Mounted in the root layout: reloads once when a stale tab fails to load a chunk from a newer build. */
export function ChunkRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkError(event.error) || isChunkError(event.message)) reloadOnceForChunkError();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkError(event.reason)) reloadOnceForChunkError();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
