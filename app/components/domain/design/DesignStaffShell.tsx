'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppProviders } from '@/components/layout/app-providers';
import { cn } from '@/lib/utils/cn';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { isWorkspaceRoute, useTopHidden } from './workspace-chrome';

// The normal Citadel chrome, same as app/(app)/layout.tsx, for admin, pm and tech on /design. Kept in its own module so
// the designer path of app/(design)/layout.tsx never reaches AppProviders for a designer session (a designer is
// 403 on the routes its ThemeProvider, TimerProvider, Header and NotificationBell call).

export const SIDEBAR_KEY = 'citadel-design-workspace-sidebar';
// Re-exported so existing imports keep working; the definition lives in workspace-chrome.ts.
export { isWorkspaceRoute };

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
  const [topHidden] = useTopHidden();
  const hideTop = workspace && topHidden;
  // null = no saved choice: collapsed on the workspace page, open everywhere else.
  const [choice, setChoice] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setChoice(readChoice());
  }, []);
  const open = !workspace || (choice ?? false);
  // Hiding the top collapses the sidebar for now without touching the saved choice.
  const sidebarOpen = open && !hideTop;

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
      {/* On the workspace route the page is exactly the viewport tall and never scrolls; the preview scrolls itself. */}
      <div className={workspace ? 'h-dvh overflow-hidden bg-background-light' : 'min-h-screen bg-background-light'}>
        <Sidebar collapsed={!sidebarOpen} />
        <div className={cn(workspace && 'flex h-dvh min-h-0 flex-col', sidebarOpen && 'lg:pl-60')}>
          {/* Header stays mounted when hidden: it hosts console capture and modals. */}
          <div className={workspace ? 'shrink-0' : 'contents'} hidden={hideTop} data-testid="staff-header-wrap">
            <Header />
          </div>
          <main className={workspace ? 'flex min-h-0 flex-1 flex-col p-3' : 'p-6'}>
            {workspace && (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
                title={open ? 'Hide sidebar' : 'Show sidebar'}
                data-testid="sidebar-toggle"
                hidden={hideTop}
                className="mb-2 hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-warm bg-surface text-text-sub hover:text-text-main lg:inline-flex"
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
