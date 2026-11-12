// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { baseName, inSegment, inWindow, matchItem, namesShortId, plainTaskText, sessionCardKey, sessionRunKey, shortHash, shortIdOf, type SessionItem } from '../sessions';
import { staleVerdict, type StaleCandidateFacts } from '../stale-asks';
import { parseItemKey, buildItemKey } from '@/lib/home/item-key';
import { sessionCardTitle, NO_PROOF_MESSAGE, CLOSE_MESSAGES } from '../session-copy';

const ID = '3f2a1c9e-1111-4222-8333-444455556666';
const task = { id: ID, title: 'Hosting comparison', text: plainTaskText('Write hosting-comparison.md for the client') };
const commit = (subject: string): SessionItem => ({ kind: 'commit', ref: 'abc1234@/r', at: new Date(), cwd: '/r', subject });

describe('matching a session item to a task', () => {
  it('a commit naming the short id is strong; a title overlap of 0.5 or more is medium; anything else is nothing', () => {
    expect(shortIdOf(ID)).toBe('3f2a1c9e');
    expect(matchItem(commit('Finish 3f2a1c9e now'), task)).toBe('strong');
    expect(matchItem(commit('Hosting comparison table'), task)).toBe('medium');
    expect(matchItem(commit('Fix footer colours'), task)).toBeNull();
    expect(matchItem(commit(''), task)).toBeNull();
  });
  it('the short id must stand alone (not inside a longer hex run)', () => {
    expect(namesShortId('x 3f2a1c9e y', ID)).toBe(true);
    expect(namesShortId('deadbeef3f2a1c9ecafe', ID)).toBe(false);
  });
  it('a delivered file is strong when the task names it, medium on a name overlap', () => {
    const f = (p: string): SessionItem => ({ kind: 'delivered_file', ref: p, path: p, at: new Date(), cwd: '/r' });
    expect(matchItem(f('/r/hosting-comparison.md'), task)).toBe('strong');
    expect(matchItem(f('/r/hosting_comparison_v2.pdf'), { ...task, text: '' })).toBe('medium');
    expect(matchItem(f('/r/notes.txt'), task)).toBeNull();
    expect(baseName('/a/b/c.md')).toBe('c.md');
  });
});

describe('segments and windows', () => {
  const seg = { folders: ['/work/alpha'], repos: ['git@github.com:acme/site.git'] };
  it('an item is in a segment by folder or by repository, never by a sibling folder', () => {
    expect(inSegment({ ...commit('x'), cwd: '/work/alpha/app' }, seg)).toBe(true);
    expect(inSegment({ ...commit('x'), cwd: '/work/alphabet' }, seg)).toBe(false);
    expect(inSegment({ ...commit('x'), cwd: '/elsewhere', repo: 'https://github.com/acme/site' }, seg)).toBe(true);
    expect(inSegment({ ...commit('x'), cwd: '/work/beta' }, seg)).toBe(false);
  });
  it('the window is inclusive', () => {
    const w = { from: new Date(1000), to: new Date(2000) };
    expect(inWindow(new Date(1000), w) && inWindow(new Date(2000), w)).toBe(true);
    expect(inWindow(new Date(2001), w)).toBe(false);
  });
});

describe('keys', () => {
  it('a long session id gets a short run key, and the card key round trips', () => {
    expect(sessionRunKey('abc')).toBe('session:abc');
    expect(sessionRunKey('x'.repeat(100)).length).toBeLessThanOrEqual(80);
    const key = sessionCardKey(sessionRunKey('abc'));
    expect(key).toMatch(/^finished:s-[0-9a-f]{16}$/);
    const p = parseItemKey(key);
    expect(p).toMatchObject({ kind: 'finished', id: null });
    expect(buildItemKey(p!)).toBe(key);
    expect(shortHash('a')).not.toBe(shortHash('b'));
  });
});

describe('the stale question rule', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const base: StaleCandidateFacts = { status: 'idle', ask_severity: 'internal', asked_at: new Date('2026-11-01T00:00:00Z'), title: 'A', goal: null, waiting_on: 'Which plan?', security_task: false, already_cleared: false };
  it('clears an old idle internal question', () => expect(staleVerdict(base, now, 7)).toBe('clear'));
  it('never clears blocking or security ones, whatever else is true', () => {
    expect(staleVerdict({ ...base, ask_severity: 'client_blocking' }, now, 7)).toBe('client_blocking');
    expect(staleVerdict({ ...base, ask_severity: 'launch_blocking', status: 'ended' }, now, 7)).toBe('launch_blocking');
    expect(staleVerdict({ ...base, security_task: true }, now, 7)).toBe('security');
    expect(staleVerdict({ ...base, waiting_on: 'We were hacked, what now?' }, now, 7)).toBe('security');
    expect(staleVerdict({ ...base, goal: 'Clean up the compromise' }, now, 7)).toBe('security');
  });
  it('keeps live, new, ended and already cleared ones', () => {
    expect(staleVerdict({ ...base, status: 'running' }, now, 7)).toBe('live');
    expect(staleVerdict({ ...base, status: 'waiting' }, now, 7)).toBe('live');
    expect(staleVerdict({ ...base, status: 'ended' }, now, 7)).toBe('ended_hidden');
    expect(staleVerdict({ ...base, asked_at: new Date('2026-11-15T00:00:00Z') }, now, 7)).toBe('too_new');
    expect(staleVerdict({ ...base, already_cleared: true }, now, 7)).toBe('already_cleared');
  });
});

describe('the words', () => {
  it('say no proof plainly, with no dash and none of the banned words', () => {
    expect(NO_PROOF_MESSAGE).toBe('No proof yet. It stays open.');
    const all = [...Object.values(CLOSE_MESSAGES), sessionCardTitle([{ title: 'Hosting comparison', proof: 'commit 3f2a1c, file delivered' }])].join(' ');
    expect(all).not.toMatch(/[–—]/);
    expect(all.toLowerCase()).not.toMatch(/priorit|overdue/);
    expect(sessionCardTitle([{ title: 'Hosting comparison', proof: 'commit 3f2a1c, file delivered' }])).toBe("This session's work looks done: Hosting comparison (commit 3f2a1c, file delivered). Close it?");
  });
});
