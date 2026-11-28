/**
 * Slack three-way sort (pure: no database).
 *
 * KEEP: posts at once, written as four parts (what happened, why it matters, the one action, a link).
 * DIGEST: no post of its own; one line in the single daily Slack DM.
 * STOP: no Slack at all, logged only.
 */

import type { NotificationType } from '@prisma/client';

export type SlackSort = 'keep' | 'digest' | 'stop';

const SORTS: readonly string[] = ['keep', 'digest', 'stop'];

const KEEP_TYPES: readonly string[] = [
  'task_mentioned',
  'review_requested',
  'design_publish_requested',
  'portal_emergency',
  'portal_chat_handoff',
  'oracle_urgent_email',
];

/** Escape the three characters Slack reserves (https://api.slack.com/reference/surfaces/formatting#escaping). */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sortSlackNotice(input: {
  type: NotificationType | string;
  priority?: string | null;
  metadata?: Record<string, unknown>;
}): SlackSort {
  const { type, priority, metadata } = input;
  const forced = metadata?.slackSort;
  if (typeof forced === 'string' && SORTS.includes(forced)) return forced as SlackSort;
  if (priority === 'low') return 'stop';
  if (priority === 'critical' || priority === 'high') return 'keep';
  if (KEEP_TYPES.includes(type)) return 'keep';
  if (type === 'task_assigned') {
    return metadata?.isAdHocOrSupport === false && metadata?.projectId ? 'digest' : 'keep';
  }
  return 'digest';
}

export interface KeptNoticeInput {
  type: NotificationType | string;
  title: string;
  message?: string;
  metadata?: Record<string, unknown>;
  context?: { title: string; projectName?: string; clientName?: string; dueDate?: string } | null;
  link: string | null;
  appUrl: string;
}

export interface KeptNoticeParts {
  what: string;
  why: string;
  action: string;
  link: string;
}

export function keptNoticeParts(input: KeptNoticeInput): KeptNoticeParts {
  const { type, title, message, metadata, context, link, appUrl } = input;
  const what = title.replace(/^New quest assigned: /, 'New task for you: ');

  let why: string;
  let action: string;
  switch (type) {
    case 'task_assigned':
      why =
        'It is assigned to you' +
        (context?.dueDate ? `, due ${context.dueDate}` : '') +
        (context?.projectName ? ` in ${context.projectName}` : '') +
        '.';
      action = 'Open the task and start it.';
      break;
    case 'task_mentioned':
      why = 'Someone asked for you by name on this task.';
      action = 'Read the comment and reply on the task.';
      break;
    case 'review_requested':
      why = 'The work waits on your review.';
      action = 'Review the task.';
      break;
    case 'oracle_urgent_email':
      why = 'A client email was marked urgent.';
      action = 'Read the email and reply.';
      break;
    case 'portal_emergency':
      why = 'A client filed an urgent request in the portal.';
      action = 'Open the request and respond.';
      break;
    case 'portal_chat_handoff':
      why = 'A client in the portal chat asked for a person.';
      action = 'Open the chat and reply.';
      break;
    case 'design_publish_requested':
      why = 'A designer is waiting on a publish.';
      action = 'Review the publish request.';
      break;
    default:
      why = message?.trim() ? message.trim() : 'It was marked urgent in Citadel.';
      action = 'Open it in Citadel.';
  }
  const slackWhy = metadata?.slackWhy;
  const slackAction = metadata?.slackAction;
  if (typeof slackWhy === 'string' && slackWhy.trim()) why = slackWhy.trim();
  if (typeof slackAction === 'string' && slackAction.trim()) action = slackAction.trim();

  return { what, why, action, link: link || `${appUrl}/dashboard` };
}

export function buildKeptNoticeBlocks(parts: KeptNoticeParts): { text: string; blocks: object[] } {
  for (const key of ['what', 'why', 'action', 'link'] as const) {
    if (!parts[key] || !parts[key].trim()) {
      throw new Error(`Kept Slack notice is missing its "${key}" part`);
    }
  }
  const body =
    `*${escapeSlack(parts.what)}*\n` +
    `*Why it matters:* ${escapeSlack(parts.why)}\n` +
    `*Action:* ${escapeSlack(parts.action)}\n` +
    `<${parts.link}|Open in Citadel>`;
  return {
    text: `${parts.what}. ${parts.action}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: body } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open in Citadel', emoji: true },
            url: parts.link,
            action_id: 'open_in_citadel',
          },
        ],
      },
    ],
  };
}

export interface DigestItem {
  notification_type: string;
  title: string;
  link: string | null;
  entity_type: string | null;
  created_at: Date;
}

/** A digest line's title is cut at this many characters. */
export const DIGEST_TITLE_MAX = 150;

/**
 * The digest line shows only the title (cut at DIGEST_TITLE_MAX), so the day count rides at its end and the
 * wait's own title is shortened first (the sort: a digest line says how long it has been true).
 */
export function waitDigestTitle(title: string, days: number | null): string {
  const head = `A client is blocked on you: ${title}`;
  const tail = days != null ? ` (waiting ${days} days)` : '';
  if (head.length + tail.length <= DIGEST_TITLE_MAX) return head + tail;
  return `${head.slice(0, DIGEST_TITLE_MAX - tail.length - 1)}…${tail}`;
}

const URGENT_DIGEST_TYPES: readonly string[] = ['retainer_alert', 'task_due_soon', 'task_overdue'];

function isMoneyOrDeadline(item: DigestItem): boolean {
  return URGENT_DIGEST_TYPES.includes(item.notification_type) || item.entity_type === 'wait';
}

export function buildDigestMessage(
  items: DigestItem[],
  opts: { appUrl: string; max?: number }
): { text: string; blocks: object[] } {
  const max = opts.max ?? 10;
  const byTime = (a: DigestItem, b: DigestItem) => a.created_at.getTime() - b.created_at.getTime();
  const first = items.filter(isMoneyOrDeadline).sort(byTime);
  const rest = items.filter((i) => !isMoneyOrDeadline(i)).sort(byTime);
  const ordered = [...first, ...rest];

  const header = `Citadel daily digest: ${ordered.length} ${ordered.length === 1 ? 'item' : 'items'}`;
  const lines = ordered.slice(0, max).map((i) => {
    const t = escapeSlack(i.title.length > DIGEST_TITLE_MAX ? `${i.title.slice(0, DIGEST_TITLE_MAX - 1)}…` : i.title);
    return i.link ? `• <${i.link}|${t}>` : `• ${t}`;
  });
  if (ordered.length > max) {
    lines.push(`and ${ordered.length - max} more: <${opts.appUrl}/dashboard|open Citadel>`);
  }
  const text = [header, ...lines].join('\n');
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
}

function localParts(date: Date, timeZone: string): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** True once it is hour:00 or later in the zone today, and no digest has gone since today's hour:00. */
export function digestDue(
  now: Date,
  lastSentAt: Date | null,
  opts: { timeZone?: string; hour?: number } = {}
): boolean {
  const timeZone = opts.timeZone ?? 'America/New_York';
  const hour = opts.hour ?? 9;
  const n = localParts(now, timeZone);
  if (n.hour < hour) return false;
  if (!lastSentAt) return true;
  const l = localParts(lastSentAt, timeZone);
  if (l.ymd < n.ymd) return true;
  return l.ymd === n.ymd && l.hour < hour;
}
