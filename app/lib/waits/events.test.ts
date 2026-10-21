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
    const sel = { event_id: 'e1', kind: 'stop', chain: { kind: 'project', id: UUID(1) }, payload: { reason: 'reply' } };
    const a = await applyWaitEvent(store, sel, NOW);
    expect(a.applied).toEqual([{ wait_id: w.id, action: 'stopped', detail: 'reply' }]);
    expect(store.get(w.id)).toMatchObject({ state: 'done', resolution: 'stopped_by_reply' });
    const b = await applyWaitEvent(store, sel, NOW);
    expect(b.duplicate).toBe(false); // the wait is closed now, so nothing matches
    expect(b.applied).toEqual([]);
  });

  it('a replay against an open wait is a duplicate and changes nothing', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'x', started_at: et(2026, 10, 21, 9), project_id: UUID(1) });
    const ev = { event_id: 'r1', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 2, reason: 'need_more_time' } };
    await applyWaitEvent(store, ev, NOW);
    const due = store.get(w.id).due_at;
    const again = await applyWaitEvent(store, ev, NOW);
    expect(again.duplicate).toBe(true);
    expect(store.get(w.id).due_at).toEqual(due);
    expect(store.get(w.id).extension_count).toBe(1);
  });

  it('an exact-key check: a different event whose id is a prefix is not a duplicate', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'x', started_at: et(2026, 10, 21, 9) });
    await applyWaitEvent(store, { event_id: 'abc', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 1 } }, NOW);
    const r = await applyWaitEvent(store, { event_id: 'ab', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 1 } }, NOW);
    expect(r.duplicate).toBe(false);
    expect(store.get(w.id).extension_count).toBe(2);
  });

  it('a partial-batch replay applies only the waits not yet done', async () => {
    const store = new MemStore();
    const a = open(store, { template_key: 'sales.proposal_unopened', subject: 'a', started_at: et(2026, 10, 20, 9), project_id: UUID(30) });
    const b = open(store, { template_key: 'sales.proposal_unopened', subject: 'b', started_at: et(2026, 10, 20, 9), project_id: UUID(30) });
    // A crash left only wait a's marker behind (as if wait b's transaction rolled back).
    await store.addEvent({ wait_id: a.id, kind: 'event_received', source: 'placement', event_id: `pb1:${a.id}` });
    const r = await applyWaitEvent(store, { event_id: 'pb1', kind: 'extend', chain: { kind: 'project', id: UUID(30) }, payload: { mode: 'days', business_days: 2 } }, NOW);
    expect(r.duplicate).toBe(false);
    expect(r.applied.map((x) => x.wait_id)).toEqual([b.id]);
    expect(store.get(a.id).extension_count).toBe(0);
    expect(store.get(b.id).extension_count).toBe(1);
  });

  it('two concurrent copies of one event apply once', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'a', started_at: et(2026, 10, 20, 9), project_id: UUID(31) });
    const ev = { event_id: 'cc1', kind: 'extend', chain: { kind: 'project', id: UUID(31) }, payload: { mode: 'days', business_days: 2 } };
    const [x, y] = await Promise.all([applyWaitEvent(store, ev, NOW), applyWaitEvent(store, ev, NOW)]);
    expect(x.applied.length + y.applied.length).toBe(1);
    expect(store.get(w.id).extension_count).toBe(1);
    expect([x.duplicate, y.duplicate].filter(Boolean)).toHaveLength(1);
  });

  it('a failure mid-change rolls the marker back, so a retry can apply', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'a', started_at: et(2026, 10, 20, 9), project_id: UUID(32) });
    const real = store.update.bind(store);
    let fail = true;
    store.update = async (id, data) => {
      if (fail) throw new Error('db hiccup');
      return real(id, data);
    };
    const ev = { event_id: 'rb1', kind: 'extend', chain: { kind: 'project', id: UUID(32) }, payload: { mode: 'days', business_days: 2 } };
    await expect(applyWaitEvent(store, ev, NOW)).rejects.toThrow('db hiccup');
    expect(store.events.filter((e) => e.event_id)).toHaveLength(0);
    fail = false;
    const r = await applyWaitEvent(store, ev, NOW);
    expect(r.applied[0].action).toBe('extended');
    expect(store.get(w.id).extension_count).toBe(1);
  });

  it('PROBE: a client reply on a client chain does not close Mike\'s gate', async () => {
    const store = new MemStore();
    const gate = open(store, { template_key: 'build.gate_mike', subject: 'the sitemap', started_at: et(2026, 10, 21, 9), client_id: UUID(40) });
    const review = open(store, { template_key: 'build.review_client', subject: 'the copy', started_at: et(2026, 10, 21, 9), client_id: UUID(40) });
    const r = await applyWaitEvent(store, { event_id: 'pr1', kind: 'stop', chain: { kind: 'client', id: UUID(40) }, payload: { reason: 'reply' } }, NOW);
    expect(store.get(gate.id).state).toBe('waiting');
    expect(r.applied.find((x) => x.wait_id === gate.id)?.action).toBe('skipped_not_named');
    expect(store.get(review.id).state).toBe('needs_human');
  });

  it('PROBE: an out-of-office on a client chain does not move Mike\'s gate or reset its nag level', async () => {
    const store = new MemStore();
    const gate = open(store, { template_key: 'build.gate_mike', subject: 'the sitemap', started_at: et(2026, 10, 1, 9), client_id: UUID(41) }, { nag_level: 3 });
    const due = gate.due_at;
    await applyWaitEvent(store, { event_id: 'pr2', kind: 'extend', chain: { kind: 'client', id: UUID(41) }, payload: { mode: 'days', business_days: 5, reason: 'ooo', auto_reply: true } }, NOW);
    expect(store.get(gate.id).due_at).toEqual(due);
    expect(store.get(gate.id).nag_level).toBe(3);
  });

  it('an event that names the wait may move it, and an extension never resets nag_level', async () => {
    const store = new MemStore();
    const gate = open(store, { template_key: 'build.gate_mike', subject: 'the sitemap', started_at: et(2026, 10, 1, 9) }, { nag_level: 2 });
    await applyWaitEvent(store, { event_id: 'pr3', kind: 'extend', target: gate.id, payload: { mode: 'days', business_days: 3 } }, NOW);
    expect(store.get(gate.id).extension_count).toBe(1);
    expect(store.get(gate.id).nag_level).toBe(2);
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
    const r = await applyWaitEvent(store, { event_id: 'e4', kind: 'stop', target: w.id, payload: { reason: 'approval' } }, NOW);
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
    await applyWaitEvent(store, { event_id: 'e6', kind: 'extend', target: a.id, payload: { mode: 'days', business_days: 5, reason: 'need_more_time' } }, NOW);
    expect(store.get(a.id).due_at.getTime()).toBeGreaterThan(due0.getTime());
    expect(store.get(a.id)).toMatchObject({ extension_count: 1, extended_bd_total: 5 });

    const b = open(store, { template_key: 'build.gate_mike', subject: 'b', started_at: et(2026, 10, 21, 9), project_id: UUID(7) });
    // "back Friday 2026-10-23": due Monday 10-26 17:00
    await applyWaitEvent(
      store,
      { event_id: 'e7', kind: 'extend', target: b.id, payload: { mode: 'until', until: et(2026, 10, 23, 9).toISOString(), reason: 'ooo' } },
      NOW
    );
    expect(iso(store.get(b.id).due_at)).toBe(iso(et(2026, 10, 26, 17)));
  });

  it('caps extensions: the third becomes needs_human', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'c', started_at: et(2026, 10, 21, 9), project_id: UUID(8) });
    for (let i = 0; i < MAX_EXTENSIONS; i++) {
      await applyWaitEvent(store, { event_id: `x${i}`, kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 2, reason: 'need_more_time' } }, NOW);
    }
    expect(store.get(w.id).extension_count).toBe(2);
    const r = await applyWaitEvent(store, { event_id: 'x9', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 2, reason: 'need_more_time' } }, NOW);
    expect(r.applied[0].action).toBe('cap');
    expect(store.get(w.id).state).toBe('needs_human');
    expect(store.get(w.id).extension_count).toBe(2);
  });

  it('caps at 15 business days in total', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'd', started_at: et(2026, 10, 21, 9), project_id: UUID(10) });
    await applyWaitEvent(store, { event_id: 'y1', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 10 } }, NOW);
    const r = await applyWaitEvent(store, { event_id: 'y2', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 6 } }, NOW);
    expect(r.applied[0].action).toBe('cap');
    expect(store.get(w.id).extended_bd_total).toBe(10);
  });

  it('an auto-reply extends each wait once', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'e', started_at: et(2026, 10, 21, 9), project_id: UUID(11) });
    const ev = (id: string) => ({ event_id: id, kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 5, reason: 'ooo', auto_reply: true } });
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

describe('pause restores the prior state', () => {
  const owner = { isActiveUser: async () => true, functionName: async () => null, projectRoleHolder: async () => null, charterRoleHolder: async () => null, clientRoleHolder: async () => null, accordOwner: async () => null };

  it('a needs_human wait stays needs_human after pause and early resume', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'p', started_at: et(2026, 10, 21, 9) }, { state: 'needs_human' });
    const paused = await pauseWait(store, store.get(w.id), { now: NOW, source: 'user', until: new Date(NOW.getTime() + 86_400_000) });
    await resumeWait(store, paused, { now: NOW, source: 'user' });
    expect(store.get(w.id).state).toBe('needs_human');
  });

  it('the sweeper resumes a needs_human wait back to needs_human', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'p', started_at: et(2026, 10, 21, 9) }, { state: 'needs_human' });
    await pauseWait(store, store.get(w.id), { now: NOW, source: 'user', until: new Date(NOW.getTime() + 3_600_000) });
    await runSweep({ store, owner, switchIsOn: async () => false, now: () => new Date(NOW.getTime() + 2 * 3_600_000) });
    expect(store.get(w.id).state).toBe('needs_human');
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
