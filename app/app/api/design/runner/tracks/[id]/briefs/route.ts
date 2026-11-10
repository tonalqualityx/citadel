import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { MAX_BRIEF_BYTES } from '@/lib/design/brief-schema';
import { publishBrief } from '@/lib/design/track-runner';

const schema = z.object({ body: z.unknown(), job_id: z.string().uuid().optional() }).strict();

// POST /api/design/runner/tracks/:id/briefs (SPEC 6.1a): publish a brief that passes the zod schema of SPEC 4.1; it
// supersedes the previous version. Publishing may complete the research -> art_direction transition.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTrackRunner();
    const id = idParam((await params).id, 'Track not found');
    const b = await workerBody(request, schema, MAX_BRIEF_BYTES + 4096);
    const { brief, entered_art_direction } = await publishBrief(id, { body: b.body, job_id: b.job_id }, auth.userId);
    return NextResponse.json({ brief: { id: brief.id, version: brief.version, status: brief.status }, entered_art_direction }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
