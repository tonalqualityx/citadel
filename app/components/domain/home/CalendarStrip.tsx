'use client';

/**
 * CalendarStrip (Slice 10a): "On your calendar", at the top of the Today tile's left pane.
 * Each row is a time and who the meeting is with, nothing else; the meeting drawer has the
 * rest. Renders nothing when the strip is empty. It never fetches and never posts.
 */
import { useState } from 'react';
import type { HomeCalendarRow, HomeCalendarStrip } from '@/lib/home/calendar/types';
import { GROUP_HEADING, earlierText, laterText } from '@/lib/home/calendar/copy';
import { plain } from './home-screen-logic';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const GROUP = 'border-t border-[var(--border)] px-3.5 pb-1.5 pt-3 text-[0.72rem] font-bold uppercase tracking-[0.05em] text-[var(--text-muted)] first:border-t-0';
const ROW = 'grid w-full min-w-0 grid-cols-[4.5rem_1fr] gap-2 px-3.5 py-[7px] text-left text-[0.9rem]';

export interface CalendarStripProps {
  /** GET /api/home/calendar, or null/undefined while it loads or when it failed. */
  strip: HomeCalendarStrip | null | undefined;
  /** CalendarEvent.id of the row opened in the drawer, if any. */
  selectedId?: string | null;
  onOpen: (eventId: string) => void;
}

function Row({ row, selected, onOpen, forceMuted = false }: { row: HomeCalendarRow; selected: boolean; onOpen: (id: string) => void; forceMuted?: boolean }) {
  const muted = row.muted || forceMuted;
  const tone = muted ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]';
  const inner = (
    <>
      <span className={`font-semibold tabular-nums ${tone}`}>{plain(row.time)}</span>
      <span className={`min-w-0 break-words ${tone}`}>{plain(row.who)}</span>
    </>
  );
  if (!row.openable) {
    return (
      <div data-testid="calendar-row" className={ROW}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid="calendar-row"
      aria-current={selected ? 'true' : 'false'}
      onClick={() => onOpen(row.id)}
      className={`${ROW} border-l-[3px] ${selected ? 'border-l-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-l-transparent'} ${FOCUS}`}
    >
      {inner}
    </button>
  );
}

function Toggle({ label, open, onClick, controls }: { label: string; open: boolean; onClick: () => void; controls: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
      className={`w-full px-3.5 py-[7px] text-left text-[0.85rem] text-[var(--text-muted)] underline-offset-2 hover:underline ${FOCUS}`}
    >
      {label}
    </button>
  );
}

export function CalendarStrip({ strip, selectedId = null, onOpen }: CalendarStripProps) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  if (!strip) return null;
  if (strip.upcoming.length === 0 && !strip.tomorrow) return null;

  return (
    <section data-testid="home-calendar-strip" aria-label={GROUP_HEADING} className="flex min-w-0 flex-col">
      <h3 className={GROUP}>{GROUP_HEADING}</h3>

      {strip.earlier.length > 0 ? (
        <>
          <Toggle label={earlierText(strip.earlier.length)} open={earlierOpen} onClick={() => setEarlierOpen((o) => !o)} controls="calendar-earlier" />
          {earlierOpen ? (
            <div id="calendar-earlier">
              {strip.earlier.map((r) => (
                <Row key={r.id} row={r} forceMuted selected={r.id === selectedId} onOpen={onOpen} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {strip.upcoming.map((r) => (
        <Row key={r.id} row={r} selected={r.id === selectedId} onOpen={onOpen} />
      ))}

      {strip.later.length > 0 ? (
        <>
          <Toggle label={laterText(strip.later.length)} open={laterOpen} onClick={() => setLaterOpen((o) => !o)} controls="calendar-later" />
          {laterOpen ? (
            <div id="calendar-later">
              {strip.later.map((r) => (
                <Row key={r.id} row={r} selected={r.id === selectedId} onOpen={onOpen} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {strip.all_day ? <p data-testid="calendar-all-day" className="m-0 px-3.5 py-[7px] text-[0.9rem] text-[var(--text-muted)]">{plain(strip.all_day)}</p> : null}

      {strip.tomorrow ? <Row row={strip.tomorrow} forceMuted selected={strip.tomorrow.id === selectedId} onOpen={onOpen} /> : null}
    </section>
  );
}

export interface CalendarSoonLineProps {
  /** HomeCalendarStrip.soon. */
  row: HomeCalendarRow | null | undefined;
  onOpen: (eventId: string) => void;
}

/** The one line above a pinned card: a meeting under way or starting within 30 minutes. */
export function CalendarSoonLine({ row, onOpen }: CalendarSoonLineProps) {
  if (!row) return null;
  return (
    <button
      type="button"
      data-testid="calendar-soon"
      onClick={() => onOpen(row.id)}
      className={`flex w-full min-w-0 gap-3 px-3.5 py-2 text-left text-[0.9rem] ${FOCUS}`}
    >
      <span className="w-[4.5rem] shrink-0 font-semibold tabular-nums">{plain(row.time)}</span>
      <span className="min-w-0 break-words">{plain(row.who)}</span>
    </button>
  );
}
