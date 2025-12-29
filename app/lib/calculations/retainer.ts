import { prisma } from '@/lib/db/prisma';

export interface RetainerStatus {
  clientId: string;
  clientName: string;
  periodStart: Date;
  periodEnd: Date;
  allocatedHours: number;
  usedHours: number;
  remainingHours: number;
  percentUsed: number;
  status: 'healthy' | 'warning' | 'critical' | 'exceeded';
}

/**
 * Get retainer status for a single client
 */
export async function getRetainerStatus(
  clientId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<RetainerStatus | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      retainer_hours: true,
    },
  });

  if (!client || !client.retainer_hours) {
    return null;
  }

  const allocatedHours = Number(client.retainer_hours);

  // Sum billable time entries for this client in the period
  const timeEntries = await prisma.timeEntry.aggregate({
    where: {
      project: { client_id: clientId },
      started_at: { gte: periodStart, lte: periodEnd },
      is_billable: true,
      is_deleted: false,
    },
    _sum: { duration: true },
  });

  const usedMinutes = timeEntries._sum.duration || 0;
  const usedHours = usedMinutes / 60;
  const remainingHours = allocatedHours - usedHours;
  const percentUsed = allocatedHours > 0 ? (usedHours / allocatedHours) * 100 : 0;

  let status: RetainerStatus['status'] = 'healthy';
  if (percentUsed >= 100) {
    status = 'exceeded';
  } else if (percentUsed >= 90) {
    status = 'critical';
  } else if (percentUsed >= 75) {
    status = 'warning';
  }

  return {
    clientId: client.id,
    clientName: client.name,
    periodStart,
    periodEnd,
    allocatedHours,
    usedHours: Math.round(usedHours * 100) / 100,
    remainingHours: Math.round(remainingHours * 100) / 100,
    percentUsed: Math.round(percentUsed),
    status,
  };
}

/**
 * Get retainer status for all clients with retainers
 */
export async function getAllRetainerStatuses(
  periodStart: Date,
  periodEnd: Date
): Promise<RetainerStatus[]> {
  const clientsWithRetainers = await prisma.client.findMany({
    where: {
      retainer_hours: { not: null },
      is_deleted: false,
      status: 'active',
    },
    select: { id: true },
  });

  const statuses = await Promise.all(
    clientsWithRetainers.map((c) => getRetainerStatus(c.id, periodStart, periodEnd))
  );

  return statuses.filter((s): s is RetainerStatus => s !== null);
}

/**
 * Get current month period boundaries
 */
export function getCurrentMonthPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Get period boundaries for a specific month
 */
export function getMonthPeriod(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
}
