import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadProjectDetail } from '@/lib/portal/project-detail';

// GET /api/portal/projects/:id (portal MVP A5)
// One project, in client words. 404 whenever the project is not accessible to the signed-in
// contact (wrong client, hidden, restricted for a non-owner, quote/queue/suspended/cancelled,
// deleted): the same answer for "missing" and "not yours", so ids cannot be probed.
// Every field is an allow-list. No estimates, assignees, tags, billing or internal notes.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;

    const detail = await loadProjectDetail(access, id);
    if (!detail) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return handleApiError(error);
  }
}
