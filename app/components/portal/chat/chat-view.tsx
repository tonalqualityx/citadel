'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText } from 'lucide-react';
import { ChatBubble } from '@/components/portal/intake/chat-bubble';
import { Skeleton } from '@/components/portal/ui/skeleton';
import { PortalButton } from '@/components/portal/ui/button';
import { splitLinks } from '@/lib/portal/linkify';
import { SENT_LINES } from '@/lib/portal/chat/copy';
import { SENT_HEADING } from '@/lib/portal/intake/tree';
import { ChoiceButtons } from './choice-buttons';
import { Composer } from './composer';
import { DisclosureLine } from './disclosure-line';
import { HandoffBanner } from './handoff-banner';
import { PageSearch } from './page-search';
import { SummaryCard } from './summary-card';
import { WritingBubble } from './writing-bubble';
import { canPreview, formatSize, type AskPending, type ChatMessage, type SummaryPending } from './types';
import { useChat, usePresence, type ChatSource } from './use-chat';
import { useUploads } from './use-uploads';

// The chat with the assistant (portal phase C). A role="log" of bubbles, the one thing to answer
// (choices, the summary card or the urgent options), the writing state, and the composer. Used by
// the request page and the work page; tree-mode turns look exactly like assistant turns.

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
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

function sourceLine(s: { label: string; range: string }): string {
  const extra = s.range && s.label.indexOf(s.range) < 0 ? `, ${s.range}` : '';
  return ['Source: ', s.label, extra].join('');
}

function MessageFiles({ files }: { files: ChatMessage['attachments'] }) {
  if (files.length === 0) return null;
  return (
    <ul className="msg-files">
      {files.map((f) => (
        <li key={f.id}>
          {canPreview(f.type) ? (
            <a href={f.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.name} className="thumb" />
            </a>
          ) : (
            <a href={f.url} className="file-link">
              <FileText className="i" aria-hidden="true" focusable="false" />
              <span>
                {f.name} <small>{formatSize(f.size)}</small>
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ChatView({
  source, intakeId, composerLabel, hint, emptyLine, viewRequestHref, showDisclosure = true, taskId, onStartAnother,
}: {
  source: ChatSource;
  intakeId?: string | null;
  composerLabel: string;
  hint: string;
  /** Shown above the composer before the first message. */
  emptyLine?: string;
  /** On the request page, where "View your request" goes once filed. */
  viewRequestHref?: (taskId: string) => string;
  showDisclosure?: boolean;
  /** The work page's task: files staged before its conversation exists are scoped to it. */
  taskId?: string | null;
  /** On the request page: start a fresh request once this one is filed. */
  onStartAnother?: () => void;
}) {
  const chat = useChat(source);
  const ping = usePresence(chat.convId);
  const uploads = useUploads({ intakeId: chat.convId ? null : intakeId, conversationId: chat.convId, taskId: chat.convId ? null : taskId }, source.onAuthLost);
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const p = chat.payload;
  const state = p?.state ?? 'clarifying';
  const pending = p?.pending as AskPending | SummaryPending | null | undefined;
  const ask = pending && pending.kind === 'ask' ? pending : null;
  const summary = pending && pending.kind === 'summary' ? pending : null;
  const urgent = p?.urgent ?? null;

  // Keep the newest message in view, but not on the first load.
  const count = chat.messages.length + (chat.writing ? 1 : 0) + (pending ? 1 : 0);
  useEffect(() => {
    if (seen.current && count > seen.current) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      endRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
    seen.current = count;
  }, [count]);

  const showSearch = searching && Boolean(ask?.search_pages);

  const rows = useMemo(() => {
    const out: Array<{ kind: 'day'; key: string; text: string } | { kind: 'msg'; m: ChatMessage }> = [];
    let lastDay = '';
    for (const m of chat.messages) {
      const day = formatDay(m.created_at);
      if (day && day !== lastDay) {
        out.push({ kind: 'day', key: `day-${m.id}`, text: day });
        lastDay = day;
      }
      out.push({ kind: 'msg', m });
    }
    return out;
  }, [chat.messages]);

  // The request page forgets its saved chat once the request is filed or closed.
  const onFiled = source.onFiled;
  const finished = state === 'filed' || state === 'closed';
  useEffect(() => {
    if (finished) onFiled?.();
    // onFiled changes identity every render; the transition is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  async function submit() {
    const ok = await chat.send({ text, attachmentIds: uploads.ready });
    if (ok) {
      setText('');
      uploads.clear();
      textareaRef.current?.focus();
    }
  }

  async function choose(slot: string, id: string, label: string) {
    if (slot === 'page' && id === 'another_page') {
      setSearching(true);
      return;
    }
    void label;
    const ok = await chat.send({ choice: { slot, id } });
    if (ok) {
      setSearching(false);
      textareaRef.current?.focus();
    }
  }

  const filed = state === 'filed';
  // The full card shows only for the moment a request is filed on this page, until anything newer arrives.
  const fullCard = filed && chat.filedAtCount !== null && chat.messages.length <= chat.filedAtCount;
  const withPerson = state === 'with_person';
  const closed = state === 'closed';
  const empty = chat.loaded && chat.messages.length === 0 && !chat.writing;

  if (chat.gone) {
    return (
      <div className="card">
        <p>We could not find this conversation. It may not be on your account.</p>
      </div>
    );
  }

  return (
    <>
      {showDisclosure && <DisclosureLine />}
      <section className="chatcard chat" aria-label="Chat with Indelible" data-state={state} data-mode={p?.mode}>
        <div className="log" role="log" aria-live="polite" aria-label="Conversation" aria-busy={chat.writing || undefined}>
          {!chat.loaded ? (
            <Skeleton lines={2} />
          ) : (
            <ol className="thread-log">
              {rows.map((r) =>
                r.kind === 'day' ? (
                  <li key={r.key} className="day">
                    {r.text}
                  </li>
                ) : (
                  <li key={r.m.id}>
                    <ChatBubble
                      side={r.m.who === 'client' ? 'you' : 'us'}
                      who={`${r.m.name}${r.m.mine ? ' (you)' : ''}`}
                      when={formatTime(r.m.created_at)}
                      author={r.m.who}
                    >
                      {r.m.text === '(attachment)' && r.m.attachments.length > 0 ? null : <Linked text={r.m.text} />}
                      <MessageFiles files={r.m.attachments} />
                    </ChatBubble>
                    {r.m.sources.map((s, i) => (
                      <p key={i} className="src" data-testid="chat-source">
                        {sourceLine(s)}
                      </p>
                    ))}
                  </li>
                )
              )}
              {chat.writing && (
                <li>
                  <WritingBubble label={chat.label} />
                </li>
              )}
            </ol>
          )}
          {empty && emptyLine ? <p className="empty-line">{emptyLine}</p> : null}
        </div>

        {!chat.writing && urgent && (
          <ChoiceButtons slot="urgent" label={urgent.prompt} choices={urgent.choices} disabled={chat.sending} onChoose={choose} />
        )}
        {!chat.writing && ask && !showSearch && (
          <ChoiceButtons slot={ask.slot} label={ask.question} choices={ask.choices} disabled={chat.sending} onChoose={choose} />
        )}
        {!chat.writing && ask && showSearch && (
          <PageSearch
            siteId={p?.site_id ?? null}
            onCancel={() => setSearching(false)}
            onPick={(id, label) => choose('page', id, label)}
          />
        )}
        {!chat.writing && summary && (
          <SummaryCard
            summary={summary}
            busy={chat.confirming || chat.confirmedVersion === summary.version}
            error={chat.confirmError}
            onSend={(projectId) => chat.confirm(summary.version, projectId)}
            onChange={() => choose('summary', 'change', summary.buttons.change)}
          />
        )}

        {chat.alreadyFiled && (
          <p className="strong" data-testid="chat-already-filed">
            {chat.alreadyFiled.line}{' '}
            {chat.alreadyFiled.taskId ? <a href={`/portal/work/${chat.alreadyFiled.taskId}`}>View your request</a> : null}
          </p>
        )}
        {withPerson && p?.banner ? <HandoffBanner text={p.banner} /> : null}
        {filed && !fullCard && (
          <p className="sent-chip" data-testid="chat-sent-chip">
            <Check className="i" aria-hidden="true" focusable="false" />
            <span>
              {SENT_HEADING} {SENT_LINES.more}
            </span>
          </p>
        )}
        {filed && fullCard && (
          <section className="summary-card sent" aria-labelledby="chat-sent-h" data-testid="chat-sent">
            <h2 id="chat-sent-h">{SENT_HEADING}</h2>
            <p>{SENT_LINES.more}</p>
            {viewRequestHref && p ? (
              <div className="actions">
                <PortalButton href={viewRequestHref(p.task_id)}>View your request</PortalButton>
                {onStartAnother ? (
                  <PortalButton variant="secondary" onClick={onStartAnother}>
                    Start another request
                  </PortalButton>
                ) : null}
              </div>
            ) : null}
          </section>
        )}

        {!closed && (
          <Composer
            label={composerLabel}
            hint={hint}
            value={text}
            onChange={setText}
            onTyping={ping}
            onSend={submit}
            sending={chat.sending}
            error={chat.sendError}
            drafts={uploads.drafts}
            onFiles={uploads.add}
            onRemoveFile={uploads.remove}
            filesProblem={uploads.problem}
            wantsFile={Boolean(ask?.allow_upload)}
            textareaRef={textareaRef}
          />
        )}
        <div ref={endRef} />
      </section>
    </>
  );
}
