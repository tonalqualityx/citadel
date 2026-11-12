import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { checklistBodySchema, writeChecklist } from '@/lib/tasks/checklist';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';

/**
 * POST /api/tasks/:id/checklist  { item_id, completed?, answer? }
 * Ticks or unticks one "Done when" item. With `answer` it also stores the answer as an internal task comment
 * (`Answer on "<item>": <answer>`) and ticks the item, in one transaction. Callers: the owner's browser session and
 * any signed-in staff user who can see the task; a machine key (the bast-chat lane, or any key minted for a bot user) may tick, untick and answer too, but not on a task a bot holds.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = checklistBodySchema.parse(await request.json());
    await checkTaskAccess(id, auth);
    const result = await writeChecklist({
      taskId: id,
      body,
      authorId: auth.userId,
      lane: auth.lane ?? null,
      machine: !!auth.lane || BOT_USER_IDS.includes(auth.userId),
      botIds: BOT_USER_IDS,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
