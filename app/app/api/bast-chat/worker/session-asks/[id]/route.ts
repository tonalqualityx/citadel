import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { requireChatWorker } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { loadSessionAsksFor } from '@/lib/home/load';
import { sessionKey } from '@/lib/home/item-key';

/** The same token rule as a session_ask card id (lib/bast-chat/card-context.ts): a short safe token or a uuid. */
const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
/** The longest ask text the chat is given. */
export const SESSION_ASK_TEXT_MAX = 2000;

/**
 * GET /api/bast-chat/worker/session-asks/:id: one session that is waiting on the owner, by its external id or its row id.
 * 200 `{title, waiting_on, since, session_url, client, project, home_key}`: `waiting_on` is the full ask text capped at 2000
 * characters, `since` is ISO-8601, `session_url` is the claude.ai link or null, `client` and `project` are names or null, and
 * `home_key` (`session:<external id>`) is what the home op takes. A session with no ask, an archived or ended one, one the owner
 * cleared (and that has not asked anything new), or an id that is not a token is 404. Owner only; takes no user id; read only.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const { id } = await params;
    if (!SESSION_ID_RE.test(id)) throw new ApiError('Not found', 404, 'not_found');
    const ownerId = await workerOwnerId();
    const asks = await loadSessionAsksFor(prisma, ownerId);
    const lower = id.toLowerCase();
    const ask = asks.find((a) => a.external_id === id || a.id === lower);
    if (!ask) throw new ApiError('Not found', 404, 'not_found');
    return chatJson({
      title: ask.title,
      waiting_on: ask.waiting_on.length > SESSION_ASK_TEXT_MAX ? ask.waiting_on.slice(0, SESSION_ASK_TEXT_MAX) : ask.waiting_on,
      since: ask.asked_at.toISOString(),
      session_url: ask.remote_url,
      client: ask.client?.name ?? null,
      project: ask.project?.name ?? null,
      home_key: sessionKey(ask.external_id),
    });
  } catch (error) {
    return chatError(error);
  }
}
