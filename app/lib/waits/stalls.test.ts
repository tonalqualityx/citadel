import { describe, it, expect } from 'vitest';
import { detectStalls, stallFor, type StallBrief, type StallStore, type StallTask } from './stalls';
import { runSweep } from './sweeper';
import { zonedTimeToUtc } from './business-days';
import { buildWaitData, getTemplate } from './templates';
import { MIKE_USER_ID, type OwnerLookups } from './owner';
import { MemStore } from './testing-mem-store';

const et = (y: number, m: number, d: number, h = 10) => zonedTimeToUtc(y, m, d, h, 0);
// Wed 2026-10-21 10:00 Eastern.
const NOW = et(2026, 10, 21);
const RULES = { not_started_bd: 5, in_progress_bd: 5, blocked_resolved_bd: 2, review_approved_bd: 2 };

const brief = (over: Partial<StallBrief> = {}): StallBrief => ({
  id: 'b1',
  label: 'Herba retainer',
  client_id: 'c1',
  project_id: null,
  charter_id: 'ch1',
  owner_mode: 'live',
  release_owner_role: 'pm',
  stall_rules: RULES,
  scope: {},
  ...over,
});

const task = (over: Partial<StallTask> = {}): StallTask => ({
  id: 't1',
  title: 'Update the kava finder copy',
  status: 'not_started',
  client_id: 'c1',
  project_id: 'p1',
  charter_id: 'ch1',
  created_at: et(2026, 10, 1),
  started_at: null,
  client_approved_at: null,
  lease_until: null,
  last_comment_at: null,
  blockers: [],
  ...over,
});

function stallStore(briefs: StallBrief[], tasks: StallTask[], covered: string[] = []): StallStore & { listCalls: number } {
  const s = {
    listCalls: 0,
    async listBriefs() {
      s.listCalls++;
      return briefs;
    },
    async listOpenTasks() {
      return tasks;
    },
    async tasksWithOpenWait(ids: string[]) {
      return new Set(ids.filter((i) => covered.includes(i)));
    },
    async functionIdForRole() {
      return 'fn-pm';
    },
  };
  return s;
}

describe('stallFor: each rule', () => {
  it('not started past the limit', () => {
    expect(stallFor(task({ created_at: et(2026, 10, 1) }), RULES, NOW)?.rule).toBe('not_started');
    expect(stallFor(task({ created_at: et(2026, 10, 19) }), RULES, NOW)).toBeNull();
    expect(stallFor(task({ created_at: et(2026, 10, 1) }), {}, NOW)).toBeNull(); // rule off without a number
  });

  it('in progress with no comment and no live lease', () => {
    const t = task({ status: 'in_progress', started_at: et(2026, 10, 1) });
    expect(stallFor(t, RULES, NOW)?.rule).toBe('in_progress');
    expect(stallFor({ ...t, last_comment_at: et(2026, 10, 20) }, RULES, NOW)).toBeNull();
    expect(stallFor({ ...t, lease_until: new Date(NOW.getTime() + 600_000) }, RULES, NOW)).toBeNull();
    // An expired lease does not count as live.
    expect(stallFor({ ...t, lease_until: new Date(NOW.getTime() - 600_000) }, RULES, NOW)?.rule).toBe('in_progress');
  });

  it('blocked with every blocker done', () => {
    const done = { status: 'done', completed_at: et(2026, 10, 14), updated_at: et(2026, 10, 14) };
    const t = task({ status: 'blocked', blockers: [done] });
    expect(stallFor(t, RULES, NOW)?.rule).toBe('blocked_resolved');
    expect(stallFor({ ...t, blockers: [done, { ...done, status: 'in_progress' }] }, RULES, NOW)).toBeNull();
    expect(stallFor({ ...t, blockers: [] }, RULES, NOW)).toBeNull();
    expect(stallFor({ ...t, blockers: [{ ...done, completed_at: et(2026, 10, 20) }] }, RULES, NOW)).toBeNull();
  });

  it('review with a client approval that has sat', () => {
    const t = task({ status: 'review', client_approved_at: et(2026, 10, 14) });
    expect(stallFor(t, RULES, NOW)?.rule).toBe('review_approved');
    expect(stallFor({ ...t, client_approved_at: null }, RULES, NOW)).toBeNull();
    expect(stallFor({ ...t, client_approved_at: et(2026, 10, 20) }, RULES, NOW)).toBeNull();
  });
});

describe('detectStalls', () => {
  it('opens an engagement.stalled wait due now, owned by the brief role', async () => {
    const store = new MemStore();
    const r = await detectStalls(NOW, {}, { store, stalls: stallStore([brief()], [task()]) });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ rule: 'not_started', outcome: 'opened' });
    const w = store.all()[0];
    expect(w).toMatchObject({ template_key: 'engagement.stalled', task_id: 't1', charter_id: 'ch1', owner_function_id: 'fn-pm', state: 'waiting' });
    expect(w.due_at.getTime()).toBe(NOW.getTime());
    expect(store.events.map((e) => e.kind)).toEqual(['created']);
  });

  it('an existing open wait on the task suppresses a duplicate', async () => {
    const store = new MemStore();
    const r = await detectStalls(NOW, {}, { store, stalls: stallStore([brief()], [task()], ['t1']) });
    expect(r.findings).toHaveLength(0);
    expect(store.all()).toHaveLength(0);
  });

  it('a second pass the same day opens nothing new', async () => {
    const store = new MemStore();
    const s = stallStore([brief()], [task()]);
    await detectStalls(NOW, {}, { store, stalls: s });
    await detectStalls(NOW, {}, { store, stalls: s });
    expect(store.all()).toHaveLength(1);
  });

  it('dry mode (brief or sweep) reports and writes nothing', async () => {
    const a = new MemStore();
    const ra = await detectStalls(NOW, {}, { store: a, stalls: stallStore([brief({ owner_mode: 'dry' })], [task()]) });
    expect(ra.findings).toMatchObject([{ outcome: 'would_open' }]);
    expect(a.all()).toHaveLength(0);
    expect(a.events).toHaveLength(0);
    const b = new MemStore();
    const rb = await detectStalls(NOW, { dryRun: true }, { store: b, stalls: stallStore([brief()], [task()]) });
    expect(rb.findings).toMatchObject([{ outcome: 'would_open' }]);
    expect(b.all()).toHaveLength(0);
  });

  it('skips an off brief and a brief with no rules', async () => {
    const store = new MemStore();
    const r = await detectStalls(NOW, {}, { store, stalls: stallStore([brief({ owner_mode: 'off' }), brief({ id: 'b2', stall_rules: {} })], [task()]) });
    expect(r.findings).toHaveLength(0);
  });

  it('caps new waits per pass and reports the rest', async () => {
    const store = new MemStore();
    const tasks = [1, 2, 3, 4].map((i) => task({ id: `t${i}`, created_at: et(2026, 10, i) }));
    const r = await detectStalls(NOW, {}, { store, stalls: stallStore([brief({ stall_rules: { ...RULES, max_new_per_pass: 2 } })], tasks) });
    expect(store.all()).toHaveLength(2);
    expect(r.deferred).toBe(2);
    expect(store.all().map((w) => w.task_id)).toEqual(['t1', 't2']); // longest-stuck first
  });
});

const lookups = (over: Partial<OwnerLookups> = {}): OwnerLookups => ({
  isActiveUser: async () => true,
  functionName: async (id) => (id === 'fn-pm' ? 'Project Manager' : null),
  projectRoleHolder: async () => null,
  charterRoleHolder: async () => null,
  clientRoleHolder: async () => null,
  accordOwner: async () => null,
  ...over,
});

describe('sweep integration', () => {
  it('runSweep calls stall detection once per pass and fires the new wait in the same pass', async () => {
    const store = new MemStore();
    const s = stallStore([brief()], [task()]);
    const owner = lookups({ projectRoleHolder: async (_p, sc) => (sc.role === 'pm' ? 'pm1' : null) });
    const r = await runSweep({ store, owner, switchIsOn: async () => false, now: () => NOW, stalls: s });
    expect(s.listCalls).toBe(1);
    expect(r.stalls?.findings).toHaveLength(1);
    expect(r.fired.filter((f) => f.template_key === 'engagement.stalled')).toHaveLength(1);
    expect(store.notifications).toHaveLength(1);
  });

  it('a dry sweep writes no wait and no notification', async () => {
    const store = new MemStore();
    const r = await runSweep({ store, owner: lookups(), switchIsOn: async () => false, now: () => NOW, stalls: stallStore([brief()], [task()]) }, { dryRun: true });
    expect(r.stalls?.findings).toMatchObject([{ outcome: 'would_open' }]);
    expect(store.all()).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);
  });

  it('notifies once per rung: role holder, then PM, then Mike, on consecutive business days', async () => {
    const store = new MemStore();
    const owner = lookups({
      projectRoleHolder: async (_p, sc) => (sc.role === 'pm' ? 'pm1' : null),
    });
    // The wait sits on a project so the PM holder resolves. The role holder IS the PM here; the
    // second rung climbs to "the PM" again, so give the first rung a distinct holder via a person.
    const w = store.add(
      buildWaitData({ template_key: 'engagement.stalled', subject: 'a stalled task', started_at: NOW, project_id: 'p1', owner_user_id: 'role-holder', task_id: 't1' }),
      {}
    );
    // Walk the clock: each sweep runs just after the wait's current due time, twice (the repeat must add nothing).
    let now = NOW;
    const stamps: Date[] = [];
    for (let i = 0; i < 5; i++) {
      now = i === 0 ? new Date(w.due_at.getTime() + 60_000) : new Date(store.get(w.id).due_at.getTime() + 60_000);
      stamps.push(now);
      await runSweep({ store, owner, switchIsOn: async () => false, now: () => now });
      await runSweep({ store, owner, switchIsOn: async () => false, now: () => new Date(now.getTime() + 60_000) });
    }
    // Rungs landed on three distinct, later business days.
    const days = new Set(stamps.slice(0, 3).map((d) => d.toISOString().slice(0, 10)));
    expect(days.size).toBe(3);
    expect(store.notifications.map((n) => n.user_id)).toEqual(['role-holder', 'pm1', MIKE_USER_ID]);
    expect(store.notifications.every((n) => n.wait_id === w.id)).toBe(true);
    expect(store.get(w.id).fired_at).not.toBeNull();
  });

  it('other templates create no notification when they escalate', async () => {
    const store = new MemStore();
    expect(getTemplate('build.review_internal')?.notify_on_escalate).toBeUndefined();
    store.add(buildWaitData({ template_key: 'build.review_internal', subject: 'the copy', started_at: et(2026, 10, 14), project_id: 'p1' }));
    const owner = lookups({ projectRoleHolder: async (_p, sc) => (sc.role === 'content' ? 'nils' : sc.role === 'pm' ? 'pm1' : null) });
    let now = NOW;
    for (let i = 0; i < 4; i++) {
      await runSweep({ store, owner, switchIsOn: async () => false, now: () => now });
      now = new Date([...store.waits.values()][0].due_at.getTime() + 60_000);
    }
    expect(store.events.filter((e) => e.kind === 'escalated').length).toBeGreaterThanOrEqual(3);
    expect(store.notifications).toHaveLength(0);
  });
});

