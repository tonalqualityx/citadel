'use client';

import * as React from 'react';
import { MessageSquare, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';

export const DOCK_OPEN_KEY = 'citadel-design-chat-dock';
export const DOCK_WIDE_KEY = 'citadel-design-chat-wide';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private window or blocked storage: the choice just lasts for this page
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** Highest seq among assistant text messages, and how many are above `seen`. */
export function assistantMessageStats(events: ReadonlyArray<{ seq: number; role: string; kind: string }> | undefined, seen: number | null): { max: number; unread: number } {
  let max = 0;
  let unread = 0;
  for (const e of events ?? []) {
    if (e.role === 'designer' || e.kind !== 'text') continue;
    if (e.seq > max) max = e.seq;
    if (seen != null && e.seq > seen) unread += 1;
  }
  return { max, unread };
}

export interface ChatDockProps {
  children: React.ReactNode;
  /** Feed events (any order); new assistant messages while collapsed become the unread count. */
  events?: ReadonlyArray<{ seq: number; role: string; kind: string }>;
  /** The worker is doing something: shows a spinner on the pill. */
  busy?: boolean;
  /** Number of selections on the preview; a new one expands the panel so the chip is visible. */
  selectionCount?: number;
  /** Select mode owns the keyboard (S, Esc): the C shortcut stands down. */
  selectMode?: boolean;
}

/**
 * The chat as a floating panel docked bottom-right over the preview (a bottom sheet under 1100px), collapsible to a
 * "Chat" pill. Open/closed and Wide are remembered per browser. Stays mounted while collapsed so a draft survives.
 */
export function ChatDock({ children, events, busy = false, selectionCount = 0, selectMode = false }: ChatDockProps) {
  const [open, setOpen] = React.useState(true);
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    if (read(DOCK_OPEN_KEY) === 'closed') setOpen(false);
    if (read(DOCK_WIDE_KEY) === 'wide') setWide(true);
  }, []);

  // Unread: assistant messages above the highest seq seen while the panel was open.
  const { max } = assistantMessageStats(events, null);
  const [seen, setSeen] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (seen === null) {
      if (max > 0 || (events && events.length > 0)) setSeen(max);
      return;
    }
    if (open && max > seen) setSeen(max);
  }, [open, max, seen, events]);
  const unreadCount = open ? 0 : assistantMessageStats(events, seen).unread;

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const pillRef = React.useRef<HTMLButtonElement | null>(null);
  const focusPill = React.useRef(false);

  const setOpenPersist = React.useCallback((next: boolean) => {
    setOpen(next);
    write(DOCK_OPEN_KEY, next ? 'open' : 'closed');
  }, []);
  const collapse = React.useCallback((andFocus = false) => {
    focusPill.current = andFocus;
    setOpenPersist(false);
  }, [setOpenPersist]);

  React.useEffect(() => {
    if (!open && focusPill.current) {
      focusPill.current = false;
      pillRef.current?.focus();
    }
  }, [open]);

  // A new selection expands the panel (not remembered) so the chip and composer are in front of the designer.
  const lastSelection = React.useRef(selectionCount);
  React.useEffect(() => {
    if (selectionCount > lastSelection.current) setOpen(true);
    lastSelection.current = selectionCount;
  }, [selectionCount]);

  const live = React.useRef({ open, selectMode });
  React.useEffect(() => {
    live.current = { open, selectMode };
  });
  // C toggles. Not while typing, with a modifier, or in Select mode.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      if (e.key !== 'c' && e.key !== 'C') return;
      if (live.current.selectMode) return;
      e.preventDefault();
      if (live.current.open) collapse(false);
      else setOpenPersist(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapse, setOpenPersist]);

  function toggleWide() {
    const next = !wide;
    setWide(next);
    write(DOCK_WIDE_KEY, next ? 'wide' : 'narrow');
  }

  const place = 'fixed inset-x-0 bottom-0 min-[1100px]:absolute min-[1100px]:inset-x-auto min-[1100px]:bottom-4 min-[1100px]:right-4';

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        data-testid="chat-pill"
        onClick={() => setOpenPersist(true)}
        aria-label={unreadCount > 0 ? `Chat, ${unreadCount} new` : 'Chat'}
        title="Open the chat (C)"
        className={cn(
          'z-30 items-center gap-2 rounded-full border border-border-warm bg-surface px-4 py-2 text-sm font-medium text-text-main shadow-lg hover:bg-background-light',
          'fixed bottom-4 right-4 min-[1100px]:absolute',
          open ? 'hidden' : 'inline-flex',
        )}
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Chat
        {unreadCount > 0 && (
          <span data-testid="chat-unread" className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-white">{unreadCount}</span>
        )}
        {busy && <span data-testid="chat-busy" role="status" aria-label="The design worker is working"><Spinner /></span>}
      </button>
      <div
        ref={panelRef}
        role="region"
        aria-label="Session panels"
        data-testid="chat-dock"
        data-wide={wide ? 'true' : 'false'}
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented && panelRef.current?.contains(e.target as Node)) {
            e.preventDefault();
            collapse(true);
          }
        }}
        className={cn(
          place,
          'z-30 flex-col overflow-hidden border border-border-warm bg-surface shadow-2xl',
          'max-h-[70vh] min-[1100px]:max-h-[70%] min-[1100px]:h-[70%] min-[1100px]:min-h-[420px]',
          'rounded-t-xl min-[1100px]:rounded-xl',
          wide ? 'min-[1100px]:w-[640px]' : 'min-[1100px]:w-[460px]',
          'min-[1100px]:max-w-[calc(100%-2rem)]',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center justify-end gap-1 border-b border-border-warm px-2 py-1">
          <button
            type="button"
            onClick={toggleWide}
            aria-pressed={wide}
            title="Wider panel for reading changes"
            className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-text-sub hover:bg-background-light hover:text-text-main min-[1100px]:inline-flex"
          >
            {wide ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Wide
          </button>
          <button
            type="button"
            onClick={() => collapse(true)}
            aria-label="Collapse chat"
            title="Collapse (Esc or C)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-sub hover:bg-background-light hover:text-text-main"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </>
  );
}
