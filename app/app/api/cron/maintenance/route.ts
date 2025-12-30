import { NextRequest, NextResponse } from 'next/server';
import { generateAllDueMaintenance } from '@/lib/services/maintenance-generator';

/**
 * Cron endpoint for generating maintenance tasks
 *
 * This endpoint should be called daily by an external cron service
 * (e.g., Vercel Cron, GitHub Actions, or system cron).
 *
 * Security: Requires CRON_SECRET header to match environment variable.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret');

    if (!cronSecret) {
      console.error('CRON_SECRET environment variable not set');
      return NextResponse.json(
        { error: 'Cron not configured' },
        { status: 500 }
      );
    }

    if (providedSecret !== cronSecret) {
      console.warn('Invalid cron secret provided');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Starting maintenance task generation...');
    const startTime = Date.now();

    const summary = await generateAllDueMaintenance();

    const duration = Date.now() - startTime;
    console.log(
      `Maintenance generation complete: ${summary.totalSitesProcessed} sites, ` +
      `${summary.totalTasksCreated} tasks created, ${summary.totalTasksAbandoned} abandoned ` +
      `(${duration}ms)`
    );

    if (summary.errors.length > 0) {
      console.warn('Errors during generation:', summary.errors);
    }

    return NextResponse.json({
      success: true,
      summary: {
        sitesProcessed: summary.totalSitesProcessed,
        tasksCreated: summary.totalTasksCreated,
        tasksAbandoned: summary.totalTasksAbandoned,
        errors: summary.errors.length,
      },
      duration: `${duration}ms`,
    });
  } catch (error) {
    console.error('Maintenance generation failed:', error);
    return NextResponse.json(
      { error: 'Generation failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}

// Also support GET for testing (still requires secret)
export async function GET(request: NextRequest) {
  return POST(request);
}
