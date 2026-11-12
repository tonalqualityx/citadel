import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID, OTHER_DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) },
    designSession: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';

const ALIAS = 'https://design-t-abcd2345abcd2345.vcdp.pages.dev';
const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const siteFind = prisma.site.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const send = sendEmail as Mock;
const STORED_EMAIL = 'lisa.stored@example.test';

const call = (body: unknown = { path: '/about/' }, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/preview-link`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));
const arrange = (over: Record<string, unknown> = {}) => {
  sessionFind.mockResolvedValue(sessionRow({ preview_url: ALIAS, ...over }));
  siteFind.mockResolvedValue({ name: 'VCDP' });
};
const as = (role: 'designer' | 'admin' | 'pm', userId?: string) => {
  signIn(auth, userFind, role, userId ? { userId } : {});
  const resolved = { role, is_active: true, email: STORED_EMAIL };
  userFind.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, ...resolved }));
};
beforeEach(() => { vi.clearAllMocks(); arrange(); });

describe('POST /api/design/sessions/:id/preview-link', () => {
  it('the session designer: 200, one mail to the stored address, link on the alias', async () => {
    as('designer');
    const res = await call({ path: '/about/?x=1#y' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.to).toBe(STORED_EMAIL);
    expect(arg.subject).toBe('Your preview link for VCDP');
    expect(arg.text).toContain(`${ALIAS}/about/`);
    expect(arg.text).not.toContain('x=1');
    expect(arg.text).toContain('not public');
  });
  it('escapes the site name in the html part', async () => {
    as('designer');
    siteFind.mockResolvedValue({ name: '<b>"Bad" & Co</b>' });
    await call();
    const html = send.mock.calls[0][0].html as string;
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;&quot;Bad&quot; &amp; Co&lt;/b&gt;');
  });
  it('an email or to field is rejected and never used', async () => {
    as('designer');
    expect((await call({ path: '/', email: 'x@evil.example' })).status).toBe(400);
    expect((await call({ path: '/', to: 'x@evil.example' })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    ['//evil.example/x'], ['/\\evil'], ['https://evil.example'], ['/a/../b'], ['/x@evil.example'], ['/' + 'a'.repeat(600)], ['/a\nb'],
  ])('a path of %j is 400 bad_path and nothing is sent', async (path) => {
    as('designer');
    const res = await call({ path });
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('a stored preview address that is not an https pages.dev address is 400 bad_path', async () => {
    as('designer');
    arrange({ preview_url: 'https://evil.example' });
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('bad_path');
    expect(send).not.toHaveBeenCalled();
  });
  it('no preview yet is 409 no_preview', async () => {
    as('designer');
    arrange({ preview_url: null });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_preview');
    expect(send).not.toHaveBeenCalled();
  });
  it('an admin who is not the designer gets the mail at their own stored address', async () => {
    as('admin');
    expect((await call()).status).toBe(200);
    expect(send.mock.calls[0][0].to).toBe(STORED_EMAIL);
  });
  sessionRouteMatrix('preview-link', { invoke: (h) => call({ path: '/' }, h), requireAuth: auth, userFind, assignmentFind: prisma.projectTeamAssignment.findFirst as Mock, arrange, write: true });
  it('another designer is 404 and nothing is sent', async () => {
    as('designer', OTHER_DESIGNER_ID);
    expect((await call()).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
  it('the 11th call in an hour is 429', async () => {
    const owner = '99999999-0000-4000-8000-000000000001';
    arrange({ designer_id: owner });
    as('designer', owner);
    for (let i = 0; i < 10; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(10);
  });
  it('the limit follows the signed-in user, not X-Forwarded-For (W6.1 F3)', async () => {
    const owner = '99999999-0000-4000-8000-000000000002';
    arrange({ designer_id: owner });
    as('designer', owner);
    for (let i = 0; i < 10; i++) expect((await call({ path: '/' }, { 'x-forwarded-for': `203.0.113.${i}` })).status).toBe(200);
    const res = await call({ path: '/' }, { 'x-forwarded-for': '198.51.100.77' });
    expect(res.status).toBe(429);
    expect((await res.json()).limit).toBe('user:design-preview-link');
    expect(send).toHaveBeenCalledTimes(10);
  });
});
