'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatPayload } from './types';

// The chat's data: the polled view, the merged messages, sending and confirming. Polls every 3
// seconds while the assistant is writing (and for two minutes after a send), every 30 otherwise,
// and not at all while the tab is hidden. Presence pings are in usePresence.

const FAST_MS = 3_000;
const SLOW_MS = 30_000;
const AFTER_SEND_MS = 2 * 60_000;

export type StartResult = { conversation_id: string; task_id?: string | null; route?: string } | { unavailable: true };

export interface ChatSource {
  conversationId: string | null;
  /** First message of a brand-new chat (POST /api/portal/chat), or the lazy open from a work page. */
  start?: (input: { text: string; attachmentIds: string[]; clientRef: string }) => Promise<StartResult>;
  /** Messages shown before a conversation exists (the work page's phase B thread). */
  history?: () => Promise<ChatMessage[]>;
  onAuthLost?: () => void;
  onUnavailable?: () => void;
  onOpened?: (conversationId: string) => void;
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

async function errorText(res: Response, fallback: string): Promise<{ code: string | null; text: string }> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return { code: body.code ?? null, text: res.status === 429 && body.error ? body.error : fallback };
}

export function useChat(src: ChatSource) {
  const [convId, setConvId] = useState<string | null>(src.conversationId);
  const [payload, setPayload] = useState<ChatPayload | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [localWriting, setLocalWriting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [alreadyFiled, setAlreadyFiled] = useState<{ line: string; taskId: string | null } | null>(null);

  const srcRef = useRef(src);
  srcRef.current = src;
  const lastId = useRef<string | null>(null);
  const writingRef = useRef(false);
  const fastUntil = useRef(0);
  const wake = useRef<() => void>(() => {});
  // One client_ref per attempt: a retry after a failed send reuses it, so a double send is a no-op.
  const refText = useRef<string>('');

  const refresh = useCallback(async () => {
    const id = convId;
    if (!id) return;
    try {
      const res = await fetch(`/api/portal/chat/${id}${lastId.current ? `?after=${encodeURIComponent(lastId.current)}` : ''}`);
      if (res.status === 401) return srcRef.current.onAuthLost?.();
      if (res.status === 404) return setGone(true);
      if (!res.ok) return;
      const body = (await res.json()) as ChatPayload;
      setPayload(body);
      writingRef.current = body.writing;
      setLocalWriting(false);
      if (body.messages.length) {
        setMessages((prev) => {
          const next = mergeMessages(prev, body.messages);
          lastId.current = next[next.length - 1]?.id ?? lastId.current;
          return next;
        });
      }
    } catch {
      // A missed poll is fine; the next one catches up.
    } finally {
      setLoaded(true);
    }
  }, [convId]);

  // Before a conversation exists: show the earlier thread, if the page has one.
  useEffect(() => {
    if (convId || !src.history) {
      if (!convId) setLoaded(true);
      return;
    }
    let cancelled = false;
    src.history().then(
      (m) => {
        if (!cancelled) {
          setMessages(m);
          setLoaded(true);
        }
      },
      () => !cancelled && setLoaded(true)
    );
    return () => {
      cancelled = true;
    };
    // history is read once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  useEffect(() => {
    if (!convId) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === 'visible') await refresh();
      if (stop) return;
      const fast = writingRef.current || Date.now() < fastUntil.current;
      timer = window.setTimeout(tick, fast ? FAST_MS : SLOW_MS);
    };
    wake.current = () => {
      window.clearTimeout(timer);
      void tick();
    };
    void tick();
    const vis = () => {
      if (document.visibilityState === 'visible') wake.current();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [convId, refresh]);

  const afterSend = useCallback((route?: string) => {
    fastUntil.current = Date.now() + AFTER_SEND_MS;
    if (route === 'queued') setLocalWriting(true);
    refText.current = '';
    wake.current();
  }, []);

  const send = useCallback(
    async (input: { text?: string; choice?: { slot: string; id: string }; attachmentIds?: string[] }): Promise<boolean> => {
      setSending(true);
      setSendError(null);
      const ref = refText.current || (refText.current = crypto.randomUUID());
      const text = (input.text ?? '').trim();
      const attachmentIds = input.attachmentIds ?? [];
      try {
        if (!convId) {
          const start = srcRef.current.start;
          if (!start) return false;
          const r = await start({ text, attachmentIds, clientRef: ref });
          if ('unavailable' in r) {
            srcRef.current.onUnavailable?.();
            return false;
          }
          setConvId(r.conversation_id);
          srcRef.current.onOpened?.(r.conversation_id);
          afterSend(r.route);
          return true;
        }
        const res = await fetch(`/api/portal/chat/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_ref: ref,
            ...(text ? { text } : {}),
            ...(input.choice ? { choice: input.choice } : {}),
            attachment_ids: attachmentIds,
          }),
        });
        if (res.status === 401) {
          srcRef.current.onAuthLost?.();
          return false;
        }
        if (!res.ok) {
          const e = await errorText(res, 'Your message was not sent. Please try again.');
          setSendError(e.code === 'bad_choice' ? 'That choice is no longer available. Please pick again.' : e.text);
          if (e.code === 'bad_choice') wake.current();
          return false;
        }
        const body = (await res.json().catch(() => ({}))) as { route?: string };
        afterSend(body.route);
        return true;
      } catch (e) {
        if (!(e instanceof Error && e.message === 'auth')) setSendError(e instanceof Error && e.message ? e.message : 'Your message was not sent. Please try again.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [convId, afterSend]
  );

  const confirm = useCallback(
    async (version: number, projectId: string | null) => {
      if (!convId) return;
      setConfirming(true);
      setConfirmError(null);
      try {
        const res = await fetch(`/api/portal/chat/${convId}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary_version: version, ...(projectId ? { project_id: projectId } : {}) }),
        });
        if (res.status === 401) return srcRef.current.onAuthLost?.();
        if (!res.ok) {
          const e = await errorText(res, 'Something went wrong. Please try again.');
          setConfirmError(
            res.status === 409
              ? 'This summary changed. Please check the new one.'
              : e.code === 'choose_project'
                ? 'Please choose the project first.'
                : e.text
          );
          wake.current();
          return;
        }
        const done = (await res.json().catch(() => ({}))) as { already?: boolean; lines?: string[]; task_id?: string | null };
        if (done.already && done.lines?.[0] && done.task_id) setAlreadyFiled({ line: done.lines[0], taskId: done.task_id });
        wake.current();
      } catch {
        setConfirmError('Something went wrong. Please try again.');
      } finally {
        setConfirming(false);
      }
    },
    [convId]
  );

  const writing = (payload?.writing ?? false) || localWriting;
  return {
    convId, payload, messages, loaded, gone, sending, sendError, setSendError, writing, confirming, confirmError, alreadyFiled, send, confirm,
    refresh: () => wake.current(),
    label: payload?.writing_label ?? 'Writing',
  };
}

// Presence (spec 7.1): visible every 30 seconds, typing at most every 10, hidden on the way out
// (sendBeacon, so it survives the page closing).
export function usePresence(conversationId: string | null) {
  const lastTyping = useRef(0);
  useEffect(() => {
    if (!conversationId) return;
    const url = `/api/portal/chat/${conversationId}/presence`;
    const post = (state: 'visible' | 'typing' | 'hidden') => {
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }), keepalive: true }).catch(() => {});
    };
    const beaconHidden = () => {
      try {
        navigator.sendBeacon(url, new Blob([JSON.stringify({ state: 'hidden' })], { type: 'application/json' }));
      } catch {
        /* the next visible ping corrects it */
      }
    };
    if (document.visibilityState === 'visible') post('visible');
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') post('visible');
    }, 30_000);
    const vis = () => (document.visibilityState === 'visible' ? post('visible') : beaconHidden());
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', beaconHidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', beaconHidden);
    };
  }, [conversationId]);

  return useCallback(() => {
    if (!conversationId) return;
    const now = Date.now();
    if (now - lastTyping.current < 10_000) return;
    lastTyping.current = now;
    void fetch(`/api/portal/chat/${conversationId}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'typing' }),
      keepalive: true,
    }).catch(() => {});
  }, [conversationId]);
}
