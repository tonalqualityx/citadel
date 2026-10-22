import { describe, it, expect, vi, beforeEach } from 'vitest';

const { count, aggregate } = vi.hoisted(() => ({ count: vi.fn(), aggregate: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { portalAttachment: { count, aggregate, create: vi.fn(async () => ({ id: 'a' })) } } }));
vi.mock('@/lib/services/private-storage', () => ({ putPrivate: vi.fn(), storageKey: () => 'k' }));
vi.mock('@/lib/portal/thread', () => ({ threadTaskWhere: () => ({}) }));

import { stageUpload } from '../upload-service';
import { MAX_UPLOADS_PER_CONTACT_DAY, MAX_UPLOADS_PER_CONTACT_HOUR } from '@/lib/services/uploads';

const access = { clientId: 'c', contactId: 'p', role: 'owner', revoked: false } as never;
// A tiny valid PNG header is enough for the magic-byte sniff.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const input = { buffer: PNG, name: 'a.png', intake_id: '11111111-1111-4111-8111-111111111111' };

beforeEach(() => {
  count.mockReset();
  aggregate.mockReset().mockResolvedValue({ _sum: { size_bytes: 0 } });
});

describe('upload limits', () => {
  it('is 30 an hour and 60 a day', () => {
    expect([MAX_UPLOADS_PER_CONTACT_HOUR, MAX_UPLOADS_PER_CONTACT_DAY]).toEqual([30, 60]);
  });
  it('429s at the hourly cap and names it', async () => {
    count.mockResolvedValueOnce(10).mockResolvedValueOnce(MAX_UPLOADS_PER_CONTACT_HOUR);
    await expect(stageUpload(access, input)).rejects.toMatchObject({ statusCode: 429, limit: 'uploads_per_hour' });
  });
  it('429s at the daily cap and names it', async () => {
    count.mockResolvedValueOnce(MAX_UPLOADS_PER_CONTACT_DAY).mockResolvedValueOnce(5);
    await expect(stageUpload(access, input)).rejects.toMatchObject({ statusCode: 429, limit: 'uploads_per_day' });
  });
});
