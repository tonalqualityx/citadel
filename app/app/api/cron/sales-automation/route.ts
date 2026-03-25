import { NextRequest, NextResponse } from 'next/server';
import { evaluateTimeBasedRules } from '@/lib/services/sales-automation';

export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret');

    if (!cronSecret) {
      console.error('CRON_SECRET environment variable not set');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Starting sales automation evaluation...');
    const startTime = Date.now();

    const summary = await evaluateTimeBasedRules();

    const duration = Date.now() - startTime;
    console.log(
      `Sales automation complete: ${summary.rulesEvaluated} rules, ${summary.tasksFired} tasks fired (${duration}ms)`
    );

    if (summary.errors.length > 0) {
      console.warn('Errors during automation:', summary.errors);
    }

    return NextResponse.json({
      success: true,
      summary,
      duration: `${duration}ms`,
    });
  } catch (error) {
    console.error('Sales automation failed:', error);
    return NextResponse.json(
      { error: 'Automation failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
