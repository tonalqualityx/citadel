import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, paramsOf, signIn, sessionRow, pinRow, sessionRouteMatrix, SHIPPED_PACKET, SESSION_ID, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, designSession: { findUnique: vi.fn() }, designPin: { count: vi.fn(), create: vi.fn() } },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const pinCreate = prisma.designPin.create as Mock;
const pinCount = prisma.designPin.count as Mock;
const call = (body: unknown, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/pins`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionFind.mockResolvedValue(sessionRow());
  pinCount.mockResolvedValue(0);
  pinCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => pinRow(data));
});

describe('POST /api/design/sessions/:id/pins', () => {
  it('accepts the shipped dp:packet as the overlay builds it and stores a pending pin', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call(SHIPPED_PACKET);
    expect(res.status).toBe(201);
    expect(pinCreate.mock.calls[0][0].data).toMatchObject({
      session_id: SESSION_ID, author_id: DESIGNER_ID, status: 'pending', page_path: '/about/', preview_sha: 'abc1234', data_lib: 'hero',
      lib_stack: ['hero', 'section'], data_shape: 'card', tag: 'h1', classes: ['title', 'big'], text_quote: 'Welcome to the site',
      viewport_width: 1280, viewport_height: 800, bbox: { x: 10, y: 20, w: 300, h: 40 }, note: '',
    });
    expect((await res.json()).pin).toMatchObject({ status: 'pending', tag: 'h1', classes: ['title', 'big'] });
  });
  it('is lenient where the overlay is: empty data_shape/text_quote/sha become null, data_shape is cut to 50', async () => {
    signIn(auth, userFind, 'designer');
    await call({ ...SHIPPED_PACKET, data_shape: '', text_quote: '', sha: '' });
    expect(pinCreate.mock.calls[0][0].data).toMatchObject({ data_shape: null, text_quote: null, preview_sha: null });
    await call({ ...SHIPPED_PACKET, data_shape: 'x'.repeat(60), note: 'bigger' });
    expect(pinCreate.mock.calls[1][0].data).toMatchObject({ data_shape: 'x'.repeat(50), note: 'bigger' });
  });
  it('zod caps every field (400)', async () => {
    signIn(auth, userFind, 'designer');
    const bad: Record<string, unknown>[] = [
      { selector: 'x'.repeat(501) }, { selector: '' }, { text_quote: 'x'.repeat(201) }, { path: 'about' }, { path: '//evil.test/' }, { path: `/${'a'.repeat(500)}` },
      { data_lib: 'Hero Card' }, { data_lib: 'x'.repeat(101) }, { lib_stack: Array(9).fill('hero') }, { classes: Array(21).fill('c') }, { tag: 'x'.repeat(41) },
      { bbox: { x: 1, y: 2, w: -1, h: 3 } }, { bbox: { x: 1 } }, { viewport: { w: 0, h: 800 } }, { viewport: { w: 1280 } }, { note: 'x'.repeat(4001) }, { sha: 'x'.repeat(65) },
    ];
    for (const patch of bad) expect((await call({ ...SHIPPED_PACKET, ...patch })).status, JSON.stringify(patch)).toBe(400);
    expect(pinCreate).not.toHaveBeenCalled();
  });
  it('413 over the body cap; 409 on a closed session; 409 when the tray is full', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call(JSON.stringify({ ...SHIPPED_PACKET, note: 'x'.repeat(40 * 1024) }))).status).toBe(413);
    sessionFind.mockResolvedValue(sessionRow({ status: 'closed' }));
    expect((await call(SHIPPED_PACKET)).status).toBe(409);
    sessionFind.mockResolvedValue(sessionRow());
    pinCount.mockResolvedValue(100);
    expect((await call(SHIPPED_PACKET)).status).toBe(409);
  });
  sessionRouteMatrix('pins', { invoke: (h) => call(SHIPPED_PACKET, h), requireAuth: auth, userFind, arrange: () => sessionFind.mockResolvedValue(sessionRow()), write: true });
});
