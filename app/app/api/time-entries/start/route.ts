import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { startRunningEntry } from '@/lib/services/time-entries';

const startTimerSchema = z.object({
  task_id: z.string().uuid(),
  project_id: z.string().uuid().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await request.json();
    const { task_id, project_id } = startTimerSchema.parse(body);

    const timer = await startRunningEntry({
      userId: auth.userId,
      taskId: task_id,
      projectId: project_id,
      touchTask: true,
    });

    return NextResponse.json({ timer });
  } catch (error) {
    return handleApiError(error);
  }
}
