'use client';

import * as React from 'react';
import { MessageText } from './MessageText';
import { ActionLine } from './ActionLine';
import { WorkerNotice } from './WorkerNotice';
import type { BastChatCard } from './card-context';
import { MAX_MESSAGE_CHARS, type TimelineMessage, type UseBastChat } from '@/lib/hooks/use-bast-chat';

export interface BastChatPanelProps {
  chat: UseBastChat;
  card: BastChatCard | null;
  /** The conversation shown belongs to one card (title here): the box says so and offers the way back to the general chat. */
  cardChatTitle?: string | null;
  onLeaveCardChat?: () => void;
  /** Mike dropped the "About" line for this card. */
  aboutDropped: boolean;
  onDropAbout: () => void;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
}

/** Applied actions at or after this position in the feed: what "Undo everything since here" would undo. */
function appliedFrom(timeline: UseBastChat['timeline'], from: number): number {
  let n = 0;
  for (let i = from; i < timeline.length; i++) {
    const it = timeline[i];
    if (it.type === 'action' && it.action.status === 'applied') n++;
  }
  return n;
}

function MessageRow({ m, onResend }: { m: TimelineMessage; onResend: (m: TimelineMessage) => void }) {
  const mine = m.role === 'mike';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }} data-testid={`msg-${m.role}`}>
      <div
        className="home-small"
        style={{
          maxWidth: '92%',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: mine ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
          color: 'var(--text-primary)',
        }}
      >
        <MessageText text={m.text} />
      </div>
      {m.state === 'waiting' ? <span className="home-small home-muted">Waiting for the machine</span> : null}
      {m.state === 'expired' ? (
        <span className="home-small home-muted" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          Not answered
          {m.canResend ? (
            <button type="button" className="home-linkbtn" onClick={() => onResend(m)}>
              Send again
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** The conversation, the machine's state, the "About" line and the box. Presentational: all fetching is in the hook. */
export function BastChatPanel({ chat, card, cardChatTitle = null, onLeaveCardChat, aboutDropped, onDropAbout, draft, setDraft }: BastChatPanelProps) {
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const stick = React.useRef(true);
  const aboutCard = card && (cardChatTitle !== null || !aboutDropped) ? card : null;

  React.useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.timeline.length, chat.liveText, chat.working]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || text.length > MAX_MESSAGE_CHARS) return;
    setDraft('');
    stick.current = true;
    const ok = await chat.send(text, aboutCard);
    // A message that did not go keeps its words in the box, unless he has started something new.
    if (!ok) setDraft((cur) => (cur ? cur : text));
  };

  const empty = chat.timeline.length === 0 && !chat.liveText;
  const tooLong = draft.length > MAX_MESSAGE_CHARS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }} data-testid="bast-chat-panel">
      {chat.notice ? <WorkerNotice text={chat.notice} /> : null}
      <div
        ref={scroller}
        role="log"
        aria-label="Conversation with Bast"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        style={{ flex: 1, minHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {empty ? <p className="home-small home-muted">Ask about a task or a project. Bast answers from what is in Citadel.</p> : null}
        {chat.timeline.map((item, idx) => {
          if (item.type === 'message') {
            return (
              <MessageRow
                key={item.key}
                m={item.message}
                onResend={(m) => void chat.sendAgain(m, aboutCard)}
              />
            );
          }
          if (item.type === 'note') return <p key={item.key} className="home-small home-muted">{item.text}</p>;
          return (
            <ActionLine
              key={item.key}
              action={item.action}
              now={chat.now}
              busy={chat.actionBusy(item.action.id)}
              error={chat.actionError(item.action.id)}
              onUndo={(id) => void chat.actOn(id, 'undo')}
              onRelease={(id) => void chat.actOn(id, 'release')}
              onDecline={(id) => void chat.actOn(id, 'decline')}
              outcome={chat.actionOutcome(item.action.id)}
              sinceCount={appliedFrom(chat.timeline, idx)}
              onUndoSince={(id) => void chat.undoSince(id)}
              sinceLines={chat.sinceLines(item.action.id)}
            />
          );
        })}
        {chat.liveText ? (
          <div className="home-small" data-testid="live-text" style={{ padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--border)' }}>
            <MessageText text={chat.liveText} />
          </div>
        ) : null}
        {chat.working ? (
          <p role="status" data-testid="working-line" className="home-small home-muted">
            {chat.liveAction ? chat.liveAction : 'Bast is working on it'}
            {chat.conversationStatus === 'running' ? (
              <>
                {' '}
                <button type="button" className="home-linkbtn" onClick={() => void chat.stop()}>
                  Stop
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {chat.error ? (
        <p role="status" data-testid="chat-error" className="home-small" style={{ color: 'var(--warning)' }}>
          {chat.error}
        </p>
      ) : null}
      {cardChatTitle !== null ? (
        <p className="home-small home-muted" data-testid="card-chat-line" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Talking about: {cardChatTitle}</span>
          <button type="button" className="home-linkbtn" onClick={onLeaveCardChat} style={{ flex: 'none' }}>
            Back to the general chat
          </button>
        </p>
      ) : aboutCard ? (
        <p className="home-small home-muted" data-testid="about-line" style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>About: {aboutCard.title}</span>
          <button
            type="button"
            className="home-linkbtn"
            onClick={onDropAbout}
            aria-label="Drop this card from the question"
            style={{ flex: 'none', minWidth: 24, minHeight: 24, textDecoration: 'none' }}
          >
            x
          </button>
        </p>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <label htmlFor="bast-chat-input" className="home-small home-muted">
          Message to Bast
        </label>
        <textarea
          id="bast-chat-input"
          data-testid="bast-chat-input"
          value={draft}
          rows={2}
          maxLength={MAX_MESSAGE_CHARS + 200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          style={{
            font: 'inherit',
            fontSize: '0.9rem',
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 10px',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            resize: 'vertical',
            maxHeight: 160,
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" className="home-linkbtn home-small" onClick={() => void chat.newChat()}>
            New chat
          </button>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {tooLong ? <span className="home-small" style={{ color: 'var(--warning)' }}>Too long. Keep it under {MAX_MESSAGE_CHARS} characters.</span> : null}
            <button type="submit" className="home-btn" data-filled="true" disabled={!draft.trim() || tooLong}>
              Send
            </button>
          </span>
        </div>
      </form>
    </div>
  );
}
