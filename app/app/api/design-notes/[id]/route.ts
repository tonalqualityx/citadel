import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireDesignNotesKey } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { patchNoteSchema, setNoteStatus } from '@/lib/design/design-notes';

// PATCH /api/design-notes/:id (SPEC 8.1, design-notes lane): {status: superseded | withdrawn, superseded_by_id?}.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireDesignNotesKey();
    const id = idParam((await params).id, 'Design note not found');
    const b = await workerBody(request, patchNoteSchema, 8 * 1024);
    return NextResponse.json({ note: await setNoteStatus(id, b) });
  } catch (error) {
    return handleApiError(error);
  }
}
