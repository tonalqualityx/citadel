import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMeetingResponse } from '@/lib/api/formatters';
import { logCreate } from '@/lib/services/activity';

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

const createMeetingSchema = z.object({
  title: z.string().min(1).max(255),
  client_id: z.string().uuid(),
  meeting_date: z.string().datetime(),
  summary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  transcript_url: z.string().max(500).optional().nullable(),
  recording_url: z.string().max(500).optional().nullable(),
  client_attendees: z.string().optional().nullable(),
  attendee_ids: z.array(z.string().uuid()).optional(),
  accord_ids: z.array(z.string().uuid()).optional(),
  project_ids: z.array(z.string().uuid()).optional(),
  charter_ids: z.array(z.string().uuid()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const client_id = searchParams.get('client_id') || undefined;
    const accord_id = searchParams.get('accord_id') || undefined;
    const date_from = searchParams.get('date_from') || undefined;
    const date_to = searchParams.get('date_to') || undefined;

    const where = {
      is_deleted: false,
      ...(search && {
        title: { contains: search, mode: 'insensitive' as const },
      }),
      ...(client_id && { client_id }),
      ...(accord_id && {
        meeting_accords: { some: { accord_id } },
      }),
      ...(date_from && {
        meeting_date: { gte: new Date(date_from) },
      }),
      ...(date_to && {
        meeting_date: {
          ...(date_from ? { gte: new Date(date_from) } : {}),
          lte: new Date(date_to),
        },
      }),
    };

    const [meetings, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        include: meetingInclude,
        orderBy: { meeting_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.meeting.count({ where }),
    ]);

    return NextResponse.json({
      meetings: meetings.map(formatMeetingResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createMeetingSchema.parse(body);

    // Validate client exists
    const client = await prisma.client.findUnique({
      where: { id: data.client_id },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    const meeting = await prisma.meeting.create({
      data: {
        title: data.title,
        client_id: data.client_id,
        meeting_date: new Date(data.meeting_date),
        summary: data.summary || null,
        notes: data.notes || null,
        transcript_url: data.transcript_url || null,
        recording_url: data.recording_url || null,
        client_attendees: data.client_attendees || null,
        created_by_id: auth.userId,
        attendees: data.attendee_ids?.length ? {
          create: data.attendee_ids.map(uid => ({ user_id: uid })),
        } : undefined,
        meeting_accords: data.accord_ids?.length ? {
          create: data.accord_ids.map(aid => ({ accord_id: aid })),
        } : undefined,
        meeting_projects: data.project_ids?.length ? {
          create: data.project_ids.map(pid => ({ project_id: pid })),
        } : undefined,
        meeting_charters: data.charter_ids?.length ? {
          create: data.charter_ids.map(cid => ({ charter_id: cid })),
        } : undefined,
      },
      include: meetingInclude,
    });

    await logCreate(auth.userId, 'meeting', meeting.id, meeting.title);

    return NextResponse.json(formatMeetingResponse(meeting), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
