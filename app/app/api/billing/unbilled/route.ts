import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { getCurrentMonthPeriod } from '@/lib/calculations/retainer';

interface UnbilledMilestone {
  id: string;
  name: string;
  billing_amount: number;
  project_id: string;
  project_name: string;
  triggered_at: string;
}

interface UnbilledTask {
  id: string;
  title: string;
  time_spent_minutes: number;
  estimated_minutes: number | null;
  project_id: string | null;
  project_name: string | null;
  is_billable: boolean;
  billing_target: number | null;
  is_retainer_work: boolean;
  completed_at: string | null;
}

interface ClientUnbilledData {
  clientId: string;
  clientName: string;
  parentAgencyId: string | null;
  parentAgencyName: string | null;
  hourlyRate: number | null;
  isRetainer: boolean;
  retainerHours: number | null;
  usedRetainerHoursThisMonth: number;
  overageMinutes: number; // Minutes over retainer (0 if not retainer or under)
  milestones: UnbilledMilestone[];
  tasks: UnbilledTask[];
  totalMilestoneAmount: number;
  totalTaskMinutes: number;
}

interface UnbilledResponse {
  byClient: ClientUnbilledData[];
  summary: {
    totalMilestoneAmount: number;
    totalTaskMinutes: number;
    clientCount: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    // Get triggered milestones (billing_status = 'triggered')
    const triggeredMilestones = await prisma.milestone.findMany({
      where: {
        billing_status: 'triggered',
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            client_id: true,
            client: {
              select: {
                id: true,
                name: true,
                hourly_rate: true,
                retainer_hours: true,
                parent_agency_id: true,
                parent_agency: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        triggered_at: 'asc',
      },
    });

    // Get completed billable tasks that haven't been invoiced
    // Must have billable time entries, task must be billable, and no running timer
    // Excludes: support tickets, fixed-price project tasks (they bill via milestones)
    const completedTasks = await prisma.task.findMany({
      where: {
        status: 'done',
        invoiced: false,
        is_deleted: false,
        is_billable: true, // Only fetch tasks marked as billable
        is_support: false, // Exclude support tickets
        // Exclude tasks from fixed-price projects (they bill via milestones)
        OR: [
          { project_id: null }, // Ad-hoc tasks always included
          { project: { billing_type: { not: 'fixed' } } }, // Non-fixed projects
          { project: { billing_type: null } }, // Projects without billing type
        ],
        // Must have at least one billable time entry
        time_entries: {
          some: {
            is_billable: true,
            is_deleted: false,
          },
        },
        // No running timer on this task
        NOT: {
          time_entries: {
            some: {
              is_running: true,
              is_deleted: false,
            },
          },
        },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            billing_type: true, // Need for retainer check
            client_id: true,
            client: {
              select: {
                id: true,
                name: true,
                hourly_rate: true,
                retainer_hours: true,
                parent_agency_id: true,
                parent_agency: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        // Direct client relation for ad-hoc tasks
        client: {
          select: {
            id: true,
            name: true,
            hourly_rate: true,
            retainer_hours: true,
            parent_agency_id: true,
            parent_agency: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        time_entries: {
          where: {
            is_billable: true,
            is_deleted: false,
          },
          select: {
            duration: true,
            is_billable: true,
          },
        },
      },
      orderBy: {
        completed_at: 'asc',
      },
    });

    // Get current month period for retainer calculations
    const monthPeriod = getCurrentMonthPeriod();

    // Collect unique client IDs
    const clientIds = new Set<string>();

    triggeredMilestones.forEach((m) => {
      if (m.project?.client_id) {
        clientIds.add(m.project.client_id);
      }
    });

    completedTasks.forEach((t) => {
      // Include client from project or direct client relation (ad-hoc tasks)
      const clientId = t.project?.client_id || t.client?.id;
      if (clientId) {
        clientIds.add(clientId);
      }
    });

    // Calculate used retainer hours this month for all relevant clients
    const retainerUsageByClient = new Map<string, number>();

    if (clientIds.size > 0) {
      const clientIdArray = Array.from(clientIds);

      // Get billable time entries for this month for retainer clients
      const retainerTimeEntries = await prisma.timeEntry.groupBy({
        by: ['project_id'],
        where: {
          project: {
            client_id: { in: clientIdArray },
          },
          is_billable: true,
          is_deleted: false,
          started_at: {
            gte: monthPeriod.start,
            lte: monthPeriod.end,
          },
        },
        _sum: {
          duration: true,
        },
      });

      // Get project to client mapping
      const projectClientMap = await prisma.project.findMany({
        where: {
          id: { in: retainerTimeEntries.map((e) => e.project_id).filter(Boolean) as string[] },
        },
        select: {
          id: true,
          client_id: true,
        },
      });

      const projectToClient = new Map<string, string>();
      projectClientMap.forEach((p) => {
        if (p.client_id) {
          projectToClient.set(p.id, p.client_id);
        }
      });

      // Sum up by client
      retainerTimeEntries.forEach((entry) => {
        if (entry.project_id) {
          const clientId = projectToClient.get(entry.project_id);
          if (clientId) {
            const currentMinutes = retainerUsageByClient.get(clientId) || 0;
            retainerUsageByClient.set(clientId, currentMinutes + (entry._sum.duration || 0));
          }
        }
      });
    }

    // Group by client
    const clientDataMap = new Map<string, ClientUnbilledData>();

    // Process milestones
    for (const milestone of triggeredMilestones) {
      if (!milestone.project?.client) continue;

      const client = milestone.project.client;
      const clientId = client.id;

      if (!clientDataMap.has(clientId)) {
        const retainerMinutes = retainerUsageByClient.get(clientId) || 0;
        const retainerHours = client.retainer_hours ? Number(client.retainer_hours) : null;
        const retainerMinutesLimit = retainerHours ? retainerHours * 60 : 0;
        const overageMinutes = retainerMinutesLimit > 0 ? Math.max(retainerMinutes - retainerMinutesLimit, 0) : 0;

        clientDataMap.set(clientId, {
          clientId: client.id,
          clientName: client.name,
          parentAgencyId: client.parent_agency_id,
          parentAgencyName: client.parent_agency?.name || null,
          hourlyRate: client.hourly_rate ? Number(client.hourly_rate) : null,
          isRetainer: retainerHours !== null && retainerHours > 0,
          retainerHours,
          usedRetainerHoursThisMonth: Math.round((retainerMinutes / 60) * 100) / 100,
          overageMinutes,
          milestones: [],
          tasks: [],
          totalMilestoneAmount: 0,
          totalTaskMinutes: 0,
        });
      }

      const clientData = clientDataMap.get(clientId)!;
      const billingAmount = milestone.billing_amount ? Number(milestone.billing_amount) : 0;

      clientData.milestones.push({
        id: milestone.id,
        name: milestone.name,
        billing_amount: billingAmount,
        project_id: milestone.project.id,
        project_name: milestone.project.name,
        triggered_at: milestone.triggered_at?.toISOString() || '',
      });

      clientData.totalMilestoneAmount += billingAmount;
    }

    // Process tasks
    for (const task of completedTasks) {
      // Get client from project or direct client relation (for ad-hoc tasks)
      const client = task.project?.client || task.client;
      if (!client) continue;

      const clientId = client.id;

      if (!clientDataMap.has(clientId)) {
        const retainerMinutes = retainerUsageByClient.get(clientId) || 0;
        const retainerHours = client.retainer_hours ? Number(client.retainer_hours) : null;
        const retainerMinutesLimit = retainerHours ? retainerHours * 60 : 0;
        const overageMinutes = retainerMinutesLimit > 0 ? Math.max(retainerMinutes - retainerMinutesLimit, 0) : 0;

        clientDataMap.set(clientId, {
          clientId: client.id,
          clientName: client.name,
          parentAgencyId: client.parent_agency_id,
          parentAgencyName: client.parent_agency?.name || null,
          hourlyRate: client.hourly_rate ? Number(client.hourly_rate) : null,
          isRetainer: retainerHours !== null && retainerHours > 0,
          retainerHours,
          usedRetainerHoursThisMonth: Math.round((retainerMinutes / 60) * 100) / 100,
          overageMinutes,
          milestones: [],
          tasks: [],
          totalMilestoneAmount: 0,
          totalTaskMinutes: 0,
        });
      }

      const clientData = clientDataMap.get(clientId)!;

      // Calculate time spent from billable time entries
      const timeSpentMinutes = task.time_entries.reduce(
        (sum, entry) => sum + (entry.duration || 0),
        0
      );

      clientData.tasks.push({
        id: task.id,
        title: task.title,
        time_spent_minutes: timeSpentMinutes,
        estimated_minutes: task.estimated_minutes,
        project_id: task.project?.id || null,
        project_name: task.project?.name || null,
        is_billable: task.is_billable,
        billing_target: task.billing_target ? Number(task.billing_target) : null,
        is_retainer_work: task.is_retainer_work,
        completed_at: task.completed_at?.toISOString() || null,
      });

      clientData.totalTaskMinutes += timeSpentMinutes;
    }

    // Convert map to array and calculate summary
    const byClient = Array.from(clientDataMap.values());

    // Sort by client name
    byClient.sort((a, b) => a.clientName.localeCompare(b.clientName));

    const summary = {
      totalMilestoneAmount: byClient.reduce((sum, c) => sum + c.totalMilestoneAmount, 0),
      totalTaskMinutes: byClient.reduce((sum, c) => sum + c.totalTaskMinutes, 0),
      clientCount: byClient.length,
    };

    const response: UnbilledResponse = {
      byClient,
      summary,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
