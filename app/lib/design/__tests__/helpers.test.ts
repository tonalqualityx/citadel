import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import {
  DESIGN_WORKER_SERVICE_EMAIL,
  designActorFrom,
  designClaimHolder,
  displayHost,
  isDesignWorker,
  isDesigner,
  isUuid,
  resolveDesignActor,
  task8,
  toUsd,
} from '../helpers';
import type { AuthPayload } from '@/lib/auth/middleware';

const TASK_ID = 'A1B2C3D4-0000-4000-8000-000000000001';

function auth(over: Partial<AuthPayload> = {}): AuthPayload {
  return { userId: 'u-1', email: 'lisa@example.test', role: 'admin', via: 'session', ...over } as AuthPayload;
}

function userDb(user: { id: string; role: string; is_active: boolean } | null) {
  const findUnique = vi.fn().mockResolvedValue(user);
  return { db: { user: { findUnique } } as never, findUnique };
}

describe('isDesignWorker: email AND lane AND api key', () => {
  const rows: Array<[string, Partial<AuthPayload>, boolean]> = [
    ['service email + design-worker lane key', { email: DESIGN_WORKER_SERVICE_EMAIL, lane: 'design-worker', via: 'api_key' }, true],
    ['service email in upper case', { email: DESIGN_WORKER_SERVICE_EMAIL.toUpperCase(), lane: 'design-worker', via: 'api_key' }, true],
    ['service email, no lane (non-lane key)', { email: DESIGN_WORKER_SERVICE_EMAIL, via: 'api_key' }, false],
    ['service email, another lane', { email: DESIGN_WORKER_SERVICE_EMAIL, lane: 'oracle', via: 'api_key' }, false],
    ['service email, two lanes on one key', { email: DESIGN_WORKER_SERVICE_EMAIL, lane: 'design-worker,bast', via: 'api_key' }, false],
    ['service email, stolen session', { email: DESIGN_WORKER_SERVICE_EMAIL, lane: 'design-worker', via: 'session' }, false],
    ['other user with the lane', { email: 'bast@becomeindelible.com', lane: 'design-worker', via: 'api_key' }, false],
  ];
  for (const [name, over, expected] of rows) {
    it(`${name} -> ${expected}`, () => expect(isDesignWorker(auth(over))).toBe(expected));
  }
  it('null auth is not the worker', () => expect(isDesignWorker(null)).toBe(false));
});

describe('isDesigner / resolveDesignActor use the DATABASE role (D1)', () => {
  it('token says admin, database says designer: designer', async () => {
    const { db } = userDb({ id: 'u-1', role: 'designer', is_active: true });
    expect(await isDesigner(auth({ role: 'admin' }), db)).toBe(true);
    const actor = await resolveDesignActor(auth({ role: 'admin' }), db);
    expect(actor).toMatchObject({ userId: 'u-1', role: 'designer', via: 'session', role_source: 'db' });
  });
  it('token says designer, database says admin: admin', async () => {
    const { db } = userDb({ id: 'u-1', role: 'admin', is_active: true });
    expect(await isDesigner(auth({ role: 'designer' }), db)).toBe(false);
    expect((await resolveDesignActor(auth({ role: 'designer' }), db)).role).toBe('admin');
  });
  it('missing user: not a designer, and resolve is a 401', async () => {
    const { db } = userDb(null);
    expect(await isDesigner(auth(), db)).toBe(false);
    await expect(resolveDesignActor(auth(), db)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('inactive user: 401', async () => {
    const { db } = userDb({ id: 'u-1', role: 'designer', is_active: false });
    await expect(resolveDesignActor(auth(), db)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('carries via and lane through', async () => {
    const { db } = userDb({ id: 'u-1', role: 'tech', is_active: true });
    const actor = await resolveDesignActor(auth({ via: 'api_key', lane: 'design-worker' }), db);
    expect(actor).toMatchObject({ via: 'api_key', lane: 'design-worker', role: 'tech' });
  });
  it('designActorFrom stamps role_source', () => {
    expect(designActorFrom({ userId: 'x', role: 'pm', via: 'session' }).role_source).toBe('db');
  });
});

describe('small helpers', () => {
  it('task8 and the claim holder', () => {
    expect(task8(TASK_ID)).toBe('a1b2c3d4');
    expect(designClaimHolder(TASK_ID)).toBe('design:a1b2c3d4');
  });
  it.each([
    ['https://vcdp.pages.dev/', 'vcdp.pages.dev'],
    ['vcdp.org', 'vcdp.org'],
    ['http://localhost:3000/x', 'localhost:3000'],
    ['', null],
    [null, null],
  ])('displayHost(%s) = %s', (input, expected) => expect(displayHost(input)).toBe(expected));
  it('toUsd rounds Decimal-likes to cents', () => {
    expect(toUsd({ toString: () => '12.3456' })).toBe(12.35);
    expect(toUsd(null)).toBe(0);
    expect(toUsd('abc')).toBe(0);
  });
  it('isUuid', () => {
    expect(isUuid(TASK_ID)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
