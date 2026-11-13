'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HomeActRequest, HomeAskedAfterRelease, HomeTriage, HomeTriageCard } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { TaskQuestions } from '@/components/domain/tasks/questions/TaskQuestions';
import {
  ASKED_AFTER_RELEASE_HEADING,
  ASKED_AFTER_RELEASE_HINT,
  LOOKS_DONE_BADGE,
  ON_RELEASE,
  RELEASE_OFF_PREFIX,
  RELEASE_OFF_UNSORTED,
  TRIAGE_BUTTONS,
  TRIAGE_EMPTY,
  TRIAGE_HEADING,
  ageFromDays,
  kindLabel,
} from '@/lib/tasks/triage-copy';
import { plain } from './home-screen-logic';
import { TriageActions } from './TriageActions';
import { TriageProjectBlock } from './TriageProject';

export interface TriageBoardProps {
  triage: HomeTriage;
  /** Every tap goes through the existing home acts (Release sends the version he read). */
  onAct: (request: HomeActRequest) => Promise<unknown>;
  /** Talk about this: the card, handed to the chat (it opens that card's own conversation). */
  onTalk: (card: OpenCardInput) => void;
  busy?: boolean;
}

/** The "On release" line, or why Release is off. Shared with the card page panel. */
export function ReleaseLine({ card }: { card: HomeTriageCard }) {
  if (card.looks_done) return null;
  if (card.release_ready) {
    return (
      <p className="home-small home-trelease" data-testid="release-line">
        <strong>{ON_RELEASE}</strong> {plain(card.release_line)}
      </p>
    );
  }
  return (
    <p className="home-small home-trelease" data-blocked={card.release_block ?? 'blocked'} data-testid="release-line">
      <strong>{RELEASE_OFF_PREFIX}</strong> {card.release_block === 'unsorted' ? RELEASE_OFF_UNSORTED : plain(card.release_line)}
    </p>
  );
}

/** The evidence a session left on a looks-done card, with the addresses in it as links. */
export function LooksDoneEvidence({ looksDone }: { looksDone: NonNullable<HomeTriageCard['looks_done']> }) {
  return (
    <div className="home-tevidence" data-testid="looks-done-evidence">
      <p className="home-small">{looksDone.evidence ? plain(looksDone.evidence) : 'Marked as done, but no note was left.'}</p>
      {looksDone.links.length > 0 ? (
        <ul className="home-tlinks">
          {looksDone.links.map((l, i) => (
            <li key={`${l.href}-${i}`} className="home-small">
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                {plain(l.text)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TriageCardItem({ card, onAct, onTalk, busy }: { card: HomeTriageCard } & Omit<TriageBoardProps, 'triage'>) {
  const router = useRouter();
  const [asking, setAsking] = React.useState(false);
  const age = ageFromDays(card.age_days);
  const open = (e: React.MouseEvent<HTMLElement>) => {
    // The buttons, links and the open questions do their own thing; only the card's own surface opens the card page.
    if ((e.target as HTMLElement).closest('a,button,input,textarea,select,summary,[data-no-open]')) return;
    router.push(card.href);
  };
  return (
    <article
      className="home-tcard"
      data-testid="triage-card-item"
      data-task-id={card.task_id}
      data-kind={card.kind ?? 'unsorted'}
      data-looks-done={card.looks_done ? 'true' : undefined}
      onClick={open}
    >
      <div className="home-tcard-top">
        {card.looks_done ? <span className="home-pill home-pill-done">{LOOKS_DONE_BADGE}</span> : null}
        <span className="home-tkind" data-unsorted={card.kind === null ? 'true' : undefined}>
          {kindLabel(card.kind)}
        </span>
        {age ? <span className="home-tage">{age}</span> : null}
      </div>
      <h3 className="home-tcard-title">
        <Link href={card.href}>{plain(card.title)}</Link>
      </h3>
      {card.summary ? <p className="home-tsummary">{plain(card.summary)}</p> : null}
      {card.looks_done ? <LooksDoneEvidence looksDone={card.looks_done} /> : <ReleaseLine card={card} />}
      {card.project ? <TriageProjectBlock project={card.project} variant="compact" /> : null}
      <TriageActions card={card} onAct={onAct} onTalk={onTalk} busy={busy}>
        {card.open_questions > 0 ? (
          <button type="button" className="home-btn" aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
            {asking ? TRIAGE_BUTTONS.hideQuestions : `${TRIAGE_BUTTONS.questions} ${card.open_questions}`}
          </button>
        ) : null}
      </TriageActions>
      {asking ? (
        <div data-no-open="true" className="home-tquestions">
          <TaskQuestions taskId={card.task_id} canAnswer />
        </div>
      ) : null}
    </article>
  );
}

function AskedAfterRelease({ rows }: { rows: HomeAskedAfterRelease[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="home-card home-tasked" data-testid="asked-after-release" aria-label={ASKED_AFTER_RELEASE_HEADING}>
      <h2>{ASKED_AFTER_RELEASE_HEADING}</h2>
      <p className="home-small home-muted">{ASKED_AFTER_RELEASE_HINT}</p>
      <ul className="home-tasked-list">
        {rows.map((r) => (
          <li key={r.task_id}>
            <Link href={r.href}>{plain(r.title)}</Link>
            <span className="home-small home-muted">{` · ${r.open_questions} ${r.open_questions === 1 ? 'question' : 'questions'}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Triage tab: a grid of cards (looks done first, then oldest first, as the server sends them), then "Asked after release".
 * One card per idea or project. Nothing is grouped, nothing is a row.
 */
export function TriageBoard({ triage, onAct, onTalk, busy = false }: TriageBoardProps) {
  const cards = triage.cards ?? [];
  const asked = triage.asked_after_release ?? [];
  return (
    <section className="home-tboard" data-testid="triage-board" aria-label={TRIAGE_HEADING}>
      {cards.length === 0 ? (
        <div className="home-card home-pane">
          <p className="home-muted">{TRIAGE_EMPTY}</p>
        </div>
      ) : (
        <div className="home-tgrid" data-testid="triage-grid">
          {cards.map((c) => (
            <TriageCardItem key={c.task_id} card={c} onAct={onAct} onTalk={onTalk} busy={busy} />
          ))}
        </div>
      )}
      <AskedAfterRelease rows={asked} />
    </section>
  );
}
