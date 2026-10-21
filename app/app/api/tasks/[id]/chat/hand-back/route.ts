import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { handBack } from '@/lib/portal/chat/handoff';

// POST /api/tasks/:id/chat/hand-back (portal phase C; staff)
// "Hand back to the assistant": the conversation leaves with_person and the assistant answers again.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const ok = await handBack(id.data);
    if (!ok) throw new ApiError('This conversation is not with a person.', 409, 'not_with_person');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
