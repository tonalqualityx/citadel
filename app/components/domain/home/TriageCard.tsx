'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeActRequest, HomeTriage, HomeTriageGroup, HomeTriageLooksDone, HomeTriageTask } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { TaskQuestions } from '@/components/domain/tasks/questions/TaskQuestions';
import { LOOKS_DONE_HEADING, LOOKS_DONE_HINT, LOOKS_DONE_NO_NOTE, TRIAGE_BUTTONS, TRIAGE_HEADING, TRIAGE_MESSAGES, TRIAGE_SUBHEAD, ageLine, lookDoneCount } from '@/lib/tasks/triage-copy';
import { evidenceParts } from '@/lib/tasks/looks-done';
import { plain } from './home-screen-logic';
import { triageTalkCard } from './triage-talk';

export interface TriageCardProps {
  triage: HomeTriage;
  /** The triage acts. Resolves when the server answered; the hook has already shown the toast with Undo. */
  onAct: (request: HomeActRequest) => Promise<unknown>;
  /** Talk about this: the group or the one idea, handed to the chat. */
  onTalk: (card: OpenCardInput) => void;
  busy?: boolean;
}

/** Groups shown before "Show all", and ideas shown in a group before "Show all N": the section must not push the day's list off the top. */
const GROUPS_SHOWN = 5;
const ROWS_SHOWN = 5;

/** An evidence line with its web addresses clickable. Nothing else in the text is ever a link. */
export function Evidence({ text }: { text: string }) {
  return (
    <>
      {evidenceParts(plain(text)).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {p.text}
          </a>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * The Triage section: every idea is its own card row (title opens the card page, one line of what is wanted, its age, its open
 * questions, and its own Release, Drop and Talk about this). Cards an agent marked looks-done come first under their own heading
 * with the evidence and Close as done, Not done and Talk about this. A real project or pass group also gets Release plan and Drop
 * all; ideas with no project are not a plan, so that group has no group buttons. Nothing starts until a tap, and every tap has Undo.
 */
export function TriageCard({ triage, onAct, onTalk, busy = false }: TriageCardProps) {
  const [working, setWorking] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [allGroups, setAllGroups] = React.useState(false);
  // Cards whose questions are open in place.
  const [asking, setAsking] = React.useState<Record<string, boolean>>({});
  const toggleAsking = (id: string) => setAsking((a) => ({ ...a, [id]: !a[id] }));
  // One plain line under a group when the server's own reason is better than the hook's generic toast (a quote that is still a quote).
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const off = busy || working;
  const run = async (req: HomeActRequest, groupKey?: string) => {
    setWorking(true);
    if (groupKey) setNotes((n) => ({ ...n, [groupKey]: '' }));
    try {
      await onAct(req);
    } catch (e) {
      // The hook already showed one plain sentence; a quote's own sentence is kept under the group.
      const m = e instanceof Error ? e.message : '';
      if (groupKey && m === TRIAGE_MESSAGES.stillQuote) setNotes((n) => ({ ...n, [groupKey]: m }));
    } finally {
      setWorking(false);
    }
  };
  const looksDone = triage.looks_done ?? [];
  const shown = allGroups ? triage.groups : triage.groups.slice(0, GROUPS_SHOWN);
  const hidden = triage.groups.length - shown.length;

  const questionsButton = (t: { task_id: string; open_questions: number }) =>
    t.open_questions > 0 ? (
      <button type="button" className="home-btn" aria-expanded={asking[t.task_id] === true} onClick={() => toggleAsking(t.task_id)}>
        {TRIAGE_BUTTONS.questions} {t.open_questions}
      </button>
    ) : null;
  const questionsPanel = (t: { task_id: string }) => (asking[t.task_id] ? <TaskQuestions taskId={t.task_id} canAnswer /> : null);

  /** The title (the tap target, with a chevron), one line of what is wanted, and the age, project and question count. */
  const head = (t: { task_id: string; title: string; href: string; project_name: string | null; summary?: string; created_at?: string; open_questions: number }, showProject: boolean) => {
    const meta = [ageLine(t.created_at), showProject && t.project_name ? plain(t.project_name) : '', t.open_questions > 0 ? `${t.open_questions} ${t.open_questions === 1 ? 'question' : 'questions'} for you` : '']
      .filter(Boolean)
      .join(' · ');
    return (
      <>
        <strong>
          <Link href={t.href}>
            {plain(t.title)} <span aria-hidden="true">{'›'}</span>
          </Link>
        </strong>
        {t.summary ? <span className="home-small">{plain(t.summary)}</span> : null}
        {meta ? <span className="home-row-meta">{meta}</span> : null}
      </>
    );
  };

  const looksDoneRow = (t: HomeTriageLooksDone) => (
    <div key={t.task_id} className="home-row" data-testid="looks-done-row" data-task-id={t.task_id}>
      {head(t, true)}
      <span className="home-small" data-testid="looks-done-evidence">
        {t.evidence ? <Evidence text={t.evidence} /> : LOOKS_DONE_NO_NOTE}
      </span>
      <div className="home-actions">
        <button type="button" className="home-btn" data-filled="true" disabled={off} onClick={() => void run({ action: 'triage_close_done', task_ids: [t.task_id] })}>
          {TRIAGE_BUTTONS.closeDone}
        </button>
        <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_not_done', task_ids: [t.task_id] })}>
          {TRIAGE_BUTTONS.notDone}
        </button>
        <button type="button" className="home-btn" onClick={() => onTalk({ key: `task:${t.task_id}`, title: t.title, type: 'task', task_id: t.task_id, tile: 'triage' })}>
          {TRIAGE_BUTTONS.talk}
        </button>
        {questionsButton(t)}
      </div>
      {questionsPanel(t)}
    </div>
  );

  const taskRow = (g: HomeTriageGroup, t: HomeTriageTask) => (
    <div key={t.task_id} className="home-row" data-testid="triage-row" data-task-id={t.task_id}>
      {head(t, g.kind !== 'project')}
      <div className="home-actions">
        <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_release', task_ids: [t.task_id] })}>
          {TRIAGE_BUTTONS.release}
        </button>
        <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_drop', task_ids: [t.task_id] })}>
          {TRIAGE_BUTTONS.drop}
        </button>
        <button type="button" className="home-btn" onClick={() => onTalk(triageTalkCard(g, t))}>
          {TRIAGE_BUTTONS.talk}
        </button>
        {questionsButton(t)}
      </div>
      {questionsPanel(t)}
    </div>
  );

  const headline = [
    `${triage.count} ${triage.count === 1 ? 'idea waits' : 'ideas wait'} for you`,
    looksDone.length > 0 ? lookDoneCount(looksDone.length) : '',
    triage.open_questions > 0 ? `${triage.open_questions} ${triage.open_questions === 1 ? 'question' : 'questions'} to answer` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="home-card" data-testid="triage-card" aria-label={TRIAGE_HEADING}>
      <h2>
        {TRIAGE_HEADING}: {headline}
      </h2>
      <p className="home-small home-muted">{TRIAGE_SUBHEAD}</p>
      {looksDone.length > 0 ? (
        <div className="home-finished-group" data-testid="looks-done-group">
          <h3>
            {LOOKS_DONE_HEADING} <span className="home-small home-muted">({looksDone.length})</span>
          </h3>
          <p className="home-small home-muted">{LOOKS_DONE_HINT}</p>
          <div className="home-list">{looksDone.map(looksDoneRow)}</div>
        </div>
      ) : null}
      {shown.map((g) => {
        const expanded = open[g.key] === true;
        const rows = expanded ? g.tasks : g.tasks.slice(0, ROWS_SHOWN);
        // Ideas with no project are not a plan: each is released or dropped on its own.
        const isPlan = g.kind !== 'none';
        return (
          <div key={g.key} className="home-finished-group" data-testid="triage-group" data-group-key={g.key}>
            <h3>
              {plain(g.label)} <span className="home-small home-muted">({g.count})</span>
              {g.open_questions > 0 ? <span className="home-small home-muted"> {g.open_questions} {g.open_questions === 1 ? 'question' : 'questions'} for you</span> : null}
            </h3>
            {notes[g.key] ? <p className="home-small" role="status">{notes[g.key]}</p> : null}
            <div className="home-list">{rows.map((t) => taskRow(g, t))}</div>
            {isPlan || g.tasks.length > ROWS_SHOWN ? (
              <div className="home-actions">
                {isPlan ? (
                  <>
                    <button type="button" className="home-btn" data-filled="true" disabled={off} onClick={() => (g.still_quote ? setNotes((n) => ({ ...n, [g.key]: TRIAGE_MESSAGES.stillQuote })) : void run({ action: 'triage_release_plan', group_key: g.key }, g.key))}>
                      {TRIAGE_BUTTONS.releasePlan}
                    </button>
                    <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_drop', task_ids: g.tasks.map((t) => t.task_id).slice(0, 1000) })}>
                      {g.count === 1 ? TRIAGE_BUTTONS.drop : `${TRIAGE_BUTTONS.drop} all ${g.count}`}
                    </button>
                    <button type="button" className="home-btn" onClick={() => onTalk(triageTalkCard(g, g.count === 1 ? g.tasks[0] : undefined))}>
                      {TRIAGE_BUTTONS.talk}
                    </button>
                  </>
                ) : null}
                {g.tasks.length > ROWS_SHOWN ? (
                  <button type="button" className="home-btn" aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))}>
                    {expanded ? TRIAGE_BUTTONS.showLess : `${TRIAGE_BUTTONS.showAll} ${g.count}`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {hidden > 0 || allGroups ? (
        <div className="home-actions">
          <button type="button" className="home-btn" onClick={() => setAllGroups(!allGroups)}>
            {allGroups ? TRIAGE_BUTTONS.showLess : `${TRIAGE_BUTTONS.showAll} ${triage.groups.length} groups`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
