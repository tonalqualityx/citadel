/** Shared plumbing for the 14 worker routes (design 7.3): auth gate, bounded JSON bodies, zod parsing, views. */
import { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { ApiError, AuthError } from '@/lib/api/errors';
import { isDesignWorker, isUuid } from './helpers';

export const WORKER_BODY_BYTES = 256 * 1024;

/** 401 anonymous, 403 for anyone who is not the daemon (session cookie for the worker user included). */
export async function requireWorker(): Promise<AuthPayload> {
  const auth = await requireAuth();
  if (!isDesignWorker(auth)) throw new AuthError('The design worker only', 403);
  return auth;
}

export async function workerBody<T>(request: NextRequest, schema: ZodType<T>, maxBytes = WORKER_BODY_BYTES): Promise<T> {
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

export function idParam(id: string, what = 'Not found'): string {
  if (!isUuid(id)) throw new ApiError(what, 404, 'not_found');
  return id;
}

type DecimalLike = { toString(): string } | null | undefined;
export const num = (d: DecimalLike): number => (d == null ? 0 : Number(d.toString()));

/** The box-side view of a session (no designer-facing extras, no timer fields). */
export function workerSessionView(s: {
  id: string; task_id: string; site_id: string; status: string; sdk_session_id: string | null; cost_usd: DecimalLike;
  budget_usd: DecimalLike; branch: string; preview_alias: string; worktree_path: string | null; base_sha: string | null;
  head_sha: string | null; preview_url?: string | null; preview_deploy_url?: string | null; preview_sha?: string | null;
  model?: string; effort?: string; last_publish_id?: string | null; live_action?: string | null; last_seq?: number;
  lib_index?: unknown; diff_summary?: unknown; publish_precheck?: unknown;
}) {
  return {
    id: s.id, task_id: s.task_id, site_id: s.site_id, status: s.status, sdk_session_id: s.sdk_session_id,
    cost_usd: num(s.cost_usd), budget_usd: num(s.budget_usd), branch: s.branch, preview_alias: s.preview_alias,
    worktree_path: s.worktree_path, base_sha: s.base_sha, head_sha: s.head_sha,
    ...(s.preview_url !== undefined ? { preview_url: s.preview_url } : {}),
    ...(s.preview_deploy_url !== undefined ? { preview_deploy_url: s.preview_deploy_url } : {}),
    ...(s.preview_sha !== undefined ? { preview_sha: s.preview_sha } : {}),
    ...(s.model !== undefined ? { model: s.model, effort: s.effort } : {}),
    ...(s.last_publish_id !== undefined ? { last_publish_id: s.last_publish_id } : {}),
    ...(s.last_seq !== undefined ? { last_seq: s.last_seq } : {}),
    ...(s.lib_index !== undefined ? { lib_index: s.lib_index } : {}),
    ...(s.diff_summary !== undefined ? { diff_summary: s.diff_summary } : {}),
    ...(s.publish_precheck !== undefined ? { publish_precheck: s.publish_precheck } : {}),
  };
}
