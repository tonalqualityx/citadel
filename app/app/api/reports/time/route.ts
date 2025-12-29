import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const userId = searchParams.get('user_id');
    const clientId = searchParams.get('client_id');
    const projectId = searchParams.get('project_id');
    const groupBy = searchParams.get('group_by') || 'day'; // day, week, project, user, client

    // Build filters
    const where: Record<string, unknown> = {
      is_deleted: false,
    };

    if (startDate) {
      where.started_at = { gte: new Date(startDate) };
    }
    if (endDate) {
      where.started_at = {
        ...(where.started_at as object),
        lte: new Date(endDate),
      };
    }
    if (userId) {
      where.user_id = userId;
    }
    if (projectId) {
      where.project_id = projectId;
    }
    if (clientId) {
      where.project = { client_id: clientId };
    }

    // Tech users can only see their own time
    if (auth.role === 'tech') {
      where.user_id = auth.userId;
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { started_at: 'desc' },
    });

    // Calculate totals
    const totalMinutes = entries.reduce((sum, e) => sum + e.duration, 0);
    const billableMinutes = entries
      .filter((e) => e.is_billable)
      .reduce((sum, e) => sum + e.duration, 0);

    // Group as requested
    const grouped = groupTimeEntries(entries, groupBy);

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        user: e.user,
        task: e.task,
        project: e.project,
        started_at: e.started_at.toISOString(),
        ended_at: e.ended_at?.toISOString() || null,
        duration: e.duration,
        description: e.description,
        is_billable: e.is_billable,
        hourly_rate: e.hourly_rate ? Number(e.hourly_rate) : null,
      })),
      grouped,
      totals: {
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 100) / 100,
        billableMinutes,
        billableHours: Math.round((billableMinutes / 60) * 100) / 100,
        billablePercent:
          totalMinutes > 0
            ? Math.round((billableMinutes / totalMinutes) * 100)
            : 0,
        entryCount: entries.length,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface TimeEntry {
  started_at: Date;
  project_id: string | null;
  user_id: string;
  duration: number;
  project?: { id: string; name: string; client?: { id: string; name: string } | null } | null;
  user?: { id: string; name: string } | null;
}

function groupTimeEntries(
  entries: TimeEntry[],
  groupBy: string
): { key: string; label: string; minutes: number; hours: number; count: number }[] {
  const groups: Record<string, { label: string; minutes: number; count: number }> = {};

  for (const entry of entries) {
    let key: string;
    let label: string;

    switch (groupBy) {
      case 'day':
        key = entry.started_at.toISOString().split('T')[0];
        label = new Date(key).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
        break;
      case 'week':
        const weekStart = getWeekStart(entry.started_at);
        key = weekStart.toISOString().split('T')[0];
        label = `Week of ${weekStart.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`;
        break;
      case 'project':
        key = entry.project_id || 'no-project';
        label = entry.project?.name || 'No Project';
        break;
      case 'client':
        key = entry.project?.client?.id || 'no-client';
        label = entry.project?.client?.name || 'No Client';
        break;
      case 'user':
        key = entry.user_id;
        label = entry.user?.name || 'Unknown';
        break;
      default:
        key = 'all';
        label = 'All';
    }

    if (!groups[key]) {
      groups[key] = { label, minutes: 0, count: 0 };
    }
    groups[key].minutes += entry.duration;
    groups[key].count += 1;
  }

  return Object.entries(groups)
    .map(([key, data]) => ({
      key,
      label: data.label,
      minutes: data.minutes,
      hours: Math.round((data.minutes / 60) * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
