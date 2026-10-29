import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET, PATCH } from '../route';
import { jsonRequest, paramsOf, signIn, anonymous } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/design/drive-share', () => ({ onClientFolderChanged: vi.fn(async () => 0) }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, client: { findUnique: vi.fn(), update: vi.fn() } } }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { onClientFolderChanged } from '@/lib/design/drive-share';

const ID = 'abababab-abab-4bab-8bab-abababababab';
const FOLDER = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123456789';
const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const find = prisma.client.findUnique as Mock;
const update = prisma.client.update as Mock;
const call = (body: unknown, headers?: Record<string, string>, id = ID) =>
  PATCH(jsonRequest(`/api/design/admin/clients/${id}`, 'PATCH', body, headers), paramsOf({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  signIn(auth, userFind, 'admin');
  find.mockResolvedValue({ id: ID, is_deleted: false, drive_folder_id: null });
  update.mockImplementation(async ({ data }: { data: { drive_folder_id: string | null } }) => ({ id: ID, drive_folder_id: data.drive_folder_id }));
});

describe('PATCH /api/design/admin/clients/:id', () => {
  it('sets the folder id and answers { client: { id, drive_folder_id } }', async () => {
    const res = await call({ drive_folder_id: FOLDER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ client: { id: ID, drive_folder_id: FOLDER } });
    expect(update.mock.calls[0][0].data).toEqual({ drive_folder_id: FOLDER });
    expect(onClientFolderChanged).toHaveBeenCalledWith(ID, null, FOLDER, expect.any(String));
  });
  it('null clears it', async () => {
    const res = await call({ drive_folder_id: null });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ drive_folder_id: null });
    expect((await res.json()).client.drive_folder_id).toBeNull();
  });
  it('bad ids are 400: short, long, spaces, slash, url, number, missing, extra field', async () => {
    for (const b of [{ drive_folder_id: 'short' }, { drive_folder_id: 'a'.repeat(101) }, { drive_folder_id: 'a'.repeat(19) + ' ' }, { drive_folder_id: 'a'.repeat(20) + '/x' },
      { drive_folder_id: 'https://drive.google.com/drive/folders/' + FOLDER }, { drive_folder_id: 5 }, {}, { drive_folder_id: FOLDER, name: 'x' }]) {
      expect((await call(b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });
  it('404 for unknown, deleted or malformed id', async () => {
    find.mockResolvedValue(null);
    expect((await call({ drive_folder_id: FOLDER })).status).toBe(404);
    find.mockResolvedValue({ id: ID, is_deleted: true });
    expect((await call({ drive_folder_id: FOLDER })).status).toBe(404);
    expect((await call({ drive_folder_id: FOLDER }, undefined, 'nope')).status).toBe(404);
  });
  it('cross-site 403; anonymous 401; designer, pm, tech and API key 403', async () => {
    expect((await call({ drive_folder_id: FOLDER }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    anonymous(auth);
    expect((await call({ drive_folder_id: FOLDER })).status).toBe(401);
    for (const role of ['designer', 'pm', 'tech'] as const) { signIn(auth, userFind, role); expect((await call({ drive_folder_id: FOLDER })).status, role).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call({ drive_folder_id: FOLDER })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('GET /api/design/admin/clients/:id', () => {
  const get = (id = ID) => GET(jsonRequest(`/api/design/admin/clients/${id}`, 'GET'), paramsOf({ id }));
  it('admin reads { id, drive_folder_id }; null when unset', async () => {
    find.mockResolvedValueOnce({ id: ID, is_deleted: false, drive_folder_id: FOLDER });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ID, drive_folder_id: FOLDER });
    find.mockResolvedValueOnce({ id: ID, is_deleted: false, drive_folder_id: null });
    expect(await (await get()).json()).toEqual({ id: ID, drive_folder_id: null });
    expect(update).not.toHaveBeenCalled();
  });
  it('404 for unknown, deleted or malformed id', async () => {
    find.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    find.mockResolvedValueOnce({ id: ID, is_deleted: true, drive_folder_id: FOLDER });
    expect((await get()).status).toBe(404);
    expect((await get('nope')).status).toBe(404);
  });
  it('pm, tech and designer get 403; anonymous 401', async () => {
    for (const role of ['designer', 'pm', 'tech'] as const) { signIn(auth, userFind, role); expect((await get()).status, role).toBe(403); }
    anonymous(auth);
    expect((await get()).status).toBe(401);
  });
});
