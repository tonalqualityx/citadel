import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { requestRestore, restoreSchema } from '@/lib/design/changes';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

// POST /api/design/sessions/:id/restore (design 7.1): DesignCommand(restore). to_sha must belong to this session. 202.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    const input = await body(request, restoreSchema, 4096);
    const { command_id } = await requestRestore(actor, session, input.to_sha);
    return NextResponse.json({ command_id }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
