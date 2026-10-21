'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send as SendIcon } from 'lucide-react';
import { splitLinks } from '@/lib/portal/linkify';
import { ChatBubble } from '@/components/portal/intake/chat-bubble';
import { PortalButton } from '@/components/portal/ui/button';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { Skeleton } from '@/components/portal/ui/skeleton';

// The conversation on a work page (portal phase B slice 2, spec 3.1). Oldest first, with the
// author ("Indelible" or the contact's name), the time and the text; links are clickable and
// nothing else is HTML. Indelible's messages sit left, the client's on the right, with a day line. Polls every 30 seconds while
// the tab is visible. Backed by GET and POST /api/portal/work/:id/messages.

interface Message {
  id: string;
  author: { kind: 'client' | 'staff'; name: string };
  mine: boolean;
  text: string;
  created_at: string;
}

const POLL_MS = 30_000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((seg, i) =>
        seg.href ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer">
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

export function Thread({ taskId, onAuthLost }: { taskId: string; onAuthLost?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One ref per draft: a retry of the same text after a failed send is a no-op if the first one landed.
  const ref = useRef<string>(typeof crypto !== 'undefined' ? crypto.randomUUID() : '');
  const last = useRef<string | null>(null);

  const merge = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const next = [...prev, ...incoming.filter((m) => !seen.has(m.id))];
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      last.current = next[next.length - 1]?.created_at ?? null;
      return next;
    });
  }, []);

  const fetchMessages = useCallback(
    async (after: string | null) => {
      try {
        const res = await fetch(`/api/portal/work/${taskId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`);
        if (res.status === 401) {
          onAuthLost?.();
          return;
        }
        if (!res.ok) return;
        merge((await res.json()).messages ?? []);
      } catch {
        // A missed poll is fine; the next one catches up.
      } finally {
        setLoaded(true);
      }
    },
    [taskId, merge, onAuthLost]
  );

  useEffect(() => {
    fetchMessages(null);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchMessages(last.current);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchMessages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/work/${taskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_ref: ref.current, text: text }),
      });
      if (res.status === 401) {
        onAuthLost?.();
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? payload.error : 'Your message was not sent. Please try again.');
        return;
      }
      merge([payload.message]);
      setText('');
      ref.current = crypto.randomUUID();
    } catch {
      setError('Your message was not sent. Please try again.');
    } finally {
      setSending(false);
    }
  }

  // Oldest first, with a centered day line wherever the day changes.
  const rows: Array<{ kind: 'day'; key: string; text: string } | { kind: 'msg'; m: Message }> = [];
  let lastDay = '';
  for (const m of messages) {
    const day = formatDay(m.created_at);
    if (day && day !== lastDay) {
      rows.push({ kind: 'day', key: `day-${m.id}`, text: day });
      lastDay = day;
    }
    rows.push({ kind: 'msg', m });
  }

  return (
    <section aria-labelledby="conversation-heading" className="chatcard">
      <div className="sec-h">
        <h2 id="conversation-heading">Conversation</h2>
      </div>

      {!loaded && messages.length === 0 ? (
        <Skeleton lines={2} />
      ) : loaded && messages.length === 0 ? (
        <EmptyState
          art="contours"
          title="Start the conversation"
          body="No messages yet. Add details, links or questions here and the team will see them on this request."
        />
      ) : (
        <ol className="thread-log" aria-live="polite">
          {rows.map((r) =>
            r.kind === 'day' ? (
              <li key={r.key} className="day">
                {r.text}
              </li>
            ) : (
              <li key={r.m.id}>
                <ChatBubble
                  side={r.m.author.kind === 'client' ? 'you' : 'us'}
                  who={`${r.m.author.name}${r.m.mine ? ' (you)' : ''}`}
                  when={formatTime(r.m.created_at)}
                  author={r.m.author.kind}
                >
                  <Linked text={r.m.text} />
                </ChatBubble>
              </li>
            )
          )}
        </ol>
      )}

      <form onSubmit={send} className="composer">
        <Field id="thread-message" label="Add a message" hint="Your message goes to the team working on this." error={error}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} />
        </Field>
        <div className="actions">
          <PortalButton type="submit" icon={SendIcon} busy={sending} busyLabel="Sending…" disabled={text.trim().length === 0}>
            Send
          </PortalButton>
        </div>
      </form>
    </section>
  );
}
