import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { clearQuestionAsk } from '@/lib/portal/chat/apply';

// POST /api/tasks/:id/chat/clear-ask (portal phase C; staff)
// Clears an open ask a question chat should never have held (the assistant's "want me to pass this on?"),
// by the same effect apply.ts gives such an ask now: no away email, and the chat closes as an answered
// question. Posts nothing to the client. A request's ask is refused (409): it may be a real question.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const out = await clearQuestionAsk(id.data, { by: user.email || undefined });
    if (out.status === 'not_found') throw new ApiError('Not found', 404);
    if (out.status === 'not_a_question') throw new ApiError('This chat is a request; its open question is left as it is.', 409, 'not_a_question');
    return NextResponse.json({ ok: true, ...out });
  } catch (error) {
    return handleApiError(error);
  }
}
