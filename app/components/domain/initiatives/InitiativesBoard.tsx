'use client';

import * as React from 'react';
import Link from 'next/link';
import { MessageSquare, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import type { BoardInitiative, InitiativeBoard as Board, InitiativeHealth } from '@/lib/hooks/use-initiatives';
import { FocusedAside, FocusedInitiative } from './FocusedInitiative';
import { StateMark } from './StateMark';
import { initiativeMark, monthDay, rockMark } from './format';

export interface BoardActions {
  onFocus: (id: string) => void;
  onTalk: (initiative: BoardInitiative | null) => void;
  onCheckInOpen: (initiative: BoardInitiative) => void;
  onCheckIn: (initiative: BoardInitiative, health: InitiativeHealth) => void;
  onKeepGoing: (initiative: BoardInitiative) => void;
  onStop: (initiative: BoardInitiative) => void;
  busy?: boolean;
}

function Tile({ initiative, onFocus, now }: { initiative: BoardInitiative; onFocus: () => void; now: Date }) {
  return (
    <button
      type="button"
      onClick={onFocus}
      className="w-full rounded-lg border border-border-warm bg-surface p-3 text-left shadow-soft transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      data-testid="initiative-tile"
    >
      <p className="truncate font-medium text-text-main">{initiative.name}</p>
      <StateMark mark={initiativeMark(initiative, now)} className="mt-1 text-sm" />
      <p className="mt-1 line-clamp-2 text-sm text-text-sub">
        {initiative.next_decision ? `Next: ${initiative.next_decision}` : 'No next decision written yet'}
      </p>
    </button>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The count line: each count opens what it counts (design.md 4, "clear references first"). */
function CountLine({ board, onFocus }: { board: Board; onFocus: (id: string) => void }) {
  const [open, setOpen] = React.useState<'active' | 'decisions' | 'rocks' | null>(null);
  const s = board.summary;
  const waiting = board.initiatives.filter((i) => i.status === 'active' && i.decision_waiting);
  const names = new Map(board.initiatives.map((i) => [i.id, i.name]));
  const toggle = (which: 'active' | 'decisions' | 'rocks') => setOpen((o) => (o === which ? null : which));
  const active = board.initiatives.filter((i) => i.status === 'active');
  const link = 'hover:underline focus-visible:underline focus-visible:outline-none';

  const parts: React.ReactNode[] = [];
  parts.push(
    active.length ? (
      <button
        key="a"
        type="button"
        className={link}
        aria-expanded={active.length > 1 ? open === 'active' : undefined}
        onClick={() => (active.length === 1 ? onFocus(active[0].id) : toggle('active'))}
      >
        {s.active} active
      </button>
    ) : (
      <span key="a">{s.active} active</span>
    ),
  );
  if (s.decisions_waiting) {
    const words = `${plural(s.decisions_waiting, 'decision', 'decisions')} waiting`;
    parts.push(
      <button
        key="d"
        type="button"
        className={cn('font-medium text-warning', link)}
        aria-expanded={waiting.length > 1 ? open === 'decisions' : undefined}
        onClick={() => (waiting.length === 1 ? onFocus(waiting[0].id) : toggle('decisions'))}
      >
        {words}
      </button>,
    );
  }
  if (s.rocks_this_quarter) {
    parts.push(
      <button key="r" type="button" className={link} aria-expanded={open === 'rocks'} onClick={() => toggle('rocks')}>
        {plural(s.rocks_this_quarter, 'rock', 'rocks')} this quarter
        {s.rocks_off_track ? (
          <>
            , <span className="font-medium text-warning">{s.rocks_off_track} off track</span>
          </>
        ) : null}
      </button>,
    );
  }

  return (
    <div data-testid="initiative-counts-block">
      <p className="text-sm text-text-sub" data-testid="initiative-counts">
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i ? <span aria-hidden="true"> · </span> : null}
            {p}
          </React.Fragment>
        ))}
      </p>
      {open === 'active' ? (
        <ul className="mt-2 space-y-1 text-sm" data-testid="initiative-count-list">
          {active.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-2">
              <button type="button" className={cn('text-left text-text-main', link)} onClick={() => onFocus(i.id)}>
                {i.name}
              </button>
              <StateMark mark={initiativeMark(i)} />
            </li>
          ))}
        </ul>
      ) : null}
      {open === 'decisions' ? (
        <ul className="mt-2 space-y-1 text-sm" data-testid="initiative-count-list">
          {waiting.map((i) => (
            <li key={i.id}>
              <button type="button" className={cn('text-left text-text-main', link)} onClick={() => onFocus(i.id)}>
                {i.name}
                {i.next_decision ? <span className="text-text-sub">: {i.next_decision}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open === 'rocks' ? (
        <ul className="mt-2 space-y-1 text-sm" data-testid="initiative-count-list">
          {board.quarter_rocks.map((r) => {
            const m = rockMark(r.rock_status);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-2">
                <StateMark mark={m} />
                <Link href={`/projects/${r.project_id}`} className={cn('text-text-main', link)}>
                  {r.name}
                  {r.target_date ? `, by ${monthDay(r.target_date)}` : ''}
                </Link>
                <span className="text-text-muted">({r.project_name})</span>
                {r.initiative_id && names.has(r.initiative_id) ? (
                  <button type="button" className={cn('text-primary', link)} onClick={() => onFocus(r.initiative_id!)}>
                    {names.get(r.initiative_id)}
                  </button>
                ) : (
                  <span className="text-text-muted">no initiative</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Proposed, paused and closed initiatives: one quiet line, opened on click (design.md 3.1). */
function QuietLine({ board, onFocus, focusId }: { board: Board; onFocus: (id: string) => void; focusId: string | null }) {
  const [open, setOpen] = React.useState(false);
  const quiet = board.initiatives.filter((i) => i.status !== 'active');
  if (!quiet.length) return null;
  const s = board.summary;
  const words = [s.proposed ? `${s.proposed} proposed` : null, s.paused ? `${s.paused} paused` : null, s.closed ? `${s.closed} closed` : null]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="text-sm" data-testid="initiative-quiet">
      <button type="button" className="text-text-sub hover:text-text-main hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {words}
      </button>
      {open ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {quiet.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onFocus(i.id)}
                aria-pressed={i.id === focusId}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-1.5 text-left hover:border-primary/50',
                  i.id === focusId ? 'border-primary/60 bg-surface' : 'border-border-warm bg-surface',
                )}
              >
                <span className="text-text-main">{i.name}</span>
                <StateMark mark={initiativeMark(i)} className="text-xs" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The Initiatives screen (design.md 3.1): one focused initiative, the other active ones as tiles to its right. */
export function InitiativesBoard({ board, focusId, actions, now = new Date() }: { board: Board; focusId: string | null; actions: BoardActions; now?: Date }) {
  const focused = board.initiatives.find((i) => i.id === focusId) ?? board.initiatives.find((i) => i.id === board.focus_id) ?? null;
  const tiles = board.initiatives.filter((i) => i.status === 'active' && i.id !== focused?.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-2xl font-bold text-text-main">Initiatives</h1>
        <p className="text-sm text-text-sub">What you are betting on, and the one decision each needs.</p>
      </div>

      {!focused ? (
        <Card>
          <EmptyState
            icon={<Target className="h-10 w-10" />}
            title="No initiatives yet"
            description="An initiative is one bet you are making for Indelible. Set the first one up in the chat."
            action={
              <Button size="sm" onClick={() => actions.onTalk(null)}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                Talk it through
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <CountLine board={board} onFocus={actions.onFocus} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
            <FocusedInitiative
              initiative={focused}
              now={now}
              actions={{
                onTalk: () => actions.onTalk(focused),
                onCheckInOpen: () => actions.onCheckInOpen(focused),
                onCheckIn: (h) => actions.onCheckIn(focused, h),
                onKeepGoing: () => actions.onKeepGoing(focused),
                onStop: () => actions.onStop(focused),
                busy: actions.busy,
              }}
            />
            <div className="space-y-6">
              {tiles.length ? (
                <div className="grid grid-cols-2 gap-3" aria-label="Other active initiatives">
                  {tiles.map((t) => (
                    <Tile key={t.id} initiative={t} now={now} onFocus={() => actions.onFocus(t.id)} />
                  ))}
                </div>
              ) : null}
              <FocusedAside initiative={focused} />
            </div>
          </div>
          <QuietLine board={board} onFocus={actions.onFocus} focusId={focused.id} />
        </>
      )}
    </div>
  );
}
