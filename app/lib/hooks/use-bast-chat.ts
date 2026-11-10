'use client';

/**
 * The one place the Bast chat panel talks to the server (plan 2.1, Mike-side routes). Components never fetch.
 *
 * Why not apiClient: it throws away the HTTP status (the dock must tell 403/404 "not for you" from a real error)
 * and it sends the browser to /login on a 401 (a chat must never do that to the home screen). So this file has its
 * own small fetch that returns the status, refreshes the session once on a 401, and never throws.
 *
 * Routes and shapes this hook expects (all JSON, session cookie, same origin):
 *   GET  /api/bast-chat/status
 *        200 ChatStatus.  403 or 404: not enabled or not the owner; the dock then renders nothing.
 *   POST /api/bast-chat/conversations            {}
 *        201 {id} (also accepted: {conversation:{id}}).  Starts a new conversation (closes the current one).
 *   GET  /api/bast-chat/conversations/:id/feed?after=<seq>
 *        200 ChatFeed.  403 or 404: the status is read again.
 *   POST /api/bast-chat/conversations/:id/messages   {client_ref, text, context:{screen,tile?,kind,id?}}
 *        201 or 200 {seq}.  429 {error: "<plain sentence>"} on a daily cap.  Other failures {error}.
 *   POST /api/bast-chat/conversations/:id/stop       {}   2xx
 *   POST /api/bast-chat/actions/:id/undo | release | decline   {}
 *        2xx (body ignored; the next feed carries the new action state).  Failures {error: "<plain sentence>"}.
 * Titles and card text never travel: only the card's kind and id (card-context.tsx).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contextFor, type BastChatCard } from '@/components/domain/bast-chat/card-context';

export type ChatAuthState = 'token' | 'login' | 'failed';
export interface ChatWorker {
  online: boolean;
  paused: boolean;
  pause_reason?: string | null;
  auth_state?: ChatAuthState | null;
}
export interface ChatStatus {
  enabled: boolean;
  worker: ChatWorker;
  conversation_id: string | null;
  /** Highest seq of an assistant text message in the current conversation, for the unread count while collapsed. */
  last_assistant_seq?: number | null;
  usage?: { turns_left: number; writes_left: number; usd_left: number } | null;
}
export type ConversationStatus = 'idle' | 'queued' | 'running' | 'closed';
export interface ChatEvent {
  seq: number;
  role: 'mike' | 'assistant' | 'tool' | 'system';
  kind: 'text' | 'action' | 'result' | 'status' | 'cost';
  /** text events and status events carry {text}. */
  payload: { text?: string } & Record<string, unknown>;
  client_ref?: string | null;
  /** Mike's messages; superseded by ChatFeed.waiting when the feed sends it. */
  delivered?: boolean;
  expired?: boolean;
  created_at?: string;
}
export type ChatActionStatus = 'applied' | 'proposed' | 'released' | 'declined' | 'undone' | 'failed';
export interface ChatAction {
  id: string;
  tool: string;
  /** The one plain sentence Mike sees. */
  summary: string;
  status: ChatActionStatus;
  /** End of the undo window (ISO), for an applied write. */
  undo_until: string | null;
  /** Seq of the action event it belongs to; the line sits there in the timeline. */
  event_seq: number | null;
  /** For a proposal: who it would go to ("Bast", "Sabeen"). */
  proposed_assignee?: string | null;
}
export interface ChatFeed {
  conversation: { id: string; status: ConversationStatus };
  /** Events with seq greater than `after`, oldest first. */
  events: ChatEvent[];
  live_text: string | null;
  live_action: string | null;
  worker: ChatWorker;
  /** Every action of the conversation (applied, proposed, resolved), newest state. */
  actions: ChatAction[];
  /** Mike's messages whose state can still change: not delivered yet, or expired. Others are delivered. */
  waiting?: Array<{ seq: number; delivered: boolean; expired: boolean }>;
}

export type Availability = 'checking' | 'available' | 'unavailable';
export type MessageState = 'sent' | 'waiting' | 'expired';
export interface TimelineMessage {
  key: string;
  seq: number | null;
  role: 'mike' | 'assistant';
  text: string;
  state: MessageState;
  /** A Mike message that expired and has not been sent again from here. */
  canResend: boolean;
}
export type TimelineItem =
  | { type: 'message'; key: string; message: TimelineMessage }
  | { type: 'note'; key: string; text: string }
  | { type: 'action'; key: string; action: ChatAction };

export const OFFLINE_TEXT = "Bast's machine isn't answering right now. Your message will wait for 2 hours.";
export const PAUSED_TEXT = 'Bast chat is paused on the machine.';
export const SIGNED_OUT_TEXT = "Bast can't reach the model right now. The sign-in on the machine needs renewing.";
export const SEND_FAILED_TEXT = "That didn't send. Try again.";
export const ACTION_FAILED_TEXT = "That didn't go through. Nothing was changed.";
export const MAX_MESSAGE_CHARS = 4000;

const BASE = '/api/bast-chat';
const COLLAPSED_STATUS_MS = 60_000;
const OPEN_IDLE_MS = 10_000;
const BUSY_MS = 1_500;
const COLLAPSED_BUSY_MS = 5_000;

interface Reply<T> {
  status: number;
  ok: boolean;
  data: T | null;
}

async function rawFetch(method: string, path: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  } catch {
    return null;
  }
}

async function chatFetch<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  let res = await rawFetch(method, path, body);
  if (res && res.status === 401) {
    const refreshed = await (async () => {
      try {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        return r.ok;
      } catch {
        return false;
      }
    })();
    if (refreshed) res = await rawFetch(method, path, body);
  }
  if (!res) return { status: 0, ok: false, data: null };
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function errorSentence(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const e = (data as { error?: unknown }).error;
    if (typeof e === 'string' && e.trim() && e.length <= 300) return e.trim();
  }
  return fallback;
}

function newRef(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { id?: unknown; conversation?: { id?: unknown } };
  if (typeof d.id === 'string') return d.id;
  if (typeof d.conversation?.id === 'string') return d.conversation.id;
  return null;
}

/** Plain line for the machine's state, or null when it is fine. Order: signed out, paused, offline. */
export function workerNotice(worker: ChatWorker | null | undefined): string | null {
  if (!worker) return null;
  if (worker.auth_state === 'failed') return SIGNED_OUT_TEXT;
  if (worker.paused) return PAUSED_TEXT;
  if (!worker.online) return OFFLINE_TEXT;
  return null;
}

/** True while Mike's undo window for an applied action is open. */
export function undoOpen(action: ChatAction, now: number): boolean {
  if (action.status !== 'applied' || !action.undo_until) return false;
  const t = Date.parse(action.undo_until);
  return Number.isFinite(t) && t > now;
}

interface Pending {
  client_ref: string;
  text: string;
}

export interface UseBastChat {
  availability: Availability;
  worker: ChatWorker | null;
  notice: string | null;
  error: string | null;
  conversationStatus: ConversationStatus;
  /** Bast has a turn in flight (queued or running) and the machine is not reported offline. */
  working: boolean;
  liveText: string | null;
  liveAction: string | null;
  timeline: TimelineItem[];
  lastAssistantSeq: number;
  send: (text: string, card: BastChatCard | null) => Promise<boolean>;
  sendAgain: (item: TimelineMessage, card: BastChatCard | null) => Promise<boolean>;
  stop: () => Promise<void>;
  newChat: () => Promise<void>;
  actOn: (id: string, verb: 'undo' | 'release' | 'decline') => Promise<void>;
  actionError: (id: string) => string | null;
  actionBusy: (id: string) => boolean;
  now: number;
}

export function useBastChat({ open }: { open: boolean }): UseBastChat {
  const [availability, setAvailability] = useState<Availability>('checking');
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convStatus, setConvStatus] = useState<ConversationStatus>('idle');
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [actions, setActions] = useState<ChatAction[]>([]);
  const [liveText, setLiveText] = useState<string | null>(null);
  const [liveAction, setLiveAction] = useState<string | null>(null);
  const [feedWorker, setFeedWorker] = useState<ChatWorker | null>(null);
  const [waiting, setWaiting] = useState<Map<number, { delivered: boolean; expired: boolean }> | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [resent, setResent] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actionBusyIds, setActionBusyIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Refs so the poll loop always reads the latest values without restarting.
  const live = useRef({ open, conversationId, convStatus, pending: 0, maxSeq: 0, availability });
  useEffect(() => {
    live.current.open = open;
    live.current.conversationId = conversationId;
    live.current.convStatus = convStatus;
    live.current.pending = pending.length;
    live.current.availability = availability;
  });
  const inflight = useRef(false);

  const hide = useCallback(() => {
    live.current.availability = 'unavailable';
    setAvailability('unavailable');
  }, []);

  const resetConversation = useCallback((id: string | null) => {
    live.current.maxSeq = 0;
    live.current.conversationId = id;
    setConversationId(id);
    setEvents([]);
    setActions([]);
    setLiveText(null);
    setLiveAction(null);
    setWaiting(null);
    setPending([]);
    setResent([]);
    setConvStatus('idle');
  }, []);

  const readStatus = useCallback(async (): Promise<void> => {
    const r = await chatFetch<ChatStatus>('GET', '/status');
    if (r.status === 403 || r.status === 404) return hide();
    if (!r.ok || !r.data || r.data.enabled !== true) {
      // A server or network failure: stay quiet, try again on the slow cadence. Never show an error for it.
      if (r.ok && r.data && r.data.enabled === false) return hide();
      return;
    }
    setStatus(r.data);
    setAvailability('available');
    live.current.availability = 'available';
    const id = r.data.conversation_id ?? null;
    if (id && id !== live.current.conversationId) {
      live.current.conversationId = id;
      setConversationId(id);
    }
  }, [hide]);

  const readFeed = useCallback(async (): Promise<void> => {
    const id = live.current.conversationId;
    if (!id) return;
    const r = await chatFetch<ChatFeed>('GET', `/conversations/${encodeURIComponent(id)}/feed?after=${live.current.maxSeq}`);
    if (r.status === 403 || r.status === 404) {
      // Either the conversation is gone or the chat is not for this person: the status answers which.
      live.current.conversationId = null;
      setConversationId(null);
      await readStatus();
      return;
    }
    if (!r.ok || !r.data) return;
    const feed = r.data;
    setConvStatus(feed.conversation?.status ?? 'idle');
    setFeedWorker(feed.worker ?? null);
    setLiveText(feed.live_text ?? null);
    setLiveAction(feed.live_action ?? null);
    setActions(Array.isArray(feed.actions) ? feed.actions : []);
    if (Array.isArray(feed.waiting)) {
      setWaiting(new Map(feed.waiting.map((w) => [w.seq, { delivered: w.delivered, expired: w.expired }])));
    }
    if (Array.isArray(feed.events) && feed.events.length > 0) {
      const incoming = feed.events;
      live.current.maxSeq = Math.max(live.current.maxSeq, ...incoming.map((e) => e.seq));
      setEvents((prev) => {
        const map = new Map(prev.map((e) => [e.seq, e]));
        for (const e of incoming) map.set(e.seq, e);
        return [...map.values()].sort((a, b) => a.seq - b.seq);
      });
      const refs = new Set(incoming.map((e) => e.client_ref).filter((x): x is string => typeof x === 'string'));
      if (refs.size > 0) setPending((p) => p.filter((m) => !refs.has(m.client_ref)));
    }
  }, [readStatus]);

  const pollOnce = useCallback(async (): Promise<void> => {
    if (inflight.current || live.current.availability === 'unavailable') return;
    inflight.current = true;
    try {
      const l = live.current;
      const busy = l.convStatus === 'queued' || l.convStatus === 'running' || l.pending > 0;
      if (l.availability === 'checking' || !l.conversationId || (!l.open && !busy)) await readStatus();
      if ((live.current.availability as Availability) === 'unavailable') return;
      const l2 = live.current;
      const busy2 = l2.convStatus === 'queued' || l2.convStatus === 'running' || l2.pending > 0;
      if (l2.conversationId && (l2.open || busy2)) await readFeed();
    } finally {
      inflight.current = false;
    }
  }, [readFeed, readStatus]);

  // The poll loop: 1.5 s while a turn is in flight, 10 s while open and idle, 60 s (status only) while collapsed.
  const gone = availability === 'unavailable';
  useEffect(() => {
    if (gone) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isGone = () => (live.current.availability as Availability) === 'unavailable';
    const delay = () => {
      const l = live.current;
      const busy = l.convStatus === 'queued' || l.convStatus === 'running' || l.pending > 0;
      if (busy) return l.open ? BUSY_MS : COLLAPSED_BUSY_MS;
      return l.open ? OPEN_IDLE_MS : COLLAPSED_STATUS_MS;
    };
    const run = async () => {
      if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) await pollOnce();
      if (!stopped && !isGone()) timer = setTimeout(run, delay());
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [gone, pollOnce]);

  // Opening the panel reads the feed now instead of waiting out the slow cadence.
  useEffect(() => {
    if (open && availability === 'available') void pollOnce();
  }, [open, availability, pollOnce]);

  // A 15 s tick re-evaluates the undo windows.
  useEffect(() => {
    if (gone) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [gone]);

  const startConversation = useCallback(async (): Promise<string | null> => {
    const r = await chatFetch<{ id?: string; conversation?: { id?: string } }>('POST', '/conversations', {});
    if (r.status === 403 || r.status === 404) {
      hide();
      return null;
    }
    const id = r.ok ? idOf(r.data) : null;
    if (!id) {
      setError(errorSentence(r.data, SEND_FAILED_TEXT));
      return null;
    }
    resetConversation(id);
    return id;
  }, [hide, resetConversation]);

  const send = useCallback(
    async (text: string, card: BastChatCard | null): Promise<boolean> => {
      const t = text.trim();
      if (!t || t.length > MAX_MESSAGE_CHARS) return false;
      const ref = newRef();
      setError(null);
      setPending((p) => [...p, { client_ref: ref, text: t }]);
      live.current.pending += 1;
      const drop = () => setPending((p) => p.filter((m) => m.client_ref !== ref));
      let id = live.current.conversationId;
      if (!id || live.current.convStatus === 'closed') {
        id = await startConversation();
        // startConversation resets the pending list, so put this message back.
        if (id) setPending([{ client_ref: ref, text: t }]);
      }
      if (!id) {
        drop();
        return false;
      }
      const r = await chatFetch<{ seq?: number; error?: string }>('POST', `/conversations/${encodeURIComponent(id)}/messages`, {
        client_ref: ref,
        text: t,
        context: contextFor(card),
      });
      if (r.status === 403 || r.status === 404) {
        hide();
        return false;
      }
      if (!r.ok) {
        drop();
        // A 429 carries the plain cap sentence; any other failure gets the generic line unless the server sent one.
        setError(errorSentence(r.data, SEND_FAILED_TEXT));
        return false;
      }
      setConvStatus('queued');
      live.current.convStatus = 'queued';
      void pollOnce();
      return true;
    },
    [hide, pollOnce, startConversation],
  );

  const sendAgain = useCallback(
    async (item: TimelineMessage, card: BastChatCard | null): Promise<boolean> => {
      const ok = await send(item.text, card);
      if (ok && item.seq != null) setResent((r) => [...r, item.seq as number]);
      return ok;
    },
    [send],
  );

  const stop = useCallback(async () => {
    const id = live.current.conversationId;
    if (!id) return;
    const r = await chatFetch('POST', `/conversations/${encodeURIComponent(id)}/stop`, {});
    if (!r.ok) setError(errorSentence(r.data, ACTION_FAILED_TEXT));
    void pollOnce();
  }, [pollOnce]);

  const newChat = useCallback(async () => {
    setError(null);
    await startConversation();
  }, [startConversation]);

  const actOn = useCallback(
    async (id: string, verb: 'undo' | 'release' | 'decline') => {
      setActionBusyIds((b) => [...b, id]);
      setActionErrors((e) => {
        const { [id]: _drop, ...rest } = e;
        void _drop;
        return rest;
      });
      const r = await chatFetch('POST', `/actions/${encodeURIComponent(id)}/${verb}`, {});
      setActionBusyIds((b) => b.filter((x) => x !== id));
      if (r.status === 403 || r.status === 404) {
        // 404 on an action id is "not found", not "not for you": say so on the line, do not hide the dock.
        setActionErrors((e) => ({ ...e, [id]: ACTION_FAILED_TEXT }));
      } else if (!r.ok) {
        setActionErrors((e) => ({ ...e, [id]: errorSentence(r.data, ACTION_FAILED_TEXT) }));
      }
      void pollOnce();
    },
    [pollOnce],
  );

  const worker = feedWorker ?? status?.worker ?? null;
  const notice = workerNotice(worker);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: Array<{ order: number; item: TimelineItem }> = [];
    const actionBySeq = new Map<number, ChatAction[]>();
    const loose: ChatAction[] = [];
    for (const a of actions) {
      if (a.event_seq != null) actionBySeq.set(a.event_seq, [...(actionBySeq.get(a.event_seq) ?? []), a]);
      else loose.push(a);
    }
    const seqs = new Set(events.map((e) => e.seq));
    for (const e of events) {
      if (e.kind === 'text' && (e.role === 'mike' || e.role === 'assistant')) {
        const text = typeof e.payload?.text === 'string' ? e.payload.text : '';
        if (!text) continue;
        let state: MessageState = 'sent';
        if (e.role === 'mike') {
          const w = waiting ? waiting.get(e.seq) : undefined;
          const expired = waiting ? w?.expired === true : e.expired === true;
          const delivered = waiting ? (w ? w.delivered : true) : e.delivered !== false;
          state = expired ? 'expired' : delivered ? 'sent' : 'waiting';
        }
        items.push({
          order: e.seq,
          item: {
            type: 'message',
            key: `e${e.seq}`,
            message: { key: `e${e.seq}`, seq: e.seq, role: e.role, text, state, canResend: state === 'expired' && !resent.includes(e.seq) },
          },
        });
      } else if (e.kind === 'status' && typeof e.payload?.text === 'string' && e.payload.text) {
        items.push({ order: e.seq, item: { type: 'note', key: `e${e.seq}`, text: e.payload.text } });
      }
      for (const a of actionBySeq.get(e.seq) ?? []) items.push({ order: e.seq + 0.5, item: { type: 'action', key: `a${a.id}`, action: a } });
    }
    // Actions whose event is not loaded (or has no seq) still show, after what is loaded.
    for (const [seq, list] of actionBySeq) {
      if (seqs.has(seq)) continue;
      for (const a of list) items.push({ order: seq + 0.5, item: { type: 'action', key: `a${a.id}`, action: a } });
    }
    for (const a of loose) items.push({ order: Number.MAX_SAFE_INTEGER - 1, item: { type: 'action', key: `a${a.id}`, action: a } });
    items.sort((x, y) => x.order - y.order);
    const out = items.map((x) => x.item);
    for (const p of pending) {
      out.push({
        type: 'message',
        key: `p${p.client_ref}`,
        message: { key: `p${p.client_ref}`, seq: null, role: 'mike', text: p.text, state: 'sent', canResend: false },
      });
    }
    return out;
  }, [events, actions, waiting, pending, resent]);

  let lastAssistantSeq = status?.last_assistant_seq ?? 0;
  for (const e of events) if (e.role === 'assistant' && e.kind === 'text' && e.seq > lastAssistantSeq) lastAssistantSeq = e.seq;

  const inFlight = convStatus === 'queued' || convStatus === 'running' || pending.length > 0;
  return {
    availability,
    worker,
    notice,
    error,
    conversationStatus: convStatus,
    working: inFlight && notice === null,
    liveText,
    liveAction,
    timeline,
    lastAssistantSeq,
    send,
    sendAgain,
    stop,
    newChat,
    actOn,
    actionError: (id) => actionErrors[id] ?? null,
    actionBusy: (id) => actionBusyIds.includes(id),
    now,
  };
}
