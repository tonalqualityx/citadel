'use client';

import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { BastChatProvider, BastChatSplitColumn, useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { cn } from '@/lib/utils/cn';

/**
 * The staff shell. For a user whose home_view is 'home' the sidebar is folded behind a Menu button
 * and the bell is gone. While preferences load, or if they fail, the chrome is exactly today's.
 *
 * The Bast chat lives here so the conversation survives page changes. Closed, the page scrolls in the window as ever.
 * Open on a wide landscape screen (split), the shell is exactly one screen tall: the page scrolls in the left column
 * and the chat in the right one. The element tree is the same in every state, so opening and closing never remounts a page.
 */
/** The split's columns: the page takes what is left, the chat a clamped strip. */
export const SPLIT_COLUMNS = 'minmax(0, 1fr) clamp(360px, 34vw, 480px)';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <BastChatProvider>
      <AppShellInner>{children}</AppShellInner>
    </BastChatProvider>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const { data } = usePreferences();
  const home = data?.preferences?.home_view === 'home';
  const { mode, columnRef } = useBastChatShell();
  const split = mode === 'split';

  return (
    <div
      className="min-h-screen bg-background-light"
      data-shell-mode={mode}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', ...(split ? { height: '100dvh', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } : {}) }}
    >
      <Sidebar collapsed={home} />
      <div
        className={cn(!home && 'lg:pl-60', split && '[&>header]:col-span-full')}
        data-testid="shell-body"
        data-columns={split ? SPLIT_COLUMNS : undefined}
        style={
          split
            ? { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: SPLIT_COLUMNS, gridTemplateRows: 'auto minmax(0, 1fr)' }
            : undefined
        }
      >
        <Header homeChrome={home} />
        <main
          ref={columnRef}
          className="p-6"
          style={split ? { minWidth: 0, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' } : undefined}
        >
          {children}
        </main>
        <BastChatSplitColumn />
      </div>
      <CommandPalette />
    </div>
  );
}
