import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { notifyRetainerAlert } from '@/lib/services/notifications';

/**
 * POST /api/cron/retainer-alerts
 *
 * Checks retainer usage and sends alerts when clients approach or exceed limits.
 * Should be called daily by a cron job.
 *
 * Alert thresholds:
 * - 80%: Warning alert
 * - 100%: Over limit alert
 *
 * Requires CRON_SECRET header for authorization.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Find clients with retainer hours
    const clientsWithRetainers = await prisma.client.findMany({
      where: {
        status: 'active',
        retainer_hours: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        retainer_hours: true,
      },
    });

    // Get all PM and Admin users (they should be alerted)
    const pmUsers = await prisma.user.findMany({
      where: {
        is_active: true,
        role: { in: ['pm', 'admin'] },
      },
      select: { id: true },
    });
    const pmUserIds = pmUsers.map((u) => u.id);

    if (pmUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No PM users to notify',
        clientsChecked: clientsWithRetainers.length,
        alertsSent: 0,
      });
    }

    // Check which alerts have already been sent this month
    const existingAlerts = await prisma.notification.findMany({
      where: {
        type: 'retainer_alert',
        created_at: {
          gte: monthStart,
        },
      },
      select: {
        entity_id: true,
        message: true,
      },
    });

    // Track which thresholds have been alerted per client
    const alertedThresholds = new Map<string, Set<string>>();
    for (const alert of existingAlerts) {
      if (!alert.entity_id) continue;
      if (!alertedThresholds.has(alert.entity_id)) {
        alertedThresholds.set(alert.entity_id, new Set());
      }
      // Parse threshold from message (e.g., "80% used" or "100% used")
      if (alert.message?.includes('100%')) {
        alertedThresholds.get(alert.entity_id)!.add('100');
      } else if (alert.message?.includes('80%')) {
        alertedThresholds.get(alert.entity_id)!.add('80');
      }
    }

    let alertsSent = 0;

    for (const client of clientsWithRetainers) {
      const retainerHours = Number(client.retainer_hours);
      if (!retainerHours || retainerHours <= 0) continue;

      // Calculate hours used this month for this client
      // Sum time entries on tasks/projects associated with this client
      const timeEntries = await prisma.timeEntry.aggregate({
        where: {
          is_deleted: false,
          started_at: {
            gte: monthStart,
            lte: monthEnd,
          },
          OR: [
            { task: { client_id: client.id } },
            { task: { project: { client_id: client.id } } },
            { project: { client_id: client.id } },
          ],
        },
        _sum: {
          duration: true,
        },
      });

      const minutesUsed = timeEntries._sum.duration || 0;
      const hoursUsed = Math.round((minutesUsed / 60) * 10) / 10; // Round to 1 decimal
      const percentUsed = (hoursUsed / retainerHours) * 100;

      const clientAlerts = alertedThresholds.get(client.id) || new Set();

      // Check 100% threshold first (higher priority)
      if (percentUsed >= 100 && !clientAlerts.has('100')) {
        await notifyRetainerAlert(
          client.id,
          client.name,
          hoursUsed,
          retainerHours,
          pmUserIds
        );
        alertsSent++;
      }
      // Check 80% threshold
      else if (percentUsed >= 80 && percentUsed < 100 && !clientAlerts.has('80')) {
        await notifyRetainerAlert(
          client.id,
          client.name,
          hoursUsed,
          retainerHours,
          pmUserIds
        );
        alertsSent++;
      }
    }

    return NextResponse.json({
      success: true,
      clientsChecked: clientsWithRetainers.length,
      alertsSent,
    });
  } catch (error) {
    console.error('Error in retainer-alerts cron:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
