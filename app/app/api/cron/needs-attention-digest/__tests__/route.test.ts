import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/needs-attention-digest', () => ({
  sendNeedsAttentionDigest: vi.fn(),
}));

import { POST, GET } from '../route';
import { sendNeedsAttentionDigest } from '@/lib/services/needs-attention-digest';
import type { Mock } from 'vitest';

const mockSend = sendNeedsAttentionDigest as Mock;
const originalEnv = process.env;

function createCronRequest(secret?: string, method: 'POST' | 'GET' = 'POST'): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) headers['x-cron-secret'] = secret;
  return new NextRequest('http://localhost:3000/api/cron/needs-attention-digest', {
    method,
    headers,
  });
}

const SUMMARY = {
  recipient: 'mike@becomeindelible.com',
  counts: { needsMike: 1, awaitingClarification: 0, stuck: 2, articlesAwaitingReview: 0 },
  total: 3,
};

describe('POST /api/cron/needs-attention-digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-cron-secret' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 401 with wrong secret', async () => {
    const res = await POST(createCronRequest('nope'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 401 with no secret', async () => {
    const res = await POST(createCronRequest());
    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 500 when CRON_SECRET not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(createCronRequest('anything'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Cron not configured');
  });

  it('sends the digest and returns the summary', async () => {
    mockSend.mockResolvedValue(SUMMARY);
    const res = await POST(createCronRequest('test-cron-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary).toEqual(SUMMARY);
    expect(body.duration).toBeDefined();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 500 when the digest throws', async () => {
    mockSend.mockRejectedValue(new Error('boom'));
    const res = await POST(createCronRequest('test-cron-secret'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Digest failed');
    expect(body.message).toBe('boom');
  });
});

describe('GET /api/cron/needs-attention-digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-cron-secret' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('delegates to POST', async () => {
    mockSend.mockResolvedValue(SUMMARY);
    const res = await GET(createCronRequest('test-cron-secret', 'GET'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
