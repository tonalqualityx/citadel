import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { prismaAwayLookups } from '@/lib/waits/away';
import { runSweep, type WaitRow } from '@/lib/waits/sweeper';
import { sendSlackNotification } from '@/lib/services/slack-notifications';
import { calendarDaysSince } from '@/lib/waits/business-days';
import { PRICE_REVIEW_SEND } from '@/lib/config/feature-flags';
import { makeApplyProceed } from '@/lib/price-review/apply';
import { openPriceReviews, type OpenReport } from '@/lib/price-review/open';
import { makePriceReviewSendHandler } from '@/lib/price-review/send';

/**
 * Switches the sweeper may read in phase 1. There is no Switch table yet (phase 2), so the
 * machine-side lane names the switches that are ON in WAIT_SWITCHES_ON (comma separated).
 * Empty means everything is off, which holds every send. Phase 1 opens no sender anyway.
 */
function switchIsOn(key: string): Promise<boolean> {
  // PRICE_REVIEW_SEND is a feature flag read at call time (default OFF), not a list entry.
  if (key === 'PRICE_REVIEW_SEND') return Promise.resolve(PRICE_REVIEW_SEND());
  const on = (process.env.WAIT_SWITCHES_ON ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return Promise.resolve(on.includes(key));
}

/** WAIT_SLACK_NAG: the one Slack DM to Mike, three business days late. On unless set to "off". */
const slackNagOn = () => (process.env.WAIT_SLACK_NAG ?? 'on').toLowerCase() !== 'off';

async function notifyMike(w: WaitRow, owner: { user_id: string }): Promise<boolean> {
  const days = w.client_waiting_since ? calendarDaysSince(w.client_waiting_since, new Date()) : null;
  // Slack only, straight to the Slack sender: no in-app notice and no email (the dispatcher
  // would queue both). True only when Slack accepted it, so a failure retries the next
  // business day instead of passing for sent.
  return sendSlackNotification({
    userId: owner.user_id,
    type: 'system_alert',
    title: `A client is blocked on you: ${w.title}`.slice(0, 250),
    message: `${w.title}${days != null ? ` The client has waited ${days} days.` : ''} It is three business days past its date.`,
    entityType: 'wait',
    entityId: w.id,
    priority: 'high',
  }).catch(() => false);
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
    // Open the price review waits that are now inside their 14 day window, so this pass can fire
    // them. A failure here never stops the sweep. On a dry run nothing is written.
    let price_review: OpenReport | { error: string };
    try {
      price_review = await openPriceReviews(prisma, { dryRun });
    } catch (e) {
      price_review = { error: e instanceof Error ? e.message : String(e) };
    }
    const report = await runSweep(
      {
        store: prismaSweepStore(prisma),
        owner: prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]),
        switchIsOn,
        // Lazy: queries nothing, and the sweeper reads it only while OOO_STANDINS is on.
        away: prismaAwayLookups(prisma as unknown as Parameters<typeof prismaAwayLookups>[0]),
        notifyMike: slackNagOn() ? notifyMike : undefined,
        applyProceed: makeApplyProceed(prisma),
        sendHandlers: { 'charter.price_review': makePriceReviewSendHandler(prisma, { switchIsOn }) },
      },
      { dryRun }
    );
    return NextResponse.json({ ...report, price_review });
  } catch (error) {
    return handleApiError(error);
  }
}
