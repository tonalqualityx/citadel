'use client';

import * as React from 'react';
import type { HomeActRequest, HomeTriageCard } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { CARD_CHANGED_MESSAGE, cardChangedNote, TRIAGE_BUTTONS } from '@/lib/tasks/triage-copy';
import { cardTalk } from './triage-talk';

export interface TriageActionsProps {
  card: HomeTriageCard;
  /** Every tap goes through the existing home acts. Resolves when the server answered (the hook has toasted, with Undo). */
  onAct: (request: HomeActRequest) => Promise<unknown>;
  onTalk: (card: OpenCardInput) => void;
  busy?: boolean;
  /** Called after a tap the server accepted, so a caller outside the home screen can refresh its own copy. */
  onDone?: () => void;
  /** Extra buttons (the questions button on the grid card) shown after the three actions. */
  children?: React.ReactNode;
}

/**
 * The buttons of one Triage card, shared by the grid card and the card page panel. Release sends the version the owner read:
 * when the server answers 409 card_changed the card is refetched by the hook and a line under the buttons says it changed.
 * A looks-done card offers Close as done (filled), Not done and Talk about this instead.
 */
export function TriageActions({ card, onAct, onTalk, busy = false, onDone, children }: TriageActionsProps) {
  const [working, setWorking] = React.useState(false);
  const [changed, setChanged] = React.useState(false);
  const off = busy || working;
  const run = async (req: HomeActRequest) => {
    setWorking(true);
    setChanged(false);
    try {
      await onAct(req);
      onDone?.();
    } catch (e) {
      if (e instanceof Error && e.message === CARD_CHANGED_MESSAGE) {
        setChanged(true);
        onDone?.(); // a caller with its own copy of the card (the card page panel) refetches it, so the new line and the new version are on screen
      }
      // Any other failure: the hook already showed one plain sentence and nothing on the card moved.
    } finally {
      setWorking(false);
    }
  };
  const id = card.task_id;
  const talk = (
    <button type="button" className="home-btn" onClick={() => onTalk(cardTalk(card))}>
      {TRIAGE_BUTTONS.talk}
    </button>
  );
  return (
    <>
      {changed ? (
        <p className="home-small home-tnote" role="status" data-testid="triage-changed">
          <span data-testid="triage-what-changed">{cardChangedNote((card.recent_changes ?? []).map((l) => l.line))}</span>
        </p>
      ) : null}
      <div className="home-actions home-tactions">
        {card.looks_done ? (
          <>
            <button type="button" className="home-btn" data-filled="true" disabled={off} onClick={() => void run({ action: 'triage_close_done', task_ids: [id] })}>
              {TRIAGE_BUTTONS.closeDone}
            </button>
            <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_not_done', task_ids: [id] })}>
              {TRIAGE_BUTTONS.notDone}
            </button>
            {talk}
          </>
        ) : (
          <>
            <button
              type="button"
              className="home-btn"
              data-filled="true"
              disabled={off || !card.release_ready}
              onClick={() => void run({ action: 'triage_release_card', task_ids: [id], release_version: card.release_version })}
            >
              {TRIAGE_BUTTONS.release}
            </button>
            <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_drop', task_ids: [id] })}>
              {TRIAGE_BUTTONS.drop}
            </button>
            {talk}
          </>
        )}
        {children}
      </div>
    </>
  );
}
