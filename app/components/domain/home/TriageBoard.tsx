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
  DETAILS_LABEL,
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
export function ReleaseLine({ card, showDetails = false, clamp = false }: { card: HomeTriageCard; showDetails?: boolean; clamp?: boolean }) {
  if (card.looks_done) return null;
  if (card.release_ready) {
    return (
      <>
        <p className="home-small home-trelease" data-clamp={clamp ? 'true' : undefined} data-testid="release-line">
          <strong>{ON_RELEASE}</strong> {plain(card.release_line)}
        </p>
        {showDetails && card.release_details?.length > 0 ? (
          <details className="home-small home-tdetails" data-testid="release-details">
            <summary>{DETAILS_LABEL}</summary>
            <ul>
              {card.release_details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </>
    );
  }
  return (
    <p className="home-small home-trelease" data-clamp={clamp ? 'true' : undefined} data-blocked={card.release_block ?? 'blocked'} data-testid="release-line">
      <strong>{RELEASE_OFF_PREFIX}</strong> {card.release_block === 'unsorted' ? RELEASE_OFF_UNSORTED : plain(card.release_line)}
    </p>
  );
}

/** A web address shown short (host and path, cut), so a long link does not push the card wider. The full address is the href. */
function shortUrl(u: string): string {
  const bare = u.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return bare.length > 42 ? `${bare.slice(0, 41)}\u2026` : bare;
}

/** The evidence a session left on a looks-done card, with the web addresses in it as links, in place. */
/** A session edited this card through the triage-desk lane: the newest change line the SERVER wrote for it (rendered from change rows, never from a comment). */
export function SessionChanged({ card }: { card: Pick<HomeTriageCard, 'recent_changes'> }) {
  const latest = (card.recent_changes ?? []).find((c) => c.by === 'a session');
  if (!latest) return null;
  return (
    <p className="home-small" data-testid="triage-session-changed">
      {plain(latest.line)}
    </p>
  );
}

/** Dox has an open question about this card's dates: why, in plain words. */
export function DateReason({ card }: { card: Pick<HomeTriageCard, 'date_flags'> }) {
  const flags = card.date_flags ?? [];
  if (flags.length === 0) return null;
  return (
    <div data-testid="triage-date-reason">
      {flags.map((f) => (
        <p key={f.kind} className="home-small" data-kind={f.kind}>
          {plain(f.reason)}
        </p>
      ))}
    </div>
  );
}

export function LooksDoneEvidence({ looksDone }: { looksDone: NonNullable<HomeTriageCard['looks_done']> }) {
  const text = plain(looksDone.evidence) || 'Marked as done, but no note was left.';
  const nodes: React.ReactNode[] = [];
  let rest = text;
  looksDone.links.forEach((l, i) => {
    const at = rest.indexOf(l.text);
    if (at < 0) return;
    if (at > 0) nodes.push(rest.slice(0, at));
    nodes.push(
      <a key={`${l.href}-${i}`} href={l.href} target="_blank" rel="noopener noreferrer">
        {shortUrl(l.text)}
      </a>,
    );
    rest = rest.slice(at + l.text.length);
  });
  if (rest) nodes.push(rest);
  return (
    <div className="home-tevidence" data-testid="looks-done-evidence">
      <p className="home-small">{nodes.map((n, i) => (typeof n === 'string' ? <React.Fragment key={i}>{n}</React.Fragment> : n))}</p>
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
      {card.plan_line ? (
        <p className="home-small home-muted" data-testid="triage-plan-line">
          {plain(card.plan_line)}
        </p>
      ) : null}
      <SessionChanged card={card} />
      <DateReason card={card} />
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
