import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMeetingResponse } from '@/lib/api/formatters';
import { logUpdate, logDelete } from '@/lib/services/activity';

const meetingInclude = {
  client: { select: { id: true, name: true, status: true } },
  created_by: { select: { id: true, name: true, email: true, avatar_url: true } },
  attendees: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  meeting_accords: {
    include: { accord: { select: { id: true, name: true, status: true } } },
  },
  meeting_projects: {
    include: { project: { select: { id: true, name: true } } },
  },
  meeting_charters: {
    include: { charter: { select: { id: true, name: true } } },
  },
  _count: { select: { tasks: true } },
};

const updateMeetingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  client_id: z.string().uuid().optional(),
  meeting_date: z.string().datetime().optional(),
  summary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  transcript_url: z.string().max(500).optional().nullable(),
  recording_url: z.string().max(500).optional().nullable(),
  client_attendees: z.string().optional().nullable(),
  transcript_not_available: z.boolean().optional(),
  recording_not_available: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const meeting = await prisma.meeting.findUnique({
      where: { id, is_deleted: false },
      include: {
        ...meetingInclude,
        tasks: {
          where: { is_deleted: false },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            assignee: { select: { id: true, name: true } },
          },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!meeting) {
      throw new ApiError('Meeting not found', 404);
    }

    const response = formatMeetingResponse(meeting);
    return NextResponse.json({
      ...response,
      tasks: meeting.tasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateMeetingSchema.parse(body);

    const meeting = await prisma.meeting.update({
      where: { id },
      data: {
        ...data,
        meeting_date: data.meeting_date !== undefined
          ? new Date(data.meeting_date)
          : undefined,
      },
      include: meetingInclude,
    });

    await logUpdate(auth.userId, 'meeting', meeting.id, meeting.title, {});

    return NextResponse.json(formatMeetingResponse(meeting));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const meeting = await prisma.meeting.update({
      where: { id },
      data: { is_deleted: true },
    });

    await logDelete(auth.userId, 'meeting', meeting.id, meeting.title);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
