import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { notifyNewPortalRequest } from '@/lib/portal/staff-notify';

const bodySchema = z.object({ task_id: z.string().uuid() });

/**
 * Admin endpoint to (re)send the "new request in the portal" notice for one portal task.
 * Runs the same code path as filing: idempotent, so a task that was already announced gets no
 * second in-app row and no second email.
 *
 * POST /api/admin/portal-request-notice   Body: { task_id }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { task_id } = bodySchema.parse(await request.json());
    const result = await notifyNewPortalRequest(task_id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
