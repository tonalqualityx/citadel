'use client';

import { TimerProvider } from '@/lib/contexts/timer-context';
import { ThemeProvider } from './ThemeProvider';
import { Toaster } from '@/components/ui/toast';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TimerProvider>
        {children}
        <Toaster />
      </TimerProvider>
    </ThemeProvider>
  );
}
