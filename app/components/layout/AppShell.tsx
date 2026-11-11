'use client';

import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { cn } from '@/lib/utils/cn';

/**
 * The staff shell. For a user whose home_view is 'home' the sidebar is folded behind a Menu button
 * and the bell is gone. While preferences load, or if they fail, the chrome is exactly today's.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { data } = usePreferences();
  const home = data?.preferences?.home_view === 'home';

  return (
    <div className="min-h-screen bg-background-light">
      <Sidebar collapsed={home} />
      <div className={cn(!home && 'lg:pl-60')}>
        <Header homeChrome={home} />
        <main className="p-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
