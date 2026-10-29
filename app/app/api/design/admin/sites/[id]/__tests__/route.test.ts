import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PATCH } from '../route';
import { jsonRequest, paramsOf, signIn, anonymous, SITE_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, site: { findUnique: vi.fn(), update: vi.fn() }, designPortalSettings: { findUnique: vi.fn() }, designWorkerState: { findUnique: vi.fn() } },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const siteFind = prisma.site.findUnique as Mock;
const siteUpdate = prisma.site.update as Mock;
const call = (body: unknown, headers?: Record<string, string>, id = SITE_ID) =>
  PATCH(jsonRequest(`/api/design/admin/sites/${id}`, 'PATCH', body, headers), paramsOf({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  signIn(auth, userFind, 'admin');
  siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, site_type: 'eleventy' });
  siteUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: SITE_ID, design_portal_enabled: true, designer_publish: true, design_auto_timer: true, ...data }));
  (prisma.designPortalSettings.findUnique as Mock).mockResolvedValue({ designer_publish_mode: 'per_site' });
  (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ site_main_roles: { [SITE_ID]: 'client_preview' } });
});

describe('PATCH /api/design/admin/sites/:id (site type)', () => {
  it('stamps site_type eleventy when enabling a site with no type', async () => {
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, site_type: null });
    expect((await call({ design_portal_enabled: true })).status).toBe(200);
    expect(siteUpdate.mock.calls[0][0].data).toEqual({ design_portal_enabled: true, site_type: 'eleventy' });
  });
  it('refuses 409 to enable a site of another type, and writes nothing', async () => {
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, site_type: 'wordpress' });
    const res = await call({ design_portal_enabled: true });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain('only eleventy sites can use the Designer Portal');
    expect(siteUpdate).not.toHaveBeenCalled();
  });
  it('disabling or other toggles never touch site_type', async () => {
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, site_type: 'wordpress' });
    expect((await call({ design_portal_enabled: false })).status).toBe(200);
    expect(siteUpdate.mock.calls[0][0].data).toEqual({ design_portal_enabled: false });
  });
});

describe('PATCH /api/design/admin/sites/:id', () => {
  it('writes the three columns as plain booleans and reports the effective designer publish and main role', async () => {
    const res = await call({ design_portal_enabled: true, designer_publish: false, design_auto_timer: false });
    expect(res.status).toBe(200);
    expect(siteUpdate.mock.calls[0][0].data).toEqual({ design_portal_enabled: true, designer_publish: false, design_auto_timer: false });
    expect((await res.json()).site).toEqual({
      id: SITE_ID, design_portal_enabled: true, designer_publish: false, design_auto_timer: false, effective_designer_publish: false, main_role: 'client_preview',
    });
  });
  it('effective_designer_publish follows the D5 table (pre_launch_only + production = off)', async () => {
    (prisma.designPortalSettings.findUnique as Mock).mockResolvedValue({ designer_publish_mode: 'pre_launch_only' });
    (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ site_main_roles: { [SITE_ID]: 'production' } });
    expect((await (await call({ designer_publish: true })).json()).site).toMatchObject({ effective_designer_publish: false, main_role: 'production' });
  });
  it('zod: empty, unknown field, non-boolean (string/null) are 400', async () => {
    for (const b of [{}, { name: 'x' }, { designer_publish: 'false' }, { design_auto_timer: null }, { design_portal_enabled: 1 }]) expect((await call(b)).status, JSON.stringify(b)).toBe(400);
    expect(siteUpdate).not.toHaveBeenCalled();
  });
  it('404 for an unknown, deleted or malformed site; 413 over the cap', async () => {
    siteFind.mockResolvedValue(null);
    expect((await call({ designer_publish: true })).status).toBe(404);
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: true });
    expect((await call({ designer_publish: true })).status).toBe(404);
    expect((await call({ designer_publish: true }, undefined, 'nope')).status).toBe(404);
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false });
    expect((await call(JSON.stringify({ designer_publish: true, pad: 'x'.repeat(5000) }))).status).toBe(413);
  });
  it('cross-site 403; anonymous 401; designer, pm and API key 403', async () => {
    expect((await call({ designer_publish: true }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    anonymous(auth);
    expect((await call({ designer_publish: true })).status).toBe(401);
    for (const role of ['designer', 'pm'] as const) { signIn(auth, userFind, role); expect((await call({ designer_publish: true })).status).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call({ designer_publish: true })).status).toBe(403);
    expect(siteUpdate).not.toHaveBeenCalled();
  });
});
