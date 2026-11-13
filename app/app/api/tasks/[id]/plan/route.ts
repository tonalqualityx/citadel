import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { loadPlan } from '@/lib/tasks/plan';

/**
 * GET /api/tasks/:id/plan
 * The whole plan of a Triage card, kept after release: the six sections in fixed order (requirements, dates, team, billing, examples,
 * decisions), each with its items and a last-change line (updated_at, updated_by, note), the questions Mike answered (read through from
 * the Questions data), and for a project card the shape, sitemap, dates and deal read through from the project. Items carry their source,
 * mark and the Mark wrong flag. While the card is in Triage: Mike, the chat lane and the Dox lane only (404 for everyone else); after
 * release anyone who can see the task, except designers; a contractor gets the plan without its billing section.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const task = await checkTaskAccess(id, auth);
    return NextResponse.json(await loadPlan(task, auth, request.headers));
  } catch (error) {
    return handleApiError(error);
  }
}
