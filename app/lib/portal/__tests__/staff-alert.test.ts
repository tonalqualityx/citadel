import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: { task: { findUnique: vi.fn() } } }));
vi.mock('@/lib/services/notifications', () => ({ createNotification: vi.fn(async () => ({})) }));

import { prisma } from '@/lib/db/prisma';
import { createNotification } from '@/lib/services/notifications';
import { alertTaskOwner } from '../staff-alert';

const TASK = '14d1ef50-0000-4000-8000-000000000000';

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.task.findUnique as Mock).mockResolvedValue({ assignee_id: 'mike' });
});

describe('alertTaskOwner', () => {
  it('carries the task as its click target (the no_access alert opens the task)', async () => {
    await alertTaskOwner(TASK, 'A client reply was not emailed', 'body');
    expect((createNotification as Mock).mock.calls[0][0]).toMatchObject({ userId: 'mike', type: 'system_alert', entityType: 'task', entityId: TASK });
  });
});
