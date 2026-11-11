// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/bast-chat/worker-kit', () => ({ requireChatWorker: vi.fn(async () => undefined) }));
vi.mock('@/lib/bast-chat/route-helpers', () => ({
  workerOwnerId: vi.fn(async () => 'owner-1'),
  chatJson: (body: unknown) => Response.json(body),
  chatError: (e: unknown) => { throw e; },
  ownerToday: vi.fn(async () => ({
    date: '2026-11-11',
    calendar: { rows: [{ start: '2026-11-11T19:00:00.000Z', end: '2026-11-11T19:30:00.000Z', all_day: false, who: 'Erick, Bootleggers (lead)', title: 'Erick', kind: 'meeting', join_url: null, client: null, lead: true }], tomorrow_first: null },
  })),
}));

import { GET } from '../route';

describe('GET /api/bast-chat/worker/today', () => {
  it('passes the owner today with its calendar, names only', async () => {
    const r = await GET();
    const body = await r.json();
    expect(body.calendar.rows[0].who).toBe('Erick, Bootleggers (lead)');
    expect(JSON.stringify(body.calendar)).not.toContain('@');
  });
});
