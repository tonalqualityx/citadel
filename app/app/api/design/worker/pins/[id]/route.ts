import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { assetsBelongToSession } from '@/lib/design/assets';

const schema = z
  .object({
    crop_asset_id: z.string().uuid().optional(),
    status: z.enum(['resolved', 'followup']).optional(),
    followup_task_id: z.string().uuid().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Pin not found');
    const b = await workerBody(request, schema);
    const pin = await prisma.designPin.findUnique({ where: { id } });
    if (!pin) throw new ApiError('Pin not found', 404, 'not_found');
    if (b.crop_asset_id && !(await assetsBelongToSession(pin.session_id, [b.crop_asset_id]))) throw new ApiError('Asset must belong to the pin\'s session', 400, 'bad_assets');
    if (b.followup_task_id && !(await prisma.task.findUnique({ where: { id: b.followup_task_id }, select: { id: true } }))) {
      throw new ApiError('Unknown follow-up task', 400, 'bad_task');
    }
    const pinOut = await prisma.designPin.update({
      where: { id },
      data: {
        ...(b.crop_asset_id ? { crop_asset_id: b.crop_asset_id } : {}),
        ...(b.status ? { status: b.status } : {}),
        ...(b.followup_task_id ? { followup_task_id: b.followup_task_id } : {}),
      },
    });
    return NextResponse.json({ pin: pinOut });
  } catch (error) {
    return handleApiError(error);
  }
}
