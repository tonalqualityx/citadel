'use client';

import { TimerProvider } from '@/lib/contexts/timer-context';
import { ThemeProvider } from './ThemeProvider';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TimerProvider>{children}</TimerProvider>
    </ThemeProvider>
  );
}
