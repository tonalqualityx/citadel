import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrefFind = vi.fn();
const mockNotifFind = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: { findUnique: (...a: unknown[]) => mockPrefFind(...a) },
    notification: { findUnique: (...a: unknown[]) => mockNotifFind(...a) },
  },
}));

const mockDispatch = vi.fn();
vi.mock('../notification-dispatcher', () => ({
  dispatchNotification: (...a: unknown[]) => mockDispatch(...a),
}));

import { createNotification } from '../notifications';

const HOME_USER = '22222222-2222-4222-8222-222222222222';
const BAST = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';
const HUMAN = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ inApp: { notificationId: 'n1' } });
  mockNotifFind.mockResolvedValue({ id: 'n1' });
});

describe('createNotification bot mention mute', () => {
  it('muted: home user plus bot actor creates nothing and dispatches nothing', async () => {
    mockPrefFind.mockResolvedValue({ home_view: 'home' });
    const result = await createNotification({
      userId: HOME_USER,
      type: 'task_mentioned',
      title: 't',
      actorUserId: BAST,
    });
    expect(result).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('not muted: home user plus human actor', async () => {
    mockPrefFind.mockResolvedValue({ home_view: 'home' });
    await createNotification({ userId: HOME_USER, type: 'task_mentioned', title: 't', actorUserId: HUMAN });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('not muted: overlook user plus bot actor', async () => {
    mockPrefFind.mockResolvedValue({ home_view: 'overlook' });
    await createNotification({ userId: HOME_USER, type: 'task_mentioned', title: 't', actorUserId: BAST });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('not muted: user with no preference row', async () => {
    mockPrefFind.mockResolvedValue(null);
    await createNotification({ userId: HOME_USER, type: 'task_mentioned', title: 't', actorUserId: BAST });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('not muted: comment_added from a bot, and no preference lookup', async () => {
    mockPrefFind.mockResolvedValue({ home_view: 'home' });
    await createNotification({ userId: HOME_USER, type: 'comment_added', title: 't', actorUserId: BAST });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockPrefFind).not.toHaveBeenCalled();
  });

  it('not muted: no actor given', async () => {
    mockPrefFind.mockResolvedValue({ home_view: 'home' });
    await createNotification({ userId: HOME_USER, type: 'task_mentioned', title: 't' });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});
