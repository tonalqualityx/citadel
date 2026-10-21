import { describe, it, expect } from 'vitest';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { onClientMessage, onStaffReply, waitKey, type ThreadTask } from '../waits';

type Row = Record<string, any>;

/** In-memory stand-in for the Prisma wait calls the thread effects make. */
function fakeDb(seed: Row[] = []) {
  const waits: Row[] = seed.map((w, i) => ({ id: w.id ?? `w${i + 1}`, state: 'waiting', owner_contact_id: null, due_at: new Date('2026-10-22T20:00:00Z'), ...w }));
  const events: Row[] = [];
  const match = (w: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(w[k]);
      return w[k] === v;
    });
  const db = {
    wait: {
      findMany: async ({ where }: { where: Row }) => waits.filter((w) => match(w, where)),
      findUnique: async ({ where }: { where: { idempotency_key: string } }) => waits.find((w) => w.idempotency_key === where.idempotency_key) ?? null,
      create: async ({ data }: { data: Row }) => {
        const w = { id: `w${waits.length + 1}`, state: 'waiting', ...data };
        waits.push(w);
        return w;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(waits.find((x) => x.id === where.id)!, data),
    },
    waitEvent: { create: async ({ data }: { data: Row }) => (events.push(data), data) },
  };
  return { db: db as unknown as Parameters<typeof onClientMessage>[0], waits, events };
}

const NOW = new Date('2026-10-21T15:00:00Z');
const task = (over: Partial<ThreadTask> = {}): ThreadTask => ({
  id: 't1',
  client_title: 'Site change: Update the hours',
  assignee_id: BAST_USER_ID,
  client_id: 'cl1',
  project_id: null,
  charter_id: null,
  site_id: 's1',
  requested_by_contact_id: 'c1',
  ...over,
});

describe('onClientMessage (spec 3.5)', () => {
  it('flags a still-waiting staff clock needs_human and opens nothing new', async () => {
    const { db, waits } = fakeDb([{ task_id: 't1', template_key: 'portal.first_response' }]);
    const r = await onClientMessage(db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(r).toMatchObject({ flagged: 1, opened: null });
    expect(waits[0].state).toBe('needs_human');
    expect(waits).toHaveLength(1);
  });

  it('with no staff wait open, opens portal.client_reply keyed on the comment, owned by the assignee when a person', async () => {
    const { db, waits } = fakeDb();
    const r = await onClientMessage(db, task({ assignee_id: 'maint-1' }), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(r.opened).toBeTruthy();
    expect(waits[0]).toMatchObject({
      template_key: 'portal.client_reply',
      owner_user_id: 'maint-1',
      blocks_client: true,
      idempotency_key: waitKey('client_reply', 't1', 'm1'),
    });
  });

  it('Bast as assignee leaves the owner to the liaison role', async () => {
    const { db, waits } = fakeDb();
    await onClientMessage(db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(waits[0].owner_user_id).toBeNull();
    expect(waits[0].action_payload.owner_role).toBe('liaison');
  });

  it("stops this contact's waits and the awaiting-client clock as client_replied", async () => {
    const { db, waits } = fakeDb([
      { task_id: 't1', template_key: 'portal.awaiting_client', owner_contact_id: 'c1' },
      { task_id: 't1', template_key: 'onboarding.missing_items', owner_contact_id: 'c1' },
      { task_id: 't1', template_key: 'portal.awaiting_client', owner_contact_id: 'someone-else' },
    ]);
    const r = await onClientMessage(db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(r.stopped).toBe(3);
    expect(waits.slice(0, 3).every((w) => w.state === 'done' && w.resolution === 'client_replied')).toBe(true);
    // Nothing staff-owned was open, so the reply clock opens.
    expect(r.opened).toBeTruthy();
  });

  it("leaves another contact's non-question waits alone", async () => {
    const { db, waits } = fakeDb([{ task_id: 't1', template_key: 'onboarding.missing_items', owner_contact_id: 'other' }]);
    const r = await onClientMessage(db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(r.stopped).toBe(0);
    expect(waits[0].state).toBe('waiting');
  });

  it('does not touch waits on other tasks', async () => {
    const { db, waits } = fakeDb([{ task_id: 'other', template_key: 'portal.first_response' }]);
    await onClientMessage(db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(waits[0].state).toBe('waiting');
  });

  it('a Mike gate (build.gate_mike) counts as a staff wait: flagged, and no extra reply clock', async () => {
    const { db, waits } = fakeDb([{ task_id: 't1', template_key: 'build.gate_mike' }]);
    const r = await onClientMessage(db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(waits[0].state).toBe('needs_human');
    expect(r.opened).toBeNull();
  });

  it('is idempotent per comment and writes a WaitEvent for every change', async () => {
    const f = fakeDb();
    await onClientMessage(f.db, task(), { contact_ids: ['c1'], comment_id: 'm1' }, NOW);
    expect(f.events.length).toBe(1);
    // The reply clock is now a staff wait: a second message flags it rather than opening another.
    await onClientMessage(f.db, task(), { contact_ids: ['c1'], comment_id: 'm2' }, NOW);
    expect(f.waits).toHaveLength(1);
    expect(f.waits[0].state).toBe('needs_human');
    expect(f.events.length).toBe(2);
  });
});

describe('onStaffReply', () => {
  it('resolves the reply and first-response clocks as answered', async () => {
    const { db, waits } = fakeDb([
      { task_id: 't1', template_key: 'portal.first_response' },
      { task_id: 't1', template_key: 'portal.client_reply' },
      { task_id: 't1', template_key: 'portal.emergency' },
    ]);
    const r = await onStaffReply(db, task(), { id: 'c9', client_question: false }, NOW);
    expect(r.resolved).toBe(2);
    expect(waits[0]).toMatchObject({ state: 'done', resolution: 'answered' });
    expect(waits[1]).toMatchObject({ state: 'done', resolution: 'answered' });
    expect(waits[2].state).toBe('waiting');
    expect(r.awaiting).toBeNull();
  });

  it('a question opens portal.awaiting_client owned by the requester, five business days', async () => {
    const { db, waits } = fakeDb();
    const r = await onStaffReply(db, task(), { id: 'c9', client_question: true }, NOW);
    expect(r.awaiting).toBeTruthy();
    expect(waits[0]).toMatchObject({
      template_key: 'portal.awaiting_client',
      owner_contact_id: 'c1',
      blocks_client: false,
      terminal_action: 'task',
      duration_value: 5,
      duration_unit: 'business_days',
      idempotency_key: waitKey('awaiting_client', 't1', 'c9'),
    });
    expect(waits[0].title).toBe('Client has not answered Site change: Update the hours; follow up by email or call');
  });

  it('a second question while one is open does not stack a second clock', async () => {
    const { db, waits } = fakeDb();
    await onStaffReply(db, task(), { id: 'c9', client_question: true }, NOW);
    const again = await onStaffReply(db, task(), { id: 'c10', client_question: true }, NOW);
    expect(again.awaiting).toBeNull();
    expect(waits).toHaveLength(1);
  });
});
