/**
 * Designer Portal: the small pieces every /api/design handler shares (design section 7 preamble).
 * Auth + DB-role actor, the cross-site guard, a size-capped JSON body reader (413) and zod parsing (400).
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveDesignActor, type DesignActor } from './helpers';

export const DEFAULT_BODY_BYTES = 64 * 1024;

/** requireAuth + the DATABASE role as a DesignActor (D1). */
export async function authActor(): Promise<{ auth: AuthPayload; actor: DesignActor }> {
  const auth = await requireAuth();
  const actor = await resolveDesignActor(auth);
  return { auth, actor };
}

/** Runs the same-origin / JSON content-type guard; returns the rejection response or null. */
export function guardMutation(request: NextRequest): NextResponse | null {
  return rejectCrossSiteRequest(request);
}

/** Admin routes need a signed-in session, never an API key (7.2). */
export function requireSessionVia(actor: Pick<DesignActor, 'via'>): void {
  if (actor.via !== 'session') throw new ApiError('A signed-in session is required', 403, 'session_required');
}

export function requireAdmin(actor: Pick<DesignActor, 'role'>): void {
  if (actor.role !== 'admin') throw new ApiError('Forbidden', 403, 'forbidden');
}

/** Read a JSON body: 413 over `maxBytes`, 400 on invalid JSON, `{}` on an empty body. */
export async function readJsonBody(request: NextRequest, maxBytes = DEFAULT_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError('Request body too large', 413, 'payload_too_large');
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ApiError('Request body too large', 413, 'payload_too_large');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('Request body is not valid JSON', 400, 'invalid_json');
  }
}

/** Parse (throws ZodError -> 400 through handleApiError). */
export function parseWith<T>(schema: ZodType<T>, raw: unknown): T {
  return schema.parse(raw);
}

export async function body<T>(request: NextRequest, schema: ZodType<T>, maxBytes = DEFAULT_BODY_BYTES): Promise<T> {
  return parseWith(schema, await readJsonBody(request, maxBytes));
}

export interface IdParams {
  params: Promise<{ id: string }>;
}
