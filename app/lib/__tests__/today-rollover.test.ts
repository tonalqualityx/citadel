import { describe, it, expect } from 'vitest';
import { selectPicksToCarry, type RolloverCandidate } from '@/lib/today-rollover';

function pick(over: Partial<RolloverCandidate> & { id?: string }): RolloverCandidate & { id: string } {
  return { id: 'x', item_type: 'note', completed_at: null, sort: 0, arc: null, task: null, accord: null, ...over };
}

describe('selectPicksToCarry', () => {
  it('carries unfinished picks on open arcs and live quests, in order', () => {
    const out = selectPicksToCarry([
      pick({ id: 'a', item_type: 'arc', arc: { closed_at: null, tasks: [{ status: 'done' }, { status: 'in_progress' }] } }),
      pick({ id: 't', item_type: 'task', task: { status: 'not_started' } }),
      pick({ id: 'n', item_type: 'note' }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['a', 't', 'n']);
  });

  it('drops completed picks', () => {
    expect(selectPicksToCarry([pick({ completed_at: new Date() })])).toEqual([]);
  });

  it('drops arcs that completed (all quests terminal, or explicitly closed)', () => {
    const out = selectPicksToCarry([
      pick({ id: 'done', item_type: 'arc', arc: { closed_at: null, tasks: [{ status: 'done' }, { status: 'abandoned' }] } }),
      pick({ id: 'closed', item_type: 'arc', arc: { closed_at: new Date(), tasks: [{ status: 'not_started' }] } }),
      pick({ id: 'empty', item_type: 'arc', arc: { closed_at: null, tasks: [] } }),
      pick({ id: 'gone', item_type: 'arc', arc: null }),
    ]);
    expect(out).toEqual([]);
  });

  it('drops done or abandoned quests and lost leads', () => {
    const out = selectPicksToCarry([
      pick({ item_type: 'task', task: { status: 'done' } }),
      pick({ item_type: 'task', task: { status: 'abandoned' } }),
      pick({ item_type: 'lead', accord: { status: 'lost' } }),
      pick({ id: 'live', item_type: 'lead', accord: { status: 'proposal' } }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['live']);
  });

  it('never exceeds the WIP ceiling', () => {
    const many = Array.from({ length: 8 }, (_, i) => pick({ id: String(i) }));
    expect(selectPicksToCarry(many)).toHaveLength(5);
  });
});
