import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { MAX_WORK_DETAIL, MAX_WORK_TITLE, startWork } from '@/lib/design/work';
import { authActor, body, guardMutation } from '@/lib/design/route-kit';

const workSchema = z
  .object({
    site_id: z.string().uuid(),
    title: z.string().trim().min(1).max(MAX_WORK_TITLE),
    detail: z.string().max(MAX_WORK_DETAIL).optional(),
  })
  .strict();

// POST /api/design/work (design 7.1): start new work on a site with no pre-existing task. Session only.
export async function POST(request: NextRequest) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const input = await body(request, workSchema, 8192);
    const { session_id } = await startWork(actor, input);
    return NextResponse.json({ session_id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
