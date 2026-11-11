// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { resolveRuleItem, ruleBodySchema, saveNotEmergencyRule, watchBodySchema } from '../store';

const TASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-11T15:00:00Z');

// A db that fails the test on any call: a task must be refused before anything is read or written.
const trap = new Proxy({}, { get: () => { throw new Error('db touched'); } }) as unknown as PrismaClient;

describe('rule store without a database', () => {
  it('a task item is refused before any read or write', async () => {
    await expect(resolveRuleItem(trap, `task:${TASK}`)).rejects.toMatchObject({ statusCode: 400, message: 'A security flag is never turned into a rule.' });
    await expect(saveNotEmergencyRule(trap, 'u', { item_key: `task:${TASK}`, scope: 'sender' }, NOW)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('other item kinds are 400 too', async () => {
    for (const k of [`wait:${TASK}`, 'session:abc', 'review:none', 'thread:a@b.com:t', 'site:not-a-uuid', 'junk', 'x:y']) {
      await expect(resolveRuleItem(trap, k)).rejects.toMatchObject({ statusCode: 400 });
    }
  });
  it('the body schema is strict and caps the reason at 300', () => {
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'sender', reason: 'x'.repeat(300) }).success).toBe(true);
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'sender', reason: 'x'.repeat(301) }).success).toBe(false);
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'sender', user_id: 'u' }).success).toBe(false);
    expect(ruleBodySchema.safeParse({ item_key: 'crisis:x', scope: 'anyone' }).success).toBe(false);
  });
});

describe('watch body schema', () => {
  it('defaults kuma to null and checks to none, and refuses extra fields', () => {
    expect(watchBodySchema.parse({})).toEqual({ kuma: null, checks: [] });
    expect(watchBodySchema.safeParse({ user_id: 'u' }).success).toBe(false);
    expect(watchBodySchema.safeParse({ kuma: [{ monitor: 'm', domain: 'a.com', started: '2026-11-11T14:00:00Z', extra: 1 }] }).success).toBe(false);
  });
});
