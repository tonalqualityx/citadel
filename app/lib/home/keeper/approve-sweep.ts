/**
 * Approval sweep (owner's rule, 2026-11-18): "internal work that's been done for 3 days or more without approval can be
 * approved right away." The sweep approves finished internal tasks that sit waiting for a review nobody is going to do.
 *
 * The selection starts from the same rule as the home screen's review folds (lib/home/load.ts loadReviewFolds: not
 * deleted, status done, needs_review, not approved, reviewer empty or the owner) and only narrows it, so the sweep never
 * approves a task the home screen would not have listed.
 *
 * A task qualifies only when ALL hold: done more than 3 days ago (completed_at, else updated_at); assigned to a bot user;
 * no comment from anyone who is not a bot (a client contact's comment has no user and counts as a human); no client
 * facing tag; not a security flag (named constants above); a task with no client and no project must not carry a client or project name in its title; no client approval, staging preview, requesting contact, client_id (on the task or its project) or client_visible.
 * Work done for a client is not "internal" even when the client never sees it, so it is left for a person.
 *
 * Writes (real run only): Task.approved, approved_at, approved_by_id (Bast) and one activity row per task through
 * logUpdate, whose changes carry approval_source 'auto-approve-sweep' so every sweep approval is auditable. Nothing else.
 * Dry run writes nothing.
 */

import type { PrismaClient } from '@prisma/client';
import { BAST_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { logUpdate } from '@/lib/services/activity';

const DAY_MS = 86_400_000;
export const APPROVE_AFTER_DAYS = 3;
export const SWEEP_SOURCE = 'auto-approve-sweep';

/**
 * Tags that mean a client sees the task or a person must decide on it. Chosen from the tags the code already reads:
 * - client-approved, client-sent-back, client-cancelled: the portal's client-rendered labels (lib/portal/client-rendered.ts)
 * - staged, awaiting-client-approval: a change staged for the client's yes (lib/portal/go-live.ts)
 * - client-plan-approval, plan-approval, needs-pm-release, awaiting-clarification, needs-mike, cockpit-owned: BLOCKING_TAGS,
 *   where a person's word is the point
 * - portal, portal-chat, chat-question, quote, marketing-plan, emergency: shown to the client or sent to them
 * Any tag starting "client-" is also treated as client facing, so a tag added later fails safe.
 */
export const CLIENT_FACING_TAGS: readonly string[] = [
  'client-approved',
  'client-sent-back',
  'client-cancelled',
  'staged',
  'awaiting-client-approval',
  'client-plan-approval',
  'plan-approval',
  'needs-pm-release',
  'awaiting-clarification',
  'needs-mike',
  'cockpit-owned',
  'portal',
  'portal-chat',
  'chat-question',
  'quote',
  'marketing-plan',
  'emergency',
];

/**
 * HARD EXCLUSION, never a judgement call. Handbook section 3 item 8 (SOUL.md Hard Boundaries): "A security flag. Never
 * dismiss or downplay one; bring it to him." [Mike, SOUL.md: "Dismiss or downplay a security flag, even if 99% sure it's
 * false positive"]. A task that looks like a security flag is never auto-approved. Do not remove or narrow these lists;
 * only Mike changes a rule (handbook 1a). Matched case-insensitively, anywhere in the tag or the title.
 */
export const SECURITY_TAG_WORDS: readonly string[] = [
  'security', 'advisory', 'vulnerability', 'cve', 'compromise', 'malware', 'breach', 'backdoor', 'canary', 'signin', 'sign-in', 'saiph-stack-watch',
];
export const SECURITY_TITLE_WORDS: readonly string[] = [
  'security', 'advisory', 'vulnerability', 'cve-', 'compromise', 'malware', 'breach', 'backdoor', 'unauthorized', 'credential', 'secret key', 'access key',
];

export function looksLikeSecurity(title: string, tags: readonly string[]): boolean {
  const t = title.toLowerCase();
  return tags.some((g) => SECURITY_TAG_WORDS.some((w) => g.toLowerCase().includes(w))) || SECURITY_TITLE_WORDS.some((w) => t.includes(w));
}

/** Lowercase words joined by single spaces, padded, so "a b" is found as a whole-word run. */
export function normalizeName(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/** Names shorter than this are not compared (they would match everything). */
const MIN_NAME_CHARS = 3;

const CORP_SUFFIXES = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'incorporated']);
/** In a project name, the words after which the rest is only a description of the work ("Stronghold Stuff website and store"). */
const DESCRIPTOR_WORDS = new Set(['website', 'site', 'build', 'rebuild', 'migration', 'project', 'redesign', 'sow', 'store', 'app', 'campaign']);

/** The full name plus the short form people actually write in a title: text before a colon or bracket, corporate suffixes and trailing descriptors cut. */
export function nameAliases(name: string): string[] {
  const head = name.split(/[:(]/)[0];
  const words = normalizeName(head).trim().split(' ').filter(Boolean);
  while (words.length > 1 && CORP_SUFFIXES.has(words[words.length - 1])) words.pop();
  if (words[0] === 'the' && words.length > 1) words.shift();
  const cut = words.findIndex((w, i) => i > 0 && DESCRIPTOR_WORDS.has(w));
  const short = cut > 0 ? words.slice(0, cut) : words;
  return [normalizeName(name), ` ${words.join(' ')} `, ` ${short.join(' ')} `];
}

export function normalizeNames(names: readonly string[]): string[] {
  return [...new Set(names.flatMap(nameAliases).filter((n) => n.trim().length >= MIN_NAME_CHARS))];
}

export function isClientFacingTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  return CLIENT_FACING_TAGS.includes(t) || t.startsWith('client-');
}

export interface SweepRow {
  id: string;
  title: string;
  assignee_id: string | null;
  tags: string[];
  completed_at: Date | null;
  updated_at: Date;
  client_approved_at: Date | null;
  staging_preview_url: string | null;
  requested_by_contact_id: string | null;
  client_id: string | null;
  client_visible: boolean;
  comments: { user_id: string | null }[];
  project: { id: string; name: string; client_id?: string | null } | null;
}

export type SkipReason = 'security' | 'too_recent' | 'not_bot_assignee' | 'human_comment' | 'client_facing' | 'client_name';

/**
 * Why this row may not be approved by the sweep, or null when it qualifies. Pure.
 * The sweep needs positive evidence that work is internal; missing data is never treated as internal. A task with no
 * client and no project is checked by title against `clientAndProjectNames` (from normalizeNames); a hit means client work
 * with broken links. Security is checked first.
 */
export function skipReason(row: SweepRow, now: Date, clientAndProjectNames: readonly string[] = []): SkipReason | null {
  if (looksLikeSecurity(row.title, row.tags)) return 'security';
  const at = row.completed_at ?? row.updated_at;
  if (now.getTime() - at.getTime() <= APPROVE_AFTER_DAYS * DAY_MS) return 'too_recent';
  if (!row.assignee_id || !BOT_USER_IDS.includes(row.assignee_id)) return 'not_bot_assignee';
  if (row.comments.some((c) => c.user_id === null || !BOT_USER_IDS.includes(c.user_id))) return 'human_comment';
  if (row.tags.some(isClientFacingTag) || row.client_approved_at || row.staging_preview_url || row.requested_by_contact_id || row.client_id || row.client_visible || row.project?.client_id) return 'client_facing';
  if (!row.client_id && !row.project) {
    const title = normalizeName(row.title);
    if (clientAndProjectNames.some((n) => title.includes(n))) return 'client_name';
  }
  return null;
}

export interface SweepItem {
  task_id: string;
  title: string;
  project: string | null;
  finished_at: string;
}

export interface SweepResult {
  dry_run: boolean;
  /** Every task that qualifies (dry run: would approve; real run: the ones whose approval was written). */
  approved: SweepItem[];
  /** Real run only: qualified, but changed by someone else before the write, so left alone. */
  raced: number;
  /** How many candidates were left alone, by reason. */
  skipped: Record<SkipReason, number>;
  /** How many client and project names the title check compared against. */
  names_compared: number;
  /** One digest line, or null when nothing was approved. */
  line: string | null;
}

/** The one weekly digest line: what shipped and is now signed off, not what went unreviewed (the worker marks every shipped task needs_review as a visibility note). Plain, no dashes, none of the banned words. */
export function sweepLine(n: number): string | null {
  if (n <= 0) return null;
  const what = n === 1 ? 'Signed off 1 piece of finished work' : `Signed off ${n} pieces of finished work`;
  return `${what} that shipped more than ${APPROVE_AFTER_DAYS} days ago and drew no comments. Nothing client facing was included.`;
}

export type SweepDb = Pick<PrismaClient, 'task' | 'client' | 'project'>;

/** Every client and project name, in one pass each, normalised. */
async function loadNames(db: SweepDb): Promise<string[]> {
  const [clients, projects] = await Promise.all([
    db.client.findMany({ select: { name: true } }),
    db.project.findMany({ select: { name: true } }),
  ]);
  return normalizeNames([...clients.map((c) => c.name), ...projects.map((p) => p.name)]);
}

/** Candidates: the review-fold rule, narrowed to bot assignees finished before the cutoff. Rows are re-checked by skipReason. */
async function loadRows(db: SweepDb, ownerId: string, cutoff: Date): Promise<SweepRow[]> {
  return (await db.task.findMany({
    where: {
      is_deleted: false,
      status: 'done',
      needs_review: true,
      approved: false,
      OR: [{ reviewer_id: null }, { reviewer_id: ownerId }],
      assignee_id: { in: [...BOT_USER_IDS] },
      AND: [
        {
          OR: [
            { completed_at: { lt: cutoff } },
            { completed_at: null, updated_at: { lt: cutoff } },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      assignee_id: true,
      tags: true,
      completed_at: true,
      updated_at: true,
      client_approved_at: true,
      staging_preview_url: true,
      requested_by_contact_id: true,
      client_id: true,
      client_visible: true,
      comments: { select: { user_id: true } },
      project: { select: { id: true, name: true, client_id: true } },
    },
    orderBy: { updated_at: 'asc' },
  })) as unknown as SweepRow[];
}

export async function runApproveSweep(db: SweepDb, ownerId: string, now: Date, opts: { dryRun: boolean }): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - APPROVE_AFTER_DAYS * DAY_MS);
  const rows = await loadRows(db, ownerId, cutoff);
  const names = await loadNames(db);
  const skipped: Record<SkipReason, number> = { security: 0, too_recent: 0, not_bot_assignee: 0, human_comment: 0, client_facing: 0, client_name: 0 };
  const qualifying: SweepRow[] = [];
  for (const r of rows) {
    const why = skipReason(r, now, names);
    if (why) skipped[why]++;
    else qualifying.push(r);
  }
  const item = (r: SweepRow): SweepItem => ({
    task_id: r.id,
    title: r.title,
    project: r.project?.name ?? null,
    finished_at: (r.completed_at ?? r.updated_at).toISOString(),
  });

  if (opts.dryRun) {
    return { dry_run: true, approved: qualifying.map(item), raced: 0, skipped, names_compared: names.length, line: sweepLine(qualifying.length) };
  }

  const done: SweepRow[] = [];
  let raced = 0;
  for (const r of qualifying) {
    // Guarded write: only if the task is still unapproved and done, so a person's change in between wins.
    const res = await db.task.updateMany({
      where: { id: r.id, approved: false, status: 'done', is_deleted: false },
      data: { approved: true, approved_at: now, approved_by_id: BAST_USER_ID },
    });
    if (res.count !== 1) {
      raced++;
      continue;
    }
    await logUpdate(BAST_USER_ID, 'task', r.id, r.title, {
      approved: { from: false, to: true },
      approval_source: { from: null, to: SWEEP_SOURCE },
    });
    done.push(r);
  }
  return { dry_run: false, approved: done.map(item), raced, skipped, names_compared: names.length, line: sweepLine(done.length) };
}
