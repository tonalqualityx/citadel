import type { AuthPayload } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { getSettings } from './settings';
import { assertWriteAllowed } from './usage';
import { isChatUuid } from './worker-kit';

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
  // The daily write cap is enforced here, before any write: 429 with the plain cap sentence.
  await assertWriteAllowed(settings!.owner_user_id!, await getSettings(prisma), new Date(), prisma);
  return r.body as T;
}

export const CHAT_CONVERSATION_HEADER = 'X-Bast-Chat-Conversation';
const CONTENT_ONLY_FIELDS = ['description', 'requirements', 'origin_url'] as const;
export const NEEDS_CONVERSATION_TEXT = 'Say which chat this change belongs to.';
export const BAD_CONVERSATION_TEXT = 'That chat was not found.';
export const NO_OPEN_CHAT_TEXT = 'Open the chat first.';

/**
 * Which conversation a chat-lane write belongs to. Null for every other caller (nothing is read).
 * - PATCH: the header `X-Bast-Chat-Conversation` is required, except for a body of content fields only
 *   (description, requirements, origin_url), which writes no record and needs no conversation.
 * - POST: the header is checked when present; when absent the owner's current open conversation is used, and
 *   with none open the create is refused.
 * The conversation must exist and belong to the chat owner. Call it after the guard and before any write.
 */
export async function chatConversationFor(
  auth: Pick<AuthPayload, 'lane'>,
  headers: Headers,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<string | null> {
  if (auth.lane !== CHAT_LANE) return null;
  const settings = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  const ownerId = settings?.owner_user_id;
  if (!ownerId) throw new ApiError('The chat owner is not set.', 403, 'chat_lane_refused');
  const header = headers.get(CHAT_CONVERSATION_HEADER);
  if (header === null || header === '') {
    if (method === 'POST') {
      const open = await prisma.bastChatConversation.findFirst({
        where: { owner_id: ownerId, status: { not: 'closed' } },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });
      if (!open) throw new ApiError(NO_OPEN_CHAT_TEXT, 400, 'chat_no_conversation');
      return open.id;
    }
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body as object) : [];
    if (keys.length > 0 && keys.every((k) => (CONTENT_ONLY_FIELDS as readonly string[]).includes(k))) return null;
    throw new ApiError(NEEDS_CONVERSATION_TEXT, 400, 'chat_conversation_required');
  }
  if (!isChatUuid(header)) throw new ApiError(BAD_CONVERSATION_TEXT, 400, 'chat_conversation_invalid');
  const conv = await prisma.bastChatConversation.findUnique({ where: { id: header }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError(BAD_CONVERSATION_TEXT, 400, 'chat_conversation_invalid');
  return header;
}

export const RACE_TEXT = 'The task changed while that was being written. Open the task.';

/**
 * PATCH write target. The chat lane writes only if the owner and `updated_at` are still what the request read at
 * its start (a miss is a 409); every other caller keeps `{ id }` exactly.
 */
export function taskWriteWhere(
  auth: Pick<AuthPayload, 'lane'>,
  id: string,
  existing: { assignee_id?: string | null; updated_at?: Date | null },
): { id: string; assignee_id?: string | null; updated_at?: Date } {
  if (auth.lane !== CHAT_LANE) return { id };
  return { id, assignee_id: existing.assignee_id ?? null, ...(existing.updated_at ? { updated_at: existing.updated_at } : {}) };
}

/** `.catch` handler for the PATCH writes: a compare-and-set miss from the chat lane becomes a 409. */
export function chatWriteMiss(auth: Pick<AuthPayload, 'lane'>) {
  return (e: unknown): never => {
    if (auth.lane === CHAT_LANE && typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2025') {
      throw new ApiError(RACE_TEXT, 409, 'changed_since');
    }
    throw e;
  };
}
