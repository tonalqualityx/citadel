import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { createAdoptCommand } from '@/lib/design/track-adopt';

const schema = z.object({
  job_id: z.string().uuid(),
  job_branch: z.string().min(1).max(100),
  expected_base: z.string().regex(/^[0-9a-f]{40}$/, 'expected_base must be 40 hex characters'),
}).strict();

// POST /api/design/runner/tracks/:id/adopt (SPEC 2.2, 6.1a): 201 with the `adopt_branch` command. Citadel builds the
// payload from the track and job rows; the runner supplies only job_id, job_branch and expected_base.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTrackRunner();
    const id = idParam((await params).id, 'Track not found');
    const b = await workerBody(request, schema, 8 * 1024);
    const { command, created } = await createAdoptCommand(id, b, auth.userId);
    return NextResponse.json({ command, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
