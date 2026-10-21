import { describe, it, expect } from 'vitest';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { onRequestFiled, onTaskProgress, waitKey, type FiledTask } from '../waits';

interface Row {
  id?: string;
  state?: string;
  idempotency_key?: string;
  task_id?: string;
  template_key?: string;
  due_at: Date;
  action_payload: { owner_role: string };
  [key: string]: unknown;
}

/** A tiny in-memory stand-in for the Prisma calls prismaSweepStore makes on waits and events. */
function fakeDb() {
  const waits: Row[] = [];
  const events: Array<Record<string, unknown>> = [];
  const db = {
    wait: {
      findUnique: async ({ where }: { where: { idempotency_key: string } }) =>
        waits.find((w) => w.idempotency_key === where.idempotency_key) ?? null,
      create: async ({ data }: { data: Omit<Row, 'id'> }) => {
        const w = { id: `w${waits.length + 1}`, state: 'waiting', resolution: null, ...data } as unknown as Row;
        waits.push(w);
        return w;
      },
      findMany: async ({ where }: { where: { task_id: string; template_key: string; state: { in: string[] } } }) =>
        waits.filter((w) => w.task_id === where.task_id && w.template_key === where.template_key && where.state.in.includes(w.state as string)),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const w = waits.find((x) => x.id === where.id)!;
        Object.assign(w, data);
        return w;
      },
    },
    waitEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };
  return { db: db as unknown as Parameters<typeof onRequestFiled>[0], waits, events };
}

const NOW = new Date('2026-10-21T15:00:00Z'); // Wednesday
const task = (over: Partial<FiledTask> = {}): FiledTask => ({
  id: 't1',
  client_title: 'Site change: Update the hours',
  assignee_id: BAST_USER_ID,
  client_id: 'cl1',
  project_id: null,
  charter_id: null,
  site_id: 's1',
  ...over,
});

describe('onRequestFiled', () => {
  it('in scope: opens portal.first_response on the bast role, blocking the client, due in one business day', async () => {
    const { db, waits, events } = fakeDb();
    await onRequestFiled(db, task(), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({
      template_key: 'portal.first_response',
      task_id: 't1',
      client_id: 'cl1',
      site_id: 's1',
      owner_user_id: null,
      blocks_client: true,
      idempotency_key: waitKey('first_response', 't1', 'i1'),
      terminal_action: 'escalate',
    });
    expect(waits[0].action_payload.owner_role).toBe('bast');
    expect(waits[0].title).toBe('Answer the client request Site change: Update the hours');
    expect(waits[0].due_at.getTime()).toBeGreaterThan(NOW.getTime());
    expect(events.map((e) => e.kind)).toEqual(['created']);
  });

  it('a person assignee owns the first-response clock by name', async () => {
    const { db, waits } = fakeDb();
    await onRequestFiled(db, task({ assignee_id: 'maint-1' }), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    expect(waits[0].owner_user_id).toBe('maint-1');
  });

  it('a marketing question for Mike opens first_response on Mike', async () => {
    const { db, waits } = fakeDb();
    await onRequestFiled(db, task({ assignee_id: MIKE_USER_ID }), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    expect(waits[0]).toMatchObject({ template_key: 'portal.first_response', owner_user_id: MIKE_USER_ID });
  });

  it('a quote opens build.gate_mike with the scope title and no first_response', async () => {
    const { db, waits } = fakeDb();
    await onRequestFiled(db, task(), { intake_id: 'i1', quote: true, emergency: false }, NOW);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ template_key: 'build.gate_mike', blocks_client: true });
    expect(waits[0].title).toBe('Rule on scope and send a quote: Site change: Update the hours');
  });

  it('an emergency opens a two-hour portal.emergency on Mike and nothing else', async () => {
    const { db, waits } = fakeDb();
    await onRequestFiled(db, task(), { intake_id: 'i1', quote: false, emergency: true }, NOW);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({
      template_key: 'portal.emergency',
      owner_user_id: MIKE_USER_ID,
      duration_value: 2,
      duration_unit: 'hours',
      blocks_client: true,
    });
    expect(waits[0].due_at.getTime() - NOW.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it('is idempotent: a repeat with the same intake opens nothing new and writes no second event', async () => {
    const { db, waits, events } = fakeDb();
    const a = await onRequestFiled(db, task(), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    const b = await onRequestFiled(db, task(), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    expect(waits).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(a[0].created).toBe(true);
    expect(b[0].created).toBe(false);
  });

  it('carries the project and charter links', async () => {
    const { db, waits } = fakeDb();
    await onRequestFiled(db, task({ project_id: 'p1', charter_id: 'ch1' }), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    expect(waits[0]).toMatchObject({ project_id: 'p1', charter_id: 'ch1' });
  });
});

describe('onTaskProgress', () => {
  async function withFirstResponse() {
    const f = fakeDb();
    await onRequestFiled(f.db, task(), { intake_id: 'i1', quote: false, emergency: false }, NOW);
    return f;
  }

  it('does nothing while the task is still not started and unstaged', async () => {
    const { db, waits } = await withFirstResponse();
    expect(await onTaskProgress(db, { id: 't1', status: 'not_started', staging_preview_url: null }, NOW)).toBe(0);
    expect(waits[0].state).toBe('waiting');
  });

  it('resolves the first-response clock as answered when the task leaves not_started, and logs the event', async () => {
    const { db, waits, events } = await withFirstResponse();
    expect(await onTaskProgress(db, { id: 't1', status: 'in_progress' }, NOW)).toBe(1);
    expect(waits[0]).toMatchObject({ state: 'done', resolution: 'answered' });
    expect(events.at(-1)).toMatchObject({ kind: 'state_changed', to_state: 'done', source: 'api' });
  });

  it('resolves it when the task is staged even if still not_started', async () => {
    const { db, waits } = await withFirstResponse();
    await onTaskProgress(db, { id: 't1', status: 'not_started', staging_preview_url: 'https://staging.example.com' }, NOW);
    expect(waits[0].state).toBe('done');
  });

  it('is safe to call again: nothing left to resolve', async () => {
    const { db } = await withFirstResponse();
    await onTaskProgress(db, { id: 't1', status: 'in_progress' }, NOW);
    expect(await onTaskProgress(db, { id: 't1', status: 'in_progress' }, NOW)).toBe(0);
  });

  it('leaves other templates alone (a quote gate is Mike\'s to rule on)', async () => {
    const f = fakeDb();
    await onRequestFiled(f.db, task(), { intake_id: 'i1', quote: true, emergency: false }, NOW);
    expect(await onTaskProgress(f.db, { id: 't1', status: 'in_progress' }, NOW)).toBe(0);
    expect(f.waits[0].state).toBe('waiting');
  });
});
