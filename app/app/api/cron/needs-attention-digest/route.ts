import { NextRequest, NextResponse } from 'next/server';
import { sendNeedsAttentionDigest } from '@/lib/services/needs-attention-digest';

/**
 * Cron endpoint: email Mike the "needs your attention" digest.
 *
 * Called on a schedule by an external cron (system cron / Vercel Cron / GitHub Actions),
 * e.g. daily:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://citadel.becomeindelible.com/api/cron/needs-attention-digest
 *
 * Always sends — even an empty "all clear" digest — so silence means the job didn't run.
 *
 * Security: requires the `x-cron-secret` header to match the CRON_SECRET env var.
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret');

    if (!cronSecret) {
      console.error('CRON_SECRET environment variable not set');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (providedSecret !== cronSecret) {
      console.warn('Invalid cron secret provided');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    const summary = await sendNeedsAttentionDigest();
    const duration = Date.now() - startTime;

    console.log(
      `Needs-attention digest sent to ${summary.recipient}: ${summary.total} item(s) ` +
        `(needs-mike ${summary.counts.needsMike}, awaiting ${summary.counts.awaitingClarification}, ` +
        `stuck ${summary.counts.stuck}, articles ${summary.counts.articlesAwaitingReview}) (${duration}ms)`
    );

    return NextResponse.json({ success: true, summary, duration: `${duration}ms` });
  } catch (error) {
    console.error('Needs-attention digest failed:', error);
    return NextResponse.json(
      { error: 'Digest failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}

// Also support GET for testing (still requires secret).
export async function GET(request: NextRequest) {
  return POST(request);
}
