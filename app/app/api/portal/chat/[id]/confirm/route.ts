import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { confirmConversation } from '@/lib/portal/chat/confirm';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

const bodySchema = z.object({ summary_version: z.number().int().min(0), project_id: z.string().uuid().nullish() });

// POST /api/portal/chat/:id/confirm { summary_version, project_id? } (portal phase C)
// "Send to the team": placement, scope gate, tags, retitle, waits and the staff notice, all
// deterministic. 409 when the summary changed; 422 choose_project when two builds are open.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const body = bodySchema.parse(await request.json());
    const done = await confirmConversation(access, id.data, body);
    return NextResponse.json({ state: 'filed', already: done.already, quote: done.quote, urgent: done.urgent, lines: done.lines, task_id: done.task_id ?? null, link: done.link ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}
