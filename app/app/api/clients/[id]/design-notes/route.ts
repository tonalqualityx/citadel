import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireDesignNotesKey } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { NOTES_BODY_BYTES, createNotes, createNotesSchema, listNotes } from '@/lib/design/design-notes';

// POST /api/clients/:id/design-notes (SPEC 8.1, design-notes lane): a batch of at most 100 notes, idempotent on
// (client_id, source_ref, quote_sha). 201 {created: [{index, id, ...}], skipped: [{index, id, ...}]}; 404 unknown client.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireDesignNotesKey();
    const clientId = idParam((await params).id, 'Client not found');
    const b = await workerBody(request, createNotesSchema, NOTES_BODY_BYTES);
    const result = await createNotes(clientId, b);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

const query = z.object({
  source_ref: z.string().min(1).max(300).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

// GET /api/clients/:id/design-notes?source_ref=&since= : every status, oldest first (dedupe and backfill dry runs).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireDesignNotesKey();
    const clientId = idParam((await params).id, 'Client not found');
    const sp = request.nextUrl.searchParams;
    const q = query.safeParse({ source_ref: sp.get('source_ref') ?? undefined, since: sp.get('since') ?? undefined });
    if (!q.success) throw new ApiError('Invalid query: source_ref (text) and since (ISO-8601 date-time) only', 400, 'invalid_query');
    const notes = await listNotes(clientId, { source_ref: q.data.source_ref, since: q.data.since ? new Date(q.data.since) : undefined });
    return NextResponse.json({ notes });
  } catch (error) {
    return handleApiError(error);
  }
}
