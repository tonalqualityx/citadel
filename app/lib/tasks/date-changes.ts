/**
 * A project's start or launch date changed with a source (the chat lane through a Triage card, Dox through its project PATCH, or the owner when he
 * names one): one change line per changed date on every project-setup card of that project, with old value, new value and the source kept in
 * `detail`. Lines are area plan:dates, so they bump triage_rev while the card is in Triage the way a plan write does, and the plan header and the
 * Dates section read them back ("Launch moved from Dec 4, 2026 to Jan 9, 2027, from the SOW").
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { shortDay } from './plan-summary';
import { recordTriageChange, type Actor } from './triage-rev';
import type { DateSource, DateSourceOut } from './plan-schema';

type Db = PrismaClient | Prisma.TransactionClient;
export type DateField = 'start_date' | 'target_date';
export const DATE_AREA = 'plan:dates';
const WORD: Record<DateField, string> = { start_date: 'Start', target_date: 'Launch' };

export interface DateChange {
  field: DateField;
  from: string | null;
  to: string | null;
}

const long = (iso: string) => `${shortDay(iso)}, ${iso.slice(0, 4)}`;

/** "Launch moved from Dec 4, 2026 to Jan 9, 2027, from <label>" (set, or cleared, when there is no old or new day). At most 240 characters. */
export function dateChangeLine(c: DateChange, source: DateSource): string {
  const w = WORD[c.field];
  const head = c.from && c.to ? `${w} moved from ${long(c.from)} to ${long(c.to)}` : c.to ? `${w} set to ${long(c.to)}` : `${w} cleared`;
  const tail = `, from ${source.label}`;
  return (head + tail).slice(0, 240);
}

/** The days that really changed, given the project's current values and the requested ones (undefined = not asked). */
export function changedDates(current: { start_date: Date | null; target_date: Date | null }, asked: { start_date?: string | null; target_date?: string | null }): DateChange[] {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const out: DateChange[] = [];
  for (const f of ['start_date', 'target_date'] as const) {
    if (asked[f] === undefined) continue;
    const from = day(current[f]);
    const to = asked[f] ? (asked[f] as string).slice(0, 10) : null;
    if (from !== to) out.push({ field: f, from, to });
  }
  return out;
}

/** One line per changed date on every project-setup card of the project. Returns the number of lines written. */
export async function recordDateChanges(db: Db, projectId: string, changes: DateChange[], actor: Actor, source: DateSource): Promise<number> {
  if (changes.length === 0) return 0;
  const cards = await db.task.findMany({ where: { project_id: projectId, triage_kind: 'project_setup', is_deleted: false }, select: { id: true } });
  let n = 0;
  for (const card of cards) {
    for (const c of changes) {
      const detail = { field: c.field, from: c.from, to: c.to, source } as unknown as Prisma.InputJsonValue;
      await recordTriageChange(db, card.id, DATE_AREA, dateChangeLine(c, source), actor, null, detail);
      n += 1;
    }
  }
  return n;
}

interface ChangeRow {
  line: string;
  by: string;
  created_at: Date;
  detail: unknown;
}

/** From a card's plan:dates rows (newest first): the source of each current date, and the latest sourced lines. A source that no longer matches the date's value is dropped. */
export function readDateSources(rows: ChangeRow[], current: { start_date: string | null; target_date: string | null }): { start: DateSourceOut | null; launch: DateSourceOut | null; changes: { line: string; at: string; by: string }[] } {
  const out: { start: DateSourceOut | null; launch: DateSourceOut | null; changes: { line: string; at: string; by: string }[] } = { start: null, launch: null, changes: [] };
  const seen = new Set<DateField>();
  for (const r of rows) {
    const d = r.detail as { field?: DateField; to?: string | null; source?: DateSource } | null;
    if (!d || !d.field || !d.source) continue;
    if (out.changes.length < 5) out.changes.push({ line: r.line, at: r.created_at.toISOString(), by: r.by });
    if (seen.has(d.field)) continue;
    seen.add(d.field);
    if ((d.to ?? null) !== current[d.field]) continue; // a later change did not name a source: the old one no longer describes the value
    out[d.field === 'start_date' ? 'start' : 'launch'] = { ...d.source, at: r.created_at.toISOString(), by: r.by };
  }
  return out;
}
