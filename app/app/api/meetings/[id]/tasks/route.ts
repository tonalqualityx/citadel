import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { logCreate } from '@/lib/services/activity';

const createTaskFromMeetingSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional().nullable(),
  priority: z.number().min(1).max(5).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  accord_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  charter_id: z.string().uuid().optional().nullable(),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    // Validate meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id, is_deleted: false },
    });
    if (!meeting) {
      throw new ApiError('Meeting not found', 404);
    }

    const body = await request.json();
    const data = createTaskFromMeetingSchema.parse(body);

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        assignee_id: data.assignee_id || null,
        due_date: data.due_date ? new Date(data.due_date) : null,
        battery_impact: data.battery_impact,
        meeting_id: id,
        client_id: meeting.client_id,
        project_id: data.project_id || null,
        created_by_id: auth.userId,
      },
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
        client: { select: { id: true, name: true } },
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            client: { select: { id: true, name: true } },
          },
        },
        created_by: { select: { id: true, name: true } },
      },
    });

    await logCreate(auth.userId, 'task', task.id, task.title);

    return NextResponse.json(formatTaskResponse(task), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
