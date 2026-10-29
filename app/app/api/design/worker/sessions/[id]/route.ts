import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, num, requireWorker, workerBody, workerSessionView } from '@/lib/design/worker-kit';
import { resolveDriveFolder } from '@/lib/design/worker-inbox';
import { assetsBelongToSession } from '@/lib/design/assets';
import { terminalStatusFor, transition, transitionSession } from '@/lib/design/sessions';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const s = await prisma.designSession.findUnique({
      where: { id },
      include: {
        task: { select: { id: true, title: true, description: true, requirements: true, tags: true } },
        site: { select: { id: true, name: true } },
        designer: { select: { name: true } },
        pins: { where: { status: 'sent' }, orderBy: { created_at: 'asc' } },
        changes: { where: { decision: { not: 'accepted' } }, orderBy: { created_at: 'asc' } },
      },
    });
    if (!s) throw new ApiError('Session not found', 404, 'not_found');
    const { task, site, designer, pins, changes, ...row } = s;
    return NextResponse.json({
      session: workerSessionView({ ...row, cost_usd: row.cost_usd, budget_usd: row.budget_usd }),
      task,
      site,
      drive_folder_id: await resolveDriveFolder(s, prisma),
      designer: { name: designer.name },
      pins: pins.map((p) => ({
        pin_id: p.id, note: p.note, path: p.page_path, sha: p.preview_sha, data_lib: p.data_lib, lib_stack: p.lib_stack,
        data_shape: p.data_shape, selector: p.selector, tag: p.tag, classes: p.classes, text_quote: p.text_quote,
        bbox: p.bbox, viewport: { w: p.viewport_width, h: p.viewport_height }, status: p.status,
        ...(p.crop_asset_id ? { crop_asset_id: p.crop_asset_id } : {}),
      })),
      open_changes: changes.map((c) => ({
        id: c.id, commit_sha: c.commit_sha, parent_sha: c.parent_sha, summary: c.summary, files: c.files, data_libs: c.data_libs,
        pages: c.pages, pin_ids: c.pin_ids, decision: c.decision, designer_note: c.designer_note, is_restore: c.is_restore,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const jsonCap = (max: number) => z.unknown().refine((v) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8') <= max, { message: 'too large' });
const sha = z.string().regex(/^[0-9a-f]{7,64}$/i);

// Strict on purpose: any field not listed (last_publish_id, publish_requested_*, designer_id, ...) is a 400.
const patchSchema = z
  .object({
    status: z.enum(['pending', 'active', 'awaiting_input', 'paused_budget', 'stopped', 'publishing', 'closed', 'abandoned']),
    sdk_session_id: z.string().max(100),
    base_sha: sha,
    head_sha: sha,
    preview_sha: sha,
    preview_url: z.string().url().max(500),
    preview_deploy_url: z.string().url().max(500),
    worktree_path: z.string().max(500),
    cost_usd: z.number().min(0).max(100000),
    live_text: z.string().max(40000).nullable(),
    live_action: z.string().max(200).nullable(),
    lib_index: jsonCap(64 * 1024),
    diff_summary: jsonCap(64 * 1024),
    diff_asset_id: z.string().uuid().nullable(),
    publish_precheck: jsonCap(64 * 1024),
    last_heartbeat_at: z.coerce.date(),
  })
  .partial()
  .strict();

function previewHostOk(url: string, alias: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && new RegExp(`^${alias.replace(/[^a-z0-9-]/gi, '')}\\.[a-z0-9-]+\\.pages\\.dev$`).test(u.hostname);
  } catch {
    return false;
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const body = await workerBody(request, patchSchema);
    const current = await prisma.designSession.findUnique({ where: { id } });
    if (!current) throw new ApiError('Session not found', 404, 'not_found');

    if (body.preview_url !== undefined && !previewHostOk(body.preview_url, current.preview_alias)) {
      throw new ApiError('preview_url must be https://<preview_alias>.<project>.pages.dev', 400, 'bad_preview_url');
    }
    if (body.preview_deploy_url !== undefined) {
      let ok = false;
      try {
        const u = new URL(body.preview_deploy_url);
        ok = u.protocol === 'https:' && /^[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev$/.test(u.hostname);
      } catch { /* not a url */ }
      if (!ok) throw new ApiError('preview_deploy_url must be https://<hash>.<project>.pages.dev', 400, 'bad_preview_url');
    }
    if (body.diff_asset_id && !(await assetsBelongToSession(id, [body.diff_asset_id]))) {
      throw new ApiError('diff_asset_id must belong to this session', 400, 'bad_assets');
    }

    // Status: the 8.7 table, worker moves only. closed/abandoned is decided by publish history, not by the caller.
    let to = body.status;
    if (to === 'closed' || to === 'abandoned') to = await terminalStatusFor(id);
    const movesStatus = to !== undefined && to !== current.status;
    if (movesStatus) transition(current, to!, 'worker');

    const { status: _status, cost_usd, lib_index, diff_summary, publish_precheck, ...rest } = body;
    void _status;
    const data: Prisma.DesignSessionUpdateManyMutationInput & { diff_asset_id?: string | null } = { ...rest };
    if (lib_index !== undefined) data.lib_index = lib_index as Prisma.InputJsonValue;
    if (diff_summary !== undefined) data.diff_summary = diff_summary as Prisma.InputJsonValue;
    if (publish_precheck !== undefined) data.publish_precheck = publish_precheck as Prisma.InputJsonValue;
    if (cost_usd !== undefined) {
      if (cost_usd < num(current.cost_usd) - 0.00005) throw new ApiError('cost_usd cannot decrease', 409, 'cost_decrease');
      data.cost_usd = cost_usd.toFixed(4);
    }
    if (Object.keys(data).length > 0) {
      // Compare and set: a concurrent higher cost wins; ours then loses with a 409.
      const res = await prisma.designSession.updateMany({
        where: { id, ...(cost_usd !== undefined ? { cost_usd: { lte: cost_usd.toFixed(4) } } : {}) },
        data,
      });
      if (res.count !== 1) throw new ApiError('cost_usd cannot decrease', 409, 'cost_decrease');
    }
    if (movesStatus) await transitionSession(id, to!, 'worker');
    const fresh = await prisma.designSession.findUniqueOrThrow({ where: { id } });
    return NextResponse.json({ session: workerSessionView(fresh) });
  } catch (error) {
    return handleApiError(error);
  }
}
