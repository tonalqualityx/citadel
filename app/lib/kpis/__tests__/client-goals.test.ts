import { describe, it, expect } from 'vitest';
import { toClientGoal } from '../client-goals';

const base = { metric: 'sessions', label: 'More visits to the site', direction: 'up', target_value: 1500, target_by: new Date('2027-03-31T00:00:00Z'), last_value: null };

describe('toClientGoal: the allow-list in client words', () => {
  it('projects exactly label, target_text, direction and last_text', () => {
    const g = toClientGoal({ ...base, last_value: 1200 });
    expect(Object.keys(g).sort()).toEqual(['direction', 'label', 'last_text', 'target_text']);
    expect(g).toEqual({ label: 'More visits to the site', target_text: 'Reach 1,500 by Mar 31, 2027', direction: 'up', last_text: 'Now 1,200' });
  });
  it('last_text is null until there is a reading', () => {
    expect(toClientGoal(base).last_text).toBeNull();
  });
  it('words a down goal, a goal with no target, uptime, revenue and rank', () => {
    expect(toClientGoal({ ...base, direction: 'down', target_value: 40, target_by: null }).target_text).toBe('Bring it down to 40');
    expect(toClientGoal({ ...base, target_value: null, target_by: null }).target_text).toBe('Keep it growing');
    expect(toClientGoal({ ...base, direction: 'down', target_value: null, target_by: null }).target_text).toBe('Bring it down');
    expect(toClientGoal({ ...base, metric: 'uptime', target_value: 99.9, target_by: null }).target_text).toBe('Reach 99.9%');
    expect(toClientGoal({ ...base, metric: 'revenue', target_value: 12000, target_by: null }).target_text).toBe('Reach $12,000');
    expect(toClientGoal({ ...base, metric: 'rank:septic', target_value: 3, target_by: null, last_value: 7 })).toMatchObject({
      target_text: 'Reach position 3 or better',
      last_text: 'Now position 7',
    });
  });
  it('never carries a source name', () => {
    const json = JSON.stringify(toClientGoal({ ...base, last_value: 5 }));
    expect(json).not.toMatch(/ga4|gsc|kuma|manual|baseline|status|confirmed/i);
  });
});
