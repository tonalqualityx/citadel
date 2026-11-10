import type { AuthPayload } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';

/**
 * Body filter for the `bast-chat` API-key lane on POST /api/tasks and PATCH /api/tasks/:id.
 * Lane keys are checked per route, not per field, so this is the field allowlist (plan T3, task C4).
 * Every caller that is not the `bast-chat` lane gets the very same body object back, untouched.
 */

export const CHAT_LANE = 'bast-chat';
export const CHAT_TAG = 'from-chat';

/** PATCH: the only keys the chat may send, and only on a task assigned to the chat owner. */
export const CHAT_PATCH_ALLOWED = ['status', 'title', 'arc_id', 'assignee_id', 'due_date'] as const;
/** PATCH: extra keys, only on a task the chat itself filed (assigned to the owner and tagged from-chat). */
export const CHAT_PATCH_FROM_CHAT_ONLY = ['description', 'requirements', 'origin_url'] as const;
/** PATCH status values the chat may set (no `review`: that leaves a task for a person to approve). */
export const CHAT_PATCH_STATUSES = ['not_started', 'in_progress', 'blocked', 'done', 'abandoned'] as const;
/** POST: the only keys the chat may send. due_date is dropped, not refused (see below). */
export const CHAT_POST_ALLOWED = [
  'title', 'description', 'assignee_id', 'tags', 'client_id', 'site_id', 'sop_id', 'project_id', 'arc_id',
  'energy_estimate', 'mystery_factor', 'battery_impact', 'priority', 'is_focus', 'needs_review', 'due_date',
] as const;

export type ChatFilterInput = {
  auth: Pick<AuthPayload, 'lane' | 'laneEnforced'>;
  method: 'POST' | 'PATCH';
  body: unknown;
  /** The chat owner's user id (BastChatSettings.owner_user_id). Only read for the bast-chat lane. */
  ownerId?: string | null;
  /** PATCH only: the task as stored now. */
  existing?: { assignee_id?: string | null; tags?: string[] | null } | null;
};

export type ChatFilterResult =
  | { ok: true; body: unknown; dropped?: string[] }
  | { ok: false; status: 403; code: 'chat_field_refused' | 'chat_not_owner_task' | 'chat_lane_refused'; message: string };

const refuse = (code: Extract<ChatFilterResult, { ok: false }>['code'], message: string): ChatFilterResult => ({
  ok: false, status: 403, code, message,
});

export function filterChatTaskBody(input: ChatFilterInput): ChatFilterResult {
  const { auth, method, body, ownerId, existing } = input;
  // Any caller that is not the chat lane: the same object, no copy, no read.
  if (auth.lane !== CHAT_LANE) return { ok: true, body };

  if (auth.laneEnforced !== true) return refuse('chat_lane_refused', 'The chat key must be enforced.');
  if (!ownerId) return refuse('chat_lane_refused', 'The chat owner is not set.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse('chat_field_refused', 'The request body must be an object.');
  }
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);

  if (method === 'PATCH') {
    const current = existing?.assignee_id ?? null;
    if (current !== ownerId) {
      // The one exception: taking a task back to the owner, as the only change.
      if (keys.length === 1 && keys[0] === 'assignee_id' && b.assignee_id === ownerId) return { ok: true, body };
      return refuse('chat_not_owner_task', 'The chat can only change tasks assigned to you, or take one back.');
    }
    const filedByChat = (existing?.tags ?? []).includes(CHAT_TAG);
    for (const k of keys) {
      if ((CHAT_PATCH_FROM_CHAT_ONLY as readonly string[]).includes(k) && filedByChat) continue;
      if (!(CHAT_PATCH_ALLOWED as readonly string[]).includes(k)) {
        return refuse('chat_field_refused', `The chat cannot change this field: ${k}`);
      }
    }
    if ('status' in b && !(CHAT_PATCH_STATUSES as readonly string[]).includes(b.status as string)) {
      return refuse('chat_field_refused', 'The chat cannot set this status: status');
    }
    if ('title' in b && typeof b.title !== 'string') return refuse('chat_field_refused', 'The title must be text: title');
    if ('arc_id' in b && b.arc_id !== null && typeof b.arc_id !== 'string') {
      return refuse('chat_field_refused', 'The arc must be an id or null: arc_id');
    }
    if ('assignee_id' in b && b.assignee_id !== ownerId) {
      return refuse('chat_field_refused', 'The chat can only assign a task to you: assignee_id');
    }
    if ('requirements' in b && !Array.isArray(b.requirements)) {
      return refuse('chat_field_refused', 'The requirements must be a list: requirements');
    }
    if ('origin_url' in b && typeof b.origin_url !== 'string') {
      return refuse('chat_field_refused', 'The link must be text: origin_url');
    }
    // Clearing a date is allowed (job-watch removes the default one); setting one is not.
    if ('due_date' in b && b.due_date !== null) return refuse('chat_field_refused', 'The chat cannot set a date: due_date');
    return { ok: true, body };
  }

  // POST
  for (const k of keys) {
    if (!(CHAT_POST_ALLOWED as readonly string[]).includes(k)) {
      return refuse('chat_field_refused', `The chat cannot set this field: ${k}`);
    }
  }
  if (b.assignee_id !== ownerId) return refuse('chat_field_refused', 'A task from the chat must be assigned to you: assignee_id');
  const tags = b.tags;
  if (!Array.isArray(tags) || tags.length !== 1 || tags[0] !== CHAT_TAG) {
    return refuse('chat_field_refused', `Tags must be exactly ${CHAT_TAG}: tags`);
  }
  // create-task.py sends its defaults; only the do-nothing values pass.
  if ('priority' in b && b.priority !== 3) return refuse('chat_field_refused', 'The chat cannot set this field: priority');
  if ('is_focus' in b && b.is_focus !== false) return refuse('chat_field_refused', 'The chat cannot set this field: is_focus');
  if ('needs_review' in b && b.needs_review !== false) return refuse('chat_field_refused', 'The chat cannot set this field: needs_review');
  if ('due_date' in b) {
    const rest = { ...b };
    delete rest.due_date;
    return { ok: true, body: rest, dropped: ['due_date'] };
  }
  return { ok: true, body };
}

/**
 * Route helper: returns the body untouched (no database read) for any non-chat caller; for the chat lane it
 * reads the owner from BastChatSettings, applies the filter, and throws a 403 ApiError on a refusal.
 */
export async function guardChatTaskBody<T>(
  auth: Pick<AuthPayload, 'lane' | 'laneEnforced'>,
  method: 'POST' | 'PATCH',
  body: T,
  existing?: { assignee_id?: string | null; tags?: string[] | null } | null,
): Promise<T> {
  if (auth.lane !== CHAT_LANE) return body;
  const settings = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  const r = filterChatTaskBody({ auth, method, body, ownerId: settings?.owner_user_id ?? null, existing });
  if (!r.ok) throw new ApiError(r.message, r.status, r.code);
  return r.body as T;
}
