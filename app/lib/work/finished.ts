/**
 * Work stage G: the evidence engine behind the one-time "looks finished" sweep. Pure, code only, no model call, no database.
 *
 * A task is a candidate only when something concrete says the work is done. A task with no evidence is never a candidate.
 * The evidence, as built (each is read from the place named):
 *
 * Strong
 *   go_live_receipt  a TaskReceipt of step live, or with live_url set, made after the task was created (task_receipts)
 *   project_done     the task's project is done or cancelled (projects.status)
 *   worker_done      the worker ledger's `done` line for the task, after the task's last update (posted by the machine)
 *   mike_words       a sent-mail reconcile row (home_reconcile_change) for the task that quotes the owner's own words: a done
 *                    card left open or expired, or a note
 *   meeting_held     for a task titled or tagged as a call or meeting: a CalendarEvent that has ended, after the task was
 *                    created, with an attendee matching the task's client contacts or its requester (calendar_events)
 * Medium
 *   asks_answered    every email linked to the task is closed and our side replied after the newest one (email_asks,
 *                    email_outbox)
 *   same_work_done   a later done task for the same client whose title overlaps this one by 0.6 or more (tasks)
 *   commit           a commit in the task's site repo or project folder after creation that names the task's short id or
 *                    overlaps its title (posted by the machine)
 *   orphan_sweep     filed by the old session sweep ("Orphaned thread:"), at least 7 days old, and not the one the owner
 *                    asked to keep (tasks). Medium, and always in its own group.
 *
 * Never offered: a deleted task; a task that is not open; a task assigned to another person (counted, not listed); a task
 * edited in the last 48 hours; a task the owner said is not finished (held 90 days, see finished-store.ts).
 *
 * Groups (the order decides): security (a security tag), portal (a client can see it), unticked (a checklist item is not
 * ticked), orphan, main. Only main and orphan ever close in a batch.
 *
 * The text here is plain words: no em or en dash, and a stored title or quote goes through displayText.
 */

import { displayText } from '@/lib/home/copy';
import { isSecurityTagged } from './ask-closure';
import { shortDate } from './copy';

export const EDIT_QUIET_HOURS = 48;
export const KEEP_DAYS = 90;
export const ORPHAN_MIN_AGE_DAYS = 7;
export const ORPHAN_PREFIX = 'orphaned thread';
/** The one orphan task the owner asked to keep (ruling b2). Matched on the start of its id. */
export const ORPHAN_KEEP_ID_PREFIXES: readonly string[] = ['c4722a17'];
export const TITLE_OVERLAP_MIN = 0.6;
/** Task statuses that can still be finished. */
export const OPEN_STATUSES: readonly string[] = ['not_started', 'in_progress', 'review', 'blocked'];

export type EvidenceKind =
  | 'go_live_receipt'
  | 'project_done'
  | 'worker_done'
  | 'mike_words'
  | 'meeting_held'
  | 'asks_answered'
  | 'same_work_done'
  | 'commit'
  | 'delivered_file'
  | 'orphan_sweep';

export const STRONG_KINDS: readonly EvidenceKind[] = ['go_live_receipt', 'project_done', 'worker_done', 'mike_words', 'meeting_held'];
export const MACHINE_KINDS = ['worker_done', 'commit'] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

export type FinishedGroup = 'main' | 'security' | 'portal' | 'unticked' | 'orphan';
export type Strength = 'strong' | 'medium';

/** One line of evidence as stored on the item and shown on the card. */
export interface EvidenceLine {
  kind: EvidenceKind;
  line: string;
  href: string | null;
  /** ISO instant the evidence is dated, or null. */
  at: string | null;
}

export interface TaskFacts {
  id: string;
  title: string;
  status: string;
  tags: readonly string[];
  client_visible: boolean;
  assignee_id: string | null;
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
  /** requirements and review_requirements JSON, as stored. */
  requirements: unknown;
  review_requirements: unknown;
  project: { id: string; name: string; status: string } | null;
  client_id: string | null;
}

export interface Signals {
  receipts: { step: string; live_url: string | null; created_at: Date }[];
  /** Posted by the machine: the worker ledger's done line, a commit. */
  machine: { kind: MachineKind; ref: string; at: Date }[];
  /** Sent-mail reconcile rows for the task. */
  reconcile: { kind: string; mode: string; state: string; quote: string | null; quote_to: string | null; quote_at: Date | null; link: string | null }[];
  /** Calendar events that have ended, with the attendee emails lowercased. */
  calendar: { title: string; ends_at: Date; attendee_emails: string[]; attendee_names: string[] }[];
  /** Emails the task's client contacts and requester can be matched on, lowercased. */
  contact_emails: string[];
  contact_names: string[];
  /** Emails linked to the task. */
  asks: { state: string; closed_reason: string | null; received_at: Date }[];
  /** When our side sent mail in the task's threads or for the task. */
  outbox_sent: Date[];
  /** Done tasks of the same client finished after this one was created. */
  later_done: { id: string; title: string; completed_at: Date }[];
}

export interface Verdict {
  group: FinishedGroup;
  strength: Strength;
  evidence: EvidenceLine[];
}

// ----------------------------------------------------------------------------
// Small rules
// ----------------------------------------------------------------------------

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'new', 'add', 'fix', 'update', 'site', 'page', 'task']);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Overlap of the meaningful words of two titles: the shared words over the shorter title's words, 0 to 1. */
export function titleOverlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / Math.min(x.size, y.size);
}

/** Whether any checklist item (flat or inside a section) is not ticked. Both checklists count. */
export function hasUntickedItem(...lists: unknown[]): boolean {
  const unticked = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as { type?: unknown; items?: unknown; completed?: unknown };
    if (e.type === 'section' || Array.isArray(e.items)) return Array.isArray(e.items) && e.items.some(unticked);
    return e.completed !== true;
  };
  return lists.some((l) => Array.isArray(l) && l.some(unticked));
}

export function isMeetingTask(task: Pick<TaskFacts, 'title' | 'tags'>): boolean {
  const hay = `${task.title} ${task.tags.join(' ')}`.toLowerCase();
  return /\b(call|meeting|meet|zoom|interview|walkthrough|kickoff)\b/.test(hay);
}

export function isOrphanTask(task: Pick<TaskFacts, 'id' | 'title'>): boolean {
  if (!task.title.toLowerCase().startsWith(ORPHAN_PREFIX)) return false;
  return !ORPHAN_KEEP_ID_PREFIXES.some((p) => task.id.toLowerCase().startsWith(p));
}

export type Eligibility = 'ok' | 'other_user' | 'skip';

/**
 * Whether the task may be offered. `other_user` is a task assigned to another person: it is only counted. Assigned to the owner,
 * to no one, or to a bot user is fine.
 */
export function eligibility(task: TaskFacts, ownerId: string, botIds: readonly string[], now: Date): Eligibility {
  if (task.is_deleted || !OPEN_STATUSES.includes(task.status)) return 'skip';
  if (task.assignee_id && task.assignee_id !== ownerId && !botIds.includes(task.assignee_id)) return 'other_user';
  if (now.getTime() - task.updated_at.getTime() < EDIT_QUIET_HOURS * 3_600_000) return 'skip';
  return 'ok';
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}...`);

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// The evidence
// ----------------------------------------------------------------------------

export function evidenceFor(task: TaskFacts, s: Signals, now: Date, zone?: string): EvidenceLine[] {
  const out: EvidenceLine[] = [];
  const created = task.created_at.getTime();
  const taskHref = `/tasks/${task.id}`;

  // Strong: a go-live receipt after the task was made.
  const live = s.receipts
    .filter((r) => (r.step === 'live' || !!r.live_url) && r.created_at.getTime() > created)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  if (live) {
    const host = hostOf(live.live_url);
    out.push({ kind: 'go_live_receipt', line: `Live${host ? ` on ${host}` : ''} since ${shortDate(live.created_at, zone)} (go-live receipt)`, href: live.live_url || taskHref, at: iso(live.created_at) });
  }

  // Strong: its project is finished.
  if (task.project && (task.project.status === 'done' || task.project.status === 'cancelled')) {
    const name = displayText(task.project.name) || 'its project';
    out.push({ kind: 'project_done', line: task.project.status === 'done' ? `Its project "${name}" is done` : `Its project "${name}" was cancelled`, href: `/projects/${task.project.id}`, at: null });
  }

  // Strong: the worker ran it to done after the task's last update.
  const worker = s.machine
    .filter((m) => m.kind === 'worker_done' && m.at.getTime() > task.updated_at.getTime() && m.at.getTime() <= now.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (worker) {
    const still = task.status.replace(/_/g, ' ');
    out.push({ kind: 'worker_done', line: `Bast finished it on ${shortDate(worker.at, zone)} (worker run), still marked ${still}`, href: taskHref, at: iso(worker.at) });
  }

  // Strong: the owner's own past-tense words in a sent-mail card or note.
  const words = s.reconcile
    .filter((r) => !!r.quote && r.state !== 'dismissed' && r.state !== 'undone' && ((r.kind === 'done' && (r.state === 'open' || r.state === 'expired')) || (r.kind === 'note' && r.mode !== 'none')))
    .sort((a, b) => (b.quote_at?.getTime() ?? 0) - (a.quote_at?.getTime() ?? 0))[0];
  if (words && words.quote) {
    const to = displayText(words.quote_to) || 'them';
    const when = words.quote_at ? ` on ${shortDate(words.quote_at, zone)}` : '';
    out.push({ kind: 'mike_words', line: `Your email to ${to}${when}: "${clip(displayText(words.quote), 140)}"`, href: words.link, at: iso(words.quote_at) });
  }

  // Strong: the meeting happened.
  if (isMeetingTask(task)) {
    const mine = new Set(s.contact_emails.map((e) => e.toLowerCase()));
    const ev = s.calendar
      .filter((e) => e.ends_at.getTime() <= now.getTime() && e.ends_at.getTime() > created && e.attendee_emails.some((a) => mine.has(a.toLowerCase())))
      .sort((a, b) => b.ends_at.getTime() - a.ends_at.getTime())[0];
    if (ev) {
      const who = displayText(ev.attendee_names.find((n) => !!n) ?? s.contact_names[0] ?? '') || 'them';
      out.push({ kind: 'meeting_held', line: `The call with ${who} happened on ${shortDate(ev.ends_at, zone)} (calendar)`, href: null, at: iso(ev.ends_at) });
    }
  }

  // Medium: every email on it is closed and we replied after the newest.
  if (s.asks.length > 0 && s.asks.every((a) => a.state !== 'open')) {
    const newest = s.asks.reduce((a, c) => (c.received_at.getTime() > a.received_at.getTime() ? c : a), s.asks[0]);
    const replied = s.outbox_sent.some((d) => d.getTime() > newest.received_at.getTime()) || newest.closed_reason === 'answered_by_mike' || newest.closed_reason === 'answered_by_bast';
    if (replied) {
      out.push({ kind: 'asks_answered', line: `Every email on it is closed, and we replied after the newest (${shortDate(newest.received_at, zone)})`, href: taskHref, at: iso(newest.received_at) });
    }
  }

  // Medium: a later done task for the same client says the same thing.
  const twin = s.later_done
    .filter((t) => t.id !== task.id && t.completed_at.getTime() > created && titleOverlap(task.title, t.title) >= TITLE_OVERLAP_MIN)
    .sort((a, b) => b.completed_at.getTime() - a.completed_at.getTime())[0];
  if (twin) {
    out.push({ kind: 'same_work_done', line: `A later task, "${clip(displayText(twin.title), 80)}", was done on ${shortDate(twin.completed_at, zone)}`, href: `/tasks/${twin.id}`, at: iso(twin.completed_at) });
  }

  // Medium: a commit after the task was made that names it.
  const commit = s.machine
    .filter((m) => m.kind === 'commit' && m.at.getTime() > created && m.at.getTime() <= now.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (commit) {
    out.push({ kind: 'commit', line: `A commit on ${shortDate(commit.at, zone)} names it (${clip(displayText(commit.ref), 60)})`, href: taskHref, at: iso(commit.at) });
  }

  // Medium: filed by the old session sweep and never picked up.
  if (isOrphanTask(task) && now.getTime() - created >= ORPHAN_MIN_AGE_DAYS * 86_400_000) {
    out.push({ kind: 'orphan_sweep', line: `Filed by the old session sweep on ${shortDate(task.created_at, zone)} and never picked up`, href: taskHref, at: iso(task.created_at) });
  }
  return out;
}

export function groupFor(task: Pick<TaskFacts, 'tags' | 'client_visible' | 'id' | 'title' | 'requirements' | 'review_requirements'>): FinishedGroup {
  if (isSecurityTagged(task.tags)) return 'security';
  if (task.client_visible) return 'portal';
  if (hasUnticked(task)) return 'unticked';
  if (isOrphanTask(task)) return 'orphan';
  return 'main';
}

export function hasUnticked(task: Pick<TaskFacts, 'requirements' | 'review_requirements'>): boolean {
  return hasUntickedItem(task.requirements, task.review_requirements);
}

/** The verdict for one eligible task, or null when there is no evidence (a task with no evidence is never a candidate). */
export function judge(task: TaskFacts, s: Signals, now: Date, zone?: string): Verdict | null {
  const evidence = evidenceFor(task, s, now, zone);
  if (evidence.length === 0) return null;
  const strong = evidence.some((e) => STRONG_KINDS.includes(e.kind));
  // Strong evidence first on the line list.
  evidence.sort((a, b) => Number(STRONG_KINDS.includes(b.kind)) - Number(STRONG_KINDS.includes(a.kind)));
  return { group: groupFor(task), strength: strong ? 'strong' : 'medium', evidence };
}

/** Ticked in the main list: strong evidence is ticked, medium is not. The orphan group is ticked (it has its own button). */
export function tickedByDefault(group: string, strength: string): boolean {
  if (group === 'orphan') return true;
  return group === 'main' && strength === 'strong';
}

/** The groups a batch may close. Security, portal and unticked are never part of one. */
export const BATCH_GROUPS: readonly string[] = ['main', 'orphan'];
/** The groups a single tap may close. Unticked is "Open" only. */
export const ONE_TAP_GROUPS: readonly string[] = ['security', 'portal'];
