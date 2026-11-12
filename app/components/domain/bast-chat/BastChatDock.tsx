'use client';

import * as React from 'react';
import { MessageSquare, ChevronDown } from 'lucide-react';
import { BastChatPanel } from './BastChatPanel';
import { cardFromInput, type OpenCardInput } from './card-context';
import { useBastChat } from '@/lib/hooks/use-bast-chat';

export const BAST_DOCK_OPEN_KEY = 'citadel-bast-chat-dock';
/** At this width and above the open panel makes room for itself, so it never sits over the list or the card. */
const ROOM_MIN_WIDTH = 1400;
const PANEL_WIDTH = 380;

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

/** Renders nothing when the chat throws: the home screen must never feel a failing chat. */
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Deliberately silent.
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface BastChatDockProps {
  /** The card that is open on the home screen right now, or null. */
  card: OpenCardInput | null;
  /** A number that goes up each time something on the screen asks the panel to open (Triage's Talk about this). */
  openSignal?: number;
}

/**
 * Bast chat: a small button at the bottom right that opens a panel. Mounted inside the home screen. It renders
 * nothing unless the server says this person is the owner and the chat is on (the server checks on every call;
 * this is not the access control).
 */
export function BastChatDock(props: BastChatDockProps) {
  return (
    <Boundary>
      <DockInner {...props} />
    </Boundary>
  );
}

function DockInner({ card: cardInput, openSignal = 0 }: BastChatDockProps) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (read(BAST_DOCK_OPEN_KEY) === 'open') setOpen(true);
  }, []);
  const chat = useBastChat({ open });
  const focusButton = React.useRef(false);
  const focusInput = React.useRef(false);
  // Something on the screen asked for the panel (Talk about this). The first value is the page loading, not a request.
  const lastSignal = React.useRef(openSignal);
  React.useEffect(() => {
    if (openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    focusInput.current = true;
    setOpen(true);
    write(BAST_DOCK_OPEN_KEY, 'open');
  }, [openSignal]);

  const [draft, setDraft] = React.useState('');
  const card = React.useMemo(() => cardFromInput(cardInput), [cardInput]);
  const cardKey = card?.key ?? null;
  // Dropping the "About" line lasts until another card opens.
  const [dropped, setDropped] = React.useState<string | null>(null);
  const aboutDropped = cardKey !== null && dropped === cardKey;
  React.useEffect(() => {
    if (dropped !== null && dropped !== cardKey) setDropped(null);
  }, [cardKey, dropped]);

  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const setOpenPersist = React.useCallback((next: boolean) => {
    setOpen(next);
    write(BAST_DOCK_OPEN_KEY, next ? 'open' : 'closed');
  }, []);
  const close = React.useCallback(() => {
    focusButton.current = true;
    setOpenPersist(false);
  }, [setOpenPersist]);

  React.useEffect(() => {
    if (!open && focusButton.current) {
      focusButton.current = false;
      buttonRef.current?.focus();
    }
    if (open && focusInput.current) {
      focusInput.current = false;
      panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }
  }, [open]);

  // Unread: Bast answers that arrived while the panel was shut.
  const [seen, setSeen] = React.useState<number | null>(null);
  const last = chat.lastAssistantSeq;
  React.useEffect(() => {
    if (chat.availability !== 'available') return;
    if (seen === null || (open && last > seen)) setSeen(last);
  }, [chat.availability, open, last, seen]);
  const unread = !open && seen !== null && last > seen ? 1 : 0;

  // On wide screens the open panel takes a strip of the home screen's right edge, so nothing is covered.
  const available = chat.availability === 'available';
  React.useEffect(() => {
    const host = buttonRef.current?.closest<HTMLElement>('[data-home]');
    if (!host) return;
    const apply = () => {
      const wide = typeof window !== 'undefined' && window.innerWidth >= ROOM_MIN_WIDTH;
      host.style.paddingRight = available && open && wide ? `${PANEL_WIDTH + 24}px` : '';
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      host.style.paddingRight = '';
    };
  }, [available, open]);

  if (chat.availability !== 'available') return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="bast-chat-button"
        className="home-btn"
        data-filled="true"
        aria-expanded={open}
        aria-controls="bast-chat-region"
        aria-label={unread > 0 ? 'Ask Bast, new answer' : 'Ask Bast'}
        onClick={() => {
          focusInput.current = true;
          setOpenPersist(true);
        }}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 30,
          gap: 8,
          borderRadius: 999,
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          display: open ? 'none' : 'inline-flex',
        }}
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Ask Bast
        {unread > 0 ? <span data-testid="bast-chat-unread" aria-hidden="true">{'•'}</span> : null}
      </button>
      <div
        id="bast-chat-region"
        ref={panelRef}
        role="region"
        aria-label="Chat with Bast"
        data-testid="bast-chat-dock"
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            close();
          }
        }}
        className="bast-chat-dock"
        style={{
          position: 'fixed',
          zIndex: 30,
          bottom: 0,
          right: 0,
          left: 0,
          width: '100%',
          height: '80vh',
          maxHeight: '80vh',
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 8,
          padding: 12,
          boxSizing: 'border-box',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          boxShadow: '0 8px 30px rgba(0,0,0,0.22)',
        }}
      >
        <style>{`@media (min-width: 640px) { .bast-chat-dock { left: auto !important; right: 16px !important; bottom: 16px !important; width: min(${PANEL_WIDTH}px, calc(100vw - 32px)) !important; height: min(640px, calc(100vh - 32px)) !important; border-radius: 12px !important; } }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '0.95rem' }}>Bast</h2>
          <button type="button" className="home-btn" onClick={close} aria-label="Close chat" title="Close (Esc)" style={{ minHeight: 32, padding: '4px 8px' }}>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <BastChatPanel
          chat={chat}
          card={card}
          aboutDropped={aboutDropped}
          onDropAbout={() => setDropped(cardKey)}
          draft={draft}
          setDraft={setDraft}
        />
      </div>
    </>
  );
}
