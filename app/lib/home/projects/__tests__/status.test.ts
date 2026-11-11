import { describe, it, expect } from 'vitest';
import { projectStatus } from '../status';
import type { ProjectCardLike, StatusInput } from '../types';

const TZ = 'America/New_York';
const NOW = new Date('2026-11-11T15:00:00Z'); // Wednesday
const ME = 'user-mike';
const mike = { name: 'Mike', is_mike: true };

function card(over: Partial<ProjectCardLike> = {}): NonNullable<StatusInput['card']> {
  return {
    blockers: [],
    next_step: { text: 'Mike, send the file', owner: { id: ME, name: 'Mike' }, owner_label: null, source: 'bast', at: '2026-11-11T08:00:00Z' },
    last_movement: null,
    stale: false,
    ...over,
  };
}
const b = (kind: string, since: string, owner = mike) => ({ kind, owner, since });
const input = (over: Partial<StatusInput> = {}): StatusInput => ({ now: NOW, timeZone: TZ, userId: ME, needsNow: 0, card: card(), waits: [], ...over });

describe('projectStatus: the six live shapes', () => {
  it('Figma Library on Sabeen: waiting on the next step owner, no date', () => {
    const c = card({ next_step: { text: 'Sabeen to finish the library', owner: null, owner_label: 'Sabeen', source: 'bast', at: null }, last_movement: { at: '2026-11-10T12:00:00Z', who: 'Sabeen', what: 'x' } });
    expect(projectStatus(input({ card: c }))).toBe('Waiting on Sabeen.');
  });

  it('Jack, 21 days quiet: says quiet, not moving', () => {
    const c = card({
      stale: true,
      blockers: [b('stale', '2026-10-21T12:00:00Z')],
      last_movement: { at: '2026-10-21T12:00:00Z', who: 'Bast', what: 'x' },
    });
    expect(projectStatus(input({ card: c }))).toBe('Quiet. Last change 21 days ago by Bast.');
  });

  it('VCDP: 39 reviews, 13 client emails and 2 mentions fold to one sentence with the earliest date', () => {
    const blockers = [
      ...Array.from({ length: 39 }, (_, i) => b('review', `2026-10-${String(20 + (i % 5)).padStart(2, '0')}T12:00:00Z`)),
      ...Array.from({ length: 13 }, () => b('client_email', '2026-11-02T12:00:00Z')),
      b('mention', '2026-11-05T12:00:00Z'),
      b('mention', '2026-11-06T12:00:00Z'),
    ];
    expect(projectStatus(input({ card: card({ blockers }) }))).toBe(
      'Waiting on you since October 20 (22 days): a sign-off, 13 client emails and 2 mentions.',
    );
  });

  it('waiting on a client contact from an open wait, with the weekday inside two weeks', () => {
    const now = new Date('2026-11-09T15:00:00Z');
    const s = projectStatus(input({ now, waits: [{ who: 'Andy (client)', since: '2026-11-03T14:00:00Z', title: 'Logo files' }] }));
    expect(s).toBe('Waiting on Andy (client) since Tuesday, November 3 (6 days).');
  });

  it('moving: last change 3 days ago by Bast', () => {
    const c = card({ last_movement: { at: '2026-11-08T15:00:00Z', who: 'Bast', what: 'x' } });
    expect(projectStatus(input({ card: c }))).toBe('Moving. Last change 3 days ago by Bast.');
  });

  it('needs you now beats everything else', () => {
    const c = card({ blockers: [b('review', '2026-10-20T12:00:00Z')] });
    expect(projectStatus(input({ needsNow: 3, card: c }))).toBe('3 things here need you now.');
    expect(projectStatus(input({ needsNow: 1, card: c }))).toBe('1 thing here needs you now.');
  });
});

describe('projectStatus: order and edges', () => {
  it('waiting on him beats waiting on someone else', () => {
    const c = card({ blockers: [b('decision', '2026-11-10T12:00:00Z')] });
    const s = projectStatus(input({ card: c, waits: [{ who: 'Andy (client)', since: '2026-11-01T12:00:00Z', title: 't' }] }));
    expect(s).toBe('Waiting on you since Tuesday, November 10 (1 day): 1 decision.');
  });
  it('stale blockers are not asks of him', () => {
    const c = card({ blockers: [b('stale', '2026-10-01T12:00:00Z')], last_movement: { at: '2026-11-11T12:00:00Z', who: 'Mike', what: 'x' } });
    expect(projectStatus(input({ card: c }))).toBe('Moving. Last change today by Mike.');
  });
  it('a blocker held by someone else counts as waiting on them', () => {
    const c = card({ blockers: [b('someone_else', '2026-11-04T12:00:00Z', { name: 'Lisa', is_mike: false })] });
    expect(projectStatus(input({ card: c }))).toBe('Waiting on Lisa since Wednesday, November 4 (7 days).');
  });
  it('the earliest clock among waits and blockers wins', () => {
    const c = card({ blockers: [b('someone_else', '2026-11-04T12:00:00Z', { name: 'Lisa', is_mike: false })] });
    const s = projectStatus(input({ card: c, waits: [{ who: 'Andy (client)', since: '2026-11-02T12:00:00Z', title: 't' }] }));
    expect(s).toBe('Waiting on Andy (client) since Monday, November 2 (9 days).');
  });
  it('a project missing from the Oracle list gets a sentence only from his items or the waits', () => {
    expect(projectStatus(input({ card: null }))).toBeNull();
    expect(projectStatus(input({ card: null, needsNow: 2 }))).toBe('2 things here need you now.');
    expect(projectStatus(input({ card: null, waits: [{ who: 'Andy (client)', since: '2026-11-09T12:00:00Z', title: 't' }] }))).toBe(
      'Waiting on Andy (client) since Monday, November 9 (2 days).',
    );
  });
  it('a next step that is mine does not make it a wait on someone else', () => {
    expect(projectStatus(input({ card: card() }))).toBeNull();
  });
  it('a clock that started today says today', () => {
    const c = card({ blockers: [b('review', '2026-11-11T13:00:00Z')] });
    expect(projectStatus(input({ card: c }))).toBe('Waiting on you since today: a sign-off.');
  });
  it('never writes a dash or a banned word', () => {
    const c = card({ blockers: [b('review', '2026-10-20T12:00:00Z'), b('client_email', '2026-10-21T12:00:00Z')] });
    const s = projectStatus(input({ card: c })) ?? '';
    expect(s).not.toMatch(/[–—]|priorit|overdue/i);
  });
});
