// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import { deriveWorkState, type StateFacts } from '../state';
import { attachQuestion, attachedLine, keptOffLine, stateLine } from '../attach-copy';
import { evidenceLine } from '../evidence';
import { emailRefOfAsk, normalizeRfc, parseTargetKey, parseSourceKeyForTest } from './keys-helper';

const d = (n: number) => new Date(Date.UTC(2026, 10, n, 15));
const base: StateFacts = { type: 'task', finished: false, dropped: false, finished_at: null, started_at: d(1), looks_done: null, open_wait: null, owners: [] };

describe('deriveWorkState: done, looks done, waiting, with someone, open', () => {
  it('done beats everything', () => {
    expect(deriveWorkState({ ...base, finished: true, finished_at: d(4), looks_done: { line: 'x', at: d(3) }, open_wait: { who: 'Kelly', since: d(2) } }).state).toBe('done');
  });
  it('a dropped task is done too (it ended)', () => {
    expect(deriveWorkState({ ...base, dropped: true, finished_at: d(4) }).state).toBe('done');
  });
  it('proof the work is finished beats a wait and an owner, and carries the proof', () => {
    const r = deriveWorkState({ ...base, looks_done: { line: 'Live receipt Nov 4', at: d(4) }, open_wait: { who: 'Kelly', since: d(2) }, owners: [{ name: 'Mike Dion', user_id: 'm', since: d(1) }] });
    expect(r).toMatchObject({ state: 'looks_done', proof: 'Live receipt Nov 4' });
  });
  it('an open wait on a contact beats an owner', () => {
    const r = deriveWorkState({ ...base, open_wait: { who: 'Kelly', since: d(5) }, owners: [{ name: 'Bast', user_id: BAST_USER_ID, since: d(1) }] });
    expect(r).toMatchObject({ state: 'waiting_them', who: 'Kelly', since: d(5) });
  });
  it('an owner makes with_<name>; Bast is with_bast', () => {
    expect(deriveWorkState({ ...base, owners: [{ name: 'Bast', user_id: BAST_USER_ID, since: d(2) }] })).toMatchObject({ state: 'with_bast', who: 'Bast', since: d(2) });
    expect(deriveWorkState({ ...base, owners: [{ name: 'Sabeen Khan', user_id: 's', since: d(2) }] }).state).toBe('with_sabeen');
  });
  it('a project is with whoever holds most of its open tasks', () => {
    const r = deriveWorkState({ ...base, type: 'project', owners: [{ name: 'Bast', user_id: BAST_USER_ID, since: d(1) }, { name: 'Bast', user_id: BAST_USER_ID, since: d(3) }, { name: 'Mike Dion', user_id: 'm', since: d(9) }] });
    expect(r.state).toBe('with_bast');
    expect(r.since).toEqual(d(3));
  });
  it('nothing else is open', () => {
    expect(deriveWorkState(base)).toMatchObject({ state: 'open', since: d(1) });
  });
});

describe('the words', () => {
  it('state lines', () => {
    expect(stateLine('with_bast', { since: d(2), zone: 'America/New_York', who: 'Bast' })).toBe('With Bast since Nov 2');
    expect(stateLine('waiting_them', { since: d(5), zone: 'America/New_York', who: 'Kelly' })).toBe('Waiting on Kelly since Nov 5');
    expect(stateLine('looks_done', { since: null, proof: 'live receipt Nov 4.' })).toBe('Looks done: live receipt Nov 4. Close it?');
    expect(stateLine('done', { since: d(4), zone: 'America/New_York' })).toBe('Done Nov 4');
    expect(stateLine('open', { since: d(2), zone: 'America/New_York' })).toBe('Open since Nov 2');
  });
  it('the question names every candidate and offers a new project', () => {
    expect(attachQuestion({ kind: 'email', who: 'Ashlei', client: 'Thermalnetics', candidates: ['Thermalnetics website', 'Thermalnetics hosting'] })).toBe(
      'New email from Ashlei (Thermalnetics): add to "Thermalnetics website" or "Thermalnetics hosting", or start a new project?',
    );
    expect(attachQuestion({ kind: 'email', who: 'Ashlei', client: null, candidates: ['A', 'B', 'C'] })).toBe('New email from Ashlei: add to "A", "B" or "C", or start a new project?');
    expect(attachQuestion({ kind: 'session', who: 'Fix hosting', client: 'Thermalnetics', candidates: [] })).toContain('no live project');
  });
  it('the Handled line', () => {
    expect(attachedLine('email', 'Ashlei', 'Thermalnetics website')).toBe('Added the email from Ashlei to "Thermalnetics website".');
    expect(attachedLine('session', 'Fix hosting', 'Thermalnetics website')).toBe('Added the session "Fix hosting" to "Thermalnetics website".');
  });
  it('the measures line', () => {
    expect(keptOffLine(6)).toBe('No second to-dos: 6 kept off your list.');
  });
  it('no line carries a dash or a banned word, even from a stored title', () => {
    const lines = [
      attachQuestion({ kind: 'email', who: 'A — B', client: 'C – D', candidates: ['X — Y'] }),
      attachedLine('email', 'A — B', 'X – Y'),
      stateLine('waiting_them', { since: d(2), who: 'K — L' }),
      evidenceLine('A long — line\nwith a break'),
    ];
    for (const l of lines) {
      expect(l).not.toMatch(/[–—]/);
      expect(l).not.toMatch(/priorit|overdue/i);
    }
    expect(evidenceLine('x'.repeat(500))).toHaveLength(300);
  });
});

describe('keys', () => {
  it('parses targets and normalizes ids', () => {
    expect(parseTargetKey('task:7AA4A01A-1111-4222-8333-944445555666')).toEqual({ type: 'task', id: '7aa4a01a-1111-4222-8333-944445555666' });
    expect(parseTargetKey('project:nope')).toBeNull();
    expect(parseTargetKey('proposed')).toBeNull();
    expect(normalizeRfc(' <ABC@x.test> ')).toBe('abc@x.test');
    expect(emailRefOfAsk({ conversation_key: null, rfc_message_id: '<M@x>', message_id: 'gm1' })).toBe('m@x');
    expect(emailRefOfAsk({ conversation_key: null, rfc_message_id: null, message_id: 'gm1' })).toBe('gm1');
    expect(parseSourceKeyForTest('email:abc@x')).toEqual({ kind: 'email', ref: 'abc@x' });
    expect(parseSourceKeyForTest('nope:abc')).toBeNull();
  });
});
