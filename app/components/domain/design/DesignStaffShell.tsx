'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppProviders } from '@/components/layout/app-providers';
import { CommandPalette } from '@/components/layout/CommandPalette';

// The normal Citadel chrome, same as app/(app)/layout.tsx, for admin and pm on /design. Kept in its own module so
// the designer path of app/(design)/layout.tsx never reaches AppProviders for a designer session (a designer is
// 403 on the routes its ThemeProvider, TimerProvider, Header and NotificationBell call).

export const SIDEBAR_KEY = 'citadel-design-workspace-sidebar';
/** The workspace page (/design/s/:id), where the preview needs the room. Other /design pages keep the sidebar. */
export const isWorkspaceRoute = (pathname: string | null) => /^\/design\/s\/[^/]+/.test(pathname ?? '');

function readChoice(): boolean | null {
  try {
    const v = window.localStorage.getItem(SIDEBAR_KEY);
    return v === 'open' ? true : v === 'closed' ? false : null;
  } catch {
    return null;
  }
}

export function DesignStaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = isWorkspaceRoute(pathname);
  // null = no saved choice: collapsed on the workspace page, open everywhere else.
  const [choice, setChoice] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setChoice(readChoice());
  }, []);
  const open = !workspace || (choice ?? false);

  function toggle() {
    const next = !open;
    setChoice(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? 'open' : 'closed');
    } catch {
      // private window or blocked storage: the choice just lasts for this page
    }
  }

  return (
    <AppProviders>
      <div className="min-h-screen bg-background-light">
        <Sidebar collapsed={!open} />
        <div className={open ? 'lg:pl-60' : undefined}>
          <Header />
          <main className="p-6">
            {workspace && (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
                title={open ? 'Hide sidebar' : 'Show sidebar'}
                data-testid="sidebar-toggle"
                className="mb-2 hidden h-8 w-8 items-center justify-center rounded-md border border-border-warm bg-surface text-text-sub hover:text-text-main lg:inline-flex"
              >
                {open ? <PanelLeftClose className="h-4 w-4" aria-hidden="true" /> : <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
            {children}
          </main>
        </div>
        <CommandPalette />
      </div>
    </AppProviders>
  );
}
