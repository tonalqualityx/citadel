import { NextRequest, NextResponse } from 'next/server';
import { processDigestQueue, cleanupDigestQueue } from '@/lib/services/email-notifications';

/**
 * POST /api/cron/email-digest
 *
 * Processes the email digest queue and sends daily digest emails.
 * Should be called daily at 8 AM by a cron job.
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
    console.log('Starting email digest processing...');

    // Process the digest queue
    const stats = await processDigestQueue();

    // Clean up old processed items
    const cleaned = await cleanupDigestQueue();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} old digest entries`);
    }

    return NextResponse.json({
      success: true,
      ...stats,
      cleanedUp: cleaned,
    });
  } catch (error) {
    console.error('Error in email-digest cron:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
