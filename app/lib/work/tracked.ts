/**
 * Work stage D: the shared answer of a create path that found the work already carried (200 {already_tracked: true, ...}), and the
 * sources a request names. The check itself is guard.ts checkTracked; this only shapes the answer and finds the sources.
 */

import { NextResponse } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { formatTaskResponse } from '@/lib/api/formatters';
import type { AuthPayload } from '@/lib/auth/middleware';
import { CHAT_LANE } from '@/lib/bast-chat/task-filter';
import { noteTracked, trackedBody, type Handled, type SourceRef } from './guard';
import { emailRefOfAsk, isWorkKind, normalizeRfc, type WorkKind } from './keys';

const TRACKED_TASK_INCLUDE = {
  project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
  client: { select: { id: true, name: true } },
  arc: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
  reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
  approved_by: { select: { id: true, name: true } },
  created_by: { select: { id: true, name: true } },
} as const;

/** The owner's own override: his screen (a browser session) or the chat that speaks for him. A machine lane never overrides. */
export function mayOverride(auth: Pick<AuthPayload, 'via' | 'lane'>, createAnyway: boolean | undefined): boolean {
  if (createAnyway !== true) return false;
  return auth.via === 'session' || auth.lane === CHAT_LANE;
}

/** `kind:ref` as a request carries it (source_key). null when it is not one. */
export function parseSourceKey(key: string | null | undefined): { kind: WorkKind; ref: string } | null {
  if (!key) return null;
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const kind = key.slice(0, i);
  const ref = key.slice(i + 1);
  return isWorkKind(kind) && ref.length > 0 && ref.length <= 300 ? { kind, ref } : null;
}

/** The email conversations behind an email-sourced task request: the asks whose message id or RFC id the request names. */
export async function emailSourcesFor(db: PrismaClient, ids: { source_ref?: string | null; source_rfc?: string | null; thread_id?: string | null }): Promise<SourceRef[]> {
  const ref = (ids.source_ref ?? '').trim();
  const rfc = normalizeRfc(ids.source_rfc);
  const thread = (ids.thread_id ?? '').trim();
  const or = [
    ...(ref ? [{ message_id: ref }, { rfc_message_id: normalizeRfc(ref) ?? ref }, { conversation_key: normalizeRfc(ref) ?? ref }] : []),
    ...(rfc ? [{ rfc_message_id: rfc }, { conversation_key: rfc }] : []),
    ...(thread ? [{ thread_id: thread }] : []),
  ];
  if (or.length === 0) return [];
  const asks = await db.emailAsk.findMany({ where: { OR: or }, select: { conversation_key: true, rfc_message_id: true, message_id: true, received_at: true }, take: 50 });
  const out = new Map<string, SourceRef>();
  for (const a of asks) {
    const r = emailRefOfAsk(a);
    const cur = out.get(r);
    if (!cur || (cur.latest_at && a.received_at > cur.latest_at)) out.set(r, { kind: 'email', ref: r });
  }
  return [...out.values()];
}

/** The 200 answer: names the work and carries its link; nothing was created. */
export async function trackedResponse(db: PrismaClient, h: Handled, src: { kind: WorkKind; ref: string }): Promise<NextResponse> {
  await noteTracked(db, h, src);
  let task: unknown = null;
  if (h.type === 'task') {
    const row = await db.task.findUnique({ where: { id: h.id }, include: TRACKED_TASK_INCLUDE });
    task = row ? formatTaskResponse(row) : null;
  }
  return NextResponse.json(trackedBody(h, task), { status: 200 });
}
