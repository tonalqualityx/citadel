import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { recordCapture } from '@/lib/design/track-runner';

const uuid = z.string().uuid().optional();
const schema = z.object({
  capture_status: z.enum(['captured', 'failed', 'blocked']),
  capture_error: z.string().max(500).optional(),
  desktop_fold_asset_id: uuid,
  desktop_full_asset_id: uuid,
  phone_fold_asset_id: uuid,
  phone_full_asset_id: uuid,
  extracted: z.record(z.string(), z.unknown()).optional(),
}).strict();

// PATCH /api/design/runner/references/:id (SPEC 6.1a): the capture result.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireTrackRunner();
    const id = idParam((await params).id, 'Reference not found');
    const b = await workerBody(request, schema, 64 * 1024);
    const ref = await recordCapture(id, { ...b, extracted: b.extracted as Prisma.InputJsonValue | undefined });
    return NextResponse.json({ reference: ref });
  } catch (error) {
    return handleApiError(error);
  }
}
