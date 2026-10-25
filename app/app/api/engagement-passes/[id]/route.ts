import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializePass } from '@/lib/engagement/serialize';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patchSchema = z.object({
  finished: z.boolean().optional(),
  model: z.string().max(80).optional(),
  cost_usd: z.number().min(0).max(1000).optional(),
  tasks_read: z.number().int().min(0).max(100000).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  mike_items: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  error: z.string().max(5000).nullable().optional(),
});

/**
 * PATCH /api/engagement-passes/[id]: record what a pass did. `finished: true` stamps finished_at
 * once and the brief's last_pass_at.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const body = patchSchema.parse(await request.json());
    const pass = await prisma.engagementPass.findUnique({ where: { id } });
    if (!pass) throw new ApiError('Pass not found', 404);
    const now = new Date();
    const row = await prisma.engagementPass.update({
      where: { id },
      data: {
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(body.cost_usd !== undefined ? { cost_usd: body.cost_usd } : {}),
        ...(body.tasks_read !== undefined ? { tasks_read: body.tasks_read } : {}),
        ...(body.actions !== undefined ? { actions: body.actions as Prisma.InputJsonValue } : {}),
        ...(body.mike_items !== undefined ? { mike_items: body.mike_items as Prisma.InputJsonValue } : {}),
        ...(body.error !== undefined ? { error: body.error } : {}),
        ...(body.finished && !pass.finished_at ? { finished_at: now } : {}),
      },
    });
    if (body.finished && !pass.finished_at) {
      await prisma.engagementBrief.update({ where: { id: pass.brief_id }, data: { last_pass_at: now } });
    }
    return NextResponse.json(serializePass(row));
  } catch (error) {
    return handleApiError(error);
  }
}
