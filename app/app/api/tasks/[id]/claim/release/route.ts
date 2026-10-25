import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { releaseClaim } from '@/lib/tasks/claims';

const bodySchema = z.object({ token: z.string().min(1).max(100), });

// POST /api/tasks/:id/claim/release - give the task up. Clears the claim only; the status is never changed here.
// A wrong token changes nothing and answers released:false.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = z.string().uuid().parse((await params).id);
    const body = bodySchema.parse(await request.json());
    const released = await releaseClaim({ taskId: id, token: body.token });
    return NextResponse.json({ released });
  } catch (error) {
    return handleApiError(error);
  }
}
