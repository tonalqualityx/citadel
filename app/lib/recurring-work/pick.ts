/**
 * Keep, Cut and Make weekly on a Recurring work row. A pick is recorded on the row; Cut and Make weekly also file ONE
 * worker card for Bast. A pick never changes the schedule: the update data holds only the four pick fields.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { logCreate } from '@/lib/services/activity';

export const RECURRING_WORK_PROJECT_ID = 'e8d34a71-f372-4b56-b73e-6b7f9dbc023b';
export const RECURRING_PICKS = ['keep', 'cut', 'weekly'] as const;
export type RecurringPickValue = (typeof RECURRING_PICKS)[number];

const TITLE_LIMIT = 500;
const TAB_LINK = 'https://citadel.becomeindelible.com/initiatives?tab=recurring-work';
const CLOSED = ['done', 'abandoned'];

export interface PickTask {
  id: string;
  title: string;
  status: string;
}

export interface PickResult {
  filed: boolean;
  already_open: boolean;
  task: PickTask | null;
}

type Tx = Prisma.TransactionClient;

const noDashes = (s: string) => s.replace(/[–—]/g, '-');

function paragraph(text: string) {
  return { id: crypto.randomUUID(), type: 'paragraph', content: text ? [{ type: 'text', text, styles: {} }] : [], children: [] };
}

type PickRow = {
  title: string | null;
  sop?: { title: string } | null;
  kind: string;
  job_key: string | null;
  schedule_text: string | null;
  cadence: string | null;
  cron_expr: string | null;
  group_label: string | null;
  owner?: { name: string } | null;
};

export function pickCardTitle(pick: 'cut' | 'weekly', jobTitle: string): string {
  const t = pick === 'cut' ? `Recurring work: cut "${jobTitle}"` : `Recurring work: make "${jobTitle}" weekly`;
  return noDashes(t).slice(0, TITLE_LIMIT);
}

export function pickCardDescription(pick: 'cut' | 'weekly', row: PickRow, jobTitle: string, byName: string, at: Date): string {
  const schedule = row.schedule_text || row.cadence || row.cron_expr || 'none';
  const what = pick === 'cut' ? 'Cut' : 'Make weekly';
  const todo =
    pick === 'cut'
      ? 'Stop this job: remove its schedule (the crontab line and its job watch entry for a machine job, or set the recurring row inactive for a Citadel job), save the machine repo, then the next hourly sync marks the row inactive.'
      : 'Change this job to run once a week: edit its schedule (the crontab line for a machine job, or the cadence for a Citadel job), save the machine repo, and confirm the next sync shows the weekly schedule.';
  const lines = [
    `Picked: ${what}, by ${byName} on ${at.toISOString().slice(0, 10)}.`,
    `Job: ${jobTitle}`,
    `Kind: ${row.kind}`,
    `job_key: ${row.job_key ?? 'none'}`,
    `Schedule: ${schedule}`,
    `Group: ${row.group_label ?? 'none'}`,
    `Owner: ${row.owner?.name ?? 'none'}`,
    '',
    todo,
    '',
    `Recurring work tab: ${TAB_LINK}`,
    'Finalized by: nothing; done is done.',
  ].map(noDashes);
  return JSON.stringify(lines.map(paragraph));
}

const rowInclude = { sop: { select: { title: true } }, owner: { select: { name: true } } } as const;

async function openCard(db: Pick<Tx, 'task'>, taskId: string | null | undefined): Promise<PickTask | null> {
  if (!taskId) return null;
  const t = await db.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, status: true, is_deleted: true } });
  if (!t || t.is_deleted || CLOSED.includes(t.status)) return null;
  return { id: t.id, title: t.title, status: t.status };
}

const openResult = (task: PickTask): PickResult => ({ filed: false, already_open: true, task });

export async function applyRecurringPick(input: { id: string; pick: RecurringPickValue; userId: string }): Promise<PickResult> {
  const { id, pick, userId } = input;
  const row = await prisma.recurringWork.findUnique({ where: { id }, include: rowInclude });
  if (!row) throw new ApiError('Recurring work not found', 404);

  const now = new Date();
  // The update data holds only the four pick fields, never a schedule or run field.
  const pickFields = { mike_pick: pick, mike_pick_at: now, mike_pick_by_id: userId };

  // Keep always records the pick and never files a card; an open card stays linked on the row.
  if (pick === 'keep') {
    await prisma.recurringWork.update({ where: { id }, data: pickFields });
    return { filed: false, already_open: false, task: null };
  }

  const open = await openCard(prisma, row.pick_task_id);
  if (open) return openResult(open);

  const jobTitle = row.title ?? row.sop?.title ?? 'Untitled';
  try {
    const task = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.recurringWork.findUnique({ where: { id }, select: { pick_task_id: true } });
        const again = await openCard(tx, fresh?.pick_task_id);
        if (again) return { kind: 'open', task: again } as const;
        const [project, user] = await Promise.all([
          tx.project.findUnique({ where: { id: RECURRING_WORK_PROJECT_ID }, select: { id: true } }),
          tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
        ]);
        const energy = 2;
        const created = await tx.task.create({
          data: {
            title: pickCardTitle(pick, jobTitle),
            description: pickCardDescription(pick, row, jobTitle, user?.name ?? 'Mike', now),
            status: 'not_started',
            priority: 3,
            assignee_id: BAST_USER_ID,
            created_by_id: userId,
            project_id: project ? project.id : null,
            is_billable: false,
            tags: row.kind === 'machine_job' ? ['recurring-pick', 'repo:bast-machine'] : ['recurring-pick'],
            energy_estimate: energy,
            mystery_factor: 'none',
            estimated_minutes: calculateEstimatedMinutes(energy, 'none'),
          },
          select: { id: true, title: true, status: true },
        });
        await tx.recurringWork.update({ where: { id }, data: { ...pickFields, pick_task_id: created.id } });
        return { kind: 'created', task: created } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (task.kind === 'open') return openResult(task.task);
    await logCreate(userId, 'task', task.task.id, task.task.title);
    return { filed: true, already_open: false, task: { id: task.task.id, title: task.task.title, status: task.task.status } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      const fresh = await prisma.recurringWork.findUnique({ where: { id }, select: { pick_task_id: true } });
      const again = await openCard(prisma, fresh?.pick_task_id);
      if (again) return openResult(again);
    }
    throw e;
  }
}
