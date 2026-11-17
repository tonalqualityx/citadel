'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { DesignChrome } from './DesignChrome';
import { isWorkspaceRoute, useTopHidden } from './workspace-chrome';

// The minimal designer shell: DesignChrome + main, deliberately NOT AppProviders (see app/(design)/layout.tsx).
// On the workspace route the page is exactly the viewport tall and never scrolls; the preview scrolls itself.

export function DesignerShell({ role, children }: { role: string | null; children: React.ReactNode }) {
  const workspace = isWorkspaceRoute(usePathname());
  const [topHidden] = useTopHidden();
  const hideTop = workspace && topHidden;
  return (
    <div className={workspace ? 'flex h-dvh flex-col overflow-hidden bg-background-light text-text-main' : 'min-h-screen bg-background-light text-text-main'}>
      {/* Stays mounted when hidden, so the chrome keeps its state. `contents` off the workspace keeps the sticky header as it was. */}
      <div className={workspace ? 'shrink-0' : 'contents'} hidden={hideTop} data-testid="designer-header-wrap">
        <DesignChrome role={role} />
      </div>
      <main className={cn('mx-auto max-w-[1800px]', workspace ? 'flex min-h-0 w-full flex-1 flex-col p-2 sm:p-3' : 'p-4 sm:p-6')}>{children}</main>
    </div>
  );
}
