/**
 * Designer Portal v2: what the design worker (the daemon) may read of a track and write to its art direction
 * (SPEC 5, 5.1, 3.3 machine reads, 3.5 projections).
 *
 * - The target always comes from the SESSION ROW (`loadWorkerTrackedSession`): a session with no track, or one that is
 *   closed or abandoned, is 404, like a session that does not exist. Nothing the model sends picks a session, a track
 *   or a file.
 * - `readWorkerContext` reuses the designer readers (track-board.ts, track-direction.ts) and runs the result through
 *   `stripForbidden`, so `client_id`, `notes`, `storage_key`, `email` and `contacts` cannot reach the box. Asset views
 *   carry no URL at all: the daemon asks the machine route for bytes by asset id.
 * - `patchDirectionAsWorker` calls the same implementation as the designer PATCH (`patchDirectionAs`), marking the
 *   draft `drafted_by: 'worker'` with `base_version` optional and `base_revision` required once a draft exists (the
 *   `revision` of the direction it last read). It never signs and never revises.
 */
import { z } from 'zod';
import type { DesignSession, DesignTrack } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { isUuid } from './helpers';
import { loadTrack } from './track-core';
import { clientStatementsFor, listReferences, readBrief, stripForbidden } from './track-board';
import { patchDirectionAs, readDirection } from './track-direction';

export const CONTEXT_PARTS = ['brief', 'board', 'direction', 'client_statements', 'pages'] as const;
export type ContextPart = (typeof CONTEXT_PARTS)[number];
export const MAX_CONTEXT_IDS = 20;

/** Terminal session states (DesignSessionStatus): the worker can no longer read or write through such a session. */
const ENDED_SESSION_STATUSES: ReadonlySet<DesignSession['status']> = new Set(['closed', 'abandoned']);

/** The session row, then its track. 404 for a session that does not exist, one with no track, and one that has ended. */
export async function loadWorkerTrackedSession(sessionId: string): Promise<{ session: DesignSession; track: DesignTrack }> {
  if (!isUuid(sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  const session = await prisma.designSession.findUnique({ where: { id: sessionId } });
  if (!session || !session.track_id || ENDED_SESSION_STATUSES.has(session.status)) throw new ApiError('Session not found', 404, 'not_found');
  return { session, track: await loadTrack(prisma, session.track_id) };
}

/** `?part=&ids=` (ids comma separated, uuids, at most 20). A bad part or id is 400, never silently ignored. */
export function parseContextQuery(params: URLSearchParams): { part: ContextPart; ids: string[] | null } {
  const part = z.enum(CONTEXT_PARTS).safeParse(params.get('part'));
  if (!part.success) throw new ApiError(`part must be one of ${CONTEXT_PARTS.join(', ')}`, 400, 'bad_part');
  const raw = params.get('ids');
  if (raw === null || raw === '') return { part: part.data, ids: null };
  const ids = raw.split(',').map((s) => s.trim());
  if (ids.length > MAX_CONTEXT_IDS) throw new ApiError(`At most ${MAX_CONTEXT_IDS} ids`, 400, 'too_many_ids');
  if (!ids.every((id) => isUuid(id))) throw new ApiError('Every id must be a uuid', 400, 'bad_ids');
  return { part: part.data, ids: [...new Set(ids.map((s) => s.toLowerCase()))] };
}

type AssetLike = { id: string; kind: string; content_type: string; width: number | null; height: number | null; page: number | null; page_path: string | null; viewport_w: number | null; status: string; reject_reason: string | null };

/** The worker's asset view: the designer fields minus the browser URL (the machine route is addressed by id). */
function workerAsset(a: AssetLike) {
  return { id: a.id, kind: a.kind, content_type: a.content_type, width: a.width, height: a.height, page: a.page, page_path: a.page_path, viewport_w: a.viewport_w, status: a.status, reject_reason: a.reject_reason };
}

/** Walk a designer projection and replace every asset view (`kind` + `content_type`) with the worker's view. */
function swapAssetViews(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(swapAssetViews);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const o = value as Record<string, unknown>;
    if (typeof o.kind === 'string' && typeof o.content_type === 'string' && typeof o.id === 'string') return workerAsset(o as unknown as AssetLike);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = swapAssetViews(v);
    return out;
  }
  return value;
}

const only = <T extends { id: string }>(rows: T[], ids: string[] | null): T[] => (ids ? rows.filter((r) => ids.includes(r.id)) : rows);

/**
 * One part of the track's context, as the daemon sees it. `ids` narrow `board` (reference ids), `client_statements`
 * (statement ids) and `pages` (page review ids); the filter runs over rows already scoped to the session's track or
 * project, so an id of another track simply matches nothing. `brief` and `direction` ignore `ids`.
 */
export async function readWorkerContext(track: DesignTrack, session: Pick<DesignSession, 'id'>, workerUserId: string, part: ContextPart, ids: string[] | null) {
  let data: unknown;
  switch (part) {
    case 'brief': {
      const { brief, assets } = await readBrief(track, session.id, workerUserId);
      data = { brief, assets: swapAssetViews(assets) };
      break;
    }
    case 'board':
      data = { references: swapAssetViews(only(await listReferences(track.id, session.id), ids)) };
      break;
    case 'direction':
      data = await readDirection(track);
      break;
    case 'client_statements':
      data = { client_statements: only(await clientStatementsFor(track.project_id), ids) };
      break;
    case 'pages': {
      // What the data model holds today: one DesignPageReview row per built page (written when a build is adopted).
      const rows = await prisma.designPageReview.findMany({ where: { track_id: track.id }, orderBy: { page_path: 'asc' } });
      data = {
        pages: only(rows, ids).map((p) => ({
          id: p.id, path: p.page_path, title: p.title, status: p.status, view_count: p.view_count, last_viewed_at: p.last_viewed_at,
          last_change_at: p.last_change_at, changed_after_approval: p.changed_after_approval, approved_at: p.approved_at,
          latest_shot_asset_ids: p.latest_shot_asset_ids,
        })),
      };
      break;
    }
  }
  return stripForbidden({ part, track: { id: track.id, stage: track.stage, busy: track.busy_job_id !== null }, ...(data as object) }, false);
}

/**
 * PATCH art-direction from the worker: the designer PATCH (one shared implementation, `patchDirectionAs`) with the draft
 * marked `drafted_by: 'worker'` and `base_version` optional. 409 `direction_signed` when the current version is signed,
 * 409 `version_moved` on a stale `base_version`, and on a missing or stale `base_revision` once a draft exists. There
 * is no sign or revise here.
 */
export async function patchDirectionAsWorker(trackId: string, input: { patch: Record<string, unknown>; base_version?: number; base_revision?: string }) {
  return patchDirectionAs(trackId, { draftedBy: 'worker', by: 'worker' }, input);
}
