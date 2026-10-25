import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Whole-database import and export answer a signed-in admin only, never an admin API key.
vi.mock('@/lib/auth/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/services/database-backup', () => ({
  truncateTables: vi.fn(),
  importSql: vi.fn(),
  exportTables: vi.fn(),
  TABLE_GROUPS: {},
}));

import { requireAuth } from '@/lib/auth/middleware';
import { importSql, exportTables } from '@/lib/services/database-backup';
import { POST as importPost } from '../import/route';
import { POST as exportPost } from '../export/route';

const auth = requireAuth as Mock;
const ADMIN_KEY = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'api_key', apiKeyId: 'k-admin' };
const ADMIN_SESSION = { userId: 'admin-1', email: 'mike@example.test', role: 'admin', via: 'session' };

beforeEach(() => vi.clearAllMocks());

describe('admin database routes', () => {
  it('refuses import from an admin API key before reading the upload', async () => {
    auth.mockResolvedValue(ADMIN_KEY);
    const res = await importPost(new NextRequest('http://localhost:3000/api/admin/database/import', { method: 'POST', body: new FormData() }));
    expect(res.status).toBe(403);
    expect(importSql).not.toHaveBeenCalled();
  });

  it('refuses export from an admin API key', async () => {
    auth.mockResolvedValue(ADMIN_KEY);
    const res = await exportPost(new NextRequest('http://localhost:3000/api/admin/database/export', { method: 'POST', body: JSON.stringify({ groups: [] }) }));
    expect(res.status).toBe(403);
    expect(exportTables).not.toHaveBeenCalled();
  });

  it('lets a signed-in admin past the session check', async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const res = await importPost(new NextRequest('http://localhost:3000/api/admin/database/import', { method: 'POST', body: new FormData() }));
    expect(res.status).not.toBe(403);
  });
});
