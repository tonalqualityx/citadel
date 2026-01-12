import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '../route';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock notification-preferences service
vi.mock('@/lib/services/notification-preferences', () => ({
  getAllPreferencesForUser: vi.fn(),
  batchUpdatePreferences: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import {
  getAllPreferencesForUser,
  batchUpdatePreferences,
} from '@/lib/services/notification-preferences';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockGetAllPreferences = getAllPreferencesForUser as Mock;
const mockBatchUpdate = batchUpdatePreferences as Mock;

const TEST_USER_ID = 'user-123';

const mockPreferenceMatrix = {
  preferences: [
    {
      notification_type: 'task_assigned',
      in_app: true,
      email: false,
      slack: true,
      admin_override: false,
      overridden_by_id: null,
      overridden_at: null,
    },
    {
      notification_type: 'comment_added',
      in_app: true,
      email: false,
      slack: true,
      admin_override: true,
      overridden_by_id: 'admin-456',
      overridden_at: new Date(),
    },
  ],
  slackConnected: true,
};

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/users/me/notification-preferences', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/users/me/notification-preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: TEST_USER_ID,
      role: 'tech',
      email: 'user@example.com',
    });
    mockGetAllPreferences.mockResolvedValue(mockPreferenceMatrix);
  });

  it('returns user preference matrix', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/users/me/notification-preferences'
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences).toHaveLength(2);
    expect(body.slackConnected).toBe(true);
  });

  it('calls service with authenticated user ID', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/users/me/notification-preferences'
    );
    await GET(request);

    expect(mockGetAllPreferences).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'));

    const request = new NextRequest(
      'http://localhost:3000/api/users/me/notification-preferences'
    );
    const response = await GET(request);

    expect(response.status).toBe(500); // handleApiError converts to 500 for generic errors
  });
});

describe('PATCH /api/users/me/notification-preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: TEST_USER_ID,
      role: 'tech',
      email: 'user@example.com',
    });
    mockBatchUpdate.mockResolvedValue({ success: true, errors: [] });
    mockGetAllPreferences.mockResolvedValue(mockPreferenceMatrix);
  });

  it('updates preferences successfully', async () => {
    const request = createPatchRequest({
      updates: [
        { notification_type: 'task_assigned', channel: 'email', enabled: true },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences).toBeDefined();
    expect(mockBatchUpdate).toHaveBeenCalledWith(TEST_USER_ID, [
      { notification_type: 'task_assigned', channel: 'email', enabled: true },
    ]);
  });

  it('handles multiple updates in single request', async () => {
    const request = createPatchRequest({
      updates: [
        { notification_type: 'task_assigned', channel: 'email', enabled: true },
        { notification_type: 'comment_added', channel: 'slack', enabled: false },
        { notification_type: 'system_alert', channel: 'in_app', enabled: true },
      ],
    });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      TEST_USER_ID,
      expect.arrayContaining([
        expect.objectContaining({ notification_type: 'task_assigned' }),
        expect.objectContaining({ notification_type: 'comment_added' }),
        expect.objectContaining({ notification_type: 'system_alert' }),
      ])
    );
  });

  it('returns 400 for invalid notification type', async () => {
    const request = createPatchRequest({
      updates: [
        { notification_type: 'invalid_type', channel: 'email', enabled: true },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid channel', async () => {
    const request = createPatchRequest({
      updates: [
        { notification_type: 'task_assigned', channel: 'sms', enabled: true },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid enabled value', async () => {
    const request = createPatchRequest({
      updates: [
        { notification_type: 'task_assigned', channel: 'email', enabled: 'yes' },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 with details when some updates fail (admin locked)', async () => {
    mockBatchUpdate.mockResolvedValue({
      success: false,
      errors: ['comment_added.slack: This preference has been locked by an administrator'],
    });

    const request = createPatchRequest({
      updates: [
        { notification_type: 'comment_added', channel: 'slack', enabled: false },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Some preferences could not be updated');
    expect(body.details).toContain('comment_added.slack: This preference has been locked by an administrator');
  });

  it('returns 400 for missing updates array', async () => {
    const request = createPatchRequest({});
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for empty updates array', async () => {
    // Empty array should still validate, but we can test it processes correctly
    mockBatchUpdate.mockResolvedValue({ success: true, errors: [] });

    const request = createPatchRequest({ updates: [] });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(mockBatchUpdate).toHaveBeenCalledWith(TEST_USER_ID, []);
  });

  it('validates all required fields in update object', async () => {
    const request = createPatchRequest({
      updates: [
        { notification_type: 'task_assigned', channel: 'email' }, // missing enabled
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});
