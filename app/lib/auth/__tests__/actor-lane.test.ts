import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Fleet item 6: activity rows carry the writing key's lane, stamped on the server.
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { activityLog: { create: vi.fn() }, apiKey: { findFirst: vi.fn() } },
}));

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '../api-keys';
import { currentActorLane, rememberKeyLane, resetActorLaneCache } from '../actor-lane';
import { logActivity } from '@/lib/services/activity';

const create = prisma.activityLog.create as Mock;
const findKey = prisma.apiKey.findFirst as Mock;

function as(bearer: string | null, cookie: string | null = null) {
  (headers as Mock).mockResolvedValue({ get: (n: string) => (n === 'authorization' && bearer ? `Bearer ${bearer}` : null) });
  (cookies as Mock).mockResolvedValue({ get: (n: string) => (n === 'access_token' && cookie ? { value: cookie } : undefined) });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetActorLaneCache();
  create.mockResolvedValue({});
});

describe('currentActorLane', () => {
  it('null without a bearer, with a session cookie, or outside a request', async () => {
    as(null);
    expect(await currentActorLane()).toBeNull();
    rememberKeyLane(hashApiKey('citadel_fake_a'), 'courier');
    as('citadel_fake_a', 'jwt');
    expect(await currentActorLane()).toBeNull();
    (headers as Mock).mockRejectedValue(new Error('no request'));
    expect(await currentActorLane()).toBeNull();
  });

  it('reads the cached lane, then the key row, and never trusts anything else', async () => {
    rememberKeyLane(hashApiKey('citadel_fake_a'), 'courier');
    as('citadel_fake_a');
    expect(await currentActorLane()).toBe('courier');
    findKey.mockResolvedValue({ scopes: ['engine'] });
    as('citadel_fake_engine');
    expect(await currentActorLane()).toBeNull();
    findKey.mockResolvedValue(null);
    as('citadel_fake_unknown');
    expect(await currentActorLane()).toBeNull();
  });

  it('a failed key lookup is null, not an error', async () => {
    findKey.mockRejectedValue(new Error('db down'));
    as('citadel_fake_b');
    expect(await currentActorLane()).toBeNull();
  });
});

describe('logActivity stamps actor_lane', () => {
  it('with a lane key', async () => {
    rememberKeyLane(hashApiKey('citadel_fake_q'), 'qbo');
    as('citadel_fake_q');
    await logActivity({ userId: 'u', action: 'updated', entityType: 'client', entityId: 'c', entityName: 'C' });
    expect(create.mock.calls[0][0].data).toMatchObject({ actor_lane: 'qbo', user_id: 'u' });
  });

  it('without one', async () => {
    as(null, 'jwt');
    await logActivity({ userId: 'u', action: 'updated', entityType: 'client', entityId: 'c', entityName: 'C' });
    expect(create.mock.calls[0][0].data).not.toHaveProperty('actor_lane');
  });
});
