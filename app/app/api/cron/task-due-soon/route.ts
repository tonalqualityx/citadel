import { NextRequest, NextResponse } from 'next/server';
import { runTaskDueNotices } from '@/lib/services/task-due-notice';

/**
 * POST /api/cron/task-due-soon
 *
 * The day-before notice: for each open task assigned to a staff person (never a bot, never the owner, never a Triage task, never a task on a project
 * that is not live), one notification through createNotification when the task's due date is tomorrow in the assignee's time zone. Once per task and
 * due date: the announced due date is stored on the task (due_notice_for), so running this every hour, or twice at once, tells nobody twice. A due date
 * that moves is announced again for the new date. Rules and code: lib/services/task-due-notice.ts.
 *
 * Triggered by an external scheduler, like the other /api/cron routes (nothing in this repo schedules them). The script app/scripts/cron/task-due-soon.sh
 * is the one line to run from system cron, hourly during the working day:
 *   0 8-17 * * *  CITADEL_URL=https://<citadel host> CRON_SECRET=<the app's CRON_SECRET> /path/to/app/scripts/cron/task-due-soon.sh
 *
 * Requires the x-cron-secret header to match the CRON_SECRET environment variable.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!cronSecret || !provided || provided !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const out = await runTaskDueNotices();
    return NextResponse.json({ success: true, ...out });
  } catch (error) {
    console.error('Error in task-due-soon cron:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
