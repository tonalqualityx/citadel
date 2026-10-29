import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PATCH } from '../route';
import { jsonRequest, paramsOf, signIn, anonymous, sessionRow, pinRow, PIN_ID, SESSION_ID, DESIGNER_ID, OTHER_DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';
import { ApiError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) }, designSession: { findUnique: vi.fn() }, designPin: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() } },
}));
vi.mock('@/lib/design/followups', () => ({ createFollowupTask: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createFollowupTask } from '@/lib/design/followups';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const pin = prisma.designPin as unknown as Record<string, Mock>;
const followup = createFollowupTask as Mock;
const call = (body: unknown, headers?: Record<string, string>, id = PIN_ID) =>
  PATCH(jsonRequest(`/api/design/pins/${id}`, 'PATCH', body, headers), paramsOf({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.designSession.findUnique as Mock).mockResolvedValue(sessionRow());
  pin.findUnique.mockResolvedValue(pinRow());
  pin.updateMany.mockResolvedValue({ count: 1 });
  pin.findUniqueOrThrow.mockResolvedValue(pinRow({ note: 'new', status: 'pending' }));
  pin.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => pinRow(data));
  followup.mockResolvedValue({ task_id: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt', title: 'Follow-up: x' });
});

describe('PATCH /api/design/pins/:id', () => {
  it('edits the note of a pending pin', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ note: 'new' });
    expect(res.status).toBe(200);
    expect(pin.updateMany).toHaveBeenCalledWith({ where: { id: PIN_ID, status: 'pending' }, data: { note: 'new' } });
    expect((await res.json()).pin.note).toBe('new');
  });
  it('discards a pending pin', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({ status: 'discarded' })).status).toBe(200);
    expect(pin.updateMany.mock.calls[0][0].data).toEqual({ status: 'discarded' });
  });
  it('followup files a follow-up task through the shared builder and stores the task id', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call({ status: 'followup', followup_assign_to_me: true });
    expect(res.status).toBe(200);
    expect(followup).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, designerId: DESIGNER_ID, assignToDesigner: true, pinIds: [PIN_ID] }),
      expect.anything(),
    );
    expect(pin.update).toHaveBeenCalledWith({ where: { id: PIN_ID }, data: { followup_task_id: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt' } });
    const json = await res.json();
    expect(json.pin).toMatchObject({ followup_task_id: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt' });
  });
  it('a failed filing puts the pin back to pending', async () => {
    signIn(auth, userFind, 'designer');
    followup.mockRejectedValue(new ApiError('boom', 400, 'bad_project'));
    expect((await call({ status: 'followup' })).status).toBe(400);
    expect(pin.updateMany).toHaveBeenLastCalledWith({ where: { id: PIN_ID, status: 'followup', followup_task_id: null }, data: { status: 'pending' } });
  });
  it('only pending pins change (409)', async () => {
    signIn(auth, userFind, 'designer');
    pin.findUnique.mockResolvedValue(pinRow({ status: 'sent' }));
    expect((await call({ note: 'x' })).status).toBe(409);
    pin.findUnique.mockResolvedValue(pinRow());
    pin.updateMany.mockResolvedValue({ count: 0 });
    expect((await call({ note: 'x' })).status).toBe(409);
  });
  it('zod: empty body, bad status (resolved/sent), note over 4000 are 400', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({})).status).toBe(400);
    expect((await call({ status: 'resolved' })).status).toBe(400);
    expect((await call({ status: 'sent' })).status).toBe(400);
    expect((await call({ note: 'x'.repeat(4001) })).status).toBe(400);
  });
  it('413 over the body cap; cross-site 403; anonymous 401', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call(JSON.stringify({ note: 'x'.repeat(20 * 1024) }))).status).toBe(413);
    expect((await call({ note: 'x' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    anonymous(auth);
    expect((await call({ note: 'x' })).status).toBe(401);
  });
  it("another designer's pin is 404, a missing or malformed id is 404, pm is 403", async () => {
    signIn(auth, userFind, 'designer', { userId: OTHER_DESIGNER_ID });
    expect((await call({ note: 'x' })).status).toBe(404);
    signIn(auth, userFind, 'designer');
    pin.findUnique.mockResolvedValue(null);
    expect((await call({ note: 'x' })).status).toBe(404);
    expect((await call({ note: 'x' }, undefined, 'nope')).status).toBe(404);
    pin.findUnique.mockResolvedValue(pinRow());
    signIn(auth, userFind, 'pm');
    expect((await call({ note: 'x' })).status).toBe(403);
  });
});

describe('W8.2 fixes on PATCH pins', () => {
  it('N8: unknown fields (author_id, session_id) are 400, nothing written', async () => {
    signIn(auth, userFind, 'designer');
    expect((await call({ note: 'x', author_id: OTHER_DESIGNER_ID })).status).toBe(400);
    expect((await call({ status: 'discarded', session_id: SESSION_ID })).status).toBe(400);
    expect(pin.updateMany).not.toHaveBeenCalled();
  });
  it('H7: an admin API key is 403', async () => {
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call({ note: 'x' })).status).toBe(403);
  });
  it('H2: the session designer removed from the project is 404', async () => {
    signIn(auth, userFind, 'designer');
    (prisma.projectTeamAssignment.findFirst as Mock).mockResolvedValueOnce(null);
    expect((await call({ note: 'x' })).status).toBe(404);
  });
});
