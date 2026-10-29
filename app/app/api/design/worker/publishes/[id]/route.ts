import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { applyWorkerPublishPatch } from '@/lib/design/publishes';

const sha = z.string().regex(/^[0-9a-f]{7,64}$/i);
const json = (max: number) => z.unknown().refine((v) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8') <= max, { message: 'too large' });

// Strict: the lane cannot touch actor_*, publish_mode, main_role, site_designer_publish, any confirmation_* field,
// kind or session. It also cannot create a publish (there is no POST) or move a row out of awaiting_confirmation
// (applyWorkerPublishPatch only moves queued/running rows forward).
const workerPublishPatchSchema = z
  .object({
    status: z.enum(['running', 'published', 'blocked_gates', 'conflict', 'failed']),
    from_main_sha: sha.optional(),
    result_sha: sha.optional(),
    deploy_id: z.string().max(128).optional(),
    deploy_url: z.string().url().max(500).optional(),
    alias_url: z.string().url().max(500).optional(),
    gates: json(32 * 1024).optional(),
    diff_summary: json(32 * 1024).optional(),
    change_ids: z.array(z.string().uuid()).max(500).optional(),
    error: z.string().max(4000).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Publish not found');
    const patch = await workerBody(request, workerPublishPatchSchema);
    const publish = await applyWorkerPublishPatch(id, patch);
    return NextResponse.json({ publish });
  } catch (error) {
    return handleApiError(error);
  }
}
