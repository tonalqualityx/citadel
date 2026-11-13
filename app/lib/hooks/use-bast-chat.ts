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
 *   POST /api/bast-chat/conversations            {task_id}
 *        201 or 200 {id, reopened}.  Opens (or reopens) the conversation about one card; closes nothing.
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
  /** Version 2 fields. Every one is optional: an older feed does not send them and the panel still works. */
  target_type?: string | null;
  proposal_kind?: string | null;
  can_undo?: boolean;
  /** The tap card of a proposal, kept on the row after it is resolved. */
  card?: ProposalCard | null;
  /** For a failed proposal: the server's plain refusal. */
  error?: string | null;
}

export type CardKind = 'bast_start' | 'bast_resteer' | 'client_show';
/** One task the session would read, as the server cut it. */
export interface CardRead {
  task_id?: string;
  title: string;
  status?: string | null;
  site?: string | null;
  client?: string | null;
  sop?: string | null;
  excerpt?: string | null;
  checklist?: string[] | null;
  writes?: string[] | null;
  /** The server sends the list of what the chat changed; a plain true is also understood. */
  chat_changed?: boolean | string[] | null;
  chat_changed_line?: string | null;
  /** The text of each comment the chat wrote on this task (`on` null) or on a task it waits on (`on` its title). */
  chat_notes?: { on?: string | null; text: string }[] | null;
  /** "2 more notes from this chat are not shown. Open the task to read them." */
  chat_notes_more_line?: string | null;
  /** The current text of each read field the chat changed. */
  chat_text?: { label: string; text: string }[] | null;
  /** "Invisible characters were taken out of this text before it was shown: 600." */
  hidden_line?: string | null;
  /** Lines about this task's place on the card: "This chat wants to change this task.", a formatting note. */
  notices?: string[] | null;
}
export interface ProposalCard {
  kind: CardKind;
  title: string;
  lines?: string[] | null;
  reads?: CardRead[] | null;
  client?: string[] | null;
  buttons?: { yes: string; no: string } | null;
  clause?: string | null;
  /** Some chat-written text could not be shown in full: the card says so and cannot be tapped. */
  incomplete?: boolean | null;
  incomplete_line?: string | null;
}

/** Same words as the server's CARD_BUTTONS, used only if a card arrives without its buttons. */
export const CARD_BUTTON_FALLBACK: Record<CardKind, { yes: string; no: string }> = {
  bast_start: { yes: 'Hand to Bast', no: 'Keep it' },
  bast_resteer: { yes: 'Let Bast re-read it', no: 'Leave it' },
  client_show: { yes: 'Share it', no: 'Keep it private' },
};
export const CHANGED_SINCE_LINE = 'Changed since. Open the task.';
/** The same refusal, naming what to open (the server's `changedSinceFor`). */
export function changedSinceLine(targetType: string | null | undefined): string {
  if (targetType === 'wait') return 'Changed since. Open the wait.';
  if (targetType === 'project') return 'Changed since. Open the project.';
  return CHANGED_SINCE_LINE;
}
/** Status events the panel never shows (the stop request and the five notes the server writes for Bast). */
export const HIDDEN_STATUS_CODES: readonly string[] = ['stop_requested', 'action_undone', 'action_released', 'action_declined', 'action_failed', 'undo_proposed'];
export type ActionOutcome = 'released' | 'declined' | 'changed';
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The result of "Undo everything since", in one or two plain lines. Every field is read defensively. */
export function undoSinceLines(data: unknown): string[] {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const undone = count(d.undone);
  const proposed = count(d.proposed);
  const left = count(d.left);
  const stopped = d.stopped && typeof d.stopped === 'object' ? (d.stopped as { summary?: unknown; reason?: unknown }) : null;
  const first: string[] = [];
  first.push(undone === 0 ? 'Nothing was undone.' : `Undid ${plural(undone, 'change', 'changes')}.`);
  if (proposed > 0) first.push(`${plural(proposed, 'change became a card', 'changes became cards')} waiting for your tap.`);
  const lines = [first.join(' ')];
  if (stopped) {
    const what = typeof stopped.summary === 'string' && stopped.summary ? ` at ${stopped.summary.trim().replace(/\.+$/, '')}` : '';
    const why = typeof stopped.reason === 'string' && stopped.reason ? ` ${stopped.reason}` : '';
    lines.push(`Stopped${what}.${why}`);
  } else if (left > 0) {
    lines.push(`${plural(left, 'older change was', 'older changes were')} left alone.`);
  }
  return lines;
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

/** Plain line for the machine's state, or null when it is fine. Order: signed out, offline, paused (a stopped machine is not answering, whatever its last heartbeat said). */
export function workerNotice(worker: ChatWorker | null | undefined): string | null {
  if (!worker) return null;
  if (worker.auth_state === 'failed') return SIGNED_OUT_TEXT;
  if (!worker.online) return OFFLINE_TEXT;
  if (worker.paused) return PAUSED_TEXT;
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
  /** Show the conversation about one card (created the first time, reopened after). False when it could not be opened. */
  openCardConversation: (taskId: string) => Promise<boolean>;
  /** Leave a card's conversation and show the general chat again (the current one, if there is one). Closes nothing. */
  leaveCardConversation: () => Promise<void>;
  /** The card the open conversation is tied to, or null for the general chat. */
  cardTaskId: string | null;
  actOn: (id: string, verb: 'undo' | 'release' | 'decline') => Promise<void>;
  actionError: (id: string) => string | null;
  /** What Mike's last tap on a card did, until the feed catches up. */
  actionOutcome: (id: string) => ActionOutcome | null;
  /** "Undo everything since" from this action: the plain result lines, or null. */
  undoSince: (fromId: string) => Promise<void>;
  sinceLines: (fromId: string) => string[] | null;
  actionBusy: (id: string) => boolean;
  now: number;
}

/** `enabled` false keeps the hook silent (no requests) until a page offers the chat. */
export function useBastChat({ open, enabled = true }: { open: boolean; enabled?: boolean }): UseBastChat {
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
  const [outcomes, setOutcomes] = useState<Record<string, ActionOutcome>>({});
  const [sinceResults, setSinceResults] = useState<Record<string, string[]>>({});
  const [now, setNow] = useState(() => Date.now());

  // Refs so the poll loop always reads the latest values without restarting.
  const [cardTaskId, setCardTaskId] = useState<string | null>(null);
  // taskId: the card the shown conversation is tied to. While set, the status poll never swaps it for the general chat.
  const live = useRef({ open, conversationId, convStatus, pending: 0, maxSeq: 0, availability, taskId: null as string | null });
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
    if (id && id !== live.current.conversationId && live.current.taskId === null) {
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
  const gone = availability === 'unavailable' || !enabled;
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

  const startConversation = useCallback(async (taskId: string | null = null): Promise<string | null> => {
    const r = await chatFetch<{ id?: string; conversation?: { id?: string } }>('POST', '/conversations', taskId ? { task_id: taskId } : {});
    if (r.status === 403 || r.status === 404) {
      hide();
      return null;
    }
    const id = r.ok ? idOf(r.data) : null;
    if (!id) {
      setError(errorSentence(r.data, SEND_FAILED_TEXT));
      return null;
    }
    live.current.taskId = taskId;
    setCardTaskId(taskId);
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
        // A card's conversation reopens (same id); the general chat starts fresh.
        id = await startConversation(live.current.taskId);
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
    await startConversation(null);
  }, [startConversation]);

  const leaveCardConversation = useCallback(async () => {
    setError(null);
    live.current.taskId = null;
    setCardTaskId(null);
    resetConversation(null);
    await readStatus();
  }, [resetConversation, readStatus]);

  const openCardConversation = useCallback(
    async (taskId: string): Promise<boolean> => {
      setError(null);
      if (live.current.taskId === taskId && live.current.conversationId && live.current.convStatus !== 'closed') return true;
      const id = await startConversation(taskId);
      if (id) void pollOnce(); // show its earlier turns now, not at the next slow poll
      return id !== null;
    },
    [startConversation, pollOnce],
  );

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
      } else if (r.status === 409 && verb === 'release') {
        setOutcomes((o) => ({ ...o, [id]: 'changed' }));
      } else if (!r.ok) {
        setActionErrors((e) => ({ ...e, [id]: errorSentence(r.data, ACTION_FAILED_TEXT) }));
      } else if (verb === 'release') {
        setOutcomes((o) => ({ ...o, [id]: 'released' }));
      } else if (verb === 'decline') {
        setOutcomes((o) => ({ ...o, [id]: 'declined' }));
      }
      void pollOnce();
    },
    [pollOnce],
  );

  const undoSince = useCallback(
    async (fromId: string) => {
      setActionBusyIds((b) => [...b, fromId]);
      setActionErrors((e) => {
        const { [fromId]: _drop, ...rest } = e;
        void _drop;
        return rest;
      });
      const r = await chatFetch<unknown>('POST', '/actions/undo-since', { from_action_id: fromId });
      setActionBusyIds((b) => b.filter((x) => x !== fromId));
      if (r.ok) setSinceResults((m) => ({ ...m, [fromId]: undoSinceLines(r.data) }));
      else setActionErrors((e) => ({ ...e, [fromId]: errorSentence(r.data, ACTION_FAILED_TEXT) }));
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
      } else if (
        e.kind === 'status' &&
        typeof e.payload?.text === 'string' &&
        e.payload.text &&
        !HIDDEN_STATUS_CODES.includes(String(e.payload?.code ?? ''))
      ) {
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
    openCardConversation,
    leaveCardConversation,
    cardTaskId,
    actOn,
    actionError: (id) => actionErrors[id] ?? null,
    actionOutcome: (id) => outcomes[id] ?? null,
    undoSince,
    sinceLines: (id) => sinceResults[id] ?? null,
    actionBusy: (id) => actionBusyIds.includes(id),
    now,
  };
}
