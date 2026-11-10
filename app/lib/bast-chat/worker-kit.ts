/** Bast chat: auth gate and bounded JSON bodies for the seven worker routes (the daemon only). */
import { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { ApiError, AuthError } from '@/lib/api/errors';

export const BAST_CHAT_LANE = 'bast-chat';
export const WORKER_BODY_BYTES = 256 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isChatUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** The daemon, and only the daemon: an API key in the bast-chat lane that is enforced. A session never passes. */
export function isChatWorker(auth: Pick<AuthPayload, 'lane' | 'via' | 'laneEnforced'> | null | undefined): boolean {
  if (!auth) return false;
  return auth.via === 'api_key' && auth.lane === BAST_CHAT_LANE && auth.laneEnforced === true;
}

/** 401 signed out, 403 for anyone who is not the chat daemon (a session, no lane, another lane, lane not enforced). */
export async function requireChatWorker(): Promise<AuthPayload> {
  const auth = await requireAuth();
  if (!isChatWorker(auth)) throw new AuthError('The chat worker only', 403);
  return auth;
}

/** Read and parse a bounded JSON body (413 over the cap, 400 when not JSON, ZodError on a bad shape). */
export async function chatWorkerBody<T>(request: NextRequest, schema: ZodType<T>, maxBytes = WORKER_BODY_BYTES): Promise<T> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new ApiError('Request body too large', 413, 'body_too_large');
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ApiError('Request body too large', 413, 'body_too_large');
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError('Body must be JSON', 400, 'bad_json');
  }
  return schema.parse(raw);
}

/** A path id that is not a uuid is a 404. */
export function chatIdParam(id: string, what = 'Not found'): string {
  if (!isChatUuid(id)) throw new ApiError(what, 404, 'not_found');
  return id.toLowerCase();
}
