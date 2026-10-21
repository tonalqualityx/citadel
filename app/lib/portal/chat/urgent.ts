/**
 * Emergencies (phase C spec 2.6). The keyword rule runs on the client's text before any model
 * does; the effects fire only when the CLIENT presses an urgent choice. The model can only
 * `suggest_urgent`, which shows the choices.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { createInAppNotificationOnly } from '@/lib/services/notifications';
import { onRequestFiled } from '@/lib/portal/waits';
import { LIMITS } from '@/lib/portal/intake/file-request';

const URGENT_PATTERNS: RegExp[] = [
  /\b(?:site|website|web site)\b[^.\n]{0,30}\b(?:is|has gone|went|keeps|just)?\s*(?:down|offline|not loading|crashed|gone)\b/i,
  /\bsite\s+down\b/i,
  /\b(?:can(?:'|’)?t|cannot|unable to|won(?:'|’)?t let (?:me|us)|not able to)\s+(?:check\s?out|checkout|pay|place (?:an )?order)\b/i,
  /\bcheck\s?out\b[^.\n]{0,30}\b(?:is|are)?\s*(?:broken|down|not working|failing|failed)\b/i,
  /\b(?:hacked|defaced|compromised|malware|virus)\b/i,
  /\bpayments?\b[^.\n]{0,20}\b(?:fail(?:ed|ing|s)?|not working|broken|declin\w+)\b/i,
  /\b(?:orders?|form|forms)\b[^.\n]{0,30}\b(?:not (?:coming|going|working|sending)|broken|stopped)\b/i,
  /\bwebsite\s+(?:is\s+)?(?:down|offline)\b/i,
];

export function isUrgentText(text: string): boolean {
  return URGENT_PATTERNS.some((re) => re.test(text));
}

export type UrgentChoice = 'site_down' | 'form_checkout' | 'not_urgent';

export interface UrgentOutcome {
  /** True only when the emergency alert actually went out. */
  alerted: boolean;
  downgraded: boolean;
  dismissed: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

/** Apply the effects of an urgent click: priority 1, emergency + needs-mike, the alert and the clock. Idempotent. */
export async function applyUrgentChoice(
  conversationId: string,
  choice: UrgentChoice,
  opts: { now?: Date } = {}
): Promise<UrgentOutcome> {
  const now = opts.now ?? new Date();
  const convo = await prisma.chatConversation.findUnique({ where: { id: conversationId }, include: { task: true } });
  if (!convo) return { alerted: false, downgraded: false, dismissed: false };
  const slots = (convo.slots as Record<string, unknown>) ?? {};
  if (choice === 'not_urgent') {
    await prisma.chatConversation.update({ where: { id: conversationId }, data: { slots: { ...slots, urgent_offered: false, urgent_answered: 'not_urgent' } as Prisma.InputJsonValue } });
    return { alerted: false, downgraded: false, dismissed: true };
  }
  const task = convo.task;
  if (task.tags.includes('emergency')) return { alerted: true, downgraded: false, dismissed: false };

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-intake-client:${convo.client_id}`}))`;
    const today = await tx.task.count({
      where: { client_id: convo.client_id, tags: { has: 'emergency' }, created_at: { gte: new Date(now.getTime() - DAY) } },
    });
    const effects = today < LIMITS.emergencies_per_day;
    const tags = new Set([...task.tags, 'needs-mike', ...(effects ? ['emergency'] : [])]);
    await tx.task.update({ where: { id: task.id }, data: { tags: [...tags], priority: effects ? 1 : Math.min(task.priority ?? 3, 2) } });
    if (effects) {
      await onRequestFiled(
        tx,
        {
          id: task.id,
          client_title: task.client_title ?? task.title,
          assignee_id: task.assignee_id,
          client_id: task.client_id,
          project_id: task.project_id,
          charter_id: task.charter_id,
          site_id: task.site_id,
        },
        { intake_id: convo.intake_id ?? convo.id, quote: false, emergency: true },
        now
      );
    }
    await tx.chatConversation.update({
      where: { id: conversationId },
      data: { slots: { ...slots, urgent_offered: false, urgent_answered: choice } as Prisma.InputJsonValue },
    });
    return { effects };
  });

  const title = task.client_title ?? task.title;
  try {
    if (result.effects) {
      await dispatchNotification({
        userId: MIKE_USER_ID,
        type: 'portal_emergency',
        title: `Urgent portal request: ${title}`,
        message: 'A client marked a chat request urgent in the portal. The task is the record.',
        entityType: 'task',
        entityId: task.id,
        priority: 'critical',
      });
    } else {
      await createInAppNotificationOnly({
        userId: MIKE_USER_ID,
        type: 'portal_emergency',
        title: `Urgent portal request (over the daily limit): ${title}`,
        message: 'A client marked a request urgent after three urgent requests today. It was filed at priority 2. Check it.',
        entityType: 'task',
        entityId: task.id,
        priority: 'high',
      });
    }
  } catch (error) {
    console.error('portal chat emergency notification failed', error);
  }
  return { alerted: result.effects, downgraded: !result.effects, dismissed: false };
}
