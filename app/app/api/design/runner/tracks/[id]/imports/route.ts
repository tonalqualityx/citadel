import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { registerImport } from '@/lib/design/track-runner';

const schema = z.object({
  task_id: z.string().uuid(),
  template_page_path: z.string().min(1).max(300).startsWith('/'),
  source_paths: z.array(z.string().min(1).max(500)).min(1).max(200),
  mapping_path: z.string().min(1).max(300).optional(),
  expected_count: z.number().int().min(0).max(100000),
  required_for_launch: z.boolean().optional(),
}).strict();

// POST /api/design/runner/tracks/:id/imports (SPEC 6.1a): register a DesignImport from a design-import task.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireTrackRunner();
    const id = idParam((await params).id, 'Track not found');
    const b = await workerBody(request, schema, 64 * 1024);
    return NextResponse.json({ import: await registerImport(id, b) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
