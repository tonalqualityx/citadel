/**
 * "Needs your attention" digest
 *
 * A periodic digest emailed to Mike of everything waiting on him, so nothing fails
 * quietly. Modeled on the Saiph triage digest: clean HTML, ranked, action list first.
 *
 * It ALWAYS sends — even when there is nothing waiting (a one-line "all clear" note) —
 * so silence reliably means "the job didn't run", never "everything is fine".
 *
 * Triggered by a system cron hitting `POST /api/cron/needs-attention-digest`.
 */

import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';
import { isBlockerSatisfied } from '@/lib/services/dependencies';

/** An `in_progress` task untouched for longer than this is treated as stalled. */
export const STALE_IN_PROGRESS_DAYS = 2;

/** Where the digest goes. Overridable for testing / re-routing. */
const DEFAULT_RECIPIENT = 'mike@becomeindelible.com';

function getRecipient(): string {
  return process.env.DIGEST_RECIPIENT || DEFAULT_RECIPIENT;
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://citadel.becomeindelible.com';
}

export interface DigestTaskItem {
  id: string;
  title: string;
  priority: number | null;
  status: string;
  /** Short, human reason this task is in this bucket. */
  reason: string;
  url: string;
}

export interface DigestArticleItem {
  id: string;
  title: string;
  url: string;
}

export interface NeedsAttentionData {
  /** Tasks tagged `needs-mike` — the action list, surfaced first. */
  needsMike: DigestTaskItem[];
  /** Tasks tagged `awaiting-clarification` — waiting on Mike's answer. */
  awaitingClarification: DigestTaskItem[];
  /** Blocked-but-unblockable, or `in_progress` and gone stale. */
  stuck: DigestTaskItem[];
  /** Articles in `in_review`, not yet approved. */
  articlesAwaitingReview: DigestArticleItem[];
}

export interface DigestSummary {
  recipient: string;
  counts: {
    needsMike: number;
    awaitingClarification: number;
    stuck: number;
    articlesAwaitingReview: number;
  };
  total: number;
}

// Selected once so every task bucket returns an identical shape.
const TASK_SELECT = {
  id: true,
  title: true,
  priority: true,
  status: true,
  created_at: true,
  updated_at: true,
} as const;

// Blocker shape consumed by isBlockerSatisfied (mirrors dependencies.ts).
const BLOCKER_SELECT = {
  where: { is_deleted: false },
  select: {
    status: true,
    approved: true,
    project: { select: { dependencies_ordering_only: true } },
  },
} as const;

type TaskRow = {
  id: string;
  title: string;
  priority: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

function taskUrl(id: string): string {
  return `${getAppUrl()}/tasks/${id}`;
}

/** Rank: highest priority first (1 is highest; nulls last), then oldest first. */
function rankTasks<T extends { priority: number | null; created_at: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = a.priority ?? Number.POSITIVE_INFINITY;
    const pb = b.priority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return a.created_at.getTime() - b.created_at.getTime();
  });
}

function toItem(row: TaskRow, reason: string): DigestTaskItem {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    reason,
    url: taskUrl(row.id),
  };
}

/**
 * Gather everything waiting on Mike, ranked, with each task assigned to exactly ONE
 * bucket (needs-mike > awaiting-clarification > stuck) so nothing is listed twice.
 */
export async function gatherNeedsAttention(): Promise<NeedsAttentionData> {
  const staleCutoff = new Date(Date.now() - STALE_IN_PROGRESS_DAYS * 24 * 60 * 60 * 1000);

  const [needsMikeRows, awaitingRows, blockedRows, staleInProgressRows, articleRows] =
    await Promise.all([
      prisma.task.findMany({
        where: { is_deleted: false, status: { not: 'abandoned' }, tags: { has: 'needs-mike' } },
        select: TASK_SELECT,
      }),
      prisma.task.findMany({
        where: {
          is_deleted: false,
          status: { not: 'abandoned' },
          tags: { has: 'awaiting-clarification' },
        },
        select: TASK_SELECT,
      }),
      prisma.task.findMany({
        where: { is_deleted: false, status: 'blocked' },
        select: { ...TASK_SELECT, blocked_by: BLOCKER_SELECT },
      }),
      prisma.task.findMany({
        where: { is_deleted: false, status: 'in_progress', updated_at: { lt: staleCutoff } },
        select: TASK_SELECT,
      }),
      prisma.article.findMany({
        where: { is_deleted: false, status: 'in_review', approved_at: null },
        select: { id: true, title: true, run_id: true, created_at: true },
      }),
    ]);

  const seen = new Set<string>();
  const take = (rows: TaskRow[]) => rows.filter((r) => !seen.has(r.id) && seen.add(r.id));

  const needsMike = rankTasks(take(needsMikeRows as TaskRow[])).map((r) =>
    toItem(r, 'Tagged needs-mike')
  );

  const awaitingClarification = rankTasks(take(awaitingRows as TaskRow[])).map((r) =>
    toItem(r, 'Waiting on your answer')
  );

  // Blocked tasks whose blockers are ALL satisfied are stuck (should already have
  // self-healed) — surface them. `.every` on an empty list is true, so a blocked task
  // with no remaining blockers also counts.
  const blockedButUnblockable = (
    blockedRows as Array<TaskRow & { blocked_by: Parameters<typeof isBlockerSatisfied>[0][] }>
  )
    .filter((t) => t.blocked_by.every(isBlockerSatisfied))
    .map((t) => toItem(t, 'Blocked, but all blockers are done'));

  const stale = (staleInProgressRows as TaskRow[]).map((r) =>
    toItem(r, `In progress, no update in ${STALE_IN_PROGRESS_DAYS}+ days`)
  );

  // Merge the two stuck sources, dedup against earlier buckets, order by priority.
  // (A task can't be both `blocked` and `in_progress`, so there's no internal overlap.)
  const stuck = [...blockedButUnblockable, ...stale]
    .filter((item) => !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => (a.priority ?? Number.POSITIVE_INFINITY) - (b.priority ?? Number.POSITIVE_INFINITY));

  const articlesAwaitingReview: DigestArticleItem[] = articleRows.map((a) => ({
    id: a.id,
    title: a.title,
    url: `${getAppUrl()}/troubador/runs/${a.run_id}`,
  }));

  return { needsMike, awaitingClarification, stuck, articlesAwaitingReview };
}

function priorityLabel(priority: number | null): string {
  if (priority == null) return '';
  return `P${priority} · `;
}

function renderTaskListText(items: DigestTaskItem[]): string {
  return items.map((i) => `  - ${priorityLabel(i.priority)}${i.title} — ${i.reason}\n    ${i.url}`).join('\n');
}

function renderTaskListHtml(items: DigestTaskItem[]): string {
  const rows = items
    .map(
      (i) => `      <li>
        <a href="${i.url}">${escapeHtml(i.title)}</a>
        <span class="meta">${escapeHtml(priorityLabel(i.priority))}${escapeHtml(i.reason)}</span>
      </li>`
    )
    .join('\n');
  return `    <ul>\n${rows}\n    </ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build subject + text + HTML for the digest from gathered data. */
export function buildDigestEmail(data: NeedsAttentionData): {
  subject: string;
  text: string;
  html: string;
} {
  const total =
    data.needsMike.length +
    data.awaitingClarification.length +
    data.stuck.length +
    data.articlesAwaitingReview.length;

  if (total === 0) {
    const subject = 'Citadel — nothing needs you right now ✓';
    const line = 'All clear — nothing is waiting on you in Citadel. (If you got this, the job ran.)';
    return {
      subject,
      text: `${line}\n`,
      html: wrapHtml(`<h2>Nothing needs you right now ✓</h2><p>${line}</p>`),
    };
  }

  const subject = `Citadel — ${total} item${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} your attention`;

  const textSections: string[] = [];
  const htmlSections: string[] = [];

  const addTaskSection = (heading: string, items: DigestTaskItem[]) => {
    if (items.length === 0) return;
    textSections.push(`${heading} (${items.length})\n${renderTaskListText(items)}`);
    htmlSections.push(`    <h3>${escapeHtml(heading)} (${items.length})</h3>\n${renderTaskListHtml(items)}`);
  };

  addTaskSection('Needs you', data.needsMike);
  addTaskSection('Awaiting your answer', data.awaitingClarification);
  addTaskSection('Stuck / stalled', data.stuck);

  if (data.articlesAwaitingReview.length > 0) {
    const items = data.articlesAwaitingReview;
    textSections.push(
      `Articles awaiting review (${items.length})\n` +
        items.map((a) => `  - ${a.title}\n    ${a.url}`).join('\n')
    );
    const rows = items
      .map((a) => `      <li><a href="${a.url}">${escapeHtml(a.title)}</a></li>`)
      .join('\n');
    htmlSections.push(`    <h3>Articles awaiting review (${items.length})</h3>\n    <ul>\n${rows}\n    </ul>`);
  }

  const text = `${total} item${total === 1 ? '' : 's'} need your attention in Citadel.\n\n${textSections.join('\n\n')}\n`;
  const html = wrapHtml(
    `<h2>${total} item${total === 1 ? '' : 's'} need your attention</h2>\n${htmlSections.join('\n')}`
  );

  return { subject, text, html };
}

function wrapHtml(inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2D2D2D; }
    .container { max-width: 640px; margin: 0 auto; padding: 20px; }
    h2 { margin-bottom: 4px; }
    h3 { margin-top: 24px; margin-bottom: 8px; color: #5B8FB9; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    .meta { display: block; color: #666; font-size: 13px; }
    .footer { margin-top: 30px; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
${inner}
    <p class="footer">Citadel daily digest. Silence means the job didn't run.</p>
  </div>
</body>
</html>`;
}

/**
 * Gather, render, and send the digest. Always sends (empty state included).
 * Returns a summary for the cron response / logging.
 */
export async function sendNeedsAttentionDigest(): Promise<DigestSummary> {
  const data = await gatherNeedsAttention();
  const { subject, text, html } = buildDigestEmail(data);
  const recipient = getRecipient();

  await sendEmail({ to: recipient, subject, text, html });

  return {
    recipient,
    counts: {
      needsMike: data.needsMike.length,
      awaitingClarification: data.awaitingClarification.length,
      stuck: data.stuck.length,
      articlesAwaitingReview: data.articlesAwaitingReview.length,
    },
    total:
      data.needsMike.length +
      data.awaitingClarification.length +
      data.stuck.length +
      data.articlesAwaitingReview.length,
  };
}
