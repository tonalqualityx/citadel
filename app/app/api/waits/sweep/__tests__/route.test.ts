import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { buildWaitData } from '@/lib/waits/templates';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { zonedTimeToUtc } from '@/lib/waits/business-days';

const store = new MemStore();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => store }));
vi.mock('@/lib/services/slack-notifications', () => ({ sendSlackNotification: vi.fn(async () => true) }));
// The general dispatcher also writes in-app rows and queues email. The sweeper must never use it.
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn(async () => ({})) }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ is_active: true })) },
    function: { findUnique: vi.fn(async () => null) },
    projectTeamAssignment: { findMany: vi.fn(async () => []) },
    accord: { findUnique: vi.fn(async () => null) },
    // The price review opener runs at the top of every sweep; no charters here, so it opens nothing.
    charter: { findMany: vi.fn(async () => []) },
    wait: { findMany: vi.fn(async () => []) },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { sendSlackNotification } from '@/lib/services/slack-notifications';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const post = (qs = '') => new NextRequest(`http://localhost/api/waits/sweep${qs}`, { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(zonedTimeToUtc(2026, 10, 21, 10)); // Wed 10:00 Eastern, inside business hours
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
  delete process.env.WAIT_SLACK_NAG;
});

function seed() {
  // Due long ago, blocks a client, on Mike: lands in the ladder.
  store.add(
    buildWaitData({
      template_key: 'build.gate_mike',
      subject: 'the sitemap',
      started_at: zonedTimeToUtc(2026, 9, 1, 9),
      client_id: '11111111-1111-4111-8111-111111111111',
    })
  );
}

describe('POST /api/waits/sweep', () => {
  it('requires an admin', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await POST(post())).status).toBe(403);
  });

  it('requires authentication', async () => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await POST(post())).status).toBe(401);
  });

  it('dry_run=1 reports counts and writes nothing', async () => {
    seed();
    const before = JSON.stringify(store.all());
    const res = await POST(post('?dry_run=1'));
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.dry_run).toBe(true);
    expect(report.counts.due).toBe(1);
    expect(report.nagged).toHaveLength(1);
    expect(JSON.stringify(store.all())).toBe(before);
    expect(store.events).toHaveLength(0);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('a real pass climbs the ladder and sends Mike the one DM', async () => {
    seed();
    const res = await POST(post());
    const report = await res.json();
    expect(report.dry_run).toBe(false);
    expect(report.nagged[0].level).toBe(3);
    expect(sendSlackNotification).toHaveBeenCalledTimes(1);
    expect(dispatchNotification).not.toHaveBeenCalled();
    expect((sendSlackNotification as Mock).mock.calls[0][0]).toMatchObject({ userId: MIKE_USER_ID, type: 'system_alert' });
    expect(store.all()[0].nag_level).toBe(3);
  });

  it('WAIT_SLACK_NAG=off sends nothing', async () => {
    process.env.WAIT_SLACK_NAG = 'off';
    seed();
    await POST(post());
    expect(sendSlackNotification).not.toHaveBeenCalled();
    // The countdown does not depend on Slack: this wait is weeks late.
    expect(store.all()[0].nag_level).toBe(3);
  });

  it('an empty database is a clean zero report', async () => {
    const report = await (await POST(post())).json();
    expect(report.counts.fired).toBe(0);
    expect(report.errors).toEqual([]);
  });
});

describe('the Slack DM', () => {
  const lateWait = () =>
    store.add(buildWaitData({ template_key: 'build.gate_mike', subject: 'x', started_at: zonedTimeToUtc(2026, 10, 12, 10), client_id: '11111111-1111-4111-8111-111111111111' }));

  it('a Slack failure does not climb to the countdown, makes no in-app notice or email, and retries the next business day', async () => {
    (sendSlackNotification as Mock).mockResolvedValue(false);
    const w = lateWait(); // 5 business days late on Wed 10-21
    const r1 = await (await POST(post())).json();
    expect(r1.nag_failed).toEqual([w.id]);
    expect(store.get(w.id).nag_level).toBe(1);
    expect(sendSlackNotification).toHaveBeenCalledTimes(1);
    expect(dispatchNotification).not.toHaveBeenCalled();
    // Same business day, later: throttled, no second attempt.
    vi.setSystemTime(zonedTimeToUtc(2026, 10, 21, 15));
    await POST(post());
    await POST(post());
    expect(sendSlackNotification).toHaveBeenCalledTimes(1);
    // Next business day: one more attempt.
    vi.setSystemTime(zonedTimeToUtc(2026, 10, 22, 10));
    await POST(post());
    expect(sendSlackNotification).toHaveBeenCalledTimes(2);
    expect(store.get(w.id).nag_level).toBe(1);
    // Slack recovers: the DM lands, then the countdown follows.
    (sendSlackNotification as Mock).mockResolvedValue(true);
    vi.setSystemTime(zonedTimeToUtc(2026, 10, 23, 10));
    await POST(post());
    expect(sendSlackNotification).toHaveBeenCalledTimes(3);
    expect(store.get(w.id).nag_level).toBe(3);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('is not attempted outside business hours', async () => {
    vi.setSystemTime(zonedTimeToUtc(2026, 10, 21, 22));
    lateWait();
    const r = await (await POST(post())).json();
    expect(sendSlackNotification).not.toHaveBeenCalled();
    expect(r.nagged[0].level).toBe(1);
  });
});
