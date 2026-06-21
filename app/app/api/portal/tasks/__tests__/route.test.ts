import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/portal', () => ({
  validateTaskToken: vi.fn(),
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '192.168.1.1'),
}));

import { GET } from '../[token]/route';
import { validateTaskToken, logPortalSession } from '@/lib/services/portal';
import type { Mock } from 'vitest';

const mockValidateTaskToken = validateTaskToken as Mock;
const mockLogPortalSession = logPortalSession as Mock;

const mockPortalTask = {
  id: 'task-123',
  title: 'Homepage refresh',
  description: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Updated hero copy.' }] },
  ],
  status: 'review',
  estimated_minutes: 90,
  staging_preview_url: 'https://staging.example.com/preview',
  staging_deployed_at: new Date('2026-06-21T10:00:00Z'),
  client_approved_at: null,
  is_deleted: false,
  portal_token: 'valid-token-123',
  portal_token_expires_at: new Date(Date.now() + 86400000),
  comments: [
    {
      id: 'c1',
      content: 'Ready for your review.',
      is_internal: false,
      created_at: new Date('2026-06-21T11:00:00Z'),
      user: { id: 'u1', name: 'Bast' },
    },
  ],
};

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), options as any);
}

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe('GET /api/portal/tasks/:token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the client-projected task and preview for a valid token', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.id).toBe('task-123');
    expect(data.task.title).toBe('Homepage refresh');
    expect(data.task.status).toBe('review');
    expect(data.task.estimated_minutes).toBe(90);
    expect(data.task.comments).toHaveLength(1);
    expect(data.task.comments[0].content).toBe('Ready for your review.');
    expect(data.task.comments[0].author_name).toBe('Bast');
    expect(data.staging_preview_url).toBe('https://staging.example.com/preview');
    expect(data.already_approved).toBe(false);
    expect(mockValidateTaskToken).toHaveBeenCalledWith('valid-token');
  });

  it('does not leak internal task fields through the projection', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    // is_deleted / portal_token are internal; the projection must not expose them
    expect(data.task.is_deleted).toBeUndefined();
    expect(data.task.portal_token).toBeUndefined();
  });

  it('reports already_approved when the task has a client approval timestamp', async () => {
    mockValidateTaskToken.mockResolvedValue({
      ...mockPortalTask,
      client_approved_at: new Date('2026-06-20T09:00:00Z'),
    });

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.already_approved).toBe(true);
  });

  it('returns 404 for an invalid/expired token', async () => {
    mockValidateTaskToken.mockResolvedValue(null);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/bad-token'), makeParams('bad-token'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Approval link not found or has expired');
  });

  it('logs a task_approval view session on success', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));

    expect(mockLogPortalSession).toHaveBeenCalledWith({
      tokenType: 'task_approval',
      entityId: 'task-123',
      ipAddress: '192.168.1.1',
      userAgent: null,
      action: 'view',
    });
  });
});
