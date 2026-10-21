'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { splitLinks } from '@/lib/portal/linkify';

// The conversation on a work page (portal phase B slice 2, spec 3.1). Oldest first, with the
// author ("Indelible" or the contact's name), the time and the text; links are clickable and
// nothing else is HTML. Client messages sit on the sunk background. Polls every 30 seconds while
// the tab is visible. Backed by GET and POST /api/portal/work/:id/messages.

interface Message {
  id: string;
  author: { kind: 'client' | 'staff'; name: string };
  mine: boolean;
  text: string;
  created_at: string;
}

const POLL_MS = 30_000;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((seg, i) =>
        seg.href ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer" className="text-brand-primary underline break-all">
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

  return (
    <section aria-labelledby="conversation-heading" className="rounded-lg border border-border bg-surface p-5">
      <h2 id="conversation-heading" className="text-lg font-semibold text-text-main">
        Conversation
      </h2>

      {loaded && messages.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">
          No messages yet. Add details, links or questions here and the team will see them on this request.
        </p>
      ) : (
        <ol className="mt-3 space-y-3" aria-live="polite">
          {messages.map((m) => (
            <li
              key={m.id}
              data-author={m.author.kind}
              className={`rounded-md px-4 py-3 ${m.author.kind === 'client' ? 'bg-surface-secondary' : 'border border-border'}`}
            >
              <p className="text-xs text-text-tertiary">
                <span className="font-semibold text-text-main">{m.author.name}</span>
                {m.mine ? ' (you)' : ''}
                {' · '}
                {formatWhen(m.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-main">
                <Linked text={m.text} />
              </p>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={send} className="mt-4">
        <label htmlFor="thread-message" className="mb-1 block text-sm font-medium text-text-main">
          Add a message
        </label>
        <textarea
          id="thread-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={sending || text.trim().length === 0}
            className="min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <p className="text-sm text-text-tertiary">Your message goes to the team working on this.</p>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-status-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
