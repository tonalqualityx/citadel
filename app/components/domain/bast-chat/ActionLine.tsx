'use client';

import * as React from 'react';
import {
  undoOpen,
  CARD_BUTTON_FALLBACK,
  CHANGED_SINCE_LINE,
  type ActionOutcome,
  type CardRead,
  type ChatAction,
  type ProposalCard,
} from '@/lib/hooks/use-bast-chat';

export interface ActionLineProps {
  action: ChatAction;
  now: number;
  busy: boolean;
  error: string | null;
  onUndo: (id: string) => void;
  onRelease: (id: string) => void;
  onDecline: (id: string) => void;
  /** What Mike's last tap did, until the feed shows the new status. */
  outcome?: ActionOutcome | null;
  /** How many applied changes at or after this one "Undo everything since here" would undo. */
  sinceCount?: number;
  onUndoSince?: (id: string) => void;
  /** The plain result of an Undo everything since started from this line. */
  sinceLines?: string[] | null;
}

const BTN = 'home-btn';

const STATUS_WORDS: Record<string, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  review: 'in review',
  done: 'done',
  blocked: 'blocked',
  abandoned: 'dropped',
};
function statusWords(s: string | null | undefined): string | null {
  if (!s) return null;
  return STATUS_WORDS[s] ?? s.replace(/_/g, ' ');
}

function changedLine(r: CardRead): string | null {
  const flagged = r.chat_changed === true || (Array.isArray(r.chat_changed) && r.chat_changed.length > 0);
  if (!flagged && !r.chat_changed_line) return null;
  if (r.chat_changed_line) return r.chat_changed_line;
  if (Array.isArray(r.chat_changed)) return `This chat changed this recently: ${r.chat_changed.join(', ')}.`;
  return 'This chat changed this text recently.';
}

function ReadBlock({ read }: { read: CardRead }) {
  const status = statusWords(read.status);
  const meta = [status, read.client, read.site, read.sop].filter((x): x is string => !!x);
  const checklist = read.checklist ?? [];
  const writes = read.writes ?? [];
  const changed = changedLine(read);
  return (
    <li data-testid="card-read" style={{ display: 'flex', flexDirection: 'column', gap: 2, listStyle: 'none' }}>
      <p className="home-small" style={{ fontWeight: 600 }}>
        {read.title}
      </p>
      {meta.length > 0 ? <p className="home-small home-muted">{meta.join(', ')}</p> : null}
      {changed ? (
        <p className="home-small" data-testid="chat-changed" style={{ fontWeight: 600, borderLeft: '3px solid var(--accent)', paddingLeft: 8 }}>
          {changed}
        </p>
      ) : null}
      {read.excerpt ? <p className="home-small">{read.excerpt}</p> : null}
      {checklist.length > 0 ? (
        <div className="home-small">
          <p className="home-muted">Checklist: {checklist.length}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {checklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {writes.length > 0 ? <p className="home-small home-muted">Changes: {writes.join(', ')}.</p> : null}
    </li>
  );
}

function TapCard({ card, action, busy, onRelease, onDecline }: { card: ProposalCard; action: ChatAction; busy: boolean; onRelease: (id: string) => void; onDecline: (id: string) => void }) {
  const labelId = `card-${action.id}`;
  const buttons = card.buttons ?? CARD_BUTTON_FALLBACK[card.kind] ?? CARD_BUTTON_FALLBACK.bast_start;
  const reads = card.reads ?? [];
  const client = card.client ?? [];
  return (
    <section
      role="region"
      aria-labelledby={labelId}
      data-testid="tap-card"
      data-kind={card.kind}
      style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-elevated)' }}
    >
      <p id={labelId} className="home-small" style={{ fontWeight: 600 }}>
        {card.title}
      </p>
      {(card.lines ?? []).map((l, i) => (
        <p key={i} className="home-small">
          {l}
        </p>
      ))}
      {reads.length > 0 ? (
        <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reads.map((r, i) => (
            <ReadBlock key={r.task_id ?? i} read={r} />
          ))}
        </ul>
      ) : null}
      {client.length > 0 ? (
        <div className="home-small" data-testid="card-client">
          <p className="home-muted">The client will see</p>
          {client.map((c, i) => (
            <p key={i}>{c}</p>
          ))}
        </div>
      ) : null}
      <div className="home-actions" role="group" aria-label="Your choice">
        <button type="button" className={BTN} data-filled="true" disabled={busy} onClick={() => onRelease(action.id)}>
          {buttons.yes}
        </button>
        <button type="button" className={BTN} disabled={busy} onClick={() => onDecline(action.id)}>
          {buttons.no}
        </button>
      </div>
    </section>
  );
}

function sentence(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * One line for one thing Bast did or proposes. A change shows what changed and an Undo for as long as the server's
 * undo window is open. A proposal that starts Bast, re-steers Bast or shows a client is a card with two buttons.
 * An older proposal without a card keeps the plain two buttons. Plain text only.
 */
export function ActionLine({ action, now, busy, error, onUndo, onRelease, onDecline, outcome, sinceCount, onUndoSince, sinceLines }: ActionLineProps) {
  const [more, setMore] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const open = undoOpen(action, now);
  const card = action.card ?? null;

  const shell = (children: React.ReactNode, status = action.status) => (
    <div
      data-testid="action-line"
      data-status={status}
      style={{ borderLeft: '3px solid var(--accent)', padding: '2px 0 2px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      {children}
    </div>
  );
  const errorLine = error ? (
    <p className="home-small" role="status" style={{ color: 'var(--warning)' }}>
      {error}
    </p>
  ) : null;

  if (card) {
    const clause = card.clause ? sentence(card.clause) : card.title;
    if (action.status === 'failed' || (action.status === 'proposed' && outcome === 'changed')) {
      const server = action.error?.trim();
      const text = action.status === 'failed' ? (server ? (server.startsWith("That didn't") ? server : `That didn't go through. ${server}`) : "That didn't go through. Changed since. Open the task.") : CHANGED_SINCE_LINE;
      return shell(
        <p className="home-small" role="status" data-testid="card-failed">
          {text}
        </p>,
      );
    }
    if (action.status === 'released' || (action.status === 'proposed' && outcome === 'released')) {
      return shell(<p className="home-small" data-testid="card-released">{`Done. ${clause}.`}</p>);
    }
    if (action.status === 'declined' || (action.status === 'proposed' && outcome === 'declined')) {
      return shell(<p className="home-small home-muted" data-testid="card-declined">{`Left as it was. ${clause}.`}</p>);
    }
    if (action.status === 'proposed') {
      return shell(
        <>
          <p className="home-small">{action.summary}</p>
          <TapCard card={card} action={action} busy={busy} onRelease={onRelease} onDecline={onDecline} />
          {errorLine}
        </>,
      );
    }
  }

  let tail: string | null = null;
  if (action.status === 'undone') tail = 'Undone.';
  else if (action.status === 'released') tail = 'Done.';
  else if (action.status === 'declined') tail = 'Left as it was.';
  else if (action.status === 'failed') tail = "That didn't go through.";
  const showMore = action.status === 'applied' && !!onUndoSince;
  const count = Math.max(1, sinceCount ?? 1);
  const moreId = `more-${action.id}`;
  return shell(
    <>
      <p className="home-small">{action.summary}</p>
      {action.status === 'proposed' ? (
        <div className="home-actions" role="group" aria-label="Proposal">
          <button type="button" className={BTN} data-filled="true" disabled={busy} onClick={() => onRelease(action.id)}>
            {action.proposed_assignee ? `Hand to ${action.proposed_assignee}` : 'Hand it over'}
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => onDecline(action.id)}>
            Keep it
          </button>
        </div>
      ) : null}
      {open || showMore ? (
        <div className="home-actions">
          {open ? (
            <button type="button" className={BTN} disabled={busy} onClick={() => onUndo(action.id)}>
              Undo
            </button>
          ) : null}
          {showMore ? (
            <button type="button" className="home-linkbtn home-small" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((m) => !m)}>
              More
            </button>
          ) : null}
        </div>
      ) : null}
      {showMore && more ? (
        <div id={moreId} className="home-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {confirming ? (
            <>
              <p className="home-small" role="status" data-testid="since-confirm">
                {count === 1 ? "This will undo 1 of the chat's changes." : `This will undo ${count} of the chat's changes.`}
              </p>
              <button
                type="button"
                className={BTN}
                data-filled="true"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setMore(false);
                  onUndoSince?.(action.id);
                }}
              >
                Undo them
              </button>
              <button type="button" className={BTN} disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={BTN} disabled={busy} onClick={() => setConfirming(true)}>
              Undo everything since here
            </button>
          )}
        </div>
      ) : null}
      {sinceLines && sinceLines.length > 0 ? (
        <div data-testid="since-result" role="status">
          {sinceLines.map((l, i) => (
            <p key={i} className="home-small">
              {l}
            </p>
          ))}
        </div>
      ) : null}
      {tail ? <p className="home-small home-muted">{tail}</p> : null}
      {errorLine}
    </>,
  );
}
