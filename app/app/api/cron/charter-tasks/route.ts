import { NextRequest, NextResponse } from 'next/server';
import { generateAllDueCharterTasks } from '@/lib/services/charter-generator';

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

    console.log('Starting charter task generation...');
    const startTime = Date.now();

    const summary = await generateAllDueCharterTasks();

    const duration = Date.now() - startTime;
    console.log(
      `Charter generation complete: ${summary.totalChartersProcessed} charters, ` +
      `${summary.totalTasksCreated} tasks created, ${summary.totalTasksAbandoned} abandoned ` +
      `(${duration}ms)`
    );

    if (summary.errors.length > 0) {
      console.warn('Errors during generation:', summary.errors);
    }

    return NextResponse.json({
      success: true,
      summary: {
        chartersProcessed: summary.totalChartersProcessed,
        tasksCreated: summary.totalTasksCreated,
        tasksAbandoned: summary.totalTasksAbandoned,
        errors: summary.errors.length,
      },
      duration: `${duration}ms`,
    });
  } catch (error) {
    console.error('Charter task generation failed:', error);
    return NextResponse.json(
      { error: 'Generation failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
