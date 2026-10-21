import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { runSweep, type WaitRow } from '@/lib/waits/sweeper';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { calendarDaysSince } from '@/lib/waits/business-days';

/**
 * Switches the sweeper may read in phase 1. There is no Switch table yet (phase 2), so the
 * machine-side lane names the switches that are ON in WAIT_SWITCHES_ON (comma separated).
 * Empty means everything is off, which holds every send. Phase 1 opens no sender anyway.
 */
function switchIsOn(key: string): Promise<boolean> {
  const on = (process.env.WAIT_SWITCHES_ON ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return Promise.resolve(on.includes(key));
}

/** WAIT_SLACK_NAG: the one Slack DM to Mike, three business days late. On unless set to "off". */
const slackNagOn = () => (process.env.WAIT_SLACK_NAG ?? 'on').toLowerCase() !== 'off';

async function notifyMike(w: WaitRow, owner: { user_id: string }): Promise<boolean> {
  const days = w.client_waiting_since ? calendarDaysSince(w.client_waiting_since, new Date()) : null;
  const result = await dispatchNotification({
    userId: owner.user_id,
    type: 'system_alert',
    title: `A client is blocked on you: ${w.title}`.slice(0, 250),
    message: `${w.title}${days != null ? ` The client has waited ${days} days.` : ''} It is three business days past its date.`,
    entityType: 'wait',
    entityId: w.id,
    priority: 'high',
  });
  // Count it sent only when Slack accepted it. An in-app row alone does not tell Mike, so
  // the ladder tries again on the next pass.
  return result.slack.sent === true;
}

/**
 * POST /api/waits/sweep: one pass of the wait sweeper. Admin or PM session, or an API key
 * (Bearer) belonging to one, called every 15 minutes by ~/.local/bin/citadel-wait-sweep.sh. `?dry_run=1`
 * reports what would happen and writes nothing. It sends no mail: a send only stamps fired_at
 * for the machine-side outbox, and no template that sends is open in phase 1.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    // pm or admin, like the other sweeps (tasks/unblock-sweep): the machine-side API key may belong to either.
    requireRole(auth, ['pm', 'admin']);
    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    const report = await runSweep(
      {
        store: prismaSweepStore(prisma),
        owner: prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]),
        switchIsOn,
        notifyMike: slackNagOn() ? notifyMike : undefined,
      },
      { dryRun }
    );
    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error);
  }
}
