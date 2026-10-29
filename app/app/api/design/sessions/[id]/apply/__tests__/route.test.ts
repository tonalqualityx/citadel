import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { ApiError } from '@/lib/api/errors';
import { jsonRequest, paramsOf, signIn, sessionRow, pinRow, sessionRouteMatrix, REF, SESSION_ID, PIN_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {
    user: { findUnique: vi.fn() },
    designSession: { findUnique: vi.fn() },
    designEvent: { findUnique: vi.fn() },
    designPin: { findMany: vi.fn(), updateMany: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock('@/lib/design/budget', async (orig) => ({ ...(await orig<typeof import('@/lib/design/budget')>()), budgetStatus: vi.fn() }));
vi.mock('@/lib/design/events', async (orig) => ({ ...(await orig<typeof import('@/lib/design/events')>()), appendDesignerEvent: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { budgetStatus } from '@/lib/design/budget';
import { appendDesignerEvent } from '@/lib/design/events';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const eventFind = prisma.designEvent.findUnique as Mock;
const pinFind = prisma.designPin.findMany as Mock;
const pinUpdate = prisma.designPin.updateMany as Mock;
const budget = budgetStatus as Mock;
const append = appendDesignerEvent as Mock;
const PIN2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const call = (body: unknown, headers?: Record<string, string>) =>
  POST(jsonRequest(`/api/design/sessions/${SESSION_ID}/apply`, 'POST', body, headers), paramsOf({ id: SESSION_ID }));

function arrange() {
  sessionFind.mockResolvedValue(sessionRow());
  eventFind.mockResolvedValue(null);
  budget.mockResolvedValue({ reached: false, reason: null, cost_usd: 1, budget_usd: 25, month_spend_usd: 1, monthly_cap_usd: null });
  pinFind.mockResolvedValue([pinRow(), pinRow({ id: PIN2, note: 'tighter', page_path: '/', crop_asset_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', viewport_width: 390, viewport_height: 700, data_shape: null, text_quote: null, tag: null })]);
  pinUpdate.mockResolvedValue({ count: 2 });
  append.mockResolvedValue({ seq: 9, duplicate: false });
}
beforeEach(() => { vi.clearAllMocks(); arrange(); signIn(auth, userFind, 'designer'); });

describe('POST /api/design/sessions/:id/apply', () => {
  it('emits exactly the ApplyPayload of design 7.3 (pins as PinPacket, width = viewport.w) and marks the pins sent', async () => {
    const res = await call({ client_ref: REF, pin_ids: [PIN_ID, PIN2], note: 'also check the footer', files: [{ id: 'f1', name: 'logo.png', mime: 'image/png' }] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ seq: 9 });
    const input = append.mock.calls[0][0];
    expect(input).toMatchObject({ sessionId: SESSION_ID, kind: 'apply', clientRef: REF });
    expect(input.payload).toEqual({
      note: 'also check the footer',
      files: [{ id: 'f1', name: 'logo.png', mime: 'image/png' }],
      preview_url: 'https://design-66666666.vcdp.pages.dev',
      pins: [
        {
          pin_id: PIN_ID, note: 'make it bigger', path: '/about/', sha: 'abc1234', data_lib: 'hero', lib_stack: ['hero', 'section'], data_shape: 'card',
          selector: 'section[data-lib="hero"]', tag: 'h1', classes: ['title'], text_quote: 'Welcome', bbox: { x: 1, y: 2, w: 300, h: 40 }, viewport: { w: 1280, h: 800 },
        },
        {
          pin_id: PIN2, note: 'tighter', path: '/', sha: 'abc1234', data_lib: 'hero', lib_stack: ['hero', 'section'], data_shape: null,
          selector: 'section[data-lib="hero"]', tag: '', classes: ['title'], text_quote: null, bbox: { x: 1, y: 2, w: 300, h: 40 }, viewport: { w: 390, h: 700 },
          crop_asset_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      ],
    });
    expect(Object.keys(input.payload).sort()).toEqual(['files', 'note', 'pins', 'preview_url']);
    expect(pinUpdate).toHaveBeenCalledWith({ where: { id: { in: [PIN_ID, PIN2] }, session_id: SESSION_ID, status: 'pending' }, data: { status: 'sent' } });
    expect(pinUpdate).toHaveBeenLastCalledWith({ where: { id: { in: [PIN_ID, PIN2] } }, data: { apply_event_seq: 9 } });
  });
  it('omits note and files when not given', async () => {
    pinFind.mockResolvedValue([pinRow()]);
    pinUpdate.mockResolvedValue({ count: 1 });
    await call({ client_ref: REF, pin_ids: [PIN_ID] });
    expect(Object.keys(append.mock.calls[0][0].payload).sort()).toEqual(['pins', 'preview_url']);
  });
  it('refuses over budget with the numbers, before looking at pins', async () => {
    budget.mockResolvedValue({ reached: true, reason: 'session_ceiling', cost_usd: 25, budget_usd: 25, month_spend_usd: 40, monthly_cap_usd: null });
    const res = await call({ client_ref: REF, pin_ids: [PIN_ID] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'budget_reached', reason: 'session_ceiling', cost_usd: 25, budget_usd: 25, month_spend_usd: 40 });
    expect(pinFind).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
  it('refuses stale pins unless allow_stale', async () => {
    pinFind.mockResolvedValue([pinRow({ preview_sha: 'old0000' })]);
    const res = await call({ client_ref: REF, pin_ids: [PIN_ID] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'stale_pins', stale_pin_ids: [PIN_ID], preview_sha: 'abc1234' });
    expect(append).not.toHaveBeenCalled();
    expect(pinUpdate).not.toHaveBeenCalled();
    pinUpdate.mockResolvedValue({ count: 1 });
    const ok = await call({ client_ref: REF, pin_ids: [PIN_ID], allow_stale: true });
    expect(ok.status).toBe(201);
    expect(append.mock.calls[0][0].payload.pins[0].sha).toBe('old0000');
  });
  it('404 for a pin of another session, 409 for a pin that is not pending', async () => {
    pinFind.mockResolvedValue([pinRow()]);
    expect((await call({ client_ref: REF, pin_ids: [PIN_ID, PIN2] })).status).toBe(404);
    pinFind.mockResolvedValue([pinRow({ status: 'sent' })]);
    expect((await call({ client_ref: REF, pin_ids: [PIN_ID] })).status).toBe(409);
  });
  it('409 when the claim loses a race, and puts pins back when the event append fails', async () => {
    pinUpdate.mockResolvedValueOnce({ count: 1 });
    pinFind.mockResolvedValue([pinRow(), pinRow({ id: PIN2 })]);
    expect((await call({ client_ref: REF, pin_ids: [PIN_ID, PIN2] })).status).toBe(409);
    pinUpdate.mockReset();
    pinUpdate.mockResolvedValue({ count: 1 });
    pinFind.mockResolvedValue([pinRow()]);
    append.mockRejectedValue(new ApiError('This session is closed', 409, 'session_closed'));
    expect((await call({ client_ref: REF, pin_ids: [PIN_ID] })).status).toBe(409);
    expect(pinUpdate).toHaveBeenLastCalledWith({ where: { id: { in: [PIN_ID] }, status: 'sent', apply_event_seq: null }, data: { status: 'pending' } });
  });
  it('a repeat of the same client_ref is 200 with the first seq and changes nothing', async () => {
    eventFind.mockResolvedValue({ seq: 4 });
    const res = await call({ client_ref: REF, pin_ids: [PIN_ID] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seq: 4 });
    expect(append).not.toHaveBeenCalled();
  });
  it('409 on a closed session and when there is no preview yet', async () => {
    sessionFind.mockResolvedValue(sessionRow({ status: 'closed' }));
    expect((await call({ client_ref: REF, pin_ids: [PIN_ID] })).status).toBe(409);
    sessionFind.mockResolvedValue(sessionRow({ preview_url: null }));
    pinFind.mockResolvedValue([pinRow()]);
    expect((await call({ client_ref: REF, pin_ids: [PIN_ID] })).status).toBe(409);
  });
  it('zod: pin_ids 0, 31, duplicates, non-uuid, files 11, note over 4000, missing client_ref are 400', async () => {
    const ids31 = Array.from({ length: 31 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const files11 = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, name: 'a', mime: 'image/png' }));
    for (const b of [
      { client_ref: REF, pin_ids: [] }, { client_ref: REF, pin_ids: ids31 }, { client_ref: REF, pin_ids: [PIN_ID, PIN_ID] }, { client_ref: REF, pin_ids: ['x'] },
      { client_ref: REF, pin_ids: [PIN_ID], files: files11 }, { client_ref: REF, pin_ids: [PIN_ID], note: 'x'.repeat(4001) }, { pin_ids: [PIN_ID] },
    ]) expect((await call(b)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
  });
  it('413 over the body cap', async () => {
    expect((await call(JSON.stringify({ client_ref: REF, pin_ids: [PIN_ID], note: 'x'.repeat(60 * 1024) }))).status).toBe(413);
  });
  sessionRouteMatrix('apply', { invoke: (h) => call({ client_ref: REF, pin_ids: [PIN_ID] }, h), requireAuth: auth, userFind, arrange, write: true });
});
