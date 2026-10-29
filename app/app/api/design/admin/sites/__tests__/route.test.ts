import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { signIn, anonymous, SITE_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    site: { findMany: vi.fn() },
    designPortalSettings: { findUnique: vi.fn() },
    designWorkerState: { findUnique: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.site.findMany as Mock).mockResolvedValue([
    { id: SITE_ID, name: 'VCDP', url: 'https://vcdp.org', design_portal_enabled: true, designer_publish: true, design_auto_timer: true },
  ]);
  (prisma.designPortalSettings.findUnique as Mock).mockResolvedValue({ designer_publish_mode: 'per_site' });
  (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ site_main_roles: { [SITE_ID]: 'client_preview' } });
});

describe('GET /api/design/admin/sites', () => {
  it('admin and pm read the switches with the effective verdict and main_role', async () => {
    for (const role of ['admin', 'pm'] as const) {
      signIn(auth, userFind, role);
      const res = await GET();
      expect(res.status).toBe(200);
      expect((await res.json()).sites[0]).toMatchObject({
        id: SITE_ID, design_portal_enabled: true, designer_publish: true, design_auto_timer: true, effective_designer_publish: true, main_role: 'client_preview',
      });
    }
  });
  it('a designer is 403 and an anonymous caller 401', async () => {
    signIn(auth, userFind, 'designer');
    expect((await GET()).status).toBe(403);
    anonymous(auth);
    expect((await GET()).status).toBe(401);
  });
});
