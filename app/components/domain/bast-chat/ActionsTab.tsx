'use client';

import * as React from 'react';
import { ActionLine } from './ActionLine';
import { summarizeActions, type HistoryTurn } from './action-history';
import { undoOpen, type ChatAction, type UseBastChat } from '@/lib/hooks/use-bast-chat';

/** The quiet line in the Chat tab: what a turn did, in one sentence, with a way to the Actions tab. */
export function ActionsSummaryLine({ actions, turnKey, onView }: { actions: ChatAction[]; turnKey: string; onView: (turnKey: string) => void }) {
  return (
    <p className="home-small home-muted" data-testid="actions-summary" style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', margin: 0 }}>
      <span>{summarizeActions(actions)}</span>
      <button type="button" className="home-linkbtn" onClick={() => onView(turnKey)} style={{ minHeight: 24 }}>
        View
      </button>
    </p>
  );
}

function whenWords(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  const sameDay = t.getFullYear() === today.getFullYear() && t.getMonth() === today.getMonth() && t.getDate() === today.getDate();
  return sameDay ? time : `${t.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function undoState(action: ChatAction, now: number): string | null {
  if (action.status === 'applied' && !undoOpen(action, now)) return 'Undo has expired.';
  return null;
}

/** The Actions tab: every finished action of this conversation, newest first, grouped by the message that prompted it. */
export function ActionsHistory({
  chat,
  turns,
  total,
  highlight,
  onUndoSinceCount,
  scrollerRef,
}: {
  chat: UseBastChat;
  turns: HistoryTurn[];
  total: number;
  highlight: string | null;
  onUndoSinceCount: (index: number) => number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollerRef}
      id="bast-chat-actions-panel"
      role="tabpanel"
      aria-labelledby="bast-chat-tab-actions"
      data-testid="actions-history"
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {total === 0 ? <p className="home-small home-muted" data-testid="actions-empty">No actions yet. Changes made from this chat will be listed here.</p> : null}
      {turns.map((t) => (
        <section key={t.turnKey} data-turn={t.turnKey} data-highlight={highlight === t.turnKey ? 'true' : undefined} aria-label={t.quote ? `Actions after: ${t.quote}` : 'Actions'} style={{ display: 'flex', flexDirection: 'column', gap: 8, scrollMarginTop: 4, borderRadius: 6, outline: highlight === t.turnKey ? '2px solid var(--accent)' : 'none', outlineOffset: 4 }}>
          <p className="home-small home-muted" data-testid="history-turn-quote" style={{ margin: 0 }}>
            {t.quote ? `After: \u201c${t.quote}\u201d` : 'Earlier in this chat'}
          </p>
          {t.entries.map((e) => {
            const when = whenWords(e.at, chat.now);
            const state = undoState(e.action, chat.now);
            return (
              <div key={e.action.id} data-testid="history-entry" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ActionLine
                  action={e.action}
                  now={chat.now}
                  busy={chat.actionBusy(e.action.id)}
                  error={chat.actionError(e.action.id)}
                  onUndo={(id) => void chat.actOn(id, 'undo')}
                  onRelease={(id) => void chat.actOn(id, 'release')}
                  onDecline={(id) => void chat.actOn(id, 'decline')}
                  outcome={chat.actionOutcome(e.action.id)}
                  sinceCount={onUndoSinceCount(e.index)}
                  onUndoSince={(id) => void chat.undoSince(id)}
                  sinceLines={chat.sinceLines(e.action.id)}
                />
                {when || state ? (
                  <p className="home-small home-muted" data-testid="history-meta" style={{ margin: 0, paddingLeft: 13 }}>
                    {[when, state].filter(Boolean).join(' \u00b7 ')}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
