// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DISPOSITIONS, applyFloors, birthState, cleanReason, decideReplay, notHeldByMike, ownerFor, ownerOfAssignee, planSync, waitKeyFor, type ReplayAsk, type SyncExisting } from '../decision';

describe('applyFloors', () => {
  it.each([
    ['no_action', { is_urgent: true, intent: null }, 'reply_mike', 'no_action_refused_urgent'],
    ['waiting_them', { is_urgent: true, intent: null }, 'reply_mike', 'waiting_them_refused_urgent'],
    ['no_action', { is_urgent: false, intent: 'admin' }, 'reply_mike', 'no_action_refused_admin'],
    ['waiting_them', { is_urgent: false, intent: 'admin' }, 'reply_mike', 'waiting_them_refused_admin'],
    ['no_action', { is_urgent: false, intent: 'sales' }, 'reply_mike', 'no_action_refused_sales'],
    ['waiting_them', { is_urgent: false, intent: 'sales' }, 'reply_mike', 'waiting_them_refused_sales'],
    ['emergency', { is_urgent: false, intent: null }, 'reply_mike', 'emergency_without_urgent_flag'],
  ] as const)('%s with %j is %s', (d, facts, out, why) => {
    expect(applyFloors(d, facts)).toEqual({ disposition: out, adjusted: why });
  });

  it.each(DISPOSITIONS)('%s stands on an ordinary ask', (d) => {
    expect(applyFloors(d, { is_urgent: d === 'emergency', intent: null })).toEqual({ disposition: d, adjusted: null });
  });

  it('the floors only raise: reply_mike, work and meeting are never turned into no_action', () => {
    for (const d of ['reply_mike', 'work', 'meeting'] as const) {
      for (const facts of [{ is_urgent: true, intent: 'admin' }, { is_urgent: false, intent: 'sales' }, { is_urgent: false, intent: null }]) {
        expect(applyFloors(d, facts).disposition).toBe(d);
      }
    }
  });
});

describe('owner, birth state, wait key, reason', () => {
  it('owners by disposition', () => {
    expect(ownerFor('reply_mike')).toBe('mike');
    expect(ownerFor('meeting')).toBe('mike');
    expect(ownerFor('emergency')).toBe('mike');
    expect(ownerFor('no_action')).toBe('nobody');
    expect(ownerFor('waiting_them')).toBe('nobody');
    expect(ownerFor('work')).toBeNull();
    expect(ownerFor('work', 'bast')).toBe('bast');
  });
  it('assignee words', () => {
    expect(ownerOfAssignee('bot', 'me', ['bot'])).toBe('bast');
    expect(ownerOfAssignee('me', 'me', ['bot'])).toBe('mike');
    expect(ownerOfAssignee(null, 'me', ['bot'])).toBe('mike');
    expect(ownerOfAssignee('x', 'me', ['bot'])).toBe('sabeen');
  });
  it('only no_action and waiting_them are born handled; only waiting_them opens a wait', () => {
    expect(birthState('no_action')).toEqual({ state: 'handled', closed_reason: 'no_action', closed_by: 'intake', wait: false });
    expect(birthState('waiting_them')).toEqual({ state: 'handled', closed_reason: 'waiting_them', closed_by: 'intake', wait: true });
    for (const d of ['reply_mike', 'work', 'meeting', 'emergency'] as const) expect(birthState(d)).toEqual({ state: 'open', closed_reason: null, closed_by: null, wait: false });
  });
  it('wait key is the conversation, else the message', () => {
    expect(waitKeyFor('root@x', 'm1')).toBe('conv:root@x');
    expect(waitKeyFor(null, 'm1')).toBe('msg:m1');
    expect(waitKeyFor('  ', 'm1')).toBe('msg:m1');
  });
  it('a reason is one plain line of at most 120 characters with no dash', () => {
    expect(cleanReason('A thank-you — nothing asked')).toBe('A thank-you , nothing asked');
    expect(cleanReason('a\nb   c')).toBe('a b c');
    expect(cleanReason('x'.repeat(300))?.length).toBe(119);
    expect(cleanReason('   ')).toBeNull();
    expect(cleanReason(null)).toBeNull();
  });
  it('the hold fragment names asks he has not decided', () => {
    expect(notHeldByMike.OR).toHaveLength(2);
  });
});

describe('planSync', () => {
  const ex = (o: Partial<SyncExisting> = {}): SyncExisting => ({ disposition: null, decided_by: null, intent: null, task_id: null, state: 'open', closed_by: null, is_urgent: false, ...o });
  const post = (d: 'no_action' | 'reply_mike' | 'work' | 'meeting' | 'waiting_them' | 'emergency', o: Partial<Parameters<typeof planSync>[1]> = {}) => ({ disposition: d, reason: 'r', is_urgent: false, intent: null, ...o });

  it('a new no_action row is born handled, once', () => {
    const p = planSync(null, post('no_action'));
    expect(p.fields).toMatchObject({ state: 'handled', closed_reason: 'no_action', closed_by: 'intake', disposition: 'no_action', owner: 'nobody', decided_by: 'intake', disposition_reason: 'r' });
    expect(p.prior).toBeNull();
  });
  it('a new urgent no_action is reply_mike, open, adjusted', () => {
    const p = planSync(null, post('no_action', { is_urgent: true }));
    expect(p.disposition).toBe('reply_mike');
    expect('state' in p.fields).toBe(false);
    expect(p.adjusted).toBe('no_action_refused_urgent');
  });
  it('an existing undecided row never takes no_action or waiting_them', () => {
    for (const d of ['no_action', 'waiting_them'] as const) {
      const p = planSync(ex(), post(d));
      expect(p.fields).toEqual({});
      expect(p.adjusted).toBe('close_only_at_birth');
    }
  });
  it('an existing undecided row takes reply_mike, meeting, emergency; work only with a task', () => {
    expect(planSync(ex(), post('reply_mike')).fields).toMatchObject({ disposition: 'reply_mike' });
    expect(planSync(ex(), post('meeting')).fields).toMatchObject({ disposition: 'meeting' });
    expect(planSync(ex(), post('emergency', { is_urgent: true })).fields).toMatchObject({ disposition: 'emergency' });
    expect(planSync(ex(), post('work')).fields).toEqual({});
    expect(planSync(ex({ task_id: 't', task_owner: 'bast' }), post('work')).fields).toMatchObject({ disposition: 'work', owner: 'bast' });
  });
  it('a decided row is never rewritten, and reports prior', () => {
    const p = planSync(ex({ disposition: 'reply_mike', task_id: 't' }), post('meeting'));
    expect(p.fields).toEqual({});
    expect(p.prior).toEqual({ disposition: 'reply_mike', task_id: 't' });
  });
  it('his own decision holds', () => {
    const p = planSync(ex({ disposition: 'reply_mike', decided_by: 'mike' }), post('no_action'));
    expect(p.fields).toEqual({});
    expect(p.adjusted).toBe('held_by_mike');
    // even an undecided row he touched
    expect(planSync(ex({ decided_by: 'mike' }), post('reply_mike')).fields).toEqual({});
  });
  it('an intake close that turns urgent reopens as an emergency (the floors only raise)', () => {
    const p = planSync(ex({ disposition: 'no_action', decided_by: 'intake', state: 'handled', closed_by: 'intake' }), post('emergency', { is_urgent: true }));
    expect(p.reopen).toBe(true);
    expect(p.fields).toMatchObject({ state: 'open', disposition: 'emergency', closed_at: null, closed_reason: null, closed_by: null });
  });
  it('but never one he reopened and re-decided', () => {
    const p = planSync(ex({ disposition: 'reply_mike', decided_by: 'mike', state: 'handled', closed_by: 'intake' }), post('emergency', { is_urgent: true }));
    expect(p.reopen).toBe(false);
  });
});

describe('decideReplay', () => {
  const ask = (o: Partial<ReplayAsk> = {}): ReplayAsk => ({ id: 'a1', state: 'open', disposition: null, decided_by: null, is_urgent: false, intent: null, task_id: null, task_security: false, ...o });
  const run = (a: ReplayAsk | null, d: string) => decideReplay(a, { disposition: d });

  it('closes only an open, undecided no_action', () => {
    expect(run(ask(), 'no_action')).toMatchObject({ verdict: 'close', disposition: 'no_action' });
    expect(run(ask({ state: 'handled' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'not_open' });
    expect(run(ask({ disposition: 'reply_mike' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ decided_by: 'mike' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'held_by_mike' });
  });
  it('never closes urgent, admin, sales or a security task ask', () => {
    expect(run(ask({ is_urgent: true }), 'no_action')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ intent: 'admin' }), 'no_action')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ intent: 'sales' }), 'no_action')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ task_security: true, task_id: 't' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'security_task' });
  });
  it('stores the others without closing', () => {
    expect(run(ask(), 'reply_mike')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask(), 'meeting')).toMatchObject({ verdict: 'set', disposition: 'meeting' });
    expect(run(ask(), 'work')).toMatchObject({ verdict: 'leave', why: 'work_without_task' });
    expect(run(ask({ task_id: 't' }), 'work')).toMatchObject({ verdict: 'set', disposition: 'work' });
    expect(run(ask(), 'waiting_them')).toMatchObject({ verdict: 'leave', why: 'waiting_not_applied' });
    expect(run(ask({ is_urgent: true }), 'emergency')).toMatchObject({ verdict: 'set', disposition: 'emergency' });
    expect(run(ask(), 'emergency')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
  });
  it('refuses a missing ask and a value outside the list', () => {
    expect(run(null, 'no_action').verdict).toBe('refused');
    expect(run(ask(), 'ignore').verdict).toBe('refused');
  });
});
