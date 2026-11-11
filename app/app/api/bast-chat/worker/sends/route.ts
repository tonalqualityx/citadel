import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { requireChatWorker } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson } from '@/lib/bast-chat/route-helpers';

/** The most rows one call returns. */
export const SENDS_MAX = 25;
const SENDS_DEFAULT = 10;

const query = z
  .object({
    to: z.string().trim().min(1).max(100).optional(),
    subject: z.string().trim().min(1).max(100).optional(),
    since: z.string().trim().max(40).optional(),
    kind: z.string().trim().regex(/^[a-z0-9_]{1,30}$/).optional(),
    limit: z.coerce.number().int().min(1).max(SENDS_MAX).optional(),
  })
  .strict();

/** "Jeffrey Ayers <j@x.com>" or "j@x.com" to its display name (or local part) and its domain. Never the address. */
export function nameAndDomain(raw: string): { name: string | null; domain: string | null } {
  const s = raw.trim();
  const angled = /^"?([^"<]*?)"?\s*<([^>]+)>/.exec(s);
  const addr = (angled ? angled[2]! : s).trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  const display = angled?.[1]?.trim() ?? '';
  const local = at > 0 ? addr.slice(0, at) : '';
  const domain = at > 0 ? addr.slice(at + 1) || null : null;
  return { name: (display || local || null)?.slice(0, 80) ?? null, domain: domain ? domain.slice(0, 120) : null };
}

/** A stored failure note for the model: paths, bearer values and long runs are removed, at most 200 characters. */
export function plainReason(v: string | null): string | null {
  if (!v) return null;
  const out = v
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\/(?:home|tmp|usr|etc|var|opt)\/[^\s'",)]+/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return out || null;
}

/**
 * GET /api/bast-chat/worker/sends?to=&subject=&since=&kind=&limit=: what the courier sent or has queued, newest first, so the chat
 * can say whether a message went. At most 25 rows (default 10): `{kind, to: {name, domain}, subject, queued_at, send_after, sent_at,
 * superseded_reason, failed_reason, from_account, client}`. No body, no cc, no address, no message id. `to` and `subject` are
 * case-insensitive contains filters (`to` matches the stored address, which is never returned); `since` is an ISO date or time;
 * `kind` is the outbox kind. `client` is the name of the client on the row's task, or null. Citadel has one organisation, so the
 * listing is the whole outbox. Read only; sends Cache-Control: no-store.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const sp = request.nextUrl.searchParams;
    const raw: Record<string, string> = {};
    for (const k of ['to', 'subject', 'since', 'kind', 'limit']) {
      const v = sp.get(k);
      if (v !== null && v !== '') raw[k] = v;
    }
    for (const k of sp.keys()) if (!['to', 'subject', 'since', 'kind', 'limit'].includes(k)) throw new ApiError('That request is not valid. Check the fields and try again.', 400);
    const q = query.parse(raw);
    let since: Date | undefined;
    if (q.since) {
      since = new Date(q.since);
      if (Number.isNaN(since.getTime())) throw new ApiError('since must be a date or a date and time.', 400);
    }
    const rows = await prisma.emailOutbox.findMany({
      where: {
        ...(q.to ? { to: { contains: q.to, mode: 'insensitive' as const } } : {}),
        ...(q.subject ? { subject: { contains: q.subject, mode: 'insensitive' as const } } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(since ? { created_at: { gte: since } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: q.limit ?? SENDS_DEFAULT,
      select: { to: true, subject: true, kind: true, from_account: true, created_at: true, send_after: true, sent_at: true, superseded_reason: true, last_error: true, task_id: true },
    });
    const taskIds = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => !!x))];
    const clientByTask = new Map<string, string | null>();
    if (taskIds.length) {
      const tasks = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, client: { select: { name: true } } } });
      for (const t of tasks) clientByTask.set(t.id, t.client?.name ?? null);
    }
    return chatJson({
      items: rows.map((r) => ({
        kind: r.kind,
        to: nameAndDomain(r.to),
        subject: r.subject,
        queued_at: r.created_at.toISOString(),
        send_after: r.send_after ? r.send_after.toISOString() : null,
        sent_at: r.sent_at ? r.sent_at.toISOString() : null,
        superseded_reason: r.superseded_reason,
        failed_reason: r.sent_at || r.superseded_reason ? null : plainReason(r.last_error),
        from_account: r.from_account,
        client: r.task_id ? (clientByTask.get(r.task_id) ?? null) : null,
      })),
    });
  } catch (error) {
    return chatError(error);
  }
}
