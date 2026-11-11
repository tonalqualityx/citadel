import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { taskKey } from '../item-key';
import type { RawItemState } from '../types';
import { makeClient, makeInputs, makeState, makeTask, tonight } from './fixtures/tonight';

function runOne(task: ReturnType<typeof makeTask>, st?: Partial<RawItemState>) {
  const raw = makeInputs({ tasks: [task] });
  const states = st ? [makeState(taskKey(task.id), st)] : [];
  const sel = selectHome({ raw, states, now: raw.now });
  return sel.candidates.find((c) => c.key === taskKey(task.id))!.item;
}

describe('Slice 7c: time guesses on his screen', () => {
  it('a history guess sets the time and says where it came from', () => {
    const it = runOne(makeTask({ title: 'Renew the SSL' }), { effort_minutes: 45, effort_source: 'history', effort_basis_n: 4 });
    expect(it.minutes).toBe(45);
    expect(it.effort).toBe('About 45 minutes');
    expect(it.opened.effort_basis).toBe('Time guess: from 4 similar finished tasks.');
  });

  it('a kind guess keeps the existing 30 and says so', () => {
    const it = runOne(makeTask(), { effort_minutes: 30, effort_source: 'kind', effort_basis_n: null });
    expect(it.minutes).toBe(30);
    expect(it.opened.effort_basis).toBe('Time guess: from the kind of work.');
  });

  it('unknowns and a call join the time words', () => {
    expect(runOne(makeTask(), { effort_minutes: 45, effort_source: 'history', effort_basis_n: 3, unknowns: 'some' }).effort).toBe('About 45 minutes, some unknowns');
    expect(runOne(makeTask(), { effort_minutes: 30, effort_source: 'kind', drain: 'call' }).effort).toBe('About 30 minutes, a call');
  });

  it('a set estimate is used as it is, with no basis line', () => {
    const it = runOne(makeTask({ estimated_minutes: 20 }), { effort_minutes: 90, effort_source: 'history', effort_basis_n: 5 });
    expect(it.minutes).toBe(20);
    expect(it.opened.effort_basis).toBeUndefined();
  });

  it('a non-default mystery or battery is never shadowed: no guessed minutes, no unknowns or drain word for it', () => {
    const m = runOne(makeTask({ mystery_factor: 'significant' }), { effort_minutes: 90, effort_source: 'history', effort_basis_n: 5, unknowns: 'many' });
    expect(m.minutes).toBe(30);
    expect(m.effort).toBe('About 30 minutes');
    expect(m.opened.effort_basis).toBeUndefined();
    const b = runOne(makeTask({ battery_impact: 'high_drain' }), { effort_minutes: 90, effort_source: 'history', effort_basis_n: 5, drain: 'call' });
    expect(b.minutes).toBe(30);
    expect(b.effort).toBe('About 30 minutes');
  });

  it('an energy guess changes nothing and shows no line; a kind guess is not shown when an energy estimate exists', () => {
    const e = runOne(makeTask({ energy_estimate: 3 }), { effort_minutes: 20, effort_source: 'energy' });
    expect(e.opened.effort_basis).toBeUndefined();
    const k = runOne(makeTask({ energy_estimate: 3 }), { effort_minutes: 30, effort_source: 'kind' });
    expect(k.opened.effort_basis).toBeUndefined();
  });

  it('a bot task keeps its time words', () => {
    const it = runOne(makeTask({ bot_task: true, tags: ['needs-mike'], client: makeClient('Bot Client') }), { effort_minutes: 45, effort_source: 'history', effort_basis_n: 3, unknowns: 'many' });
    expect(it.minutes).toBe(30);
    expect(it.effort).toBe('About 30 minutes');
    expect(it.opened.effort_basis).toBeUndefined();
  });

  it('with no guesses stored the whole selection is deep-equal to today (tonight fixture, null guess fields)', () => {
    const { raw, states, now } = tonight();
    const plain = selectHome({ raw, states, now });
    const nulls = selectHome({
      raw,
      states: states.map((s) => ({ ...s, effort_minutes: null, effort_source: null, effort_basis_n: null, unknowns: null, drain: null })),
      now,
    });
    expect(nulls.sections).toEqual(plain.sections);
    expect(nulls.candidates.map((c) => [c.key, c.minutes])).toEqual(plain.candidates.map((c) => [c.key, c.minutes]));
    expect(JSON.stringify(nulls.sections)).not.toContain('Time guess');
  });
});
