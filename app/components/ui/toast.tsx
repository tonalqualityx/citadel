'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * Toast Toaster component using sonner
 * Respects Indelible theme system (light/dim/dark)
 *
 * Usage: Add <Toaster /> once in app layout
 * Then use toast() from 'sonner' anywhere in the app
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      expand={false}
      closeButton
      toastOptions={{
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          fontFamily: 'var(--font-sans)',
        },
        classNames: {
          toast: 'shadow-md',
          title: 'font-medium',
          description: 'text-sm opacity-80',
        },
      }}
      // Custom theme styles using CSS variables
      // richColors is disabled so we can control colors via CSS vars
    />
  );
}

// Re-export toast function for convenience
export { toast } from 'sonner';
