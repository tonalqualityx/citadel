'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { MessageSquare, ChevronLeft, X, Plus } from 'lucide-react';
import '@/components/domain/home/home-tokens.css';
import { BastChatPanel } from './BastChatPanel';
import { cardFromInput, type OpenCardInput } from './card-context';
import { COARSE_QUERY, SPLIT_QUERY, useMediaQuery } from './use-media-query';
import { useBastChat, type UseBastChat } from '@/lib/hooks/use-bast-chat';
import { computeSheetBox, useVisualViewport } from '@/lib/hooks/use-visual-viewport';

export const BAST_DOCK_OPEN_KEY = 'citadel-bast-chat-dock';
/** closed: nothing shown. full: a full-screen sheet (phone, portrait tablet). split: a column beside the page. */
export type ChatMode = 'closed' | 'full' | 'split';

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

/** Renders nothing when the chat throws: the shell must never feel a failing chat. */
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

interface CardChat {
  task_id: string;
  title: string;
  /** Opened because the page shows that card (leaves again when the page does); not because he tapped Talk about this. */
  bound: boolean;
}

export interface BastChatShell {
  /** The chat is on and this person may use it. False means nothing chat-shaped is drawn anywhere. */
  available: boolean;
  /** Some page on screen offers the chat (the Ask Bast button shows only then). */
  offered: boolean;
  open: boolean;
  mode: ChatMode;
  openChat: () => void;
  closeChat: () => void;
  /** Talk about this: opens the chat in place. One card (a task id) gets its own conversation; anything else uses the general chat. */
  talkAbout: (card: OpenCardInput, opts?: { bindToPage?: boolean }) => void;
  /** Used by usePageBastChat. */
  offer: () => void;
  setPageCard: (card: OpenCardInput | null) => void;
  /** The element that scrolls the page while the split is open (AppShell's main). */
  columnRef: React.RefObject<HTMLElement | null>;
}

const noop = () => {};
const OFF: BastChatShell = {
  available: false,
  offered: false,
  open: false,
  mode: 'closed',
  openChat: noop,
  closeChat: noop,
  talkAbout: noop,
  offer: noop,
  setPageCard: noop,
  columnRef: { current: null },
};

const ShellContext = React.createContext<BastChatShell>(OFF);
const ViewContext = React.createContext<ViewState | null>(null);

/** The chat shell (open state, mode, talkAbout). Outside a provider it is inert, so pages and tests render without one. */
export function useBastChatShell(): BastChatShell {
  return React.useContext(ShellContext);
}

/**
 * A page that offers the chat says so here, and says which card is open (for the "About" line). The Ask Bast button
 * shows only while such a page is on screen. Pass null for "offered, no card".
 */
export function usePageBastChat(card: OpenCardInput | null): void {
  const { offer, setPageCard } = useBastChatShell();
  React.useEffect(() => {
    offer();
  }, [offer]);
  const key = card?.key ?? null;
  const title = card?.title ?? null;
  const type = card?.type ?? null;
  const taskId = card?.task_id ?? null;
  const tile = card?.tile ?? null;
  const own = card?.own_conversation === true;
  React.useEffect(() => {
    setPageCard(key && title ? { key, title, ...(type ? { type } : {}), task_id: taskId, ...(tile ? { tile } : {}), ...(own ? { own_conversation: true } : {}) } : null);
    return () => setPageCard(null);
  }, [key, title, type, taskId, tile, own, setPageCard]);
}

interface ViewState {
  chat: UseBastChat;
  card: ReturnType<typeof cardFromInput>;
  cardChatTitle: string | null;
  onLeaveCardChat: () => void;
  aboutDropped: boolean;
  onDropAbout: () => void;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  touch: boolean;
  title: string;
}

function lockBody(y: number) {
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${y}px`;
  b.left = '0';
  b.right = '0';
  b.width = '100%';
}
function unlockBody() {
  const b = document.body.style;
  b.position = '';
  b.top = '';
  b.left = '';
  b.right = '';
  b.width = '';
}
function scrollWindow(y: number) {
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    // jsdom and very old browsers: nothing to restore
  }
}

export function BastChatProvider({ children }: { children: React.ReactNode }) {
  const [offered, setOffered] = React.useState(false);
  const [pageCardInput, setPageCardInput] = React.useState<OpenCardInput | null>(null);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [cardChat, setCardChat] = React.useState<CardChat | null>(null);
  const split = useMediaQuery(SPLIT_QUERY);
  const touch = useMediaQuery(COARSE_QUERY);
  const chat = useBastChat({ open, enabled: offered });
  const available = chat.availability === 'available';
  const mode: ChatMode = open && available ? (split ? 'split' : 'full') : 'closed';
  const columnRef = React.useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const focusLauncher = React.useRef(false);
  const focusInput = React.useRef(false);

  // The first page that offers the chat restores a split left open; a phone never reopens by itself.
  const restored = React.useRef(false);
  React.useEffect(() => {
    if (!offered || restored.current) return;
    restored.current = true;
    if (read(BAST_DOCK_OPEN_KEY) === 'open' && window.matchMedia?.(SPLIT_QUERY).matches) setOpen(true);
  }, [offered]);

  const pageY = React.useRef(0);
  const prevMode = React.useRef<ChatMode>('closed');
  const setOpenPersist = React.useCallback(
    (next: boolean) => {
      // Read where the page is before anything changes: a split makes the document too short to keep its scroll position.
      if (next && prevMode.current === 'closed') pageY.current = window.scrollY;
      setOpen(next);
      if (next || split) write(BAST_DOCK_OPEN_KEY, next ? 'open' : 'closed');
    },
    [split],
  );
  const openChat = React.useCallback(() => {
    if (!(typeof window !== 'undefined' && window.matchMedia?.(COARSE_QUERY).matches)) focusInput.current = true;
    setOpenPersist(true);
  }, [setOpenPersist]);
  const closeChat = React.useCallback(() => {
    focusLauncher.current = true;
    setOpenPersist(false);
  }, [setOpenPersist]);

  // ---- history: one entry while the full-screen sheet is up, so Back and the Android back button close it ----
  const pushed = React.useRef(false);
  const suppressPop = React.useRef(0);
  React.useEffect(() => {
    const wantEntry = mode === 'full';
    if (wantEntry && !pushed.current) {
      try {
        window.history.pushState({ ...(window.history.state ?? {}), bastChat: true }, '', window.location.href);
        pushed.current = true;
      } catch {
        // no history API: Back leaves the page, the button still closes
      }
    } else if (!wantEntry && pushed.current) {
      // Closed by the button (or the screen turned into a split): take our own entry off again, so no stray one is left.
      pushed.current = false;
      suppressPop.current += 1;
      window.history.back();
    }
  }, [mode]);
  // Going back through history can make the router scroll the page to the top; put the page back where it was.
  const restoreSoon = React.useCallback(() => {
    for (const ms of [0, 80, 250]) {
      setTimeout(() => {
        if (prevMode.current === 'closed') scrollWindow(pageY.current);
      }, ms);
    }
  }, []);
  React.useEffect(() => {
    const onPop = () => {
      if (suppressPop.current > 0) {
        suppressPop.current -= 1;
        restoreSoon();
        return;
      }
      if (pushed.current) {
        pushed.current = false;
        focusLauncher.current = true;
        setOpen(false);
        restoreSoon();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [restoreSoon]);
  // Following a link inside the chat to another page closes the sheet; the history entry stays where the link left it.
  const lastPath = React.useRef(pathname);
  React.useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (pushed.current) {
      pushed.current = false;
      setOpen(false);
    }
  }, [pathname]);

  // ---- scroll: the page scrolls in the window while the chat is closed; the sheet locks it, the split moves it into the column ----
  React.useEffect(() => {
    const onWindow = () => {
      if (prevMode.current === 'closed') pageY.current = window.scrollY;
    };
    const onColumn = () => {
      if (prevMode.current === 'split' && columnRef.current) pageY.current = columnRef.current.scrollTop;
    };
    window.addEventListener('scroll', onWindow, { passive: true });
    const col = mode === 'split' ? columnRef.current : null;
    col?.addEventListener('scroll', onColumn, { passive: true });
    return () => {
      window.removeEventListener('scroll', onWindow);
      col?.removeEventListener('scroll', onColumn);
    };
  }, [mode]);
  React.useLayoutEffect(() => {
    const prev = prevMode.current;
    if (prev === mode) return;
    prevMode.current = mode;
    if (mode === 'full') lockBody(pageY.current);
    if (prev === 'full') unlockBody();
    if (mode === 'split') {
      if (columnRef.current) columnRef.current.scrollTop = pageY.current;
    } else if (mode === 'closed') {
      scrollWindow(pageY.current);
    }
  }, [mode]);
  React.useEffect(() => () => unlockBody(), []);

  // Escape closes the chat from anywhere (on a phone the focus is not in the box), unless a dialog or menu of the page is
  // open on top. defaultPrevented is not checked: layers elsewhere in the app cancel Escape in the capture phase.
  React.useEffect(() => {
    if (mode === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Closed Radix drawers stay in the page (data-state="closed"); only an open one counts.
      const other = document.querySelector(
        '[role="dialog"]:not([data-testid="bast-chat-sheet"]):not([data-state="closed"]):not([hidden]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"]), [role="listbox"]:not([data-state="closed"])',
      );
      if (other) return;
      e.preventDefault();
      closeChat();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, closeChat]);

  // ---- the open page's card, and the card whose own conversation is shown ----
  const lastCardChat = React.useRef(cardChat);
  React.useEffect(() => {
    lastCardChat.current = cardChat;
  });
  const chatRef = React.useRef(chat);
  React.useEffect(() => {
    chatRef.current = chat;
  });
  const talkAbout = React.useCallback(
    (card: OpenCardInput, opts?: { bindToPage?: boolean }) => {
      openChat();
      if (card.own_conversation && card.task_id) {
        setCardChat({ task_id: card.task_id, title: card.title, bound: opts?.bindToPage === true });
        void chatRef.current.openCardConversation(card.task_id);
      } else if (lastCardChat.current) {
        // A group or a general card: the chat is about that, not about the idea whose conversation was showing.
        setCardChat(null);
        void chatRef.current.leaveCardConversation();
      }
    },
    [openChat],
  );
  // Split view: showing a Triage card's page switches the right side to that card's conversation; leaving it returns to the general one.
  const pageCardId = pageCardInput?.own_conversation ? (pageCardInput.task_id ?? null) : null;
  const pageCardTitle = pageCardInput?.title ?? '';
  React.useEffect(() => {
    if (mode !== 'split') return;
    const current = lastCardChat.current;
    if (pageCardId) {
      if (current?.task_id !== pageCardId) {
        setCardChat({ task_id: pageCardId, title: pageCardTitle, bound: true });
        void chatRef.current.openCardConversation(pageCardId);
      }
    } else if (current?.bound) {
      setCardChat(null);
      void chatRef.current.leaveCardConversation();
    }
  }, [mode, pageCardId, pageCardTitle]);

  const inCardChat = cardChat !== null && chat.cardTaskId === cardChat.task_id;
  const card = React.useMemo(
    () =>
      cardFromInput(
        inCardChat && cardChat
          ? { key: `task:${cardChat.task_id}`, title: cardChat.title, type: 'task', task_id: cardChat.task_id, tile: 'triage' }
          : pageCardInput,
      ),
    [pageCardInput, inCardChat, cardChat],
  );
  const cardKey = card?.key ?? null;
  const [dropped, setDropped] = React.useState<string | null>(null);
  const aboutDropped = cardKey !== null && dropped === cardKey;
  React.useEffect(() => {
    if (dropped !== null && dropped !== cardKey) setDropped(null);
  }, [cardKey, dropped]);

  // Unread: Bast answers that arrived while the chat was shut.
  const [seen, setSeen] = React.useState<number | null>(null);
  const last = chat.lastAssistantSeq;
  React.useEffect(() => {
    if (chat.availability !== 'available') return;
    if (seen === null || (open && last > seen)) setSeen(last);
  }, [chat.availability, open, last, seen]);
  const unread = !open && seen !== null && last > seen;

  const shell = React.useMemo<BastChatShell>(
    () => ({
      available,
      offered,
      open: mode !== 'closed',
      mode,
      openChat,
      closeChat,
      talkAbout,
      offer: () => setOffered(true),
      setPageCard: setPageCardInput,
      columnRef,
    }),
    [available, offered, mode, openChat, closeChat, talkAbout],
  );

  const view = React.useMemo<ViewState>(
    () => ({
      chat,
      card,
      cardChatTitle: inCardChat && cardChat ? cardChat.title : null,
      onLeaveCardChat: () => {
        setCardChat(null);
        void chat.leaveCardConversation();
      },
      aboutDropped,
      onDropAbout: () => setDropped(cardKey),
      draft,
      setDraft,
      touch,
      title: inCardChat && cardChat ? cardChat.title : 'Bast',
    }),
    [chat, card, inCardChat, cardChat, aboutDropped, cardKey, draft, touch],
  );

  // Focus: the box when the chat opens (not on a phone, where that would raise the keyboard at once), the button when it closes.
  const launcherRef = React.useRef<HTMLButtonElement | null>(null);
  const surfaceRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (mode === 'closed' && focusLauncher.current) {
      focusLauncher.current = false;
      launcherRef.current?.focus();
    }
    if (mode !== 'closed' && focusInput.current) {
      focusInput.current = false;
      surfaceRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }
  }, [mode]);

  return (
    <ShellContext.Provider value={shell}>
      <ViewContext.Provider value={view}>
        {children}
        <Boundary>
          {available && offered ? <Launcher ref={launcherRef} unread={unread} hidden={mode !== 'closed'} onOpen={openChat} /> : null}
          {mode === 'full' ? <FullSheet onClose={closeChat} surfaceRef={surfaceRef} /> : null}
          {/* The split column is drawn by AppShell (it is a grid cell); it reports its element here for focus. */}
          <SurfaceRefBridge mode={mode} surfaceRef={surfaceRef} />
        </Boundary>
      </ViewContext.Provider>
    </ShellContext.Provider>
  );
}

function SurfaceRefBridge({ mode, surfaceRef }: { mode: ChatMode; surfaceRef: React.RefObject<HTMLElement | null> }) {
  React.useEffect(() => {
    if (mode === 'split') surfaceRef.current = document.querySelector<HTMLElement>('[data-testid="bast-chat-split"]');
  }, [mode, surfaceRef]);
  return null;
}

const Launcher = React.forwardRef<HTMLButtonElement, { unread: boolean; hidden: boolean; onOpen: () => void }>(function Launcher({ unread, hidden, onOpen }, ref) {
  return (
    <span data-home style={{ display: 'contents' }}>
      <button
        ref={ref}
        type="button"
        data-testid="bast-chat-button"
        className="home-btn"
        data-filled="true"
        aria-expanded={!hidden}
        aria-controls="bast-chat-region"
        aria-label={unread ? 'Ask Bast, new answer' : 'Ask Bast'}
        onClick={onOpen}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'max(16px, env(safe-area-inset-bottom))',
          zIndex: 30,
          gap: 8,
          borderRadius: 999,
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          display: hidden ? 'none' : 'inline-flex',
        }}
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Ask Bast
        {unread ? <span data-testid="bast-chat-unread" aria-hidden="true">{'•'}</span> : null}
      </button>
    </span>
  );
});

function ChatBody({ layout, onClose }: { layout: 'full' | 'split'; onClose: () => void }) {
  const v = React.useContext(ViewContext);
  if (!v) return null;
  return (
    <>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 48,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          className="home-btn"
          onClick={onClose}
          aria-label={layout === 'full' ? 'Back' : 'Close chat'}
          title={layout === 'full' ? 'Back (Esc)' : 'Close (Esc)'}
          style={{ minHeight: 40, minWidth: 40, padding: '4px 10px', gap: 4, border: 0, background: 'none' }}
        >
          {layout === 'full' ? (
            <>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              Back
            </>
          ) : (
            <X className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <h2
          data-testid="bast-chat-title"
          style={{ flex: 1, minWidth: 0, fontSize: '0.95rem', textAlign: layout === 'full' ? 'center' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {v.title}
        </h2>
        <button
          type="button"
          className="home-btn"
          onClick={() => void v.chat.newChat()}
          style={{ minHeight: 40, padding: '4px 10px', gap: 4, border: 0, background: 'none' }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New chat
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 12px 8px' }}>
        <BastChatPanel
          chat={v.chat}
          card={v.card}
          cardChatTitle={v.cardChatTitle}
          onLeaveCardChat={v.onLeaveCardChat}
          aboutDropped={v.aboutDropped}
          onDropAbout={v.onDropAbout}
          draft={v.draft}
          setDraft={v.setDraft}
          touch={v.touch}
        />
      </div>
    </>
  );
}

/** Phone and portrait tablet: the chat is the whole screen, above the sticky header, sized to what the keyboard leaves visible. */
function FullSheet({ onClose, surfaceRef }: { onClose: () => void; surfaceRef: React.MutableRefObject<HTMLElement | null> }) {
  const { box: vv, baseline } = useVisualViewport(true);
  const sheet = computeSheetBox(vv, typeof window === 'undefined' ? 0 : window.innerHeight, baseline);
  // Only ever rendered after the chat was opened in the browser, so document exists.
  return createPortal(
    <section
      id="bast-chat-region"
      ref={(el) => {
        surfaceRef.current = el;
      }}
      data-home
      data-testid="bast-chat-sheet"
      data-layout="full"
      data-keyboard={sheet.keyboardOpen ? 'open' : 'closed'}
      role="dialog"
      aria-modal="true"
      aria-label="Chat with Bast"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        margin: 0,
        height: sheet.height,
        transform: sheet.transform,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        boxSizing: 'border-box',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: sheet.keyboardOpen ? 0 : 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        overflow: 'hidden',
        overscrollBehavior: 'contain',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <ChatBody layout="full" onClose={onClose} />
    </section>,
    document.body,
  );
}

/** The right-hand column of the split. AppShell puts it in the grid; it scrolls on its own. */
export function BastChatSplitColumn() {
  const shell = useBastChatShell();
  const close = shell.closeChat;
  if (shell.mode !== 'split') return null;
  return (
    <Boundary>
      <aside
        id="bast-chat-region"
        data-home
        data-testid="bast-chat-split"
        data-layout="split"
        aria-label="Chat with Bast"
        style={{
          margin: 0,
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
          overscrollBehavior: 'contain',
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <ChatBody layout="split" onClose={close} />
      </aside>
    </Boundary>
  );
}
