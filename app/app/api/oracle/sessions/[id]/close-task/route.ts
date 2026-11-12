import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { SESSION_ID_RE, SESSION_LANES, requireWorkCaller } from '@/lib/work/route-auth';
import { closeTaskFromSession } from '@/lib/work/sessions-store';

/**
 * Work stage E: POST /api/oracle/sessions/:id/close-task, the owner said yes in the session: close this task.
 *
 * Body (strict): {task_id}. Citadel closes the task only when code-recorded proof for THAT task exists from THIS session (a commit or
 * delivered file recorded by the evidence route), the task is not security-tagged, the session is linked to it (or its project), and no
 * checklist item is unticked. Otherwise 409 with code no_proof, security, unticked or not_linked, and the task stays open. "Done" on the
 * session's word is never proof. A close goes through the task patch (Stage A closes the linked emails), writes one Handled line with
 * Undo (72 hours) and an internal comment. 200 {closed, task_id, action_id, message}, {closed: false, already_done: true, ...} for a
 * task that is already done, or {skipped: "home_off"}. The oracle lane, and the owner's session.
 */
const bodySchema = z.object({ task_id: z.string().uuid() }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, SESSION_LANES);
    const { id } = await params;
    if (!SESSION_ID_RE.test(id)) throw new ApiError('Not found', 404, 'not_found');
    const body = bodySchema.parse(await request.json());
    const out = await closeTaskFromSession(prisma, id, body.task_id, new Date());
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
