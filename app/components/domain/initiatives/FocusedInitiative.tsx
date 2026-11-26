'use client';

import * as React from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import type { BoardInitiative, InitiativeHealth } from '@/lib/hooks/use-initiatives';
import { MarkShape, StateMark } from './StateMark';
import { Sparkline } from './Sparkline';
import { formatValue, initiativeMark, monthDay, paceWord, rockMark, TONE_CLASS } from './format';

export interface FocusedActions {
  onTalk: () => void;
  /** Check in: opens the chat on this initiative with the check-in question; the same question is answerable here with a tap. */
  onCheckInOpen: () => void;
  onCheckIn: (health: InitiativeHealth) => void;
  onKeepGoing: () => void;
  onStop: () => void;
  busy?: boolean;
}

/** One field on one line, cut at the line end; a click shows the whole text in place (nothing on another screen). */
function OneLine({ label, text }: { label: string; text: string | null }) {
  const [open, setOpen] = React.useState(false);
  const value = text?.trim();
  if (!value) {
    return (
      <p className="text-sm">
        <span className="font-semibold text-text-main">{label}</span> <span className="text-text-muted">Not written yet</span>
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className={cn('block w-full text-left text-sm leading-5 text-text-sub hover:text-text-main', open ? 'whitespace-pre-wrap' : 'truncate')}
    >
      <span className="text-sm font-semibold text-text-main">{label}</span> <span className="text-sm">{value}</span>
    </button>
  );
}

const ATTACHED_SHOWN = 6;

function AttachedList({ initiative }: { initiative: BoardInitiative }) {
  const [all, setAll] = React.useState(false);
  const rows: { key: string; label: string; kind: string; href?: string }[] = [
    ...initiative.attached.projects.map((p) => ({ key: `p:${p.id}`, label: p.name, kind: 'project', href: `/projects/${p.id}` })),
    ...initiative.attached.recurring.map((r) => ({ key: `r:${r.id}`, label: r.title, kind: r.is_active ? 'recurring' : 'recurring, paused' })),
    ...initiative.attached.tasks.map((t) => ({ key: `t:${t.id}`, label: t.title, kind: 'task', href: `/tasks/${t.id}` })),
  ];
  const shown = all ? rows : rows.slice(0, ATTACHED_SHOWN);
  return (
    <ul className="space-y-1 text-sm">
      {shown.map((r) => (
        <li key={r.key} className="truncate text-text-sub">
          <span aria-hidden="true">▸ </span>
          {r.href ? (
            <Link href={r.href} className="text-text-main hover:underline">
              {r.label}
            </Link>
          ) : (
            <span className="text-text-main">{r.label}</span>
          )}{' '}
          <span className="text-text-muted">({r.kind})</span>
        </li>
      ))}
      {rows.length > ATTACHED_SHOWN ? (
        <li>
          <button type="button" className="text-sm text-primary hover:underline" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** The right-hand facts of the focused initiative: what is attached, the check dates and the stop condition. */
export function FocusedAside({ initiative }: { initiative: BoardInitiative }) {
  const parts = initiative.attached;
  const counts = [
    parts.projects.length ? `${parts.projects.length} ${parts.projects.length === 1 ? 'project' : 'projects'}` : null,
    parts.recurring.length ? `${parts.recurring.length} recurring` : null,
    parts.tasks.length ? `${parts.tasks.length} ${parts.tasks.length === 1 ? 'task' : 'tasks'}` : null,
  ].filter(Boolean);
  const checked = initiative.latest_check_in ? `Checked ${monthDay(initiative.latest_check_in.created_at)}` : 'No check-in yet';
  const next = initiative.check_date ? `next check ${monthDay(initiative.check_date)}` : 'no check date set';
  return (
    <div className="space-y-4" data-testid="initiative-aside">
      <section aria-label="Attached">
        <h3 className="text-sm font-semibold text-text-main">Attached</h3>
        <p className="mb-1 text-sm text-text-sub">{counts.length ? counts.join(' · ') : 'Nothing attached yet. Attaching is optional.'}</p>
        {initiative.attached_count ? <AttachedList initiative={initiative} /> : null}
      </section>
      <p className="text-sm text-text-sub">
        {checked} · {next}
      </p>
      <p className="text-sm text-text-sub">
        <span className="font-semibold text-text-main">Stop if:</span> {initiative.stop_condition?.trim() || 'Not written yet'}
      </p>
    </div>
  );
}

export function FocusedInitiative({ initiative, actions, now = new Date() }: { initiative: BoardInitiative; actions: FocusedActions; now?: Date }) {
  const [asking, setAsking] = React.useState(false);
  React.useEffect(() => setAsking(false), [initiative.id]);
  const mark = initiativeMark(initiative, now);
  const isActive = initiative.status === 'active';

  return (
    <Card className="p-6" data-testid="initiative-focused" aria-label={`${initiative.name}, ${mark.word}`}>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold text-text-main">{initiative.name}</h2>
        <StateMark mark={mark} className="text-base" />
      </div>
      {initiative.health_reason ? <p className="mt-1 text-sm text-text-sub">{initiative.health_reason}</p> : null}

      {initiative.stop_check_due ? (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4" data-testid="stop-check">
          <p className="text-sm text-text-main">
            <span className="font-semibold">Time to judge the stop condition: its target date has passed and a target was missed.</span> Stop if:{' '}
            {initiative.stop_condition}
          </p>
          <div className="mt-3 flex gap-3">
            <Button variant="secondary" size="sm" disabled={actions.busy} onClick={actions.onKeepGoing}>
              Keep going
            </Button>
            <Button variant="secondary" size="sm" disabled={actions.busy} onClick={actions.onStop}>
              Stop it
            </Button>
          </div>
        </div>
      ) : null}

      <section className="mt-5" aria-label="Next decision">
        <h3 className="text-sm font-semibold text-text-main">Next decision</h3>
        <p className={cn('mt-1 text-base', initiative.next_decision ? 'text-text-main' : 'text-text-muted')}>
          {initiative.next_decision || 'No decision written yet. Talk it through to name the next one.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={actions.onTalk}>
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Talk it through
          </Button>
          {isActive ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!asking) actions.onCheckInOpen();
                setAsking((a) => !a);
              }}
              aria-expanded={asking}
            >
              Check in
            </Button>
          ) : null}
        </div>
        {asking ? (
          <div className="mt-3 rounded-lg border border-border-warm bg-surface-alt p-3" data-testid="check-in-question">
            <p className="text-sm text-text-main">On track, behind, or something changed?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={actions.busy} onClick={() => actions.onCheckIn('on_track')}>
                On track
              </Button>
              <Button variant="secondary" size="sm" disabled={actions.busy} onClick={() => actions.onCheckIn('behind')}>
                Behind
              </Button>
              <Button variant="secondary" size="sm" onClick={actions.onTalk}>
                Something changed
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-6" aria-label="Numbers">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="pb-1 font-medium">Numbers</th>
              <th className="pb-1 font-medium">Now</th>
              <th className="pb-1 font-medium">Target</th>
              <th className="pb-1 font-medium">Pace</th>
              <th className="pb-1 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {initiative.numbers.length ? (
              initiative.numbers.map((n) => {
                const pace = paceWord(n);
                return (
                  <tr key={n.id} className="border-t border-border-warm/60">
                    <td className="py-1.5 pr-3 text-text-main">{n.label}</td>
                    <td className="py-1.5 pr-3 font-medium text-text-main">{formatValue(n.last_value ?? n.baseline_value, n.unit)}</td>
                    <td className="py-1.5 pr-3 text-text-sub">
                      {formatValue(n.target_value, n.unit)} by {monthDay(n.target_by)}
                    </td>
                    <td className={cn('py-1.5 pr-3', TONE_CLASS[pace.tone])}>
                      <span className="inline-flex items-center gap-1.5">
                        <MarkShape shape={pace.shape} />
                        {pace.word}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <Sparkline number={n} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="py-1.5 text-text-muted">
                  No numbers yet. The chat asks for one to three.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6" aria-label="Rocks this quarter">
        <h3 className="text-sm font-semibold text-text-main">Rocks this quarter</h3>
        {initiative.rocks.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {initiative.rocks.map((r) => {
              const m = rockMark(r.rock_status);
              return (
                <li key={r.id} className="flex gap-2">
                  <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', TONE_CLASS[m.tone])}>
                    <MarkShape shape={m.shape} />
                    {m.word}
                  </span>
                  <Link href={`/projects/${r.project_id}`} className="text-text-main hover:underline">
                    {r.name}
                    {r.target_date ? `, by ${monthDay(r.target_date)}` : ''}
                    {r.rock_status === 'off_track' && r.rock_decision ? `: ${r.rock_decision}` : ''}
                    {r.rock_status === 'off_track' && !r.rock_decision ? ': past its date' : ''}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-text-muted">No rocks this quarter on its projects.</p>
        )}
      </section>

      <section className="mt-6 space-y-1" aria-label="The bet">
        <OneLine label="The bet" text={initiative.bet} />
        <OneLine label="Nightmare" text={initiative.nightmare} />
        <OneLine label="Prevention" text={initiative.prevention} />
        <OneLine label="Repair" text={initiative.repair} />
        <OneLine label="Cost of waiting" text={initiative.cost_of_waiting} />
        {initiative.status === 'stopped' || initiative.status === 'done' ? (
          <OneLine label={initiative.status === 'done' ? 'Closed' : 'Why it stopped'} text={initiative.closed_reason} />
        ) : null}
      </section>
    </Card>
  );
}
