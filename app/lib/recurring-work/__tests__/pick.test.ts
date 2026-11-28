import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/services/activity', () => ({ logCreate: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const db = {
    recurringWork: { findUnique: vi.fn(), update: vi.fn() },
    task: { findUnique: vi.fn(), create: vi.fn() },
    project: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: db };
});

import { prisma } from '@/lib/db/prisma';
import { logCreate } from '@/lib/services/activity';
import { applyRecurringPick, RECURRING_WORK_PROJECT_ID } from '../pick';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

const db = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const ROW = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';

const row = (o: Record<string, unknown> = {}) => ({
  id: ROW, title: 'Done notes — sweep', sop: null, kind: 'machine_job', job_key: 'done-notes', schedule_text: 'every 10 minutes',
  cadence: null, cron_expr: '*/10 * * * *', group_label: 'Client mail', owner: { name: 'Bast' }, pick_task_id: null, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.recurringWork.findUnique.mockResolvedValue(row());
  db.recurringWork.update.mockResolvedValue({});
  db.task.findUnique.mockResolvedValue(null);
  db.task.create.mockImplementation(async ({ data }: { data: { title: string } }) => ({ id: TASK, title: data.title, status: 'not_started' }));
  db.project.findUnique.mockResolvedValue({ id: RECURRING_WORK_PROJECT_ID });
  db.user.findUnique.mockResolvedValue({ name: 'Mike' });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
});

const SCHEDULE_FIELDS = ['cron_expr', 'cadence', 'schedule_text', 'is_active', 'paused_on_purpose', 'next_run_at', 'last_run_at', 'last_run_ok', 'last_run_note'];

describe('applyRecurringPick', () => {
  it('404 when the row is missing', async () => {
    db.recurringWork.findUnique.mockResolvedValue(null);
    await expect(applyRecurringPick({ id: ROW, pick: 'keep', userId: USER })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keep records only the pick fields and files no card', async () => {
    const r = await applyRecurringPick({ id: ROW, pick: 'keep', userId: USER });
    expect(r).toEqual({ filed: false, already_open: false, task: null });
    expect(db.task.create).not.toHaveBeenCalled();
    const { data } = db.recurringWork.update.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['mike_pick', 'mike_pick_at', 'mike_pick_by_id']);
    expect(data.mike_pick).toBe('keep');
    expect(data.mike_pick_by_id).toBe(USER);
  });

  it.each([['cut', 'Recurring work: cut "Done notes - sweep"'], ['weekly', 'Recurring work: make "Done notes - sweep" weekly']] as const)(
    '%s files one card for Bast and records it on the row',
    async (pick, title) => {
      const r = await applyRecurringPick({ id: ROW, pick, userId: USER });
      expect(r).toEqual({ filed: true, already_open: false, task: { id: TASK, title, status: 'not_started' } });
      expect(db.task.create).toHaveBeenCalledTimes(1);
      const { data } = db.task.create.mock.calls[0][0];
      expect(data).toMatchObject({
        title, status: 'not_started', assignee_id: BAST_USER_ID, created_by_id: USER, project_id: RECURRING_WORK_PROJECT_ID,
        is_billable: false, priority: 3, tags: ['recurring-pick', 'repo:bast-machine'],
      });
      expect(data).not.toHaveProperty('recurring_work_id');
      const text = JSON.parse(data.description).map((b: { content: { text: string }[] }) => b.content[0]?.text ?? '').join('\n');
      expect(text).toContain('job_key: done-notes');
      expect(text).toContain(pick === 'cut' ? 'Picked: Cut, by Mike' : 'Picked: Make weekly, by Mike');
      expect(text).toContain('Recurring work tab: https://citadel.becomeindelible.com/initiatives?tab=recurring-work');
      expect(text).toContain('Finalized by: nothing; done is done.');
      expect(text).not.toMatch(/[–—]/);
      expect(data.title).not.toMatch(/[–—]/);
      const upd = db.recurringWork.update.mock.calls[0][0];
      expect(Object.keys(upd.data).sort()).toEqual(['mike_pick', 'mike_pick_at', 'mike_pick_by_id', 'pick_task_id']);
      expect(upd.data).toMatchObject({ mike_pick: pick, pick_task_id: TASK });
      expect(logCreate).toHaveBeenCalledWith(USER, 'task', TASK, title);
      expect(db.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' });
    },
  );

  it('a Citadel job gets no machine repo tag', async () => {
    db.recurringWork.findUnique.mockResolvedValue(row({ kind: 'citadel_task', job_key: null }));
    await applyRecurringPick({ id: ROW, pick: 'cut', userId: USER });
    const { data } = db.task.create.mock.calls[0][0];
    expect(data.tags).toEqual(['recurring-pick']);
    expect(JSON.parse(data.description).map((b: { content: { text: string }[] }) => b.content[0]?.text ?? '').join('\n')).toContain('job_key: none');
  });

  it('a keep tap while the row card is open records keep, files nothing and keeps the card linked', async () => {
    db.recurringWork.findUnique.mockResolvedValue(row({ pick_task_id: TASK }));
    db.task.findUnique.mockResolvedValue({ id: TASK, title: 't', status: 'in_progress', is_deleted: false });
    const r = await applyRecurringPick({ id: ROW, pick: 'keep', userId: USER });
    expect(r).toEqual({ filed: false, already_open: false, task: null });
    expect(db.task.create).not.toHaveBeenCalled();
    expect(Object.keys(db.recurringWork.update.mock.calls[0][0].data).sort()).toEqual(['mike_pick', 'mike_pick_at', 'mike_pick_by_id']);
  });

  it.each(['cut', 'weekly'] as const)('a %s tap while the row card is open files and changes nothing', async (pick) => {
    db.recurringWork.findUnique.mockResolvedValue(row({ pick_task_id: TASK }));
    db.task.findUnique.mockResolvedValue({ id: TASK, title: 't', status: 'in_progress', is_deleted: false });
    const r = await applyRecurringPick({ id: ROW, pick, userId: USER });
    expect(r).toEqual({ filed: false, already_open: true, task: { id: TASK, title: 't', status: 'in_progress' } });
    expect(db.task.create).not.toHaveBeenCalled();
    expect(db.recurringWork.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('an open card found inside the transaction files nothing', async () => {
    db.recurringWork.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ pick_task_id: TASK });
    db.task.findUnique.mockResolvedValue({ id: TASK, title: 't', status: 'not_started', is_deleted: false });
    const r = await applyRecurringPick({ id: ROW, pick: 'cut', userId: USER });
    expect(r.already_open).toBe(true);
    expect(db.task.create).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it.each(['done', 'abandoned'])('a tap after the card is %s files a new card', async (status) => {
    db.recurringWork.findUnique.mockResolvedValue(row({ pick_task_id: TASK }));
    db.task.findUnique.mockResolvedValue({ id: TASK, title: 't', status, is_deleted: false });
    const r = await applyRecurringPick({ id: ROW, pick: 'cut', userId: USER });
    expect(r.filed).toBe(true);
    expect(db.task.create).toHaveBeenCalledTimes(1);
  });

  it('a deleted card does not count as open', async () => {
    db.recurringWork.findUnique.mockResolvedValue(row({ pick_task_id: TASK }));
    db.task.findUnique.mockResolvedValue({ id: TASK, title: 't', status: 'not_started', is_deleted: true });
    expect((await applyRecurringPick({ id: ROW, pick: 'weekly', userId: USER })).filed).toBe(true);
  });

  it('never writes a schedule or run field', async () => {
    await applyRecurringPick({ id: ROW, pick: 'keep', userId: USER });
    await applyRecurringPick({ id: ROW, pick: 'cut', userId: USER });
    for (const [arg] of db.recurringWork.update.mock.calls) {
      for (const f of SCHEDULE_FIELDS) expect(arg.data).not.toHaveProperty(f);
    }
  });

  it('falls back to no project when the project is missing', async () => {
    db.project.findUnique.mockResolvedValue(null);
    await applyRecurringPick({ id: ROW, pick: 'cut', userId: USER });
    expect(db.task.create.mock.calls[0][0].data.project_id).toBeNull();
  });

  it('truncates a long title to the column limit', async () => {
    db.recurringWork.findUnique.mockResolvedValue(row({ title: 'x'.repeat(900) }));
    await applyRecurringPick({ id: ROW, pick: 'cut', userId: USER });
    expect(db.task.create.mock.calls[0][0].data.title.length).toBe(500);
  });
});
