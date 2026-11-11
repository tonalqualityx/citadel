// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, WORKER, req } from '../../../__tests__/harness';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('@/lib/work/intake', async (orig) => ({ ...(await orig<typeof import('@/lib/work/intake')>()), planReplay: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { planReplay } from '@/lib/work/intake';
import { POST } from '../route';

const PATH = '/api/bast-chat/worker/decision-replay';
const ASK = '11111111-1111-4111-8111-111111111111';
const result = { rows: [], counts: { total: 0, would_close: 0, would_set: 0, left: 0, refused: 0, by_disposition: {} } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  vi.mocked(planReplay).mockResolvedValue(result as never);
});

describe('decision-replay route', () => {
  it('401 when signed out', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(req('POST', PATH, { items: [] }) as never)).status).toBe(401);
    expect(planReplay).not.toHaveBeenCalled();
  });
  for (const [who, auth] of NOT_WORKERS) {
    it(`403 for ${who}`, async () => {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await POST(req('POST', PATH, { items: [{ ask_id: ASK, disposition: 'no_action' }] }) as never)).status).toBe(403);
      expect(planReplay).not.toHaveBeenCalled();
    });
  }
  it('reads only: passes the items to planReplay and answers its result', async () => {
    const items = [{ ask_id: ASK, disposition: 'no_action', reason: 'A thank-you.' }];
    const res = await POST(req('POST', PATH, { items }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(vi.mocked(planReplay).mock.calls[0][1]).toEqual(items);
  });
  it('400 on an empty list, more than 500, a bad disposition, a bad id or an extra field', async () => {
    const many = Array.from({ length: 501 }, () => ({ ask_id: ASK, disposition: 'no_action' }));
    for (const body of [{ items: [] }, { items: many }, { items: [{ ask_id: ASK, disposition: 'ignore' }] }, { items: [{ ask_id: 'x', disposition: 'no_action' }] }, { items: [{ ask_id: ASK, disposition: 'no_action' }], dry: false }]) {
      expect((await POST(req('POST', PATH, body) as never)).status).toBe(400);
    }
    expect(planReplay).not.toHaveBeenCalled();
  });
});
