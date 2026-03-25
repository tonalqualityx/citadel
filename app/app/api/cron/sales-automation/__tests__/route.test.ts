import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the sales automation service
vi.mock('@/lib/services/sales-automation', () => ({
  evaluateTimeBasedRules: vi.fn(),
}));

import { POST, GET } from '../route';
import { evaluateTimeBasedRules } from '@/lib/services/sales-automation';
import type { Mock } from 'vitest';

const mockEvaluateTimeBasedRules = evaluateTimeBasedRules as Mock;

const originalEnv = process.env;

function createCronRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) {
    headers['x-cron-secret'] = secret;
  }
  return new NextRequest('http://localhost:3000/api/cron/sales-automation', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/cron/sales-automation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-cron-secret' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 401 without valid cron secret', async () => {
    const request = createCronRequest('wrong-secret');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when no secret provided', async () => {
    const request = createCronRequest();
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 500 when CRON_SECRET not set', async () => {
    delete process.env.CRON_SECRET;

    const request = createCronRequest('any-secret');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Cron not configured');
  });

  it('calls evaluateTimeBasedRules and returns summary', async () => {
    const mockSummary = {
      rulesEvaluated: 3,
      accordsChecked: 10,
      tasksFired: 2,
      errors: [],
    };
    mockEvaluateTimeBasedRules.mockResolvedValue(mockSummary);

    const request = createCronRequest('test-cron-secret');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary).toEqual(mockSummary);
    expect(body.duration).toBeDefined();
    expect(mockEvaluateTimeBasedRules).toHaveBeenCalledOnce();
  });

  it('returns 500 when evaluateTimeBasedRules throws', async () => {
    mockEvaluateTimeBasedRules.mockRejectedValue(new Error('Database connection failed'));

    const request = createCronRequest('test-cron-secret');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Automation failed');
    expect(body.message).toBe('Database connection failed');
  });
});

describe('GET /api/cron/sales-automation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-cron-secret' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('delegates to POST handler', async () => {
    const mockSummary = {
      rulesEvaluated: 1,
      accordsChecked: 5,
      tasksFired: 0,
      errors: [],
    };
    mockEvaluateTimeBasedRules.mockResolvedValue(mockSummary);

    const request = new NextRequest('http://localhost:3000/api/cron/sales-automation', {
      method: 'GET',
      headers: { 'x-cron-secret': 'test-cron-secret' },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary).toEqual(mockSummary);
    expect(mockEvaluateTimeBasedRules).toHaveBeenCalledOnce();
  });
});
