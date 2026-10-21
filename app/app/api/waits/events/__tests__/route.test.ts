import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID } from '@/lib/waits/owner';

const store = new MemStore();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => store }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import type { Mock } from 'vitest';

const PROJECT = '55555555-5555-4555-8555-555555555555';
const post = (body: object) =>
  POST(new NextRequest('http://localhost/api/waits/events', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('POST /api/waits/events', () => {
  it('applies an extension and answers a replay as a duplicate', async () => {
    const w = store.add(buildWaitData({ template_key: 'build.gate_mike', subject: 'the sitemap', project_id: PROJECT }));
    const ev = { event_id: 'ev-1', kind: 'extend', target: w.id, payload: { mode: 'days', business_days: 2 } };
    const first = await (await post(ev)).json();
    expect(first.results[0]).toMatchObject({ duplicate: false, matched: 1 });
    expect(store.waits.get(w.id)!.extension_count).toBe(1);
    const replay = await (await post(ev)).json();
    expect(replay.results[0].duplicate).toBe(true);
  });

  it('takes a batch', async () => {
    store.add(buildWaitData({ template_key: 'build.gate_mike', subject: 'a', project_id: PROJECT }));
    const gate = [...store.waits.values()][0];
    const res = await post({
      events: [
        { event_id: 'b1', kind: 'extend', target: gate.id, payload: { mode: 'days', business_days: 2, reason: 'need_more_time' } },
        { event_id: 'b2', kind: 'place', chain: { kind: 'project', id: PROJECT }, payload: { thread_id: 'thr-9' } },
      ],
    });
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results[0].applied[0].action).toBe('extended');
    expect(json.results[1].applied[0].action).toBe('placed');
  });

  it('rejects unknown kinds and empty batches', async () => {
    expect((await post({ event_id: 'x', kind: 'explode' })).status).toBe(400);
    expect((await post({ events: [] })).status).toBe(400);
  });
});
