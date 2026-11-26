import type { BoardInitiative, BoardNumber, RockStatus } from '@/lib/hooks/use-initiatives';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 2". Calendar dates are stored as UTC midnight, so they are read in UTC. */
export function monthDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** A number in its unit: "$1,200", "12%", "3.5 h", "4". */
export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not read';
  const rounded = Math.round(value * 100) / 100;
  const plain = rounded.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (unit === 'dollars') return `$${plain}`;
  if (unit === 'percent') return `${plain}%`;
  if (unit === 'hours') return `${plain} h`;
  return plain;
}

export type MarkTone = 'on' | 'attention' | 'quiet' | 'done';

export interface StateMarkInfo {
  shape: string;
  word: string;
  tone: MarkTone;
}

/** Shape plus word, colour third (design.md 3): the one mark an initiative shows. */
export function initiativeMark(i: Pick<BoardInitiative, 'status' | 'health' | 'check_date' | 'closed_at'>, now: Date = new Date()): StateMarkInfo {
  if (i.status === 'done') return { shape: '✓', word: 'Done', tone: 'done' };
  if (i.status === 'stopped') {
    const when = monthDay(i.closed_at);
    return { shape: '■', word: when ? `Stopped: decided ${when}` : 'Stopped', tone: 'quiet' };
  }
  if (i.status === 'paused') return { shape: '○', word: 'Paused', tone: 'quiet' };
  if (i.status === 'proposed') return { shape: '○', word: 'Proposed', tone: 'quiet' };
  if (i.health === 'on_track') return { shape: '●', word: 'On track', tone: 'on' };
  if (i.health === 'behind') return { shape: '◐', word: 'Behind', tone: 'attention' };
  const passed = i.check_date && utcDay(new Date(i.check_date)) < utcDay(now);
  return { shape: '○', word: passed ? `Not checked since ${monthDay(i.check_date)}` : 'Not checked yet', tone: 'quiet' };
}

export function rockMark(status: RockStatus): StateMarkInfo {
  if (status === 'done') return { shape: '✓', word: 'Done', tone: 'done' };
  if (status === 'off_track') return { shape: '◐', word: 'Off track', tone: 'attention' };
  return { shape: '●', word: 'On track', tone: 'on' };
}

/** Where one number stands, in words. */
export function paceWord(n: Pick<BoardNumber, 'pace'>): StateMarkInfo {
  if (n.pace === 'met') return { shape: '✓', word: 'Met', tone: 'done' };
  if (n.pace === 'on_pace') return { shape: '●', word: 'On pace', tone: 'on' };
  if (n.pace === 'behind') return { shape: '◐', word: 'Behind pace', tone: 'attention' };
  return { shape: '○', word: 'No pace yet', tone: 'quiet' };
}

export const TONE_CLASS: Record<MarkTone, string> = {
  on: 'text-primary',
  attention: 'text-warning',
  quiet: 'text-text-muted',
  done: 'text-success',
};

/** "2 projects · 1 recurring · 3 tasks", leaving out the kinds with none. */
export function attachedLine(a: BoardInitiative['attached']): string {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (a.projects.length) parts.push(plural(a.projects.length, 'project', 'projects'));
  if (a.recurring.length) parts.push(`${a.recurring.length} recurring`);
  if (a.tasks.length) parts.push(plural(a.tasks.length, 'task', 'tasks'));
  return parts.length ? parts.join(' · ') : 'Nothing attached yet';
}
