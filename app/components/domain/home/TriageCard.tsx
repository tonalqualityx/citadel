'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeActRequest, HomeTriage, HomeTriageGroup, HomeTriageTask } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { TRIAGE_BUTTONS, TRIAGE_HEADING, TRIAGE_MESSAGES, TRIAGE_SUBHEAD } from '@/lib/tasks/triage-copy';
import { plain } from './home-screen-logic';
import { triageTalkCard } from './triage-talk';

export interface TriageCardProps {
  triage: HomeTriage;
  /** The three triage acts. Resolves when the server answered; the hook has already shown the toast with Undo. */
  onAct: (request: HomeActRequest) => Promise<unknown>;
  /** Talk about this: the group or the one idea, handed to the chat. */
  onTalk: (card: OpenCardInput) => void;
  busy?: boolean;
}

/** Groups shown before "Show all": the section must not push the day's list off the top. */
const GROUPS_SHOWN = 5;

/**
 * The Triage section: ideas parked for his release, by project (or pass group). A count, up to three titles per group, expandable to
 * all of them. Release, Drop and Talk about this on each idea; Release plan, Drop and Talk about this on each group. Nothing starts
 * until a tap, and every tap has Undo for 72 hours in the toast and in Handled for you.
 */
export function TriageCard({ triage, onAct, onTalk, busy = false }: TriageCardProps) {
  const [working, setWorking] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [allGroups, setAllGroups] = React.useState(false);
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
  const shown = allGroups ? triage.groups : triage.groups.slice(0, GROUPS_SHOWN);
  const hidden = triage.groups.length - shown.length;

  const taskRow = (g: HomeTriageGroup, t: HomeTriageTask) => (
    <li key={t.task_id} className="home-finished-row" data-task-id={t.task_id}>
      <Link href={t.href}>{plain(t.title)}</Link>
      {g.kind !== 'project' && t.project_name ? <span className="home-small home-muted"> {plain(t.project_name)}</span> : null}
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
      </div>
    </li>
  );

  return (
    <section className="home-card" data-testid="triage-card" aria-label={TRIAGE_HEADING}>
      <h2>
        {TRIAGE_HEADING}: {triage.count} {triage.count === 1 ? 'idea waits' : 'ideas wait'} for you
      </h2>
      <p className="home-small home-muted">{TRIAGE_SUBHEAD}</p>
      {shown.map((g) => {
        const expanded = open[g.key] === true;
        const more = g.count - g.titles.length;
        return (
          <div key={g.key} className="home-finished-group" data-testid="triage-group" data-group-key={g.key}>
            <h3>
              {plain(g.label)} <span className="home-small home-muted">({g.count})</span>
            </h3>
            {notes[g.key] ? <p className="home-small" role="status">{notes[g.key]}</p> : null}
            {expanded ? (
              <ul>{g.tasks.map((t) => taskRow(g, t))}</ul>
            ) : (
              <ul>
                {g.titles.map((t, i) => (
                  <li key={i}>{plain(t)}</li>
                ))}
              </ul>
            )}
            <div className="home-actions">
              <button type="button" className="home-btn" data-filled="true" disabled={off} onClick={() => (g.still_quote ? setNotes((n) => ({ ...n, [g.key]: TRIAGE_MESSAGES.stillQuote })) : void run({ action: 'triage_release_plan', group_key: g.key }, g.key))}>
                {TRIAGE_BUTTONS.releasePlan}
              </button>
              <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'triage_drop', task_ids: g.tasks.map((t) => t.task_id).slice(0, 1000) })}>
                {g.count === 1 ? TRIAGE_BUTTONS.drop : `${TRIAGE_BUTTONS.drop} all ${g.count}`}
              </button>
              <button type="button" className="home-btn" onClick={() => onTalk(triageTalkCard(g))}>
                {TRIAGE_BUTTONS.talk}
              </button>
              {more > 0 || expanded ? (
                <button type="button" className="home-btn" aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))}>
                  {expanded ? TRIAGE_BUTTONS.showLess : `${TRIAGE_BUTTONS.showAll} ${g.count}`}
                </button>
              ) : null}
            </div>
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
