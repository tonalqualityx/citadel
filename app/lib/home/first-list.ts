/**
 * The first list: the one short list the home screen opens on. At most 10 rows, only what needs him, in four tiers:
 *   1. crises (a site down, a security flag: the candidates whose emergency rule is site_down or security),
 *   2. money to collect (biggest dollar amount first, then amounts not set, then sales leads waiting on his reply),
 *   3. deadlines in the next 7 days (nearest first; a date already passed counts and sorts first),
 *   4. decisions only he can make (his own tasks, any other emergency such as urgent client mail, and the Triage cards
 *      waiting on him, oldest first). A promised date close is a deadline, not a crisis.
 *
 * Pure: no Prisma, no clock but the `now` it is given. An item appears once, in its highest tier. What does not need him never
 * appears: work in progress, parked or snoozed items, FYI threads, Everything else, and handled mail. Other people's open work
 * (Overdue by others) is not a candidate at all, and the Today group is not a source (a task in it still shows if he has to decide it).
 * Nothing with a score, a class or candidate data leaves here: a row carries words, an amount or a date, and where it opens.
 */
import type {
  HomeFirstList,
  HomeFirstOpen,
  HomeFirstRow,
  HomeMoneyRow,
  HomeTileId,
  HomeTriage,
} from './types';
import type { Candidate } from './select';
import { emergencyCompare } from './select';
import { dueCivil } from './score';
import { getZonedDateString } from '@/lib/utils/time';

export const FIRST_LIST_MAX = 10;
export const FIRST_LIST_DEADLINE_DAYS = 7;
export { FIRST_LIST_EMPTY } from './first-list-copy';

export interface FirstListInput {
  candidates: readonly Candidate[];
  /** His Triage, or null for anyone else. */
  triage: HomeTriage | null;
  /** Money to collect, from the money loader (already filtered); [] when it could not be read. */
  money: readonly HomeMoneyRow[];
  /** The keys of the leads section, in the order the screen shows them. */
  leadOrder?: readonly string[];
  now: Date;
  timezone: string;
}

// ---------------------------------------------------------------- words

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function civilOf(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

function civilNum(c: { y: number; m: number; d: number }): number {
  return Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;
}

/** "Fri, Nov 13". */
export function dateWords(c: { y: number; m: number; d: number }): string {
  const dow = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
  return `${DAYS[dow]}, ${MONTHS[c.m - 1]} ${c.d}`;
}

/** "Nov 13". */
function shortDate(ymd: string): string {
  const c = civilOf(ymd);
  return `${MONTHS[c.m - 1]} ${c.d}`;
}

/** "$4,250" or "$4,250.50". */
export function moneyWords(amount: number): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

function ageWords(days: number): string {
  if (days < 1) return 'today';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// ---------------------------------------------------------------- where a row opens

const TILE_OF_SECTION: Partial<Record<Candidate['section'], HomeTileId>> = {
  needs_you_now: 'needs_you_now',
  leads: 'leads',
  mail: 'mail',
  next: 'next',
};

function openCandidate(c: Candidate): HomeFirstOpen {
  const taskId = c.item.opened.task_id;
  if (taskId) return { kind: 'task', task_id: taskId, key: c.key, title: c.item.title, item_type: c.item.type };
  return { kind: 'item', key: c.key, tile: TILE_OF_SECTION[c.section] ?? 'needs_you_now' };
}

function openMoney(m: HomeMoneyRow): HomeFirstOpen {
  if (m.project_id) return { kind: 'link', href: `/projects/${m.project_id}` };
  if (m.client_id) return { kind: 'link', href: `/clients/${m.client_id}` };
  return { kind: 'link', href: '/billing' };
}

// ---------------------------------------------------------------- tiers

function isOwn(c: Candidate): boolean {
  return !c.parked && !c.pinned && !c.fyi && c.section !== 'rest' && c.section !== 'working_on';
}

/** The two crises the approved order puts first: a site down and a security flag. Other emergency rules are not crises here. */
const CRISIS_RULES: ReadonlySet<string> = new Set(['site_down', 'security']);

function isCrisis(c: Candidate): boolean {
  return c.rule !== null && CRISIS_RULES.has(c.rule) && c.section === 'needs_you_now' && !c.pinned && !c.fyi;
}

/** Any other emergency (a promised date close, a client waiting, urgent mail): his to act on, so it stays on the list. */
function isOtherEmergency(c: Candidate): boolean {
  return c.rule !== null && !CRISIS_RULES.has(c.rule) && c.section === 'needs_you_now' && !c.pinned && !c.fyi;
}

function crisisRows(cands: readonly Candidate[]): HomeFirstRow[] {
  return cands
    .filter(isCrisis)
    .sort(emergencyCompare)
    .map((c) => ({
      key: c.key,
      tier: 'crisis' as const,
      tier_label: 'Urgent',
      title: c.item.title,
      line: c.item.why_now,
      amount: null,
      date: null,
      age: c.item.age || null,
      open: openCandidate(c),
    }));
}

function moneyRow(m: HomeMoneyRow): HomeFirstRow {
  const who = m.client_name ?? m.project_name;
  const title = who ? `${m.label} for ${who}` : m.label;
  let line: string;
  if (m.kind === 'unpaid_invoice') line = m.due ? `Unpaid since ${shortDate(m.due)}.` : 'Unpaid.';
  else if (m.kind === 'ready_invoice') line = m.due ? `Ready to send. Due ${shortDate(m.due)}.` : 'Ready to send.';
  else line = 'Ready to invoice.';
  if (m.amount === null) line += ' Amount not set.';
  return {
    key: m.key,
    tier: 'money',
    tier_label: 'Money',
    title,
    line,
    amount: m.amount === null ? null : moneyWords(m.amount),
    date: null,
    age: null,
    open: openMoney(m),
  };
}

function moneyRows(money: readonly HomeMoneyRow[], cands: readonly Candidate[], leadOrder: readonly string[] | undefined): HomeFirstRow[] {
  const withAmount = money
    .filter((m) => m.amount !== null && m.amount > 0)
    .sort((a, b) => (b.amount as number) - (a.amount as number) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const noAmount = money
    .filter((m) => m.amount === null || m.amount <= 0)
    .map((m) => ({ ...m, amount: null }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const order = new Map((leadOrder ?? []).map((k, i) => [k, i]));
  const leads = cands
    .filter((c) => c.section === 'leads' && !c.parked && !c.pinned && !c.fyi)
    .sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9));
  return [
    ...withAmount.map(moneyRow),
    ...noAmount.map(moneyRow),
    ...leads.map<HomeFirstRow>((c) => ({
      key: c.key,
      tier: 'money',
      tier_label: 'Money',
      title: c.item.title,
      line: 'A sales lead is waiting on your reply.',
      amount: null,
      date: null,
      age: c.item.age || null,
      open: openCandidate(c),
    })),
  ];
}

function deadlineRows(cands: readonly Candidate[], now: Date, timezone: string): HomeFirstRow[] {
  const today = civilNum(civilOf(getZonedDateString(now, timezone)));
  const out: { c: Candidate; civil: { y: number; m: number; d: number } }[] = [];
  for (const c of cands) {
    if (!c.hardDate || !isOwn(c)) continue;
    const civil = dueCivil(c.hardDate);
    if (civilNum(civil) - today > FIRST_LIST_DEADLINE_DAYS) continue;
    out.push({ c, civil });
  }
  out.sort((a, b) => civilNum(a.civil) - civilNum(b.civil) || a.c.since.getTime() - b.c.since.getTime() || (a.c.key < b.c.key ? -1 : 1));
  return out.map(({ c, civil }) => ({
    key: c.key,
    tier: 'deadline' as const,
    tier_label: 'Due soon',
    title: c.item.title,
    line: c.item.hard_date ?? c.item.why_now,
    amount: null,
    date: dateWords(civil),
    age: null,
    open: openCandidate(c),
  }));
}

function decisionRows(cands: readonly Candidate[], triage: HomeTriage | null, now: Date): HomeFirstRow[] {
  const dated: { at: number; row: HomeFirstRow }[] = [];
  for (const c of cands) {
    if (!((c.kind === 'task' && isOwn(c)) || isOtherEmergency(c))) continue;
    dated.push({
      at: c.since.getTime(),
      row: {
        key: c.key,
        tier: 'decision',
        tier_label: 'Your call',
        title: c.item.title,
        line: c.item.why_now,
        amount: null,
        date: null,
        age: c.item.age || null,
        open: openCandidate(c),
      },
    });
  }
  const days = (iso: string) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
  for (const card of triage?.cards ?? []) {
    dated.push({
      at: new Date(card.created_at).getTime(),
      row: {
        key: `task:${card.task_id}`,
        tier: 'decision',
        tier_label: 'Triage',
        title: card.title,
        line: card.summary || 'Waiting in Triage for your call.',
        amount: null,
        date: null,
        age: ageWords(card.age_days ?? days(card.created_at)),
        open: { kind: 'triage', task_id: card.task_id, title: card.title },
      },
    });
  }
  for (const p of triage?.client_proposals ?? []) {
    dated.push({
      at: new Date(p.created_at).getTime(),
      row: {
        key: `task:${p.task_id}`,
        tier: 'decision',
        tier_label: 'Triage',
        title: p.title,
        line: p.client_name ? `A plan for ${p.client_name} is waiting for your yes.` : 'A plan is waiting for your yes.',
        amount: null,
        date: null,
        age: ageWords(p.age_days),
        open: { kind: 'triage', task_id: p.task_id, title: p.title },
      },
    });
  }
  dated.sort((a, b) => a.at - b.at || (a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0));
  return dated.map((d) => d.row);
}

// ---------------------------------------------------------------- the list

export function buildFirstList(input: FirstListInput): HomeFirstList {
  const { candidates, triage, money, now, timezone } = input;
  const seen = new Set<string>();
  const all: HomeFirstRow[] = [];
  const take = (rows: HomeFirstRow[]) => {
    for (const r of rows) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      all.push(r);
    }
  };
  take(crisisRows(candidates));
  take(moneyRows(money, candidates, input.leadOrder));
  take(deadlineRows(candidates, now, timezone));
  take(decisionRows(candidates, triage, now));
  return { rows: all.slice(0, FIRST_LIST_MAX), more: Math.max(0, all.length - FIRST_LIST_MAX) };
}
