import { describe, it, expect } from 'vitest';
import { MemStore } from './testing-mem-store';
import { applyWaitEvent, eventSchema } from './events';
import { extendWait, pauseWait, resumeWait, dueAfterDate, reassignWait, standInWait, MAX_EXTENSIONS } from './actions';
import { runSweep } from './sweeper';
import { buildWaitData, getTemplate, type WaitInput } from './templates';
import { zonedParts, zonedTimeToUtc } from './business-days';

const et = (y: number, m: number, d: number, h = 12, mi = 0) => zonedTimeToUtc(y, m, d, h, mi);
const NOW = et(2026, 10, 21, 10);
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (d: Date) => d.toISOString();

function open(store: MemStore, input: WaitInput, extra = {}) {
  return store.add(buildWaitData(input, { allowDisabled: true }), extra);
}

describe('applyWaitEvent', () => {
  it('is idempotent on event_id', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 20, 9), project_id: UUID(1) });
    const ev = { event_id: 'e1', kind: 'stop', target: { wait_id: w.id.length === 36 ? w.id : UUID(9) }, payload: { reason: 'reply' } };
    // MemStore ids are w1..; the schema wants uuids, so use a selector instead.
    const sel = { event_id: 'e1', kind: 'stop', chain: { kind: 'project', id: UUID(1) }, payload: { reason: 'reply' } };
    void ev;
    const a = await applyWaitEvent(store, sel, NOW);
    expect(a.applied).toEqual([{ wait_id: w.id, action: 'stopped', detail: 'reply' }]);
    expect(store.get(w.id)).toMatchObject({ state: 'done', resolution: 'stopped_by_reply' });
    const b = await applyWaitEvent(store, sel, NOW);
    expect(b.duplicate).toBe(true);
    expect(b.applied).toEqual([]);
  });

  it('refuses a selector that selects nothing', async () => {
    const store = new MemStore();
    open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 20, 9) });
    const r = await applyWaitEvent(store, { event_id: 'e2', kind: 'stop', payload: { reason: 'reply' } }, NOW);
    expect(r.matched).toBe(0);
    expect(store.all()[0].state).toBe('waiting');
  });

  it('stop on a review reply makes it needs_human instead of closing', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.review_client', subject: 'the copy', started_at: et(2026, 10, 20, 9), project_id: UUID(2) });
    const r = await applyWaitEvent(
      store,
      { event_id: 'e3', kind: 'stop', chain: { kind: 'project', id: UUID(2) }, payload: { reason: 'reply', quote: 'Can we change the headline?' } },
      NOW
    );
    expect(r.applied[0].action).toBe('needs_human');
    expect(store.get(w.id).state).toBe('needs_human');
    expect(store.get(w.id).detail).toContain('Can we change the headline?');
  });

  it('approval and booking close and advance the chain', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'charter.price_review', subject: 'Herba', due_at: et(2026, 10, 25, 9), step: 2, charter_id: UUID(3) });
    const r = await applyWaitEvent(store, { event_id: 'e4', kind: 'stop', chain: { kind: 'charter', id: UUID(3) }, payload: { reason: 'approval' } }, NOW);
    expect(r.applied[0].action).toBe('stopped');
    expect(store.get(w.id).resolution).toBe('approved');
    expect(store.all().filter((x) => x.step === 3)).toHaveLength(1);
  });

  it('place attaches the thread and fills empty chain links only', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 20, 9), accord_id: UUID(4) });
    await applyWaitEvent(
      store,
      { event_id: 'e5', kind: 'place', chain: { kind: 'accord', id: UUID(4), client_id: UUID(5) }, payload: { thread_id: 'thr1', account: 'mike@becomeindelible.com' } },
      NOW
    );
    expect(store.get(w.id)).toMatchObject({ email_thread_id: 'thr1', email_account: 'mike@becomeindelible.com', client_id: UUID(5), accord_id: UUID(4) });
  });

  it('extends by business days, and by a named date plus one business day', async () => {
    const store = new MemStore();
    const a = open(store, { template_key: 'build.gate_mike', subject: 'a', started_at: et(2026, 10, 21, 9), project_id: UUID(6) });
    const due0 = a.due_at;
    await applyWaitEvent(store, { event_id: 'e6', kind: 'extend', chain: { kind: 'project', id: UUID(6) }, payload: { mode: 'days', business_days: 5, reason: 'need_more_time' } }, NOW);
    expect(store.get(a.id).due_at.getTime()).toBeGreaterThan(due0.getTime());
    expect(store.get(a.id)).toMatchObject({ extension_count: 1, extended_bd_total: 5 });

    const b = open(store, { template_key: 'build.gate_mike', subject: 'b', started_at: et(2026, 10, 21, 9), project_id: UUID(7) });
    // "back Friday 2026-10-23": due Monday 10-26 17:00
    await applyWaitEvent(
      store,
      { event_id: 'e7', kind: 'extend', chain: { kind: 'project', id: UUID(7) }, payload: { mode: 'until', until: et(2026, 10, 23, 9).toISOString(), reason: 'ooo' } },
      NOW
    );
    expect(iso(store.get(b.id).due_at)).toBe(iso(et(2026, 10, 26, 17)));
  });

  it('caps extensions: the third becomes needs_human', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'c', started_at: et(2026, 10, 21, 9), project_id: UUID(8) });
    for (let i = 0; i < MAX_EXTENSIONS; i++) {
      await applyWaitEvent(store, { event_id: `x${i}`, kind: 'extend', chain: { kind: 'project', id: UUID(8) }, payload: { mode: 'days', business_days: 2, reason: 'need_more_time' } }, NOW);
    }
    expect(store.get(w.id).extension_count).toBe(2);
    const r = await applyWaitEvent(store, { event_id: 'x9', kind: 'extend', chain: { kind: 'project', id: UUID(8) }, payload: { mode: 'days', business_days: 2, reason: 'need_more_time' } }, NOW);
    expect(r.applied[0].action).toBe('cap');
    expect(store.get(w.id).state).toBe('needs_human');
    expect(store.get(w.id).extension_count).toBe(2);
  });

  it('caps at 15 business days in total', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'd', started_at: et(2026, 10, 21, 9), project_id: UUID(10) });
    await applyWaitEvent(store, { event_id: 'y1', kind: 'extend', chain: { kind: 'project', id: UUID(10) }, payload: { mode: 'days', business_days: 10 } }, NOW);
    const r = await applyWaitEvent(store, { event_id: 'y2', kind: 'extend', chain: { kind: 'project', id: UUID(10) }, payload: { mode: 'days', business_days: 6 } }, NOW);
    expect(r.applied[0].action).toBe('cap');
    expect(store.get(w.id).extended_bd_total).toBe(10);
  });

  it('an auto-reply extends each wait once', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'e', started_at: et(2026, 10, 21, 9), project_id: UUID(11) });
    const ev = (id: string) => ({ event_id: id, kind: 'extend', chain: { kind: 'project', id: UUID(11) }, payload: { mode: 'days', business_days: 5, reason: 'ooo', auto_reply: true } });
    await applyWaitEvent(store, ev('z1'), NOW);
    const r = await applyWaitEvent(store, ev('z2'), NOW);
    expect(r.applied[0].action).toBe('auto_reply_used');
    expect(store.get(w.id).extension_count).toBe(1);
  });

  it('needs_human carries the question and suggestion', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 20, 9), accord_id: UUID(12) });
    await applyWaitEvent(
      store,
      { event_id: 'n1', kind: 'needs_human', chain: { kind: 'accord', id: UUID(12) }, payload: { question: 'Is this a decline?', suggestion: 'Mark lost' } },
      NOW
    );
    expect(store.get(w.id).state).toBe('needs_human');
    expect(store.get(w.id).detail).toContain('Is this a decline?');
    expect(store.get(w.id).detail).toContain('Suggestion: Mark lost');
  });

  it('rejects malformed events', () => {
    expect(() => eventSchema.parse({ event_id: '', kind: 'stop' })).toThrow();
    expect(() => eventSchema.parse({ event_id: 'a', kind: 'explode' })).toThrow();
  });
});

describe('pause, resume and the sweeper', () => {
  it('pauses with the time left and the sweeper resumes it', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'p', started_at: et(2026, 10, 21, 9) });
    const left = w.due_at.getTime() - NOW.getTime();
    await pauseWait(store, w, { now: NOW, source: 'user', until: new Date(NOW.getTime() + 3_600_000) });
    expect(store.get(w.id).state).toBe('paused');
    await runSweep({ store, owner: { isActiveUser: async () => true, functionName: async () => null, projectRoleHolder: async () => null, charterRoleHolder: async () => null, clientRoleHolder: async () => null, accordOwner: async () => null }, switchIsOn: async () => false, now: () => new Date(NOW.getTime() + 2 * 3_600_000) });
    const row = store.get(w.id);
    expect(row.state).toBe('waiting');
    expect(row.due_at.getTime()).toBe(NOW.getTime() + 2 * 3_600_000 + left);
  });

  it('resumes early', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'p', started_at: et(2026, 10, 21, 9) });
    const paused = await pauseWait(store, w, { now: NOW, source: 'user', until: new Date(NOW.getTime() + 86_400_000) });
    await resumeWait(store, paused, { now: NOW, source: 'user' });
    expect(store.get(w.id).state).toBe('waiting');
  });
});

describe('dueAfterDate and small actions', () => {
  it('is 17:00 Eastern on the next business day after the named day', () => {
    expect(zonedParts(dueAfterDate(et(2026, 10, 23, 9)))).toMatchObject({ day: 26, hour: 17 });
    expect(zonedParts(dueAfterDate(et(2026, 10, 21, 9)))).toMatchObject({ day: 22, hour: 17 });
  });

  it('reassign clears the escalation target; stand-in keeps the due date', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.review_internal', subject: 'r', started_at: et(2026, 10, 21, 9) }, { escalated_to_user_id: 'pm' });
    await reassignWait(store, w, { now: NOW, source: 'user', owner_user_id: 'nils' });
    expect(store.get(w.id)).toMatchObject({ owner_user_id: 'nils', escalated_to_user_id: null });
    const due = store.get(w.id).due_at;
    await standInWait(store, store.get(w.id), { now: NOW, source: 'ooo', stand_in_user_id: 'angela' });
    expect(store.get(w.id)).toMatchObject({ stand_in_user_id: 'angela' });
    expect(store.get(w.id).due_at).toEqual(due);
    expect(store.events.map((e) => e.kind)).toContain('stand_in');
  });

  it('extendWait on a closed wait does nothing', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'c', started_at: et(2026, 10, 21, 9) }, { state: 'done' });
    const r = await extendWait(store, w, { now: NOW, source: 'user', business_days: 2 });
    expect(r).toMatchObject({ ok: false, code: 'closed' });
  });
});

describe('template check', () => {
  it('review templates ask a person on reply', () => {
    expect(getTemplate('build.review_client')!.on_reply).toBe('needs_human');
  });
});
