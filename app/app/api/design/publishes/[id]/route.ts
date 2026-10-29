/**
 * GET /api/design/publishes/:id (design 7.1): the page Mike's FYI notification opens. Admin, pm, or the
 * session's designer; anyone else 404. Full projection incl. what was confirmed and whether this caller may
 * roll it back.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveDesignActor } from '@/lib/design/helpers';
import { designErrorResponse, loadPublishPage } from '@/lib/design/publishes';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const actor = await resolveDesignActor(auth);
    const { id } = await params;
    return NextResponse.json(await loadPublishPage(actor, id));
  } catch (error) {
    return designErrorResponse(error);
  }
}
