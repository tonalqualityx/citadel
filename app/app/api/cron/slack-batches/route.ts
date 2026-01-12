import { NextRequest, NextResponse } from 'next/server';
import { processSlackNotificationBatches } from '@/lib/services/slack-notifications';
import { prisma } from '@/lib/db/prisma';

/**
 * POST /api/cron/slack-batches
 *
 * Processes pending Slack notification batches and sends combined messages.
 * Should be called frequently (every 1-2 minutes) by a cron job.
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
    console.log('Processing Slack notification batches...');

    // Process ready batches
    const processed = await processSlackNotificationBatches();

    // Clean up old processed entries (older than 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cleaned = await prisma.slackNotificationBatch.deleteMany({
      where: {
        processed: true,
        processed_at: {
          lt: sevenDaysAgo,
        },
      },
    });

    if (cleaned.count > 0) {
      console.log(`Cleaned up ${cleaned.count} old Slack batch entries`);
    }

    return NextResponse.json({
      success: true,
      processed,
      cleanedUp: cleaned.count,
    });
  } catch (error) {
    console.error('Error in slack-batches cron:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
