'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface CollapsibleGroupProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

// Sidebar's CollapsibleSection pattern, reused for the Workflows / Crons / Recently
// ended groups (mobile stack order: Waiting, Running, then these three collapsed).
export function CollapsibleGroup({
  title,
  count,
  defaultOpen = false,
  children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ui-monospace flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-xs font-bold uppercase tracking-wide text-text-sub hover:bg-background-light/50"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        {title} ({count})
      </button>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}
