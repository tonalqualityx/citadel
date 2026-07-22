import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { resolveUserTimezone } from '../user-timezone';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';

const mockFindUnique = prisma.userPreference.findUnique as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveUserTimezone', () => {
  it("returns the user's own stored timezone when set", async () => {
    mockFindUnique.mockResolvedValue({ timezone: 'Asia/Karachi' });
    const tz = await resolveUserTimezone('user-1');
    expect(tz).toBe('Asia/Karachi');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      select: { timezone: true },
    });
  });

  it('falls back to DEFAULT_DISPLAY_TIMEZONE when the user has a preferences row but no timezone set', async () => {
    mockFindUnique.mockResolvedValue({ timezone: null });
    const tz = await resolveUserTimezone('user-2');
    expect(tz).toBe(DEFAULT_DISPLAY_TIMEZONE);
  });

  it('falls back to DEFAULT_DISPLAY_TIMEZONE when the user has no preferences row at all', async () => {
    mockFindUnique.mockResolvedValue(null);
    const tz = await resolveUserTimezone('user-3');
    expect(tz).toBe(DEFAULT_DISPLAY_TIMEZONE);
  });

  it('never returns an empty string (falsy timezone values fall through to the default)', async () => {
    mockFindUnique.mockResolvedValue({ timezone: '' });
    const tz = await resolveUserTimezone('user-4');
    expect(tz).toBe(DEFAULT_DISPLAY_TIMEZONE);
  });
});
