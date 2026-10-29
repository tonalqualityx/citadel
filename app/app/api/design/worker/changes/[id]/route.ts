import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { assetsBelongToSession } from '@/lib/design/assets';

const schema = z
  .object({
    before_asset_ids: z.array(z.string().uuid()).max(10).optional(),
    after_asset_ids: z.array(z.string().uuid()).max(10).optional(),
    gates: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Change not found');
    const b = await workerBody(request, schema);
    const change = await prisma.designChange.findUnique({ where: { id } });
    if (!change) throw new ApiError('Change not found', 404, 'not_found');
    const ids = [...(b.before_asset_ids ?? []), ...(b.after_asset_ids ?? [])];
    if (!(await assetsBelongToSession(change.session_id, ids))) throw new ApiError('Assets must belong to the change\'s session', 400, 'bad_assets');
    const updated = await prisma.designChange.update({
      where: { id },
      data: {
        ...(b.before_asset_ids ? { before_asset_ids: b.before_asset_ids } : {}),
        ...(b.after_asset_ids ? { after_asset_ids: b.after_asset_ids } : {}),
        ...(b.gates ? { gates: b.gates as Prisma.InputJsonValue } : {}),
      },
    });
    return NextResponse.json({ change: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
