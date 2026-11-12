import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { addReferences } from '@/lib/design/track-runner';

const item = z.object({
  source: z.enum(['bast_pick', 'client_named', 'indelible_site']),
  url: z.string().url().startsWith('https://').max(500).optional(),
  title: z.string().min(1).max(200),
  why_md: z.string().max(800).optional(),
}).strict();
const schema = z.object({ references: z.array(item).min(1).max(20) }).strict();

// POST /api/design/runner/tracks/:id/references (SPEC 6.1a): up to 20 picks in one call; one `capture` job per URL.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireTrackRunner();
    const id = idParam((await params).id, 'Track not found');
    const b = await workerBody(request, schema, 128 * 1024);
    return NextResponse.json(await addReferences(id, b.references), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
