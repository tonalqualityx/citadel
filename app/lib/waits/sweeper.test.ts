import { describe, it, expect, afterEach } from 'vitest';
import { runSweep, resolveWait, effectiveAction, type WaitRow } from './sweeper';
import { zonedTimeToUtc } from './business-days';
import { buildWaitData, getTemplate, type WaitInput } from './templates';
import { MIKE_USER_ID, type OwnerLookups } from './owner';

import { MemStore } from './testing-mem-store';

const lookups = (over: Partial<OwnerLookups> = {}): OwnerLookups => ({
  isActiveUser: async () => true,
  functionName: async () => null,
  projectRoleHolder: async () => null,
  charterRoleHolder: async () => null,
  clientRoleHolder: async () => null,
  accordOwner: async () => null,
  ...over,
});

const et = (y: number, m: number, d: number, h = 0, mi = 0) => zonedTimeToUtc(y, m, d, h, mi);
// Wed 2026-10-21 10:00 Eastern: a business day inside the send window.
const NOW = et(2026, 10, 21, 10);

function deps(store: MemStore, over: Record<string, unknown> = {}) {
  return { store, owner: lookups(), switchIsOn: async () => false, now: () => NOW, ...over };
}

function open(store: MemStore, input: WaitInput, extra: Partial<WaitRow> = {}) {
  return store.add(buildWaitData(input, { allowDisabled: true }), extra);
}

// Registered-but-disabled templates are switched on only inside a test, then restored.
const enabled: string[] = [];
function enable(key: string) {
  const t = getTemplate(key)!;
  if (!t.enabled) {
    t.enabled = true;
    enabled.push(key);
  }
}
afterEach(() => {
  for (const k of enabled.splice(0)) getTemplate(k)!.enabled = false;
});


describe('dry run', () => {
  it('reports and writes nothing', async () => {
    const store = new MemStore();
    enable('sales.proposal_unopened');
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'VCDP proposal', started_at: et(2026, 10, 14, 9) });
    const before = JSON.stringify(store.get(w.id));
    const r = await runSweep(deps(store, { switchIsOn: async () => true }), { dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(r.fired).toHaveLength(1);
    expect(JSON.stringify(store.get(w.id))).toBe(before);
    expect(store.events).toHaveLength(0);
    expect(store.all()).toHaveLength(1);
  });

  it('previews the ladder and the escalation without changing them', async () => {
    const store = new MemStore();
    const mine = open(store, { template_key: 'build.gate_mike', subject: 'the sitemap', started_at: et(2026, 10, 12, 9), client_id: 'c1' });
    const r = await runSweep(deps(store, { notifyMike: async () => true }), { dryRun: true });
    expect(r.nagged.length).toBeGreaterThan(0);
    expect(store.get(mine.id).nag_level).toBe(0);
  });
});

describe('claim and idempotency', () => {
  it('two simultaneous passes fire a due wait once', async () => {
    const store = new MemStore();
    enable('sales.proposal_no_action');
    const w = open(store, { template_key: 'sales.proposal_no_action', subject: 'Dan proposal', started_at: et(2026, 10, 7, 9), idempotency_key: 'k' });
    const sw = async () => true;
    const [a, b] = await Promise.all([
      runSweep(deps(store, { switchIsOn: sw })),
      runSweep(deps(store, { switchIsOn: sw })),
    ]);
    expect(a.fired.length + b.fired.length).toBe(1);
    expect(store.get(w.id).fired_at).toEqual(NOW);
    // exactly one next step
    expect(store.all().filter((x) => x.idempotency_key === `${w.id}:next`)).toHaveLength(1);
    // a third pass does nothing more
    const c = await runSweep(deps(store, { switchIsOn: sw }));
    expect(c.fired).toHaveLength(0);
    expect(store.all()).toHaveLength(2);
  });

  it('takes over a stale claim but not a fresh one', async () => {
    const store = new MemStore();
    enable('sales.proposal_unopened');
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 7, 9) });
    store.get(w.id).claimed_at = new Date(NOW.getTime() - 60_000);
    expect((await runSweep(deps(store, { switchIsOn: async () => true }))).fired).toHaveLength(0);
    store.get(w.id).claimed_at = new Date(NOW.getTime() - 3_600_000);
    expect((await runSweep(deps(store, { switchIsOn: async () => true }))).fired).toHaveLength(1);
  });
});

describe('send', () => {
  it('holds a send outside 08:00 to 18:00 Eastern on business days', async () => {
    const store = new MemStore();
    enable('sales.proposal_unopened');
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 7, 9) });
    const night = et(2026, 10, 21, 20);
    const r = await runSweep(deps(store, { now: () => night, switchIsOn: async () => true }));
    expect(r.held_for_send_window).toEqual([w.id]);
    expect(store.get(w.id).fired_at).toBeNull();
    expect(store.get(w.id).claimed_at).toBeNull();
  });

  it('goes blocked_by_switch while the switch is off, then releases and fires when it is on', async () => {
    const store = new MemStore();
    enable('sales.proposal_unopened');
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 7, 9) });
    const r1 = await runSweep(deps(store));
    expect(r1.blocked_by_switch).toEqual([w.id]);
    expect(store.get(w.id).state).toBe('blocked_by_switch');
    expect(store.get(w.id).switch_key).toBe('WAIT_SENDERS');
    const r2 = await runSweep(deps(store, { switchIsOn: async () => true }));
    expect(r2.released).toEqual([w.id]);
    expect(r2.fired).toHaveLength(1);
    expect(store.get(w.id).fired_at).toEqual(NOW);
  });
});

describe('proceed and task', () => {
  it('proceeds on silence when the guard passes', async () => {
    const store = new MemStore();
    enable('build.review_client');
    const w = open(store, { template_key: 'build.review_client', subject: 'the home page copy', started_at: et(2026, 10, 1, 9) });
    const applied: Array<string | null> = [];
    await runSweep(deps(store, { applyProceed: async (_w: WaitRow, effect: string | null) => void applied.push(effect) }));
    expect(store.get(w.id)).toMatchObject({ state: 'done', resolution: 'proceeded_on_silence' });
    expect(applied).toEqual(['accept_on_silence']);
    expect(store.tasks).toHaveLength(0);
  });

  it('opens a task with its own dated wait when the guard fails', async () => {
    const store = new MemStore();
    enable('build.review_client');
    store.guards = { review_clock_on: false };
    const w = open(store, { template_key: 'build.review_client', subject: 'the home page copy', started_at: et(2026, 10, 1, 9), client_id: 'c1', project_id: 'p1' });
    await runSweep(deps(store));
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]).toMatchObject({ assignee_id: MIKE_USER_ID, project_id: 'p1', client_id: 'c1' });
    expect(store.get(w.id)).toMatchObject({ state: 'done', resolution: 'task_created' });
    const handoff = store.all().find((x) => x.idempotency_key === `${w.id}:task`)!;
    expect(handoff).toMatchObject({ template_key: 'handoff.generic', task_id: 't1', state: 'waiting' });
    expect(handoff.due_at.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('effectiveAction swaps in the fallback only when the guard fails', () => {
    const base = { terminal_action: 'proceed', action_payload: { guard: 'silent_acceptance_live', fallback: 'task' } } as unknown as WaitRow;
    expect(effectiveAction(base, {})).toBe('task');
    expect(effectiveAction(base, { silent_acceptance_live: true })).toBe('proceed');
  });
});

describe('escalate', () => {
  it('for Mike is visibility only: nothing fires or changes state', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'the sitemap', started_at: et(2026, 10, 14, 9) });
    const r = await runSweep(deps(store));
    expect(r.fired).toHaveLength(0);
    expect(store.get(w.id)).toMatchObject({ state: 'waiting', fired_at: null, claimed_at: null });
  });

  it('for anyone else climbs digest, PM, Mike, one business day apart, and stops', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.review_internal', subject: 'the copy', started_at: et(2026, 10, 14, 9), project_id: 'p1' });
    const owner = lookups({
      projectRoleHolder: async (_p, s) => (s.role === 'content' ? 'nils' : s.role === 'pm' ? 'pm1' : null),
    });
    const stages: string[] = [];
    let now = NOW;
    for (let i = 0; i < 5; i++) {
      const r = await runSweep(deps(store, { owner, now: () => now }));
      stages.push(...r.escalated.map((e) => e.stage));
      now = new Date(store.get(w.id).due_at.getTime() + 60_000);
    }
    expect(stages).toEqual(['role_holder_digest', 'pm', 'mike']);
    const row = store.get(w.id);
    expect(row.escalated_to_user_id).toBe(MIKE_USER_ID);
    expect(row.fired_at).not.toBeNull();
    expect(row.state).toBe('waiting');
  });

  it('wp.failed_update escalates straight to Mike', async () => {
    const store = new MemStore();
    enable('wp.failed_update');
    const w = open(store, { template_key: 'wp.failed_update', subject: 'viscc.org', started_at: et(2026, 10, 1, 9), project_id: 'p1' });
    const r = await runSweep(deps(store, { owner: lookups({ projectRoleHolder: async () => 'sabeen' }) }));
    expect(r.escalated).toEqual([{ id: w.id, stage: 'mike', to: MIKE_USER_ID }]);
    expect(store.get(w.id).escalated_to_user_id).toBe(MIKE_USER_ID);
  });
});

describe('errors', () => {
  it('three firing errors turn the wait needs_human on Mike with the error in detail', async () => {
    const store = new MemStore();
    enable('build.review_client');
    store.guards = { review_clock_on: false };
    store.failCreateTask = true;
    const w = open(store, { template_key: 'build.review_client', subject: 'the copy', started_at: et(2026, 10, 1, 9) });
    await runSweep(deps(store));
    expect(store.get(w.id)).toMatchObject({ state: 'waiting', fire_error_count: 1, claimed_at: null });
    await runSweep(deps(store));
    expect(store.get(w.id).fire_error_count).toBe(2);
    const r = await runSweep(deps(store));
    expect(r.needs_human).toEqual([w.id]);
    const row = store.get(w.id);
    expect(row).toMatchObject({ state: 'needs_human', owner_user_id: MIKE_USER_ID, fire_error_count: 3 });
    expect(row.detail).toContain('task api down');
    // and it never fires again by itself
    const after = await runSweep(deps(store));
    expect(after.fired).toHaveLength(0);
    expect(store.tasks).toHaveLength(0);
  });
});

describe('lifecycle', () => {
  it('resumes a paused wait with the time it had left', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'x', started_at: et(2026, 10, 20, 9) });
    Object.assign(store.get(w.id), { state: 'paused', paused_until: new Date(NOW.getTime() - 1000), paused_remaining_ms: 5 * 3_600_000 });
    const r = await runSweep(deps(store));
    expect(r.resumed).toEqual([w.id]);
    const row = store.get(w.id);
    expect(row.state).toBe('waiting');
    expect(row.due_at.getTime()).toBe(NOW.getTime() + 5 * 3_600_000);
    expect(row.paused_until).toBeNull();
  });

  it('expires a wait whose subject is gone, and closes one whose task is done', async () => {
    const store = new MemStore();
    const a = open(store, { template_key: 'build.gate_mike', subject: 'a', started_at: et(2026, 10, 20, 9), project_id: 'p1' });
    const b = open(store, { template_key: 'build.gate_mike', subject: 'b', started_at: et(2026, 10, 20, 9), task_id: 't9' });
    store.subject[a.id] = 'gone';
    store.subject[b.id] = 'task_done';
    const r = await runSweep(deps(store));
    expect(r.expired).toEqual([a.id]);
    expect(r.closed_with_task).toEqual([b.id]);
    expect(store.get(a.id)).toMatchObject({ state: 'expired', resolution: 'subject_gone' });
    expect(store.get(b.id)).toMatchObject({ state: 'done', resolution: 'task_done' });
  });

  it('skips a template whose precondition fails and closes the wait', async () => {
    const store = new MemStore();
    enable('launch.d90');
    const w = open(store, { template_key: 'launch.d90', subject: 'Acme', started_at: et(2026, 7, 1, 9), client_id: 'c1' });
    store.preconditionOk = false;
    const r = await runSweep(deps(store, { switchIsOn: async () => true }));
    expect(r.skipped_precondition).toEqual([w.id]);
    expect(store.get(w.id)).toMatchObject({ state: 'done', resolution: 'precondition_not_met' });
  });

  it('never fires a registered-but-disabled template', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_unopened', subject: 'x', started_at: et(2026, 10, 7, 9) });
    const r = await runSweep(deps(store, { switchIsOn: async () => true }));
    expect(r.skipped_disabled).toEqual([w.id]);
    expect(store.get(w.id).fired_at).toBeNull();
  });

  it('resolveWait advances a chain on approval and not on cancel', async () => {
    const store = new MemStore();
    enable('charter.price_review');
    const w = open(store, { template_key: 'charter.price_review', subject: 'Herba', due_at: et(2026, 10, 1, 9), step: 2 });
    await resolveWait(store, store.get(w.id), 'approved', { now: NOW, source: 'user', actor_user_id: MIKE_USER_ID });
    expect(store.all().filter((x) => x.step === 3)).toHaveLength(1);
    const w2 = open(store, { template_key: 'charter.price_review', subject: 'Herba', due_at: et(2026, 10, 1, 9), step: 2 });
    await resolveWait(store, store.get(w2.id), 'cancelled', { now: NOW, source: 'user' });
    expect(store.all().filter((x) => x.step === 3)).toHaveLength(1);
  });
});

describe('visibility ladder for Mike', () => {
  const mk = (store: MemStore, started: Date) =>
    open(store, { template_key: 'build.gate_mike', subject: 'the sitemap', started_at: started, client_id: 'c1' });

  it('level 1 at the due date (it enters Blocking today)', async () => {
    const store = new MemStore();
    // started Mon 10-19 10:00, due Wed 10-21 17:00; sweep Wed 18:00 Eastern -> due, 0 days late
    const w = mk(store, et(2026, 10, 19, 10));
    const r = await runSweep(deps(store, { now: () => et(2026, 10, 21, 18) }));
    expect(r.nagged).toEqual([{ id: w.id, level: 1 }]);
    expect(store.get(w.id).nag_level).toBe(1);
  });

  it('one Slack DM at three business days late, once', async () => {
    const store = new MemStore();
    const w = mk(store, et(2026, 10, 12, 10)); // due Wed 10-14 17:00; Mon 10-19 is 3 late
    let dms = 0;
    const notify = async () => (dms++, true);
    const now = () => et(2026, 10, 19, 9);
    await runSweep(deps(store, { now, notifyMike: notify }));
    expect(store.get(w.id).nag_level).toBe(2);
    await runSweep(deps(store, { now, notifyMike: notify }));
    expect(dms).toBe(1);
  });

  it('stays at level 1 when the DM cannot be sent, and tries again', async () => {
    const store = new MemStore();
    const w = mk(store, et(2026, 10, 12, 10));
    await runSweep(deps(store, { now: () => et(2026, 10, 19, 9), notifyMike: async () => false }));
    expect(store.get(w.id).nag_level).toBe(1);
    await runSweep(deps(store, { now: () => et(2026, 10, 19, 9), notifyMike: async () => true }));
    expect(store.get(w.id).nag_level).toBe(2);
  });

  it('the countdown at five days late', async () => {
    const store = new MemStore();
    const w = mk(store, et(2026, 10, 12, 10)); // due 10-14; Wed 10-21 is 5 late
    await runSweep(deps(store, { now: () => et(2026, 10, 21, 9), notifyMike: async () => true }));
    expect(store.get(w.id).nag_level).toBe(3);
  });

  it('a wait that does not block a client never climbs past level 1', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'meeting.type_unclear', subject: 'the Dan call', started_at: et(2026, 10, 1, 10) });
    await runSweep(deps(store, { now: () => et(2026, 10, 21, 9), notifyMike: async () => true }));
    expect(store.get(w.id).nag_level).toBe(1);
  });

  it('never nags for someone else\'s wait', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.review_internal', subject: 'x', started_at: et(2026, 10, 1, 10), project_id: 'p1', client_id: 'c1' });
    const owner = lookups({ projectRoleHolder: async () => 'nils' });
    await runSweep(deps(store, { owner, now: () => et(2026, 10, 21, 9), notifyMike: async () => true }));
    expect(store.get(w.id).nag_level).toBe(0);
  });
});
