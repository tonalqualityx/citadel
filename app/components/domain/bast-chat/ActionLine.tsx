'use client';

import * as React from 'react';
import { undoOpen, type ChatAction } from '@/lib/hooks/use-bast-chat';

export interface ActionLineProps {
  action: ChatAction;
  now: number;
  busy: boolean;
  error: string | null;
  onUndo: (id: string) => void;
  onRelease: (id: string) => void;
  onDecline: (id: string) => void;
}

const BTN = 'home-btn';

/**
 * One line for one thing Bast did or proposes. A change shows what changed and an Undo for as long as the server's
 * undo window is open. A handoff proposal needs Mike's tap: "Hand to {first name}" or "Keep it". The name comes from the server. Plain text only.
 */
export function ActionLine({ action, now, busy, error, onUndo, onRelease, onDecline }: ActionLineProps) {
  const open = undoOpen(action, now);
  let tail: string | null = null;
  if (action.status === 'undone') tail = 'Undone.';
  else if (action.status === 'released') tail = 'Done.';
  else if (action.status === 'declined') tail = 'Left as it was.';
  else if (action.status === 'failed') tail = "That didn't go through.";
  return (
    <div
      data-testid="action-line"
      data-status={action.status}
      style={{ borderLeft: '3px solid var(--accent)', padding: '2px 0 2px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
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
      {open ? (
        <div className="home-actions">
          <button type="button" className={BTN} disabled={busy} onClick={() => onUndo(action.id)}>
            Undo
          </button>
        </div>
      ) : null}
      {tail ? <p className="home-small home-muted">{tail}</p> : null}
      {error ? (
        <p className="home-small" role="status" style={{ color: 'var(--warning)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
