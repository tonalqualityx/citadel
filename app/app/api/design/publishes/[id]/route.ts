/**
 * GET /api/design/publishes/:id (design 7.1): the page Mike's FYI notification opens. Admin, pm, or the
 * session's designer (while she is on the session's project); anyone else 404. Signed-in session only. Full projection incl. what was confirmed and whether this caller may
 * roll it back.
 */
import { NextResponse } from 'next/server';
import { designErrorResponse, loadPublishPage } from '@/lib/design/publishes';
import { authActor } from '@/lib/design/route-kit';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await authActor(); // session only (W8.2 H7)
    const { id } = await params;
    return NextResponse.json(await loadPublishPage(actor, id));
  } catch (error) {
    return designErrorResponse(error);
  }
}
