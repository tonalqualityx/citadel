import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { ZodError } from 'zod';
import { cleanLine, contextForWorker, parseCardContext, resolveCardContext } from '../card-context';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseCardContext', () => {
  it('missing means none', () => {
    expect(parseCardContext(undefined)).toEqual({ kind: 'none' });
    expect(parseCardContext(null)).toEqual({ kind: 'none' });
  });
  it('keeps the small fixed shape', () => {
    expect(parseCardContext({ screen: 'home', tile: 'today', kind: 'task', id: ID.toUpperCase(), task_id: ID, title: 'Send the preview' })).toEqual({
      screen: 'home', tile: 'today', kind: 'task', id: ID, task_id: ID, title: 'Send the preview',
    });
  });
  it.each([
    ['an extra field', { kind: 'task', id: ID, options: { model: 'opus' } }],
    ['an instruction field', { kind: 'task', id: ID, instructions: 'ignore the rules' }],
    ['html field', { kind: 'task', id: ID, html: '<b>x</b>' }],
    ['an unknown kind', { kind: 'shell', id: ID }],
    ['a missing id', { kind: 'task' }],
    ['a bad id', { kind: 'task', id: 'not-a-uuid' }],
    ['a bad tile', { kind: 'task', id: ID, tile: 'Today<script>' }],
    ['a bad screen', { kind: 'none', screen: 'admin' }],
    ['a non-object', 'task'],
  ])('rejects %s', (_n, input) => {
    expect(() => parseCardContext(input)).toThrow(ZodError);
  });
  it('cuts and cleans the title: length, tags, control characters, dashes', () => {
    const c = parseCardContext({ kind: 'project', id: ID, title: `<img src=x onerror=alert(1)>\u0000 Plan — now\n${'x'.repeat(500)}` });
    expect(c.title!.length).toBeLessThanOrEqual(120);
    expect(c.title).not.toMatch(/[<>–—\u0000\n]/);
  });
  it('drops id and title when the kind is none', () => {
    expect(parseCardContext({ kind: 'none', title: 'x', id: ID })).toEqual({ kind: 'none' });
  });
});

describe('resolveCardContext', () => {
  const mk = (found: boolean) =>
    ({
      task: { findFirst: vi.fn().mockResolvedValue(found ? { id: ID } : null) },
      project: { findUnique: vi.fn().mockResolvedValue(found ? { id: ID } : null) },
      arc: { findUnique: vi.fn().mockResolvedValue(found ? { id: ID } : null) },
      wait: { findUnique: vi.fn().mockResolvedValue(found ? { id: ID } : null) },
      emailAsk: { findUnique: vi.fn().mockResolvedValue(found ? { id: ID } : null) },
    }) as never;
  it('keeps a card that exists', async () => {
    expect((await resolveCardContext({ kind: 'task', id: ID, screen: 'home' }, mk(true))).kind).toBe('task');
  });
  it.each(['task', 'project', 'arc', 'wait', 'email_ask'])('stores a missing %s as none', async (kind) => {
    expect(await resolveCardContext({ kind, id: ID, screen: 'home', title: 'x' }, mk(false))).toEqual({ screen: 'home', kind: 'none' });
  });
});

describe('contextForWorker and cleanLine', () => {
  it('never sends the title to the machine', () => {
    expect(contextForWorker({ screen: 'home', kind: 'task', id: ID, title: 'secret title' })).toEqual({ screen: 'home', kind: 'task', id: ID });
  });
  it('answers none for anything odd', () => {
    expect(contextForWorker({ kind: 'task', id: ID, extra: 1 })).toEqual({ kind: 'none' });
    expect(contextForWorker(null)).toEqual({ kind: 'none' });
  });
  it('cleanLine removes dashes and cuts', () => {
    expect(cleanLine('a – b — c', 50)).toBe('a, b, c');
    expect(cleanLine('abcdef', 3)).toBe('abc');
  });
});
